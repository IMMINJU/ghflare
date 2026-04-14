CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE repos (
  id          SERIAL PRIMARY KEY,
  owner       TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  language    TEXT,
  stars       INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner, name)
);

CREATE TABLE issues (
  id            SERIAL PRIMARY KEY,
  repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  issue_number  INTEGER NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  labels        TEXT[],
  embedding     vector(1536),
  created_at    TIMESTAMPTZ NOT NULL,
  indexed_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(repo_id, issue_number)
);

CREATE INDEX ON issues USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TABLE snapshots (
  id             SERIAL PRIMARY KEY,
  repo_id        INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  issue_count    INTEGER NOT NULL,
  anomaly_score  FLOAT,
  anomaly_level  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(repo_id, date)
);

CREATE TABLE clusters (
  id          SERIAL PRIMARY KEY,
  repo_id     INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  centroid    vector(1536),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cluster_issues (
  cluster_id  INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  issue_id    INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  PRIMARY KEY (cluster_id, issue_id)
);
