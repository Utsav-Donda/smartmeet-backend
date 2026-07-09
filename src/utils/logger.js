'use strict';

const pino = require('pino');

const level = process.env.LOG_LEVEL || 'info';
const isProd = (process.env.NODE_ENV || 'development') === 'production';

/**
 * Central pino logger instance. In non-production environments we pretty
 * print for readability; in production we emit structured JSON lines that
 * are easy to ship to a log aggregator (CloudWatch, Loki, ELK, etc.).
 */
const logger = pino({
  level,
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      },
});

module.exports = logger;

/*
⚡ IMPROVEMENT SUGGESTIONS FOR LOGGING:
1. Attach a request-id/correlation-id (generated in middleware/logger.js) to every log line so a single request's logs can be traced across services.
2. Ship logs to a centralized observability stack (e.g. OpenTelemetry + Grafana Loki) instead of stdout-only for multi-instance deployments.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Medium
IMPACT: Medium
*/
