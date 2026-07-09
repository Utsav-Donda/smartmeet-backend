'use strict';

/**
 * Shared enums / constants used across models, services, controllers and sockets.
 * Kept as plain frozen objects so they can be imported without instantiation cost.
 */

const ROOM_ROLES = Object.freeze({
  HOST: 'host',
  MODERATOR: 'moderator',
  PARTICIPANT: 'participant',
});

const ROOM_ACCESS_TYPES = Object.freeze({
  PUBLIC: 'public',
  PRIVATE: 'private',
  PASSWORD: 'password',
});

const CONNECTION_QUALITY = Object.freeze({
  EXCELLENT: 'excellent',
  GOOD: 'good',
  FAIR: 'fair',
  POOR: 'poor',
});

const SOCKET_EVENTS = Object.freeze({
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  ROOM_UPDATE_PARTICIPANTS: 'room:update-participants',
  ROOM_PARTICIPANT_PRESENCE: 'room:participant-presence',
  WEBRTC_OFFER: 'webrtc:offer',
  WEBRTC_ANSWER: 'webrtc:answer',
  WEBRTC_ICE_CANDIDATE: 'webrtc:ice-candidate',
  WEBRTC_CONNECTION_QUALITY: 'webrtc:connection-quality',
  CHAT_MESSAGE: 'chat:message',
  ERROR_DISCONNECT_REASON: 'error:disconnect-reason',
  SYSTEM_RECONNECT_REQUIRED: 'system:reconnect-required',
  ROOM_HOST_MUTE_PARTICIPANT: 'room:host-mute-participant',
  ROOM_HOST_KICK_PARTICIPANT: 'room:host-kick-participant',
  ROOM_KICKED: 'room:kicked',
  ROOM_FORCE_MUTED: 'room:force-muted',
  ROOM_REACTION: 'room:reaction',
});

// Emoji whitelist for room:reaction — keeps the payload small and prevents
// a client sending arbitrary (possibly huge/malicious) strings through an
// event that's fanned out to the whole room unmoderated.
const ALLOWED_REACTIONS = Object.freeze(['👍', '👏', '❤️', '😂', '😮', '🎉']);

const DISCONNECT_REASONS = Object.freeze({
  CLIENT_LEFT: 'client_left',
  TRANSPORT_CLOSE: 'transport_close',
  SERVER_SHUTDOWN: 'server_shutdown',
  AUTH_FAILED: 'auth_failed',
  KICKED: 'kicked',
});

const CACHE_KEYS = Object.freeze({
  ROOM_LIST: 'cache:rooms:list',
  ROOM_DETAIL: (roomId) => `cache:rooms:${roomId}`,
});

const CACHE_TTL_SECONDS = Object.freeze({
  ROOM_LIST: 15,
  ROOM_DETAIL: 30,
});

module.exports = {
  ROOM_ROLES,
  ROOM_ACCESS_TYPES,
  CONNECTION_QUALITY,
  SOCKET_EVENTS,
  DISCONNECT_REASONS,
  CACHE_KEYS,
  CACHE_TTL_SECONDS,
  ALLOWED_REACTIONS,
};

/*
⚡ IMPROVEMENT SUGGESTIONS FOR CONSTANTS:
1. Generate these enums from the same source of truth as the SQL ENUM types (e.g. a shared JSON/YAML) to prevent schema drift.
PRIORITY: Low
IMPLEMENTATION_EFFORT: Low
IMPACT: Low
*/
