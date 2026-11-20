import { useQuery } from '@tanstack/react-query'
import { api } from './api'

/** One pinned blueprint, from GET /api/craft-targets. */
export interface CraftTarget {
  blueprint_id: number
  name: string
  item_class: string | null
  quantity: number
  pinned_at: string | null
  materials: number
  materials_missing: number
  materials_missing_with_org: number
  /** Everything it needs is in the player's own hold. */
  ready: boolean
}

/** A material still to gather for the pinned blueprints. */
export interface GatheringLine {
  name: string
  unit: 'mscu' | 'pieces'
  need: number
  /** The quality the recipes ask for; null when they do not say. */
  min_quality: number | null
  for: number[]
  for_targets: { blueprint_id: number; name: string; quantity: number }[]
  have_mine: number
  have_org: number
  have_mine_below: number
  missing: number
  missing_with_org: number
}

export interface ShoppingList {
  targets: CraftTarget[]
  gathering: GatheringLine[]
  summary: { materials: number; still_to_gather: number; still_to_gather_with_org: number }
  discord: { can_post: boolean }
}

export function useCraftTargets() {
  return useQuery({
    queryKey: ['craft-targets'],
    queryFn: async () => (await api.get<ShoppingList>('/api/craft-targets')).data,
    staleTime: 60_000,
  })
}

/** Pinned blueprint id → how many, for marking rows in a list. */
export function usePinnedBlueprints(): Map<number, number> {
  const { data } = useCraftTargets()
  return new Map((data?.targets ?? []).map((t) => [t.blueprint_id, t.quantity]))
}
