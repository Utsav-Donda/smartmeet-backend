'use strict';

const { Op } = require('sequelize');
const { ConnectionMetric, sequelize } = require('../models');
const { getSnapshot } = require('../utils/metrics');

/**
 * Persists a single connection-quality sample reported by a client (via
 * REST or socket) into connection_metrics.
 */
async function recordConnectionMetric({ roomId, participantId, bandwidthIn, bandwidthOut, latency, packetLoss }) {
  return ConnectionMetric.create({
    roomId,
    participantId,
    bandwidthIn,
    bandwidthOut,
    latency,
    packetLoss,
  });
}

/**
 * Aggregates recent connection metrics (last `windowMinutes`) to power the
 * "network health" portion of GET /api/metrics.
 */
async function getConnectionMetricsSummary(windowMinutes = 15) {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  const [row] = await ConnectionMetric.findAll({
    where: { recordedAt: { [Op.gte]: since } },
    attributes: [
      [sequelize.fn('COUNT', sequelize.col('id')), 'sampleCount'],
      [sequelize.fn('AVG', sequelize.col('bandwidth_in')), 'avgBandwidthIn'],
      [sequelize.fn('AVG', sequelize.col('bandwidth_out')), 'avgBandwidthOut'],
      [sequelize.fn('AVG', sequelize.col('latency')), 'avgLatency'],
      [sequelize.fn('AVG', sequelize.col('packet_loss')), 'avgPacketLoss'],
    ],
    raw: true,
  });

  return {
    windowMinutes,
    sampleCount: Number(row?.sampleCount || 0),
    avgBandwidthIn: Number(row?.avgBandwidthIn || 0),
    avgBandwidthOut: Number(row?.avgBandwidthOut || 0),
    avgLatency: Number(row?.avgLatency || 0),
    avgPacketLoss: Number(row?.avgPacketLoss || 0),
  };
}

/**
 * Combines the in-process API/socket metrics snapshot with the
 * DB-persisted connection-quality aggregate for the GET /api/metrics
 * endpoint.
 */
async function getMetricsReport() {
  const [apiSnapshot, connectionSummary] = await Promise.all([
    Promise.resolve(getSnapshot()),
    getConnectionMetricsSummary().catch(() => null),
  ]);

  return {
    api: apiSnapshot,
    connectionQuality: connectionSummary,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { recordConnectionMetric, getConnectionMetricsSummary, getMetricsReport };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR ANALYTICS SERVICE:
1. Move the aggregate query to a materialized view refreshed on a schedule so /api/metrics doesn't run an AVG() scan over the raw table under load.
2. Add p95/p99 latency via PostgreSQL's percentile_cont instead of AVG alone, since averages hide the worst-experience participants.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Medium
IMPACT: Medium
*/
