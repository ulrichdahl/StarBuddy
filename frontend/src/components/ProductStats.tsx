import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { factorFor, rangeFor, type RequirementGroup, type StatFactors, type StatRanges } from '../lib/craftModifiers'

/**
 * scdmb-style product stats panel: base value per stat, and — when the craft
 * plan is known — the crafted value.
 *
 * Every scaling stat names the game properties it hangs off (`scales`), and
 * the recipe's slots say how far each of those properties moves with the
 * quality of the material in that slot; see `lib/craftModifiers`. A stat no
 * slot touches shows no modified value, however good the materials are.
 */

// Loosely typed: the shape comes straight from the wiki API blocks cached
// in blueprint.item_meta.stats (see CraftabilityController::STAT_BLOCKS).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = Record<string, any>

interface StatRow {
  label: string
  /** The default value, or '—' for a property with no published base. */
  value: string
  /** Set for stats a recipe slot can modify (numeric base required). */
  base?: number
  /** Game properties this stat scales with, multiplied together. */
  scales?: string[]
  /** Which direction is an improvement, for the percentage's colour. */
  betterWhen?: 'higher' | 'lower'
  format?: (n: number) => string
}

interface Section {
  title?: string
  rows: StatRow[]
}

/** Translation + locale-aware number formatting, threaded through the builders. */
interface Fmt {
  t: TFunction
  num: (n: number, digits?: number) => string
}

const makeNum =
  (locale: string) =>
  (n: number, digits = 1) =>
    n.toLocaleString(locale, { maximumFractionDigits: digits })

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// API keys turned into labels — game data, shown as-is.
const prettify = (key: string) => key.split('_').map(cap).join(' ')

function weaponSections(w: Block, { t, num }: Fmt): Section[] {
  const alpha: Block = w.damage?.alpha ?? {}
  const damageRows: StatRow[] = Object.entries(alpha)
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .map(([type, v]) => ({
      label: t('stats.damagePerShot', { type: cap(type) }),
      value: num(v as number),
      base: v as number,
      scales: ['weapon_damage'],
      format: (n) => num(n),
    }))

  const staticRows: StatRow[] = []
  if (w.spread?.min != null && w.spread?.max != null) {
    staticRows.push({
      label: t('stats.spread'),
      value: w.spread.min === w.spread.max ? `${num(w.spread.min, 2)}°` : `${num(w.spread.min, 2)}–${num(w.spread.max, 2)}°`,
    })
  }
  if (w.ammunition?.speed) {
    staticRows.push({ label: t('stats.ammoSpeed'), value: `${num(w.ammunition.speed, 0)} m/s` })
  }

  const modes: Block[] = Array.isArray(w.modes) && w.modes.length > 0 ? w.modes : [{}]
  // Mining lasers come from the wiki with an unlocalised "<= PLACEHOLDER =>"
  // mode name: the first mode is the laser's power, the second its
  // extraction power.
  const modeTitle = (m: Block, i: number): string => {
    const localised: string | undefined = m.localised
    if (localised && !/PLACEHOLDER/i.test(localised)) return `${localised.replace(/[[\]]/g, '')}${m.type ? ` (${m.type})` : ''}`
    if (m.type === 'beam' || m.type === 'collectionbeam') return t(i === 0 ? 'stats.laserPower' : 'stats.extractionPower')
    return `${m.mode || t('stats.fire')}${m.type ? ` (${m.type})` : ''}`
  }
  return modes.map((m: Block, i: number) => ({
    title: modes.length > 1 || m.mode || m.type ? modeTitle(m, i) : undefined,
    rows: [
      ...((m.rpm ?? w.rpm)
        ? [
            {
              label: t('stats.fireRate'),
              value: `${num(m.rpm ?? w.rpm, 0)} RPM`,
              base: m.rpm ?? w.rpm,
              scales: ['weapon_firerate'],
              format: (n: number) => `${num(n, 0)} RPM`,
            },
          ]
        : []),
      ...damageRows,
      ...((m.damage_per_second ?? w.damage?.dps_total)
        ? [
            {
              label: t(m.type === 'beam' || m.type === 'collectionbeam' ? 'stats.power' : 'stats.dps'),
              value: num(m.damage_per_second ?? w.damage.dps_total),
              base: m.damage_per_second ?? w.damage.dps_total,
              // Shots per minute times damage per shot.
              scales: ['weapon_damage', 'weapon_firerate'],
              format: (n: number) => num(n),
            },
          ]
        : []),
      // Spread and ammo belong to the weapon, not the mode — show once.
      ...(i === 0 ? staticRows : []),
    ],
  }))
}

function clothingSections(c: Block, { t, num }: Fmt): Section[] {
  const map: Block = c.damage_resistance_map ?? {}
  const rows: StatRow[] = Object.entries(map)
    .filter(([k, v]) => !k.endsWith('_change') && typeof v === 'number')
    .map(([type, mult]) => {
      const reduction = (1 - (mult as number)) * 100
      return {
        label: t('stats.resistance', { type: cap(type) }),
        value: `−${num(reduction)}%`,
        base: reduction,
        scales: ['armor_damagemitigation'],
        format: (n: number) => `−${num(n)}%`,
      }
    })
    .filter((r) => (r.base ?? 0) > 0)

  // Min and max temperature come from different slots, so they are their own rows.
  if (c.temp_resistance_min != null) {
    rows.push({
      label: t('stats.tempResistanceMin'),
      value: `${num(c.temp_resistance_min, 0)} °C`,
      base: c.temp_resistance_min,
      scales: ['armor_temperaturemin'],
      betterWhen: 'lower',
      format: (n: number) => `${num(n, 0)} °C`,
    })
  }
  if (c.temp_resistance_max != null) {
    rows.push({
      label: t('stats.tempResistanceMax'),
      value: `${num(c.temp_resistance_max, 0)} °C`,
      base: c.temp_resistance_max,
      scales: ['armor_temperaturemax'],
      format: (n: number) => `${num(n, 0)} °C`,
    })
  }
  if (c.radiation_resistance?.radiation_dissipation_rate) {
    rows.push({
      label: t('stats.radiationDissipation'),
      value: `${num(c.radiation_resistance.radiation_dissipation_rate, 0)} /s`,
      base: c.radiation_resistance.radiation_dissipation_rate,
      scales: ['armor_radiationdissipation'],
      format: (n: number) => `${num(n, 0)} /s`,
    })
  }
  return rows.length ? [{ rows }] : []
}

function shieldSections(s: Block, { t, num }: Fmt): Section[] {
  const rows: StatRow[] = []
  if (s.max_shield_health) {
    rows.push({
      label: t('stats.shieldHp'),
      value: num(s.max_shield_health, 0),
      base: s.max_shield_health,
      format: (n) => num(n, 0),
    })
  }
  if (s.max_shield_regen) {
    rows.push({
      label: t('stats.regenRate'),
      value: `${num(s.max_shield_regen, 0)} /s`,
      base: s.max_shield_regen,
      format: (n) => `${num(n, 0)} /s`,
    })
  }
  if (s.regen_delay?.damage != null) rows.push({ label: t('stats.regenDelay'), value: `${num(s.regen_delay.damage)}s` })
  if (s.regen_delay?.downed != null) {
    rows.push({ label: t('stats.regenDelayDown'), value: `${num(s.regen_delay.downed)}s` })
  }
  const phys = s.absorption?.physical
  if (phys && (phys.min != null || phys.max != null)) {
    rows.push({
      label: t('stats.physicalAbsorption'),
      value: `${num((phys.min ?? 0) * 100, 0)}–${num((phys.max ?? 0) * 100, 0)}%`,
    })
  }
  return rows.length ? [{ rows }] : []
}

function quantumSections(q: Block, { t, num }: Fmt): Section[] {
  const jump: Block = Array.isArray(q.modes)
    ? (q.modes.find((m: Block) => m.type === 'normal_jump') ?? q.modes[0] ?? {})
    : {}
  const rows: StatRow[] = []
  // Drive speed is metres per second in the data; Mm/s is how the game shows it.
  const mmPerSecond = (n: number) => `${num(n / 1_000_000, 1)} Mm/s`
  if (jump.drive_speed != null) {
    rows.push({
      label: t('stats.driveSpeed'),
      value: mmPerSecond(jump.drive_speed),
      base: jump.drive_speed,
      scales: ['quantum_speed'],
      format: mmPerSecond,
    })
  } else if (jump.drive_speed_formatted) {
    rows.push({ label: t('stats.driveSpeed'), value: jump.drive_speed_formatted })
  }
  if (q.travel_time_10gm?.formatted) rows.push({ label: t('stats.travelTime10Gm'), value: q.travel_time_10gm.formatted })
  if (q.fuel_consumption_scu_per_gm != null) {
    rows.push({
      label: t('stats.fuelPerGm'),
      value: `${num(q.fuel_consumption_scu_per_gm, 3)} SCU`,
      base: q.fuel_consumption_scu_per_gm,
      scales: ['quantum_fuelrequirement'],
      betterWhen: 'lower',
      format: (n: number) => `${num(n, 3)} SCU`,
    })
  }
  if (q.fuel_efficiency != null) {
    rows.push({
      label: t('stats.fuelEfficiency'),
      value: num(q.fuel_efficiency, 2),
      base: q.fuel_efficiency,
      format: (n) => num(n, 2),
    })
  }
  if (jump.spool_up_time != null) rows.push({ label: t('stats.spoolUp'), value: `${num(jump.spool_up_time)}s` })
  if (jump.cooldown_time != null) rows.push({ label: t('stats.cooldown'), value: `${num(jump.cooldown_time)}s` })
  if (q.disconnect_range_formatted) rows.push({ label: t('stats.disconnectRange'), value: q.disconnect_range_formatted })
  return rows.length ? [{ rows }] : []
}

// Fallback for blocks without a dedicated layout: every scalar becomes a
// row, quality-modified stats unknown so base only.
function genericSections(name: string, b: Block, { num }: Fmt): Section[] {
  const rows: StatRow[] = Object.entries(b)
    .filter(([k, v]) => (typeof v === 'number' || typeof v === 'string') && !/uuid|link|_url/.test(k))
    .map(([k, v]) => ({ label: prettify(k), value: typeof v === 'number' ? num(v, 2) : String(v) }))
  return rows.length ? [{ title: prettify(name), rows }] : []
}

/**
 * Properties the recipe modifies that no stat above carries a base value for
 * — recoil, tractor force, power pips. The wiki's item data has no figures
 * for them, so they appear as the multiplier alone: without them a rifle's
 * frame and stock materials look inert when in fact they are all recoil.
 */
function modifierOnlySection(groups: RequirementGroup[], sections: Section[], { t }: Fmt): Section | null {
  const covered = new Set(sections.flatMap((s) => s.rows.flatMap((r) => r.scales ?? [])))
  const rows: StatRow[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const mod of group.modifiers ?? []) {
      if (covered.has(mod.property_key) || seen.has(mod.property_key)) continue
      seen.add(mod.property_key)
      rows.push({
        label: mod.label,
        value: '—',
        scales: [mod.property_key],
        betterWhen: mod.better_when === 'lower' ? 'lower' : 'higher',
      })
    }
  }
  return rows.length > 0 ? { title: t('stats.modifierOnly'), rows } : null
}

function sectionsFor(stats: Block, f: Fmt): Section[] {
  const { t, num } = f
  const out: Section[] = []
  const handled = new Set([
    'personal_weapon', 'vehicle_weapon', 'clothing', 'shield', 'power_plant',
    'cooler', 'quantum_drive', 'temperature_resistance', 'radiation_resistance',
    'inventory', 'durability',
  ])
  if (stats.personal_weapon) out.push(...weaponSections(stats.personal_weapon, f))
  if (stats.vehicle_weapon) out.push(...weaponSections(stats.vehicle_weapon, f))
  if (stats.clothing) out.push(...clothingSections(stats.clothing, f))
  if (stats.shield) out.push(...shieldSections(stats.shield, f))
  if (stats.power_plant?.power_segment_generation) {
    out.push({
      rows: [
        {
          label: t('stats.powerSegments'),
          value: num(stats.power_plant.power_segment_generation, 0),
          base: stats.power_plant.power_segment_generation,
          // Steps in whole pips the wiki API does not spell out — no factor,
          // so this shows its default only.
          scales: ['itemresource_powergeneration'],
          format: (n: number) => num(n),
        },
      ],
    })
  }
  if (stats.cooler?.coolant_segment_generation) {
    out.push({
      rows: [
        {
          label: t('stats.coolantSegments'),
          value: num(stats.cooler.coolant_segment_generation, 0),
          base: stats.cooler.coolant_segment_generation,
          scales: ['itemresource_coolantgeneration'],
          format: (n: number) => num(n),
        },
      ],
    })
  }
  if (stats.quantum_drive) out.push(...quantumSections(stats.quantum_drive, f))
  if (stats.durability?.health) {
    out.push({
      rows: [
        {
          label: t('stats.integrity'),
          value: num(stats.durability.health, 0),
          base: stats.durability.health,
          scales: ['health_maxhealth'],
          format: (n: number) => num(n, 0),
        },
      ],
    })
  }
  for (const [name, block] of Object.entries(stats)) {
    if (!handled.has(name) && block && typeof block === 'object') {
      out.push(...genericSections(name, block, f))
    }
  }
  return out
}

function quickFacts(stats: Block, mass: number | undefined, { t, num }: Fmt): string[] {
  const facts: string[] = []
  if (mass) facts.push(`${num(mass, 1)} kg`)
  const w: Block | undefined = stats.personal_weapon ?? stats.vehicle_weapon
  if (w) {
    const range = w.effective_range ?? w.range
    if (range) facts.push(t('stats.range', { value: num(range, 0) }))
    const mag = w.magazine_size ?? w.capacity
    if (mag) facts.push(t('stats.magazine', { value: num(mag, 0) }))
  }
  if (stats.inventory?.scu_converted) {
    facts.push(
      t('stats.carry', { value: num(stats.inventory.scu_converted, 0), unit: stats.inventory.unit ?? 'µSCU' }),
    )
  }
  return facts
}

export function ProductStats({
  stats,
  mass,
  factors,
  ranges = null,
  groups = [],
}: {
  stats: Block
  mass?: number
  /** The crafted item's multipliers per game property, or null when no plan is known. */
  factors: StatFactors | null
  /** Without a plan: how far crafting can move each property, worst to best material. */
  ranges?: StatRanges | null
  /** The recipe's slots, for the properties no stat block covers. */
  groups?: RequirementGroup[]
}) {
  const { t, i18n } = useTranslation()
  const fmt: Fmt = { t, num: makeNum(i18n.language) }
  const sections = sectionsFor(stats, fmt)
  const extra = modifierOnlySection(groups, sections, fmt)
  if (extra) sections.push(extra)
  if (sections.length === 0) return null
  const facts = quickFacts(stats, mass, fmt)

  return (
    <Box>
      <Typography
        variant="subtitle2"
        sx={{ mb: 1, color: 'primary.main', letterSpacing: '0.08em', textTransform: 'uppercase' }}
      >
        {t('stats.heading')}
      </Typography>
      {facts.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
          {facts.map((f) => (
            <Chip key={f} size="small" label={f} variant="outlined" />
          ))}
        </Stack>
      )}
      {(ranges || factors) && (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, pb: 0.5, mb: 0.5, borderBottom: 2, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            {t('stats.colStat')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            {t('stats.colDefault')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ width: 130, textAlign: 'right', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            {t(factors ? 'stats.colCrafted' : 'stats.colCraftable')}
          </Typography>
        </Box>
      )}
      {sections.map((section, si) => (
        <Box key={si} sx={{ mb: 1.5 }}>
          {section.title && (
            <Typography variant="caption" sx={{ color: 'secondary.main', fontWeight: 600 }}>
              {section.title}
            </Typography>
          )}
          {section.rows.map((row) => {
            const format = row.format ?? ((n: number) => fmt.num(n))
            const factor = factorFor(factors, row.scales)
            const percent = factor !== null ? (factor - 1) * 100 : null
            // With a base value the crafted figure is shown; without one — the
            // wiki publishes no recoil or tractor numbers — the multiplier is.
            const modified =
              factor === null ? null : row.base !== undefined ? format(row.base * factor) : `×${fmt.num(factor, 3)}`
            const span = rangeFor(ranges, row.scales)
            const spanText = factors
              ? null
              : span === null
                ? null
                : row.base !== undefined
                  ? `${format(row.base * (1 + span[0] / 100))} – ${format(row.base * (1 + span[1] / 100))}`
                  : `${fmt.num(span[0], 1)}% … ${span[1] >= 0 ? '+' : ''}${fmt.num(span[1], 1)}%`
            // Green when the change helps, red when it hurts; recoil and fuel
            // burn improve by going down.
            const better = row.betterWhen === 'lower' ? (percent ?? 0) < 0 : (percent ?? 0) > 0
            const colour = percent === null || Math.abs(percent) < 0.005 ? 'text.primary' : better ? 'success.main' : 'error.main'
            return (
              <Box
                key={row.label}
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 2,
                  py: 0.4,
                  borderBottom: 1,
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 0 },
                }}
              >
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                  {row.label}
                </Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {row.value}
                </Typography>
                <Box sx={{ width: 130, textAlign: 'right', flexShrink: 0 }}>
                  {modified !== null ? (
                    <Typography variant="body2" component="span" sx={{ color: colour, fontVariantNumeric: 'tabular-nums' }}>
                      {modified}
                      <Typography component="span" variant="caption" sx={{ ml: 0.75, color: colour }}>
                        {percent! >= 0 ? '+' : ''}
                        {percent!.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                      </Typography>
                    </Typography>
                  ) : spanText !== null ? (
                    <Typography variant="body2" component="span" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {spanText}
                    </Typography>
                  ) : (
                    <Typography variant="body2" component="span" color="text.disabled">
                      —
                    </Typography>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>
      ))}
      {factors && (
        <Typography variant="caption" color="text.secondary">
          {t('stats.modifiedNote')}
        </Typography>
      )}
      {!factors && ranges && (
        <Typography variant="caption" color="text.secondary">
          {t('stats.rangeNote')}
        </Typography>
      )}
    </Box>
  )
}
