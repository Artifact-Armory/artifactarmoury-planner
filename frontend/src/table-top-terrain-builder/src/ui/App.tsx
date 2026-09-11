// src/ui/App.tsx — full-screen game-like planner shell.
import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MousePointer2, Undo2, Redo2, Grid3x3, Maximize2, Save, ShoppingCart,
  HelpCircle, Trash2, X, Search, Box, Home, RotateCw, RotateCcw, ChevronDown,
  Mountain, ArrowUp, ArrowDown, Waves, Square, Download, ArrowLeft, Eye, Check, ExternalLink,
  Paintbrush, RotateCcw as RotateLeftIcon, Layers, PanelLeft, PanelRight, Combine, Ungroup,
  Pencil, Loader2, AlertTriangle,
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
import { ensureTemplate, subscribeGlbBytes, glbUnitsSince, glbBytesFor } from '@scene/loaders'
import { CoachMarks } from './CoachMarks'
import { useCoarsePointer, useCompactLayout } from './useDeviceLayout'
import { HelpOverlay } from './HelpOverlay'
import { PreviewQualityNotice, hasAcknowledgedPreviewQuality } from './PreviewQualityNotice'
import OnboardingTour from '@/components/help/OnboardingTour'
import { plannerShowcaseSteps, plannerBuyerSteps } from '@/components/help/tourSteps'
import { useOnboardingStore } from '@/store/onboardingStore'
import { useTaxStore, grossFromNet, grossFromLines } from '@/store/taxStore'
import { useUnitsStore, unitLabel, metresToDisplay, displayToMetres, formatPieceDims } from '@/store/unitsStore'
import Logo from '@/components/common/Logo'
import FacetRail from '@/components/taxonomy/FacetRail'
import { facetAppliesTo, MODEL_CLASSES, MODEL_CLASS_SLUG } from '@/api/endpoints/taxonomy'
import { SlidersHorizontal } from 'lucide-react'
import './styles.css'

// Longest we'll hold the loading gate waiting for a loaded table's models. Past
// this something is wrong with the connection, and a visible half-built table
// beats an overlay that never lifts.
const TABLE_PIECE_LOAD_TIMEOUT_MS = 45000

// What counts as a "heavy" table, i.e. one worth warning about before the
// framerate does it for us.
//
// Download weight is measured in BYTES, not model count. A count was only ever a
// stand-in for weight, and the planner LOD (migration 064) broke the conversion:
// a re-baked model costs roughly a third of what it did, so 15 models is 45 MB of
// old proxies but well under 20 MB of LODs. Worse, the two coexist for as long as
// the catalogue backfill takes, so no single count is right for both. Bytes stay
// right throughout, and 45 MB is deliberately where the old 15-model rule landed
// at the ~3 MB/model it was tuned against — the same bar, expressed in the thing
// it was always trying to measure.
//
// Pieces stay a count: copies share geometry and cost no download at all, so what
// they drive is per-frame work, which a count does describe.
const HEAVY_TABLE_BYTES = 45 * 1024 * 1024
const HEAVY_TABLE_PIECES = 45
// Fallback for when sizes aren't known — the local dev manifest, or a response
// with no Content-Length. Deliberately well above the old 15: reaching it means
// we are guessing, and a wrong warning on a table the viewer can see is running
// fine is worse than a missing one.
const HEAVY_TABLE_MODELS_UNMEASURED = 30
// Separate, and deliberately still a count: the note under the loading bar is
// shown WHILE the models download, when the only figure available is how many
// there are — the sizes are exactly what is still being fetched. It also says
// something different from the warning above ("this will take a moment", not
// "this will run slowly"). Raised from the 15 it shared with the old heavy-table
// rule because an LOD'd table of that size now loads quickly enough not to need
// reassuring about.
const LARGE_TABLE_LOAD_MODELS = 20

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
  // Artists mostly use the planner to build a showcase of their own work, not
  // to shop — the right-hand panel below swaps the Table/Basket split for a
  // single "what's on this table" view with a net value, not a buy CTA.
  const isArtist = user?.role === 'artist'

  // Server-table binding: which saved table (if any) this planner is editing.
  const [savedTableId, setSavedTableId] = React.useState<string | null>(tableId ?? null)
  const [savedTableName, setSavedTableName] = React.useState<string | null>(null)
  // Loading a shared link gives you an editable copy — you don't own the original
  // until you save it as your own (which flips this true).
  const [isOwner, setIsOwner] = React.useState<boolean>(!shareToken)
  /**
   * Does the viewer own the table currently open in READ-ONLY view?
   * Deliberately separate from `isOwner`, which defaults to TRUE (scratch
   * mode saves as yours) — reusing it here showed an owner's "Edit" button
   * to a stranger, and to anyone whose table load hadn't resolved yet.
   * Defaults to false and is only set once the load confirms the emails match.
   */
  const [ownsViewedTable, setOwnsViewedTable] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  /** In-flight guard for "Edit a copy" on a read-only table. */
  const [copying, setCopying] = React.useState(false)

  // Imperial ⇄ metric is purely a display preference (persisted across visits);
  // every real measurement stays in metres underneath — see store/unitsStore.
  const unitSystem = useUnitsStore((s) => s.system)
  const setUnitSystem = useUnitsStore((s) => s.setSystem)
  const uLabel = unitLabel(unitSystem)

  const assets = useAppStore((s) => s.assets)
  const catalogueClass = useAppStore((s) => s.catalogueClass)
  const catalogueTerms = useAppStore((s) => s.catalogueTerms)
  const catalogueFacets = useAppStore((s) => s.catalogueFacets)
  const catalogueSearch = useAppStore((s) => s.catalogueSearch)
  const catalogueSort = useAppStore((s) => s.catalogueSort)
  const catalogueMinPrice = useAppStore((s) => s.catalogueMinPrice)
  const catalogueMaxPrice = useAppStore((s) => s.catalogueMaxPrice)
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
  const fuseSelected = useAppStore((s) => s.actions.fuseSelected)
  const unfuseSelected = useAppStore((s) => s.actions.unfuseSelected)
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

  // Search box + price bounds are debounced into the store, which re-queries the
  // backend browse endpoint — the same one the marketplace uses. That's what keeps
  // the palette in sync with the market: it used to filter only whatever ~200
  // "recent" models had loaded at mount, so a search for anything outside that
  // page (or published afterwards) turned up nothing.
  const [query, setQuery] = React.useState('')
  const [minPriceInput, setMinPriceInput] = React.useState('')
  const [maxPriceInput, setMaxPriceInput] = React.useState('')
  React.useEffect(() => {
    if (query === catalogueSearch) return
    const id = setTimeout(() => setCatalogueFilter({ search: query }), 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])
  React.useEffect(() => {
    const min = minPriceInput.trim() ? Number(minPriceInput) : null
    const max = maxPriceInput.trim() ? Number(maxPriceInput) : null
    if (min === catalogueMinPrice && max === catalogueMaxPrice) return
    const id = setTimeout(() => setCatalogueFilter({ minPrice: min, maxPrice: max }), 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minPriceInput, maxPriceInput])
  const [paletteTab, setPaletteTab] = React.useState<'catalogue' | 'mine'>('catalogue')
  // Right panel while editing: "table" is what's placed (a planning BOM — placing
  // a model does NOT add it to the basket, see store.ts addInstance); "basket" is
  // the real cartStore, so a builder can always see/manage what they're actually
  // buying without leaving the planner (the site header/CartDrawer aren't mounted
  // on this full-screen route).
  const [buildTab, setBuildTab] = React.useState<'table' | 'basket'>('table')
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
  const activeFilterCount =
    catalogueTerms.length + (catalogueMinPrice != null ? 1 : 0) + (catalogueMaxPrice != null ? 1 : 0)
  const clearCatalogueFilters = () => {
    setQuery('')
    setMinPriceInput('')
    setMaxPriceInput('')
    setCatalogueFilter({ terms: [], search: '', minPrice: null, maxPrice: null })
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

  // A saved/shared/published table is a SECOND load that starts after the one
  // above: the layout itself is fetched over REST (invisible to the loading
  // manager), and only then does every placed piece's GLB start downloading. So
  // the settle-based gate above happily drains on the table textures alone and
  // reveals a bare board that fills in piece by piece over the next several
  // seconds — exactly what a tester reported on an artist's showcase. Hold the
  // overlay until every distinct model on the table has its geometry in hand.
  const [heavyWarnDismissed, setHeavyWarnDismissed] = React.useState(false)
  // Latched: a table only ever gets heavier as its models finish downloading, and
  // a warning that appeared and then vanished mid-load would read as a glitch.
  const [heavyByBytes, setHeavyByBytes] = React.useState(false)
  React.useEffect(() => {
    if (heavyByBytes) return
    const check = () => {
      const models: string[] = []
      for (const id of new Set(instances.map((i) => i.assetId))) {
        const m = getAssetById(id)?.model
        if (m) models.push(m)
      }
      if (glbBytesFor(models).bytes >= HEAVY_TABLE_BYTES) setHeavyByBytes(true)
    }
    check()
    // Recheck as bytes land: on a saved table every GLB is requested at once, so
    // the total is only true at the end; on a scratch table it grows per placement.
    return subscribeGlbBytes(check)
  }, [instances, heavyByBytes])

  const isHeavyTable = React.useMemo(() => {
    if (instances.length >= HEAVY_TABLE_PIECES) return true
    if (heavyByBytes) return true
    // Only guess from the model count when the bytes genuinely aren't available.
    const models: string[] = []
    for (const id of new Set(instances.map((i) => i.assetId))) {
      const m = getAssetById(id)?.model
      if (m) models.push(m)
    }
    const { unknown } = glbBytesFor(models)
    return unknown > 0 && models.length >= HEAVY_TABLE_MODELS_UNMEASURED
  }, [instances, heavyByBytes])

  const loadsSavedTable = Boolean(tableId || shareToken)
  const [tableAssetsReady, setTableAssetsReady] = React.useState(!loadsSavedTable)
  // {loaded,total} once we know how many distinct models the table uses.
  const [tablePieceLoad, setTablePieceLoad] = React.useState<{ loaded: number; total: number } | null>(null)
  React.useEffect(() => {
    // Navigating between tables (or to scratch) restarts the gate.
    setTableAssetsReady(!loadsSavedTable)
    setTablePieceLoad(null)
    setHeavyWarnDismissed(false)
    setHeavyByBytes(false)
  }, [tableId, shareToken, loadsSavedTable])

  // The single condition the overlay is keyed off.
  const showTable = sceneReady && tableAssetsReady

  // Progress for the bar. Counting finished models alone leaves it at 0% for the
  // whole wait and then jumps to done — every GLB is requested at once, so they
  // land in a clump at the end, and a frozen bar reads as a hung page. So each
  // in-flight download also contributes its own fraction of a model. A response
  // without a Content-Length can't report one and contributes nothing, which
  // just degrades the bar to the old model-at-a-time behaviour; the striped
  // animation on it is what shows life in that case.
  const [glbUnits, setGlbUnits] = React.useState(0)
  const pieceLoadStartedAt = React.useRef(0)
  React.useEffect(() => {
    if (tableAssetsReady) return
    if (!pieceLoadStartedAt.current) pieceLoadStartedAt.current = Date.now()
    const read = () => setGlbUnits(glbUnitsSince(pieceLoadStartedAt.current))
    read()
    return subscribeGlbBytes(read)
  }, [tableAssetsReady])

  const gatePct = React.useMemo(() => {
    if (!tablePieceLoad || tablePieceLoad.total <= 0) return loadPct
    if (tableAssetsReady) return 100
    // Whichever is further along: models fully in hand, or bytes on the wire.
    // The two overlap (a downloaded model is also a decoded one moments later),
    // so max() rather than a sum — adding them would overshoot.
    const done = Math.max(tablePieceLoad.loaded, glbUnits)
    return Math.min(99, Math.round((done / tablePieceLoad.total) * 100))
  }, [tableAssetsReady, tablePieceLoad, glbUnits, loadPct])

  // First-visit onboarding. Runs once the scene is ready (so palette/toolbar
  // targets are painted) and skipped in read-only preview mode. Artists who
  // haven't seen it get the guided *showcase* walkthrough; everyone else gets
  // the one-time Controls guide. We suppress the generic aids for artists so the
  // two don't stack on the same first load.
  React.useEffect(() => {
    if (readOnly || onboardRef.current || !showTable) return
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
  }, [readOnly, showTable, isAuthenticated, user, startTour])

  // First visit: explain that the table shows decimated + watermarked previews,
  // not the STL they'd print. Deliberately waits until the walkthrough and the
  // controls overlay are done — three modals stacked on load is worse than the
  // confusion this is meant to prevent — so it lands on a table they can see.
  React.useEffect(() => {
    if (readOnly || !showTable || tourActive || showHelp) return
    if (hasAcknowledgedPreviewQuality()) return
    const t = window.setTimeout(() => setShowPreviewQuality(true), 600)
    return () => window.clearTimeout(t)
  }, [readOnly, showTable, tourActive, showHelp])

  // Clear any tour left active elsewhere (e.g. the dashboard walkthrough) so it
  // can't bleed into the planner; our own effect above starts it when relevant.
  React.useEffect(() => {
    useOnboardingStore.getState().stopTour()
  }, [])

  // Load the catalogue, then frame the (empty) table once it's ready. The planner
  // opens on a clear table — the user places pieces themselves.
  // Kept as a promise, not fire-and-forget: the loading gate below has to wait
  // for it. A table's pieces are often SET PARTS, whose assets are registered by
  // this call (loadSetsFromAPI) and by nothing else — resolveAssetsByIds skips
  // `part:` ids on purpose — so resolving them any earlier finds nothing.
  const cataloguePromise = React.useRef<Promise<unknown> | null>(null)
  React.useEffect(() => {
    cataloguePromise.current = Promise.resolve(loadCatalogue()).catch(() => {})
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
      // resetToScratch, NOT clearInstances + resetTerrain + resetPaint: the
      // store outlives client-side navigation, and clearInstances is a normal
      // undoable edit, so that combination left the previous table sitting one
      // Ctrl+Z away (and its terrain in the baseline snapshot).
      useAppStore.getState().actions.resetToScratch()
      setSavedTableId(null)
      setSavedTableName(null)
      setIsOwner(false)
      setOwnsViewedTable(false)
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
        // Pull every distinct model's geometry BEFORE lifting the loading gate
        // (see tableAssetsReady above). ensureTemplate is the same cache the
        // scene uses, so this is not an extra download — it just lets us wait
        // for the ones the scene is about to request anyway.
        void preloadTablePieces(instances.map((i) => i.assetId), () => cancelled)
        setSavedTableName(shareToken ? `${t.name} (Copy)` : t.name)
        if (!shareToken) {
          setSavedTableId(t.id)
          // Own it only if it's yours; otherwise Save makes a copy under your account.
          const owned = !!user?.email && t.userEmail === user.email
          setIsOwner(owned)
          setOwnsViewedTable(owned)
          refreshCollabs(t.id, owned)
        } else {
          // A shared copy starts with no collaborations of its own; foreign models
          // already in it get requests raised when the copier first saves.
          refreshCollabs(null, false)
        }
      } catch {
        if (!cancelled) {
          hotToast.error('Could not load that table')
          setTableAssetsReady(true) // nothing to wait for — don't strand the overlay
        }
      }
    })()
    return () => { cancelled = true }
  }, [tableId, shareToken, user?.email]) // eslint-disable-line react-hooks/exhaustive-deps

  // Wait for each distinct model on a loaded table, reporting progress as it
  // goes. ensureTemplate resolves to a grey box rather than rejecting when a
  // GLB 404s or fails to parse, so this always settles; the timeout is only a
  // guard against a request that hangs open forever on a bad connection.
  async function preloadTablePieces(assetIds: string[], isCancelled: () => boolean) {
    const ids = [...new Set(assetIds)]
    if (!ids.length) { setTableAssetsReady(true); return }
    setTablePieceLoad({ loaded: 0, total: ids.length })
    // The catalogue is what registers set-part assets, and it loads in parallel
    // with the table itself — without this wait every `part:` piece looks
    // unknown, gets skipped, and the gate lifts on an empty board.
    await cataloguePromise.current
    if (isCancelled()) return
    let loaded = 0
    const one = (id: string) => {
      const asset = getAssetById(id)
      if (!asset) return Promise.resolve()
      return ensureTemplate(asset)
        .catch(() => {})
        .then(() => {
          loaded += 1
          if (!isCancelled()) setTablePieceLoad({ loaded, total: ids.length })
        })
    }
    const all = Promise.all(ids.map(one))
    await Promise.race([all, new Promise((r) => window.setTimeout(r, TABLE_PIECE_LOAD_TIMEOUT_MS))])
    if (isCancelled()) return
    // Geometry is in hand, but the scene rebuilds its instanced meshes off the
    // same promises — give it a frame or two to upload them so the reveal shows
    // a finished table rather than the last piece popping in.
    window.setTimeout(() => { if (!isCancelled()) setTableAssetsReady(true) }, 250)
  }

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

  // `assets` is already the server-filtered result (search/class/facets/price all
  // re-query the backend — see the debounced effects above and setCatalogueFilter),
  // so no further client-side text filtering is needed here.
  const filtered = assets

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

  // Multi-part "set" models, as browsable group tiles in the Catalogue tab —
  // not just under "My items". Sets are excluded from the flat per-model grid
  // above (a set is one purchase covering several placeable parts), so without
  // this they were never discoverable by anyone who didn't already own one:
  // if every currently-published model happens to be a set, the Catalogue tab
  // reads as completely empty. `sets` here only ever holds *published* sets
  // that have at least one ready part (see loadSetsFromAPI), so no ownership
  // filter is needed — same visibility rule the flat catalogue already uses.
  const catalogueSetGroups = React.useMemo(
    () =>
      sets.map((s) => ({
        key: `set:${s.id}`,
        kind: 'set' as const,
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail,
        price: s.price,
        owned: ownedModelIds.has(s.id),
        memberIds: s.partAssetIds,
      })),
    [sets, ownedModelIds],
  )

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
      (id) => !memberIds.has(id) && !setModelIds.has(id) && (assetsById.has(id) || !!getAssetById(id)),
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
        title={`Place ${a.name}${a.aabb ? ` — ${formatPieceDims(a.aabb, unitSystem)}` : ''}`}
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

  // An expandable group tile (a bundle or a multi-part set) — click to reveal its
  // member models/parts, each individually placeable via renderModelTile. Shared
  // by the Catalogue tab (every published set, browsable by anyone) and "My
  // items" (owned/basket/own bundles + sets).
  const renderGroupTile = (g: {
    key: string; kind: 'set' | 'bundle'; id: string; name: string
    thumbnail?: string; price: number; owned: boolean; memberIds: string[]
  }) => {
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
    const ownAsset = getAssetById(m.id)
    if (!ownAsset) return null
    return (
      <button
        key={m.id}
        className={`tb-tile ${selectedAssetId === m.id ? 'is-active' : ''}`}
        onClick={() => pickAsset(m.id)}
        title={`Place ${m.name}${ownAsset.aabb ? ` — ${formatPieceDims(ownAsset.aabb, unitSystem)}` : ''}`}
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
    // Fall back to the global registry (getAssetById) for anything a piece was
    // placed from that's since scrolled out of `assets` — e.g. the catalogue was
    // re-queried by a search/filter/sort change after the piece went on the table.
    // Without the fallback, a placed model would silently vanish from the build
    // the moment the palette filter no longer includes it.
    const byId = new Map([...assets, ...setPartAssets].map((a) => [a.id, a]))
    const rows = [...counts.entries()]
      .map(([id, qty]) => ({ asset: byId.get(id) ?? getAssetById(id), qty }))
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
  // Edit-mode "what did I just select" readout — the piece's real-world size in
  // the current display unit, shown in the mode badge below.
  const singleSelectedAsset = React.useMemo(() => {
    if (selectedInstanceIds.length !== 1) return null
    const inst = instances.find((i) => i.id === selectedInstanceIds[0])
    if (!inst) return null
    return assetsById.get(inst.assetId) ?? getAssetById(inst.assetId) ?? null
  }, [selectedInstanceIds, instances, assetsById])

  // Whether the current selection already includes a fused group (drives
  // showing "Unfuse" instead of/alongside "Fuse" in the toolbar).
  const selectionHasFusedGroup = React.useMemo(() => {
    if (!selectedInstanceIds.length) return false
    const selected = new Set(selectedInstanceIds)
    return instances.some((i) => selected.has(i.id) && i.groupId)
  }, [selectedInstanceIds, instances])

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
      // The placed piece's own real-world size (a set part shows its own size,
      // not the whole set's) — lets a shopper double-check the scale in person.
      aabb: asset?.aabb,
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

  /**
   * "Edit a copy" on a community table or artist showcase.
   *
   * A published table belongs to someone else, so it opens read-only — but the
   * whole point of browsing other people's builds is to start from one. This
   * duplicates it into the viewer's own account (server-side, via
   * POST /tables/:id/duplicate, which only permits it for a table you can
   * actually view) and reopens the COPY at /planner/t/:newId, where the normal
   * owner edit+save path takes over. The original is never touched: the copy is
   * a separate row with its own id and share token, and is private by default.
   */
  async function handleEditCopy() {
    if (!tableId || copying) return
    if (!isAuthenticated || !user?.email) {
      hotToast.error('Log in to make your own copy of this table')
      navigate('/login')
      return
    }
    setCopying(true)
    try {
      const copy = await tablesApi.duplicate(tableId)
      hotToast.success('Copied to your tables — this one is yours to edit')
      // Switching tableId AND readOnly re-runs the load effect against the copy,
      // which resolves as owned (the row carries the caller's email), so Save
      // updates it in place rather than making yet another copy.
      navigate(`/planner/t/${copy.id}`)
    } catch {
      hotToast.error('Could not copy this table')
    } finally {
      setCopying(false)
    }
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

  // Current board size in feet (rounded for preset matching — presets are
  // authored as real-world feet, e.g. "a 6x4 table", regardless of the unit
  // the user has chosen to view sizes in).
  const wFt = Math.round((table.width / M_PER_FT) * 10) / 10
  const hFt = Math.round((table.height / M_PER_FT) * 10) / 10
  // The same size, shown in whichever unit is currently selected.
  const wDisplay = metresToDisplay(table.width, unitSystem)
  const hDisplay = metresToDisplay(table.height, unitSystem)

  // Bounds stay a fixed 1–12ft of real table regardless of display unit.
  const MIN_TABLE_M = 1 * M_PER_FT
  const MAX_TABLE_M = 12 * M_PER_FT
  const minDisplay = metresToDisplay(MIN_TABLE_M, unitSystem)
  const maxDisplay = metresToDisplay(MAX_TABLE_M, unitSystem)
  const displayStep = unitSystem === 'imperial' ? 0.5 : 0.1

  function applyTableFt(nextW: number, nextH: number, refit = false) {
    const w = Math.min(12, Math.max(1, nextW)) * M_PER_FT
    const h = Math.min(12, Math.max(1, nextH)) * M_PER_FT
    setTable({ width: w, height: h })
    if (refit) window.setTimeout(() => fitView(), 60)
  }

  // Same as applyTableFt, but the two numbers are in whatever unit the table
  // size inputs are currently showing (feet or metres).
  function applyTableSize(nextWDisplay: number, nextHDisplay: number, refit = false) {
    const w = Math.min(MAX_TABLE_M, Math.max(MIN_TABLE_M, displayToMetres(nextWDisplay, unitSystem)))
    const h = Math.min(MAX_TABLE_M, Math.max(MIN_TABLE_M, displayToMetres(nextHDisplay, unitSystem)))
    setTable({ width: w, height: h })
    if (refit) window.setTimeout(() => fitView(), 60)
  }

  return (
    <div className={`tb-fs${compact ? ' is-compact' : ''}${coarse ? ' is-touch' : ''}`}>
      <ThreeStage />

      {/* Loading gate — blocks interaction until the table, its textures AND
          (for a saved/shared/published table) every model on it are ready. */}
      {!showTable && (
        <div className="tb-loading" role="status" aria-live="polite">
          <div className="tb-loading-card">
            <Logo variant="lockup" title="Artifact Armoury" className="tb-loading-logo" />
            <div className="tb-loading-title">
              {tablePieceLoad ? 'Loading the models on this table…' : 'Preparing your table…'}
            </div>
            <div className="tb-loading-track">
              <div className="tb-loading-bar" style={{ transform: `scaleX(${Math.max(6, gatePct) / 100})` }} />
            </div>
            <div className="tb-loading-pct">
              {tablePieceLoad
                ? `${tablePieceLoad.loaded} of ${tablePieceLoad.total} models · ${gatePct}%`
                : `${gatePct}%`}
            </div>
            {tablePieceLoad && tablePieceLoad.total >= LARGE_TABLE_LOAD_MODELS && (
              <div className="tb-loading-note">
                This is a large, detailed table — it can take a moment to load and may
                run slower on older devices.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Heavy table warning — shown once the table is up, so the framerate it
          warns about isn't the first explanation the viewer gets. */}
      {showTable && isHeavyTable && !heavyWarnDismissed && !uiHidden && (
        <div className={`tb-heavy-warn${readOnly ? '' : ' is-below-badge'}`} role="status">
          <AlertTriangle size={14} className="tb-heavy-warn-icon" />
          <span>Large detailed tables may cause latency — panning and zooming can feel slower here.</span>
          <button
            className="tb-heavy-warn-x"
            onClick={() => setHeavyWarnDismissed(true)}
            title="Dismiss"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
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
          {!selectedAssetId && singleSelectedAsset?.aabb && (
            <span className="tb-level">
              {singleSelectedAsset.name}
              <span className="tb-small"> · {formatPieceDims(singleSelectedAsset.aabb, unitSystem)}</span>
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
                {selectedInstanceIds.length > 1 && (
                  <button
                    className="tb-icon"
                    title="Fuse selection into one piece (Ctrl+G) — move, rotate, delete as a unit"
                    onClick={() => fuseSelected()}
                  >
                    <Combine size={18} />
                  </button>
                )}
                {selectionHasFusedGroup && (
                  <button
                    className="tb-icon"
                    title="Unfuse selection back into separate pieces (Ctrl+Shift+G)"
                    onClick={() => unfuseSelected()}
                  >
                    <Ungroup size={18} />
                  </button>
                )}
                {/* Delete was keyboard-only on desktop (Del/Backspace) — fine if
                    you know it, invisible if you don't. The touch bar already had
                    a button; this is its desktop counterpart. No confirm dialog:
                    it is a single undoable step (Ctrl+Z), and a prompt on every
                    piece removal would be worse than the mistake it prevents. */}
                <button
                  className="tb-icon is-danger"
                  title={`Delete ${selectedInstanceIds.length > 1 ? `${selectedInstanceIds.length} selected pieces` : 'selection'} (Del)`}
                  onClick={() => removeInstances(selectedInstanceIds)}
                >
                  <Trash2 size={18} />
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
                title="Your build & basket"
                onClick={() => openBom(!bomOpen)}
              >
                <PanelRight size={18} />
                {cartItems.length > 0 && <span className="tb-drawer-tab-dot">{cartItems.length}</span>}
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
                Catalogue <span className="tb-small">{filtered.length + catalogueSetGroups.length}</span>
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
                  {query && (
                    <button className="tb-searchbar-clear" onClick={() => setQuery('')} title="Clear search">
                      <X size={13} />
                    </button>
                  )}
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

                <div className="tb-filter">
                  <button className="tb-filter-toggle" onClick={() => setShowFilters((v) => !v)}>
                    <SlidersHorizontal size={13} />
                    Filters
                    {activeFilterCount > 0 && <span className="tb-filter-count">{activeFilterCount}</span>}
                    <ChevronDown size={13} className={`tb-chev ${showFilters ? 'is-open' : ''}`} />
                  </button>
                  {activeFilterCount > 0 && (
                    <button className="tb-filter-clear" onClick={clearCatalogueFilters}>
                      Clear
                    </button>
                  )}
                </div>

                {showFilters && (
                  <div className="tb-filter-rail">
                    <div className="tb-filter-group">
                      <label className="tb-filter-label" htmlFor="tb-sort-select">Sort by</label>
                      <select
                        id="tb-sort-select"
                        className="tb-filter-select"
                        value={catalogueSort}
                        onChange={(e) => setCatalogueFilter({ sortBy: e.target.value as typeof catalogueSort })}
                      >
                        <option value="recent">Newest</option>
                        <option value="popular">Most popular</option>
                        <option value="sales">Best sellers</option>
                        <option value="rating">Top rated</option>
                        <option value="price_low">Price: Low to high</option>
                        <option value="price_high">Price: High to low</option>
                        <option value="name">Alphabetical</option>
                      </select>
                    </div>

                    <div className="tb-filter-group">
                      <label className="tb-filter-label">Price (£)</label>
                      <div className="tb-filter-price-row">
                        <input
                          type="number"
                          min={0}
                          placeholder="Min"
                          value={minPriceInput}
                          onChange={(e) => setMinPriceInput(e.target.value)}
                        />
                        <span>–</span>
                        <input
                          type="number"
                          min={0}
                          placeholder="Max"
                          value={maxPriceInput}
                          onChange={(e) => setMaxPriceInput(e.target.value)}
                        />
                      </div>
                    </div>

                    {filterRailFacets.length > 0 && (
                      <FacetRail
                        facets={filterRailFacets}
                        selected={selectedFilterTokens}
                        onToggle={onToggleFilterTerm}
                        loading={catalogueLoading}
                      />
                    )}
                  </div>
                )}

                <div className="tb-palette-scroll">
                  {catalogueSetGroups.length > 0 && (
                    <div className="tb-palette-section">
                      <div className="tb-palette-cat">Sets</div>
                      {catalogueSetGroups.map(renderGroupTile)}
                    </div>
                  )}
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
                            title={`Place ${a.name}${a.aabb ? ` — ${formatPieceDims(a.aabb, unitSystem)}` : ''}`}
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
                  {filtered.length === 0 && catalogueSetGroups.length === 0 && (
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

                {myItems.groups.map(renderGroupTile)}

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

          {/* Table build (planning BOM) vs real basket — two tabs so "what I've
              placed" and "what I'm actually buying" are never the same panel.
              An artist building a showcase isn't shopping (they own their own
              models, and placing one never adds it to a basket — see
              addPlacedModelToShopCart) so they get a single "what's on this
              table" view with a net value instead of a buy flow. */}
          <aside
            className={`tb-bom${compact && !bomOpen ? ' is-stowed' : ''}`}
            data-tour="planner-bom"
          >
            {isArtist ? (
              <>
                <div className="tb-palette-tabs">
                  <div className="tb-tab is-active" style={{ cursor: 'default' }}>
                    Models on this table <span className="tb-small">{bom.pieceCount}</span>
                  </div>
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
                      <div className="tb-bom-qty" title={`${r.qty} on the table`}>×{r.qty}</div>
                      <div className="tb-bom-price">£{(r.asset!.price ?? 0).toFixed(2)}</div>
                    </div>
                  ))}
                </div>
                <div className="tb-bom-total">
                  <span>Value of table</span>
                  <strong>£{bom.total.toFixed(2)}</strong>
                </div>
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
              </>
            ) : (
              <>
                <div className="tb-palette-tabs">
                  <button
                    className={`tb-tab ${buildTab === 'table' ? 'is-active' : ''}`}
                    onClick={() => setBuildTab('table')}
                  >
                    Table <span className="tb-small">{bom.pieceCount}</span>
                  </button>
                  <button
                    className={`tb-tab ${buildTab === 'basket' ? 'is-active' : ''}`}
                    onClick={() => setBuildTab('basket')}
                    title="What's actually in your basket — placing a model here doesn't add it automatically"
                  >
                    Basket <span className="tb-small">{cartItems.length}</span>
                  </button>
                </div>

                {buildTab === 'table' ? (
                  <>
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
                  </>
                ) : (
                  <>
                    <div className="tb-bom-list">
                      {cartItems.length === 0 && (
                        <div className="tb-small" style={{ padding: 8 }}>
                          Nothing in your basket yet. Build your table, then "Add all to basket" (or add pieces one at a time from the Table tab).
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
                  </>
                )}
              </>
            )}
          </aside>

          {/* Table size (presets + custom). The real size is always stored in
              metres — this unit toggle only changes how it's displayed. */}
          <div className="tb-tablesize">
            <div className="tb-tablesize-head">
              <span className="tb-small">Table size ({uLabel})</span>
              <div className="tb-unit-toggle" title="Display units — doesn't change any real size">
                <button
                  className={`tb-unit-btn ${unitSystem === 'imperial' ? 'is-active' : ''}`}
                  onClick={() => setUnitSystem('imperial')}
                >
                  ft
                </button>
                <button
                  className={`tb-unit-btn ${unitSystem === 'metric' ? 'is-active' : ''}`}
                  onClick={() => setUnitSystem('metric')}
                >
                  m
                </button>
              </div>
            </div>
            <div className="tb-preset-row">
              {TABLE_PRESETS.map((p) => {
                const label = unitSystem === 'imperial'
                  ? p.label
                  : `${metresToDisplay(p.w * M_PER_FT, 'metric')}×${metresToDisplay(p.h * M_PER_FT, 'metric')}`
                return (
                  <button
                    key={p.label}
                    className={`tb-preset ${wFt === p.w && hFt === p.h ? 'is-active' : ''}`}
                    onClick={() => applyTableFt(p.w, p.h, true)}
                    title={`${p.w}ft × ${p.h}ft (${metresToDisplay(p.w * M_PER_FT, 'metric')}m × ${metresToDisplay(p.h * M_PER_FT, 'metric')}m)`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <div className="tb-dim-row">
              <input
                type="number" min={minDisplay} max={maxDisplay} step={displayStep} value={wDisplay}
                onChange={(e) => applyTableSize(Number(e.target.value) || wDisplay, hDisplay)}
                aria-label={`Table width (${uLabel})`}
              />
              <span className="tb-small">×</span>
              <input
                type="number" min={minDisplay} max={maxDisplay} step={displayStep} value={hDisplay}
                onChange={(e) => applyTableSize(wDisplay, Number(e.target.value) || hDisplay)}
                aria-label={`Table depth (${uLabel})`}
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
              {/* The reason someone opens a stranger's table: to build from it.
                  Deliberately a labelled primary button rather than another icon
                  — it is the one action on this bar that isn't a camera control. */}
              {ownsViewedTable ? (
                /* Your own table, just being viewed as the public sees it — go
                   straight to editing it. Offering "Edit a copy" here would have
                   an artist duplicating their own showcase to change it. */
                <button
                  className="tb-view-copy"
                  onClick={() => navigate(`/planner/t/${tableId}`)}
                  title="Edit this table"
                >
                  <Pencil size={16} /> Edit
                </button>
              ) : (
                <button
                  className="tb-view-copy"
                  disabled={copying}
                  onClick={handleEditCopy}
                  title="Copy this table into your account and edit it — the original is unchanged"
                >
                  {copying
                    ? <><Loader2 size={16} className="tb-spin" /> Copying…</>
                    : <><Pencil size={16} /> Edit a copy</>}
                </button>
              )}
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
                  <span className="tb-small">
                    {selectedModel.artistName} · £{selectedModel.price.toFixed(2)}
                    {selectedModel.aabb && ` · ${formatPieceDims(selectedModel.aabb, unitSystem)}`}
                  </span>
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
