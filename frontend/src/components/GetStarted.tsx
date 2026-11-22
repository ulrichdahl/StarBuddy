import { useState, type ReactNode } from 'react'
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
import { api, unwrapList } from '../lib/api'
import { hasConnectedClient, useDevices } from '../lib/devices'
import type { Me, OrgSummary } from '../lib/types'
import { useHelp } from '../help/useHelp'
import { fonts, hud } from '../theme'
import { DownloadStep, PairStep } from './ClientSetup'
import { HudBadge, HudPanel } from './hud'
import { OrganizationsDialog } from './OrganizationsDialog'

const hiddenKey = (me: Me) => `starbuddy.getStarted.hidden.${me.id}`

function readHidden(me: Me) {
  try {
    return localStorage.getItem(hiddenKey(me)) === '1'
  } catch {
    return false
  }
}

type StepState = 'done' | 'waiting' | 'todo'

function Step({ n, state, title, help, optional, children }: { n: number; state: StepState; title: string; help: string; optional?: boolean; children?: ReactNode }) {
  const { t } = useTranslation()
  const icon =
    state === 'done' ? <CheckCircleIcon sx={{ color: hud.teal }} /> : state === 'waiting' ? <HourglassEmptyIcon sx={{ color: hud.amber }} /> : <RadioButtonUncheckedIcon sx={{ color: hud.textFaint }} />
  return (
    <Box component="li" sx={{ display: 'flex', gap: 1.75, py: 1.75, borderTop: `1px solid ${hud.lineSoft}`, '&:first-of-type': { borderTop: 0, pt: 0.5 } }}>
      <Box sx={{ pt: 0.25 }} aria-hidden>
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography component="h3" sx={{ m: 0, fontFamily: fonts.display, fontWeight: 600, fontSize: 18, letterSpacing: '0.04em', color: state === 'done' ? hud.textMuted : hud.text }}>
              <Box component="span" sx={{ fontFamily: fonts.mono, color: hud.textFaint, mr: 1 }}>
                {String(n).padStart(2, '0')}
              </Box>
              {title}
            </Typography>
            {optional && state !== 'done' && <HudBadge colour={hud.textDim}>{t('getStarted.optional')}</HudBadge>}
            <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              {t(`getStarted.state.${state}`)}
            </Box>
          </Box>
          <Typography variant="body2" sx={{ color: hud.textDim, mt: 0.5, lineHeight: 1.55 }}>
            {help}
          </Typography>
        </Box>
        {state !== 'done' && children}
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
 * useful, ticked off from what the account already has. It goes away once
 * every step is done, or when the player hides it.
 */
export function GetStarted({ me, dismissible = true }: { me: Me; dismissible?: boolean }) {
  const { t } = useTranslation()
  const help = useHelp()
  const [hidden, setHidden] = useState(() => readHidden(me))
  const [orgsOpen, setOrgsOpen] = useState(false)
  const { data: devices, isLoading: devicesLoading } = useDevices()
  const { data: orgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: async () => unwrapList<OrgSummary>((await api.get('/api/orgs')).data),
    enabled: me.orgs.length === 0,
  })

  const handle: StepState = me.handle ? 'done' : 'todo'
  const org: StepState = me.orgs.length > 0 ? 'done' : orgs?.some((o) => o.membership?.status === 'pending') ? 'waiting' : 'todo'
  const client: StepState = hasConnectedClient(devices) ? 'done' : devices && devices.length > 0 ? 'waiting' : 'todo'
  const done = [handle, org, client].filter((s) => s === 'done').length

  if ((hidden && dismissible) || devicesLoading || done === 3) return null

  const hide = () => {
    try {
      localStorage.setItem(hiddenKey(me), '1')
    } catch {
      // Private window: hidden for this visit only.
    }
    setHidden(true)
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
          {dismissible && (
            <Button size="small" color="inherit" onClick={hide}>
              {t('getStarted.hide')}
            </Button>
          )}
        </Box>
      }
    >
      <Typography variant="body2" sx={{ color: hud.textMuted, mt: -1 }}>
        {t('getStarted.intro')}{' '}
        {help && (
          <Link component="button" type="button" onClick={() => help.open('getting-started')} sx={{ verticalAlign: 'baseline', fontSize: 'inherit' }}>
            {t('getStarted.howItWorks')}
          </Link>
        )}
      </Typography>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        <Step n={1} state={handle} title={t('getStarted.handle.title')} help={t('getStarted.handle.help')}>
          <HandleForm />
        </Step>
        <Step n={2} state={org} title={t('getStarted.org.title')} help={t(org === 'waiting' ? 'getStarted.org.waiting' : 'getStarted.org.help')}>
          <Box>
            <Button variant={org === 'waiting' ? 'outlined' : 'contained'} onClick={() => setOrgsOpen(true)}>
              {t('dashboard.findOrg')}
            </Button>
          </Box>
        </Step>
        <Step n={3} state={client} optional title={t('getStarted.client.title')} help={t(client === 'todo' ? 'getStarted.client.help' : devices?.some((d) => d.last_used_at) ? 'getStarted.client.stale' : 'getStarted.client.waiting')}>
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
