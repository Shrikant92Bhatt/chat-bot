-- Initial schema for the Firestore -> Postgres migration (see
-- VERCEL_MIGRATION.md). Mirrors each former Firestore collection one-to-one
-- rather than introducing a new data model, to keep this a port, not a
-- redesign - the one deliberate exception is rag_documents, which replaces
-- an in-memory, per-process vector store that was already documented as
-- broken across restarts/instances (see rag/vector-db.ts) and is strictly
-- worse on Vercel's even-more-ephemeral serverless functions.
--
-- Run against a fresh database with: psql "$DATABASE_URL" -f 001_init.sql
-- (or let db/postgres.ts's runMigrations() apply it automatically - see
-- that file's doc comment).

CREATE EXTENSION IF NOT EXISTS vector;

-- users: was the top-level `users` Firestore collection, doc id = uid.
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  picture TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  last_login BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- threads: was `users/{uid}/threads/{threadId}`. Kept as one JSONB document
-- per thread (matching ChatThread exactly, including its nested messages
-- array) rather than normalized into a messages table - ChatMessage carries
-- a lot of optional, deeply-nested, UI-specific shape (ui blocks, sources,
-- actions, research traces, attachments) that a relational schema would
-- have to re-derive perfectly or risk silently dropping fields on read.
-- Storing it as the same document Firestore did is the lower-risk port;
-- normalizing messages can be a follow-up if querying into message
-- internals from SQL ever becomes a real need.
CREATE TABLE IF NOT EXISTS threads (
  uid TEXT NOT NULL,
  id TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (uid, id)
);
CREATE INDEX IF NOT EXISTS idx_threads_uid_updated ON threads (uid, updated_at DESC);

-- projects: was the top-level `projects` collection, filtered by ownerId.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner_id);

-- project_files: was `projects/{projectId}/files/{fileId}`. `text` is the
-- extracted document text (rehydration source for the vector store) -
-- server-side only, deliberately excluded from the ProjectFile DTO shipped
-- to clients, same as it was in Firestore.
CREATE TABLE IF NOT EXISTS project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  characters INTEGER NOT NULL,
  uploaded_at BIGINT NOT NULL,
  storage_url TEXT,
  text TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files (project_id);

-- memories: was the top-level `memories` collection, filtered by userId.
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  source_thread_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories (user_id);

-- usage: was the top-level `usage` collection (one doc per logged LLM call).
-- `created_at` is Firestore's `timestamp` field, renamed because TIMESTAMP
-- is a reserved word and this app already treats it as an epoch-ms number,
-- not a SQL timestamp type - mapped back to `timestamp` in UsageRecord at
-- the application layer so no caller changes.
CREATE TABLE IF NOT EXISTS usage (
  request_id TEXT PRIMARY KEY,
  user_id TEXT,
  tenant_id TEXT,
  conversation_id TEXT,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'chat',
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER NOT NULL,
  estimated_cost_usd DOUBLE PRECISION,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage (created_at);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage (user_id);

-- rate_limits: was the top-level `rateLimits` collection (anon-usage.service.ts).
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- settings: was the `settings` collection's two singleton docs
-- (system_limits, model_config) - kept as a generic key/JSONB table since
-- both services already treated their doc as "one JSON blob in, one JSON
-- blob out" with app-side validation, not a relational shape.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- message_feedback: was the top-level `messageFeedback` collection, doc id
-- `${uid}_${threadId}_${messageId}`. That composite doc id was purely a
-- natural idempotency key in Firestore - it's the primary key here instead,
-- which is the more direct SQL expression of the same constraint.
CREATE TABLE IF NOT EXISTS message_feedback (
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  rating TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, thread_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_message_feedback_thread ON message_feedback (thread_id);

-- rag_documents: replaces rag/vector-db.ts's in-memory VectorDbAdapter.
-- 256 dimensions matches EMBEDDING_DIMS there - same hashing embedding
-- function, just a persisted store underneath it instead of a process-local
-- array that's lost on every cold start.
CREATE TABLE IF NOT EXISTS rag_documents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT,
  content TEXT NOT NULL,
  embedding vector(256) NOT NULL,
  metadata JSONB,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rag_documents_owner ON rag_documents (owner_id);
CREATE INDEX IF NOT EXISTS idx_rag_documents_project ON rag_documents (project_id);
-- Cosine-distance HNSW index - fast approximate nearest-neighbor search.
-- Exact brute-force cosine search (what the in-memory version did) remains
-- correct without this index too; it just keeps lookups fast as the table
-- grows past what a per-user/per-project scan comfortably handles.
CREATE INDEX IF NOT EXISTS idx_rag_documents_embedding ON rag_documents
  USING hnsw (embedding vector_cosine_ops);
