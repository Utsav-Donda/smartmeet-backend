'use strict';

const express = require('express');
const roomController = require('../controllers/roomController');
const recordingController = require('../controllers/recordingController');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const validators = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

// Raw binary body, scoped only to this route — the recording upload body is
// a video blob, not JSON, so it must bypass the app-wide express.json()
// parser (which only reads application/json bodies and would otherwise
// leave req.body empty here).
const rawRecordingBody = express.raw({ type: '*/*', limit: '500mb' });

router.post('/', validate(validators.createRoom), roomController.create);
router.get('/', validate(validators.paginationQuery, 'query'), roomController.list);
router.get('/:roomId', validate(validators.roomIdParam, 'params'), roomController.getById);
router.post(
  '/:roomId/join',
  validate(validators.roomIdParam, 'params'),
  validate(validators.joinRoom),
  roomController.join
);
router.post('/:roomId/leave', validate(validators.roomIdParam, 'params'), roomController.leave);
router.get(
  '/:roomId/participants',
  validate(validators.roomIdParam, 'params'),
  roomController.participants
);
router.get(
  '/:roomId/messages',
  validate(validators.roomIdParam, 'params'),
  validate(validators.paginationQuery, 'query'),
  roomController.messages
);
router.post(
  '/:roomId/recordings',
  validate(validators.roomIdParam, 'params'),
  rawRecordingBody,
  recordingController.create
);

module.exports = router;
