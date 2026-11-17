ALTER TABLE consents ADD COLUMN expires_at TEXT;
ALTER TABLE consents ADD COLUMN revoked_at TEXT;
UPDATE consents SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', agreed_at, '+90 days') WHERE expires_at IS NULL;
CREATE TABLE IF NOT EXISTS consent_events (
  event_id TEXT PRIMARY KEY,
  consent_id TEXT NOT NULL REFERENCES consents(consent_id),
  event_type TEXT NOT NULL CHECK(event_type IN ('granted','revoked')),
  occurred_at TEXT NOT NULL,
  UNIQUE(consent_id,event_type)
);
INSERT OR IGNORE INTO consent_events(event_id,consent_id,event_type,occurred_at)
SELECT 'initial-'||consent_id,consent_id,'granted',agreed_at FROM consents;
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL CHECK(hits>0),
  reset_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(reset_at);
CREATE TABLE IF NOT EXISTS maintenance_runs (
  request_id TEXT PRIMARY KEY,
  executed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS maintenance_time ON maintenance_runs(executed_at);
CREATE INDEX IF NOT EXISTS consents_expiry ON consents(expires_at);
