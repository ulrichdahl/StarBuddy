import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from './api'

interface Paginated<T> {
  data: T[]
  total: number
  per_page: number
}

/**
 * Server-side paginated list backed by a Laravel paginator endpoint.
 * Invalidating [key] refetches the current page.
 */
export function usePaginatedList<T>(key: string, url: string, defaultRowsPerPage = 50) {
  const [page, setPage] = useState(0)
  const query = useQuery({
    queryKey: [key, page],
    queryFn: async () => {
      const { data } = await api.get(url, { params: { page: page + 1 } })
      if (Array.isArray(data)) {
        return { data, total: data.length, per_page: defaultRowsPerPage } as Paginated<T>
      }
      return data as Paginated<T>
    },
    placeholderData: keepPreviousData,
  })

  return {
    rows: query.data?.data ?? [],
    total: query.data?.total ?? 0,
    page,
    setPage,
    rowsPerPage: query.data?.per_page ?? defaultRowsPerPage,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
