import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import Spinner from '../../components/ui/Spinner'
import ModelGrid from '../../components/models/ModelGrid'
import Button from '../../components/ui/Button'
import { modelsApi } from '../../api/endpoints/models'

const Wishlist: React.FC = () => {
  const navigate = useNavigate()
  const wishlistQuery = useQuery({
    queryKey: ['wishlist'],
    queryFn: async () => {
      try {
        const response = await modelsApi.getWishlist(1, 50)
        return response.models
      } catch (error) {
        console.warn('Wishlist endpoint unavailable', error)
        return []
      }
    },
  })

  const wishlist = wishlistQuery.data ?? []

  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-white p-8 shadow">
        <h1 className="text-2xl font-semibold text-gray-900">Wishlist</h1>
        <p className="mt-2 text-sm text-gray-600">Save models to compare and purchase later.</p>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        {wishlistQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : wishlist.length ? (
          <ModelGrid models={wishlist} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <p className="text-sm font-medium text-gray-700">No saved models yet.</p>
            <p className="text-xs text-gray-500">Tap the heart icon on any model to add it to your wishlist.</p>
            <Button variant="outline" onClick={() => navigate('/browse')}>
              Browse models
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

export default Wishlist
