-- A/B test: extra versions of a campaign's first message. Sends rotate across A (the campaign message), B and C.
CREATE TABLE IF NOT EXISTS campaign_variants (
  campaign_id INTEGER NOT NULL,
  variant TEXT NOT NULL,              -- 'B' | 'C'
  subject TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (campaign_id, variant)
);
ALTER TABLE outreach ADD COLUMN variant TEXT;   -- NULL = A
