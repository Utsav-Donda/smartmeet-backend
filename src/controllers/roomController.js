'use strict';

const roomService = require('../services/roomService');
const { ForbiddenError } = require('../utils/errors');
const { broadcastParticipants } = require('../sockets/roomEvents');

/**
 * REST-driven join/leave don't go through the socket layer, so already-
 * connected clients wouldn't otherwise see the roster change until their
 * next unrelated socket event. Broadcasting here keeps both paths
 * consistent. `io` is only present once the socket server has finished
 * booting (see server.js's `app.set('io', io)`); best-effort no-op before that.
 */
async function broadcastRosterChange(req, roomId) {
  const io = req.app.get('io');
  if (!io) return;
  await broadcastParticipants(io, roomId).catch(() => null);
}

async function create(req, res, next) {
  try {
    const room = await roomService.createRoom({ ...req.body, hostId: req.user.id });
    res.status(201).json({ room: room.toPublicJSON() });
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const result = await roomService.listRooms(req.query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const room = await roomService.getRoomById(req.params.roomId);
    res.status(200).json({
      room: {
        ...room.toPublicJSON(),
        host: room.host ? { id: room.host.id, username: room.host.username } : null,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function join(req, res, next) {
  try {
    const participant = await roomService.joinRoom({
      roomId: req.params.roomId,
      userId: req.user.id,
      password: req.body.password,
    });
    await broadcastRosterChange(req, req.params.roomId);
    res.status(200).json({ participant });
  } catch (err) {
    next(err);
  }
}

async function leave(req, res, next) {
  try {
    const participant = await roomService.leaveRoom({
      roomId: req.params.roomId,
      userId: req.user.id,
    });
    await broadcastRosterChange(req, req.params.roomId);
    res.status(200).json({ participant });
  } catch (err) {
    next(err);
  }
}

async function participants(req, res, next) {
  try {
    const rows = await roomService.getParticipants(req.params.roomId);
    res.status(200).json({
      participants: rows.map((p) => ({
        id: p.id,
        roomId: p.roomId,
        userId: p.userId,
        role: p.role,
        joinedAt: p.joinedAt,
        isMuted: p.isMuted,
        isCameraOn: p.isCameraOn,
        connectionQuality: p.connectionQuality,
        user: p.user ? { id: p.user.id, username: p.user.username, avatarUrl: p.user.avatarUrl } : null,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function messages(req, res, next) {
  try {
    const hasParticipated = await roomService.hasEverParticipated(req.params.roomId, req.user.id);
    if (!hasParticipated) {
      throw new ForbiddenError('You must have joined this room to view its chat history');
    }

    const result = await roomService.getMessages(req.params.roomId, req.query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { create, list, getById, join, leave, participants, messages };

