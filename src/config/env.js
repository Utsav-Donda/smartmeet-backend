'use strict';

require('dotenv').config();

/**
 * Loads and validates process.env, exporting a single typed config object.
 * Failing fast here means the app never boots into a half-configured state.
 */
const REQUIRED_IN_PRODUCTION = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 3000),

  databaseUrl: process.env.DATABASE_URL || 'postgresql://smartmeet:change_me_in_production@localhost:5432/smartmeet',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    bucket: process.env.AWS_S3_BUCKET || 'smartmeet-recordings',
    region: process.env.AWS_REGION || 'us-east-1',
  },

  rateLimit: {
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: toInt(process.env.RATE_LIMIT_MAX_REQUESTS, 100),
  },

  logLevel: process.env.LOG_LEVEL || 'info',
  enableMetrics: toBool(process.env.ENABLE_METRICS, true),

  mediasoup: {
    // Number of mediasoup Worker subprocesses to spawn at boot — one per
    // logical CPU is the standard pattern, capped so a big host doesn't
    // spawn an unreasonable number for a dev/small-deployment box.
    numWorkers: toInt(process.env.MEDIASOUP_NUM_WORKERS, Math.min(require('os').cpus().length, 4)),
    minPort: toInt(process.env.MEDIASOUP_MIN_PORT, 40000),
    maxPort: toInt(process.env.MEDIASOUP_MAX_PORT, 40099),
    // The IP clients should actually send/receive RTP to/from — must be a
    // real reachable address (LAN IP for local testing, the box's public
    // IP in production), NOT 127.0.0.1/0.0.0.0, or every client behind a
    // NAT will fail to connect their WebRtcTransport.
    announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
  },
};

function validateEnv() {
  if (env.nodeEnv === 'production') {
    const missing = REQUIRED_IN_PRODUCTION.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables in production: ${missing.join(', ')}`);
    }
  }
}

validateEnv();

module.exports = env;

/*
⚡ IMPROVEMENT SUGGESTIONS FOR ENV CONFIG:
1. Replace hand-rolled validation with a Joi/zod schema so type coercion and constraints (e.g. PORT range) are declarative and unit-testable.
2. Support secret injection from a vault (AWS Secrets Manager/Parameter Store) instead of plain env vars for JWT secrets in production.
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Low
IMPACT: Medium
*/
