'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const env = require('../config/env');
const { AuthError, ConflictError } = require('../utils/errors');

const SALT_ROUNDS = 10;

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, username: user.username }, env.jwt.secret, {
    expiresIn: env.jwt.accessExpiry,
  });
}

function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, type: 'refresh' }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiry,
  });
}

async function registerUser({ email, username, password }) {
  const existing = await User.findOne({ where: { email } });
  if (existing) {
    throw new ConflictError('An account with this email already exists');
  }
  const existingUsername = await User.findOne({ where: { username } });
  if (existingUsername) {
    throw new ConflictError('This username is already taken');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await User.create({ email, username, passwordHash });

  return issueTokenPair(user);
}

async function loginUser({ email, password }) {
  const user = await User.findOne({ where: { email } });
  if (!user) {
    throw new AuthError('Invalid email or password');
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    throw new AuthError('Invalid email or password');
  }

  return issueTokenPair(user);
}

/**
 * Verifies a refresh token and issues a fresh access + refresh token pair
 * (refresh token rotation). The old refresh token is implicitly invalidated
 * client-side by being replaced; see improvement suggestions for a
 * server-side denylist.
 */
async function refreshTokens(refreshToken) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, env.jwt.refreshSecret);
  } catch (_err) {
    throw new AuthError('Invalid or expired refresh token');
  }

  if (payload.type !== 'refresh') {
    throw new AuthError('Invalid refresh token');
  }

  const user = await User.findByPk(payload.sub);
  if (!user) {
    throw new AuthError('User no longer exists');
  }

  return issueTokenPair(user);
}

function issueTokenPair(user) {
  return {
    user: user.toSafeJSON(),
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

module.exports = { registerUser, loginUser, refreshTokens, signAccessToken, signRefreshToken };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR USER SERVICE / AUTH:
1. Maintain a Redis set of valid/issued refresh token jtis so rotation can invalidate the previous token instead of allowing both old and new tokens to work until expiry.
2. Add email verification and password-reset flows (currently out of scope) before this could be considered production-ready for public signup.
PRIORITY: High
IMPLEMENTATION_EFFORT: Medium
IMPACT: High
*/
