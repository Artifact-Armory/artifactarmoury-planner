-- 086_artist_slugs.sql
--
-- Readable artist page links: /artists/wargame3d instead of /artists/<uuid>.
-- users.artist_slug is made from the artist's name by a trigger, so every way a
-- name gets set (onboarding, profile edit, admin) stays in step without app code.
-- When an artist is renamed their old slug is kept in artist_slug_aliases, so
-- links already shared keep working. Old /artists/<uuid> links work too.

ALTER TABLE users ADD COLUMN IF NOT EXISTS artist_slug VARCHAR(80);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_artist_slug ON users (artist_slug);

CREATE TABLE IF NOT EXISTS artist_slug_aliases (
    slug       VARCHAR(80) PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- "Wargame 3D Studio" -> "wargame-3d-studio"; adds -2, -3… if taken (by another
-- artist's current slug or by someone else's old one).
CREATE OR REPLACE FUNCTION make_artist_slug(p_name TEXT, p_user_id UUID) RETURNS TEXT AS $$
DECLARE
    base TEXT;
    candidate TEXT;
    n INTEGER := 1;
BEGIN
    base := trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'));
    base := left(base, 70);
    base := trim(both '-' from base);
    IF base = '' OR base IN ('me', 'featured', 'search') THEN
        base := 'artist';
    END IF;
    candidate := base;
    LOOP
        EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE artist_slug = candidate AND id <> p_user_id)
              AND NOT EXISTS (SELECT 1 FROM artist_slug_aliases WHERE slug = candidate AND user_id <> p_user_id);
        n := n + 1;
        candidate := base || '-' || n;
    END LOOP;
    RETURN candidate;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION users_set_artist_slug() RETURNS TRIGGER AS $$
DECLARE
    display TEXT;
BEGIN
    IF NEW.role <> 'artist' THEN
        RETURN NEW;
    END IF;
    display := coalesce(nullif(NEW.artist_name, ''), NEW.display_name);
    IF TG_OP = 'INSERT' OR NEW.artist_slug IS NULL
       OR display IS DISTINCT FROM coalesce(nullif(OLD.artist_name, ''), OLD.display_name) THEN
        NEW.artist_slug := make_artist_slug(display, NEW.id);
        -- Keep the old slug pointing at this artist so shared links still work.
        IF TG_OP = 'UPDATE' AND OLD.artist_slug IS NOT NULL AND OLD.artist_slug <> NEW.artist_slug THEN
            INSERT INTO artist_slug_aliases (slug, user_id) VALUES (OLD.artist_slug, NEW.id)
            ON CONFLICT (slug) DO NOTHING;
        END IF;
        -- Renaming back to an old name takes that slug back.
        DELETE FROM artist_slug_aliases WHERE slug = NEW.artist_slug AND user_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_artist_slug ON users;
CREATE TRIGGER trg_users_artist_slug
    BEFORE INSERT OR UPDATE OF artist_name, display_name, role ON users
    FOR EACH ROW EXECUTE FUNCTION users_set_artist_slug();

-- Backfill existing artists, oldest first so the earliest artist keeps the plain slug.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id, coalesce(nullif(artist_name, ''), display_name) AS display
             FROM users WHERE role = 'artist' AND artist_slug IS NULL ORDER BY created_at ASC
    LOOP
        UPDATE users SET artist_slug = make_artist_slug(r.display, r.id) WHERE id = r.id;
    END LOOP;
END $$;
