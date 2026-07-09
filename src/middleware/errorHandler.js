'use strict';

const env = require('../config/env');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

/**
 * Centralized Express error handler. Must be registered last, after all
 * routes. Operational errors (AppError subclasses) are surfaced with their
 * intended status code and message; unexpected errors are logged in full
 * but only a generic message is returned to the client in production so
 * stack traces / internals never leak.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : err.statusCode || 500;

  logger.error(
    {
      err,
      path: req.originalUrl,
      method: req.method,
      statusCode,
    },
    'Request error'
  );

  const body = {
    error: {
      message: isAppError || statusCode < 500 ? err.message : 'Internal server error',
    },
  };

  if (isAppError && err.details) {
    body.error.details = err.details;
  }

  if (env.nodeEnv !== 'production') {
    body.error.stack = err.stack;
  }

  res.status(statusCode).json(body);
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.originalUrl}` } });
}

module.exports = { errorHandler, notFoundHandler };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR ERROR HANDLING MIDDLEWARE:
1. Integrate an error-tracking service (Sentry) capturing non-operational (5xx, isOperational=false) errors with request context for faster triage.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Low
IMPACT: Medium
*/
