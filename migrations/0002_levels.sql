ALTER TABLE attempts ADD COLUMN level INTEGER NOT NULL DEFAULT 5;
CREATE INDEX attempts_level ON attempts (level, broke_in);
