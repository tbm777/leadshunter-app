-- Test-run screenshots (kept 14 days in KV) and your verdict on each, which feed the accuracy scorecard.
ALTER TABLE outreach ADD COLUMN shot_at INTEGER;
ALTER TABLE outreach ADD COLUMN review TEXT;       -- right | wrong_fields | not_contact | correct_none | missed_form | captcha_ok | captcha_wrong
ALTER TABLE outreach ADD COLUMN review_at INTEGER;
