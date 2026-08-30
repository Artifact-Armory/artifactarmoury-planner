// src/ui/App.tsx — full-screen game-like planner shell.
import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MousePointer2, Undo2, Redo2, Grid3x3, Maximize2, Save, ShoppingCart,
  HelpCircle, Trash2, X, Search, Box, Home, RotateCw, RotateCcw, ChevronDown,
  Mountain, ArrowUp, ArrowDown, Waves, Square, Download, ArrowLeft, Eye, Check, ExternalLink,
  Paintbrush, RotateCcw as RotateLeftIcon, Layers, PanelLeft, PanelRight,
} from 'lucide-react'
import type { TerrainTool } from '@core/heightmap'
import { FEATURES } from '@/config/features'
import hotToast from 'react-hot-toast'
import { useAppStore } from '@state/store'
import { useCartStore, cartKey } from '@/store/cartStore'
import { TABLE_MATERIALS } from '@core/tableMaterials'
import { useAuthStore } from '@/store/authStore'
import { tablesApi } from '@/api/endpoints/tables'
import { assetUrl } from '@/api/transformers'
import { collaborationsApi, type TableCollaboration } from '@/api/endpoints/collaborations'
import CollabRequestModal from './CollabRequestModal'
import { serializeLayout, deserializeLayout } from '@state/tableMapping'
import { resolveAssetsByIds, getAssetById } from '@core/assets'
import { ThreeStage } from '@scene/ThreeStage'
import { subscribeLoading } from '@scene/loadManager'
import { CoachMarks } from './CoachMarks'
import { useCoarsePointer, useCompactLayout } from './useDeviceLayout'
import { HelpOverlay } from './HelpOverlay'
import { PreviewQualityNotice, hasAcknowledgedPreviewQuality } from './PreviewQualityNotice'
import OnboardingTour from '@/components/help/OnboardingTour'
import { plannerShowcaseSteps, plannerBuyerSteps } from '@/components/help/tourSteps'
import { useOnboardingStore } from '@/store/onboardingStore'
import { useTaxStore, grossFromNet, grossFromLines } from '@/store/taxStore'
import Logo from '@/components/common/Logo'
import FacetRail from '@/components/taxonomy/FacetRail'
import { facetAppliesTo, MODEL_CLASSES, MODEL_CLASS_SLUG } from '@/api/endpoints/taxonomy'
import { SlidersHorizontal } from 'lucide-react'
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

export default function App({ tableId, shareToken, readOnly = false }: { tableId?: string; shareToken?: string; readOnly?: boolean } = {}) {
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
  const catalogueClass = useAppStore((s) => s.catalogueClass)
  const catalogueTerms = useAppStore((s) => s.catalogueTerms)
  const catalogueFacets = useAppStore((s) => s.catalogueFacets)
  const catalogueLoading = useAppStore((s) => s.catalogueLoading)
  const setCatalogueFilter = useAppStore((s) => s.actions.setCatalogueFilter)
  const bundles = useAppStore((s) => s.bundles)
  const sets = useAppStore((s) => s.sets)
  const setPartAssets = useAppStore((s) => s.setPartAssets)
  const myModels = useAppStore((s) => s.myModels)
  const ownedModelIds = useAppStore((s) => s.ownedModelIds)
  const ownedBundleIds = useAppStore((s) => s.ownedBundleIds)
  const cartItems = useCartStore((s) => s.items)
  const addCartItem = useCartStore((s) => s.addItem)
  const removeCartItem = useCartStore((s) => s.removeItem)
  const instances = useAppStore((s) => s.instances)
  const selectedInstanceIds = useAppStore((s) => s.selectedInstanceIds)
  const tiltSelected = useAppStore((s) => s.actions.tiltSelected)
  const removeInstances = useAppStore((s) => s.actions.removeInstances)
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
  const applyLayout = useAppStore((s) => s.actions.applyLayout)
  const setReadOnly = useAppStore((s) => s.setReadOnly)

  // Collaboration gate (place another artist's model → request their consent).
  const setCurrentUser = useAppStore((s) => s.setCurrentUser)
  const setRequestedCollaborators = useAppStore((s) => s.setRequestedCollaborators)
  const resolveCollab = useAppStore((s) => s.resolveCollab)
  const pendingCollab = useAppStore((s) => s.pendingCollab)
  const [collabs, setCollabs] = React.useState<TableCollaboration[]>([])
  // Multi-artist credit shown when browsing a published showcase (read-only).
  const [contributors, setContributors] = React.useState<Array<{ id: string; name: string; profileImageUrl?: string; modelCount: number }>>([])

  React.useEffect(() => {
    if (!readOnly || !tableId) { setContributors([]); return }
    let alive = true
    tablesApi.getContributors(tableId).then((c) => alive && setContributors(c)).catch(() => alive && setContributors([]))
    return () => { alive = false }
  }, [readOnly, tableId])

  // Tell the store who's driving so the placement gate knows which models are
  // "foreign" and whether the user is an artist (only artists are gated).
  React.useEffect(() => {
    setCurrentUser(user?.id ?? null, user?.role === 'artist')
  }, [user?.id, user?.role, setCurrentUser])

  // Load (or clear) the collaboration status for the table I own. Seeds the gate's
  // "already requested" set so accepted/pending owners aren't re-prompted.
  const refreshCollabs = React.useCallback(async (id: string | null, owned: boolean) => {
    if (!id || !owned || user?.role !== 'artist') {
      setCollabs([])
      setRequestedCollaborators([])
      return
    }
    try {
      const rows = await collaborationsApi.getForTable(id)
      setCollabs(rows)
      setRequestedCollaborators(rows.map((r) => r.collaboratorId))
    } catch {
      setCollabs([])
    }
  }, [user?.role, setRequestedCollaborators])

  // Push the view-only flag into the store so the scene's input handlers gate
  // editing (placement/selection/keys). Clear it on unmount so a later /planner
  // visit is editable again.
  React.useEffect(() => {
    setReadOnly(readOnly)
    // Drop any pending placement tool so the green "place here" square from a prior
    // edit session never lingers over a table you're only viewing.
    if (readOnly) setSelectedAsset(null)
    return () => setReadOnly(false)
  }, [readOnly, setReadOnly, setSelectedAsset])

  // Terrain sculpting
  const terrainTool = useAppStore((s) => s.terrainTool)
  const brushRadius = useAppStore((s) => s.brushRadius)
  const brushStrength = useAppStore((s) => s.brushStrength)
  const setTerrainTool = useAppStore((s) => s.setTerrainTool)
  const setBrush = useAppStore((s) => s.setBrush)
  const resetTerrain = useAppStore((s) => s.actions.resetTerrain)
  const paintMaterial = useAppStore((s) => s.paintMaterial)
  const setPaintMaterial = useAppStore((s) => s.setPaintMaterial)
  const resetPaint = useAppStore((s) => s.actions.resetPaint)
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
  const [showFilters, setShowFilters] = React.useState(false)
  const [expandedBundles, setExpandedBundles] = React.useState<Set<string>>(new Set())
  const [uiHidden, setUiHidden] = React.useState(false)
  const [showHelp, setShowHelp] = React.useState(false)
  const [showPreviewQuality, setShowPreviewQuality] = React.useState(false)
  // Tablet support. `coarse` adds on-screen buttons for the keyboard-only actions;
  // `compact` turns the two fixed side panels into drawers. Both are false on a
  // desktop, where every existing control keeps working exactly as before.
  const coarse = useCoarsePointer()
  const compact = useCompactLayout()
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [bomOpen, setBomOpen] = React.useState(false)
  // Only one drawer at a time on a narrow screen — together they'd cover the table.
  const openPalette = (open: boolean) => { setPaletteOpen(open); if (open) setBomOpen(false) }
  const openBom = (open: boolean) => { setBomOpen(open); if (open) setPaletteOpen(false) }
  const [toast, setToast] = React.useState<{ count: number } | null>(null)
  const startedRef = React.useRef(false)
  const onboardRef = React.useRef(false)
  const startTour = useOnboardingStore((s) => s.startTour)
  const tourActive = useOnboardingStore((s) => s.tourActive)

  // ---- Palette catalogue filters (model class + facet terms) ----
  const appliesToBySlug = React.useMemo(() => {
    const m = new Map<string, string[] | null>()
    for (const f of catalogueFacets) m.set(f.slug, f.appliesTo)
    return m
  }, [catalogueFacets])
  // Facets to show in the palette rail: drop the model-class facet (it's the chip
  // row), keep only those applicable to the chosen class and that have any terms.
  const filterRailFacets = React.useMemo(
    () =>
      catalogueFacets.filter(
        (f) => f.slug !== MODEL_CLASS_SLUG && f.terms.length > 0 && facetAppliesTo(f, catalogueClass),
      ),
    [catalogueFacets, catalogueClass],
  )
  const selectedFilterTokens = React.useMemo(() => new Set(catalogueTerms), [catalogueTerms])
  const onSetCatalogueClass = (slug: string | null) => {
    // Drop selected terms for class-specific facets that no longer apply.
    const nextTerms = catalogueTerms.filter((tok) => {
      const appliesTo = appliesToBySlug.get(tok.slice(0, tok.indexOf(':')))
      const scoped = appliesTo && appliesTo.length > 0
      return !scoped ? true : slug ? appliesTo!.includes(slug) : false
    })
    setCatalogueFilter({ modelClass: slug, terms: nextTerms })
  }
  const onToggleFilterTerm = (token: string) => {
    const next = catalogueTerms.includes(token)
      ? catalogueTerms.filter((t) => t !== token)
      : [...catalogueTerms, token]
    setCatalogueFilter({ terms: next })
  }

  // First-visit onboarding lives in a single effect further down (once the scene
  // is ready so the palette/toolbar targets are painted): artists building a
  // showcase get the guided walkthrough; everyone else gets the Controls guide.

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

  // First-visit onboarding. Runs once the scene is ready (so palette/toolbar
  // targets are painted) and skipped in read-only preview mode. Artists who
  // haven't seen it get the guided *showcase* walkthrough; everyone else gets
  // the one-time Controls guide. We suppress the generic aids for artists so the
  // two don't stack on the same first load.
  React.useEffect(() => {
    if (readOnly || onboardRef.current || !sceneReady) return
    // A signed-in user whose profile hasn't loaded yet — wait so we know the role.
    if (isAuthenticated && !user) return
    try {
      const isArtist = user?.role === 'artist'
      const plannerTourKey = `aa_planner_showcase_tour_v1:${user?.id ?? 'anon'}`
      if (isArtist && !localStorage.getItem(plannerTourKey)) {
        onboardRef.current = true
        localStorage.setItem(plannerTourKey, '1')
        localStorage.setItem('tb_help_seen_v1', '1')
        localStorage.setItem('tb_coach_v1', '1')
        window.setTimeout(() => startTour(), 400)
        return
      }
      // Buyers (and guests) get their own first-visit walkthrough: browse → place
      // → basket. Same overlay, buyer-tailored steps chosen at the render below.
      const buyerTourKey = `aa_planner_buyer_tour_v1:${user?.id ?? 'anon'}`
      if (!isArtist && !localStorage.getItem(buyerTourKey)) {
        onboardRef.current = true
        localStorage.setItem(buyerTourKey, '1')
        localStorage.setItem('tb_help_seen_v1', '1')
        localStorage.setItem('tb_coach_v1', '1')
        window.setTimeout(() => startTour(), 400)
        return
      }
      if (!localStorage.getItem('tb_help_seen_v1')) {
        onboardRef.current = true
        setShowHelp(true)
        localStorage.setItem('tb_help_seen_v1', '1')
        localStorage.setItem('tb_coach_v1', '1')
      }
    } catch { /* localStorage unavailable (private mode) — just skip */ }
  }, [readOnly, sceneReady, isAuthenticated, user, startTour])

  // First visit: explain that the table shows decimated + watermarked previews,
  // not the STL they'd print. Deliberately waits until the walkthrough and the
  // controls overlay are done — three modals stacked on load is worse than the
  // confusion this is meant to prevent — so it lands on a table they can see.
  React.useEffect(() => {
    if (readOnly || !sceneReady || tourActive || showHelp) return
    if (hasAcknowledgedPreviewQuality()) return
    const t = window.setTimeout(() => setShowPreviewQuality(true), 600)
    return () => window.clearTimeout(t)
  }, [readOnly, sceneReady, tourActive, showHelp])

  // Clear any tour left active elsewhere (e.g. the dashboard walkthrough) so it
  // can't bleed into the planner; our own effect above starts it when relevant.
  React.useEffect(() => {
    useOnboardingStore.getState().stopTour()
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
      refreshCollabs(null, false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const t = shareToken
          ? await tablesApi.getSharedTable(shareToken)
          : await tablesApi.getById(tableId!, { userEmail: user?.email })
        if (cancelled) return
        const { table, tableMaterial, instances, heightmap, paint } = deserializeLayout(t.tableConfig, t.layoutData)
        // Resolve any referenced models that aren't in the loaded catalogue (e.g. an
        // artist's unpublished piece) so every placed model renders, not a grey box.
        await resolveAssetsByIds(instances.map((i) => i.assetId))
        if (cancelled) return
        applyLayout({ table, tableMaterial, instances, heightmap, paint })
        setSavedTableName(shareToken ? `${t.name} (Copy)` : t.name)
        if (!shareToken) {
          setSavedTableId(t.id)
          // Own it only if it's yours; otherwise Save makes a copy under your account.
          const owned = !!user?.email && t.userEmail === user.email
          setIsOwner(owned)
          refreshCollabs(t.id, owned)
        } else {
          // A shared copy starts with no collaborations of its own; foreign models
          // already in it get requests raised when the copier first saves.
          refreshCollabs(null, false)
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
    // The artist's own models (incl. unpublished drafts). Shown even without a
    // purchase so a creator can lay out their pieces before release.
    const ownModels = myModels.filter(
      (m) => !memberIds.has(m.id) && !setModelIds.has(m.id) && !modelIds.has(m.id),
    )
    const count = groups.length + displayModels.length + ownModels.length
    return { groups, displayModels, ownModels, count }
  }, [cartItems, ownedModelIds, ownedBundleIds, bundles, sets, myModels, assetsById, user?.id])

  const toggleBundleExpanded = (id: string) =>
    setExpandedBundles((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // A single placeable model tile (shared by the catalogue + "My items" tabs).
  // Falls back to the global registry for models that aren't on the flat catalogue
  // (the artist's own drafts, or pieces resolved by id when loading a table).
  const renderModelTile = (id: string, ownedHint?: boolean) => {
    const a = assetsById.get(id) ?? getAssetById(id)
    if (!a) return null
    const owned = ownedHint ?? ownedModelIds.has(id)
    return (
      <button
        key={id}
        className={`tb-tile ${selectedAssetId === a.id ? 'is-active' : ''}`}
        onClick={() => { pickAsset(a.id); }}
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

  // Choosing a model to place. On a narrow screen the palette is a drawer covering
  // the table, so close it — otherwise you'd tap a tile and have nowhere to place it.
  const pickAsset = (id: string) => {
    setSelectedAsset(selectedAssetId === id ? null : id)
    if (compact) setPaletteOpen(false)
  }

  // A tile for one of the artist's OWN models (incl. unpublished drafts), with a
  // status pill instead of owned/basket. Registered assets resolve via getAssetById.
  const renderOwnModelTile = (m: { id: string; name: string; thumbnail?: string; status: string }) => {
    if (!getAssetById(m.id)) return null
    return (
      <button
        key={m.id}
        className={`tb-tile ${selectedAssetId === m.id ? 'is-active' : ''}`}
        onClick={() => pickAsset(m.id)}
        title={`Place ${m.name}`}
      >
        <div className="tb-thumb">{m.thumbnail ? <img src={m.thumbnail} alt="" /> : <Box size={22} />}</div>
        <div className="tb-tile-name">{m.name}</div>
        <div className="tb-tile-meta">
          <span className={`tb-pill ${m.status === 'published' ? 'stl' : 'print'}`}>
            {m.status === 'published' ? 'Published' : 'Draft'}
          </span>
          <span>Yours</span>
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

  // Model prices are stored net; the planner shows the same tax-inclusive figures as
  // the shop so a build's total matches what checkout will charge.
  const vatRate = useTaxStore((s) => s.rate())
  const grossPrice = React.useCallback((net: number) => grossFromNet(net, vatRate), [vatRate])

  // The marketplace basket subtotal (the same cartStore the shop uses).
  const cartSubtotal = React.useMemo(
    () => cartItems.reduce((sum, i) => sum + i.price, 0),
    [cartItems],
  )

  // View-only: the placed model the shopper has tapped, resolved to its
  // purchasable unit (a set part is bought as its parent model) with buy state.
  const selectedModel = React.useMemo(() => {
    if (!readOnly) return null
    const instId = selectedInstanceIds[selectedInstanceIds.length - 1]
    if (!instId) return null
    const inst = instances.find((i) => i.id === instId)
    if (!inst) return null
    const asset = assetsById.get(inst.assetId) ?? getAssetById(inst.assetId)
    // Placing a part of a "set" buys the parent model (one purchase = all parts).
    const parentSet = sets.find((s) => s.partAssetIds.includes(inst.assetId))
    const id = parentSet ? parentSet.id : inst.assetId
    const name = parentSet ? parentSet.name : asset?.name
    if (!name) return null
    return {
      id,
      name,
      price: parentSet ? parentSet.price : asset?.price ?? 0,
      thumbnail: parentSet ? parentSet.thumbnail : asset?.thumbnail,
      artistName: asset?.artistName ?? 'Artifact Armoury',
      owned: ownedModelIds.has(id),
      inCart: cartItems.some((it) => it.kind === 'model' && it.id === id),
    }
  }, [readOnly, selectedInstanceIds, instances, assetsById, sets, ownedModelIds, cartItems])

  function handleAddSelected() {
    if (!selectedModel || selectedModel.owned || selectedModel.inCart) return
    addCartItem(
      {
        kind: 'model',
        id: selectedModel.id,
        name: selectedModel.name,
        artistName: selectedModel.artistName,
        price: selectedModel.price,
        imageUrl: selectedModel.thumbnail,
      },
      false, // keep the planner in view — the docked basket updates live
    )
    hotToast.success(`${selectedModel.name} added to basket`)
  }

  const clearSelectedInstance = () => useAppStore.getState().setSelectedInstances([])

  // Open the full marketplace page for the selected model (title, description,
  // rating, reviews, gallery) in a new tab so the planner view is preserved.
  function openModelDetails() {
    if (!selectedModel) return
    window.open(`/models/${selectedModel.id}`, '_blank', 'noopener,noreferrer')
  }

  async function handleSave() {
    if (readOnly) return // view-only: nothing to save (only the owner edits, via their dashboard)
    if (!isAuthenticated || !user?.email) {
      hotToast.error('Log in to save this table to your account')
      navigate('/login')
      return
    }
    if (saving) return

    const s = useAppStore.getState()
    const { tableConfig, layoutData } = serializeLayout(s.table, s.tableMaterial, s.instances, s.heightmap, s.paint)
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
        // Saving raises/refreshes collaboration requests for any foreign models.
        await refreshCollabs(savedTableId, true)
      } else {
        // New table, or a copy of a shared one → create under your account.
        const name = window.prompt('Name this table:', savedTableName ?? `Table ${new Date().toLocaleDateString()}`)
        if (!name) { setSaving(false); return }
        const created = await tablesApi.createTable({ name, tableConfig: tableConfig as any, layoutData: layoutData as any, userEmail: email })
        setSavedTableId(created.id)
        setSavedTableName(created.name)
        setIsOwner(true)
        hotToast.success('Saved to your tables')
        await refreshCollabs(created.id, true)
        navigate(`/planner/t/${created.id}`)
      }
    } catch {
      hotToast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Confirming the collaboration prompt places the piece and immediately saves, so
  // the request goes out to the owner (requests are raised at save time). A scratch
  // table is created as a draft here (name prompt), matching the "save then send" flow.
  async function handleCollabConfirm() {
    resolveCollab(true)
    await handleSave()
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
    <div className={`tb-fs${compact ? ' is-compact' : ''}${coarse ? ' is-touch' : ''}`}>
      <ThreeStage />

      {/* Loading gate — blocks interaction until the table + its textures are ready */}
      {!sceneReady && (
        <div className="tb-loading" role="status" aria-live="polite">
          <div className="tb-loading-card">
            <Logo variant="lockup" title="Artifact Armoury" className="tb-loading-logo" />
            <div className="tb-loading-title">Preparing your table…</div>
            <div className="tb-loading-track">
              <div className="tb-loading-bar" style={{ width: `${Math.max(6, loadPct)}%` }} />
            </div>
            <div className="tb-loading-pct">{loadPct}%</div>
          </div>
        </div>
      )}

      {/* Mode badge (always reflects current placement mode) */}
      {!uiHidden && !readOnly && (
        <div className="tb-badge" data-free={!effSnap}>
          {effSnap ? (
            <><Grid3x3 size={14} /> Snapping to grid</>
          ) : (
            <><Box size={14} /> FREE placement <span className="tb-small">· hold Alt for grid</span></>
          )}
          {selectedAssetId && (
            <span className="tb-level" data-manual={placementManual}>
              Level {Math.round(placementLevel)}
              <span className="tb-small">
                · {placementManual ? (coarse ? 'manual' : 'manual (PgUp/PgDn)') : 'on surface'}
              </span>
            </span>
          )}
        </div>
      )}

      {!uiHidden && !readOnly && (
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
              title={FEATURES.terrainSculpt
                ? 'Sculpt the terrain (hills, cliffs, rivers, trenches)'
                : 'Paint the ground texture (grass, sand, snow…)'}
              onClick={() => {
                const open = !terrainPanelOpen
                setTerrainPanelOpen(open)
                if (open) setSelectedAsset(null)
                else setTerrainTool('none')
              }}
            >
              {FEATURES.terrainSculpt ? <Mountain size={18} /> : <Paintbrush size={18} />}
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
            <button className="tb-icon" data-tour="planner-save" title="Save map (Ctrl+S)" onClick={handleSave}>
              <Save size={18} />
            </button>
            <button
              className="tb-icon"
              title="Reset view (Home)"
              onClick={() => useAppStore.getState().cameraApi?.home()}
            >
              <Home size={18} />
            </button>
            <button className="tb-icon tb-help-btn" title="Controls & keyboard help (?)" onClick={() => setShowHelp(true)}>
              <HelpCircle size={18} /><span>Help</span>
            </button>
            {collabs.some((c) => c.status !== 'accepted') && (
              <span
                className="ml-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800"
                title={`Waiting on ${collabs.filter((c) => c.status !== 'accepted').map((c) => c.name).join(', ')} to accept — you can't publish this showcase yet`}
              >
                ⏳ Pending collaboration
              </span>
            )}
          </div>

          {/* On-screen equivalents of the keyboard-only actions, for tablets. R,
              PageUp/PageDown and Delete have no finger equivalent; everything else
              (undo, snap, fit, tilt) already has a toolbar button. Rendered only on
              touch-primary devices, so the desktop toolbar is unchanged. */}
          {coarse && (
            <div className="tb-touchbar">
              <button
                className="tb-icon"
                title="Rotate anticlockwise"
                onClick={() => useAppStore.getState().stageApi?.rotate(-1)}
              >
                <RotateLeftIcon size={18} />
              </button>
              <button
                className="tb-icon"
                title="Rotate clockwise"
                onClick={() => useAppStore.getState().stageApi?.rotate(1)}
              >
                <RotateCw size={18} />
              </button>
              {selectedAssetId && (
                <>
                  <div className="tb-sep" />
                  <span className="tb-touch-label"><Layers size={14} /> Level</span>
                  <button
                    className="tb-icon"
                    title="Place a level higher"
                    onClick={() => useAppStore.getState().stageApi?.nudgeLevel(1)}
                  >
                    <ArrowUp size={18} />
                  </button>
                  <button
                    className="tb-icon"
                    title="Place a level lower"
                    onClick={() => useAppStore.getState().stageApi?.nudgeLevel(-1)}
                  >
                    <ArrowDown size={18} />
                  </button>
                </>
              )}
              {selectedInstanceIds.length > 0 && (
                <>
                  <div className="tb-sep" />
                  <button
                    className="tb-icon"
                    title="Delete selection"
                    onClick={() => removeInstances(selectedInstanceIds)}
                  >
                    <Trash2 size={18} />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Drawer handles — only when the viewport is too narrow to pin both
              panels open (tablet). On desktop the panels are always visible. */}
          {compact && (
            <>
              <button
                className={`tb-drawer-tab is-left ${paletteOpen ? 'is-open' : ''}`}
                title="Models"
                onClick={() => openPalette(!paletteOpen)}
              >
                <PanelLeft size={18} />
              </button>
              <button
                className={`tb-drawer-tab is-right ${bomOpen ? 'is-open' : ''}`}
                title="Your build"
                onClick={() => openBom(!bomOpen)}
              >
                <PanelRight size={18} />
              </button>
            </>
          )}

          {/* Terrain panel. The sculpt brushes and printable-tile export are gated
              behind FEATURES.terrainSculpt (parked — clunky, to be rebuilt); the
              ground-texture painter below is a separate working feature and stays. */}
          {terrainPanelOpen && (
            <div className="tb-terrain">
              <div className="tb-terrain-head">
                {FEATURES.terrainSculpt
                  ? <span><Mountain size={14} /> Terrain sculpt</span>
                  : <span><Paintbrush size={14} /> Ground texture</span>}
                <button
                  className="tb-icon"
                  title={FEATURES.terrainSculpt ? 'Close terrain tools' : 'Close texture tools'}
                  onClick={() => { setTerrainPanelOpen(false); setTerrainTool('none') }}
                >
                  <X size={14} />
                </button>
              </div>
              {FEATURES.terrainSculpt && (
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
              )}
              {/* Brush size drives the paint brush too, so it stays; strength is
                  sculpt-only (applyPaintBrush takes no strength). */}
              <label className="tb-terrain-row">
                <span>Brush size</span>
                <input type="range" min={0.03} max={0.4} step={0.01} value={brushRadius}
                  onChange={(e) => setBrush({ radius: parseFloat(e.target.value) })} />
              </label>
              {FEATURES.terrainSculpt && (
                <>
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
                </>
              )}

              {/* Ground texture brush: paint different table materials onto the surface. */}
              <div className="tb-terrain-paint">
                <div className="tb-terrain-export-head">Ground texture</div>
                <div className="tb-paint-swatches">
                  {TABLE_MATERIALS.filter((m) => m.id !== 'plain').map((m) => {
                    const active = terrainTool === 'paint' && paintMaterial === m.id
                    return (
                      <button
                        key={m.id}
                        className={`tb-swatch ${active ? 'is-active' : ''}`}
                        title={`Paint ${m.label}`}
                        onClick={() => { setPaintMaterial(m.id); setTerrainTool('paint') }}
                      >
                        <span
                          className="tb-swatch-chip"
                          style={{ background: `#${m.color.toString(16).padStart(6, '0')}` }}
                        />
                        <span>{m.label}</span>
                      </button>
                    )
                  })}
                  <button
                    className={`tb-swatch ${terrainTool === 'erase' ? 'is-active' : ''}`}
                    title="Erase painted texture"
                    onClick={() => setTerrainTool(terrainTool === 'erase' ? 'none' : 'erase')}
                  >
                    <span className="tb-swatch-chip tb-swatch-erase" />
                    <span>Erase</span>
                  </button>
                </div>
                <p className="tb-small tb-terrain-sub">Drag on the table to paint. Brush size applies here too.</p>
                <button
                  className="tb-terrain-reset"
                  onClick={() => { if (window.confirm('Clear all painted ground texture on this table?')) resetPaint() }}
                >
                  <Trash2 size={14} /> Clear texture
                </button>
              </div>

              {FEATURES.terrainSculpt && (
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
              )}

              {FEATURES.terrainSculpt && (
                <p className="tb-small tb-terrain-hint">
                  Drag on the table to sculpt. Cliffs are steep slopes. Tiles are watertight shells —
                  print with normal infill.
                </p>
              )}
            </div>
          )}

          {/* Catalogue / palette */}
          <aside
            className={`tb-palette${compact && !paletteOpen ? ' is-stowed' : ''}`}
            data-tour="planner-palette"
          >
            <div className="tb-palette-tabs" data-tour="planner-tabs">
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
                    placeholder="Search models…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>

                {/* Model class — the primary axis. Switching re-queries the palette. */}
                <div className="tb-class-row">
                  {[{ slug: null as string | null, label: 'All' }, ...MODEL_CLASSES].map((c) => {
                    const active = catalogueClass === c.slug || (c.slug === null && !catalogueClass)
                    return (
                      <button
                        key={c.slug ?? 'all'}
                        className={`tb-class ${active ? 'is-active' : ''}`}
                        onClick={() => onSetCatalogueClass(c.slug)}
                        disabled={catalogueLoading}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>

                {filterRailFacets.length > 0 && (
                  <div className="tb-filter">
                    <button className="tb-filter-toggle" onClick={() => setShowFilters((v) => !v)}>
                      <SlidersHorizontal size={13} />
                      Filters
                      {catalogueTerms.length > 0 && <span className="tb-filter-count">{catalogueTerms.length}</span>}
                      <ChevronDown size={13} className={`tb-chev ${showFilters ? 'is-open' : ''}`} />
                    </button>
                    {catalogueTerms.length > 0 && (
                      <button className="tb-filter-clear" onClick={() => setCatalogueFilter({ terms: [] })}>
                        Clear
                      </button>
                    )}
                  </div>
                )}

                {showFilters && filterRailFacets.length > 0 && (
                  <div className="tb-filter-rail">
                    <FacetRail
                      facets={filterRailFacets}
                      selected={selectedFilterTokens}
                      onToggle={onToggleFilterTerm}
                      loading={catalogueLoading}
                    />
                  </div>
                )}

                <div className="tb-palette-scroll">
                  {paletteGroups.map(([cat, items]) => (
                    <div key={cat} className="tb-palette-section">
                      <div className="tb-palette-cat">
                        {cat === 'Elevation' ? 'Elevation / Hills' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </div>
                      <div className="tb-palette-grid">
                        {items.map((a) => (
                          <button
                            key={a.id}
                            className={`tb-tile ${selectedAssetId === a.id ? 'is-active' : ''}`}
                            onClick={() => pickAsset(a.id)}
                            title={`Place ${a.name}`}
                          >
                            <div className="tb-thumb">
                              {a.thumbnail ? <img src={a.thumbnail} alt="" /> : <Box size={22} />}
                            </div>
                            <div className="tb-tile-name">{a.name}</div>
                            <div className="tb-tile-meta">
                              <span className={`tb-pill ${a.fulfillment}`}>{a.fulfillment === 'stl' ? 'STL' : 'Print'}</span>
                              {a.price != null && <span>£{grossPrice(a.price).toFixed(2)}</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {filtered.length === 0 && (
                    <div className="tb-small" style={{ padding: 8 }}>
                      {catalogueLoading ? 'Loading…' : 'No models match your filters.'}
                    </div>
                  )}
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
                            <span>{g.owned ? 'Owned' : `£${grossPrice(g.price).toFixed(2)}`}</span>
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

                {myItems.ownModels.length > 0 && (
                  <div className="tb-palette-section">
                    <div className="tb-palette-cat">Your models (incl. drafts)</div>
                    <div className="tb-palette-grid">
                      {myItems.ownModels.map((m) => renderOwnModelTile(m))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>

          {/* Bill of materials / cart */}
          <aside
            className={`tb-bom${compact && !bomOpen ? ' is-stowed' : ''}`}
            data-tour="planner-bom"
          >
            <div className="tb-bom-head">
              <strong>Models on this table</strong>
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
                  <div className="tb-bom-price">£{grossPrice(r.asset!.price ?? 0).toFixed(2)}</div>
                </div>
              ))}
            </div>
            <div className="tb-bom-total">
              <span>Total cost of Table</span>
              <strong>£{grossFromLines(bom.rows.map((r) => r.asset!.price ?? 0), vatRate).toFixed(2)}</strong>
            </div>
            {vatRate > 0 && (
              <div className="tb-small" style={{ textAlign: 'right', opacity: 0.7 }}>
                incl. {vatRate}% VAT
              </div>
            )}
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

      {/* View-only chrome — shopper opened a published table. No editing tools;
          just camera controls + "add the whole look to the basket". */}
      {readOnly && !uiHidden && (
        <>
          <div className="tb-viewbar">
            <button className="tb-view-back" onClick={() => navigate('/tables')} title="Back to tables">
              <ArrowLeft size={16} /> Tables
            </button>
            <div className="tb-view-title">
              <span className="tb-view-name">{savedTableName ?? 'Table'}</span>
              <span className="tb-view-flag"><Eye size={12} /> View only</span>
            </div>
            <div className="tb-view-actions">
              <button className="tb-icon" title="Fit view (F)" onClick={() => fitView()}>
                <Maximize2 size={18} />
              </button>
              <button
                className="tb-icon"
                title="Reset view (Home)"
                onClick={() => useAppStore.getState().cameraApi?.home()}
              >
                <Home size={18} />
              </button>
              <button className="tb-icon tb-help-btn" title="Controls & keyboard help (?)" onClick={() => setShowHelp(true)}>
                <HelpCircle size={18} /><span>Help</span>
              </button>
            </div>
          </div>

          {/* Multi-artist credit — the artists whose models feature in this table. */}
          {contributors.length > 0 && (
            <div className="pointer-events-auto fixed bottom-4 left-4 z-30 flex max-w-[70vw] flex-wrap items-center gap-1.5 rounded-full border border-gray-200 bg-white/95 px-3 py-1.5 shadow-sm">
              <span className="text-xs font-medium text-gray-500">Featured artists:</span>
              {contributors.map((c) => {
                const avatar = assetUrl(c.profileImageUrl)
                return (
                  <button
                    key={c.id}
                    onClick={() => navigate(`/artists/${c.id}`)}
                    className="flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 hover:bg-gray-100"
                    title={`${c.modelCount} model${c.modelCount === 1 ? '' : 's'} by ${c.name}`}
                  >
                    <span className="flex h-6 w-6 flex-none items-center justify-center overflow-hidden rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-600">
                      {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : c.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-xs font-medium text-gray-800">{c.name}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Docked marketplace basket — the SAME cartStore as the shop, so it
              stays consistent everywhere. Add individual models by tapping them,
              or drop the whole build in at once. */}
          <aside className={`tb-bom tb-view-basket${compact && !bomOpen ? ' is-stowed' : ''}`}>
            <div className="tb-bom-head">
              <strong>Your basket</strong>
              <span className="tb-small">{cartItems.length} item{cartItems.length === 1 ? '' : 's'}</span>
            </div>
            <div className="tb-bom-list">
              {cartItems.length === 0 && (
                <div className="tb-small" style={{ padding: 8 }}>
                  Tap a model on the table to see its details and add it to your basket.
                </div>
              )}
              {cartItems.map((item) => (
                <div className="tb-bom-row" key={cartKey(item.kind, item.id)}>
                  <div className="tb-thumb sm">
                    {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <Box size={16} />}
                  </div>
                  <div className="tb-bom-name">
                    {item.name}
                    {item.kind === 'bundle' && <span className="tb-pill bundle" style={{ marginLeft: 6 }}>BUNDLE</span>}
                  </div>
                  <div className="tb-bom-price">£{item.price.toFixed(2)}</div>
                  <button
                    className="tb-bom-x"
                    title="Remove from basket"
                    onClick={() => removeCartItem(cartKey(item.kind, item.id))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="tb-bom-total">
              <span>Subtotal</span>
              <strong>£{grossPrice(cartSubtotal).toFixed(2)}</strong>
            </div>
            <button className="tb-cta" disabled={cartItems.length === 0} onClick={() => navigate('/checkout')}>
              <ShoppingCart size={16} /> Checkout
            </button>
            <div className="tb-bom-foot">
              <button
                className="tb-btn"
                style={{ flex: 1 }}
                disabled={bom.rows.length === 0}
                title="Add every model on this table to your basket"
                onClick={handleAddAll}
              >
                Add whole table ({bom.rows.length})
              </button>
            </div>
          </aside>

          {/* Selected-model info tile — appears when the shopper taps a piece.
              Its main area opens the full model page (details, rating, reviews). */}
          {selectedModel && (
            <div className="tb-view-selected">
              <button className="tb-view-selected-main" onClick={openModelDetails} title="Open the full model page">
                <div className="tb-thumb sm">
                  {selectedModel.thumbnail ? <img src={selectedModel.thumbnail} alt="" /> : <Box size={18} />}
                </div>
                <div className="tb-view-selected-info">
                  <strong>{selectedModel.name}</strong>
                  <span className="tb-small">{selectedModel.artistName} · £{selectedModel.price.toFixed(2)}</span>
                  <span className="tb-view-selected-link">
                    <ExternalLink size={12} /> View full details, description &amp; reviews
                  </span>
                </div>
              </button>
              <div className="tb-view-selected-actions">
                {selectedModel.owned ? (
                  <span className="tb-view-selected-state"><Check size={14} /> Owned</span>
                ) : selectedModel.inCart ? (
                  <span className="tb-view-selected-state"><Check size={14} /> In basket</span>
                ) : (
                  <button className="tb-cta sm" onClick={handleAddSelected}>
                    <ShoppingCart size={16} /> Add to basket
                  </button>
                )}
                <button className="tb-view-selected-x" onClick={clearSelectedInstance} aria-label="Deselect">
                  <X size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {uiHidden && (
        <button className="tb-show-ui" onClick={() => setUiHidden(false)} title="Show UI (H)">
          Show UI
        </button>
      )}

      {!readOnly && <CoachMarks />}
      {showHelp && (
        <HelpOverlay touch={coarse}
          onClose={() => setShowHelp(false)}
          onReplayTour={() => { setShowHelp(false); startTour() }}
          onShowPreviewQuality={() => setShowPreviewQuality(true)}
        />
      )}
      {showPreviewQuality && (
        <PreviewQualityNotice
          onClose={() => setShowPreviewQuality(false)}
          onAcknowledge={() => setShowPreviewQuality(false)}
        />
      )}
      {!readOnly && (
        <OnboardingTour steps={user?.role === 'artist' ? plannerShowcaseSteps : plannerBuyerSteps} />
      )}

      {/* Collaboration request prompt — placing another artist's model on a showcase */}
      {pendingCollab && (
        <CollabRequestModal
          artistName={pendingCollab.artistName}
          onConfirm={handleCollabConfirm}
          onCancel={() => resolveCollab(false)}
        />
      )}

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
