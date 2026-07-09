'use strict';

const { Recording, Room, RoomParticipant } = require('../models');
const roomService = require('../services/roomService');
const storageService = require('../services/storageService');
const { NotFoundError, ForbiddenError } = require('../utils/errors');

/**
 * Recordings may contain sensitive meeting content, so every read is
 * scoped to rooms the requesting user actually participated in (host,
 * moderator, or plain participant — anyone who was ever in the room),
 * rather than any authenticated user being able to browse/download any
 * recording by id.
 */
async function list(req, res, next) {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const { rows, count } = await Recording.findAndCountAll({
      include: [
        {
          model: Room,
          as: 'room',
          attributes: ['id', 'name', 'hostId'],
          required: true,
          include: [
            {
              model: RoomParticipant,
              as: 'participants',
              attributes: [],
              where: { userId: req.user.id },
              required: true,
            },
          ],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      // RoomParticipant may have multiple historical rows (rejoins) for
      // the same user/room; dedupe at the SQL level rather than the app level.
      distinct: true,
      subQuery: false,
    });

    res.status(200).json({
      recordings: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const recording = await Recording.findByPk(req.params.recordingId, {
      include: [{ model: Room, as: 'room', attributes: ['id', 'name', 'hostId'] }],
    });

    if (!recording) {
      throw new NotFoundError('Recording not found');
    }

    const hasParticipated = await roomService.hasEverParticipated(recording.roomId, req.user.id);
    if (!hasParticipated) {
      throw new ForbiddenError('You do not have access to this recording');
    }

    const downloadUrl = storageService.useS3
      ? await storageService.getSignedDownloadUrl(
          { filePath: recording.filePath, storageUrl: recording.storageUrl },
          3600
        )
      : `/api/recordings/${recording.id}/file`;

    res.status(200).json({ recording, downloadUrl });
  } catch (err) {
    next(err);
  }
}

/**
 * Streams the recording's bytes directly through the authenticated API
 * instead of the old `express.static('/storage', ...)` mount, which served
 * every locally-stored recording to anyone who guessed/found a filename.
 * Only used for the local-disk storage fallback — S3 downloads go through
 * a pre-signed URL instead (see getById).
 */
async function download(req, res, next) {
  try {
    const recording = await Recording.findByPk(req.params.recordingId);
    if (!recording) {
      throw new NotFoundError('Recording not found');
    }

    const hasParticipated = await roomService.hasEverParticipated(recording.roomId, req.user.id);
    if (!hasParticipated) {
      throw new ForbiddenError('You do not have access to this recording');
    }

    if (storageService.useS3) {
      const signedUrl = await storageService.getSignedDownloadUrl(
        { filePath: recording.filePath, storageUrl: recording.storageUrl },
        3600
      );
      return res.redirect(signedUrl);
    }

    res.setHeader('Content-Type', 'video/webm');
    const stream = storageService.downloadRecording({ filePath: recording.filePath });
    stream.on('error', next);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

/**
 * Uploads a completed recording for a room. Restricted to the room's host
 * or a moderator, mirroring the same authorization used for host controls.
 * Expects the raw recording bytes as the request body (see
 * routes/rooms.js's `express.raw` middleware scoped to this route).
 */
async function create(req, res, next) {
  try {
    const { roomId } = req.params;
    const actingParticipant = await roomService.getActiveParticipant(roomId, req.user.id);
    if (!actingParticipant || !['host', 'moderator'].includes(actingParticipant.role)) {
      throw new ForbiddenError('Only the host or a moderator can upload a recording for this room');
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new ForbiddenError('Recording body must not be empty');
    }

    const uploadResult = await storageService.uploadRecording({
      roomId,
      buffer: req.body,
      contentType: req.headers['content-type'] || 'video/webm',
    });

    const recording = await Recording.create({
      roomId,
      filePath: uploadResult.filePath,
      fileSize: uploadResult.fileSize,
      storageUrl: uploadResult.storageUrl,
      duration: Number(req.query.duration) || 0,
    });

    res.status(201).json({ recording });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getById, download, create };
