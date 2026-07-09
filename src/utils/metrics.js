'use strict';

const env = require('../config/env');

/**
 * Lightweight in-process metrics collector for API response times and
 * request counts, surfaced via GET /api/metrics. Intentionally simple
 * (no external dependency) - see improvement suggestions for a
 * production-grade alternative (prom-client).
 *
 * Structure:
 *   routes: {
 *     'GET /api/rooms': { count, errorCount, totalDurationMs, minMs, maxMs }
 *   }
 */
const state = {
  startedAt: Date.now(),
  routes: new Map(),
  sockets: {
    connections: 0,
    disconnections: 0,
    messagesSent: 0,
    messagesReceived: 0,
  },
};

function recordRequest(routeKey, durationMs, statusCode) {
  if (!env.enableMetrics) return;
  const existing = state.routes.get(routeKey) || {
    count: 0,
    errorCount: 0,
    totalDurationMs: 0,
    minMs: Infinity,
    maxMs: 0,
  };
  existing.count += 1;
  existing.totalDurationMs += durationMs;
  existing.minMs = Math.min(existing.minMs, durationMs);
  existing.maxMs = Math.max(existing.maxMs, durationMs);
  if (statusCode >= 500) existing.errorCount += 1;
  state.routes.set(routeKey, existing);
}

function recordSocketEvent(type) {
  if (!env.enableMetrics) return;
  if (Object.prototype.hasOwnProperty.call(state.sockets, type)) {
    state.sockets[type] += 1;
  }
}

function getSnapshot() {
  const routes = {};
  for (const [key, value] of state.routes.entries()) {
    routes[key] = {
      count: value.count,
      errorCount: value.errorCount,
      avgMs: value.count ? Number((value.totalDurationMs / value.count).toFixed(2)) : 0,
      minMs: value.minMs === Infinity ? 0 : value.minMs,
      maxMs: value.maxMs,
    };
  }
  return {
    uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
    routes,
    sockets: { ...state.sockets },
  };
}

module.exports = { recordRequest, recordSocketEvent, getSnapshot };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR METRICS:
1. Replace this in-memory map with prom-client and expose a /metrics endpoint in Prometheus text format for real dashboards/alerting.
2. Back the counters with Redis so metrics aggregate correctly across multiple horizontally-scaled instances instead of being per-process.
PRIORITY: High
IMPLEMENTATION_EFFORT: Medium
IMPACT: High
*/
