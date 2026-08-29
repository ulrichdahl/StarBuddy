import { useQuery } from '@tanstack/react-query'
import { api, unwrapList } from './api'
import type { Location } from './types'

/** Every location the user may stash at: own, org and the shared landing zones. */
export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: async () => unwrapList<Location>((await api.get('/api/locations')).data),
  })
}

/** Distinct star systems across those locations, sorted — list filters offer these. */
export function useSystems(): string[] {
  const { data: locations = [] } = useLocations()
  return [...new Set(locations.map((l) => l.system).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b))
}

/** "Pyro – Pyro Gateway": the unambiguous form for a picked value; personal locations have no system. */
export function locationLabel(location: Location): string {
  return location.system ? `${location.system} – ${location.name}` : location.name
}
