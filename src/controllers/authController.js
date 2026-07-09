'use strict';

const userService = require('../services/userService');

async function register(req, res, next) {
  try {
    const result = await userService.registerUser(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const result = await userService.loginUser(req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const result = await userService.refreshTokens(req.body.refreshToken);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, refresh };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR AUTH CONTROLLER:
1. Set the refresh token as an httpOnly, Secure, SameSite=strict cookie instead of returning it in the JSON body, reducing XSS token-theft risk.
PRIORITY: High
IMPLEMENTATION_EFFORT: Low
IMPACT: High
*/
