PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consent_id TEXT NOT NULL UNIQUE,
  terms_version TEXT NOT NULL,
  agreed_at TEXT NOT NULL,
  user_identifier TEXT NOT NULL CHECK(length(user_identifier) BETWEEN 1 AND 100),
  display_name TEXT,
  client_type TEXT NOT NULL CHECK(client_type IN ('pickle','web')),
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  consent_token_hash TEXT NOT NULL,
  auto_upload_allowed INTEGER NOT NULL DEFAULT 0 CHECK(auto_upload_allowed IN (0,1))
);
CREATE TABLE IF NOT EXISTS download_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id TEXT NOT NULL UNIQUE,
  item_id TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK(item_kind IN ('connector','recipe')),
  version TEXT NOT NULL,
  consent_id TEXT NOT NULL REFERENCES consents(consent_id),
  user_identifier TEXT NOT NULL,
  client_type TEXT NOT NULL CHECK(client_type IN ('pickle','web')),
  ip_address TEXT,
  user_agent TEXT,
  downloaded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS item_stats (
  item_id TEXT PRIMARY KEY,
  item_kind TEXT NOT NULL CHECK(item_kind IN ('connector','recipe')),
  total_downloads INTEGER NOT NULL DEFAULT 0 CHECK(total_downloads >= 0),
  last_downloaded_at TEXT
);
CREATE INDEX IF NOT EXISTS downloads_time ON download_logs(downloaded_at);
CREATE INDEX IF NOT EXISTS downloads_item_version ON download_logs(item_id,version);
CREATE INDEX IF NOT EXISTS downloads_user ON download_logs(user_identifier,downloaded_at);
CREATE INDEX IF NOT EXISTS consents_user ON consents(user_identifier);
