'use strict';

const { createClient } = require('redis');
const env = require('./env');
const logger = require('../utils/logger');

/**
 * Single shared redis v4 client used for:
 *  - REST response caching (room list/detail)
 *  - WebRTC signaling state shared across Socket.io instances
 *  - Rate limiting / metrics counters
 */
const redisClient = createClient({ url: env.redisUrl });

redisClient.on('error', (err) => {
  logger.error({ err }, 'Redis client error');
});

redisClient.on('reconnecting', () => {
  logger.warn('Redis client reconnecting');
});

let connected = false;

async function connectRedis() {
  if (connected) return redisClient;
  await redisClient.connect();
  connected = true;
  logger.info('Redis connection established');
  return redisClient;
}

module.exports = { redisClient, connectRedis };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR REDIS CONFIG:
1. Adopt the Socket.io redis adapter (@socket.io/redis-adapter) on this same client to enable horizontal scaling of the signaling layer across multiple server instances.
2. Add a circuit breaker so REST endpoints gracefully degrade to direct DB reads if Redis is temporarily unavailable instead of failing the request.
PRIORITY: High
IMPLEMENTATION_EFFORT: Medium
IMPACT: High
*/
