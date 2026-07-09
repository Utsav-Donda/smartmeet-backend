'use strict';

const { SOCKET_EVENTS, DISCONNECT_REASONS } = require('../config/constants');
const roomService = require('../services/roomService');
const webrtcService = require('../services/webrtcService');
const { broadcastParticipants, socketRoomName, clearRateLimitState } = require('./roomEvents');
const { recordSocketEvent } = require('../utils/metrics');
const logger = require('../utils/logger');

function envelope(event, data) {
  return { event, data, timestamp: new Date().toISOString() };
}

function mapDisconnectReason(reason) {
  switch (reason) {
    case 'client namespace disconnect':
      return DISCONNECT_REASONS.CLIENT_LEFT;
    case 'server namespace disconnect':
      return DISCONNECT_REASONS.SERVER_SHUTDOWN;
    case 'ping timeout':
    case 'transport close':
    case 'transport error':
      return DISCONNECT_REASONS.TRANSPORT_CLOSE;
    default:
      return DISCONNECT_REASONS.TRANSPORT_CLOSE;
  }
}

/**
 * Handles connection lifecycle bookkeeping: cleans up room membership when
 * a socket disconnects unexpectedly (network drop, tab close) and notifies
 * remaining participants, plus emits a `system:reconnect-required` hint
 * clients can use to trigger their own reconnect/backoff logic.
 */
function registerPresenceEvents(io, socket) {
  // Inbound: a client reporting its own mute/camera/speaking/raised-hand
  // state changed (see flutter_app's SocketService.sendPresenceUpdate).
  // Persists the durable fields (isMuted/isCameraOn) and relays the full
  // update — including the ephemeral isSpeaking/isHandRaised flags, which
  // are not persisted — to the rest of the room so their participant tiles
  // update live.
  socket.on(
    SOCKET_EVENTS.ROOM_PARTICIPANT_PRESENCE,
    async ({ roomId, isMuted, isCameraOn, isSpeaking, isHandRaised } = {}) => {
      const targetRoomId = roomId || socket.data.roomId;
      if (!targetRoomId) return;

      try {
        recordSocketEvent('messagesReceived');

        if (isMuted !== undefined || isCameraOn !== undefined) {
          await roomService.updateParticipantPresence({
            roomId: targetRoomId,
            userId: socket.user.id,
            isMuted,
            isCameraOn,
          });
        }

        socket.to(socketRoomName(targetRoomId)).emit(
          SOCKET_EVENTS.ROOM_PARTICIPANT_PRESENCE,
          envelope(SOCKET_EVENTS.ROOM_PARTICIPANT_PRESENCE, {
            roomId: targetRoomId,
            userId: socket.user.id,
            username: socket.user.username,
            status: 'updated',
            isMuted,
            isCameraOn,
            isSpeaking,
            isHandRaised,
            socketId: socket.id,
          })
        );
        recordSocketEvent('messagesSent');
      } catch (err) {
        logger.warn({ err, roomId: targetRoomId }, 'room:participant-presence update failed');
      }
    }
  );

  socket.on('disconnect', async (reason) => {
    recordSocketEvent('disconnections');
    clearRateLimitState(socket.id);
    const roomId = socket.data.roomId;
    const mappedReason = mapDisconnectReason(reason);

    socket.emit(
      SOCKET_EVENTS.ERROR_DISCONNECT_REASON,
      envelope(SOCKET_EVENTS.ERROR_DISCONNECT_REASON, { reason: mappedReason })
    );

    if (!roomId) return;

    try {
      await webrtcService.removePeerFromRoom(roomId, socket.id);
      await roomService.leaveRoom({ roomId, userId: socket.user.id }).catch(() => null);

      io.to(socketRoomName(roomId)).emit(
        SOCKET_EVENTS.ROOM_PARTICIPANT_PRESENCE,
        envelope(SOCKET_EVENTS.ROOM_PARTICIPANT_PRESENCE, {
          roomId,
          userId: socket.user.id,
          username: socket.user.username,
          status: 'disconnected',
          reason: mappedReason,
          socketId: socket.id,
        })
      );

      await broadcastParticipants(io, roomId);

      if (mappedReason === DISCONNECT_REASONS.TRANSPORT_CLOSE) {
        io.to(socketRoomName(roomId)).emit(
          SOCKET_EVENTS.SYSTEM_RECONNECT_REQUIRED,
          envelope(SOCKET_EVENTS.SYSTEM_RECONNECT_REQUIRED, {
            roomId,
            affectedUserId: socket.user.id,
            message: 'A participant lost connection unexpectedly; peers should refresh their peer connections.',
          })
        );
      }
    } catch (err) {
      logger.warn({ err, roomId }, 'Error during presence disconnect cleanup');
    }
  });
}

module.exports = { registerPresenceEvents, mapDisconnectReason };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR PRESENCE EVENTS:
1. Debounce/delay the leave-room cleanup by a few seconds on transport_close so a brief network blip (mobile network handoff) doesn't immediately evict a participant who is about to reconnect.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Medium
IMPACT: Medium
*/
