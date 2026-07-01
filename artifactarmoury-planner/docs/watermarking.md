# Watermarking & Anti-Piracy Pipeline

Artifact Armoury embeds multiple layers of protection whenever artists upload new terrain files. This document explains the workflow, storage artefacts, and how support staff can respond to takedown requests.

## Overview

1. **Invisible mesh watermark** – STL geometry is parsed and ~8 % of faces are nudged by ±0.0008 mm along their normals using a deterministic seed derived from the artist ID and a random `watermarkId`. This perturbation survives slicing but is imperceptible.
2. **Metadata stamping** – The STL binary header and resulting GLB `asset.extras` fields record the artist ID, watermark token, platform ID, and timestamp. User-facing previews (PNG/JPEG/WebP) are stamped with EXIF credits.
3. **Visual preview watermark** – Auto-generated renders and uploaded thumbnails receive a semi-transparent overlay identifying the platform and creator.
4. **Fingerprint catalogue** – Each upload stores a compact feature vector (volume, surface area, dimension ratios, triangle count) and a SHA‑256 signature in the `model_watermarks` table for similarity searches.

## File Artefacts

- **STL** – Stored under `uploads/models`. Binary header prefix: `AA-WM|artist=<uuid>|wm=<uuid>|ts=<iso8601>`.
- **GLB** – Stored under `uploads/models`. Metadata accessible via `document.getRoot().getExtras().artifactArmouryWatermark`.
- **Thumbnails** – Always watermarked; auto-generated previews live in `uploads/thumbnails`.
- **Database** – `model_watermarks` records the `watermark_token`, `hash_signature`, feature vector, and raw metadata JSON for every model.

## Similarity Checks

Support and admin tooling can query `GET /api/models/:id/similar` (admin only). The response contains:

- The model’s watermark token/signature/metadata.
- Up to 15 candidate matches with cosine similarity scores ≥ 0.93.

Use this to cross-reference suspected stolen uploads or supply evidence in takedown notices. When investigating external files, compute the same feature vector and run `findSimilarModels` from `backend/src/services/modelSimilarity.ts`.

## Regeneration

If a file needs to be re-issued (e.g., corruption fix):

1. Retrieve the existing `watermark_token` and feature vector.
2. Re-run the watermark embedding with the same token to preserve provenance.
3. Update the `model_watermarks.metadata` record if dimensions change and regenerate signatures.

## Creator Support Playbook

1. **Rapid acknowledgment** – Confirm receipt of infringement reports within 24 hours and log the `watermark_token` for the claim.
2. **Evidence gathering** – Use the admin similarity endpoint plus the watermark metadata (STL header/GLB extras) to document proof.
3. **Platform response** – If theft is confirmed, suspend the offending account and provide the creator with ready-to-send takedown text including hash signatures.
4. **Escalation** – For repeat offenders, export the manifest and feature vector to share with third-party marketplaces.

Proactive communications about this policy reinforce that purchasing legitimately is the easiest path and that infringers lose marketplace access quickly.
