import React from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Star, ArrowUp, ArrowDown, X, ExternalLink, Search } from 'lucide-react'
import { artistsApi } from '../../api/endpoints/artists'
import { uploadsApi } from '../../api/endpoints/uploads'
import { useAuthStore } from '../../store/authStore'
import { TerrainModel } from '../../api/types'
import Spinner from '../../components/ui/Spinner'

const MAX_FEATURED = 12

// Debounce a value so we don't fire a request on every keystroke.
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

const ArtistSettings: React.FC = () => {
  const user = useAuthStore((s) => s.user)

  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ['artist-self', user?.id],
    queryFn: () => artistsApi.getArtistProfile(user!.id as string),
    enabled: Boolean(user?.id),
  })

  const [modelSearch, setModelSearch] = React.useState('')
  const debouncedSearch = useDebounced(modelSearch, 300)

  // The artist's own published models — the pool to pick featured ones from.
  // Searched server-side so the whole catalogue is reachable, not just page one.
  const { data: myModels, isFetching: modelsFetching } = useQuery({
    queryKey: ['artist-self-models', user?.id, debouncedSearch],
    queryFn: () => artistsApi.getArtistModels(user!.id as string, {
      sort: 'recent', limit: 100, q: debouncedSearch.trim() || undefined,
    }),
    enabled: Boolean(user?.id),
    placeholderData: (prev) => prev,
  })

  const { data: initialFeatured } = useQuery({
    queryKey: ['artist-self-featured', user?.id],
    queryFn: () => artistsApi.getFeatured(user!.id as string),
    enabled: Boolean(user?.id),
  })

  const [name, setName] = React.useState('')
  const [bio, setBio] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [avatarUrl, setAvatarUrl] = React.useState<string | undefined>()
  const [bannerUrl, setBannerUrl] = React.useState<string | undefined>()
  const [backgroundUrl, setBackgroundUrl] = React.useState<string | undefined>()
  const [avatarKey, setAvatarKey] = React.useState<string | undefined>()
  const [bannerKey, setBannerKey] = React.useState<string | undefined>()
  const [backgroundKey, setBackgroundKey] = React.useState<string | undefined>()
  const [accent, setAccent] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [uploading, setUploading] = React.useState<'avatar' | 'banner' | 'background' | null>(null)

  const [featuredIds, setFeaturedIds] = React.useState<string[]>([])
  const [savingFeatured, setSavingFeatured] = React.useState(false)

  React.useEffect(() => {
    if (profile) {
      setName(profile.name ?? '')
      setBio(profile.bio ?? '')
      setUrl((profile as any).artistUrl ?? (profile as any).artist_url ?? '')
      setAvatarUrl(profile.profileImageUrl)
      setBannerUrl(profile.bannerImageUrl)
      setBackgroundUrl(profile.backgroundImageUrl)
      setAccent(profile.accentColor ?? '')
    }
  }, [profile])

  React.useEffect(() => {
    if (initialFeatured) setFeaturedIds(initialFeatured.map((m) => m.id))
  }, [initialFeatured])

  // The current (possibly search-filtered) picker results shown in the grid.
  const pickerModels = myModels?.models ?? []

  // Accumulate every model we've seen (across searches + the featured fetch) so
  // the ordered featured list can always resolve names/thumbnails even when the
  // picker grid is filtered down to a search that excludes them.
  const [modelCache, setModelCache] = React.useState<Map<string, TerrainModel>>(new Map())
  React.useEffect(() => {
    const seen = [...(initialFeatured ?? []), ...pickerModels]
    if (!seen.length) return
    setModelCache((prev) => {
      const next = new Map(prev)
      for (const m of seen) next.set(m.id, m)
      return next
    })
  }, [initialFeatured, pickerModels])
  const modelById = modelCache

  const upload = async (file: File, which: 'avatar' | 'banner' | 'background') => {
    if (!/^image\//.test(file.type)) {
      toast.error('Choose an image file')
      return
    }
    setUploading(which)
    try {
      const { key, publicUrl } = await uploadsApi.uploadDirect(file, 'images')
      if (which === 'avatar') {
        setAvatarKey(key)
        setAvatarUrl(publicUrl)
      } else if (which === 'banner') {
        setBannerKey(key)
        setBannerUrl(publicUrl)
      } else {
        setBackgroundKey(key)
        setBackgroundUrl(publicUrl)
      }
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(null)
    }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await artistsApi.updateProfile({
        name: name.trim(),
        bio: bio.trim(),
        url: url.trim(),
        avatar: avatarKey,
        banner: bannerKey,
        background: backgroundKey,
        accentColor: accent, // '' clears it back to the default theme
      })
      toast.success('Profile saved')
      await refetch()
    } catch {
      toast.error('Could not save profile')
    } finally {
      setSaving(false)
    }
  }

  const toggleFeatured = (id: string) => {
    setFeaturedIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      if (cur.length >= MAX_FEATURED) {
        toast.error(`You can feature up to ${MAX_FEATURED} models`)
        return cur
      }
      return [...cur, id]
    })
  }

  const moveFeatured = (index: number, dir: -1 | 1) => {
    setFeaturedIds((cur) => {
      const next = [...cur]
      const target = index + dir
      if (target < 0 || target >= next.length) return cur
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const saveFeatured = async () => {
    setSavingFeatured(true)
    try {
      const saved = await artistsApi.setFeatured(featuredIds)
      setFeaturedIds(saved)
      toast.success('Featured models updated')
    } catch {
      toast.error('Could not save featured models')
    } finally {
      setSavingFeatured(false)
    }
  }

  const accentHex = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#4f46e5'
  const featuredThumbs = featuredIds
    .map((mid) => modelById.get(mid)?.thumbnailUrl)
    .filter(Boolean) as string[]

  if (isLoading) {
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  }

  return (
    <div className="px-4 py-10 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Artist Profile</h1>
          <p className="text-gray-600">Your public brand page — banner, background, avatar, colour, and bio.</p>
        </div>
        {user?.id && (
          <a
            href={`/artists/${user.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <ExternalLink size={15} />
            View public page
          </a>
        )}
      </div>

      {/* LIVE PREVIEW — reflects the current (unsaved) edits. */}
      <div className="mt-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Live preview</p>
        <div className="relative overflow-hidden rounded-2xl border shadow-sm">
          {/* page background */}
          <div className="absolute inset-0">
            {backgroundUrl
              ? <img src={backgroundUrl} alt="" className="h-full w-full object-cover" />
              : <div className="h-full w-full bg-gray-100" />}
            <div className="absolute inset-0 bg-white/75 backdrop-blur-sm" />
          </div>
          {/* hero card */}
          <div className="relative m-3 overflow-hidden rounded-xl bg-white/95 shadow">
            <div className="h-20 w-full" style={{ backgroundImage: `linear-gradient(to right, ${accentHex}, ${accentHex}cc)` }}>
              {bannerUrl && <img src={bannerUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="flex items-end gap-3 px-4 pb-4">
              <div className="-mt-8 h-16 w-16 flex-none overflow-hidden rounded-full border-4 border-white bg-gray-100">
                {avatarUrl
                  ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                  : <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-gray-500">{(name || 'AA').slice(0, 2).toUpperCase()}</div>}
              </div>
              <div className="min-w-0 flex-1 pt-2">
                <h3 className="truncate text-lg font-semibold text-gray-900">{name || 'Your studio name'}</h3>
                {bio && <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-gray-600">{bio}</p>}
              </div>
              <span className="mb-1 flex-none rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ backgroundColor: accentHex }}>
                Follow
              </span>
            </div>
          </div>
          {featuredThumbs.length > 0 && (
            <div className="relative mx-3 mb-3">
              <p className="mb-1 text-xs font-medium text-gray-500">Featured</p>
              <div className="flex gap-2 overflow-hidden">
                {featuredThumbs.slice(0, 5).map((src, i) => (
                  <img key={i} src={src} alt="" className="h-16 w-16 flex-none rounded-lg border object-cover" />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <form className="mt-6 space-y-5" onSubmit={save}>
        {/* Banner */}
        <div>
          <label className="block text-sm font-medium mb-1">Banner</label>
          <div className="relative h-32 w-full overflow-hidden rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500">
            {bannerUrl && <img src={bannerUrl} alt="banner" className="h-full w-full object-cover" />}
          </div>
          <input type="file" accept="image/*" className="mt-2 text-sm" disabled={uploading !== null}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'banner')} />
          {uploading === 'banner' && <span className="ml-2 text-xs text-gray-500">Uploading…</span>}
        </div>

        {/* Page background */}
        <div>
          <label className="block text-sm font-medium mb-1">Page background</label>
          <p className="text-xs text-gray-500 mb-2">A full-page backdrop shown behind your brand page (a soft white overlay keeps text readable).</p>
          <div className="relative h-40 w-full overflow-hidden rounded-lg border bg-gray-100">
            {backgroundUrl && <img src={backgroundUrl} alt="background" className="h-full w-full object-cover" />}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <input type="file" accept="image/*" className="text-sm" disabled={uploading !== null}
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'background')} />
            {uploading === 'background' && <span className="text-xs text-gray-500">Uploading…</span>}
            {backgroundUrl && (
              <button type="button" className="text-xs text-red-600 hover:underline"
                onClick={() => { setBackgroundUrl(undefined); setBackgroundKey('') }}>
                Remove
              </button>
            )}
          </div>
        </div>

        {/* Avatar */}
        <div>
          <label className="block text-sm font-medium mb-1">Avatar</label>
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 overflow-hidden rounded-full bg-gray-100">
              {avatarUrl && <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" />}
            </div>
            <input type="file" accept="image/*" className="text-sm" disabled={uploading !== null}
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'avatar')} />
            {uploading === 'avatar' && <span className="text-xs text-gray-500">Uploading…</span>}
          </div>
        </div>

        {/* Accent colour */}
        <div>
          <label className="block text-sm font-medium mb-1">Accent colour</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#4f46e5'}
              onChange={(e) => setAccent(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border p-0.5"
            />
            <span className="text-sm text-gray-600">{accent || 'Default theme'}</span>
            {accent && (
              <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setAccent('')}>
                Reset
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Studio / artist name</label>
          <input className="w-full border rounded px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Bio</label>
          <textarea className="w-full border rounded px-3 py-2" rows={5} value={bio} onChange={(e) => setBio(e.target.value)}
            placeholder="Tell buyers about your studio, your style, what makes your terrain special…" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Link (Patreon, Instagram, website…)</label>
          <input className="w-full border rounded px-3 py-2" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </div>

        <button type="submit" disabled={saving || uploading !== null} className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      {/* FEATURED MODELS */}
      <section className="mt-12 border-t pt-8">
        <h2 className="text-xl font-semibold text-gray-900">Featured models</h2>
        <p className="text-gray-600 text-sm">
          Pick up to {MAX_FEATURED} models to spotlight in a carousel at the top of your page. Drag order with the arrows.
        </p>

        {featuredIds.length > 0 && (
          <ol className="mt-4 space-y-2">
            {featuredIds.map((mid, i) => {
              const m = modelById.get(mid)
              return (
                <li key={mid} className="flex items-center gap-3 rounded-lg border bg-white p-2">
                  <span className="w-5 text-center text-sm text-gray-400">{i + 1}</span>
                  <div className="h-12 w-12 overflow-hidden rounded bg-gray-100">
                    {m?.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{m?.name ?? 'Model'}</span>
                  <button type="button" className="rounded p-1 hover:bg-gray-100 disabled:opacity-30" disabled={i === 0} onClick={() => moveFeatured(i, -1)}><ArrowUp size={16} /></button>
                  <button type="button" className="rounded p-1 hover:bg-gray-100 disabled:opacity-30" disabled={i === featuredIds.length - 1} onClick={() => moveFeatured(i, 1)}><ArrowDown size={16} /></button>
                  <button type="button" className="rounded p-1 text-red-600 hover:bg-red-50" onClick={() => toggleFeatured(mid)}><X size={16} /></button>
                </li>
              )
            })}
          </ol>
        )}

        <button
          type="button"
          onClick={saveFeatured}
          disabled={savingFeatured}
          className="mt-4 rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {savingFeatured ? 'Saving…' : 'Save featured'}
        </button>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-gray-900">Your published models</h3>
          {(pickerModels.length > 0 || modelSearch.trim()) && (
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="Search your models…"
                className="w-56 rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          )}
        </div>
        {pickerModels.length === 0 && modelsFetching ? (
          <p className="mt-3 text-sm text-gray-500">Loading…</p>
        ) : pickerModels.length === 0 && modelSearch.trim() ? (
          <p className="mt-3 text-sm text-gray-500">No models match “{modelSearch}”.</p>
        ) : pickerModels.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Publish a model first, then you can feature it here.</p>
        ) : (
          <div className={`mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 ${modelsFetching ? 'opacity-60' : ''}`}>
            {pickerModels.map((m) => {
              const active = featuredIds.includes(m.id)
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => toggleFeatured(m.id)}
                  className={`group relative overflow-hidden rounded-lg border text-left transition ${active ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <div className="aspect-square w-full bg-gray-100">
                    {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <span className={`absolute right-1.5 top-1.5 rounded-full p-1 ${active ? 'bg-indigo-600 text-white' : 'bg-white/80 text-gray-500'}`}>
                    <Star size={14} fill={active ? 'currentColor' : 'none'} />
                  </span>
                  <span className="block truncate p-2 text-xs font-medium text-gray-800">{m.name}</span>
                </button>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

export default ArtistSettings
