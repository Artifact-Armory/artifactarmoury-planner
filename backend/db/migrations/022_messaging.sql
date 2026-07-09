-- Migration 022: direct messaging + site messages
--
-- Two-sided messaging for the marketplace:
--
--  1. DIRECT (buyer <-> artist). Any signed-in user may start a thread with an
--     artist (from a model/artist page); both sides can reply. A conversation is
--     between exactly two users and de-duplicated by a canonical `pair_key`
--     (sorted "uuidA:uuidB") so re-opening returns the existing thread. Only pairs
--     where at least one side is an artist/admin are allowed (enforced in code) —
--     no customer<->customer DMs.
--
--  2. SYSTEM (site -> user). Admins send either a one-to-one support message or a
--     broadcast announcement fanned out to many recipients. System messages have
--     sender_id = NULL and render as "Artifact Armoury". `allow_replies` controls
--     whether the recipient can reply (true for support threads, false for
--     broadcasts).
--
-- Unread tracking is per participant via `last_read_at`: a message counts as
-- unread for a user if created_at > their last_read_at and they didn't send it.
--
-- Shadow-banned users are blocked from SENDING (enforced in code) — this is the
-- "messaging" restriction anticipated in migration 021's comments.

-- ============================================================================
-- CONVERSATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    kind VARCHAR(20) NOT NULL DEFAULT 'direct'
        CHECK (kind IN ('direct', 'system')),

    subject VARCHAR(255),                 -- optional; used as the title for broadcasts

    -- Canonical two-user key for direct threads ("minId:maxId"). NULL for system
    -- conversations. The partial unique index keeps one thread per pair.
    pair_key VARCHAR(80),

    -- true  -> recipients can reply (direct threads, admin support DMs)
    -- false -> one-way (broadcast announcements)
    allow_replies BOOLEAN NOT NULL DEFAULT true,

    created_by UUID REFERENCES users(id) ON DELETE SET NULL,

    last_message_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_message_preview TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_pair
    ON conversations(pair_key)
    WHERE pair_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_last_message
    ON conversations(last_message_at DESC);

-- ============================================================================
-- PARTICIPANTS  (who can see a conversation, and their read cursor)
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Read cursor: messages after this instant (that the user didn't send) are unread.
    -- Epoch default => a brand-new participant sees all existing messages as unread.
    last_read_at TIMESTAMP NOT NULL DEFAULT to_timestamp(0),

    -- Hide a thread from the inbox without deleting it.
    archived BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_participants_user
    ON conversation_participants(user_id);

-- ============================================================================
-- MESSAGES
-- ============================================================================

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

    -- NULL sender = the site/system (rendered as "Artifact Armoury"). A real user id
    -- otherwise. `is_system` also flags admin-authored support replies so they render
    -- as the site even though sender_id is a real admin.
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_system BOOLEAN NOT NULL DEFAULT false,

    body TEXT NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, created_at);
