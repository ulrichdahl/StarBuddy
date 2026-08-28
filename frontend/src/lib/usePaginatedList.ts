import { useEffect, useState } from 'react'
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
export function usePaginatedList<T>(
  key: string,
  url: string,
  defaultRowsPerPage = 50,
  params: Record<string, string | number | undefined> = {},
) {
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPageState] = useState(defaultRowsPerPage)

  // New filters, sorting or page size restart from the first page.
  const paramsKey = JSON.stringify(params)
  useEffect(() => setPage(0), [paramsKey, rowsPerPage])

  const query = useQuery({
    queryKey: [key, page, rowsPerPage, paramsKey],
    queryFn: async () => {
      const { data } = await api.get(url, { params: { ...params, page: page + 1, per_page: rowsPerPage } })
      if (Array.isArray(data)) {
        return { data, total: data.length, per_page: rowsPerPage } as Paginated<T>
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
    rowsPerPage,
    setRowsPerPage: setRowsPerPageState,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
