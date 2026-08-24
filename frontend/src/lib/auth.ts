import { useQuery } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { api } from './api'
import type { Me } from './types'

/**
 * Current session, via GET /api/me.
 * A 401 means "not signed in" — surfaced as `me: null`, not as an error.
 */
export function useMe() {
  const query = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<Me | null> => {
      try {
        const { data } = await api.get<Me>('/api/me')
        return data
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 401) return null
        throw error
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  return { me: query.data ?? null, isLoading: query.isLoading, isError: query.isError }
}
