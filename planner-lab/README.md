# Planner Lab

Standalone Artifact Armoury planner experiments. This folder is not the deployed frontend and must never be ported or deployed without explicit user authorization.

**Current status:** milestones 1–6 of the printable battlefield pipeline are implemented locally. Start with [IMPLEMENTATION_MEMORY.md](IMPLEMENTATION_MEMORY.md) for decisions, validation results and remaining work. See [docs/MANUFACTURING.md](docs/MANUFACTURING.md) for architecture, limitations and usage.

## Run

Run npm install, then npm run dev. Open http://localhost:3100, click the mountain icon, and scroll to **Local battlefield**.

Save/Open stays in the browser; JSON export/import supports portable designs. Compile exports the current document snapshot through a dedicated worker, with a compiled tile preview and a ZIP of STLs, source design, assembly diagram and validation manifest.

## Isolation

The lab no longer proxies the production backend. The copied marketplace API client cannot send requests. The catalogue uses the bundled demo manifest and ground textures are procedural; this is not a production-data snapshot. No account, database or live payment flow is needed for terrain authoring or export.

The live frontend/ and backend/ are untouched. Changes here do not automatically synchronize with either.

## Checks

- npm run typecheck
- npm run test:manufacturing
- npm run build

Tests cover full-board tiling, solid closure, seam alignment, collision-free assembly, printer bounds, document round trips, brush behavior and undo/redo. Actual printer fit and overhang/support behavior require physical calibration; the user does not currently own a printer.

## Scope boundaries

Hills, plateaus, broad brushes, graded roads, excavated ditches/trenches, vertical cliffs and terrace risers are supported. Physical cracks, potholes, seeded rocks and timber beams compile as solid geometry and appear in the live preview. Import [the step 6 example](docs/examples/step6-battlefield.json) for a mixed four-tile battlefield. Printable model fusion is milestone 7. Material paint does not become STL geometry.
