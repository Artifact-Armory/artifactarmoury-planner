-- Migration 011: faceted taxonomy (facets · terms · model_terms · virtual_categories)
--
-- The marketplace taxonomy IS the browsing UX. This replaces the single loose
-- `models.category` enum with a normalised, DB-driven vocabulary:
--
--   facets              one row per browsing axis (Terrain Type, Setting & Era, Scale…)
--   terms               the controlled vocabulary, hierarchical WITHIN a facet
--                       (parent_id + a materialised `path` for fast descendant roll-up)
--   model_terms         model ⇄ term many-to-many == a model can hold several terms
--                       per facet (multi-value) and cross facets freely
--   virtual_categories  merchandising layer: curated browse pages defined as a saved
--                       set of term paths (e.g. "Ruins", "Bocage Country") — no schema
--                       change to add one
--
-- Filtering semantics (implemented in routes/browse.ts): OR within a facet, AND
-- across facets; selecting a parent term matches every descendant via `path`.
-- The legacy models.category / tags columns are left intact for back-compat.

CREATE TABLE IF NOT EXISTS facets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(60) UNIQUE NOT NULL,          -- immutable identifier (URLs, saved filters)
    name VARCHAR(120) NOT NULL,
    description TEXT,
    -- how the filter rail renders this facet: a deep 'tree', flat 'chips',
    -- or 'grouped' (2-level groups of chips)
    selection_ui VARCHAR(20) NOT NULL DEFAULT 'chips'
        CHECK (selection_ui IN ('tree', 'chips', 'grouped', 'flat')),
    is_required BOOLEAN NOT NULL DEFAULT false, -- must be tagged at upload (guardrail)
    max_terms INTEGER,                          -- cap free-choice terms per facet (NULL = unlimited)
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS terms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    facet_id UUID NOT NULL REFERENCES facets(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES terms(id) ON DELETE CASCADE,
    slug VARCHAR(80) NOT NULL,                  -- unique among siblings
    name VARCHAR(160) NOT NULL,
    -- full slug path from the facet root, e.g. 'buildings/residential/cottages-farmhouses'.
    -- Unique within a facet and the stable identifier used in URLs + roll-up queries.
    path VARCHAR(400) NOT NULL,
    depth INTEGER NOT NULL DEFAULT 0,
    synonyms TEXT[],                            -- search only, never displayed
    description TEXT,
    ratio VARCHAR(24),                          -- scale facet only (e.g. '1:56')
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (facet_id, path),
    UNIQUE (facet_id, parent_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_terms_facet ON terms(facet_id);
CREATE INDEX IF NOT EXISTS idx_terms_parent ON terms(parent_id);
-- prefix match on path for descendant roll-up: WHERE path LIKE 'buildings/%'
CREATE INDEX IF NOT EXISTS idx_terms_path ON terms(facet_id, path varchar_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_terms_synonyms ON terms USING GIN(synonyms);

CREATE TABLE IF NOT EXISTS model_terms (
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    term_id UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (model_id, term_id)
);

CREATE INDEX IF NOT EXISTS idx_model_terms_term ON model_terms(term_id);

CREATE TABLE IF NOT EXISTS virtual_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(80) UNIQUE NOT NULL,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    -- saved facet combination, e.g. { "terms": ["terrain-type:buildings", "condition:ruined"] }
    filter_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    hero_image VARCHAR(500),
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
