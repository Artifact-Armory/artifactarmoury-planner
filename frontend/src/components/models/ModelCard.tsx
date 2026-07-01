import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, ShoppingCart, Star } from 'lucide-react'
import { TerrainModel } from '../../api/types'
import Button from '../ui/Button'
import { useCartStore } from '../../store/cartStore'
import { formatPrice, formatRating } from '../../utils/format'

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
        <p className="line-clamp-1 text-sm text-gray-500">by {model.artistName}</p>

        <div className="mt-3 flex items-center justify-between">
          <div className="text-sm font-medium text-gray-900">{formatPrice(model.basePrice)}</div>
          <div className="flex items-center text-sm text-amber-500">
            <Star size={16} className="mr-1 fill-amber-400" />
            <span className="text-gray-700">{formatRating(model.averageRating)}</span>
          </div>
        </div>

        <div className="mt-4 flex justify-between text-xs text-gray-500">
          <span>{model.category}</span>
          {model.reviewCount !== undefined && (
            <span>{model.reviewCount} reviews</span>
          )}
        </div>

        <Button
          variant="primary"
          size="md"
          className="mt-4 w-full"
          onClick={handleAddToCart}
          leftIcon={<ShoppingCart size={16} />}
        >
          Add to cart
        </Button>
      </div>
    </article>
  )
}

export default ModelCard

