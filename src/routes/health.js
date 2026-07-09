'use strict';

const express = require('express');
const { sequelize } = require('../models');
const { redisClient } = require('../config/redis');
const { getMetricsReport } = require('../services/analyticsService');

const router = express.Router();

/**
 * GET /api/health
 * Lightweight liveness/readiness check: verifies DB and Redis connectivity
 * without requiring authentication so it can be used by load balancers.
 */
router.get('/health', async (_req, res) => {
  const health = { status: 'ok', timestamp: new Date().toISOString(), services: {} };

  try {
    await sequelize.authenticate();
    health.services.postgres = 'up';
  } catch (_err) {
    health.services.postgres = 'down';
    health.status = 'degraded';
  }

  try {
    await redisClient.ping();
    health.services.redis = 'up';
  } catch (_err) {
    health.services.redis = 'down';
    health.status = 'degraded';
  }

  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

/**
 * GET /api/metrics
 * Exposes in-process API/socket counters plus a DB-aggregated connection
 * quality summary. Not authenticated in this reference implementation -
 * see improvement suggestions for locking this down in production.
 */
router.get('/metrics', async (_req, res, next) => {
  try {
    const report = await getMetricsReport();
    res.status(200).json(report);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

/*
⚡ IMPROVEMENT SUGGESTIONS FOR HEALTH/METRICS ROUTES:
1. Require an internal-only auth token or restrict /api/metrics to a private network/VPC, since it currently leaks operational data to any caller.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Low
IMPACT: Medium
*/
