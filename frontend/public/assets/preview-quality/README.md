# Preview-vs-print comparison images

These two images are shown side by side in the planner's first-visit popup
(`src/table-top-terrain-builder/src/ui/PreviewQualityNotice.tsx`), which explains
why the mesh on the table isn't what the buyer prints.

Drop exactly these two files here:

| File | Should show |
|---|---|
| `planner-preview.png` | The model **as the planner draws it** — decimated to `PREVIEW_TARGET_TRIS` (150k) and carrying the `PREVIEW` watermark. |
| `stl-detail.png` | The **same model** from the STL a buyer downloads — full triangle count, no watermark. |

## Getting the comparison right

The popup's whole job is to show a difference, so the *only* thing that may differ
between the two shots is the mesh:

- **Same model, same camera angle, same distance, same lighting, same background.**
  If the framing shifts, viewers read the change as "different render" rather than
  "different detail" and the point is lost.
- **Frame something where decimation actually shows** — a detailed roofline, stonework,
  rivets, chainmail. On a smooth, low-poly piece the two images look identical and the
  popup ends up arguing against itself.
- **Crop reasonably tight.** The frames render at 4:3 with `object-fit: cover`, so a
  wide shot loses its left/right edges. Around 1200×900 is plenty.
- **PNG, not JPEG or WebP.** This is a detail comparison; lossy ringing around hard
  edges is indistinguishable from the very artefact being demonstrated.

The watermark in `planner-preview.png` should be the real one — either a screenshot
straight from the planner, or the embossed mark the Blender bake path applies. Don't
composite a fake watermark on top of a clean render; the claim on that page needs to
be literally true of what the pipeline produces, for the same reason the Creator
Protection page does.

## Changing the filenames

Both paths are exported constants (`PREVIEW_IMG` / `STL_IMG`) at the top of
`PreviewQualityNotice.tsx` — change them there, not by renaming references around
the codebase. If a file is missing the popup degrades to a labelled placeholder
naming the expected path, rather than showing a broken image.
