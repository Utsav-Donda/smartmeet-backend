'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('../utils/logger');
const { recordSocketEvent } = require('../utils/metrics');
const { registerRoomEvents } = require('./roomEvents');
const { registerSignalingEvents } = require('./signalingEvents');
const { registerPresenceEvents } = require('./presenceEvents');
const { registerSfuEvents } = require('./sfuEvents');

/*
 * SmartMeet socket event payload convention
 * ------------------------------------------
 * Every server -> client event emitted by this codebase uses the envelope:
 *
 *   { event: '<event-name>', data: { ... }, timestamp: '<ISO-8601>' }
 *
 * `event` mirrors the Socket.io event name (redundant but convenient for
 * clients that log/inspect payloads generically), `data` carries the
 * event-specific fields, and `timestamp` is server time at emit. Client ->
 * server events are plain objects (no envelope required) since Socket.io
 * already carries the event name out-of-band; the server always wraps its
 * responses / broadcasts in the envelope above for consistency.
 */

function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  // Authenticate every connecting socket via a JWT access token passed as
  // `auth.token` (preferred) or a `token` query param (fallback for
  // clients that can't set handshake auth).
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        return next(new Error('Authentication token missing'));
      }
      const payload = jwt.verify(token, env.jwt.secret);
      socket.user = { id: payload.sub, email: payload.email, username: payload.username };
      socket.data = socket.data || {};
      return next();
    } catch (_err) {
      return next(new Error('Invalid or expired authentication token'));
    }
  });

  io.on('connection', (socket) => {
    recordSocketEvent('connections');
    logger.info({ socketId: socket.id, userId: socket.user.id }, 'Socket connected');

    registerRoomEvents(io, socket);
    registerSignalingEvents(io, socket);
    registerPresenceEvents(io, socket);
    registerSfuEvents(io, socket);
  });

  return io;
}

module.exports = { initSocketServer };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR SOCKET.IO SERVER SETUP:
1. Wire up @socket.io/redis-adapter using the existing redis client so Socket.io broadcasts (io.to(room).emit) work correctly across multiple horizontally-scaled server instances instead of only within one process.
2. Restrict CORS origin to a configured allowlist instead of '*' before production deployment, matching the Express CORS policy in app.js.
3. Add a heartbeat-based idle-room reaper that ends rooms with zero connected sockets for N minutes to free up DB/cache state.
PRIORITY: High
IMPLEMENTATION_EFFORT: Medium
IMPACT: High
*/
