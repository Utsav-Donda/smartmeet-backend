'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');
const logger = require('../utils/logger');

const LOCAL_STORAGE_DIR = path.join(__dirname, '..', '..', 'storage');
const useS3 = Boolean(env.aws.accessKeyId);

let s3 = null;
if (useS3) {
  AWS.config.update({
    accessKeyId: env.aws.accessKeyId,
    secretAccessKey: env.aws.secretAccessKey,
    region: env.aws.region,
  });
  s3 = new AWS.S3();
  logger.info('storageService: using S3 backend');
} else {
  logger.info('storageService: AWS_ACCESS_KEY_ID not set, using local disk storage fallback');
}

async function ensureLocalDir() {
  await fsp.mkdir(LOCAL_STORAGE_DIR, { recursive: true });
}

/**
 * Uploads a recording buffer/stream to S3 (when AWS credentials are
 * configured) or to local disk under backend/storage/ otherwise. Returns a
 * uniform result shape regardless of backend so callers never need to
 * branch on storage strategy.
 */
async function uploadRecording({ roomId, buffer, contentType = 'video/webm', extension = 'webm' }) {
  const key = `recordings/${roomId}/${uuidv4()}.${extension}`;

  if (useS3) {
    const params = {
      Bucket: env.aws.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    };
    const result = await s3.upload(params).promise();
    return {
      filePath: key,
      storageUrl: result.Location,
      fileSize: buffer.length,
    };
  }

  await ensureLocalDir();
  const localPath = path.join(LOCAL_STORAGE_DIR, key.replace(/\//g, '_'));
  await fsp.writeFile(localPath, buffer);
  return {
    filePath: localPath,
    storageUrl: `/storage/${path.basename(localPath)}`,
    fileSize: buffer.length,
  };
}

/**
 * Returns a readable download stream for a previously stored recording,
 * regardless of backend.
 */
function downloadRecording({ filePath }) {
  if (useS3) {
    const params = { Bucket: env.aws.bucket, Key: filePath };
    return s3.getObject(params).createReadStream();
  }
  return fs.createReadStream(filePath);
}

/**
 * Generates a time-limited pre-signed URL for direct client download when
 * using S3; for local storage returns the static path served by Express.
 */
async function getSignedDownloadUrl({ filePath, storageUrl }, expiresSeconds = 3600) {
  if (useS3) {
    return s3.getSignedUrlPromise('getObject', {
      Bucket: env.aws.bucket,
      Key: filePath,
      Expires: expiresSeconds,
    });
  }
  return storageUrl;
}

module.exports = { uploadRecording, downloadRecording, getSignedDownloadUrl, useS3 };

/*
⚡ IMPROVEMENT SUGGESTIONS FOR STORAGE SERVICE:
1. Migrate to the AWS SDK v3 modular S3 client to reduce bundle size and get native promise support instead of aws-sdk v2's callback-wrapped `.promise()`.
2. Stream uploads directly from the recording pipeline (multipart upload) instead of buffering the entire recording in memory, which will OOM for long meetings.
3. Add server-side encryption (SSE-S3/SSE-KMS) on the upload params for recordings at rest, since meeting recordings are sensitive user data.
PRIORITY: High
IMPLEMENTATION_EFFORT: Medium
IMPACT: High
*/
