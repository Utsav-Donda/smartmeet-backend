'use strict';

const { sequelize } = require('../config/database');
const defineUser = require('./User');
const defineRoom = require('./Room');
const defineRoomParticipant = require('./RoomParticipant');
const defineRecording = require('./Recording');
const defineConnectionMetric = require('./ConnectionMetric');
const defineMessage = require('./Message');

const User = defineUser(sequelize);
const Room = defineRoom(sequelize);
const RoomParticipant = defineRoomParticipant(sequelize);
const Recording = defineRecording(sequelize);
const ConnectionMetric = defineConnectionMetric(sequelize);
const Message = defineMessage(sequelize);

const models = { User, Room, RoomParticipant, Recording, ConnectionMetric, Message };

Object.values(models).forEach((model) => {
  if (typeof model.associate === 'function') {
    model.associate(models);
  }
});

module.exports = { sequelize, ...models };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR MODELS INDEX:
1. Auto-discover model files (fs.readdirSync) instead of manually requiring each one, so adding a new model doesn't require editing this file.
PRIORITY: Low
IMPLEMENTATION_EFFORT: Low
IMPACT: Low
*/
