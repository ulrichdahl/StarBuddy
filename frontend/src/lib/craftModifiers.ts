/**
 * How material quality moves a crafted item's stats.
 *
 * A recipe is a set of slots ("requirement groups": Frame, Barrel, Cycler,
 * …). Each slot takes one material, and declares which item properties that
 * material's quality modifies as a multiplier interpolated across the quality
 * range — the CQ7's barrel, for instance, scales `weapon_firerate` from ×0.88
 * at quality 0 to ×1.12 at quality 1000. Several slots touching the same
 * property multiply together, and the crafted value is the default value
 * times that product.
 *
 * The same arithmetic lives in `backend/app/Support/CraftModifiers.php` for
 * the server-side estimates — keep the two in step.
 */

export interface ModifierSegment {
  quality_min: number
  quality_max: number
  modifier_at_start: number
  modifier_at_end: number
}

export interface StatModifier {
  /** Game property the slot modifies, e.g. `weapon_damage`. */
  property_key: string
  label: string
  better_when: 'higher' | 'lower' | 'neutral' | null
  quality_range: { min: number | null; max: number | null }
  modifier_range: { at_min_quality: number | null; at_max_quality: number | null }
  value_range_type: string | null
  value_segments: ModifierSegment[] | null
}

export interface RequirementGroup {
  key: string | null
  /** Slot name shown in game: Frame, Barrel, Cycler, … */
  name: string | null
  material: string | null
  kind: string | null
  min_quality: number | null
  modifiers: StatModifier[]
}

/** property_key → multiplier applied to the default value. */
export type StatFactors = Record<string, number>

/** property_key → [worst, best] multiplier crafting can reach. */
export type StatRanges = Record<string, { min_percent: number; max_percent: number }>

const lerp = (qMin: number, qMax: number, vMin: number, vMax: number, q: number): number => {
  if (qMax <= qMin) return vMax
  const t = Math.max(0, Math.min(1, (q - qMin) / (qMax - qMin)))
  return vMin + (vMax - vMin) * t
}

/**
 * The multiplier one modifier applies at a material quality, or null when the
 * game data does not say (power pips step in integers the wiki API does not
 * expose).
 */
export function multiplierAt(mod: StatModifier, quality: number | null): number | null {
  if (quality === null || mod.value_range_type === 'linear_integer_additive') return null

  const segments = mod.value_segments
  if (segments && segments.length > 0) {
    if (quality <= segments[0].quality_min) return segments[0].modifier_at_start
    for (const s of segments) {
      if (quality <= s.quality_max) {
        return lerp(s.quality_min, s.quality_max, s.modifier_at_start, s.modifier_at_end, quality)
      }
    }
    return segments[segments.length - 1].modifier_at_end
  }

  const { at_min_quality: lo, at_max_quality: hi } = mod.modifier_range
  if (lo === null || hi === null) return null
  return lerp(mod.quality_range.min ?? 0, mod.quality_range.max ?? 1000, lo, hi, quality)
}

/**
 * property_key → multiplier, for material qualities keyed by material name
 * (case-insensitive). Slots whose material has no quality yet contribute ×1.
 */
export function statFactors(groups: RequirementGroup[], qualityByMaterial: Record<string, number>): StatFactors {
  const lookup: Record<string, number> = {}
  for (const [name, q] of Object.entries(qualityByMaterial)) lookup[name.toLowerCase()] = q

  const factors: StatFactors = {}
  for (const group of groups) {
    const quality = lookup[(group.material ?? '').toLowerCase()]
    for (const mod of group.modifiers ?? []) {
      const f = multiplierAt(mod, quality === undefined ? null : Math.round(quality))
      if (f === null) continue
      factors[mod.property_key] = (factors[mod.property_key] ?? 1) * f
    }
  }
  return factors
}

/** Product of the factors for the properties a stat scales with. */
export function factorFor(factors: StatFactors | null, keys: string[] | undefined): number | null {
  if (!factors || !keys || keys.length === 0) return null
  let product = 1
  let touched = false
  for (const key of keys) {
    const f = factors[key]
    if (f === undefined) continue
    product *= f
    touched = true
  }
  return touched ? product : null
}

/** Worst/best percent span for the properties a stat scales with. */
export function rangeFor(ranges: StatRanges | null, keys: string[] | undefined): [number, number] | null {
  if (!ranges || !keys || keys.length === 0) return null
  let lo = 1
  let hi = 1
  let touched = false
  for (const key of keys) {
    const r = ranges[key]
    if (!r) continue
    lo *= 1 + r.min_percent / 100
    hi *= 1 + r.max_percent / 100
    touched = true
  }
  return touched ? [(lo - 1) * 100, (hi - 1) * 100] : null
}
