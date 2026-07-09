'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AuthError } = require('../utils/errors');

/**
 * Express middleware verifying a Bearer JWT access token and attaching
 * `req.user = { id, email, username }` on success.
 */
function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AuthError('Missing or malformed Authorization header'));
  }

  try {
    const payload = jwt.verify(token, env.jwt.secret);
    req.user = { id: payload.sub, email: payload.email, username: payload.username };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AuthError('Access token expired'));
    }
    return next(new AuthError('Invalid access token'));
  }
}

/**
 * Same as `authenticate` but does not fail the request when no/invalid
 * token is present - useful for endpoints that behave differently for
 * logged-in vs anonymous users (not currently used by any route, kept for
 * extensibility).
 */
function optionalAuthenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next();

  try {
    const payload = jwt.verify(token, env.jwt.secret);
    req.user = { id: payload.sub, email: payload.email, username: payload.username };
  } catch (_err) {
    // ignore invalid token for optional auth
  }
  return next();
}

module.exports = { authenticate, optionalAuthenticate };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR AUTH MIDDLEWARE:
1. Maintain a Redis-backed token denylist for refresh tokens so a compromised token can be revoked before natural expiry.
2. Add role-based authorization middleware (e.g. requireRole('host')) for room-management endpoints beyond simple authentication.
PRIORITY: High
IMPLEMENTATION_EFFORT: Medium
IMPACT: High
*/
