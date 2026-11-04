-- Sessions navigateur et journal d'audit, forme minimale commune aux deux modes.
-- Le mode personnel ajoutera session_connection, connection, etc. dans ses propres migrations.
CREATE TABLE session (
  id TEXT PRIMARY KEY,                  -- 32 hex, partie publique du cookie
  lineage TEXT NOT NULL,                -- identité stable à travers les rotations
  secret_hash TEXT NOT NULL,            -- sha256(secret) en hexadécimal
  kind TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard', 'shared_device')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  rotated_at INTEGER,
  user_agent TEXT,
  ip TEXT
) STRICT;
CREATE INDEX session_lineage ON session (lineage);
CREATE INDEX session_expires ON session (expires_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  connection_id TEXT,                   -- NULL : événement d'instance ; sans clé étrangère
  source TEXT NOT NULL,                 -- web, mcp, api, share, system
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'error')),
  bucket TEXT,
  key TEXT,
  details TEXT,                         -- JSON, sans secret
  ip TEXT
) STRICT;
CREATE INDEX audit_log_conn ON audit_log (connection_id, id DESC);
CREATE INDEX audit_log_conn_action ON audit_log (connection_id, action);
CREATE INDEX audit_log_conn_object ON audit_log (connection_id, bucket, key);
CREATE INDEX audit_log_at ON audit_log (at);
