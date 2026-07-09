'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const env = require('./config/env');
const routes = require('./routes');
const httpLogger = require('./middleware/logger');
const metricsMiddleware = require('./middleware/metrics');
const { apiRateLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// morgan for concise console access logs, pino-http for structured logs.
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(httpLogger);

app.use(metricsMiddleware);
app.use(apiRateLimiter);

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

/*
⚡ IMPROVEMENT SUGGESTIONS FOR APP.JS / EXPRESS SETUP:
1. Restrict `cors()` to an explicit origin allowlist read from env, rather than reflecting all origins, before any production deployment.
2. Add `helmet.contentSecurityPolicy` with an explicit policy tuned for the frontend's asset/CDN origins instead of relying on helmet's defaults alone.
3. Consider extracting the recording upload/transcode pipeline into its own microservice/worker if recording volume grows, since it is CPU/bandwidth heavy and shouldn't share a process with low-latency signaling traffic.
PRIORITY: High
IMPLEMENTATION_EFFORT: Low
IMPACT: High
*/
