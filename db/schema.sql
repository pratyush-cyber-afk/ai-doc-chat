CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chunks (
  id           text PRIMARY KEY,
  doc_id       text NOT NULL,
  chunk_index  integer NOT NULL,
  access_level text NOT NULL
               CHECK (access_level IN ('public', 'personnel', 'survey', 'directorate')),
  title        text NOT NULL,
  heading      text NOT NULL,
  content      text NOT NULL,
  embedding    vector(1024) NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS chunks_access_level_idx
  ON chunks (access_level);

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', heading || ' ' || content)) STORED;

CREATE INDEX IF NOT EXISTS chunks_content_tsv_idx
  ON chunks USING GIN (content_tsv);