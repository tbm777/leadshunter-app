-- Message variants (an A/B test of the first message): A is the campaign's own message; B, C and D live here, each with
-- its own sender profile. Every lead gets one variant, and its follow-ups come from the same sender.
ALTER TABLE campaign_variants ADD COLUMN sender_id INTEGER;            -- NULL = the campaign's sender profile
ALTER TABLE campaign_variants ADD COLUMN msg_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS variant_messages (                          -- what each variant said, per version (for history)
  campaign_id INTEGER NOT NULL,
  variant TEXT NOT NULL,
  version INTEGER NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, variant, version)
);
-- The sender profile each lead is contacted as (warm-up and daily limits count per profile).
ALTER TABLE outreach ADD COLUMN sender_id INTEGER;
UPDATE outreach SET sender_id = (SELECT sender_id FROM campaigns WHERE campaigns.id = outreach.campaign_id) WHERE sender_id IS NULL;
CREATE INDEX IF NOT EXISTS outreach_sender_sent ON outreach (sender_id, sent_at) WHERE sent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS outreach_sender_sending ON outreach (sender_id) WHERE status = 'sending';
