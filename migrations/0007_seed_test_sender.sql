-- Default sender profile and a draft campaign for testing. Address left blank on purpose: the placeholder address is used.
INSERT INTO senders (label, first_name, last_name, email, phone, company, website, created_at)
SELECT 'Alfred · Better websites (test)', 'Alfred', 'Bennett', 'alfred@thebatmarketing.com', '(512) 555-0199', 'The Bat Marketing', 'thebatmarketing.com', CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM senders WHERE email = 'alfred@thebatmarketing.com');

INSERT INTO campaigns (name, sender_id, subject, message, daily_limit, status, created_at, updated_at)
SELECT 'Test: better website', (SELECT id FROM senders WHERE email = 'alfred@thebatmarketing.com' ORDER BY id LIMIT 1),
  'Quick idea for [Company Name]''s website',
  'Hi [Company Name] team,

I was looking at your website and spotted a few quick wins that could bring you more calls: a faster mobile page, a clear "Call now" button at the top, and a short quote form that works well on phones.

Most homeowners decide in a few seconds whether to call you or go back to Google. Small changes like these are often the difference.

We build simple, fast websites for contractors in [City] and handle everything for you, from design to hosting. No long-term contract.

Would you be open to a free 10-minute review of your site this week?

Best,
Alfred
The Bat Marketing',
  20, 'draft', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE name = 'Test: better website');
