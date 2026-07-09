'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { TooManyRequestsError } = require('../utils/errors');

/**
 * Per-IP rate limiter applied globally in app.js. Window/threshold are
 * configurable via env so staging/production can tune limits independently
 * without a code change.
 */
const apiRateLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError('Too many requests, please try again later'));
  },
});

/**
 * Stricter limiter for auth endpoints to slow down credential stuffing /
 * brute-force attacks.
 */
const authRateLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: Math.max(5, Math.floor(env.rateLimit.max / 5)),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError('Too many authentication attempts, please try again later'));
  },
});

module.exports = { apiRateLimiter, authRateLimiter };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR RATE LIMITING / DDOS PROTECTION:
1. Back the rate limiter store with Redis (rate-limit-redis) so limits are enforced correctly across multiple horizontally-scaled instances instead of per-process memory.
2. Put a CDN/WAF (Cloudflare, AWS WAF) in front of the API for L3/L4 DDoS mitigation - app-level rate limiting alone cannot absorb volumetric attacks.
PRIORITY: High
IMPLEMENTATION_EFFORT: Medium
IMPACT: High
*/
