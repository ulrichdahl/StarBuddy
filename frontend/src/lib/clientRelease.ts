import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export type DownloadKey = 'windows' | 'windows_msi' | 'appimage' | 'deb' | 'rpm'

/** The latest desktop client release, from GET /api/client/latest. */
export interface ClientRelease {
  /** null when GitHub could not be asked: then only `page` works. */
  version: string | null
  published_at: string | null
  downloads: Record<DownloadKey, string | null>
  /** The release page on GitHub, always set. */
  page: string
}

export function useClientRelease() {
  return useQuery({
    queryKey: ['client-release'],
    queryFn: async () => (await api.get<ClientRelease>('/api/client/latest')).data,
    staleTime: 15 * 60 * 1000,
  })
}

/** Where the visitor is reading from, for the download that suits them. */
export type VisitorPlatform = 'windows' | 'linux' | 'mac' | 'mobile' | 'unknown'

export function detectPlatform(nav: Navigator = navigator): VisitorPlatform {
  const hints = (nav as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData
  const ua = nav.userAgent.toLowerCase()
  // Android says "Linux" too, so phones first.
  if (hints?.mobile || /android|iphone|ipad|ipod|mobile/.test(ua)) return 'mobile'
  const platform = `${hints?.platform ?? ''} ${nav.platform ?? ''} ${ua}`.toLowerCase()
  if (platform.includes('win')) return 'windows'
  if (platform.includes('mac')) return 'mac'
  if (platform.includes('linux') || platform.includes('x11')) return 'linux'
  return 'unknown'
}

/** The best Linux package for the visitor's distribution, when the browser tells it. */
export function linuxPackage(nav: Navigator = navigator): DownloadKey {
  const ua = nav.userAgent.toLowerCase()
  if (/fedora|red hat|suse|centos/.test(ua)) return 'rpm'
  if (/ubuntu|debian|mint/.test(ua)) return 'deb'
  return 'appimage'
}
