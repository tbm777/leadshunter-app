-- Indexes for the busiest queries, so they read only the rows they need (Cloudflare's free plan counts every row read).
CREATE INDEX IF NOT EXISTS leads_seq ON leads (seq);                                   -- the app's sync: WHERE seq > ? ORDER BY seq
CREATE INDEX IF NOT EXISTS searches_campaign ON searches (campaign_id, kind, id);      -- latest run per campaign, checked every 10 minutes
CREATE INDEX IF NOT EXISTS outreach_events_outreach ON outreach_events (outreach_id, step);
CREATE INDEX IF NOT EXISTS outreach_review ON outreach (campaign_id) WHERE shot_at IS NOT NULL AND review IS NULL;
CREATE INDEX IF NOT EXISTS outreach_sending ON outreach (campaign_id) WHERE status = 'sending';   -- forms in flight (a handful at most)
CREATE INDEX IF NOT EXISTS outreach_campaign_sent ON outreach (campaign_id, sent_at) WHERE sent_at IS NOT NULL;   -- today's sends per campaign
