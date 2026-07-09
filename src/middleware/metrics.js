'use strict';

const { recordRequest } = require('../utils/metrics');

/**
 * Records per-route response time and status code for GET /api/metrics.
 * Uses req.route when available (post-routing) to avoid a high-cardinality
 * key explosion from path params (e.g. /api/rooms/:roomId).
 */
function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    const routePath = req.route ? req.baseUrl + req.route.path : req.path;
    const routeKey = `${req.method} ${routePath}`;
    recordRequest(routeKey, durationMs, res.statusCode);
  });

  next();
}

module.exports = metricsMiddleware;

/*
⚡ IMPROVEMENT SUGGESTIONS FOR METRICS MIDDLEWARE:
1. Emit histogram buckets (p50/p95/p99) rather than min/avg/max only, which hide tail latency spikes that matter most for real-time video signaling endpoints.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Medium
IMPACT: Medium
*/
