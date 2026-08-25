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

const num = (n: number, digits = 1) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits })

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const prettify = (key: string) => key.split('_').map(cap).join(' ')

function weaponSections(w: Block): Section[] {
  const alpha: Block = w.damage?.alpha ?? {}
  const damageRows: StatRow[] = Object.entries(alpha)
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .map(([type, v]) => ({
      label: `${cap(type)} Damage / Shot`,
      value: num(v as number),
      base: v as number,
      format: (n) => num(n),
    }))

  const staticRows: StatRow[] = []
  if (w.spread?.min != null && w.spread?.max != null) {
    staticRows.push({
      label: 'Spread',
      value: w.spread.min === w.spread.max ? `${num(w.spread.min, 2)}°` : `${num(w.spread.min, 2)}–${num(w.spread.max, 2)}°`,
    })
  }
  if (w.ammunition?.speed) {
    staticRows.push({ label: 'Ammo Speed', value: `${num(w.ammunition.speed, 0)} m/s` })
  }

  const modes: Block[] = Array.isArray(w.modes) && w.modes.length > 0 ? w.modes : [{}]
  return modes.map((m: Block, i: number) => ({
    title:
      modes.length > 1 || m.mode
        ? `${m.localised?.replace(/[[\]]/g, '') || m.mode || 'Fire'}${m.type ? ` (${m.type})` : ''}`
        : undefined,
    rows: [
      ...((m.rpm ?? w.rpm) ? [{ label: 'Fire Rate', value: `${num(m.rpm ?? w.rpm, 0)} RPM` }] : []),
      ...damageRows,
      ...((m.damage_per_second ?? w.damage?.dps_total)
        ? [
            {
              label: 'DPS',
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

function clothingSections(c: Block): Section[] {
  const map: Block = c.damage_resistance_map ?? {}
  const rows: StatRow[] = Object.entries(map)
    .filter(([k, v]) => !k.endsWith('_change') && typeof v === 'number')
    .map(([type, mult]) => {
      const reduction = (1 - (mult as number)) * 100
      return {
        label: `${cap(type)} Resistance`,
        value: `−${num(reduction)}%`,
        base: reduction,
        format: (n: number) => `−${num(n)}%`,
      }
    })
    .filter((r) => (r.base ?? 0) > 0)

  if (c.temp_resistance_min != null && c.temp_resistance_max != null) {
    rows.push({ label: 'Temp Resistance', value: `${num(c.temp_resistance_min, 0)} … ${num(c.temp_resistance_max, 0)} °C` })
  }
  if (c.radiation_resistance?.radiation_dissipation_rate) {
    rows.push({ label: 'Radiation Dissipation', value: `${num(c.radiation_resistance.radiation_dissipation_rate, 0)} /s` })
  }
  return rows.length ? [{ rows }] : []
}

function shieldSections(s: Block): Section[] {
  const rows: StatRow[] = []
  if (s.max_shield_health) {
    rows.push({ label: 'Shield HP', value: num(s.max_shield_health, 0), base: s.max_shield_health, format: (n) => num(n, 0) })
  }
  if (s.max_shield_regen) {
    rows.push({ label: 'Regen Rate', value: `${num(s.max_shield_regen, 0)} /s`, base: s.max_shield_regen, format: (n) => `${num(n, 0)} /s` })
  }
  if (s.regen_delay?.damage != null) rows.push({ label: 'Regen Delay', value: `${num(s.regen_delay.damage)}s` })
  if (s.regen_delay?.downed != null) rows.push({ label: 'Regen Delay (down)', value: `${num(s.regen_delay.downed)}s` })
  const phys = s.absorption?.physical
  if (phys && (phys.min != null || phys.max != null)) {
    rows.push({ label: 'Physical Absorption', value: `${num((phys.min ?? 0) * 100, 0)}–${num((phys.max ?? 0) * 100, 0)}%` })
  }
  return rows.length ? [{ rows }] : []
}

function quantumSections(q: Block): Section[] {
  const jump: Block = Array.isArray(q.modes)
    ? (q.modes.find((m: Block) => m.type === 'normal_jump') ?? q.modes[0] ?? {})
    : {}
  const rows: StatRow[] = []
  if (jump.drive_speed_formatted) rows.push({ label: 'Drive Speed', value: jump.drive_speed_formatted })
  if (q.travel_time_10gm?.formatted) rows.push({ label: 'Travel Time (10 Gm)', value: q.travel_time_10gm.formatted })
  if (q.fuel_consumption_scu_per_gm != null) {
    rows.push({ label: 'Fuel / Gm', value: `${num(q.fuel_consumption_scu_per_gm, 3)} SCU` })
  }
  if (q.fuel_efficiency != null) {
    rows.push({ label: 'Fuel Efficiency', value: num(q.fuel_efficiency, 2), base: q.fuel_efficiency, format: (n) => num(n, 2) })
  }
  if (jump.spool_up_time != null) rows.push({ label: 'Spool Up', value: `${num(jump.spool_up_time)}s` })
  if (jump.cooldown_time != null) rows.push({ label: 'Cooldown', value: `${num(jump.cooldown_time)}s` })
  if (q.disconnect_range_formatted) rows.push({ label: 'Disconnect Range', value: q.disconnect_range_formatted })
  return rows.length ? [{ rows }] : []
}

// Fallback for blocks without a dedicated layout: every scalar becomes a
// row, quality-modified stats unknown so base only.
function genericSections(name: string, b: Block): Section[] {
  const rows: StatRow[] = Object.entries(b)
    .filter(([k, v]) => (typeof v === 'number' || typeof v === 'string') && !/uuid|link|_url/.test(k))
    .map(([k, v]) => ({ label: prettify(k), value: typeof v === 'number' ? num(v, 2) : String(v) }))
  return rows.length ? [{ title: prettify(name), rows }] : []
}

function sectionsFor(stats: Block): Section[] {
  const out: Section[] = []
  const handled = new Set([
    'personal_weapon', 'vehicle_weapon', 'clothing', 'shield', 'power_plant',
    'cooler', 'quantum_drive', 'temperature_resistance', 'radiation_resistance',
    'inventory', 'durability',
  ])
  if (stats.personal_weapon) out.push(...weaponSections(stats.personal_weapon))
  if (stats.vehicle_weapon) out.push(...weaponSections(stats.vehicle_weapon))
  if (stats.clothing) out.push(...clothingSections(stats.clothing))
  if (stats.shield) out.push(...shieldSections(stats.shield))
  if (stats.power_plant?.power_segment_generation) {
    out.push({
      rows: [
        {
          label: 'Power Segments',
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
          label: 'Coolant Segments',
          value: num(stats.cooler.coolant_segment_generation, 0),
          base: stats.cooler.coolant_segment_generation,
          format: (n: number) => num(n),
        },
      ],
    })
  }
  if (stats.quantum_drive) out.push(...quantumSections(stats.quantum_drive))
  for (const [name, block] of Object.entries(stats)) {
    if (!handled.has(name) && block && typeof block === 'object') {
      out.push(...genericSections(name, block))
    }
  }
  return out
}

function quickFacts(stats: Block, mass?: number): string[] {
  const facts: string[] = []
  if (mass) facts.push(`${num(mass, 1)} kg`)
  const w: Block | undefined = stats.personal_weapon ?? stats.vehicle_weapon
  if (w) {
    const range = w.effective_range ?? w.range
    if (range) facts.push(`Range ~${num(range, 0)} m`)
    const mag = w.magazine_size ?? w.capacity
    if (mag) facts.push(`Mag: ${num(mag, 0)}`)
  }
  if (stats.inventory?.scu_converted) {
    facts.push(`Carry: ${num(stats.inventory.scu_converted, 0)} ${stats.inventory.unit ?? 'µSCU'}`)
  }
  if (stats.durability?.health) facts.push(`${num(stats.durability.health, 0)} HP`)
  return facts
}

export function ProductStats({
  stats,
  mass,
  modifierPercent,
}: {
  stats: Block
  mass?: number
  modifierPercent: number | null
}) {
  const sections = sectionsFor(stats)
  if (sections.length === 0) return null
  const facts = quickFacts(stats, mass)
  const mod = modifierPercent

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, color: 'primary.main', letterSpacing: '0.08em' }}>
        PRODUCT STATS
      </Typography>
      {facts.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
          {facts.map((f) => (
            <Chip key={f} size="small" label={f} variant="outlined" />
          ))}
        </Stack>
      )}
      {sections.map((section, si) => (
        <Box key={si} sx={{ mb: 1.5 }}>
          {section.title && (
            <Typography variant="caption" sx={{ color: 'secondary.main', fontWeight: 600 }}>
              {section.title}
            </Typography>
          )}
          {section.rows.map((row) => {
            const modified =
              mod !== null && row.base !== undefined
                ? (row.format ?? ((n: number) => num(n)))(row.base * (1 + mod / 100))
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
                        {mod!.toFixed(2)}%
                      </Typography>
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
          Modified values estimate the crafted item at the selected material quality (community-measured
          ≈ ±1.5% per 100 quality; only quality-scaling stats are adjusted).
        </Typography>
      )}
    </Box>
  )
}
