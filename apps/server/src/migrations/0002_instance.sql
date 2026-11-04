-- Mode instance : personnes, usage des espaces, journal des envois, réservations.
CREATE TABLE user (
  id TEXT PRIMARY KEY,                  -- base62, 10 caractères, aléatoire et stable
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  quota_override INTEGER,               -- octets ; NULL = quota des rôles
  roles_cache TEXT NOT NULL DEFAULT '[]', -- JSON : rôles Drive vus à la dernière connexion
  terms_version TEXT,
  terms_accepted_at INTEGER,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER,
  UNIQUE (issuer, subject)
) STRICT;
CREATE INDEX user_email ON user (email);

-- Colonnes du mode instance sur la session.
ALTER TABLE session ADD COLUMN user_id TEXT REFERENCES user (id) ON DELETE CASCADE;
ALTER TABLE session ADD COLUMN roles TEXT;           -- JSON : instantané des rôles Drive
ALTER TABLE session ADD COLUMN roles_at INTEGER;
ALTER TABLE session ADD COLUMN refresh_enc TEXT;     -- jeton de rafraîchissement chiffré par la clé de session
ALTER TABLE session ADD COLUMN id_token_enc TEXT;    -- jeton d'identité chiffré (déconnexion)
CREATE INDEX session_user ON session (user_id);

CREATE TABLE space_usage (
  space_id TEXT NOT NULL,
  owner_id TEXT NOT NULL DEFAULT '',    -- id de la personne pour home, '' pour un espace partagé
  bytes INTEGER NOT NULL DEFAULT 0,
  objects INTEGER NOT NULL DEFAULT 0,
  reserved_bytes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  recounted_at INTEGER,
  PRIMARY KEY (space_id, owner_id)
) STRICT;

-- Une ligne par envoi en cours : la somme alimente space_usage.reserved_bytes.
CREATE TABLE upload_reservation (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  owner_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,                    -- clé relative à l'espace
  size INTEGER NOT NULL,
  replaced_size INTEGER,                -- taille de l'objet remplacé, s'il existait
  upload_id TEXT,                       -- multipart ; NULL pour un PUT simple
  part_size INTEGER,
  part_count INTEGER,
  content_type TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX upload_reservation_space ON upload_reservation (space_id, owner_id);
CREATE INDEX upload_reservation_key ON upload_reservation (space_id, owner_id, key);
CREATE INDEX upload_reservation_upload ON upload_reservation (upload_id);
CREATE INDEX upload_reservation_expires ON upload_reservation (expires_at);

-- Journal des envois : IP complète, gardé legal.uploadLogDays jours.
CREATE TABLE upload_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  user_id TEXT NOT NULL,                -- sans clé étrangère : le journal survit à la personne
  ip TEXT,
  user_agent TEXT,
  space_id TEXT NOT NULL,
  key TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT,
  etag TEXT,
  source TEXT NOT NULL CHECK (source IN ('web', 'api', 'mcp', 'share'))
) STRICT;
CREATE INDEX upload_log_at ON upload_log (at);
CREATE INDEX upload_log_user ON upload_log (user_id, at);
