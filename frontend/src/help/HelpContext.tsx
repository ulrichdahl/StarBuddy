import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined'
import { hud } from '../theme'
import { topicForPath } from './routes'

const HelpPanel = lazy(() => import('./HelpPanel').then((m) => ({ default: m.HelpPanel })))

import { HelpContext, useHelp } from './useHelp'

/**
 * The help panel inside the signed-in app. It opens on the help for the page
 * you are on, follows you to the next page while it is open, and `?` (outside
 * a text field) toggles it.
 */
export function HelpProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [topic, setTopic] = useState<string | null>(null)
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    if (topic !== null) setTopic(topicForPath(pathname))
  }

  const open = useCallback((id?: string) => setTopic(id ?? topicForPath(pathname)), [pathname])
  const close = useCallback(() => setTopic(null), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
      e.preventDefault()
      setTopic((current) => (current === null ? topicForPath(pathname) : null))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pathname])

  const value = useMemo(() => ({ topic, open, close }), [topic, open, close])
  return (
    <HelpContext.Provider value={value}>
      {children}
      {topic !== null && (
        <Suspense fallback={null}>
          <HelpPanel topic={topic} onTopic={setTopic} onClose={close} />
        </Suspense>
      )}
    </HelpContext.Provider>
  )
}

/** The "?" that opens the help for the page you are on. Renders nothing outside the app. */
export function HelpButton({ size = 'medium' }: { size?: 'small' | 'medium' }) {
  const { t } = useTranslation()
  const help = useHelp()
  if (!help) return null
  const active = help.topic !== null
  return (
    <Tooltip title={t('help.forThisPage')}>
      <IconButton
        aria-label={t('help.forThisPage')}
        aria-expanded={active}
        onClick={() => (active ? help.close() : help.open())}
        size={size}
        sx={{ color: active ? hud.teal : hud.textMuted, '&:hover': { color: hud.teal } }}
      >
        <HelpOutlineIcon fontSize={size === 'small' ? 'small' : 'medium'} />
      </IconButton>
    </Tooltip>
  )
}
