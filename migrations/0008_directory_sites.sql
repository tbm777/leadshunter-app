-- Leads whose website is a directory or social profile (Houzz, Angi, Yelp…): not a real website, never contacted.
CREATE TABLE IF NOT EXISTS dir_hosts (h TEXT);
DELETE FROM dir_hosts;
INSERT INTO dir_hosts (h) VALUES ('houzz.com'),('houzz.co.uk'),('houzz.com.au'),('angi.com'),('angieslist.com'),('homeadvisor.com'),('thumbtack.com'),('bbb.org'),('porch.com'),('buildzoom.com'),('yellowpages.com'),('yellowpages.ca'),('yellowpages.com.au'),('superpages.com'),('manta.com'),('mapquest.com'),('alignable.com'),('expertise.com'),('networx.com'),('bark.com'),('homeguide.com'),('fixr.com'),('birdeye.com'),('chamberofcommerce.com'),('local.com'),('groupon.com'),('hipages.com.au'),('oneflare.com.au'),('truelocal.com.au'),('yelp.ca'),('yelp.com.au'),('trustpilot.com'),('zillow.com'),('realtor.com'),('dubizzle.com'),('yello.ae'),('google.com'),('goo.gl'),('g.page'),('pinterest.com'),('threads.net'),('tripadvisor.com'),('opentable.com'),('doordash.com'),('ubereats.com'),('grubhub.com'),('yelp.com'),('nextdoor.com'),('linktr.ee');
UPDATE leads SET site_status = 7, form_status = 2, form_url = NULL, captcha = NULL,
  seq = (SELECT CAST(v AS INTEGER) FROM meta WHERE k = 'seq') + id, updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE website IS NOT NULL AND site_status != 7
  AND EXISTS (SELECT 1 FROM dir_hosts WHERE lower(leads.website) LIKE '%://' || h || '%' OR lower(leads.website) LIKE '%://www.' || h || '%' OR lower(leads.website) LIKE '%.' || h || '/%');
UPDATE meta SET v = CAST((SELECT MAX(seq) FROM leads) AS TEXT) WHERE k = 'seq' AND (SELECT MAX(seq) FROM leads) > CAST(v AS INTEGER);
UPDATE outreach SET status = 'skipped', reason = 'directory-page' WHERE status IN ('queued','manual','failed') AND lead_id IN (SELECT id FROM leads WHERE site_status = 7);
DROP TABLE dir_hosts;
