-- Leads that passed a search's contact form filter.
ALTER TABLE searches ADD COLUMN qualified INTEGER NOT NULL DEFAULT 0;
