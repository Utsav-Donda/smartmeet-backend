'use strict';

const express = require('express');
const authRoutes = require('./auth');
const roomRoutes = require('./rooms');
const recordingRoutes = require('./recordings');
const healthRoutes = require('./health');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/rooms', roomRoutes);
router.use('/recordings', recordingRoutes);
// health.js defines both /health and /metrics, mounted at the API root.
router.use('/', healthRoutes);

module.exports = router;
