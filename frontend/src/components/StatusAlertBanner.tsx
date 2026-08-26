import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha, useTheme } from '@mui/material/styles'
import BuildCircleIcon from '@mui/icons-material/BuildCircle'
import ErrorIcon from '@mui/icons-material/Error'
import InfoIcon from '@mui/icons-material/Info'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { api } from '../lib/api'
import type { RsiStatus, StatusIncident } from '../lib/types'

/**
 * Front-and-center alert for RSI maintenance/outage notices. The backend
 * polls status.robertsspaceindustries.com every minute; this refetches
 * every 30 s (also in background tabs), re-expands whenever RSI edits a
 * notice, counts down to the announced shutdown, and — when the member
 * allowed it — fires a browser notification the moment a new notice lands.
 */

const POLL_MS = 30_000
const COLLAPSED_KEY = 'starbuddy.status.collapsed'
const NOTIFY_KEY = 'starbuddy.status.notify'

type Severity = 'down' | 'disrupted' | 'maintenance' | 'notice'

const SEVERITY_COLOR: Record<Severity, string> = {
  down: '#E0564B',
  disrupted: '#CC5A2E',
  maintenance: '#E0A526',
  notice: '#4A7CD6',
}

const SEVERITY_ICON: Record<Severity, ReactNode> = {
  down: <ErrorIcon />,
  disrupted: <WarningAmberIcon />,
  maintenance: <BuildCircleIcon />,
  notice: <InfoIcon />,
}

const asSeverity = (s: string): Severity =>
  s === 'down' || s === 'disrupted' || s === 'maintenance' ? s : 'notice'

const versionKey = (i: StatusIncident) => `${i.slug}@${i.version ?? ''}`

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function writeSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set].slice(-50)))
  } catch {
    // Private mode / storage blocked — collapse state simply won't persist.
  }
}

const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function formatUtcTime(iso: string, language: string) {
  return new Date(iso).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** "**bold**" markers → <strong>; blank lines → paragraphs. */
function BodyText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim() !== '')
  return (
    <Box sx={{ display: 'grid', gap: 0.75, maxWidth: '70ch' }}>
      {paragraphs.map((p, i) => (
        <Typography key={i} variant="body2" sx={{ whiteSpace: 'pre-line' }}>
          {p.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith('**') && part.endsWith('**') ? (
              <strong key={j}>{part.slice(2, -2)}</strong>
            ) : (
              <span key={j}>{part}</span>
            ),
          )}
        </Typography>
      ))}
    </Box>
  )
}

interface NotifyState {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  wanted: boolean
}

function useBrowserNotifications(): [NotifyState, () => Promise<void>] {
  const supported = typeof window !== 'undefined' && 'Notification' in window
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported',
  )
  const [wanted, setWanted] = useState(() => readFlag(NOTIFY_KEY))

  const toggle = async () => {
    if (!supported) return
    if (wanted) {
      setWanted(false)
      try {
        localStorage.setItem(NOTIFY_KEY, '0')
      } catch {
        /* ignore */
      }
      return
    }
    let perm = Notification.permission
    if (perm === 'default') perm = await Notification.requestPermission()
    setPermission(perm)
    if (perm === 'granted') {
      setWanted(true)
      try {
        localStorage.setItem(NOTIFY_KEY, '1')
      } catch {
        /* ignore */
      }
    }
  }

  return [{ supported, permission, wanted: wanted && permission === 'granted' }, toggle]
}

export function StatusAlertBanner() {
  const { t, i18n } = useTranslation()
  const theme = useTheme()
  const { data } = useQuery({
    queryKey: ['rsi-status'],
    queryFn: async () => (await api.get<RsiStatus>('/api/status')).data,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  })

  // Wall clock for countdowns; ticks once a second only while a shutdown
  // is still ahead (the lazy initializer keeps render pure).
  const [now, setNow] = useState(() => Date.now())
  const active = useMemo(() => data?.active ?? [], [data])
  // A resolution is worth a quiet line for an hour, then it disappears.
  const justResolved = useMemo(
    () =>
      (data?.recent ?? []).filter(
        (r) => r.resolved_at && now - new Date(r.resolved_at).getTime() < 60 * 60_000,
      ),
    [data, now],
  )

  const [collapsed, setCollapsed] = useState<Set<string>>(() => readSet(COLLAPSED_KEY))
  const [expandedBody, setExpandedBody] = useState<Set<string>>(() => new Set())
  const [notify, toggleNotify] = useBrowserNotifications()

  const hasShutdown = active.some((i) => i.shutdown_at && new Date(i.shutdown_at).getTime() > now)
  useEffect(() => {
    if (!hasShutdown) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [hasShutdown])

  // Tab title carries the warning so it is visible from any other tab.
  useEffect(() => {
    if (active.length === 0) return
    const original = document.title
    document.title = `⚠ ${original.replace(/^⚠ /, '')}`
    return () => {
      document.title = original.replace(/^⚠ /, '')
    }
  }, [active.length])

  // Browser notification on a version we haven't seen — but never for the
  // notices that were already on screen when the page loaded.
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!data) return
    const keys = active.map(versionKey)
    if (seen.current === null) {
      seen.current = new Set(keys)
      return
    }
    const fresh = active.filter((i) => !seen.current!.has(versionKey(i)))
    fresh.forEach((i) => seen.current!.add(versionKey(i)))
    if (fresh.length === 0 || !notify.wanted) return
    for (const incident of fresh) {
      const severity = t(`status.severity.${asSeverity(incident.severity)}`)
      const shutdown = incident.shutdown_at
        ? t('status.shutdownAt', { time: formatUtcTime(incident.shutdown_at, i18n.language) })
        : ''
      try {
        const n = new Notification(t('status.notificationTitle', { severity }), {
          body: [incident.title, shutdown, t('status.stow')].filter(Boolean).join('\n'),
          tag: incident.slug,
          requireInteraction: true,
        })
        n.onclick = () => {
          window.focus()
          n.close()
        }
      } catch {
        /* notifications unavailable in this context */
      }
    }
  }, [data, active, notify.wanted, t, i18n.language])

  if (!data || (active.length === 0 && justResolved.length === 0)) return null

  const setCollapsedFor = (key: string, value: boolean) => {
    const next = new Set(collapsed)
    if (value) next.add(key)
    else next.delete(key)
    setCollapsed(next)
    writeSet(COLLAPSED_KEY, next)
  }

  const notifyButton = notify.supported ? (
    <Tooltip
      title={
        notify.permission === 'denied'
          ? t('status.notifyBlocked')
          : notify.wanted
            ? t('status.notifyOn')
            : t('status.notifyEnable')
      }
    >
      <span>
        <IconButton
          size="small"
          onClick={() => void toggleNotify()}
          disabled={notify.permission === 'denied'}
          aria-label={notify.wanted ? t('status.notifyOn') : t('status.notifyEnable')}
          color={notify.wanted ? 'primary' : 'default'}
        >
          {notify.permission === 'denied' ? (
            <NotificationsOffIcon fontSize="small" />
          ) : notify.wanted ? (
            <NotificationsActiveIcon fontSize="small" />
          ) : (
            <NotificationsNoneIcon fontSize="small" />
          )}
        </IconButton>
      </span>
    </Tooltip>
  ) : null

  return (
    <Box sx={{ display: 'grid', gap: 1, mb: 2 }} role="region" aria-live="polite" aria-label={t('status.region')}>
      {active.map((incident) => {
        const severity = asSeverity(incident.severity)
        const color = SEVERITY_COLOR[severity]
        const key = versionKey(incident)
        const isCollapsed = collapsed.has(key)
        const shutdownMs = incident.shutdown_at ? new Date(incident.shutdown_at).getTime() - now : null
        const shutdownTime = incident.shutdown_at ? formatUtcTime(incident.shutdown_at, i18n.language) : null
        const countdown =
          shutdownMs === null
            ? null
            : shutdownMs > 0
              ? t('status.shutdownIn', { time: formatCountdown(shutdownMs) })
              : t('status.shutdownPassed', { time: shutdownTime })
        const urgent = shutdownMs !== null && shutdownMs > 0
        const bodyOpen = expandedBody.has(key)

        if (isCollapsed) {
          return (
            <Paper
              key={key}
              variant="outlined"
              sx={{
                px: 1.5,
                py: 0.5,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                borderColor: alpha(color, 0.6),
                bgcolor: alpha(color, 0.08),
                cursor: 'pointer',
              }}
              onClick={() => setCollapsedFor(key, false)}
              role="button"
              aria-label={t('status.expand')}
            >
              <Box sx={{ color, display: 'flex' }}>{SEVERITY_ICON[severity]}</Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t(`status.severity.${severity}`)} — {incident.title}
              </Typography>
              {countdown && (
                <Typography variant="body2" sx={{ ml: 'auto', fontVariantNumeric: 'tabular-nums', color }}>
                  {countdown}
                </Typography>
              )}
              <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            </Paper>
          )
        }

        return (
          <Paper
            key={key}
            elevation={0}
            sx={{
              position: 'relative',
              overflow: 'hidden',
              p: { xs: 1.5, md: 2 },
              pl: { xs: 2, md: 2.5 },
              bgcolor: alpha(color, theme.palette.mode === 'dark' ? 0.16 : 0.1),
              border: `1px solid ${alpha(color, 0.55)}`,
              '&::before': {
                content: '""',
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 6,
                bgcolor: color,
                ...(urgent && {
                  animation: 'starbuddy-status-pulse 1.6s ease-in-out infinite',
                  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                }),
              },
              '@keyframes starbuddy-status-pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.35 },
              },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
              <Box sx={{ color, display: 'flex', mt: 0.25 }} aria-hidden>
                {SEVERITY_ICON[severity]}
              </Box>
              <Box sx={{ flex: 1, minWidth: 240 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography
                    variant="overline"
                    sx={{ color, lineHeight: 1.6, letterSpacing: '0.12em', fontWeight: 700 }}
                  >
                    {t(`status.severity.${severity}`)}
                  </Typography>
                  {incident.affected.map((s) => (
                    <Chip key={s} label={s} size="small" variant="outlined" sx={{ borderColor: alpha(color, 0.5) }} />
                  ))}
                </Box>
                <Typography variant="h6" sx={{ lineHeight: 1.25, textWrap: 'balance' }}>
                  {incident.title}
                </Typography>
                {countdown && (
                  <Typography
                    variant={urgent ? 'h5' : 'body1'}
                    sx={{ mt: 0.5, fontVariantNumeric: 'tabular-nums', color: urgent ? color : 'text.secondary', fontWeight: 700 }}
                  >
                    {countdown}
                    {urgent && shutdownTime && (
                      <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1, fontWeight: 400 }}>
                        ({shutdownTime} UTC)
                      </Typography>
                    )}
                  </Typography>
                )}
                {urgent && (
                  <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 600 }}>
                    {t('status.stow')}
                  </Typography>
                )}
                <Collapse in={bodyOpen}>
                  <Box sx={{ mt: 1.5 }}>
                    <BodyText text={incident.body_text} />
                  </Box>
                </Collapse>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                  <Button
                    size="small"
                    onClick={() => {
                      const next = new Set(expandedBody)
                      if (bodyOpen) next.delete(key)
                      else next.add(key)
                      setExpandedBody(next)
                    }}
                    endIcon={bodyOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  >
                    {bodyOpen ? t('status.hideDetails') : t('status.showDetails')}
                  </Button>
                  {incident.permalink && (
                    <Button
                      size="small"
                      component={Link}
                      href={incident.permalink}
                      target="_blank"
                      rel="noopener"
                      endIcon={<OpenInNewIcon />}
                    >
                      {t('status.openStatus')}
                    </Button>
                  )}
                  {incident.updated_at && (
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                      {t('status.updated', {
                        time: new Date(incident.updated_at).toLocaleString(i18n.language, {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'UTC',
                        }),
                      })}
                    </Typography>
                  )}
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {notifyButton}
                <Tooltip title={t('status.collapse')}>
                  <IconButton size="small" onClick={() => setCollapsedFor(key, true)} aria-label={t('status.collapse')}>
                    <ExpandLessIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          </Paper>
        )
      })}

      {justResolved.map((incident) => {
        const key = `resolved:${incident.slug}`
        if (collapsed.has(key)) return null
        return (
          <Paper
            key={key}
            variant="outlined"
            sx={{
              px: 1.5,
              py: 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              borderColor: alpha(theme.palette.success.main, 0.5),
              bgcolor: alpha(theme.palette.success.main, 0.08),
            }}
          >
            <CheckCircleIcon fontSize="small" color="success" />
            <Typography variant="body2">
              {t('status.resolved', { title: incident.title })}
              {incident.resolved_at && (
                <Typography component="span" variant="body2" color="text.secondary">
                  {' '}
                  · {formatUtcTime(incident.resolved_at, i18n.language)} UTC
                </Typography>
              )}
            </Typography>
            <IconButton
              size="small"
              sx={{ ml: 'auto' }}
              onClick={() => setCollapsedFor(key, true)}
              aria-label={t('common.close')}
            >
              <ExpandLessIcon fontSize="small" />
            </IconButton>
          </Paper>
        )
      })}
    </Box>
  )
}
