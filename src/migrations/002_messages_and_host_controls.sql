-- Adds chat message persistence and indexes that support host-control /
-- room-membership authorization checks added alongside it.

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_room_id_created_at ON messages (room_id, created_at);

-- Speeds up the "current participants" hot query and per-user room lookups
-- used by the new recordings/host-control authorization checks.
CREATE INDEX IF NOT EXISTS idx_room_participants_room_id_left_at ON room_participants (room_id, left_at);
CREATE INDEX IF NOT EXISTS idx_room_participants_user_id_left_at ON room_participants (user_id, left_at);
