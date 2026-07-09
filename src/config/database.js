'use strict';

const { Sequelize } = require('sequelize');
const env = require('./env');
const logger = require('../utils/logger');

/**
 * Single shared Sequelize instance with a tuned connection pool.
 * Pool sizing keeps the app well behaved under concurrent load while
 * protecting PostgreSQL from connection exhaustion.
 */
const sequelize = new Sequelize(env.databaseUrl, {
  dialect: 'postgres',
  logging: env.nodeEnv === 'development' ? (msg) => logger.debug(msg) : false,
  pool: {
    max: 20,
    min: 2,
    acquire: 30000,
    idle: 10000,
  },
  define: {
    underscored: true,
    timestamps: true,
  },
});

async function connectDatabase() {
  await sequelize.authenticate();
  logger.info('PostgreSQL connection established');
  return sequelize;
}

module.exports = { sequelize, connectDatabase };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR DATABASE CONFIG:
1. Add read replicas via Sequelize's `replication` option to offload GET /api/rooms and analytics queries from the primary.
2. Tune pool.max based on load-tested concurrency numbers rather than a static guess; expose it via env for per-environment tuning.
3. Add slow-query logging (log queries > N ms) to catch missing indexes before they hit production.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Medium
IMPACT: High
*/
