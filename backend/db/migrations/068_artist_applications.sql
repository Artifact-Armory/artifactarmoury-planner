-- 068_artist_applications.sql
--
-- In-app artist applications. Until now "apply" meant emailing a portfolio to
-- artists@, with nothing recorded and nowhere for an admin to review it. A
-- signed-in user now submits their details and portfolio images here; an admin
-- approves (which mints a single-use invite code and emails it) or rejects
-- (which emails the reason).
--
-- The decision reason is stored with the row: it is what the applicant was told,
-- so it has to survive as evidence of what we said and why.

CREATE TABLE IF NOT EXISTS artist_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Snapshot of who applied, since the account email can change later.
    applicant_name VARCHAR(200) NOT NULL,
    applicant_email VARCHAR(255) NOT NULL,
    -- The store name they want buyers to see.
    artist_name VARCHAR(80) NOT NULL,
    about TEXT NOT NULL,
    what_you_make TEXT NOT NULL,
    website_url VARCHAR(500),
    social_links JSONB NOT NULL DEFAULT '[]'::jsonb,
    sells_elsewhere TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    decision_reason TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP,
    -- Set on approval; the code that was emailed to the applicant.
    invite_code_id UUID REFERENCES invite_codes(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_artist_applications_status
    ON artist_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artist_applications_user
    ON artist_applications (user_id, created_at DESC);

-- One open application per person at a time. Re-applying after a rejection is
-- fine (that row is no longer 'pending'); double-submitting is not.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_artist_applications_one_pending
    ON artist_applications (user_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS artist_application_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID NOT NULL REFERENCES artist_applications(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255),
    content_type VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_artist_application_images_app
    ON artist_application_images (application_id);
