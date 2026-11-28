-- Undo for forms you marked sent by hand (or from the extension) that didn't actually go out.
ALTER TABLE outreach ADD COLUMN undo_reason TEXT;        -- the task's reason before it was marked sent
ALTER TABLE outreach ADD COLUMN undo_sent_at INTEGER;    -- the previous sent time (a follow-up overwrites it)
ALTER TABLE outreach ADD COLUMN undo_step INTEGER;       -- the step that was marked sent
