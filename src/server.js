'use strict';

const http = require('http');
const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { connectDatabase } = require('./config/database');
const { connectRedis } = require('./config/redis');
const { initSocketServer } = require('./sockets');
const sfuService = require('./services/sfuService');

async function start() {
  try {
    await connectDatabase();
    await connectRedis();
    // Spawns the mediasoup Worker subprocesses once at boot — must finish
    // before any sfu:* socket event can be handled (sfuService.calls
    // creation assumes at least one worker exists). Failure here degrades
    // to "SFU calling unavailable" (see sfuService.isAvailable) rather
    // than taking down the whole backend — mesh calling, chat, auth, etc.
    // don't depend on it.
    try {
      await sfuService.init();
    } catch (err) {
      logger.error({ err }, 'mediasoup worker startup failed — SFU calling will be unavailable this run');
    }

    const httpServer = http.createServer(app);
    const io = initSocketServer(httpServer);
    // Exposes the Socket.io server to REST controllers (via req.app.get('io'))
    // so REST-driven room join/leave can broadcast room:update-participants
    // to already-connected sockets, not just clients that joined via the
    // socket layer.
    app.set('io', io);

    httpServer.listen(env.port, () => {
      logger.info(`SmartMeet backend listening on port ${env.port} (${env.nodeEnv})`);
    });

    const shutdown = (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      httpServer.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
      // Force-exit if graceful shutdown hangs.
      setTimeout(() => process.exit(1), 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error({ err }, 'Failed to start SmartMeet backend');
    process.exit(1);
  }
}

start();

/*
⚡ IMPROVEMENT SUGGESTIONS FOR SERVER BOOTSTRAP:
1. Run PostgreSQL migrations automatically on boot (or via a dedicated init container) instead of assuming 001_initial_schema.sql has been applied out-of-band.
2. Add readiness gating so the process doesn't accept traffic until connectDatabase()/connectRedis() succeed, and integrate with an orchestrator's readiness probe (distinct from the liveness /api/health check).
PRIORITY: Medium
IMPLEMENTATION_EFFORT: Low
IMPACT: Medium
*/
