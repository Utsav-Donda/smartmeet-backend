'use strict';

const Joi = require('joi');
const { ROOM_ACCESS_TYPES, CONNECTION_QUALITY } = require('../config/constants');

/**
 * Joi schemas for every validated REST payload in the app. Kept in one
 * place so controllers/routes only need to import `validators.<name>`.
 */

const register = Joi.object({
  email: Joi.string().email().required(),
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(8).max(128).required(),
});

const login = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const refreshToken = Joi.object({
  refreshToken: Joi.string().required(),
});

const createRoom = Joi.object({
  name: Joi.string().min(1).max(120).required(),
  accessType: Joi.string()
    .valid(...Object.values(ROOM_ACCESS_TYPES))
    .default(ROOM_ACCESS_TYPES.PUBLIC),
  password: Joi.string().min(4).max(128).when('accessType', {
    is: ROOM_ACCESS_TYPES.PASSWORD,
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  maxParticipants: Joi.number().integer().min(2).max(500).default(50),
});

const joinRoom = Joi.object({
  password: Joi.string().min(4).max(128).optional(),
});

const roomIdParam = Joi.object({
  roomId: Joi.string().guid({ version: ['uuidv4'] }).required(),
});

const recordingIdParam = Joi.object({
  recordingId: Joi.string().guid({ version: ['uuidv4'] }).required(),
});

const connectionMetric = Joi.object({
  roomId: Joi.string().guid({ version: ['uuidv4'] }).required(),
  bandwidthIn: Joi.number().min(0).required(),
  bandwidthOut: Joi.number().min(0).required(),
  latency: Joi.number().integer().min(0).required(),
  packetLoss: Joi.number().min(0).max(100).required(),
  connectionQuality: Joi.string().valid(...Object.values(CONNECTION_QUALITY)).optional(),
});

const paginationQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

module.exports = {
  register,
  login,
  refreshToken,
  createRoom,
  joinRoom,
  roomIdParam,
  recordingIdParam,
  connectionMetric,
  paginationQuery,
};

/*
⚡ IMPROVEMENT SUGGESTIONS FOR VALIDATION:
1. Share these Joi schemas (or generate OpenAPI from them via joi-to-swagger) to keep API docs and validation in sync automatically.
PRIORITY: Low
IMPLEMENTATION_EFFORT: Low
IMPACT: Medium
*/
