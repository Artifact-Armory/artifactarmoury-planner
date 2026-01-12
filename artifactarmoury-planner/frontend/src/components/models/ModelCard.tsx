import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Heart, Layers, ShieldCheck, ShoppingCart, Star } from 'lucide-react'
import { TerrainModel } from '../../api/types'
import Button from '../ui/Button'
import { useCartStore } from '../../store/cartStore'
import { useLibraryStore } from '../../store/libraryStore'
import { formatPrice, formatRating } from '../../utils/format'
import { formatLicense } from '../../utils/licenses'
import { modelsApi } from '../../api/endpoints/models'
import toast from 'react-hot-toast'
import { ensurePlanningTable } from '../../utils/planningTable'
import { useAppStore } from '@state/store'

interface ModelCardProps {
  model: TerrainModel
  onAddToCart?: (model: TerrainModel) => void
  onToggleFavorite?: (model: TerrainModel) => void
}

const ModelCard: React.FC<ModelCardProps> = ({ model, onAddToCart, onToggleFavorite }) => {
  const navigate = useNavigate()
  const { addItem, openCart } = useCartStore((state) => ({
    addItem: state.addItem,
    openCart: state.openCart,
  }))
  const addAssetToTable = useLibraryStore((state) => state.addAssetToTable)
  const ensureAssetForModel = useLibraryStore((state) => state.ensureAssetForModel)
  const ownedAssetIds = useLibraryStore((state) => state.ownedAssetIds)
  const ownedModelIds = useLibraryStore((state) => state.ownedModelIds)
  const upsertLibraryAsset = useAppStore((state) => state.actions.upsertLibraryAsset)
  const [assetId, setAssetId] = React.useState<string | null>(model.assetId ?? null)
  const [isInLibrary, setIsInLibrary] = React.useState(Boolean(model.inLibrary))
  const [addingToLibrary, setAddingToLibrary] = React.useState(false)
  const isOwned = React.useMemo(() => {
    if (assetId && ownedAssetIds.has(assetId)) return true
    return ownedModelIds.has(model.id)
  }, [assetId, ownedAssetIds, ownedModelIds, model.id])

  React.useEffect(() => {
    setIsInLibrary(Boolean(model.inLibrary))
  }, [model.inLibrary])
  React.useEffect(() => {
    setAssetId(model.assetId ?? null)
  }, [model.assetId])

  const handleAddToCart = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (onAddToCart) {
      onAddToCart(model)
      return
    }

    addItem({
      modelId: model.id,
      name: model.name,
      artistName: model.artistName,
      price: model.basePrice,
      imageUrl: model.thumbnailUrl,
    })
    openCart()
  }

  const handleFavorite = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onToggleFavorite?.(model)
  }

  const handleAddToLibrary = async (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (addingToLibrary) {
      return
    }

    setAddingToLibrary(true)
    try {
      let resolvedAssetId = assetId
      if (!resolvedAssetId) {
        const ensured = await ensureAssetForModel(model.id)
        if (!ensured?.id) {
          toast.error('This model is not yet available in the asset planning library.')
          return
        }
        resolvedAssetId = ensured.id
        setAssetId(resolvedAssetId)
        upsertLibraryAsset(ensured)
      } else {
        const existing = await ensureAssetForModel(model.id)
        if (existing?.id) {
          upsertLibraryAsset(existing)
        }
      }

      const tableId = await ensurePlanningTable()
      await addAssetToTable(tableId, resolvedAssetId)
      setIsInLibrary(true)
      toast.success('Added to planning library')
    } catch (error: any) {
      console.error('Failed to add model to asset library', error)
      const message =
        error?.response?.data?.message ??
        error?.message ??
        'Unable to add this model to the planning library.'
      toast.error(message)
    } finally {
      setAddingToLibrary(false)
    }
  }

  return (
    <article
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/models/${model.id}`)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          navigate(`/models/${model.id}`)
        }
      }}
    >
      <div className="relative h-48 w-full overflow-hidden bg-gray-100">
        {model.thumbnailUrl ? (
          <img
            src={model.thumbnailUrl}
            alt={model.name}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
            No preview
          </div>
        )}

        <button
          onClick={handleFavorite}
          className="absolute right-3 top-3 rounded-full bg-white/90 p-2 text-gray-500 shadow hover:text-red-500"
          aria-label="Add to wishlist"
        >
          <Heart size={16} />
        </button>
      </div>

      <div className="flex flex-1 flex-col px-3 py-4">
        <h3 className="line-clamp-1 text-lg font-semibold text-gray-900">{model.name}</h3>
        <p className="line-clamp-1 text-sm text-gray-500">
          by {model.artistName}
          {model.creatorVerified ? (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              <ShieldCheck size={12} />
              {model.verificationBadge ?? 'Verified'}
            </span>
          ) : null}
        </p>

        <div className="mt-3 flex items-center justify-between">
          <div className="text-sm font-medium text-gray-900">{formatPrice(model.basePrice)}</div>
          <div className="flex items-center gap-2">
            {isOwned ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
                Owned
              </span>
            ) : null}
            <div className="flex items-center text-sm text-amber-500">
              <Star size={16} className="mr-1 fill-amber-400" />
              <span className="text-gray-700">{formatRating(model.averageRating)}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-between text-xs text-gray-500">
          <span>
            {model.category} · {formatLicense(model.license)}
          </span>
          {model.reviewCount !== undefined && (
            <span>{model.reviewCount} reviews</span>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="primary"
            size="md"
            className="w-full"
            onClick={handleAddToCart}
            leftIcon={<ShoppingCart size={16} />}
          >
            Add to cart
          </Button>
          <Button
            variant={isInLibrary ? 'ghost' : 'outline'}
            size="md"
            className="w-full"
            onClick={handleAddToLibrary}
            leftIcon={
              isInLibrary ? <Check size={16} className="text-emerald-600" /> : <Layers size={16} />
            }
            disabled={isInLibrary}
            loading={addingToLibrary}
          >
            {isInLibrary ? 'In asset library' : 'Add to asset library'}
          </Button>
        </div>
      </div>
    </article>
  )
}

export default ModelCard
