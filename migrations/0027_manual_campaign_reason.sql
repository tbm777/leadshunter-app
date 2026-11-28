-- In a manual campaign you send every form yourself, so its tasks are "Manual" (a known CAPTCHA shows as a detail).
UPDATE outreach SET reason = 'manual'
WHERE status = 'manual' AND reason = 'captcha' AND step = 1
  AND campaign_id IN (SELECT id FROM campaigns WHERE mode = 'manual');
