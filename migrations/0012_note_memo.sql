-- Messages notes: a separate field for your own thinking (angle, audience, results), apart from the message itself.
ALTER TABLE notes ADD COLUMN memo TEXT NOT NULL DEFAULT '';
