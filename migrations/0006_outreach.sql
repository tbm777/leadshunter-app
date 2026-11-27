-- Phase 2: outreach through contact forms.
CREATE TABLE IF NOT EXISTS senders (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', zip TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT 'United States',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sender_id INTEGER,
  subject TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  file_template TEXT NOT NULL DEFAULT 'bat-marketing',
  daily_limit INTEGER NOT NULL DEFAULT 100,
  window_start INTEGER NOT NULL DEFAULT 8,     -- hour, Los Angeles time
  window_end INTEGER NOT NULL DEFAULT 18,
  weekdays TEXT NOT NULL DEFAULT '12345',      -- 0 = Sunday
  status TEXT NOT NULL DEFAULT 'draft',        -- draft | active | paused | archived
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One row per lead in a campaign.
CREATE TABLE IF NOT EXISTS outreach (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | sending | sent | submitted | manual | sent_manual | failed | skipped
  reason TEXT,
  evidence TEXT,
  form_url TEXT,
  job_id INTEGER,
  test_job INTEGER,
  test_status TEXT,                       -- ready | manual | failed (from a test run, nothing sent)
  test_reason TEXT,
  test_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  attempt_at INTEGER,                     -- set when the runner starts on this form (tells a crash apart from never tried)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER,
  UNIQUE (campaign_id, lead_id)
);
CREATE INDEX IF NOT EXISTS outreach_campaign ON outreach (campaign_id, status);
CREATE INDEX IF NOT EXISTS outreach_lead ON outreach (lead_id);
CREATE INDEX IF NOT EXISTS outreach_job ON outreach (job_id);
CREATE INDEX IF NOT EXISTS outreach_test ON outreach (test_job);
CREATE INDEX IF NOT EXISTS outreach_sent ON outreach (sent_at) WHERE sent_at IS NOT NULL;

ALTER TABLE searches ADD COLUMN campaign_id INTEGER;
