'use strict';

const { SOCKET_EVENTS, CONNECTION_QUALITY } = require('../config/constants');
const webrtcService = require('../services/webrtcService');
const analyticsService = require('../services/analyticsService');
const { recordSocketEvent } = require('../utils/metrics');
const logger = require('../utils/logger');

function envelope(event, data) {
  return { event, data, timestamp: new Date().toISOString() };
}

/**
 * Pure signaling relay: the server never inspects/modifies SDP or ICE
 * payloads, it only routes them to the intended peer(s) by socket id or
 * broadcasts to the room. Media negotiation and DTLS-SRTP happen
 * peer-to-peer (or via TURN) once signaling completes.
 */
/**
 * True only if both the sender and the intended recipient are currently
 * tracked as live peers of `roomId`. Without this check, any authenticated
 * socket could address an SDP offer/answer or ICE candidate at an
 * arbitrary socket id anywhere on the server (not just fellow room
 * members), since `io.to(toSocketId)` on its own has no notion of rooms.
 */
function canRelayWithinRoom(roomId, socket, toSocketId) {
  const peers = webrtcService.getPeersInRoom(roomId);
  return peers.includes(socket.id) && peers.includes(toSocketId);
}

function registerSignalingEvents(io, socket) {
  socket.on(SOCKET_EVENTS.WEBRTC_OFFER, ({ roomId, toSocketId, sdp } = {}) => {
    if (!roomId || !toSocketId || !sdp) return;
    if (!canRelayWithinRoom(roomId, socket, toSocketId)) {
      logger.warn({ socketId: socket.id, roomId, toSocketId }, 'Rejected webrtc:offer to non-room-member');
      return;
    }
    recordSocketEvent('messagesReceived');

    io.to(toSocketId).emit(
      SOCKET_EVENTS.WEBRTC_OFFER,
      envelope(SOCKET_EVENTS.WEBRTC_OFFER, {
        roomId,
        fromSocketId: socket.id,
        fromUserId: socket.user.id,
        sdp,
      })
    );
    recordSocketEvent('messagesSent');
  });

  socket.on(SOCKET_EVENTS.WEBRTC_ANSWER, ({ roomId, toSocketId, sdp } = {}) => {
    if (!roomId || !toSocketId || !sdp) return;
    if (!canRelayWithinRoom(roomId, socket, toSocketId)) {
      logger.warn({ socketId: socket.id, roomId, toSocketId }, 'Rejected webrtc:answer to non-room-member');
      return;
    }
    recordSocketEvent('messagesReceived');

    io.to(toSocketId).emit(
      SOCKET_EVENTS.WEBRTC_ANSWER,
      envelope(SOCKET_EVENTS.WEBRTC_ANSWER, {
        roomId,
        fromSocketId: socket.id,
        fromUserId: socket.user.id,
        sdp,
      })
    );
    recordSocketEvent('messagesSent');
  });

  socket.on(SOCKET_EVENTS.WEBRTC_ICE_CANDIDATE, ({ roomId, toSocketId, candidate } = {}) => {
    if (!roomId || !toSocketId || !candidate) return;
    if (!canRelayWithinRoom(roomId, socket, toSocketId)) {
      logger.warn({ socketId: socket.id, roomId, toSocketId }, 'Rejected webrtc:ice-candidate to non-room-member');
      return;
    }
    recordSocketEvent('messagesReceived');

    io.to(toSocketId).emit(
      SOCKET_EVENTS.WEBRTC_ICE_CANDIDATE,
      envelope(SOCKET_EVENTS.WEBRTC_ICE_CANDIDATE, {
        roomId,
        fromSocketId: socket.id,
        fromUserId: socket.user.id,
        candidate,
      })
    );
    recordSocketEvent('messagesSent');
  });

  socket.on(SOCKET_EVENTS.WEBRTC_CONNECTION_QUALITY, async (payload = {}) => {
    try {
      const { roomId, bandwidthIn = 0, bandwidthOut = 0, latency = 0, packetLoss = 0 } = payload;
      if (!roomId) return;
      recordSocketEvent('messagesReceived');

      const quality = classifyQuality(latency, packetLoss);
      await webrtcService.recordConnectionQuality(roomId, socket.id, quality);

      // Fire-and-forget persistence; do not block the socket handler on DB latency.
      analyticsService
        .recordConnectionMetric({
          roomId,
          participantId: socket.user.id,
          bandwidthIn,
          bandwidthOut,
          latency,
          packetLoss,
        })
        .catch((err) => logger.warn({ err }, 'Failed to persist connection metric'));

      socket.to(`room:${roomId}`).emit(
        SOCKET_EVENTS.WEBRTC_CONNECTION_QUALITY,
        envelope(SOCKET_EVENTS.WEBRTC_CONNECTION_QUALITY, {
          roomId,
          userId: socket.user.id,
          socketId: socket.id,
          quality,
          latency,
          packetLoss,
        })
      );
      recordSocketEvent('messagesSent');
    } catch (err) {
      logger.warn({ err }, 'webrtc:connection-quality handling failed');
    }
  });
}

function classifyQuality(latency, packetLoss) {
  if (latency < 100 && packetLoss < 1) return CONNECTION_QUALITY.EXCELLENT;
  if (latency < 250 && packetLoss < 3) return CONNECTION_QUALITY.GOOD;
  if (latency < 500 && packetLoss < 8) return CONNECTION_QUALITY.FAIR;
  return CONNECTION_QUALITY.POOR;
}

module.exports = { registerSignalingEvents, classifyQuality };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR SIGNALING EVENTS:
1. Validate SDP/candidate payload shape (not just presence) with a lightweight schema check to reject malformed signaling messages before relaying them.
2. Provide clients with TURN server credentials (short-lived, HMAC-signed) at room:join time so connection-quality classification reflects real relayed-path conditions, not just self-reported numbers.
PRIORITY: High
IMPLEMENTATION_EFFORT: Medium
IMPACT: High
*/
