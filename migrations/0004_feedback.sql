CREATE TABLE IF NOT EXISTS feedbacks (
  feedback_id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('bug','suggestion','question','other')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 5000),
  submitted_by TEXT CHECK(submitted_by IS NULL OR length(submitted_by) BETWEEN 1 AND 60),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedbacks_created_at ON feedbacks(created_at);
