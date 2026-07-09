'use strict';

const express = require('express');
const authController = require('../controllers/authController');
const { validate } = require('../middleware/validation');
const { authRateLimiter } = require('../middleware/rateLimit');
const validators = require('../utils/validators');

const router = express.Router();

router.post('/register', authRateLimiter, validate(validators.register), authController.register);
router.post('/login', authRateLimiter, validate(validators.login), authController.login);
router.post('/refresh', authRateLimiter, validate(validators.refreshToken), authController.refresh);

module.exports = router;
