import { useSearchParams } from 'react-router-dom'

/**
 * A page's view switch, kept in the URL as ?view=, so a view can be linked
 * to (the desktop client opens Materials straight on the org view with
 * /resources?view=org). An unknown or missing value is the default.
 */
export function useViewParam<T extends string>(allowed: readonly T[], fallback: T): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get('view')
  const view = (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback
  const setView = (next: T) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === fallback) p.delete('view')
        else p.set('view', next)
        return p
      },
      { replace: true },
    )
  return [view, setView]
}
