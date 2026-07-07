-- Migration 018: cross-artist collaboration on showcase tables
--
-- An artist (A) may place another artist's (B) model on their showcase only with
-- B's consent. Placing a foreign model sends B a per-table collaboration request;
-- A cannot publish the table until B accepts. B may approve ALL of their models on
-- the table (`approve_all = true`) or a specific subset (rows in
-- table_collaboration_models). Once accepted, B is credited on the table via the
-- existing table_models → /contributors machinery.
--
-- Scope is per-table: a fresh request is needed to use B's models on another table.

CREATE TABLE IF NOT EXISTS table_collaborations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_id UUID NOT NULL REFERENCES user_tables(id) ON DELETE CASCADE,
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- table owner (A)
    collaborator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- model owner (B)
    status VARCHAR(16) NOT NULL DEFAULT 'pending',   -- pending | accepted | declined
    approve_all BOOLEAN NOT NULL DEFAULT false,      -- B approved all their models on the table
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMPTZ,
    UNIQUE (table_id, collaborator_id)
);

CREATE INDEX IF NOT EXISTS idx_table_collabs_table ON table_collaborations(table_id);
CREATE INDEX IF NOT EXISTS idx_table_collabs_collaborator ON table_collaborations(collaborator_id);

-- The approved subset when approve_all = false. Ignored (but harmless) when
-- approve_all = true.
CREATE TABLE IF NOT EXISTS table_collaboration_models (
    collaboration_id UUID NOT NULL REFERENCES table_collaborations(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    PRIMARY KEY (collaboration_id, model_id)
);
