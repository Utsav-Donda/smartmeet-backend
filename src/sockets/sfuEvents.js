'use strict';

const { SOCKET_EVENTS } = require('../config/constants');
const sfuService = require('../services/sfuService');
const { socketRoomName } = require('./socketUtils');
const { recordSocketEvent } = require('../utils/metrics');
const logger = require('../utils/logger');

function envelope(event, data) {
  return { event, data, timestamp: new Date().toISOString() };
}

/**
 * `callId` is deliberately opaque and derived from room membership, not
 * passed by the client — a socket can only ever act as an SFU peer in the
 * room it actually joined (`socket.data.roomId`, set by room:join in
 * roomEvents.js), same membership rule signalingEvents.js's mesh path
 * enforces. Prefixed so this can grow to `channel:<id>` for the
 * servers/channels work in docs/ROADMAP.md's Phase 3 without changing
 * this file at all.
 */
function callIdFor(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return null;
  return `room:${roomId}`;
}

/**
 * mediasoup signaling, replacing webrtc:offer/answer/ice-candidate for
 * rooms on the SFU path. Every handler acks its result (or an error)
 * directly to the caller rather than broadcasting, since this is a
 * request/response protocol (transport/producer/consumer setup), not the
 * fire-and-forget relay signalingEvents.js does for mesh.
 */
function registerSfuEvents(io, socket) {
  socket.on(SOCKET_EVENTS.SFU_GET_RTP_CAPABILITIES, async (_payload, ack) => {
    try {
      const callId = callIdFor(socket);
      if (!callId) throw new Error('Join a room before starting SFU signaling');
      recordSocketEvent('messagesReceived');

      const rtpCapabilities = await sfuService.getRtpCapabilities(callId, socket.id, socket.user.id);
      const otherProducers = sfuService.listOtherProducers(callId, socket.id);

      if (typeof ack === 'function') ack({ ok: true, rtpCapabilities, otherProducers });
      recordSocketEvent('messagesSent');
    } catch (err) {
      logger.warn({ err, socketId: socket.id }, 'sfu:get-rtp-capabilities failed');
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on(SOCKET_EVENTS.SFU_CREATE_TRANSPORT, async ({ direction } = {}, ack) => {
    try {
      const callId = callIdFor(socket);
      if (!callId) throw new Error('Join a room before starting SFU signaling');
      if (direction !== 'send' && direction !== 'recv') throw new Error('direction must be "send" or "recv"');
      recordSocketEvent('messagesReceived');

      const transportParams = await sfuService.createTransport(callId, socket.id, direction);

      if (typeof ack === 'function') ack({ ok: true, transport: transportParams });
      recordSocketEvent('messagesSent');
    } catch (err) {
      logger.warn({ err, socketId: socket.id }, 'sfu:create-transport failed');
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on(SOCKET_EVENTS.SFU_CONNECT_TRANSPORT, async ({ transportId, dtlsParameters } = {}, ack) => {
    try {
      const callId = callIdFor(socket);
      if (!callId || !transportId || !dtlsParameters) throw new Error('transportId and dtlsParameters are required');
      recordSocketEvent('messagesReceived');

      await sfuService.connectTransport(callId, socket.id, transportId, dtlsParameters);

      if (typeof ack === 'function') ack({ ok: true });
      recordSocketEvent('messagesSent');
    } catch (err) {
      logger.warn({ err, socketId: socket.id }, 'sfu:connect-transport failed');
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on(SOCKET_EVENTS.SFU_PRODUCE, async ({ transportId, kind, rtpParameters, appData } = {}, ack) => {
    try {
      const callId = callIdFor(socket);
      if (!callId || !transportId || !kind || !rtpParameters) {
        throw new Error('transportId, kind, and rtpParameters are required');
      }
      recordSocketEvent('messagesReceived');

      const producerId = await sfuService.produce(callId, socket.id, transportId, kind, rtpParameters, appData);

      if (typeof ack === 'function') ack({ ok: true, producerId });

      // Every other peer already in the call needs to know a new track is
      // available so they can sfu:consume it — mirrors the mesh path's
      // "existing member offers to newcomer" broadcast, but inverted: here
      // the *newcomer's track* is announced to existing members, who each
      // individually pull it via sfu:consume rather than the producer
      // pushing an offer to each of them.
      socket.to(socketRoomName(socket.data.roomId)).emit(
        SOCKET_EVENTS.SFU_NEW_PRODUCER,
        envelope(SOCKET_EVENTS.SFU_NEW_PRODUCER, {
          producerId,
          socketId: socket.id,
          userId: socket.user.id,
          kind,
        })
      );
      recordSocketEvent('messagesSent');
    } catch (err) {
      logger.warn({ err, socketId: socket.id }, 'sfu:produce failed');
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on(SOCKET_EVENTS.SFU_CONSUME, async ({ producerId, rtpCapabilities } = {}, ack) => {
    try {
      const callId = callIdFor(socket);
      if (!callId || !producerId || !rtpCapabilities) throw new Error('producerId and rtpCapabilities are required');
      recordSocketEvent('messagesReceived');

      const consumerParams = await sfuService.consume(callId, socket.id, producerId, rtpCapabilities);

      if (typeof ack === 'function') ack({ ok: true, consumer: consumerParams });
      recordSocketEvent('messagesSent');
    } catch (err) {
      logger.warn({ err, socketId: socket.id }, 'sfu:consume failed');
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on(SOCKET_EVENTS.SFU_RESUME_CONSUMER, async ({ consumerId } = {}, ack) => {
    try {
      const callId = callIdFor(socket);
      if (!callId || !consumerId) throw new Error('consumerId is required');
      recordSocketEvent('messagesReceived');

      await sfuService.resumeConsumer(callId, socket.id, consumerId);

      if (typeof ack === 'function') ack({ ok: true });
      recordSocketEvent('messagesSent');
    } catch (err) {
      logger.warn({ err, socketId: socket.id }, 'sfu:resume-consumer failed');
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });
}

/**
 * Called from presenceEvents.js's disconnect handler (and room:leave) so
 * SFU transports/producers/consumers don't leak past the socket that owned
 * them. Notifies remaining call members which producers just vanished so
 * their tiles can drop the corresponding consumer/track — the SFU
 * equivalent of mesh's webrtcService.removePeer cleanup.
 */
function cleanupSfuPeer(io, socket) {
  const callId = callIdFor(socket);
  if (!callId) return;

  const producerIds = sfuService.listOwnProducerIds(callId, socket.id);
  sfuService.removePeer(callId, socket.id);

  for (const producerId of producerIds) {
    socket.to(socketRoomName(socket.data.roomId)).emit(
      SOCKET_EVENTS.SFU_PRODUCER_CLOSED,
      envelope(SOCKET_EVENTS.SFU_PRODUCER_CLOSED, { producerId, socketId: socket.id })
    );
  }
}

module.exports = { registerSfuEvents, cleanupSfuPeer };