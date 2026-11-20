import { useQuery } from '@tanstack/react-query'
import { api } from './api'

/** One pinned blueprint, from GET /api/craft-targets. */
export interface CraftTarget {
  blueprint_id: number
  name: string
  item_class: string | null
  quantity: number
  pinned_at: string | null
}

/** A material still to gather for the pinned blueprints. */
export interface GatheringLine {
  name: string
  unit: 'mscu' | 'pieces'
  need: number
  have_mine: number
  have_org: number
  missing: number
  for: number[]
}

export function useCraftTargets() {
  return useQuery({
    queryKey: ['craft-targets'],
    queryFn: async () => (await api.get<{ targets: CraftTarget[]; gathering: GatheringLine[] }>('/api/craft-targets')).data,
    staleTime: 60_000,
  })
}

/** Pinned blueprint id → how many, for marking rows in a list. */
export function usePinnedBlueprints(): Map<number, number> {
  const { data } = useCraftTargets()
  return new Map((data?.targets ?? []).map((t) => [t.blueprint_id, t.quantity]))
}
