-- 004_embeddings — Person 4 with Person 3. Permitted text chunks and their pgvector embeddings.
--
-- Embedding identity is NOT fixed yet: backend/.env.example leaves EMBEDDING_MODEL/EMBEDDING_VERSION unset
-- (EMBEDDING_DIMENSIONS defaults to 768). So this migration assumes no model:
--   * the vector column has no fixed dimension; a CHECK ties each row to its declared `dimensions`;
--   * every embedding must reference a row in atlas.embedding_models, which starts EMPTY. Until Persons 3 and 4
--     insert the agreed (model, model_version, dimensions) row, every embedding write fails, so nothing can be
--     indexed under an unagreed identity.
-- Exact (sequential) cosine search only. No ANN index and no performance claim; an HNSW index needs a fixed
-- dimension and a measured need (see db/README.md).
BEGIN;

CREATE TABLE atlas.embedding_models (
  model         text NOT NULL CHECK (btrim(model) <> ''),
  model_version text NOT NULL CHECK (btrim(model_version) <> ''),
  dimensions    integer NOT NULL CHECK (dimensions BETWEEN 1 AND 3072),
  approved_at   timestamptz NOT NULL,
  approved_note text NOT NULL,
  PRIMARY KEY (model, model_version, dimensions)
);

-- Text that may be embedded. Article chunks hold the stored title plus any source-permitted excerpt (never
-- full article text); investigation/evidence chunks hold Atlas-authored, source-linked passages.
CREATE TABLE atlas.text_chunks (
  source_id           text NOT NULL REFERENCES atlas.sources (id) ON DELETE CASCADE,
  chunk_id            text NOT NULL CHECK (atlas.valid_id(chunk_id)),
  article_id          text REFERENCES atlas.articles (id) ON DELETE CASCADE,
  investigation_id    text REFERENCES atlas.investigations (id) ON DELETE CASCADE,
  evidence_id         text REFERENCES atlas.evidence (id) ON DELETE CASCADE,
  text                text NOT NULL CHECK (btrim(text) <> '' AND octet_length(text) <= 16000),
  embedding_permitted boolean NOT NULL DEFAULT false,
  permission_basis    text NOT NULL CHECK (btrim(permission_basis) <> ''),
  -- sha256 hex of the UTF-8 text, maintained by trigger (convert_to is not immutable, so not a generated column).
  -- Matches the backend's createHash('sha256').update(text).
  content_hash        text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, chunk_id),
  CHECK (num_nonnulls(article_id, investigation_id, evidence_id) <= 1)
);
CREATE INDEX text_chunks_article_idx ON atlas.text_chunks (article_id) WHERE article_id IS NOT NULL;

CREATE FUNCTION atlas.text_chunks_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.content_hash := encode(sha256(convert_to(NEW.text, 'UTF8')), 'hex');
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER text_chunks_hash BEFORE INSERT OR UPDATE OF text ON atlas.text_chunks
  FOR EACH ROW EXECUTE FUNCTION atlas.text_chunks_hash();

CREATE TABLE atlas.chunk_embeddings (
  source_id     text NOT NULL,
  chunk_id      text NOT NULL,
  model         text NOT NULL,
  model_version text NOT NULL,
  dimensions    integer NOT NULL,
  -- Hash of the chunk text that was embedded; a later text change makes this row stale (ignored by search).
  content_hash  text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  embedding     vector NOT NULL,
  embedded_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, chunk_id, model, model_version, dimensions),
  FOREIGN KEY (source_id, chunk_id) REFERENCES atlas.text_chunks (source_id, chunk_id) ON DELETE CASCADE,
  FOREIGN KEY (model, model_version, dimensions) REFERENCES atlas.embedding_models (model, model_version, dimensions),
  CHECK (vector_dims(embedding) = dimensions)
);

-- Reject embeddings of non-permitted chunks or of text that has since changed.
CREATE FUNCTION atlas.chunk_embeddings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE chunk atlas.text_chunks;
BEGIN
  SELECT * INTO chunk FROM atlas.text_chunks WHERE source_id = NEW.source_id AND chunk_id = NEW.chunk_id;
  IF NOT FOUND OR NOT chunk.embedding_permitted THEN
    RAISE EXCEPTION 'embedding not permitted for chunk %/%', NEW.source_id, NEW.chunk_id USING ERRCODE = 'check_violation';
  END IF;
  IF chunk.content_hash <> NEW.content_hash THEN
    RAISE EXCEPTION 'content_hash does not match the current chunk text' USING ERRCODE = 'check_violation';
  END IF;
  NEW.embedded_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER chunk_embeddings_guard BEFORE INSERT OR UPDATE ON atlas.chunk_embeddings
  FOR EACH ROW EXECUTE FUNCTION atlas.chunk_embeddings_guard();

INSERT INTO atlas.schema_migrations (version) VALUES ('004_embeddings');
COMMIT;
