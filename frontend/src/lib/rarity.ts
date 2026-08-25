/**
 * Rarity / quality-tier palette, toned to sit on the deep-space ground.
 * Used for material rarity edges and quality numbers everywhere.
 */
export const RARITY_COLORS = {
  legendary: '#D65A50',
  epic: '#A87BEA',
  rare: '#D9A431',
  uncommon: '#35B9A0',
  common: '#DCE5E3',
  poor: '#8A9C99',
} as const

export type Rarity = keyof typeof RARITY_COLORS

/** Quality number → tier: ≥900 legendary … 500–599 common, below 500 poor. */
export function qualityTier(quality: number): Rarity {
  if (quality >= 900) return 'legendary'
  if (quality >= 800) return 'epic'
  if (quality >= 700) return 'rare'
  if (quality >= 600) return 'uncommon'
  if (quality >= 500) return 'common'
  return 'poor'
}

export function qualityColor(quality: number | null | undefined): string {
  return quality === null || quality === undefined ? 'inherit' : RARITY_COLORS[qualityTier(quality)]
}

export function rarityColor(rarity: string | null | undefined): string {
  return RARITY_COLORS[rarity as Rarity] ?? 'transparent'
}

/** The previous palette's green — kept as the "complete" signal on progress figures. */
export const COMPLETE_GREEN = '#58a862'
