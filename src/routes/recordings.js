'use strict';

const express = require('express');
const recordingController = require('../controllers/recordingController');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const validators = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

router.get('/', validate(validators.paginationQuery, 'query'), recordingController.list);
router.get('/:recordingId', validate(validators.recordingIdParam, 'params'), recordingController.getById);
router.get(
  '/:recordingId/file',
  validate(validators.recordingIdParam, 'params'),
  recordingController.download
);

module.exports = router;
