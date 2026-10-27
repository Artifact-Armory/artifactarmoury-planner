import React from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowUp, ArrowDown, X, Search, Check, ExternalLink, Pencil, Trash2, FolderOpen } from 'lucide-react'
import { collectionsApi, MyCollection } from '../../api/endpoints/collections'
import { modelsApi } from '../../api/endpoints/models'
import { useAuthStore } from '../../store/authStore'
import { TerrainModel } from '../../api/types'
import Spinner from '../../components/ui/Spinner'

/**
 * Artist collections — named groups of the artist's listings ("WW2 buildings")
 * shown on their public page so buyers can browse one range at a time. Browsing
 * only: nothing here is sold as a set (that's bundles).
 */
const ArtistCollections: React.FC = () => {
  const user = useAuthStore((s) => s.user)

  const [collections, setCollections] = React.useState<MyCollection[]>([])
  const [models, setModels] = React.useState<TerrainModel[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [newName, setNewName] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Every listing the artist has (drafts included), a page at a time, so big
      // catalogues are all pickable.
      const all: TerrainModel[] = []
      for (let page = 1; page <= 20; page++) {
        const { models: batch, pagination } = await modelsApi.getMyModels({ page, limit: 100 })
        all.push(...batch)
        if (page >= pagination.totalPages || batch.length === 0) break
      }
      setModels(all)
      setCollections(await collectionsApi.getMine())
    } catch {
      setError('Could not load your collections')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const modelById = React.useMemo(() => new Map(models.map((m) => [m.id, m])), [models])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const created = await collectionsApi.create({ name: newName.trim() })
      setCollections((cur) => [...cur, created])
      setNewName('')
      setEditingId(created.id)
      toast.success('Collection created. Now add your listings to it.')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not create the collection')
    } finally {
      setCreating(false)
    }
  }

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= collections.length) return
    const next = [...collections]
    ;[next[index], next[target]] = [next[target], next[index]]
    const prev = collections
    setCollections(next)
    try {
      await collectionsApi.reorder(next.map((c) => c.id))
    } catch {
      setCollections(prev)
      toast.error('Could not save the new order')
    }
  }

  const remove = async (c: MyCollection) => {
    if (!window.confirm(`Delete the collection “${c.name}”? Your listings stay as they are.`)) return
    try {
      await collectionsApi.remove(c.id)
      setCollections((cur) => cur.filter((x) => x.id !== c.id))
      if (editingId === c.id) setEditingId(null)
      toast.success('Collection deleted')
    } catch {
      toast.error('Could not delete the collection')
    }
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  }

  return (
    <div className="px-4 py-10 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold text-foreground">Collections</h1>
      <p className="text-muted-foreground">
        Group your listings into ranges, like “WW2 buildings”, so buyers can browse one range instead of your whole
        catalogue. Collections show on your public page and each gets its own link. They are for browsing only; to sell
        models together at one price, make a <Link to="/artist/bundles" className="text-primary hover:underline">bundle</Link>.
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <form onSubmit={create} className="mt-6 flex flex-wrap gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New collection name, e.g. WW2 buildings"
          maxLength={80}
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {creating ? 'Creating…' : 'Create collection'}
        </button>
      </form>

      {collections.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card py-12 text-center">
          <FolderOpen className="mx-auto text-muted-foreground" size={32} />
          <p className="mt-2 text-sm font-medium text-foreground">No collections yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Create one above, then pick the listings that belong in it.</p>
        </div>
      ) : (
        <ol className="mt-8 space-y-3">
          {collections.map((c, i) => {
            const live = c.modelIds.filter((mid) => modelById.get(mid)?.status === 'published').length
            return (
              <li key={c.id} className="rounded-lg border bg-card">
                <div className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.modelIds.length} {c.modelIds.length === 1 ? 'listing' : 'listings'}
                      {c.modelIds.length !== live ? ` (${live} published)` : ''}
                    </p>
                  </div>
                  <button type="button" title="Move up" className="rounded-sm p-1 hover:bg-muted disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
                  <button type="button" title="Move down" className="rounded-sm p-1 hover:bg-muted disabled:opacity-30" disabled={i === collections.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
                  {user?.id && (
                    <a
                      href={`/artists/${user.id}/collections/${c.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      title="View public page"
                      className="rounded-sm p-1 hover:bg-muted"
                    >
                      <ExternalLink size={16} />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === c.id ? null : c.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                  >
                    <Pencil size={14} />
                    {editingId === c.id ? 'Close' : 'Edit'}
                  </button>
                  <button type="button" title="Delete" className="rounded-sm p-1 text-red-600 hover:bg-red-50" onClick={() => remove(c)}><Trash2 size={16} /></button>
                </div>
                {editingId === c.id && (
                  <CollectionEditor
                    collection={c}
                    models={models}
                    modelById={modelById}
                    onSaved={(saved) => setCollections((cur) => cur.map((x) => (x.id === saved.id ? saved : x)))}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

const CollectionEditor: React.FC<{
  collection: MyCollection
  models: TerrainModel[]
  modelById: Map<string, TerrainModel>
  onSaved: (c: MyCollection) => void
}> = ({ collection, models, modelById, onSaved }) => {
  const [name, setName] = React.useState(collection.name)
  const [description, setDescription] = React.useState(collection.description ?? '')
  const [ids, setIds] = React.useState<string[]>(collection.modelIds)
  const [search, setSearch] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const selected = React.useMemo(() => new Set(ids), [ids])
  const term = search.trim().toLowerCase()
  const shown = term
    ? models.filter((m) => `${m.name} ${m.category ?? ''} ${(m.tags ?? []).join(' ')}`.toLowerCase().includes(term))
    : models

  const toggle = (id: string) =>
    setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  const addAllShown = () =>
    setIds((cur) => [...cur, ...shown.map((m) => m.id).filter((id) => !cur.includes(id))])

  const move = (index: number, dir: -1 | 1) =>
    setIds((cur) => {
      const target = index + dir
      if (target < 0 || target >= cur.length) return cur
      const next = [...cur]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const save = async () => {
    if (!name.trim()) {
      toast.error('Give your collection a name')
      return
    }
    setSaving(true)
    try {
      let meta = collection
      if (name.trim() !== collection.name || description.trim() !== (collection.description ?? '')) {
        meta = await collectionsApi.update(collection.id, { name: name.trim(), description: description.trim() })
      }
      const savedIds = await collectionsApi.setModels(collection.id, ids)
      setIds(savedIds)
      onSaved({ ...meta, modelIds: savedIds })
      toast.success('Collection saved')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Could not save the collection')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t p-4">
      <div className="grid gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Name</label>
          <input className="w-full rounded-sm border px-3 py-2" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Description (optional)</label>
          <textarea className="w-full rounded-sm border px-3 py-2" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <h3 className="mt-5 text-sm font-medium text-foreground">In this collection ({ids.length})</h3>
      {ids.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Nothing yet. Click listings below to add them.</p>
      ) : (
        <ol className="mt-2 max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {ids.map((mid, i) => {
            const m = modelById.get(mid)
            return (
              <li key={mid} className="flex items-center gap-3 rounded-lg border bg-card p-1.5">
                <span className="w-6 text-center text-xs text-muted-foreground">{i + 1}</span>
                <div className="h-9 w-9 flex-none overflow-hidden rounded-sm bg-muted">
                  {m?.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
                </div>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{m?.name ?? 'Listing'}</span>
                {m && m.status !== 'published' && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Draft</span>
                )}
                <button type="button" className="rounded-sm p-1 hover:bg-muted disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                <button type="button" className="rounded-sm p-1 hover:bg-muted disabled:opacity-30" disabled={i === ids.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
                <button type="button" className="rounded-sm p-1 text-red-600 hover:bg-red-50" onClick={() => toggle(mid)}><X size={14} /></button>
              </li>
            )
          })}
        </ol>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save collection'}
      </button>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">Your listings</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your listings…"
              className="w-56 rounded-md border border-border py-1.5 pl-8 pr-3 text-sm shadow-xs focus:border-primary focus:outline-hidden"
            />
          </div>
          {shown.length > 0 && (
            <button type="button" onClick={addAllShown} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
              {`Add all${term ? ' matching' : ''} (${shown.length})`}
            </button>
          )}
        </div>
      </div>
      {models.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Upload a model first, then you can add it here.</p>
      ) : shown.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No listings match “{search}”.</p>
      ) : (
        <div className="mt-3 grid max-h-[32rem] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4">
          {shown.map((m) => {
            const active = selected.has(m.id)
            return (
              <button
                type="button"
                key={m.id}
                onClick={() => toggle(m.id)}
                className={`group relative overflow-hidden rounded-lg border text-left transition ${active ? 'border-primary ring-2 ring-primary' : 'border-border'}`}
              >
                <div className="aspect-square w-full bg-muted">
                  {m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </div>
                {active && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-1 text-primary-foreground">
                    <Check size={14} />
                  </span>
                )}
                <span className="block truncate p-2 text-xs font-medium text-foreground">
                  {m.name}
                  {m.status !== 'published' ? <span className="text-muted-foreground"> · draft</span> : null}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ArtistCollections
