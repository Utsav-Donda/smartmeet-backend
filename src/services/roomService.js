'use strict';

const bcrypt = require('bcryptjs');
const { sequelize, Room, RoomParticipant, User, Message } = require('../models');
const { redisClient } = require('../config/redis');
const { ROOM_ROLES, ROOM_ACCESS_TYPES, CACHE_KEYS, CACHE_TTL_SECONDS } = require('../config/constants');
const { NotFoundError, AuthError, ConflictError, ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger');

const SALT_ROUNDS = 10;

async function invalidateRoomListCache() {
  try {
    await redisClient.del(CACHE_KEYS.ROOM_LIST);
  } catch (err) {
    logger.warn({ err }, 'Failed to invalidate room list cache');
  }
}

async function invalidateRoomDetailCache(roomId) {
  try {
    await redisClient.del(CACHE_KEYS.ROOM_DETAIL(roomId));
  } catch (err) {
    logger.warn({ err }, 'Failed to invalidate room detail cache');
  }
}

async function createRoom({ name, accessType, password, maxParticipants, hostId }) {
  let passwordHash = null;
  if (accessType === ROOM_ACCESS_TYPES.PASSWORD) {
    passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  }

  // Wrapped in a transaction so a crash/error between the two inserts can
  // never leave a hostless room (the room row committed but its host's
  // RoomParticipant row missing).
  const room = await sequelize.transaction(async (transaction) => {
    const createdRoom = await Room.create(
      { name, accessType, passwordHash, maxParticipants, hostId },
      { transaction }
    );

    await RoomParticipant.create(
      { roomId: createdRoom.id, userId: hostId, role: ROOM_ROLES.HOST },
      { transaction }
    );

    return createdRoom;
  });

  await invalidateRoomListCache();

  return room;
}

/**
 * Lists active rooms, caching the serialized result in Redis for a short
 * TTL to absorb read-heavy traffic (room lobby polling) without hammering
 * PostgreSQL. Cache is explicitly invalidated on create/join/leave so
 * staleness is bounded by CACHE_TTL_SECONDS.ROOM_LIST at worst.
 */
async function listRooms({ page = 1, limit = 20 } = {}) {
  const cacheKey = `${CACHE_KEYS.ROOM_LIST}:${page}:${limit}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.warn({ err }, 'Redis read failed for room list, falling back to DB');
  }

  const offset = (page - 1) * limit;
  const { rows, count } = await Room.findAndCountAll({
    where: { isActive: true },
    include: [{ model: User, as: 'host', attributes: ['id', 'username'] }],
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });

  const result = {
    rooms: rows.map((room) => ({ ...room.toPublicJSON(), host: room.host ? { id: room.host.id, username: room.host.username } : null })),
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
  };

  try {
    await redisClient.setEx(cacheKey, CACHE_TTL_SECONDS.ROOM_LIST, JSON.stringify(result));
  } catch (err) {
    logger.warn({ err }, 'Redis write failed for room list cache');
  }

  return result;
}

async function getRoomById(roomId) {
  const room = await Room.findByPk(roomId, {
    include: [{ model: User, as: 'host', attributes: ['id', 'username'] }],
  });
  if (!room) {
    throw new NotFoundError('Room not found');
  }
  return room;
}

async function joinRoom({ roomId, userId, password }) {
  const room = await getRoomById(roomId);

  if (!room.isActive) {
    throw new ForbiddenError('This room has ended');
  }

  if (room.accessType === ROOM_ACCESS_TYPES.PASSWORD) {
    if (!password) {
      throw new AuthError('A password is required to join this room');
    }
    const matches = await bcrypt.compare(password, room.passwordHash);
    if (!matches) {
      throw new AuthError('Incorrect room password');
    }
  }

  const existing = await RoomParticipant.findOne({
    where: { roomId, userId, leftAt: null },
  });
  if (existing) {
    return existing;
  }

  // The "count active participants, then insert if under capacity" check
  // is a classic TOCTOU race: two joins arriving within the same
  // millisecond can both read a count of maxParticipants - 1 and both
  // insert, overshooting capacity. Locking the room row for the duration
  // of the transaction (SELECT ... FOR UPDATE) serializes concurrent
  // joiners of the *same* room against each other without contending with
  // joins to other rooms.
  const participant = await sequelize.transaction(async (transaction) => {
    await Room.findByPk(roomId, { transaction, lock: transaction.LOCK.UPDATE });

    const activeCount = await RoomParticipant.count({ where: { roomId, leftAt: null }, transaction });
    if (activeCount >= room.maxParticipants) {
      throw new ConflictError('Room has reached its maximum number of participants');
    }

    const role = room.hostId === userId ? ROOM_ROLES.HOST : ROOM_ROLES.PARTICIPANT;

    return RoomParticipant.create({ roomId, userId, role }, { transaction });
  });

  await invalidateRoomDetailCache(roomId);

  return participant;
}

async function leaveRoom({ roomId, userId }) {
  const participant = await RoomParticipant.findOne({
    where: { roomId, userId, leftAt: null },
  });

  if (!participant) {
    throw new NotFoundError('Active room participation not found');
  }

  participant.leftAt = new Date();
  await participant.save();

  await invalidateRoomDetailCache(roomId);

  return participant;
}

/**
 * Applies a mute/camera-state change reported by a client over
 * `room:participant-presence` to that participant's active RoomParticipant
 * row, so REST reads (GET /api/rooms/:roomId/participants) stay consistent
 * with what was last broadcast over the socket. Only the fields actually
 * provided are updated.
 */
async function updateParticipantPresence({ roomId, userId, isMuted, isCameraOn }) {
  const participant = await RoomParticipant.findOne({
    where: { roomId, userId, leftAt: null },
  });
  if (!participant) {
    throw new NotFoundError('Active room participation not found');
  }

  if (isMuted !== undefined) participant.isMuted = isMuted;
  if (isCameraOn !== undefined) participant.isCameraOn = isCameraOn;
  await participant.save();

  return participant;
}

async function getParticipants(roomId) {
  await getRoomById(roomId); // ensures room exists / 404s otherwise

  return RoomParticipant.findAll({
    where: { roomId, leftAt: null },
    include: [{ model: User, as: 'user', attributes: ['id', 'username', 'avatarUrl'] }],
    order: [['joinedAt', 'ASC']],
  });
}

/**
 * Returns the active RoomParticipant row for (roomId, userId), or null if
 * the user is not currently an active member of the room. Used to gate
 * privileged actions (host controls, chat, recordings access) — the room's
 * own hostId column is not sufficient on its own since moderators also
 * need elevated access.
 */
async function getActiveParticipant(roomId, userId) {
  return RoomParticipant.findOne({ where: { roomId, userId, leftAt: null } });
}

/**
 * True if the user has ever been a participant (active or past) in the
 * room — used to gate access to that room's recordings, which should
 * remain visible to former attendees after they leave.
 */
async function hasEverParticipated(roomId, userId) {
  const row = await RoomParticipant.findOne({ where: { roomId, userId } });
  return Boolean(row);
}

function assertCanModerate(actingParticipant) {
  if (!actingParticipant || ![ROOM_ROLES.HOST, ROOM_ROLES.MODERATOR].includes(actingParticipant.role)) {
    throw new ForbiddenError('Only the host or a moderator can do this');
  }
}

/**
 * Host/moderator-only: forces a target participant's mute state. Returns
 * the updated target participant row.
 */
async function hostSetParticipantMuted({ roomId, actingUserId, targetUserId, isMuted }) {
  const actingParticipant = await getActiveParticipant(roomId, actingUserId);
  assertCanModerate(actingParticipant);

  const target = await getActiveParticipant(roomId, targetUserId);
  if (!target) {
    throw new NotFoundError('That participant is no longer in the room');
  }

  target.isMuted = isMuted;
  await target.save();

  return target;
}

/**
 * Host-only: removes a target participant from the room (marks their row
 * left). Moderators cannot kick — only the room's host. Returns the
 * updated target participant row.
 */
async function hostKickParticipant({ roomId, actingUserId, targetUserId }) {
  const room = await getRoomById(roomId);
  if (room.hostId !== actingUserId) {
    throw new ForbiddenError('Only the host can remove a participant');
  }
  if (targetUserId === actingUserId) {
    throw new ForbiddenError('The host cannot kick themselves');
  }

  const target = await getActiveParticipant(roomId, targetUserId);
  if (!target) {
    throw new NotFoundError('That participant is no longer in the room');
  }

  target.leftAt = new Date();
  await target.save();

  await invalidateRoomDetailCache(roomId);

  return target;
}

/**
 * Returns the most recent chat messages for a room, oldest first, for
 * clients to backfill history when opening the chat panel. Caller is
 * responsible for checking the requester is/was a participant.
 */
async function getMessages(roomId, { page = 1, limit = 50 } = {}) {
  const offset = (page - 1) * limit;
  const { rows, count } = await Message.findAndCountAll({
    where: { roomId },
    include: [{ model: User, as: 'user', attributes: ['id', 'username', 'avatarUrl'] }],
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });

  return {
    messages: rows.reverse(),
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
  };
}

module.exports = {
  createRoom,
  listRooms,
  getRoomById,
  joinRoom,
  leaveRoom,
  updateParticipantPresence,
  getParticipants,
  getActiveParticipant,
  hasEverParticipated,
  hostSetParticipantMuted,
  hostKickParticipant,
  getMessages,
  invalidateRoomListCache,
  invalidateRoomDetailCache,
};

/*
⚡ IMPROVEMENT SUGGESTIONS FOR ROOM SERVICE:
1. Cache individual room detail responses (GET /api/rooms/:roomId), not just the list, since it is likely the highest-traffic read during an active meeting.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Low
IMPACT: Medium
*/
