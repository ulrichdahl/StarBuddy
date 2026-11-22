import { useQuery } from '@tanstack/react-query'
import { api } from './api'

/** A paired desktop client, from GET /api/devices (one Sanctum token each). */
export interface Device {
  id: number
  name: string
  last_used_at: string | null
  created_at: string
}

/** A client that has not synced in this long is shown as stale. */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export type DeviceState = 'active' | 'stale' | 'never'

export function deviceState(device: Device, now = Date.now()): DeviceState {
  if (!device.last_used_at) return 'never'
  return now - new Date(device.last_used_at).getTime() > STALE_AFTER_MS ? 'stale' : 'active'
}

/** The device that synced most recently, if any has. */
export function latestSync(devices: Device[] | undefined): Device | undefined {
  return (devices ?? [])
    .filter((d) => d.last_used_at)
    .sort((a, b) => (b.last_used_at ?? '').localeCompare(a.last_used_at ?? ''))[0]
}

/** A client counts as connected once it has synced within the stale window. */
export function hasConnectedClient(devices: Device[] | undefined, now = Date.now()): boolean {
  return (devices ?? []).some((d) => deviceState(d, now) === 'active')
}

/** `poll`: ask again every few seconds, while a pairing code waits to be used. */
export function useDevices({ poll = false }: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await api.get<Device[]>('/api/devices')).data,
    refetchInterval: poll ? 4000 : false,
  })
}
