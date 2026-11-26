-- Searches can be removed from history without touching the leads they found.
ALTER TABLE searches ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
