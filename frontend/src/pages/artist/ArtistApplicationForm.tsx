import React, { useState } from 'react'
import { ImagePlus, X, AlertTriangle, Send } from 'lucide-react'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import {
  artistApplicationsApi,
  ApplicationImageInput,
} from '../../api/endpoints/artistApplications'

const MIN_IMAGES = 3
const MAX_IMAGES = 10
const MAX_MB = 10
const MAX_SOCIALS = 5
const ACCEPT = '.png,.jpg,.jpeg,.webp'

interface Props {
  defaultName?: string
  onSubmitted: () => void
}

/**
 * The artist application. Replaces "email a portfolio to artists@": everything a
 * reviewer needs (store name, bio, links, portfolio images) lands in the admin
 * panel, and the decision comes back by email.
 */
const ArtistApplicationForm: React.FC<Props> = ({ defaultName = '', onSubmitted }) => {
  const [artistName, setArtistName] = useState(defaultName)
  const [about, setAbout] = useState('')
  const [whatYouMake, setWhatYouMake] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [socials, setSocials] = useState<string[]>([''])
  const [sellsElsewhere, setSellsElsewhere] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function addFiles(list: FileList | null) {
    if (!list) return
    const incoming = Array.from(list)
    const tooBig = incoming.find((f) => f.size > MAX_MB * 1024 * 1024)
    if (tooBig) {
      setError(`"${tooBig.name}" is over ${MAX_MB}MB`)
      return
    }
    setError(null)
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_IMAGES))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (artistName.trim().length < 2) return setError('Enter the store name buyers will see.')
    if (about.trim().length < 20) return setError('Tell us a little about yourself (at least 20 characters).')
    if (whatYouMake.trim().length < 10) return setError('Tell us what kind of models you make.')
    if (files.length < MIN_IMAGES) return setError(`Add at least ${MIN_IMAGES} portfolio images.`)

    setError(null)
    setSubmitting(true)
    try {
      setUploading(true)
      const images: ApplicationImageInput[] = await Promise.all(files.map((f) => artistApplicationsApi.uploadImage(f)))
      setUploading(false)
      await artistApplicationsApi.submit({
        artistName: artistName.trim(),
        about: about.trim(),
        whatYouMake: whatYouMake.trim(),
        websiteUrl: websiteUrl.trim() || undefined,
        socialLinks: socials.map((s) => s.trim()).filter(Boolean),
        sellsElsewhere: sellsElsewhere.trim() || undefined,
        images,
      })
      onSubmitted()
    } catch (err: any) {
      setUploading(false)
      setError(err?.response?.data?.message || err?.message || 'Could not submit your application.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-5 rounded-2xl border border-border bg-card p-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Apply to sell</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us about you and your work. We read every application and reply by email either way.
        </p>
      </div>

      <Input
        label="Store name"
        value={artistName}
        onChange={(e) => setArtistName(e.target.value)}
        placeholder="The name buyers will see"
        required
        maxLength={80}
      />

      <div className="space-y-1.5">
        <label htmlFor="app-about" className="text-sm font-medium text-foreground">About you</label>
        <textarea
          id="app-about"
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Who you are, how long you've been making terrain, and what you enjoy about it."
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary/50 focus:outline-hidden focus:ring-1 focus:ring-primary/50"
          required
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="app-make" className="text-sm font-medium text-foreground">What you make</label>
        <textarea
          id="app-make"
          value={whatYouMake}
          onChange={(e) => setWhatYouMake(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="For example: gothic ruins and scatter, 28mm, FDM and resin friendly."
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary/50 focus:outline-hidden focus:ring-1 focus:ring-primary/50"
          required
        />
      </div>

      <div>
        <label className="text-sm font-medium text-foreground">
          Portfolio images{' '}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {MIN_IMAGES} to {MAX_IMAGES} renders or photos, PNG, JPG or WebP, {MAX_MB}MB each
          </span>
        </label>
        <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-4 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary">
          <ImagePlus size={18} />
          Add images
          <input type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        </label>
        {files.length > 0 && (
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                <img src={URL.createObjectURL(f)} alt={f.name} className="h-full w-full object-cover" onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)} />
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-red-600"
                  aria-label={`Remove ${f.name}`}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {files.length} of {MIN_IMAGES} minimum added.
        </p>
      </div>

      <Input
        label="Website or portfolio link (optional)"
        value={websiteUrl}
        onChange={(e) => setWebsiteUrl(e.target.value)}
        placeholder="https://"
        maxLength={500}
      />

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Social profiles and storefronts{' '}
          <span className="ml-1 text-xs font-normal text-muted-foreground">optional, up to {MAX_SOCIALS}</span>
        </label>
        {socials.map((s, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={s}
              onChange={(e) => setSocials((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
              placeholder="https://instagram.com/yourname"
              maxLength={500}
              className="flex-1"
            />
            {socials.length > 1 && (
              <Button type="button" variant="outline" onClick={() => setSocials((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove link">
                <X size={14} />
              </Button>
            )}
          </div>
        ))}
        {socials.length < MAX_SOCIALS && (
          <Button type="button" variant="outline" size="sm" onClick={() => setSocials((prev) => [...prev, ''])}>
            Add another link
          </Button>
        )}
      </div>

      <Input
        label="Where else do you sell? (optional)"
        value={sellsElsewhere}
        onChange={(e) => setSellsElsewhere(e.target.value)}
        placeholder="Other marketplaces, Patreon, your own shop"
        maxLength={500}
      />

      {error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          <AlertTriangle size={16} /> {error}
        </p>
      )}

      <Button type="submit" loading={submitting} leftIcon={<Send size={16} />}>
        {uploading ? 'Uploading images…' : submitting ? 'Submitting…' : 'Submit application'}
      </Button>
    </form>
  )
}

export default ArtistApplicationForm
