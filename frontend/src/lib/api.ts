import axios, { isAxiosError, type InternalAxiosRequestConfig } from 'axios'

/**
 * Same-origin axios instance for the Laravel Sanctum SPA cookie flow.
 *
 * - `withCredentials` sends the session + XSRF cookies on every request.
 * - `withXSRFToken` makes axios copy the `XSRF-TOKEN` cookie into the
 *   `X-XSRF-TOKEN` header, which Sanctum verifies on mutating requests.
 * - `baseURL: '/'` because Caddy serves the SPA and proxies /api, /sanctum
 *   and /auth to the backend — the app never needs an absolute host.
 */
export const api = axios.create({
  baseURL: '/',
  withCredentials: true,
  withXSRFToken: true,
  headers: { Accept: 'application/json' },
})

const SAFE_METHODS = new Set(['get', 'head', 'options'])

let csrfBootstrap: Promise<unknown> | null = null

/**
 * Fetch Sanctum's CSRF cookie once per page load, before the first
 * mutating request. Subsequent calls await the same in-flight promise.
 */
export function ensureCsrfCookie(): Promise<unknown> {
  csrfBootstrap ??= axios.get('/sanctum/csrf-cookie', { withCredentials: true })
  return csrfBootstrap
}

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const method = (config.method ?? 'get').toLowerCase()
  if (!SAFE_METHODS.has(method)) {
    await ensureCsrfCookie()
  }
  return config
})

/**
 * Laravel list endpoints may return either a bare array or a paginator
 * envelope ({ data: [...] }). Normalize both to a plain array.
 */
export function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object' && 'data' in payload) {
    const inner = (payload as { data: unknown }).data
    if (Array.isArray(inner)) return inner as T[]
  }
  return []
}

/**
 * Short, user-showable detail for a failed request — "403 Forbidden" plus
 * Laravel's `message` when it sent one — so an error alert says what went
 * wrong instead of only that something did. Undefined when there is nothing
 * more specific than the generic text.
 */
export function apiErrorDetail(error: unknown): string | undefined {
  if (!isAxiosError(error)) return error instanceof Error ? error.message : undefined
  const status = error.response ? `${error.response.status} ${error.response.statusText}`.trim() : error.message
  const message = (error.response?.data as { message?: string } | undefined)?.message
  return message ? `${status}: ${message}` : status
}
