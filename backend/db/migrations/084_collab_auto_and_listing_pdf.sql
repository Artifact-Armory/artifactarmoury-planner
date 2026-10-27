-- 084_collab_auto_and_listing_pdf.sql
--
-- 1. Artists can answer collaboration requests automatically. 'manual' (default)
--    keeps the current flow; 'accept' approves all their models on the table at
--    once; 'decline' turns the request down. Only affects new requests.
-- 2. One extra PDF per listing (game rules, painting guide…). Kept out of the
--    models table so the R2 key never rides along on a models.* read. Buyers can
--    always download it; is_public makes it free to anyone from the listing page.

ALTER TABLE users ADD COLUMN IF NOT EXISTS collab_auto_response VARCHAR(10) NOT NULL DEFAULT 'manual';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_collab_auto_response_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_collab_auto_response_check
      CHECK (collab_auto_response IN ('manual', 'accept', 'decline'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS model_documents (
    model_id   UUID PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
    file_path  TEXT NOT NULL,            -- R2 key (docs/…pdf); never sent to clients
    file_name  VARCHAR(100) NOT NULL,    -- name the buyer's download is saved as
    size_bytes BIGINT NOT NULL,
    is_public  BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
