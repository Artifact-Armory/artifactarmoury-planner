// src/ui/PreviewQualityNotice.tsx
//
// Explains, once, why the meshes on the planner table are not what the buyer
// prints. The planner draws a *preview proxy*: decimated to PREVIEW_TARGET_TRIS
// and (on the bake path) watermarked, so the table stays fast and a ripped
// preview is useless on a print bed. The STL they download is the artist's
// untouched original.
//
// Without this, the honest-but-lossy preview reads as "the model is low quality"
// — the two images side by side are the whole point, so the difference is shown
// rather than asserted.
//
// The acknowledgement checkbox is what persists the dismissal: closing with Esc
// or the X hides it for this session only, so nobody is trapped in a modal but
// nobody is silently marked as having understood it either.

import React from 'react'
import { X, Check } from 'lucide-react'

/** Once ticked + confirmed, the notice never auto-opens again in this browser. */
const ACK_KEY = 'aa_planner_preview_quality_ack_v1'

// Drop the two comparison shots at these paths (frontend/public/...). Same model,
// same camera, same lighting — only the mesh differs, or the comparison lies.
// PNG on purpose: this is a *detail* comparison, and JPEG/WebP ringing around
// hard edges would show up as exactly the kind of difference being demonstrated.
export const PREVIEW_IMG = '/assets/preview-quality/planner-preview.png'
export const STL_IMG = '/assets/preview-quality/stl-detail.png'

export function hasAcknowledgedPreviewQuality(): boolean {
  try {
    return localStorage.getItem(ACK_KEY) === '1'
  } catch {
    return true // storage blocked (private mode) — don't nag on every load
  }
}

function markAcknowledged(): void {
  try {
    localStorage.setItem(ACK_KEY, '1')
  } catch {
    /* ignore */
  }
}

/**
 * One side of the comparison. Falls back to a labelled placeholder if the image
 * isn't present yet, so a missing asset degrades to an empty frame rather than a
 * broken-image icon.
 */
function Shot({ src, alt, caption, note }: { src: string; alt: string; caption: string; note: string }) {
  const [failed, setFailed] = React.useState(false)

  return (
    <figure className="tb-pq-shot">
      <div className="tb-pq-frame">
        {failed ? (
          <div className="tb-pq-missing">
            <span>Image not found</span>
            <code>{src}</code>
          </div>
        ) : (
          <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
        )}
      </div>
      <figcaption>
        <strong>{caption}</strong>
        <span>{note}</span>
      </figcaption>
    </figure>
  )
}

export function PreviewQualityNotice({
  onClose,
  onAcknowledge,
}: {
  /** Dismiss without acknowledging — the notice will appear again next visit. */
  onClose: () => void
  /** Ticked the box and confirmed — persist and don't auto-open again. */
  onAcknowledge: () => void
}) {
  const [understood, setUnderstood] = React.useState(false)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const confirm = () => {
    if (!understood) return
    markAcknowledged()
    onAcknowledge()
  }

  return (
    <div className="tb-pq-backdrop" onClick={onClose}>
      <div
        className="tb-pq"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tb-pq-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tb-pq-head">
          <strong id="tb-pq-title">Previews aren’t your final print</strong>
          <button className="tb-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="tb-pq-shots">
          <Shot
            src={PREVIEW_IMG}
            alt="The same model as it appears on the planner table: simplified mesh with a repeating PREVIEW watermark across its surface."
            caption="On the planner table"
            note="Simplified mesh, watermarked"
          />
          <Shot
            src={STL_IMG}
            alt="The same model from the STL file a buyer downloads: full detail, no watermark."
            caption="The STL you download"
            note="Full detail, no watermark"
          />
        </div>

        <div className="tb-pq-body">
          <p>
            Models on the table are lightweight <strong>previews</strong>, not the real file. We
            simplify the mesh so a full table loads quickly and stays smooth to build on, and we
            stamp a watermark across it so a preview pulled off the page is no use on a print bed —
            that’s what lets artists put their work here at all.
          </p>
          <p>
            The <strong>STL you download is the artist’s original</strong>, untouched: sharper
            edges, finer surface detail, and no watermark anywhere on it. Your print will look
            better than what you see here.
          </p>
        </div>

        <label className="tb-pq-ack">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
          />
          <span>
            I understand the models shown in the planner are lower-detail previews, and that the
            STL I download will be more detailed.
          </span>
        </label>

        <div className="tb-pq-foot">
          <button className="tb-cta sm" onClick={confirm} disabled={!understood}>
            <Check size={16} /> Got it
          </button>
        </div>
      </div>
    </div>
  )
}
