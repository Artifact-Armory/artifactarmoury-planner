import React, { useEffect, useState } from 'react'
import { X, Star } from 'lucide-react'
import Button from '../ui/Button'

interface ReviewModalProps {
  modelName: string
  /** Existing review to edit, if any. */
  initialRating?: number
  initialComment?: string | null
  isEditing?: boolean
  submitting?: boolean
  onClose: () => void
  onSubmit: (data: { rating: number; comment: string }) => void
}

const ReviewModal: React.FC<ReviewModalProps> = ({
  modelName,
  initialRating = 0,
  initialComment = '',
  isEditing = false,
  submitting = false,
  onClose,
  onSubmit,
}) => {
  const [rating, setRating] = useState(initialRating)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState(initialComment ?? '')

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (rating < 1) return
    onSubmit({ rating, comment: comment.trim() })
  }

  const active = hover || rating

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {isEditing ? 'Edit your review' : 'Write a review'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground line-clamp-1">{modelName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          <div>
            <label className="block text-sm font-medium text-foreground">Your rating</label>
            <div className="mt-2 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  className="p-1 text-amber-400 transition hover:scale-110"
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                >
                  <Star size={28} className={n <= active ? 'fill-amber-400' : 'fill-none text-muted-foreground'} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="review-comment" className="block text-sm font-medium text-foreground">
              Your review <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="review-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="How did it print? How's the detail and fit?"
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm shadow-xs focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={rating < 1}>
              {isEditing ? 'Save changes' : 'Submit review'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ReviewModal
