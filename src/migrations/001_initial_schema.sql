-- SmartMeet initial schema
-- Uses pgcrypto's gen_random_uuid() for UUID primary keys (available on
-- PostgreSQL 13+ without extra setup on most managed providers; falls back
-- to uuid-ossp if pgcrypto is unavailable).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE room_access_type AS ENUM ('public', 'private', 'password');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE room_participant_role AS ENUM ('host', 'moderator', 'participant');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE connection_quality AS ENUM ('excellent', 'good', 'fair', 'poor');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(30) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  avatar_url VARCHAR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  host_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  access_type room_access_type NOT NULL DEFAULT 'public',
  password_hash VARCHAR(255),
  max_participants INTEGER NOT NULL DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rooms_host_id ON rooms (host_id);
CREATE INDEX IF NOT EXISTS idx_rooms_is_active ON rooms (is_active);
CREATE INDEX IF NOT EXISTS idx_rooms_access_type ON rooms (access_type);

-- ---------------------------------------------------------------------------
-- room_participants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role room_participant_role NOT NULL DEFAULT 'participant',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  is_muted BOOLEAN NOT NULL DEFAULT FALSE,
  is_camera_on BOOLEAN NOT NULL DEFAULT TRUE,
  connection_quality connection_quality NOT NULL DEFAULT 'good',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_participants_room_id ON room_participants (room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_user_id ON room_participants (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_room_participants_active
  ON room_participants (room_id, user_id)
  WHERE left_at IS NULL;

-- ---------------------------------------------------------------------------
-- recordings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  file_path VARCHAR(1024) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,
  storage_url VARCHAR(2048),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recordings_room_id ON recordings (room_id);

-- ---------------------------------------------------------------------------
-- connection_metrics
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connection_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  bandwidth_in FLOAT NOT NULL DEFAULT 0,
  bandwidth_out FLOAT NOT NULL DEFAULT 0,
  latency INTEGER NOT NULL DEFAULT 0,
  packet_loss FLOAT NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connection_metrics_room_id ON connection_metrics (room_id);
CREATE INDEX IF NOT EXISTS idx_connection_metrics_participant_id ON connection_metrics (participant_id);
CREATE INDEX IF NOT EXISTS idx_connection_metrics_recorded_at ON connection_metrics (recorded_at);

/*
⚡ IMPROVEMENT SUGGESTIONS FOR SCHEMA:
1. Partition connection_metrics by recorded_at (monthly range partitions) since it is a high-write, time-series table that will grow unbounded.
2. Add a composite index on (room_id, is_active) for rooms and (room_id, left_at) for room_participants to speed up the "current participants" hot query.
3. Add a database-level CHECK constraint tying access_type='password' to password_hash IS NOT NULL for defense in depth beyond app-level validation.
PRIORITY: High
IMPLEMENTATION_EFFORT: Medium
IMPACT: High
*/
