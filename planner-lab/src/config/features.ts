// frontend/src/config/features.ts
//
// Flags for features that are BUILT but deliberately not exposed to users yet.
// Flip one to `true` to bring the whole surface back — the backend for both is
// still live and untouched, so nothing needs re-implementing.
//
// Rule of thumb: dead code gets deleted, unfinished features get flagged.
// If a flag has been `false` for a long time, that's a signal to either finish
// the feature or delete it — don't let this file become a graveyard.

/**
 * Pre-existing flag, kept as-is. NOTE: nothing in the app currently imports it,
 * so it is a no-op — either wire it to the showcase UI or delete it.
 */
export const MODEL_SHOWCASE_ENABLED =
  (import.meta.env.VITE_ENABLE_MODEL_SHOWCASE ?? 'false').toLowerCase() === 'true'

export const FEATURES = {
  /**
   * Print & Ship (buyer orders a printed, shipped model).
   *
   * Why off: quoting, artist consent, pricing and badges are all built, but
   * there is no checkout — the buyer button only fired a "coming soon" toast,
   * so Browse's Print & Ship tab led to a dead end. Backend endpoints
   * (`POST /models/:id/print-quote`, printEstimator, printProvider) still work.
   *
   * To re-enable: build the print checkout flow, then set this to true.
   */
  printAndShip: false,

  /**
   * Terrain sculpting: landform stamps (hill/plateau/depression, place +
   * reposition/resize) + a detail brush on top (raise/lower/smooth/flatten)
   * + printable STL tile export.
   *
   * planner-lab ONLY: forced true here to test the 2026-09-02 rebuild
   * (see memory project_planner_lab). frontend/src/config/features.ts keeps
   * this false — do not flip it there without the user's explicit go-ahead,
   * per [[feedback_planner_lab_isolation]]. The backend
   * (`/tables/:id/terrain/quote`, `/terrain/download`, services/terrainTiles.ts)
   * is untouched either way, and heightmaps on already-saved tables always
   * load and render regardless of this flag.
   *
   * Note: ground-texture painting is a separate, working feature and stays on.
   */
  terrainSculpt: true,
} as const
