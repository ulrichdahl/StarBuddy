import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import InputBase from '@mui/material/InputBase'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined'
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutlineOutlined'
import { api, unwrapList } from '../lib/api'
import { hasConnectedClient, useDevices } from '../lib/devices'
import type { Me, OrgSummary } from '../lib/types'
import { useHelp } from '../help/useHelp'
import { fonts, hud } from '../theme'
import { DownloadStep, PairStep } from './ClientSetup'
import { HudBadge, HudPanel } from './hud'
import { OrganizationsDialog } from './OrganizationsDialog'

const hiddenKey = (me: Me) => `starbuddy.getStarted.hidden.${me.id}`
const skippedKey = (me: Me) => `starbuddy.getStarted.skipped.${me.id}`

function readHidden(me: Me) {
  try {
    return localStorage.getItem(hiddenKey(me)) === '1'
  } catch {
    return false
  }
}

function readSkipped(me: Me): OptionalStep[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(skippedKey(me)) ?? '[]')
    return Array.isArray(list) ? list.filter((s): s is OptionalStep => s === 'org' || s === 'client') : []
  } catch {
    return []
  }
}

/** An org and the client are optional: StarBuddy works for a solo player on the website alone. */
type OptionalStep = 'org' | 'client'

type StepState = 'done' | 'waiting' | 'todo' | 'skipped'

function Step({ n, state, title, help, optional, onSkip, children }: { n: number; state: StepState; title: string; help: string; optional?: boolean; onSkip?: (skip: boolean) => void; children?: ReactNode }) {
  const { t } = useTranslation()
  const settled = state === 'done' || state === 'skipped'
  const icon =
    state === 'done' ? (
      <CheckCircleIcon sx={{ color: hud.teal }} />
    ) : state === 'skipped' ? (
      <RemoveCircleOutlineIcon sx={{ color: hud.textFaint }} />
    ) : state === 'waiting' ? (
      <HourglassEmptyIcon sx={{ color: hud.amber }} />
    ) : (
      <RadioButtonUncheckedIcon sx={{ color: hud.textFaint }} />
    )
  return (
    <Box component="li" sx={{ display: 'flex', gap: 1.75, py: 1.75, borderTop: `1px solid ${hud.lineSoft}`, '&:first-of-type': { borderTop: 0, pt: 0.5 } }}>
      <Box sx={{ pt: 0.25 }} aria-hidden>
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography component="h3" sx={{ m: 0, fontFamily: fonts.display, fontWeight: 600, fontSize: 18, letterSpacing: '0.04em', color: settled ? hud.textMuted : hud.text }}>
              <Box component="span" sx={{ fontFamily: fonts.mono, color: hud.textFaint, mr: 1 }}>
                {String(n).padStart(2, '0')}
              </Box>
              {title}
            </Typography>
            {optional && !settled && <HudBadge colour={hud.textDim}>{t('getStarted.optional')}</HudBadge>}
            <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              {t(`getStarted.state.${state}`)}
            </Box>
          </Box>
          <Typography variant="body2" sx={{ color: hud.textDim, mt: 0.5, lineHeight: 1.55 }}>
            {state === 'skipped' ? t('getStarted.skipped') : help}
            {state === 'skipped' && onSkip && (
              <>
                {' '}
                <Link component="button" type="button" onClick={() => onSkip(false)} sx={{ verticalAlign: 'baseline', fontSize: 'inherit' }}>
                  {t('getStarted.undoSkip')}
                </Link>
              </>
            )}
          </Typography>
        </Box>
        {!settled && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {children}
            {onSkip && (
              <Box>
                <Button size="small" color="inherit" onClick={() => onSkip(true)} sx={{ color: hud.textDim }}>
                  {t(`getStarted.skip`)}
                </Button>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}

function HandleForm() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [handle, setHandle] = useState('')
  const save = useMutation({
    mutationFn: async () => (await api.patch<Me>('/api/me', { handle: handle.trim() })).data,
    onSuccess: (me) => queryClient.setQueryData(['me'], me),
  })
  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault()
        if (handle.trim()) save.mutate()
      }}
      sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 520 }}
    >
      <Box sx={{ display: 'flex', gap: 1 }}>
        <InputBase
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          inputProps={{ 'aria-label': t('profileDialog.handleLabel') }}
          placeholder={t('getStarted.handle.placeholder')}
          sx={{ flex: 1, minWidth: 0, height: 44, px: 1.75, bgcolor: hud.well, border: `1px solid ${hud.lineStrong}`, fontFamily: fonts.mono, fontSize: 15, '&.Mui-focused': { borderColor: hud.teal } }}
        />
        <Button type="submit" variant="contained" disabled={!handle.trim() || save.isPending} sx={{ height: 44, px: 2.5 }}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </Box>
      {save.isError && <Alert severity="error">{t('profile.saveError')}</Alert>}
    </Box>
  )
}

/**
 * The first-login guide on the dashboard: the steps that make StarBuddy
 * useful, ticked off from what the account already has. Only the handle is
 * needed; an org and the client can be skipped, as a solo player on the
 * website alone gets the whole of StarBuddy for themselves. It goes away
 * once every step is done or skipped, or when the player hides it.
 * `/?guide=1` (the avatar menu's Get started guide) brings it back anyway.
 */
export function GetStarted({ me }: { me: Me }) {
  const { t } = useTranslation()
  const help = useHelp()
  const [hidden, setHidden] = useState(() => readHidden(me))
  const [skipped, setSkipped] = useState(() => readSkipped(me))
  const [orgsOpen, setOrgsOpen] = useState(false)
  const [params, setParams] = useSearchParams()
  const asked = params.get('guide') === '1'
  useEffect(() => {
    if (asked) document.getElementById('get-started-title')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [asked])
  const { data: devices, isLoading: devicesLoading } = useDevices()
  const { data: orgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: async () => unwrapList<OrgSummary>((await api.get('/api/orgs')).data),
    enabled: me.orgs.length === 0,
  })

  const handle: StepState = me.handle ? 'done' : 'todo'
  const org: StepState = me.orgs.length > 0 ? 'done' : skipped.includes('org') ? 'skipped' : orgs?.some((o) => o.membership?.status === 'pending') ? 'waiting' : 'todo'
  const client: StepState = hasConnectedClient(devices) ? 'done' : skipped.includes('client') ? 'skipped' : devices && devices.length > 0 ? 'waiting' : 'todo'
  const done = [handle, org, client].filter((s) => s === 'done' || s === 'skipped').length

  if (devicesLoading || (!asked && (hidden || done === 3))) return null

  const skip = (step: OptionalStep) => (on: boolean) => {
    const next = on ? [...skipped.filter((s) => s !== step), step] : skipped.filter((s) => s !== step)
    try {
      localStorage.setItem(skippedKey(me), JSON.stringify(next))
    } catch {
      // Private window: skipped for this visit only.
    }
    setSkipped(next)
  }

  const hide = () => {
    try {
      localStorage.setItem(hiddenKey(me), '1')
    } catch {
      // Private window: hidden for this visit only.
    }
    setHidden(true)
    if (asked) {
      params.delete('guide')
      setParams(params, { replace: true })
    }
  }

  return (
    <HudPanel
      title={t('getStarted.title')}
      id="get-started"
      raised
      sx={{ borderColor: hud.teal, width: '100%' }}
      aside={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: 13, color: hud.textMuted }}>
            {t('getStarted.progress', { done, total: 3 })}
          </Box>
          <Button size="small" color="inherit" onClick={hide}>
            {t('getStarted.hide')}
          </Button>
        </Box>
      }
    >
      <Typography variant="body2" sx={{ color: hud.textMuted, mt: -1 }}>
        {t('getStarted.intro')}
      </Typography>
      {/* Hard to miss on purpose: the "?" is where every page explains itself. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, border: `1px solid ${hud.teal}`, bgcolor: 'rgba(79,209,197,0.07)' }}>
        <HelpOutlineIcon sx={{ fontSize: 40, color: hud.teal, flexShrink: 0 }} aria-hidden />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="p" sx={{ m: 0, fontFamily: fonts.display, fontWeight: 600, fontSize: 18, letterSpacing: '0.04em', color: hud.text }}>
            {t('getStarted.helpTitle')}
          </Typography>
          <Typography variant="body2" sx={{ color: hud.textMuted, mt: 0.5, lineHeight: 1.55 }}>
            {t('getStarted.helpText')}
          </Typography>
        </Box>
        {help && (
          <Button variant="outlined" onClick={() => help.open('getting-started')} sx={{ flexShrink: 0, display: { xs: 'none', sm: 'inline-flex' } }}>
            {t('getStarted.howItWorks')}
          </Button>
        )}
      </Box>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        <Step n={1} state={handle} title={t('getStarted.handle.title')} help={t('getStarted.handle.help')}>
          <HandleForm />
        </Step>
        <Step n={2} state={org} optional onSkip={skip('org')} title={t('getStarted.org.title')} help={t(org === 'waiting' ? 'getStarted.org.waiting' : 'getStarted.org.help')}>
          <Box>
            <Button variant={org === 'waiting' ? 'outlined' : 'contained'} onClick={() => setOrgsOpen(true)}>
              {t('dashboard.findOrg')}
            </Button>
          </Box>
        </Step>
        <Step n={3} state={client} optional onSkip={skip('client')} title={t('getStarted.client.title')} help={t(client === 'todo' ? 'getStarted.client.help' : devices?.some((d) => d.last_used_at) ? 'getStarted.client.stale' : 'getStarted.client.waiting')}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
            <DownloadStep />
            <PairStep />
          </Box>
        </Step>
      </Box>
      <OrganizationsDialog me={me} open={orgsOpen} onClose={() => setOrgsOpen(false)} />
    </HudPanel>
  )
}
