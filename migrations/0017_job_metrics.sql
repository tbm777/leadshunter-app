-- Timing and outcome stats per runner job (aggregates only, no lead data). Feeds the scorecard.
CREATE TABLE IF NOT EXISTS job_metrics (
  job_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  mode TEXT,
  campaign_id INTEGER,
  started_at INTEGER,
  finished_at INTEGER NOT NULL,
  status TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_metrics_finished ON job_metrics (finished_at);
