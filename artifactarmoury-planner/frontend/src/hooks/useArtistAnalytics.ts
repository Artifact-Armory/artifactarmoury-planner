import { useQuery } from '@tanstack/react-query'
import { artistsApi } from '../api/endpoints/artists'
import { useAuthStore } from '../store/authStore'

export const useArtistAnalytics = () => {
  const { user } = useAuthStore()
  const artistId = user?.id

  const query = useQuery({
    queryKey: ['artist-analytics', artistId],
    queryFn: () => artistsApi.getAnalytics(artistId!),
    enabled: Boolean(artistId),
    staleTime: 60 * 1000,
  })

  return {
    ...query,
    artistId,
  }
}
