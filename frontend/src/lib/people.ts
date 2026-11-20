import type { Me, Org } from './types'

/** The name a member goes by: their Star Citizen handle, else Discord's. */
export function displayName(me: Pick<Me, 'handle' | 'discord_username'>): string {
  return me.handle ?? me.discord_username
}

/** Two letters for an avatar or tag: first letters of two words, else the first two. */
export function initials(name: string): string {
  const parts = name.split(/[\s_-]+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return letters.toUpperCase()
}

/** Short org tag: its Spectrum id when it has one, else its initials. */
export function orgTag(org: Pick<Org, 'name' | 'sid'>): string {
  return (org.sid ?? initials(org.name)).slice(0, 4).toUpperCase()
}
