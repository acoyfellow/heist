CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  handle TEXT NOT NULL,
  attack TEXT NOT NULL,
  injection_probability REAL NOT NULL,
  reply TEXT NOT NULL,
  leaked INTEGER NOT NULL,
  broke_in INTEGER NOT NULL
);
CREATE INDEX attempts_broke_in ON attempts (broke_in, created_at);
