-- Small indexes so the campaign pages count what they need without reading every outreach row.
CREATE INDEX IF NOT EXISTS outreach_manual ON outreach (campaign_id) WHERE status = 'manual';
CREATE INDEX IF NOT EXISTS outreach_to_review ON outreach (campaign_id) WHERE shot_at IS NOT NULL AND review IS NULL;
CREATE INDEX IF NOT EXISTS leads_replied ON leads (id) WHERE status = 4;
