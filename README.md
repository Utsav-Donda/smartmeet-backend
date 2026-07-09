# SmartMeet Backend

Backend for SmartMeet, a live video collaboration platform: Express REST API,
Socket.io WebRTC signaling, PostgreSQL (via Sequelize), Redis caching/state,
and S3 (or local disk fallback) recording storage.

## Stack

- Node.js 18+, Express 4
- PostgreSQL 13+ (Sequelize ORM)
- Redis 6+ (v4 client)
- Socket.io 4 for real-time signaling
- AWS S3 (aws-sdk v2) for recording storage, with automatic local-disk
  fallback when no AWS credentials are configured

## Getting started

```bash
cp .env.example .env
# edit .env with your local DATABASE_URL / REDIS_URL / JWT secrets

npm install
psql "$DATABASE_URL" -f src/migrations/001_initial_schema.sql

npm run dev
```

The server starts on `PORT` (default `3000`). REST endpoints are mounted
under `/api`, Socket.io shares the same HTTP server/port.

## Project layout

```
src/
  config/       env loading, Sequelize/Redis setup, shared constants
  routes/       Express route definitions (thin, delegate to controllers)
  controllers/  request/response handling, calls into services
  services/     business logic (auth, rooms, storage, signaling, analytics)
  models/       Sequelize models + associations
  middleware/   auth, validation, rate limiting, logging, metrics, errors
  sockets/      Socket.io connection handling + event modules
  utils/        logger, custom error classes, Joi schemas, metrics store
  migrations/   raw SQL schema (001_initial_schema.sql)
```

## REST API

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/auth/register | no | Create an account, returns token pair |
| POST | /api/auth/login | no | Authenticate, returns token pair |
| POST | /api/auth/refresh | no | Rotate a refresh token for a new pair |
| POST | /api/rooms | yes | Create a room (public/private/password) |
| GET | /api/rooms | yes | List active rooms (Redis-cached, paginated) |
| GET | /api/rooms/:roomId | yes | Get room details |
| POST | /api/rooms/:roomId/join | yes | Join a room (validates password if required) |
| POST | /api/rooms/:roomId/leave | yes | Leave a room |
| GET | /api/rooms/:roomId/participants | yes | List active participants |
| GET | /api/recordings | yes | List recordings (paginated) |
| GET | /api/recordings/:recordingId | yes | Get a recording + signed download URL |
| GET | /api/health | no | Liveness/readiness check (DB + Redis) |
| GET | /api/metrics | no | In-process API/socket metrics + connection-quality aggregate (unauthenticated — lock this down before production, see IMPROVEMENTS.md) |

All authenticated routes expect `Authorization: Bearer <accessToken>`.

## WebSocket events

Connect with `io(url, { auth: { token: accessToken } })`. Every
server-emitted event uses the envelope `{ event, data, timestamp }`
(documented in `src/sockets/index.js`).

- `room:join`, `room:leave` (client -> server, ack-based)
- `room:update-participants`, `room:participant-presence` (server -> room)
- `webrtc:offer`, `webrtc:answer`, `webrtc:ice-candidate` (peer-targeted relay)
- `webrtc:connection-quality` (client reports samples; server classifies + broadcasts)
- `chat:message` (room broadcast)
- `error:disconnect-reason`, `system:reconnect-required` (server -> client on disconnect)

## Storage

If `AWS_ACCESS_KEY_ID` is unset, `storageService` writes recordings under
`backend/storage/` and serves them via `GET /storage/<file>`. Set AWS
credentials + `AWS_S3_BUCKET`/`AWS_REGION` to switch to S3 automatically -
no code changes required.

## Testing

This reference implementation ships without an automated test suite by
project decision; `npm test` is a no-op placeholder. Wire up Jest/Supertest
(or your preferred stack) before relying on this in CI.

## Docker

```bash
docker build -t smartmeet-backend .
docker run --env-file .env -p 3000:3000 smartmeet-backend
```

See `Dockerfile` for the non-root, multi-stage build rationale.
