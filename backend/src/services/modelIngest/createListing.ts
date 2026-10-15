// backend/src/services/modelIngest/createListing.ts
//
// Creates a listing from files already sitting in R2 (meshes under raw/, images
// under thumbnails/ or images/): validates, inserts the model + part rows as a
// 'processing' draft, writes taxonomy terms, and hands the files to ingest.
//
// Shared by POST /api/models/from-upload (an artist's browser upload) and
// scripts/import-listing.ts (bulk catalogue imports), so both create listings
// exactly the same way.

import { db } from '../../db';
import logger from '../../utils/logger';
import { ValidationError } from '../../middleware/error';
import { isR2Enabled, objectSize } from '../r2';
import { meshFormatFromName, MAX_MODEL_FILE_BYTES, MAX_MODEL_FILE_MB } from '../meshConvert';
import { recordPrice } from '../sales';
import { validateAndResolveTerms, writeModelTerms } from '../modelTerms';
import { safeDeleteObject } from './process';
import { dispatchIngestUpload } from './queue';

export const VALID_CATEGORIES = ['buildings', 'nature', 'scatter', 'props', 'complete_sets', 'other', 'vehicles', 'characters'];

// Buyer usage licences (migration 030). Neither permits redistributing the digital
// file — that's the platform rule the per-buyer watermark enforces.
export const VALID_LICENSES = ['personal', 'commercial'];

// Printer authoring targets (migration 032).
export const VALID_PRINTER_TYPES = ['fdm', 'resin', 'both'];

// A listing may bundle several named components ("Small Village" = tower +
// tavern + well), each of several files. Caps are generous but bounded: every
// extra file is a separate background conversion + preview bake.
export const MAX_EXTRA_PARTS = 250;
export const MAX_COMPONENTS = 20;
// Store-page gallery photos (beyond the required thumbnail) — shared by the
// initial upload and the standalone add-more-photos route so a model can't
// exceed the cap via either path.
export const MAX_GALLERY_IMAGES = 40;

// The type facet a model must be tagged with, per model class. A model's headline
// classification is class-conditional (a Vehicle needs vehicle-type, not terrain-type).
export const TYPE_FACET_BY_CLASS: Record<string, string> = {
  terrain: 'terrain-type',
  vehicles: 'vehicle-type',
  characters: 'character-type',
};

export function parseTags(tags: unknown): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

/** The body of POST /api/models/from-upload. Throws ValidationError on bad input. */
export async function createListingFromUpload(
  userId: string,
  body: any,
): Promise<{ id: string; name: string; created_at: string }> {
  if (!isR2Enabled()) {
    throw new ValidationError('Direct uploads are not configured (R2 is disabled)');
  }

  const { rawKey, filename, name, description, category, tags, basePrice, thumbnailKey, primaryThumbnailKey, parts, terms, license, printerType, primaryGroupName, showInPlanner, isPresupported, displayRawKey, displayFilename, galleryKeys, keepPartsPlaceable, isRealSubject } = body ?? {};

  if (!rawKey || typeof rawKey !== 'string' || !rawKey.startsWith('raw/')) {
    throw new ValidationError('rawKey (an uploaded raw/ object) is required');
  }
  if (!meshFormatFromName(filename || rawKey)) {
    throw new ValidationError('The model file must be an STL, OBJ or 3MF file');
  }

  // Sum of every file this upload will hand to the ingest worker (primary +
  // every part + every display/preview companion) — NOT just the primary
  // file's size. Feeds the large-job single-flight lock (queue.ts's
  // isLargeIngestJob): a grouped listing whose primary file is small but
  // whose extra parts are individually huge (exactly what happened with a
  // real 10-model "Japanese houses" upload on 2026-09-03) used to slip past
  // that lock entirely, since it only ever looked at the primary file.
  let totalRawBytes = 0;

  // Pre-supported print file → optional support-free "clean preview" companion
  // (see migration 053). The checkbox and the file travel together: ticking it
  // without attaching a file is rejected rather than silently ignored.
  const presupported = isPresupported === true || isPresupported === 'true';
  // Scale model of a real-world subject (migration 072): a geometry match against
  // another artist's model is reviewed by an admin instead of rejecting the upload.
  const realSubject = isRealSubject === true || isRealSubject === 'true';
  let cleanDisplayRawKey: string | null = null;
  if (presupported) {
    if (!displayRawKey || typeof displayRawKey !== 'string' || !displayRawKey.startsWith('raw/')) {
      throw new ValidationError('Upload a support-free preview model, or untick "this file is pre-supported"');
    }
    if (!meshFormatFromName(displayFilename || displayRawKey)) {
      throw new ValidationError('The preview model file must be an STL, OBJ or 3MF file');
    }
    const displayBytes = await objectSize(displayRawKey);
    if (displayBytes == null) {
      throw new ValidationError('Preview model file not found in storage — retry the upload');
    }
    if (displayBytes > MAX_MODEL_FILE_BYTES) {
      await safeDeleteObject(displayRawKey);
      throw new ValidationError(
        `Preview model file is too large (${(displayBytes / (1024 * 1024)).toFixed(0)}MB). The maximum is ${MAX_MODEL_FILE_MB}MB.`,
      );
    }
    cleanDisplayRawKey = displayRawKey;
    totalRawBytes += displayBytes;
  }
  // A thumbnail is required up-front (it's also a hard requirement to publish),
  // so we never create a draft that can't be listed.
  if (!thumbnailKey || typeof thumbnailKey !== 'string' || !thumbnailKey.startsWith('thumbnails/')) {
    throw new ValidationError('A thumbnail image is required');
  }
  // Optional SEPARATE planner thumbnail for the listing's own primary model
  // (migration 059) — the store thumbnail above is often a group shot of
  // every model together, which isn't what should show when model 1 alone
  // is placed in the planner.
  let cleanPrimaryThumbnailKey: string | null = null;
  if (primaryThumbnailKey != null) {
    if (typeof primaryThumbnailKey !== 'string' || !primaryThumbnailKey.startsWith('thumbnails/')) {
      throw new ValidationError('primaryThumbnailKey must be an uploaded thumbnails/ object');
    }
    cleanPrimaryThumbnailKey = primaryThumbnailKey;
  }
  // Optional extra store-page photos, uploaded the same presign-then-send-the-key
  // way as the thumbnail — same convention/cap as the standalone ADD GALLERY
  // IMAGES route below, just attached at creation instead of afterward.
  // Accepts 'images/' (freshly-picked gallery files) AND 'thumbnails/' — the
  // frontend reuses a component's planner thumbnail as a gallery photo
  // (CreateModel.tsx's derivedGalleryKeys) rather than uploading the same
  // picture twice, and both prefixes come from the same trusted
  // /api/uploads/presign flow, so either is a legitimate gallery source.
  let validGalleryKeys: string[] = [];
  if (galleryKeys != null) {
    if (!Array.isArray(galleryKeys)) {
      throw new ValidationError('galleryKeys must be an array');
    }
    if (galleryKeys.some((k: unknown) => typeof k !== 'string' || !(k.startsWith('images/') || k.startsWith('thumbnails/')))) {
      throw new ValidationError('Each galleryKeys entry must be an images/ or thumbnails/ object from /api/uploads/presign');
    }
    if (galleryKeys.length > MAX_GALLERY_IMAGES) {
      throw new ValidationError(`A model can have at most ${MAX_GALLERY_IMAGES} gallery images`);
    }
    validGalleryKeys = galleryKeys;
  }
  if (!name || !category || basePrice == null) {
    throw new ValidationError('Name, category, and base price are required');
  }
  if (!VALID_CATEGORIES.includes(category)) {
    throw new ValidationError('Invalid category');
  }
  const price = parseFloat(basePrice);
  if (isNaN(price) || price < 0) {
    throw new ValidationError('Invalid base price');
  }
  // Usage licence — defaults to the conservative 'personal' when unset.
  const modelLicense = license == null ? 'personal' : license;
  if (!VALID_LICENSES.includes(modelLicense)) {
    throw new ValidationError('Invalid licence');
  }
  // Printer authoring target (optional).
  const modelPrinterType = printerType == null || printerType === '' ? null : printerType;
  if (modelPrinterType !== null && !VALID_PRINTER_TYPES.includes(modelPrinterType)) {
    throw new ValidationError('Invalid printer type');
  }
  // Confirm the object actually landed in R2 before we create a row for it,
  // and that it's within the size we can process without exhausting memory.
  const rawBytes = await objectSize(rawKey);
  if (rawBytes == null) {
    throw new ValidationError('Uploaded file not found in storage — retry the upload');
  }
  if (rawBytes > MAX_MODEL_FILE_BYTES) {
    await safeDeleteObject(rawKey);
    throw new ValidationError(
      `Model file is too large (${(rawBytes / (1024 * 1024)).toFixed(0)}MB). The maximum is ${MAX_MODEL_FILE_MB}MB — please reduce the model's detail (e.g. decimate it in Blender) and upload again.`,
    );
  }
  totalRawBytes += rawBytes;

  // Optional extra STL parts (multi-part "set" models). Each must be its own
  // raw/ upload; they're processed alongside the primary in the background.
  // A part may also declare the COMPONENT it belongs to (groupIndex/groupName),
  // which is how a "Small Village" listing keeps its Village Tower's three
  // files together and separate from the Tavern's two (migration 038).
  const extraParts: Array<{
    rawKey: string; filename?: string; name?: string; groupIndex: number; groupName: string | null;
    isPresupported: boolean; displayRawKey: string | null; thumbnailKey: string | null;
    keepPartsPlaceable: boolean; downloadOnly: boolean; previewSkipped?: boolean;
  }> = [];
  if (parts != null) {
    if (!Array.isArray(parts)) throw new ValidationError('parts must be an array');
    if (parts.length > MAX_EXTRA_PARTS) {
      throw new ValidationError(`A listing can have at most ${MAX_EXTRA_PARTS} extra files`);
    }
    for (const p of parts) {
      if (!p?.rawKey || typeof p.rawKey !== 'string' || !p.rawKey.startsWith('raw/')) {
        throw new ValidationError('Each part needs an uploaded raw/ object');
      }
      if (!meshFormatFromName(p.filename || p.rawKey)) {
        throw new ValidationError('Each part must be an STL, OBJ or 3MF file');
      }
      const groupIndex = p.groupIndex == null ? 0 : Number(p.groupIndex);
      if (!Number.isInteger(groupIndex) || groupIndex < 0 || groupIndex > MAX_COMPONENTS) {
        throw new ValidationError('Invalid part group');
      }
      const groupName = typeof p.groupName === 'string' && p.groupName.trim()
        ? p.groupName.trim().slice(0, 255)
        : null;
      const partBytes = await objectSize(p.rawKey);
      if (partBytes == null) {
        throw new ValidationError('A part file was not found in storage — retry the upload');
      }
      if (partBytes > MAX_MODEL_FILE_BYTES) {
        await safeDeleteObject(p.rawKey);
        throw new ValidationError(
          `A part file is too large (${(partBytes / (1024 * 1024)).toFixed(0)}MB). The maximum is ${MAX_MODEL_FILE_MB}MB per file — please reduce it and upload again.`,
        );
      }
      totalRawBytes += partBytes;
      // Per-component "clean preview" (migration 054) — only meaningful when
      // this part is a component's first/primary file, but that's a frontend
      // convention (which part it attaches the field to), not something
      // enforced here.
      const partPresupported = p.isPresupported === true || p.isPresupported === 'true';
      let partDisplayRawKey: string | null = null;
      if (partPresupported) {
        if (!p.displayRawKey || typeof p.displayRawKey !== 'string' || !p.displayRawKey.startsWith('raw/')) {
          throw new ValidationError('Upload a support-free preview model for each pre-supported part, or untick it');
        }
        if (!meshFormatFromName(p.displayRawKey)) {
          throw new ValidationError('A part’s preview model file must be an STL, OBJ or 3MF file');
        }
        const displayBytes = await objectSize(p.displayRawKey);
        if (displayBytes == null) {
          throw new ValidationError('A part’s preview model file was not found in storage — retry the upload');
        }
        if (displayBytes > MAX_MODEL_FILE_BYTES) {
          await safeDeleteObject(p.displayRawKey);
          throw new ValidationError(
            `A part's preview model file is too large (${(displayBytes / (1024 * 1024)).toFixed(0)}MB). The maximum is ${MAX_MODEL_FILE_MB}MB.`,
          );
        }
        totalRawBytes += displayBytes;
        partDisplayRawKey = p.displayRawKey;
      }
      // Per-component planner thumbnail (migration 058) — only meaningful
      // when this part is a component's first/primary file, same frontend
      // convention as isPresupported/displayRawKey above.
      let partThumbnailKey: string | null = null;
      if (p.thumbnailKey != null) {
        if (typeof p.thumbnailKey !== 'string' || !p.thumbnailKey.startsWith('thumbnails/')) {
          throw new ValidationError('A part thumbnailKey must be an uploaded thumbnails/ object');
        }
        partThumbnailKey = p.thumbnailKey;
      }
      extraParts.push({
        rawKey: p.rawKey, filename: p.filename, name: p.name, groupIndex, groupName,
        isPresupported: partPresupported, displayRawKey: partDisplayRawKey, thumbnailKey: partThumbnailKey,
        keepPartsPlaceable: p.keepPartsPlaceable === true || p.keepPartsPlaceable === 'true',
        // A single file that only belongs in the ZIP (e.g. a pre-supported print
        // plate of pieces that are placeable on their own).
        downloadOnly: p.downloadOnly === true || p.downloadOnly === 'true',
      });
    }
  }
  // A named model with a preview file is placed in the planner as that ONE
  // asset, so its other part files are download-only (migration 067) — no bake,
  // no GLBs, not placeable — unless the artist opted to keep them placeable too.
  // Group 0's preview rides on the listing itself; a later component's rides on
  // its first part, which is the one part of that component that is NOT skipped.
  const skipGroups = new Set<number>();
  if (cleanDisplayRawKey && !(keepPartsPlaceable === true || keepPartsPlaceable === 'true')) skipGroups.add(0);
  for (const p of extraParts) {
    if (p.displayRawKey && !p.keepPartsPlaceable) skipGroups.add(p.groupIndex);
  }
  for (const p of extraParts) p.previewSkipped = p.downloadOnly || (skipGroups.has(p.groupIndex) && !p.displayRawKey);
  const partCount = 1 + extraParts.length;
  // Name of the component owning the primary file (NULL when the listing isn't
  // split into named models).
  const primaryGroup = typeof primaryGroupName === 'string' && primaryGroupName.trim()
    ? primaryGroupName.trim().slice(0, 255)
    : null;
  // Opt-out of the 3D planner (misc items — a paint brush holder, a display base —
  // aren't placeable scenery). Defaults to true so leaving it unset behaves exactly
  // as before this field existed.
  const modelShowInPlanner = showInPlanner === false ? false : true;

  // Validate taxonomy tags up-front (read-only) so a bad payload never creates a
  // half-tagged draft; they're written after the model row exists.
  const resolvedTerms = await validateAndResolveTerms(terms);

  // Determine the chosen model class (Terrain / Vehicles / Characters). It gates
  // which type facet is required and which legacy category the row gets stored as.
  const modelClass = resolvedTerms.find((t) => t.facetSlug === 'model-class')?.path ?? null;

  // The headline browse facets are mandatory at upload (mirrors the required
  // dropdowns in the UI) — a model must be classified before it's created. The
  // "type" facet is class-conditional; the rest are universal.
  const REQUIRED_UPLOAD_FACETS: Record<string, string> = {
    'model-class': 'Model class',
    ...(modelClass && TYPE_FACET_BY_CLASS[modelClass]
      ? { [TYPE_FACET_BY_CLASS[modelClass]]: 'Model type' }
      : { 'terrain-type': 'Model type' }),
    'setting-era': 'Theme / Era',
    scale: 'Scale',
    // Condition doesn't apply to characters & units.
    ...(modelClass === 'characters' ? {} : { condition: 'Condition' }),
  };
  const taggedFacets = new Set(resolvedTerms.map((t) => t.facetSlug));
  const missingFacets = Object.keys(REQUIRED_UPLOAD_FACETS).filter((f) => !taggedFacets.has(f));
  if (missingFacets.length > 0) {
    throw new ValidationError(
      `Choose a value for: ${missingFacets.map((f) => REQUIRED_UPLOAD_FACETS[f]).join(', ')}`,
    );
  }

  // Digital STL sales only for now — fulfilment is always 'stl'. For vehicles /
  // characters, store that as the legacy `category` so category-based code paths
  // (browse related / categories / stats) stay meaningful; terrain keeps the
  // artist-chosen sub-category (buildings / nature / …).
  const storedCategory = modelClass === 'vehicles' || modelClass === 'characters' ? modelClass : category;

  const result = await db.query(
    `INSERT INTO models (
      artist_id, name, description, category, tags,
      stl_file_path, thumbnail_path, primary_thumbnail_path, base_price, fulfillment_type, part_count, license, printer_type, primary_group_name, show_in_planner, is_presupported, is_real_subject, status, processing_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'stl', $10, $11, $12, $13, $14, $15, $16, 'draft', 'processing')
    RETURNING id, name, created_at`,
    [userId, name, description || null, storedCategory, parseTags(tags), rawKey, thumbnailKey || null, cleanPrimaryThumbnailKey, price, partCount, modelLicense, modelPrinterType, primaryGroup, modelShowInPlanner, presupported, realSubject]
  );
  const model = result.rows[0];
  // Seed price history (backs the anti-inflation guard on sales).
  recordPrice('model', model.id, price);

  // Gallery photos picked at upload time — same rows the standalone ADD
  // GALLERY IMAGES route creates, just written here instead of a follow-up call.
  for (let i = 0; i < validGalleryKeys.length; i++) {
    await db.query(
      `INSERT INTO model_images (model_id, image_path, display_order) VALUES ($1, $2, $3)`,
      [model.id, validGalleryKeys[i], i]
    );
  }

  // Insert a row per extra part (processed in the background job). Default part
  // names count within their own component — group 0 continues from the primary
  // (which is that component's part 1), later components start at part 1.
  const seenInGroup = new Map<number, number>();
  for (let i = 0; i < extraParts.length; i++) {
    const p = extraParts[i];
    const nth = (seenInGroup.get(p.groupIndex) ?? (p.groupIndex === 0 ? 1 : 0)) + 1;
    seenInGroup.set(p.groupIndex, nth);
    await db.query(
      `INSERT INTO model_parts (model_id, name, stl_file_path, display_order, group_index, group_name, is_presupported, display_stl_path, thumbnail_path, preview_skipped, processing_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'processing')`,
      // display_stl_path starts as the raw uploaded key — same "starts raw,
      // finalized in place" convention stl_file_path uses — and is turned
      // into a canonical path by processModelParts, same as the print file.
      [model.id, p.name || `Part ${nth}`, p.rawKey, i + 1, p.groupIndex, p.groupName, p.isPresupported, p.displayRawKey, p.thumbnailKey, !!p.previewSkipped]
    );
  }

  // Write the (already validated) taxonomy tags.
  if (resolvedTerms.length > 0) {
    await writeModelTerms(model.id, resolvedTerms);
  }

  await db.query(
    `INSERT INTO activity_log (user_id, action, resource_type, resource_id, metadata)
     VALUES ($1, 'model.created', 'model', $2, $3)`,
    [userId, model.id, JSON.stringify({ name: model.name, via: 'direct-upload', partCount })]
  ).catch((err) => logger.error('activity_log insert failed', { error: err }));

  // Background processing — seller polls GET /:id. Goes to the ingest worker
  // queue when MODEL_INGEST_WORKER_ENABLED is on, otherwise runs in-process
  // exactly as before (see services/modelIngest/queue.ts).
  await dispatchIngestUpload({
    modelId: model.id,
    rawKey,
    filename,
    displayRawKey: cleanDisplayRawKey ?? undefined,
    displayFilename,
    // Total across every file this job will process (see totalRawBytes'
    // definition above) — not just the primary file — so the large-job lock
    // actually sees a heavy multi-part listing as heavy.
    rawBytes: totalRawBytes,
  });

  return model;
}
