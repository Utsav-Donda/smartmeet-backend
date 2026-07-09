'use strict';

/**
 * Base application error. All operational errors thrown intentionally by
 * the app should extend this so the centralized error handler can tell
 * them apart from unexpected programmer errors / bugs.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = undefined) {
    super(message, 400, details);
  }
}

class AuthError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
  }
}

class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
};

/*
⚡ IMPROVEMENT SUGGESTIONS FOR ERROR HANDLING:
1. Add an error `code` enum (e.g. ROOM_NOT_FOUND) alongside statusCode so clients can branch on stable machine-readable codes instead of parsing messages.
PRIORITY: Low
IMPLEMENTATION_EFFORT: Low
IMPACT: Medium
*/
