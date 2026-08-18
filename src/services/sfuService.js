'use strict';

const env = require('../config/env');
const logger = require('../utils/logger');

// mediasoup ships a native worker binary compiled at install time (see
// backend/Dockerfile and docs/ROADMAP.md's Phase 1 native-toolchain notes)
// — on a machine where that toolchain isn't set up yet, `npm install`
// hasn't actually put a usable copy in node_modules. Loading it lazily and
// catching the failure here means an incomplete SFU setup degrades to
// "SFU unavailable" (mesh calling and everything else keeps working)
// instead of crashing the entire backend at require-time.
let mediasoup = null;
try {
  mediasoup = require('mediasoup');
} catch (err) {
  logger.warn({ err: err.message }, 'mediasoup not installed — SFU calling disabled, mesh calling unaffected');
}

/**
 * Codecs offered to every Router. Kept minimal and widely-supported:
 * Opus for audio (every WebRTC client supports it), VP8 for video (no
 * licensing/hardware-encoder assumptions, unlike H264). Extending this
 * list (e.g. adding VP9/H264 for better compression) is a router-level
 * change only — clients negotiate whatever the router advertises via
 * `router.rtpCapabilities`, no client code changes required.
 */
const MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 },
  },
];

const TRANSPORT_OPTIONS = {
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
  initialAvailableOutgoingBitrate: 1000000,
};

/**
 * Per-socket SFU state: one send transport (this peer's own mic/cam/
 * screen-share), one recv transport (everything this peer receives from
 * everyone else — mediasoup multiplexes many consumers over a single recv
 * transport, unlike mesh's one-RTCPeerConnection-per-remote-peer), plus
 * the producers/consumers living on those transports.
 */
class Peer {
  constructor(socketId, userId) {
    this.socketId = socketId;
    this.userId = userId;
    /** @type {Map<string, import('mediasoup').types.WebRtcTransport>} */
    this.transports = new Map();
    /** @type {Map<string, import('mediasoup').types.Producer>} */
    this.producers = new Map();
    /** @type {Map<string, import('mediasoup').types.Consumer>} */
    this.consumers = new Map();
  }
}

class Call {
  constructor(router) {
    this.router = router;
    /** @type {Map<string, Peer>} socketId -> Peer */
    this.peers = new Map();
  }
}

/**
 * Owns the mediasoup Worker pool and per-call Router/Transport/Producer/
 * Consumer state. One Router per active call — `callId` is an opaque
 * string (`room:<uuid>` today; `channel:<uuid>` once servers/channels
 * ship, per docs/ROADMAP.md's Phase 3 plan) so this service never needs
 * to know which Postgres table backs a given call.
 *
 * State is intentionally in-memory only, unlike webrtcService.js's
 * Redis-mirrored peer map — mediasoup Router/Transport/Producer/Consumer
 * are live native handles tied to this exact process and can't be
 * reconstructed from Redis after a restart. Horizontal-scaling this
 * service is a distinct future problem (see ROADMAP.md's SFU risk notes),
 * not something this model pretends to solve.
 */
class SfuService {
  constructor() {
    /** @type {import('mediasoup').types.Worker[]} */
    this.workers = [];
    this.nextWorkerIndex = 0;
    /** @type {Map<string, Call>} */
    this.calls = new Map();
  }

  get isAvailable() {
    return mediasoup !== null && this.workers.length > 0;
  }

  async init() {
    if (!mediasoup) {
      logger.warn('Skipping mediasoup worker startup — package not installed');
      return;
    }
    const count = Math.max(1, env.mediasoup.numWorkers);
    for (let i = 0; i < count; i++) {
      const worker = await mediasoup.createWorker({
        logLevel: 'warn',
        rtcMinPort: env.mediasoup.minPort,
        rtcMaxPort: env.mediasoup.maxPort,
      });
      worker.on('died', (err) => {
        // A mediasoup Worker dying is not recoverable in-process (it's a
        // crashed native subprocess) — exit loudly so an orchestrator
        // (Docker restart policy, PM2, k8s) restarts the whole service
        // rather than silently continuing with fewer workers than configured.
        logger.error({ err, pid: worker.pid }, 'mediasoup worker died unexpectedly; exiting process');
        process.exit(1);
      });
      this.workers.push(worker);
    }
    logger.info({ workerCount: this.workers.length, portRange: [env.mediasoup.minPort, env.mediasoup.maxPort] }, 'mediasoup workers started');
  }

  _nextWorker() {
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  async _getOrCreateCall(callId) {
    if (!this.isAvailable) {
      throw new Error('SFU calling is not available on this server (mediasoup not installed)');
    }
    let call = this.calls.get(callId);
    if (call) return call;
    const worker = this._nextWorker();
    const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
    call = new Call(router);
    this.calls.set(callId, call);
    logger.info({ callId, workerPid: worker.pid }, 'Created mediasoup router for call');
    return call;
  }

  _getPeer(callId, socketId) {
    const call = this.calls.get(callId);
    const peer = call?.peers.get(socketId);
    if (!call || !peer) {
      throw new Error(`No SFU peer for socket ${socketId} in call ${callId} — call sfu:get-rtp-capabilities first`);
    }
    return { call, peer };
  }

  /**
   * Ensures a call/router exists and this socket has a Peer entry, then
   * returns the router's RTP capabilities the client needs to load its
   * mediasoup-client `Device`. Always the first sfu:* call a client makes.
   */
  async getRtpCapabilities(callId, socketId, userId) {
    const call = await this._getOrCreateCall(callId);
    if (!call.peers.has(socketId)) {
      call.peers.set(socketId, new Peer(socketId, userId));
    }
    return call.router.rtpCapabilities;
  }

  /**
   * Creates one WebRtcTransport for this peer. `direction` is 'send' or
   * 'recv' — callers create exactly one of each, never more (mediasoup
   * multiplexes all producers/consumers of a given direction over that
   * single transport).
   */
  async createTransport(callId, socketId, direction) {
    const { call, peer } = this._getPeer(callId, socketId);

    const transport = await call.router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: env.mediasoup.announcedIp }],
      appData: { direction },
      ...TRANSPORT_OPTIONS,
    });
    peer.transports.set(transport.id, transport);

    transport.on('dtlsstatechange', (state) => {
      if (state === 'closed' || state === 'failed') {
        logger.warn({ callId, socketId, transportId: transport.id, state }, 'SFU transport DTLS state degraded');
      }
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      direction,
    };
  }

  async connectTransport(callId, socketId, transportId, dtlsParameters) {
    const { peer } = this._getPeer(callId, socketId);
    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error(`Unknown transport ${transportId}`);
    await transport.connect({ dtlsParameters });
  }

  /**
   * Starts producing a track (mic, cam, or screen-share) on the peer's
   * send transport. Returns the new producerId; the caller (sfuEvents.js)
   * is responsible for notifying the rest of the call via `sfu:new-producer`.
   */
  async produce(callId, socketId, transportId, kind, rtpParameters, appData) {
    const { peer } = this._getPeer(callId, socketId);
    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error(`Unknown transport ${transportId}`);

    const producer = await transport.produce({ kind, rtpParameters, appData });
    peer.producers.set(producer.id, producer);
    producer.on('transportclose', () => peer.producers.delete(producer.id));

    return producer.id;
  }

  /**
   * Starts consuming a remote peer's producer on this peer's recv
   * transport. Consumers are created paused (mediasoup convention) — the
   * client must call resumeConsumer once it's actually ready to render,
   * otherwise packets get sent into a receiver that hasn't set up its
   * decoder yet.
   */
  async consume(callId, socketId, producerId, rtpCapabilities) {
    const { call, peer } = this._getPeer(callId, socketId);

    if (!call.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error(`Peer cannot consume producer ${producerId} (incompatible rtpCapabilities)`);
    }

    const recvTransport = [...peer.transports.values()].find((t) => t.appData?.direction === 'recv');
    if (!recvTransport) throw new Error('No recv transport for peer — call sfu:create-transport(direction=recv) first');

    const consumer = await recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });
    peer.consumers.set(consumer.id, consumer);
    consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
    consumer.on('producerclose', () => peer.consumers.delete(consumer.id));

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  async resumeConsumer(callId, socketId, consumerId) {
    const { peer } = this._getPeer(callId, socketId);
    const consumer = peer.consumers.get(consumerId);
    if (!consumer) throw new Error(`Unknown consumer ${consumerId}`);
    await consumer.resume();
  }

  /** Returns this peer's own producer ids — used to announce which producers vanish when they leave. */
  listOwnProducerIds(callId, socketId) {
    const call = this.calls.get(callId);
    const peer = call?.peers.get(socketId);
    if (!peer) return [];
    return [...peer.producers.keys()];
  }

  /** Returns every other peer's producer ids in the call, for a newly-joined peer to consume. */
  listOtherProducers(callId, socketId) {
    const call = this.calls.get(callId);
    if (!call) return [];
    const result = [];
    for (const peer of call.peers.values()) {
      if (peer.socketId === socketId) continue;
      for (const producer of peer.producers.values()) {
        result.push({ producerId: producer.id, socketId: peer.socketId, userId: peer.userId, kind: producer.kind });
      }
    }
    return result;
  }

  /**
   * Tears down everything this peer owns (transports close their
   * producers/consumers automatically) and removes them from the call.
   * Closes the call's Router entirely once the last peer leaves, freeing
   * the worker capacity it was holding.
   */
  removePeer(callId, socketId) {
    const call = this.calls.get(callId);
    if (!call) return;
    const peer = call.peers.get(socketId);
    if (!peer) return;

    for (const transport of peer.transports.values()) transport.close();
    call.peers.delete(socketId);

    if (call.peers.size === 0) {
      call.router.close();
      this.calls.delete(callId);
      logger.info({ callId }, 'Closed mediasoup router — last peer left');
    }
  }
}

module.exports = new SfuService();

/*
⚡ IMPROVEMENT SUGGESTIONS FOR SFU SERVICE:
1. Track per-consumer/producer bandwidth stats (producer.getStats()/consumer.getStats()) and feed them into
   connection_metrics, replacing the P2P getStats() shape the current schema assumes.
2. Add simulcast (multiple encodings per video producer) so consumers on poor connections can be switched to a
   lower-resolution layer server-side instead of receiving full quality and dropping frames client-side.
3. Horizontal scaling: once a single host's Worker capacity is the bottleneck, route new calls to whichever
   backend instance/worker has spare capacity via a shared Redis-backed call->worker assignment, and use
   mediasoup PipeTransports to connect Routers across processes for calls that need to span hosts.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: High
IMPACT: High
*/