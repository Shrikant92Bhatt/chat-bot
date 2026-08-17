export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  picture TEXT,
  last_login BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  user_uid TEXT NOT NULL,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  messages JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_user_uid ON chat_threads (user_uid);
`;
