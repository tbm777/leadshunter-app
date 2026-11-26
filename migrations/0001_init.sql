-- Core schema for LeadsHunter phase 1 (leads).
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
INSERT OR IGNORE INTO meta (k, v) VALUES ('seq', '0');

CREATE TABLE IF NOT EXISTS industries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  terms TEXT NOT NULL,              -- JSON array of search terms
  categories TEXT NOT NULL DEFAULT '[]', -- JSON array of accepted Google categories
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'search',  -- search | check
  name TEXT NOT NULL,
  industry_id INTEGER,
  params TEXT NOT NULL,                 -- JSON: terms, locations, depth, emails, ids
  cells TEXT NOT NULL DEFAULT '[]',     -- JSON array of [lat, lon, radius_m, zoom, termIdx]
  done_bits TEXT NOT NULL DEFAULT '',   -- base64 bitset of finished cells
  status TEXT NOT NULL DEFAULT 'queued',-- queued | running | done | failed | cancelled
  limit_n INTEGER NOT NULL DEFAULT 0,
  total_tasks INTEGER NOT NULL DEFAULT 0,
  done_tasks INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  dup INTEGER NOT NULL DEFAULT 0,
  excluded INTEGER NOT NULL DEFAULT 0,
  to_check INTEGER NOT NULL DEFAULT 0,
  checked INTEGER NOT NULL DEFAULT 0,
  limit_reached INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  run_url TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  heartbeat_at INTEGER
);
CREATE INDEX IF NOT EXISTS searches_status ON searches (status);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  seq INTEGER NOT NULL,
  place_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  industry_id INTEGER,
  address TEXT,
  city TEXT,
  region TEXT,
  postal TEXT,
  country TEXT,
  lat REAL,
  lon REAL,
  phone TEXT,
  phone_e164 TEXT,
  website TEXT,
  domain TEXT,
  rating REAL,
  reviews INTEGER NOT NULL DEFAULT 0,
  maps_url TEXT,
  closed INTEGER NOT NULL DEFAULT 0,
  site_status INTEGER NOT NULL DEFAULT 3,  -- 0 loads 1 slow 2 down 3 not checked 4 no website 5 blocked 6 parked 7 social page
  site_ms INTEGER,
  form_status INTEGER NOT NULL DEFAULT 3,  -- 0 open form 1 captcha 2 none found 3 not checked 4 needs browser check
  form_url TEXT,
  captcha TEXT,
  platform TEXT,
  email TEXT,
  checked_at INTEGER,
  status INTEGER NOT NULL DEFAULT 0,       -- 0 new 1 in campaign 2 contacted 3 do not contact
  notes TEXT,
  search_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS leads_seq ON leads (seq);
CREATE INDEX IF NOT EXISTS leads_domain ON leads (domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_phone ON leads (phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_search_check ON leads (search_id, checked_at);

CREATE TABLE IF NOT EXISTS excluded (
  search_id INTEGER NOT NULL,
  place_id TEXT NOT NULL,
  name TEXT,
  category TEXT,
  address TEXT,
  PRIMARY KEY (search_id, place_id)
);

CREATE TABLE IF NOT EXISTS views (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  filters TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
