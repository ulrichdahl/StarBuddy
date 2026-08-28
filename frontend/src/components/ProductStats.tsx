import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

/**
 * scdmb-style product stats panel: base value per stat, and — when a craft
 * quality estimate exists — the modified value with the percentage applied
 * to the stats that scale with quality (damage, DPS, resistances, …).
 */

// Loosely typed: the shape comes straight from the wiki API blocks cached
// in blueprint.item_meta.stats (see CraftabilityController::STAT_BLOCKS).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = Record<string, any>

interface StatRow {
  label: string
  value: string
  /** Set for stats that scale with craft quality (numeric base required). */
  base?: number
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
      ...((m.rpm ?? w.rpm) ? [{ label: t('stats.fireRate'), value: `${num(m.rpm ?? w.rpm, 0)} RPM` }] : []),
      ...damageRows,
      ...((m.damage_per_second ?? w.damage?.dps_total)
        ? [
            {
              label: t(m.type === 'beam' || m.type === 'collectionbeam' ? 'stats.power' : 'stats.dps'),
              value: num(m.damage_per_second ?? w.damage.dps_total),
              base: m.damage_per_second ?? w.damage.dps_total,
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
        format: (n: number) => `−${num(n)}%`,
      }
    })
    .filter((r) => (r.base ?? 0) > 0)

  if (c.temp_resistance_min != null && c.temp_resistance_max != null) {
    rows.push({
      label: t('stats.tempResistance'),
      value: `${num(c.temp_resistance_min, 0)} … ${num(c.temp_resistance_max, 0)} °C`,
    })
  }
  if (c.radiation_resistance?.radiation_dissipation_rate) {
    rows.push({
      label: t('stats.radiationDissipation'),
      value: `${num(c.radiation_resistance.radiation_dissipation_rate, 0)} /s`,
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
  if (jump.drive_speed_formatted) rows.push({ label: t('stats.driveSpeed'), value: jump.drive_speed_formatted })
  if (q.travel_time_10gm?.formatted) rows.push({ label: t('stats.travelTime10Gm'), value: q.travel_time_10gm.formatted })
  if (q.fuel_consumption_scu_per_gm != null) {
    rows.push({ label: t('stats.fuelPerGm'), value: `${num(q.fuel_consumption_scu_per_gm, 3)} SCU` })
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
          format: (n: number) => num(n),
        },
      ],
    })
  }
  if (stats.quantum_drive) out.push(...quantumSections(stats.quantum_drive, f))
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
  if (stats.durability?.health) facts.push(`${num(stats.durability.health, 0)} HP`)
  return facts
}

export function ProductStats({
  stats,
  mass,
  modifierPercent,
  rangePercent = null,
}: {
  stats: Block
  mass?: number
  modifierPercent: number | null
  /** Without a quality estimate: the span crafting can move quality-scaling stats across (min%, max%). */
  rangePercent?: [number, number] | null
}) {
  const { t, i18n } = useTranslation()
  const fmt: Fmt = { t, num: makeNum(i18n.language) }
  const sections = sectionsFor(stats, fmt)
  if (sections.length === 0) return null
  const facts = quickFacts(stats, mass, fmt)
  const mod = modifierPercent

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
      {(rangePercent || mod !== null) && (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, pb: 0.5, mb: 0.5, borderBottom: 2, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            {t('stats.colStat')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            {t('stats.colDefault')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ width: 130, textAlign: 'right', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            {t(mod !== null ? 'stats.colCrafted' : 'stats.colCraftable')}
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
            const modified = mod !== null && row.base !== undefined ? format(row.base * (1 + mod / 100)) : null
            const span =
              mod === null && rangePercent && row.base !== undefined
                ? `${format(row.base * (1 + rangePercent[0] / 100))} – ${format(row.base * (1 + rangePercent[1] / 100))}`
                : null
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
                    <Typography
                      variant="body2"
                      component="span"
                      sx={{ color: 'success.main', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {modified}
                      <Typography component="span" variant="caption" sx={{ ml: 0.75, color: 'success.main' }}>
                        {mod! >= 0 ? '+' : ''}
                        {mod!.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                      </Typography>
                    </Typography>
                  ) : span !== null ? (
                    <Typography variant="body2" component="span" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {span}
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
      {mod !== null && (
        <Typography variant="caption" color="text.secondary">
          {t('stats.modifiedNote')}
        </Typography>
      )}
      {mod === null && rangePercent && (
        <Typography variant="caption" color="text.secondary">
          {t('stats.rangeNote', { min: rangePercent[0], max: rangePercent[1] })}
        </Typography>
      )}
    </Box>
  )
}
