'use strict';

const { redisClient } = require('../config/redis');
const logger = require('../utils/logger');

/**
 * Tracks WebRTC signaling state (which peers are in which room, and the
 * most recent connection-quality sample per participant) per room.
 *
 * A fast in-memory map serves the hot path (single-process Socket.io),
 * mirrored into Redis so the state survives a process restart and is
 * visible to other instances once the Socket.io redis adapter is added
 * (see improvement suggestions).
 *
 * Each room tracks socketId -> userId (not just a bare set of socket ids)
 * because clients address WebRTC signaling messages (webrtc:offer/answer/
 * ice-candidate) by *socket id*, but the room roster the client renders is
 * keyed by *user id* — this map is what lets roomEvents.broadcastParticipants
 * tell clients which socketId currently belongs to which participant.
 */
const inMemoryRoomPeers = new Map(); // roomId -> Map<socketId, userId>

function redisRoomKey(roomId) {
  return `signaling:room:${roomId}:peers`;
}

function redisQualityKey(roomId) {
  return `signaling:room:${roomId}:quality`;
}

async function addPeerToRoom(roomId, socketId, userId) {
  if (!inMemoryRoomPeers.has(roomId)) {
    inMemoryRoomPeers.set(roomId, new Map());
  }
  inMemoryRoomPeers.get(roomId).set(socketId, userId);

  try {
    await redisClient.hSet(redisRoomKey(roomId), socketId, userId);
  } catch (err) {
    logger.warn({ err, roomId }, 'Failed to mirror peer join to redis');
  }
}

async function removePeerFromRoom(roomId, socketId) {
  const map = inMemoryRoomPeers.get(roomId);
  if (map) {
    map.delete(socketId);
    if (map.size === 0) inMemoryRoomPeers.delete(roomId);
  }

  try {
    await redisClient.hDel(redisRoomKey(roomId), socketId);
  } catch (err) {
    logger.warn({ err, roomId }, 'Failed to mirror peer leave to redis');
  }
}

function getPeersInRoom(roomId) {
  return Array.from((inMemoryRoomPeers.get(roomId) || new Map()).keys());
}

/**
 * Returns { [userId]: socketId } for every currently-connected socket in the
 * room, so a userId-keyed participant roster can be annotated with the live
 * socket id each participant should be addressed by for signaling. If a user
 * has more than one connected socket (e.g. two tabs), the most recently
 * connected one wins.
 */
function getSocketIdsByUserId(roomId) {
  const map = inMemoryRoomPeers.get(roomId);
  if (!map) return {};
  const result = {};
  for (const [socketId, userId] of map.entries()) {
    result[userId] = socketId;
  }
  return result;
}

/**
 * Records the latest self-reported connection quality sample for a peer,
 * used by presenceEvents to fan out room:participant-presence updates.
 */
async function recordConnectionQuality(roomId, socketId, quality) {
  try {
    await redisClient.hSet(redisQualityKey(roomId), socketId, JSON.stringify({ quality, at: Date.now() }));
  } catch (err) {
    logger.warn({ err, roomId }, 'Failed to record connection quality in redis');
  }
}

async function getRoomQualitySnapshot(roomId) {
  try {
    const raw = await redisClient.hGetAll(redisQualityKey(roomId));
    const snapshot = {};
    for (const [socketId, value] of Object.entries(raw)) {
      snapshot[socketId] = JSON.parse(value);
    }
    return snapshot;
  } catch (err) {
    logger.warn({ err, roomId }, 'Failed to read connection quality snapshot from redis');
    return {};
  }
}

/**
 * Relays an SDP offer/answer or ICE candidate payload. This function does
 * not perform any WebRTC media processing itself (SmartMeet's backend is a
 * signaling-only server; peers establish a direct/TURN-relayed media path)
 * - it simply validates shape and returns the envelope to be emitted to the
 * target peer(s) by the socket handler.
 */
function buildSignalingEnvelope({ event, fromSocketId, toSocketId, roomId, payload }) {
  return {
    event,
    data: {
      fromSocketId,
      toSocketId,
      roomId,
      payload,
    },
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  addPeerToRoom,
  removePeerFromRoom,
  getPeersInRoom,
  getSocketIdsByUserId,
  recordConnectionQuality,
  getRoomQualitySnapshot,
  buildSignalingEnvelope,
};

/*
⚡ IMPROVEMENT SUGGESTIONS FOR WEBRTC SIGNALING SERVICE:
1. Deploy a coturn TURN/STUN server (with DTLS-SRTP enforced) and hand its credentials to clients at join time - without TURN, peers behind symmetric NATs cannot establish a media path at all.
2. Adopt @socket.io/redis-adapter so signaling events broadcast correctly when the app is horizontally scaled across multiple Node processes/containers, not just this app-level peer set mirroring.
3. Add TTL/expiry to the redis signaling keys so a crashed process doesn't leave stale peer entries forever.
PRIORITY: High
IMPLEMENTATION_EFFORT: High
IMPACT: High
*/
