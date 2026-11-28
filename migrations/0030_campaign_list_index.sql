-- A campaign's lead list is read in pages, in the order leads were added: these let a page stop early instead of
-- reading and sorting the whole campaign.
CREATE INDEX IF NOT EXISTS outreach_campaign_order ON outreach (campaign_id, id);
CREATE INDEX IF NOT EXISTS outreach_campaign_status_order ON outreach (campaign_id, status, id);
