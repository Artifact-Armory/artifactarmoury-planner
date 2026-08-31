# Preview-vs-print comparison images

Shown side by side in the planner's "Previews aren't your final print" popup
(`src/table-top-terrain-builder/src/ui/PreviewQualityNotice.tsx`), which explains
why the mesh on the table isn't what the buyer prints.

| File | Shows |
|---|---|
| `planner-preview.png` | The model as the planner draws it — decimated to `TARGET_PREVIEW_TRIS`. |
| `stl-detail.png` | The **same** model at full fidelity, no watermark — what the downloaded STL holds. |

## How the current pair was generated (2026-08-30)

Both come from the **real production converters**, not a mock-up — the claim on that
popup has to be literally true of what the pipeline does, same standard as the
Creator Protection page.

- **Source model:** `frontend/public/assets/pre converted/kieran_s/terrain-kieran_s/top.stl`
  — 2,064,876 triangles. Picked for hard detail (rivets, circular vents, plank lines)
  where decimation actually shows. Smoother pieces (sandbags, barrel) were tried
  first and came out nearly identical; anything under the 80k budget isn't
  decimated at all, so small models can't demonstrate this.
- **Preview mesh:** `convertSTLtoGLB()` from `backend/src/services/fileProcessor.ts`
  → 80k triangles (`TARGET_PREVIEW_TRIS` default), 1.27 MB Draco GLB — a 26× cut.
- **Full mesh:** `convertSTLtoGLBFull()` → all 2,064,876 triangles, 41 MB.
  Needs `node --max-old-space-size=8192`; the pipeline costs roughly 1.1 KB RSS per
  source triangle.
- **Render:** both in Three.js with the lighting copied verbatim from
  `scene/ThreeStage.tsx` (hemisphere + key/fill/top directionals), identical camera,
  bounding-sphere fit at ZOOM 0.74 so the whole model sits in frame, 1200×900 at
  `devicePixelRatio` 2.
- **No watermark on either shot.** The planner's screen-space PREVIEW overlay was
  removed on 2026-08-30, so stamping one here would show something the product no
  longer does.

### Known limitation

At the ~215 px these render at in the popup, **the two images read as identical.**
A whole-model view of a 26× decimation doesn't resolve at thumbnail size; the
differences only appear from roughly 600 px up. A cropped-in pair (a vent and rivet
cluster) *did* read at thumbnail size, but showed a wall detail rather than a model.
Fixing this properly means changing the popup — click-to-enlarge, a magnified inset
next to the whole-model shot, or a wider modal — not re-shooting these.

The temporary render harness was deleted after baking. To regenerate, rebuild it
from this description — it was ~150 lines: a script calling the two converters, a
plain HTML page loading both GLBs, and a loopback HTTP sink to write the PNGs.

## If you replace these

- **Same model, same camera, same lighting.** Only the mesh may differ, or the
  comparison misleads.
- **Pick a model where decimation shows** — rivets, stonework, chainmail, a circle
  that goes visibly faceted. The vent ring is the clearest tell in the current pair.
- **PNG, not JPEG/WebP.** Lossy ringing around hard edges is indistinguishable from
  the artefact being shown.
- **No watermark**, and never a composited one — the planner doesn't draw one any more.

Paths are the `PREVIEW_IMG` / `STL_IMG` constants at the top of
`PreviewQualityNotice.tsx`; a missing file degrades to a labelled placeholder
naming the expected path rather than a broken image.
