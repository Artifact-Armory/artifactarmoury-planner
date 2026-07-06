// src/ui/App.tsx — full-screen game-like planner shell.
import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MousePointer2, Undo2, Redo2, Grid3x3, Maximize2, Save, ShoppingCart,
  HelpCircle, Trash2, X, Search, Box, Home, RotateCw, RotateCcw, ChevronDown,
  Mountain, ArrowUp, ArrowDown, Waves, Square, Download,
} from 'lucide-react'
import type { TerrainTool } from '@core/heightmap'
import hotToast from 'react-hot-toast'
import { useAppStore } from '@state/store'
import { useCartStore } from '@/store/cartStore'
import { TABLE_MATERIALS } from '@core/tableMaterials'
import { useAuthStore } from '@/store/authStore'
import { tablesApi } from '@/api/endpoints/tables'
import { serializeLayout, deserializeLayout } from '@state/tableMapping'
import { ThreeStage } from '@scene/ThreeStage'
import { subscribeLoading } from '@scene/loadManager'
import { CoachMarks } from './CoachMarks'
import { HelpOverlay } from './HelpOverlay'
import './styles.css'

const M_PER_FT = 0.3048
// Common tabletop-wargaming board sizes (feet).
const TABLE_PRESETS: Array<{ label: string; w: number; h: number }> = [
  { label: '2×2', w: 2, h: 2 },
  { label: '3×3', w: 3, h: 3 },
  { label: '4×4', w: 4, h: 4 },
  { label: '4×6', w: 4, h: 6 },
  { label: '6×4', w: 6, h: 4 },
  { label: '6×3', w: 6, h: 3 },
]

export default function App({ tableId, shareToken }: { tableId?: string; shareToken?: string } = {}) {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)

  // Server-table binding: which saved table (if any) this planner is editing.
  const [savedTableId, setSavedTableId] = React.useState<string | null>(tableId ?? null)
  const [savedTableName, setSavedTableName] = React.useState<string | null>(null)
  // Loading a shared link gives you an editable copy — you don't own the original
  // until you save it as your own (which flips this true).
  const [isOwner, setIsOwner] = React.useState<boolean>(!shareToken)
  const [saving, setSaving] = React.useState(false)

  const assets = useAppStore((s) => s.assets)
  const bundles = useAppStore((s) => s.bundles)
  const sets = useAppStore((s) => s.sets)
  const setPartAssets = useAppStore((s) => s.setPartAssets)
  const ownedModelIds = useAppStore((s) => s.ownedModelIds)
  const ownedBundleIds = useAppStore((s) => s.ownedBundleIds)
  const cartItems = useCartStore((s) => s.items)
  const instances = useAppStore((s) => s.instances)
  const selectedInstanceIds = useAppStore((s) => s.selectedInstanceIds)
  const tiltSelected = useAppStore((s) => s.actions.tiltSelected)
  const selectedAssetId = useAppStore((s) => s.selectedAssetId)
  const setSelectedAsset = useAppStore((s) => s.setSelectedAsset)
  const snapBaseline = useAppStore((s) => s.snapBaseline)
  const altMomentary = useAppStore((s) => s.altMomentary)
  const toggleSnapBaseline = useAppStore((s) => s.toggleSnapBaseline)
  const placementLevel = useAppStore((s) => s.placementLevel)
  const placementManual = useAppStore((s) => s.placementManual)
  const tableMaterial = useAppStore((s) => s.tableMaterial)
  const setTableMaterial = useAppStore((s) => s.setTableMaterial)
  const table = useAppStore((s) => s.table)
  const setTable = useAppStore((s) => s.setTable)

  const loadCatalogue = useAppStore((s) => s.actions.loadAssetCatalogue)
  const undo = useAppStore((s) => s.actions.undo)
  const redo = useAppStore((s) => s.actions.redo)
  const canUndo = useAppStore((s) => s.actions.canUndo())
  const canRedo = useAppStore((s) => s.actions.canRedo())
  const fitView = useAppStore((s) => s.actions.fitView)
  const clearInstances = useAppStore((s) => s.actions.clearInstances)
  const addLayoutToShopCart = useAppStore((s) => s.actions.addLayoutToShopCart)
  const exportLayout = useAppStore((s) => s.actions.exportLayout)
  const importLayout = useAppStore((s) => s.actions.importLayout)
  const applyLayout = useAppStore((s) => s.actions.applyLayout)

  // Terrain sculpting
  const terrainTool = useAppStore((s) => s.terrainTool)
  const brushRadius = useAppStore((s) => s.brushRadius)
  const brushStrength = useAppStore((s) => s.brushStrength)
  const setTerrainTool = useAppStore((s) => s.setTerrainTool)
  const setBrush = useAppStore((s) => s.setBrush)
  const resetTerrain = useAppStore((s) => s.actions.resetTerrain)
  const [terrainPanelOpen, setTerrainPanelOpen] = React.useState(false)
  const [terrainQuote, setTerrainQuote] = React.useState<{ tileCount: number; price: number } | null>(null)
  const [exportingTiles, setExportingTiles] = React.useState(false)

  // Quote (tile count + price) for the saved table's sculpted surface. Reflects
  // the last save — sculpt then Save (Ctrl+S) to refresh.
  React.useEffect(() => {
    if (!terrainPanelOpen || !savedTableId) { setTerrainQuote(null); return }
    let cancelled = false
    tablesApi.getTerrainQuote(savedTableId)
      .then((q) => { if (!cancelled) setTerrainQuote(q.hasTerrain ? { tileCount: q.tileCount, price: q.price } : null) })
      .catch(() => { if (!cancelled) setTerrainQuote(null) })
    return () => { cancelled = true }
  }, [terrainPanelOpen, savedTableId, savedTableName])

  async function handleExportTiles() {
    if (!savedTableId) {
      hotToast.error('Save your table first, then export the tiles')
      return
    }
    setExportingTiles(true)
    try {
      await tablesApi.downloadTerrainTiles(savedTableId, user?.email)
      hotToast.success('Downloading printable tiles…')
    } catch (e: any) {
      const s = e?.response?.status
      hotToast.error(
        s === 400 ? 'Sculpt some terrain first, then save'
          : s === 403 ? 'You can only export your own map'
          : 'Tile export failed — try again',
      )
    } finally {
      setExportingTiles(false)
    }
  }

  const [query, setQuery] = React.useState('')
  const [paletteTab, setPaletteTab] = React.useState<'catalogue' | 'mine'>('catalogue')
  const [expandedBundles, setExpandedBundles] = React.useState<Set<string>>(new Set())
  const [uiHidden, setUiHidden] = React.useState(false)
  const [showHelp, setShowHelp] = React.useState(false)
  const [toast, setToast] = React.useState<{ count: number } | null>(null)
  const startedRef = React.useRef(false)

  // Gate the builder behind a loading bar until the initial scene assets
  // (table-surface textures + starter-layout models) have finished loading,
  // so the user doesn't start placing while multi-MB textures jank in.
  const [sceneReady, setSceneReady] = React.useState(false)
  const [loadPct, setLoadPct] = React.useState(0)
  React.useEffect(() => {
    let done = false
    let settleTimer: number | undefined
    const finish = () => {
      if (!done) { done = true; setSceneReady(true) }
    }
    const unsub = subscribeLoading((p) => {
      if (p.total > 0) setLoadPct(Math.round((p.loaded / p.total) * 100))
      window.clearTimeout(settleTimer)
      if (p.active) return
      // Idle — but textures and models load as separate batches, so wait a beat
      // in case another batch is about to queue. Only reveal once the queue has
      // stayed drained, so the user never starts mid-download.
      if (p.total > 0) settleTimer = window.setTimeout(finish, 600)
    })
    // Absolute fallback: procedural placeholders / no CDN means nothing loads
    // over the network — never leave the user stuck behind the overlay.
    const hard = window.setTimeout(finish, 8000)
    return () => { unsub(); window.clearTimeout(settleTimer); window.clearTimeout(hard) }
  }, [])

  // Load the catalogue, then frame the (empty) table once it's ready. The planner
  // opens on a clear table — the user places pieces themselves.
  React.useEffect(() => {
    loadCatalogue()
  }, [loadCatalogue])
  React.useEffect(() => {
    if (assets.length && !startedRef.current) {
      startedRef.current = true
      setTimeout(() => fitView(), 50)
    }
  }, [assets.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load a server-saved table (own id or a shared token) into the planner.
  // Re-runs when the signed-in user changes so swapping accounts never leaves the
  // previous user's layout on the table.
  React.useEffect(() => {
    // Scratch mode (/planner): start from a clean table. This also clears a
    // previously-loaded table when navigating /planner/t/:id → /planner, and
    // resets the layout when a different user signs in.
    if (!tableId && !shareToken) {
      clearInstances()
      useAppStore.getState().actions.resetTerrain()
      setSavedTableId(null)
      setSavedTableName(null)
      setIsOwner(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const t = shareToken
          ? await tablesApi.getSharedTable(shareToken)
          : await tablesApi.getById(tableId!, { userEmail: user?.email })
        if (cancelled) return
        const { table, tableMaterial, instances, heightmap } = deserializeLayout(t.tableConfig, t.layoutData)
        applyLayout({ table, tableMaterial, instances, heightmap })
        setSavedTableName(shareToken ? `${t.name} (Copy)` : t.name)
        if (!shareToken) {
          setSavedTableId(t.id)
          // Own it only if it's yours; otherwise Save makes a copy under your account.
          setIsOwner(!!user?.email && t.userEmail === user.email)
        }
      } catch {
        if (!cancelled) hotToast.error('Could not load that table')
      }
    })()
    return () => { cancelled = true }
  }, [tableId, shareToken, user?.email]) // eslint-disable-line react-hooks/exhaustive-deps

  // global UI keys (scene keys are handled inside ThreeStage)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'h' && !e.ctrlKey && !e.metaKey) setUiHidden((v) => !v)
      if (e.key === '?') setShowHelp((v) => !v)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // re-bind each render so handleSave closes over latest state

  const effSnap = snapBaseline === 'snap' ? !altMomentary : altMomentary

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return assets
    return assets.filter(
      (a) => a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }, [assets, query])

  // Group the palette by category ("Terrain" first, then the rest alphabetically).
  const paletteGroups = React.useMemo(() => {
    const groups = new Map<string, typeof filtered>()
    for (const a of filtered) {
      const cat = a.category ?? 'Terrain'
      if (!groups.has(cat)) groups.set(cat, [])
      groups.get(cat)!.push(a)
    }
    return [...groups.entries()].sort(([x], [y]) =>
      x === 'Terrain' ? -1 : y === 'Terrain' ? 1 : x.localeCompare(y),
    )
  }, [filtered])

  // Part assets (from "set" models) are resolvable for tiles but kept OFF the
  // flat catalogue — merge them here only for lookups.
  const assetsById = React.useMemo(
    () => new Map([...assets, ...setPartAssets].map((a) => [a.id, a])),
    [assets, setPartAssets],
  )

  // "My items" tab: the bundles + sets + models the user owns or has in their
  // basket. Bundles and sets render as expandable group tiles; their members
  // aren't repeated as standalone tiles.
  const myItems = React.useMemo(() => {
    const cartModelIds = new Set(cartItems.filter((i) => i.kind === 'model').map((i) => i.id))
    const cartBundleIds = new Set(cartItems.filter((i) => i.kind === 'bundle').map((i) => i.id))

    // Bundles: shown when owned / in-basket / your own.
    const bundleGroups = bundles
      .filter((b) => ownedBundleIds.has(b.id) || cartBundleIds.has(b.id) || (user?.id && b.artistId === user.id))
      .map((b) => ({
        key: `bundle:${b.id}`, kind: 'bundle' as const, id: b.id, name: b.name,
        thumbnail: b.thumbnail, price: b.price, owned: ownedBundleIds.has(b.id),
        memberIds: b.modelIds,
      }))
    // Sets: ownership is on the parent MODEL (owned / in-basket / your own).
    const setGroups = sets
      .filter((s) => ownedModelIds.has(s.id) || cartModelIds.has(s.id) || (user?.id && s.artistId === user.id))
      .map((s) => ({
        key: `set:${s.id}`, kind: 'set' as const, id: s.id, name: s.name,
        thumbnail: s.thumbnail, price: s.price, owned: ownedModelIds.has(s.id),
        memberIds: s.partAssetIds,
      }))
    const groups = [...bundleGroups, ...setGroups]

    // Models already shown inside a group tile aren't repeated as standalone tiles.
    const memberIds = new Set<string>()
    groups.forEach((g) => g.memberIds.forEach((id) => memberIds.add(id)))
    const setModelIds = new Set(sets.map((s) => s.id)) // a set's parent model is its tile
    const modelIds = new Set<string>([...ownedModelIds, ...cartModelIds])
    const displayModels = [...modelIds].filter(
      (id) => !memberIds.has(id) && !setModelIds.has(id) && assetsById.has(id),
    )
    const count = groups.length + displayModels.length
    return { groups, displayModels, count }
  }, [cartItems, ownedModelIds, ownedBundleIds, bundles, sets, assetsById, user?.id])

  const toggleBundleExpanded = (id: string) =>
    setExpandedBundles((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // A single placeable model tile (shared by the catalogue + "My items" tabs).
  const renderModelTile = (id: string, ownedHint?: boolean) => {
    const a = assetsById.get(id)
    if (!a) return null
    const owned = ownedHint ?? ownedModelIds.has(id)
    return (
      <button
        key={id}
        className={`tb-tile ${selectedAssetId === a.id ? 'is-active' : ''}`}
        onClick={() => setSelectedAsset(selectedAssetId === a.id ? null : a.id)}
        title={`Place ${a.name}`}
      >
        <div className="tb-thumb">{a.thumbnail ? <img src={a.thumbnail} alt="" /> : <Box size={22} />}</div>
        <div className="tb-tile-name">{a.name}</div>
        <div className="tb-tile-meta">
          <span className={`tb-pill ${a.fulfillment}`}>{a.fulfillment === 'stl' ? 'STL' : 'Print'}</span>
          <span>{owned ? 'Owned' : 'In basket'}</span>
        </div>
      </button>
    )
  }

  // Bill of materials: tally by asset. Digital STLs are bought once (print as
  // many copies as you like), so the price counts each unique model a single
  // time — qty is just how many are on the table.
  const bom = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of instances) counts.set(i.assetId, (counts.get(i.assetId) ?? 0) + 1)
    // Set parts live in setPartAssets (off the flat catalogue) — include them so
    // placed set pieces show in the build and their (primary-only) price counts.
    const byId = new Map([...assets, ...setPartAssets].map((a) => [a.id, a]))
    const rows = [...counts.entries()]
      .map(([id, qty]) => ({ asset: byId.get(id), qty }))
      .filter((r) => r.asset)
    const total = rows.reduce((sum, r) => sum + (r.asset!.price ?? 0), 0)
    const pieceCount = instances.length
    return { rows, total, pieceCount }
  }, [instances, assets, setPartAssets])

  function handleAddAll() {
    const count = addLayoutToShopCart()
    if (count > 0) setToast({ count })
  }

  async function handleSave() {
    if (!isAuthenticated || !user?.email) {
      hotToast.error('Log in to save this table to your account')
      navigate('/login')
      return
    }
    if (saving) return

    const s = useAppStore.getState()
    const { tableConfig, layoutData } = serializeLayout(s.table, s.tableMaterial, s.instances, s.heightmap)
    const email = user.email

    setSaving(true)
    try {
      if (savedTableId && isOwner) {
        // Update the table you already own.
        await tablesApi.updateTable(savedTableId, {
          name: savedTableName ?? 'My table',
          tableConfig: tableConfig as any,
          layoutData: layoutData as any,
          userEmail: email,
        })
        hotToast.success('Table saved')
      } else {
        // New table, or a copy of a shared one → create under your account.
        const name = window.prompt('Name this table:', savedTableName ?? `Table ${new Date().toLocaleDateString()}`)
        if (!name) { setSaving(false); return }
        const created = await tablesApi.createTable({ name, tableConfig: tableConfig as any, layoutData: layoutData as any, userEmail: email })
        setSavedTableId(created.id)
        setSavedTableName(created.name)
        setIsOwner(true)
        hotToast.success('Saved to your tables')
        navigate(`/planner/t/${created.id}`)
      }
    } catch {
      hotToast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleExport() {
    const blob = new Blob([exportLayout()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `terrain-map-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImport() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (e) => {
        const json = e.target?.result as string
        if (json) importLayout(json)
      }
      reader.readAsText(file)
    }
    input.click()
  }

  // Current board size in feet (rounded for display / preset matching).
  const wFt = Math.round((table.width / M_PER_FT) * 10) / 10
  const hFt = Math.round((table.height / M_PER_FT) * 10) / 10

  function applyTableFt(nextW: number, nextH: number, refit = false) {
    const w = Math.min(12, Math.max(1, nextW)) * M_PER_FT
    const h = Math.min(12, Math.max(1, nextH)) * M_PER_FT
    setTable({ width: w, height: h })
    if (refit) window.setTimeout(() => fitView(), 60)
  }

  return (
    <div className="tb-fs">
      <ThreeStage />

      {/* Loading gate — blocks interaction until the table + its textures are ready */}
      {!sceneReady && (
        <div className="tb-loading" role="status" aria-live="polite">
          <div className="tb-loading-card">
            <div className="tb-loading-title">Preparing your table…</div>
            <div className="tb-loading-track">
              <div className="tb-loading-bar" style={{ width: `${Math.max(6, loadPct)}%` }} />
            </div>
            <div className="tb-loading-pct">{loadPct}%</div>
          </div>
        </div>
      )}

      {/* Mode badge (always reflects current placement mode) */}
      {!uiHidden && (
        <div className="tb-badge" data-free={!effSnap}>
          {effSnap ? (
            <><Grid3x3 size={14} /> Snapping to grid</>
          ) : (
            <><Box size={14} /> FREE placement <span className="tb-small">· hold Alt for grid</span></>
          )}
          {selectedAssetId && (
            <span className="tb-level" data-manual={placementManual}>
              Level {Math.round(placementLevel)}
              <span className="tb-small">· {placementManual ? 'manual (PgUp/PgDn)' : 'on surface'}</span>
            </span>
          )}
        </div>
      )}

      {!uiHidden && (
        <>
          {/* Top toolbar */}
          <div className="tb-toolbar">
            <button
              className={`tb-icon ${!selectedAssetId ? 'is-active' : ''}`}
              title="Select / move (Esc)"
              onClick={() => setSelectedAsset(null)}
            >
              <MousePointer2 size={18} />
            </button>
            <div className="tb-sep" />
            <button className="tb-icon" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
              <Undo2 size={18} />
            </button>
            <button className="tb-icon" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
              <Redo2 size={18} />
            </button>
            <div className="tb-sep" />
            <button
              className={`tb-icon ${snapBaseline === 'snap' ? 'is-active' : ''}`}
              title="Toggle snap ⇄ free (G). Hold Alt for momentary opposite."
              onClick={() => toggleSnapBaseline()}
            >
              <Grid3x3 size={18} />
            </button>
            <button className="tb-icon" title="Fit view (F)" onClick={() => fitView()}>
              <Maximize2 size={18} />
            </button>
            <div className="tb-sep" />
            <button
              className={`tb-icon ${terrainPanelOpen || terrainTool !== 'none' ? 'is-active' : ''}`}
              title="Sculpt the terrain (hills, cliffs, rivers, trenches)"
              onClick={() => {
                const open = !terrainPanelOpen
                setTerrainPanelOpen(open)
                if (open) setSelectedAsset(null)
                else setTerrainTool('none')
              }}
            >
              <Mountain size={18} />
            </button>
            {selectedInstanceIds.length > 0 && (
              <>
                <div className="tb-sep" />
                <button
                  className="tb-icon"
                  title="Tilt selection back 90° (T)"
                  onClick={() => tiltSelected(90)}
                >
                  <RotateCw size={18} />
                </button>
                <button
                  className="tb-icon"
                  title="Tilt selection forward 90° (Shift+T)"
                  onClick={() => tiltSelected(-90)}
                >
                  <RotateCcw size={18} />
                </button>
              </>
            )}
            <div className="tb-sep" />
            <button className="tb-icon" title="Save map (Ctrl+S)" onClick={handleSave}>
              <Save size={18} />
            </button>
            <button
              className="tb-icon"
              title="Reset view (Home)"
              onClick={() => useAppStore.getState().cameraApi?.home()}
            >
              <Home size={18} />
            </button>
            <button className="tb-icon" title="Keyboard help (?)" onClick={() => setShowHelp(true)}>
              <HelpCircle size={18} />
            </button>
          </div>

          {/* Terrain sculpting panel */}
          {terrainPanelOpen && (
            <div className="tb-terrain">
              <div className="tb-terrain-head">
                <span><Mountain size={14} /> Terrain sculpt</span>
                <button
                  className="tb-icon"
                  title="Close terrain tools"
                  onClick={() => { setTerrainPanelOpen(false); setTerrainTool('none') }}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="tb-terrain-tools">
                {([
                  { tool: 'raise', label: 'Raise', icon: <ArrowUp size={16} /> },
                  { tool: 'lower', label: 'Lower', icon: <ArrowDown size={16} /> },
                  { tool: 'smooth', label: 'Smooth', icon: <Waves size={16} /> },
                  { tool: 'flatten', label: 'Flatten', icon: <Square size={16} /> },
                ] as Array<{ tool: TerrainTool; label: string; icon: React.ReactNode }>).map((t) => (
                  <button
                    key={t.tool}
                    className={`tb-terrain-tool ${terrainTool === t.tool ? 'is-active' : ''}`}
                    onClick={() => setTerrainTool(terrainTool === t.tool ? 'none' : t.tool)}
                  >
                    {t.icon}<span>{t.label}</span>
                  </button>
                ))}
              </div>
              <label className="tb-terrain-row">
                <span>Brush size</span>
                <input type="range" min={0.03} max={0.4} step={0.01} value={brushRadius}
                  onChange={(e) => setBrush({ radius: parseFloat(e.target.value) })} />
              </label>
              <label className="tb-terrain-row">
                <span>Strength</span>
                <input type="range" min={0.05} max={1} step={0.05} value={brushStrength}
                  onChange={(e) => setBrush({ strength: parseFloat(e.target.value) })} />
              </label>
              <button
                className="tb-terrain-reset"
                onClick={() => { if (window.confirm('Flatten all terrain edits on this table?')) resetTerrain() }}
              >
                <Trash2 size={14} /> Reset terrain
              </button>

              <div className="tb-terrain-export">
                <div className="tb-terrain-export-head">Printable tiles</div>
                {terrainQuote ? (
                  <p className="tb-small">
                    {terrainQuote.tileCount} tile{terrainQuote.tileCount === 1 ? '' : 's'} · £{terrainQuote.price.toFixed(2)}
                    <span className="tb-terrain-sub"> (reflects last save)</span>
                  </p>
                ) : (
                  <p className="tb-small tb-terrain-sub">
                    {savedTableId ? 'Sculpt, then Save (Ctrl+S) to price the tiles.' : 'Save your table to price & export tiles.'}
                  </p>
                )}
                <button className="tb-terrain-tool tb-terrain-export-btn" disabled={exportingTiles} onClick={handleExportTiles}>
                  <Download size={16} />
                  <span>{exportingTiles ? 'Preparing…' : 'Download printable tiles'}</span>
                </button>
              </div>

              <p className="tb-small tb-terrain-hint">
                Drag on the table to sculpt. Cliffs are steep slopes. Tiles are watertight shells —
                print with normal infill. Placed models don’t rest on hills yet (coming next).
              </p>
            </div>
          )}

          {/* Catalogue / palette */}
          <aside className="tb-palette">
            <div className="tb-palette-tabs">
              <button
                className={`tb-tab ${paletteTab === 'catalogue' ? 'is-active' : ''}`}
                onClick={() => setPaletteTab('catalogue')}
              >
                Catalogue <span className="tb-small">{filtered.length}</span>
              </button>
              <button
                className={`tb-tab ${paletteTab === 'mine' ? 'is-active' : ''}`}
                onClick={() => setPaletteTab('mine')}
                title="Models you own or have in your basket, including bundles"
              >
                My items <span className="tb-small">{myItems.count}</span>
              </button>
            </div>

            {paletteTab === 'catalogue' ? (
              <>
                <div className="tb-searchbar">
                  <Search size={14} />
                  <input
                    placeholder="Search terrain…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="tb-palette-scroll">
                  {paletteGroups.map(([cat, items]) => (
                    <div key={cat} className="tb-palette-section">
                      <div className="tb-palette-cat">{cat === 'Elevation' ? 'Elevation / Hills' : cat}</div>
                      <div className="tb-palette-grid">
                        {items.map((a) => (
                          <button
                            key={a.id}
                            className={`tb-tile ${selectedAssetId === a.id ? 'is-active' : ''}`}
                            onClick={() => setSelectedAsset(selectedAssetId === a.id ? null : a.id)}
                            title={`Place ${a.name}`}
                          >
                            <div className="tb-thumb">
                              {a.thumbnail ? <img src={a.thumbnail} alt="" /> : <Box size={22} />}
                            </div>
                            <div className="tb-tile-name">{a.name}</div>
                            <div className="tb-tile-meta">
                              <span className={`tb-pill ${a.fulfillment}`}>{a.fulfillment === 'stl' ? 'STL' : 'Print'}</span>
                              {a.price != null && <span>£{a.price.toFixed(2)}</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {filtered.length === 0 && <div className="tb-small" style={{ padding: 8 }}>No terrain matches.</div>}
                </div>
              </>
            ) : (
              <div className="tb-palette-scroll">
                {myItems.count === 0 && (
                  <div className="tb-small" style={{ padding: 8 }}>
                    Nothing yet. Place models from the Catalogue (they’re added to your basket), or buy a bundle / multi-part set — they’ll appear here.
                  </div>
                )}

                {myItems.groups.map((g) => {
                  const expanded = expandedBundles.has(g.key)
                  return (
                    <div key={g.key} className="tb-bundle">
                      <button className="tb-bundle-head" onClick={() => toggleBundleExpanded(g.key)}>
                        <div className="tb-thumb sm">
                          {g.thumbnail ? <img src={g.thumbnail} alt="" /> : <Box size={16} />}
                        </div>
                        <div className="tb-bundle-info">
                          <div className="tb-tile-name">{g.name}</div>
                          <div className="tb-tile-meta">
                            <span className="tb-pill bundle">{g.kind === 'set' ? 'SET' : 'BUNDLE'} · {g.memberIds.length}</span>
                            <span>{g.owned ? 'Owned' : `£${g.price.toFixed(2)}`}</span>
                          </div>
                        </div>
                        <ChevronDown size={16} className={`tb-chev ${expanded ? 'is-open' : ''}`} />
                      </button>
                      {expanded && (
                        <div className="tb-palette-grid" style={{ marginTop: 8 }}>
                          {g.memberIds.map((id) => renderModelTile(id, g.owned))}
                        </div>
                      )}
                    </div>
                  )
                })}

                {myItems.displayModels.length > 0 && (
                  <div className="tb-palette-section">
                    <div className="tb-palette-cat">Individual models</div>
                    <div className="tb-palette-grid">
                      {myItems.displayModels.map((id) => renderModelTile(id))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>

          {/* Bill of materials / cart */}
          <aside className="tb-bom">
            <div className="tb-bom-head">
              <strong>Your build</strong>
              <span className="tb-small">{bom.pieceCount} pieces</span>
            </div>
            <div className="tb-bom-list">
              {bom.rows.length === 0 && (
                <div className="tb-small" style={{ padding: 8 }}>
                  Pick terrain on the left and click the table to place it.
                </div>
              )}
              {bom.rows.map((r) => (
                <div className="tb-bom-row" key={r.asset!.id}>
                  <div className="tb-thumb sm">
                    {r.asset!.thumbnail ? <img src={r.asset!.thumbnail} alt="" /> : <Box size={16} />}
                  </div>
                  <div className="tb-bom-name">{r.asset!.name}</div>
                  <div className="tb-bom-qty" title={`${r.qty} on the table — you only pay once`}>×{r.qty}</div>
                  <div className="tb-bom-price">£{(r.asset!.price ?? 0).toFixed(2)}</div>
                </div>
              ))}
            </div>
            <div className="tb-bom-total">
              <span>Total</span>
              <strong>£{bom.total.toFixed(2)}</strong>
            </div>
            <button className="tb-cta" disabled={bom.pieceCount === 0} onClick={handleAddAll}>
              <ShoppingCart size={16} /> Add all to basket
            </button>
            <div className="tb-bom-foot">
              <button
                className="tb-btn tb-clear"
                disabled={bom.pieceCount === 0}
                onClick={() => {
                  if (window.confirm('Clear the whole table?')) clearInstances()
                }}
              >
                <Trash2 size={14} /> Clear
              </button>
              <button className="tb-btn" onClick={handleImport} title="Load a map file">
                Import
              </button>
            </div>
          </aside>

          {/* Table size (presets + custom, in feet) */}
          <div className="tb-tablesize">
            <span className="tb-small">Table size (ft)</span>
            <div className="tb-preset-row">
              {TABLE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`tb-preset ${wFt === p.w && hFt === p.h ? 'is-active' : ''}`}
                  onClick={() => applyTableFt(p.w, p.h, true)}
                  title={`${p.w}ft × ${p.h}ft`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="tb-dim-row">
              <input
                type="number" min={1} max={12} step={0.5} value={wFt}
                onChange={(e) => applyTableFt(Number(e.target.value) || wFt, hFt)}
                aria-label="Table width (feet)"
              />
              <span className="tb-small">×</span>
              <input
                type="number" min={1} max={12} step={0.5} value={hFt}
                onChange={(e) => applyTableFt(wFt, Number(e.target.value) || hFt)}
                aria-label="Table depth (feet)"
              />
              <button className="tb-preset" title="Fit view (F)" onClick={() => fitView()}>Fit</button>
            </div>
          </div>

          {/* Table surface picker */}
          <div className="tb-surface">
            <span className="tb-small">Surface</span>
            {TABLE_MATERIALS.map((m) => (
              <button
                key={m.id}
                className={`tb-swatch ${tableMaterial === m.id ? 'is-active' : ''}`}
                style={{ background: `#${m.color.toString(16).padStart(6, '0')}` }}
                title={m.label}
                onClick={() => setTableMaterial(m.id)}
              />
            ))}
          </div>
        </>
      )}

      {uiHidden && (
        <button className="tb-show-ui" onClick={() => setUiHidden(false)} title="Show UI (H)">
          Show UI
        </button>
      )}

      <CoachMarks />
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}

      {/* Add-to-basket confirmation (the real CartDrawer isn't mounted on /planner) */}
      {toast && (
        <div className="tb-toast">
          <div className="tb-toast-msg">
            <ShoppingCart size={18} />
            Added <strong>{toast.count}</strong> {toast.count === 1 ? 'piece' : 'pieces'} to your basket.
          </div>
          <div className="tb-toast-actions">
            <button className="tb-btn" onClick={() => setToast(null)}>Keep building</button>
            <button className="tb-cta sm" onClick={() => navigate('/checkout')}>Go to checkout</button>
          </div>
          <button className="tb-toast-x" onClick={() => setToast(null)} aria-label="Dismiss"><X size={16} /></button>
        </div>
      )}
    </div>
  )
}
