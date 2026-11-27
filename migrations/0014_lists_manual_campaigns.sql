-- Lead lists you make yourself (searches are lists automatically, through leads.search_id).
CREATE TABLE IF NOT EXISTS lists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS list_leads (
  list_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (list_id, lead_id)
);
CREATE INDEX IF NOT EXISTS list_leads_lead ON list_leads (lead_id);
-- Campaign mode: auto (the robot sends) or manual (every form goes to the manual queue).
ALTER TABLE campaigns ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto';
