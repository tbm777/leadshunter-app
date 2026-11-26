-- Count of businesses skipped because they were outside the search's review range.
ALTER TABLE searches ADD COLUMN filtered INTEGER NOT NULL DEFAULT 0;
