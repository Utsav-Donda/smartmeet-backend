'use strict';

const pinoHttp = require('pino-http');
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

/**
 * Structured HTTP request logger built on pino-http, sharing the app's
 * pino instance so log levels/formatting stay consistent. Generates a
 * request id (or reuses an inbound X-Request-Id) for cross-log tracing.
 */
const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers['x-request-id'];
    const id = existing || randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});

module.exports = httpLogger;

/*
⚡ IMPROVEMENT SUGGESTIONS FOR HTTP LOGGING:
1. Redact sensitive fields (Authorization header, password fields) explicitly via pino-http's `redact` option in case a future log line stringifies the raw request body.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Low
IMPACT: Medium
*/
