/**
 * What a refinery terminal offers, and how its numbers are written down.
 */

/**
 * The nine refining processes, as the terminal names them.
 *
 * Only the names are listed. The game pairs each name with a
 * "speed // cost // yield" line, but in 4.10 that line comes from a different
 * record than the name above it — a capture showed "Pyrometric Chromalysis"
 * over Dinyx Solventation's traits — so repeating those traits here would
 * teach players something the game itself has wrong.
 */
export const REFINING_METHODS = [
  'Cormack Method',
  'Dinyx Solventation',
  'Electrostarolysis',
  'Ferron Exchange',
  'Gaskin Process',
  'Kazen Winnowing',
  'Pyrometric Chromalysis',
  'Thermonatic Deposition',
  'XCR Reaction',
]

/**
 * Seconds as the terminal writes them: "22m 28s", "2h 5m", "3d 4h".
 *
 * A long job drops its seconds — nobody reads a two-day countdown to the
 * second — and a job under a minute is only seconds.
 *
 * `exact` keeps every part, and is what filling an editable field has to use:
 * the coarse spelling cannot be read back without losing the seconds it left
 * out, so an order opened and saved untouched would quietly lose them.
 */
export function formatDuration(
  seconds: number | null | undefined,
  ready?: string,
  { exact = false }: { exact?: boolean } = {},
): string {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds <= 0) return ready ?? '0s'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const showSeconds = s > 0 && (exact || (!d && !h))
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, showSeconds && `${s}s`].filter(Boolean).join(' ') || '0s'
}

/**
 * The same spelling, read back: "22m 28s", "1h30m", "90" (minutes assumed).
 *
 * A bare number is minutes because that is how a refinery job is spoken about,
 * and because the terminal's own figure is minutes and seconds. Anything that
 * parses to nothing is null rather than zero — an unknown duration and an
 * instant one are not the same thing.
 */
export function parseDuration(text: string): number | null {
  const trimmed = text.trim().toLowerCase()
  if (trimmed === '') return null
  if (/^\d+([.,]\d+)?$/.test(trimmed)) return Math.round(Number(trimmed.replace(',', '.')) * 60)

  const units: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 }
  let total = 0
  let matched = false
  for (const [, value, unit] of trimmed.matchAll(/(\d+(?:[.,]\d+)?)\s*([dhms])/g)) {
    total += Number(value.replace(',', '.')) * units[unit]
    matched = true
  }
  return matched ? Math.round(total) : null
}
