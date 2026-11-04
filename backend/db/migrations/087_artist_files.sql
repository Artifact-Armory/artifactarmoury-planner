-- 087_artist_files.sql
--
-- Artist file library (artist feedback, 3 Nov 2026): an artist uploads many
-- model files at once into "My files", then picks from them when creating a
-- listing or adding models to one. Library objects live under the R2 prefix
-- library/. Picking a file copies it to a fresh raw/ key for the normal upload
-- flow, so a listing never shares an object with the library or another listing,
-- and deleting a library file can't break a listing.

CREATE TABLE IF NOT EXISTS artist_files (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    r2_key      VARCHAR(255) NOT NULL UNIQUE,
    file_name   VARCHAR(255) NOT NULL,
    folder      VARCHAR(500),
    size_bytes  BIGINT NOT NULL DEFAULT 0,
    use_count   INTEGER NOT NULL DEFAULT 0,
    last_used_at TIMESTAMP,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_artist_files_artist
    ON artist_files (artist_id, folder, file_name);
