CREATE TABLE IF NOT EXISTS model_watermarks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    artist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    watermark_token UUID NOT NULL,
    metadata JSONB NOT NULL,
    hash_signature TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (model_id),
    UNIQUE (hash_signature)
);

CREATE INDEX IF NOT EXISTS idx_model_watermarks_artist ON model_watermarks (artist_id);
