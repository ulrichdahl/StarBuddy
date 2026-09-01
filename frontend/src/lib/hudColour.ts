/**
 * Turning a sampled pixel into a HUD colour bucket.
 *
 * The named bucket is what the model's classification head is trained against,
 * but a contributor should not have to judge whether a panel is "amber" or
 * "white" by eye. They click the brightest part of the HUD and this derives the
 * name, with the hex kept alongside it as the objective record.
 */

export interface SampledColour {
  hex: string
  /** The closest named bucket; the contributor can still override it. */
  bucket: string
}

/** Straight RGB -> HSL, hue in degrees. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const lightness = (max + min) / 2
  const delta = max - min

  if (delta === 0) return [0, 0, lightness]

  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  let hue: number
  if (max === rn) hue = ((gn - bn) / delta) % 6
  else if (max === gn) hue = (bn - rn) / delta + 2
  else hue = (rn - gn) / delta + 4

  return [((hue * 60) + 360) % 360, saturation, lightness]
}

export function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

/**
 * Which bucket a sampled colour falls in.
 *
 * Hue boundaries follow the HUD palettes the game actually uses: the amber
 * kiosks sit around 30-40°, the fabricator's teal around 175°, and a washed-out
 * panel reads as near-grey, which is 'white' rather than a hue at all.
 */
export function bucketFor(r: number, g: number, b: number): string {
  const [hue, saturation, lightness] = rgbToHsl(r, g, b)

  if (lightness < 0.08) return 'unknown' // sampled the unlit bezel, not the HUD
  if (saturation < 0.18) return 'white'

  if (hue < 15 || hue >= 330) return 'mixed' // red-ish: not a HUD colour on its own
  if (hue < 55) return 'amber'
  if (hue < 75) return 'mixed' // yellow-green, between two buckets
  if (hue < 160) return 'green'
  if (hue < 200) return 'teal'
  if (hue < 265) return 'blue'
  return 'mixed'
}

export function sampleToColour(r: number, g: number, b: number): SampledColour {
  return { hex: toHex(r, g, b), bucket: bucketFor(r, g, b) }
}
