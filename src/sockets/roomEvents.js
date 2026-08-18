'use strict';

const { SOCKET_EVENTS, DISCONNECT_REASONS, ALLOWED_REACTIONS } = require('../config/constants');
const roomService = require('../services/roomService');
const webrtcService = require('../services/webrtcService');
const { Message } = require('../models');
const { recordSocketEvent } = require('../utils/metrics');
const logger = require('../utils/logger');
const { socketRoomName } = require('./socketUtils');
const { cleanupSfuPeer } = require('./sfuEvents');

/**
 * Wraps event data in the standard envelope documented in sockets/index.js.
 */
function envelope(event, data) {
  return { event, data, timestamp: new Date().toISOString() };
}

// Simple fixed-window rate limiter, keyed by `${socketId}:${kind}` so chat
// and reactions each get their own independent budget. Not shared across
// processes (see webrtcService's improvement notes on horizontal scaling)
// but sufficient to stop a single misbehaving client from flooding a room
// within this process.
const CHAT_RATE_LIMIT_MAX = 8;
const CHAT_RATE_LIMIT_WINDOW_MS = 5000;
const REACTION_RATE_LIMIT_MAX = 15;
const REACTION_RATE_LIMIT_WINDOW_MS = 5000;
const rateLimitState = new Map(); // key -> { count, windowStart }

function isRateLimited(key, max, windowMs) {
  const now = Date.now();
  const state = rateLimitState.get(key);
  if (!state || now - state.windowStart >= windowMs) {
    rateLimitState.set(key, { count: 1, windowStart: now });
    return false;
  }
  state.count += 1;
  return state.count > max;
}

async function broadcastParticipants(io, roomId) {
  const participants = await roomService.getParticipants(roomId);
  const socketIdsByUserId = webrtcService.getSocketIdsByUserId(roomId);
  const payload = participants.map((p) => ({
    id: p.id,
    userId: p.userId,
    // The live socket id this participant is currently addressable at for
    // webrtc:offer/answer/ice-candidate — null if they have a DB row (e.g.
    // joined via REST) but haven't opened a socket connection yet. Clients
    // must not attempt signaling to a participant with a null socketId.
    socketId: socketIdsByUserId[p.userId] || null,
    role: p.role,
    isMuted: p.isMuted,
    isCameraOn: p.isCameraOn,
    connectionQuality: p.connectionQuality,
    username: p.user ? p.user.username : null,
  }));

  io.to(socketRoomName(roomId)).emit(
    SOCKET_EVENTS.ROOM_UPDATE_PARTICIPANTS,
    envelope(SOCKET_EVENTS.ROOM_UPDATE_PARTICIPANTS, { roomId, participants: payload })
  );
}

function registerRoomEvents(io, socket) {
  socket.on(SOCKET_EVENTS.ROOM_JOIN, async ({ roomId } = {}, ack) => {
    try {
      if (!roomId) throw new Error('roomId is required');

      await roomService.joinRoom({ roomId, userId: socket.user.id });
      await socket.join(socketRoomName(roomId));
      socket.data.roomId = roomId;

      await webrtcService.addPeerToRoom(roomId, socket.id, socket.user.id);
      recordSocketEvent('messagesReceived');

      socket.to(socketRoomName(roomId)).emit(
        SOCKET_EVENTS.ROOM_PARTICIPANT_PRESENCE,
        envelope(SOCKET_EVENTS.ROOM_PARTICIPANT_PRESENCE, {
          roomId,
          userId: socket.user.id,
          username: socket.user.username,
          status: 'joined',
          socketId: socket.id,
        })
      );

      await broadcastParticipants(io, roomId);

      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      logger.warn({ err, roomId }, 'room:join failed');
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on(SOCKET_EVENTS.ROOM_LEAVE, async ({ roomId } = {}, ack) => {
    try {
      const targetRoomId = roomId || socket.data.roomId;
      if (!targetRoomId) throw new Error('roomId is required');

      await roomService.leaveRoom({ roomId: targetRoomId, userId: socket.user.id });
      await webrtcService.removePeerFromRoom(targetRoomId, socket.id);
      cleanupSfuPeer(io, socket);
      await socket.leave(socketRoomName(targetRoomId));

      socket.to(socketRoomName(targetRoomId)).emit(
        SOCKET_EVENTS.ROOM_PARTICIPANT_PRESENCE,
        envelope(SOCKET_EVENTS.ROOM_PARTICIPANT_PRESENCE, {
          roomId: targetRoomId,
          userId: socket.user.id,
          username: socket.user.username,
          status: 'left',
          socketId: socket.id,
        })
      );

      await broadcastParticipants(io, targetRoomId);
      socket.data.roomId = null;

      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      logger.warn({ err, roomId }, 'room:leave failed');
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on(SOCKET_EVENTS.CHAT_MESSAGE, async ({ roomId, message } = {}) => {
    const targetRoomId = roomId || socket.data.roomId;
    if (!targetRoomId || !message) return;

    // The room a socket is actually joined to (socket.data.roomId, set only
    // by a successful room:join) is the source of truth for membership —
    // never trust a client-supplied roomId that doesn't match it, since
    // that would let any authenticated socket broadcast into a room it
    // never joined.
    if (socket.data.roomId !== targetRoomId) {
      logger.warn({ socketId: socket.id, targetRoomId }, 'Rejected chat:message from non-member socket');
      return;
    }

    if (isRateLimited(`${socket.id}:chat`, CHAT_RATE_LIMIT_MAX, CHAT_RATE_LIMIT_WINDOW_MS)) {
      logger.warn({ socketId: socket.id, targetRoomId }, 'chat:message rate limit exceeded');
      return;
    }

    recordSocketEvent('messagesReceived');

    const body = String(message).slice(0, 2000).trim();
    if (!body) return;

    let messageId;
    let createdAt;
    try {
      const saved = await Message.create({ roomId: targetRoomId, userId: socket.user.id, body });
      messageId = saved.id;
      createdAt = saved.createdAt;
    } catch (err) {
      logger.warn({ err, targetRoomId }, 'Failed to persist chat message; relaying without persistence');
      createdAt = new Date();
    }

    const outgoing = envelope(SOCKET_EVENTS.CHAT_MESSAGE, {
      id: messageId,
      roomId: targetRoomId,
      userId: socket.user.id,
      username: socket.user.username,
      message: body,
      createdAt,
    });

    io.to(socketRoomName(targetRoomId)).emit(SOCKET_EVENTS.CHAT_MESSAGE, outgoing);
    recordSocketEvent('messagesSent');
  });

  socket.on(SOCKET_EVENTS.ROOM_REACTION, ({ roomId, emoji } = {}) => {
    const targetRoomId = roomId || socket.data.roomId;
    if (!targetRoomId || !emoji) return;

    if (socket.data.roomId !== targetRoomId) {
      logger.warn({ socketId: socket.id, targetRoomId }, 'Rejected room:reaction from non-member socket');
      return;
    }

    if (!ALLOWED_REACTIONS.includes(emoji)) {
      logger.warn({ socketId: socket.id, emoji }, 'Rejected room:reaction with disallowed emoji');
      return;
    }

    if (isRateLimited(`${socket.id}:reaction`, REACTION_RATE_LIMIT_MAX, REACTION_RATE_LIMIT_WINDOW_MS)) {
      logger.warn({ socketId: socket.id, targetRoomId }, 'room:reaction rate limit exceeded');
      return;
    }

    recordSocketEvent('messagesReceived');

    io.to(socketRoomName(targetRoomId)).emit(
      SOCKET_EVENTS.ROOM_REACTION,
      envelope(SOCKET_EVENTS.ROOM_REACTION, {
        roomId: targetRoomId,
        userId: socket.user.id,
        username: socket.user.username,
        emoji,
      })
    );
    recordSocketEvent('messagesSent');
  });

  socket.on(SOCKET_EVENTS.ROOM_HOST_MUTE_PARTICIPANT, async ({ roomId, targetUserId } = {}, ack) => {
    try {
      const targetRoomId = roomId || socket.data.roomId;
      if (!targetRoomId || !targetUserId) throw new Error('roomId and targetUserId are required');

      const target = await roomService.hostSetParticipantMuted({
        roomId: targetRoomId,
        actingUserId: socket.user.id,
        targetUserId,
        isMuted: true,
      });

      const socketIdsByUserId = webrtcService.getSocketIdsByUserId(targetRoomId);
      const targetSocketId = socketIdsByUserId[targetUserId];
      if (targetSocketId) {
        io.to(targetSocketId).emit(
          SOCKET_EVENTS.ROOM_FORCE_MUTED,
          envelope(SOCKET_EVENTS.ROOM_FORCE_MUTED, {
            roomId: targetRoomId,
            byUserId: socket.user.id,
            byUsername: socket.user.username,
          })
        );
      }

      await broadcastParticipants(io, targetRoomId);
      if (typeof ack === 'function') ack({ ok: true, participant: target });
    } catch (err) {
      logger.warn({ err, roomId }, 'room:host-mute-participant failed');
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on(SOCKET_EVENTS.ROOM_HOST_KICK_PARTICIPANT, async ({ roomId, targetUserId } = {}, ack) => {
    try {
      const targetRoomId = roomId || socket.data.roomId;
      if (!targetRoomId || !targetUserId) throw new Error('roomId and targetUserId are required');

      await roomService.hostKickParticipant({
        roomId: targetRoomId,
        actingUserId: socket.user.id,
        targetUserId,
      });

      const socketIdsByUserId = webrtcService.getSocketIdsByUserId(targetRoomId);
      const targetSocketId = socketIdsByUserId[targetUserId];
      const targetSocket = targetSocketId ? io.sockets.sockets.get(targetSocketId) : null;

      if (targetSocket) {
        targetSocket.emit(
          SOCKET_EVENTS.ROOM_KICKED,
          envelope(SOCKET_EVENTS.ROOM_KICKED, {
            roomId: targetRoomId,
            reason: DISCONNECT_REASONS.KICKED,
            byUserId: socket.user.id,
            byUsername: socket.user.username,
          })
        );
        await webrtcService.removePeerFromRoom(targetRoomId, targetSocketId);
        await targetSocket.leave(socketRoomName(targetRoomId));
        targetSocket.data.roomId = null;
      }

      socket.to(socketRoomName(targetRoomId)).emit(
        SOCKET_EVENTS.ROOM_PARTICIPANT_PRESENCE,
        envelope(SOCKET_EVENTS.ROOM_PARTICIPANT_PRESENCE, {
          roomId: targetRoomId,
          userId: targetUserId,
          status: 'kicked',
        })
      );

      await broadcastParticipants(io, targetRoomId);
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      logger.warn({ err, roomId }, 'room:host-kick-participant failed');
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });
}

function clearRateLimitState(socketId) {
  rateLimitState.delete(`${socketId}:chat`);
  rateLimitState.delete(`${socketId}:reaction`);
}

module.exports = { registerRoomEvents, broadcastParticipants, socketRoomName, envelope, clearRateLimitState };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR ROOM SOCKET EVENTS:
1. Move the chat rate limiter to Redis (INCR + EXPIRE) once horizontally scaled, since the current in-memory Map is per-process and a client could evade it by reconnecting to a different instance.
PRIORITY: Low
IMPLEMENTATION_EFFORT: Low
IMPACT: Low
*/
