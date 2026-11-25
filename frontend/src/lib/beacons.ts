import type { Beacon } from './types'

/** What an export file says it is; the import endpoint checks the same. */
export const BEACON_FILE_FORMAT = 'starbuddy-beacons'
export const BEACON_FILE_VERSION = 1

/** A shard as people can tell them apart: the last four digits. */
export function shortShard(shard: string): string {
  const digits = /(\d+)$/.exec(shard)?.[1]
  return digits ? `…${digits.slice(-4)}` : shard
}

/**
 * The body a beacon's frame is: the planet or moon name for a planet frame
 * (OOC_Stanton_3_ArcCorp is ArcCorp), null for space (the SolarSystem frame).
 */
export function beaconBody(frame: string): string | null {
  if (frame.startsWith('SolarSystem')) return null
  const parts = frame.replace(/^OOC_/, '').split('_')
  return parts.length >= 3 ? parts.slice(2).join(' ') : parts.join(' ')
}

/** The export file for some beacons, as other players import it. */
export function beaconFile(beacons: Beacon[]) {
  return {
    format: BEACON_FILE_FORMAT,
    version: BEACON_FILE_VERSION,
    beacons: beacons.map(({ name, shard, frame, pos, system, location, server, set_at }) => ({
      name,
      shard,
      frame,
      pos,
      system,
      location,
      server,
      set_at,
    })),
  }
}
