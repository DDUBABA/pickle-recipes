-- Public, reviewed catalog only. Consent and telemetry tables are unchanged.
CREATE TABLE catalog_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision TEXT NOT NULL,
  source_sha TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE TABLE catalog_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('recipe','connector','bridge')),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  sha256 TEXT NOT NULL
);
CREATE TABLE catalog_files (
  path TEXT PRIMARY KEY,
  item_id TEXT REFERENCES catalog_items(id) ON DELETE CASCADE,
  bundle_path TEXT,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  CHECK ((item_id IS NULL) = (bundle_path IS NULL))
);
CREATE INDEX catalog_files_item ON catalog_files(item_id);
-- A failed compare-and-swap aborts the entire REST batch, including deletions.
CREATE TABLE catalog_sync_guard (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  valid INTEGER NOT NULL CHECK (valid = 1)
);
