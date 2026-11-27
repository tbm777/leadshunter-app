-- Messages notes: your own order (drag to reorder). Starts as most recently edited first.
ALTER TABLE notes ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
UPDATE notes SET position = (SELECT COUNT(*) FROM notes n2 WHERE n2.updated_at > notes.updated_at OR (n2.updated_at = notes.updated_at AND n2.id > notes.id));
