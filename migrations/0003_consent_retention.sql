ALTER TABLE consents ADD COLUMN last_used_at TEXT;
CREATE INDEX IF NOT EXISTS downloads_consent_time ON download_logs(consent_id,downloaded_at);
-- Preserve the most recent known activity for existing consents. Do not grant a new consent.
UPDATE consents SET expires_at=NULL,
  last_used_at=MAX(agreed_at,COALESCE((SELECT MAX(downloaded_at) FROM download_logs WHERE download_logs.consent_id=consents.consent_id),agreed_at));
DROP INDEX IF EXISTS consents_expiry;
CREATE INDEX IF NOT EXISTS consents_activity ON consents(COALESCE(last_used_at,agreed_at)) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS consents_revocation ON consents(revoked_at) WHERE revoked_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS retention_state (
  name TEXT PRIMARY KEY CHECK(name='retention'),
  last_run_at TEXT NOT NULL,
  run_id TEXT NOT NULL
);
