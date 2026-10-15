// src/config/brand.ts
// Single source of truth for the site name/domain, so it doesn't drift
// across Header/Footer/toasts/emails like it did as "Artifact Planner" /
// "Terrain Builder" / "Artifact Armoury" in three different files.
export const SITE_NAME = 'Artifact Armoury'
export const SITE_DOMAIN = 'artifactarmoury.com'
export const SITE_TAGLINE = 'Plan the table. Print the legend.'
// The one origin search engines should index. www.artifactarmoury.com and
// artifactarmoury-planner.pages.dev serve the same build, so canonical URLs
// are pinned here rather than taken from window.location (which made every
// alternate host canonicalise to itself — Google indexed the www copy).
export const SITE_URL = 'https://artifactarmoury.com'
