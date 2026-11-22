import data from './topics.json'

/**
 * The help: one Markdown file per topic and language in content/<lang>/,
 * listed in topics.json with the page each one explains. The first line of a
 * file is its title (`# Title`). scripts/help-check.mjs fails the build when a
 * topic, a translation, a screenshot or a page's topic is missing.
 */
export type HelpGroup = 'start' | 'website' | 'client' | 'more'

export interface HelpTopic {
  id: string
  group: HelpGroup
}

export const HELP_TOPICS = data.topics as HelpTopic[]
export const HELP_GROUPS: HelpGroup[] = ['start', 'website', 'client', 'more']
export { DEFAULT_TOPIC, topicForPath } from './routes'

const files = import.meta.glob('./content/*/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export interface HelpDoc {
  id: string
  title: string
  body: string
  /** The language the text is in: the asked-for one, or English when it lacks a translation. */
  lang: string
}

export function isTopic(id: string | undefined): id is string {
  return !!id && HELP_TOPICS.some((topic) => topic.id === id)
}

export function helpDoc(id: string, lang: string): HelpDoc | null {
  for (const l of [lang, 'en']) {
    const raw = files[`./content/${l}/${id}.md`]
    if (raw === undefined) continue
    const newline = raw.indexOf('\n')
    const first = newline === -1 ? raw : raw.slice(0, newline)
    return { id, lang: l, title: first.replace(/^#\s*/, '').trim(), body: newline === -1 ? '' : raw.slice(newline + 1) }
  }
  return null
}
