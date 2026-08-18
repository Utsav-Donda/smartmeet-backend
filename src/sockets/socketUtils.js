'use strict';

/**
 * Tiny shared helpers with no dependencies on any other sockets/*.js
 * module — exists specifically so roomEvents.js and sfuEvents.js can both
 * use `socketRoomName` without importing from each other (roomEvents.js
 * needs sfuEvents.js's `cleanupSfuPeer` on room:leave; sfuEvents.js needs
 * `socketRoomName` to broadcast sfu:new-producer/producer-closed — having
 * both pull from here instead of one importing the other avoids a
 * circular require).
 */
function socketRoomName(roomId) {
  return `room:${roomId}`;
}

module.exports = { socketRoomName };