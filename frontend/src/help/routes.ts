import data from './topics.json'

export const DEFAULT_TOPIC = 'getting-started'

/** The topic that explains the page at this path. Kept apart from the help text so the app loads without it. */
export function topicForPath(pathname: string): string {
  const routes = data.routes as Record<string, string>
  return routes[pathname] ?? routes[pathname.replace(/\/+$/, '') || '/'] ?? DEFAULT_TOPIC
}
