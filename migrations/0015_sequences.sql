-- Follow-up sequences. Step 1 is the campaign's own subject and message; steps 2 and 3 live here.
CREATE TABLE IF NOT EXISTS campaign_steps (
  campaign_id INTEGER NOT NULL,
  step INTEGER NOT NULL,                 -- 2 or 3
  channel TEXT NOT NULL DEFAULT 'form',  -- form | call
  delay_days INTEGER NOT NULL DEFAULT 3, -- business days after the previous step
  subject TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',      -- form message, or the call script
  PRIMARY KEY (campaign_id, step)
);
ALTER TABLE outreach ADD COLUMN step INTEGER NOT NULL DEFAULT 1;   -- the step this lead is on
ALTER TABLE outreach ADD COLUMN next_at INTEGER;                   -- when the next step is due (NULL = nothing scheduled)
ALTER TABLE outreach ADD COLUMN prev_status TEXT;                  -- status to return to if a follow-up is cancelled
CREATE INDEX IF NOT EXISTS outreach_next ON outreach (campaign_id, next_at) WHERE next_at IS NOT NULL;
-- Everything that happened to a lead in a campaign, for the lead's timeline.
CREATE TABLE IF NOT EXISTS outreach_events (
  id INTEGER PRIMARY KEY,
  outreach_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  step INTEGER NOT NULL,
  kind TEXT NOT NULL,                    -- sent | submitted | sent_manual | failed | call_talked | call_voicemail | call_noanswer | stopped
  detail TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outreach_events_lead ON outreach_events (lead_id, at);
