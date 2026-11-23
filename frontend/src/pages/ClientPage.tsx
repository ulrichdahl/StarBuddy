import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import DesktopWindowsOutlinedIcon from '@mui/icons-material/DesktopWindowsOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { api } from '../lib/api'
import { deviceState, latestSync, useDevices, type DeviceState } from '../lib/devices'
import { hud } from '../theme'
import { HelpButton } from '../help/HelpContext'
import { DownloadStep, PairStep } from '../components/ClientSetup'
import { EmptyState } from '../components/EmptyState'
import { HudBadge, HudPanel, Mono, StatusDot } from '../components/hud'
import { PageHeader } from '../components/PageHeader'

const STATE_COLOUR: Record<DeviceState, string> = { active: hud.teal, stale: hud.amber, never: hud.textFaint }

function useStamp() {
  const { i18n } = useTranslation()
  return (iso: string) => new Date(iso).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })
}

/** Download the client and connect it to this account. */
function SetupPanel() {
  const { t } = useTranslation()
  return (
    <HudPanel title={t('clientPage.setUp')} component="h3" id="client-setup" raised>
      <Typography variant="body2" sx={{ color: hud.textMuted, lineHeight: 1.55 }}>
        {t('pair.clientHelp')}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
        <DownloadStep />
        <PairStep />
      </Box>
    </HudPanel>
  )
}

/** Every client paired to this account, with when it last synced. */
function DevicesPanel() {
  const { t } = useTranslation()
  const stamp = useStamp()
  const queryClient = useQueryClient()
  const { data: devices } = useDevices()
  const latest = latestSync(devices)
  const revoke = useMutation({
    mutationFn: async (id: number) => api.delete(`/api/devices/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  })

  return (
    <HudPanel
      title={t('pair.pairedDevices')}
      component="h3"
      id="client-devices"
      raised
      aside={
        <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 12.5, color: hud.textMuted }}>
          {latest?.last_used_at ? (
            <>
              <StatusDot />
              {t('profileDialog.lastSync')} <Mono colour={hud.text}>{stamp(latest.last_used_at)}</Mono>
            </>
          ) : (
            <>
              <StatusDot colour={hud.textFaint} />
              {t('profileDialog.neverSynced')}
            </>
          )}
        </Box>
      }
    >
      {devices && devices.length === 0 && <EmptyState text={t('clientPage.noDevices')} />}
      {devices && devices.length > 0 && (
        <Box>
          {devices.map((d) => {
            const state = deviceState(d)
            return (
              <Box key={d.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1.25, borderTop: `1px solid ${hud.lineSoft}`, '&:first-of-type': { borderTop: 0 } }}>
                <DesktopWindowsOutlinedIcon sx={{ color: state === 'active' ? hud.teal : hud.textFaint }} fontSize="small" />
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <Box component="span" sx={{ fontWeight: 500, color: state === 'active' ? hud.text : hud.textMuted, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.name}
                  </Box>
                  <Box component="span" sx={{ fontSize: 12, color: hud.textDim }}>
                    {d.last_used_at ? (
                      <>
                        {t('profileDialog.lastSync')} <Mono>{stamp(d.last_used_at)}</Mono>
                      </>
                    ) : (
                      t('pair.never')
                    )}
                  </Box>
                </Box>
                <HudBadge colour={STATE_COLOUR[state]}>{t(`pair.${state}`)}</HudBadge>
                <IconButton
                  aria-label={t('pair.remove', { name: `${d.name} (${t(`pair.${state}`)})` })}
                  onClick={() => revoke.mutate(d.id)}
                  disabled={revoke.isPending}
                  sx={{ width: 40, height: 40, border: `1px solid ${hud.lineStrong}`, color: hud.textDim, '&:hover': { color: hud.amber, borderColor: hud.amber } }}
                >
                  <DeleteOutlinedIcon fontSize="small" />
                </IconButton>
              </Box>
            )
          })}
        </Box>
      )}
    </HudPanel>
  )
}

interface UdiStatus {
  linked: boolean
  reachable: boolean | null
  profile: { revision: number; updated_at: string; channel: 'live' | 'ptu'; labels: boolean; config: boolean } | null
}

/**
 * The link to the UDI StarLabels/StarConfig tools on uniteddanes.org: the
 * player sets up ship names and game settings there, and their StarBuddy
 * desktop clients install global.ini and user.cfg. The token lives on the
 * account; it goes to UDI only in the setup URL's fragment.
 */
function UdiPanel() {
  const { t, i18n } = useTranslation()
  const stamp = useStamp()
  const queryClient = useQueryClient()
  const { data: status } = useQuery({
    queryKey: ['udi-link-status'],
    queryFn: async () => (await api.get<UdiStatus>('/api/me/udi-link/status')).data,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['udi-link-status'] })

  const open = useMutation({
    mutationFn: async () => {
      // Open the tab first, inside the click, so no popup blocker stops it.
      const tab = window.open('about:blank', '_blank')
      try {
        const { data } = await api.get<{ token: string; setup_url: Record<string, string> }>('/api/me/udi-link')
        const url = data.setup_url[i18n.language.startsWith('da') ? 'da' : 'en']
        if (tab) {
          tab.opener = null
          tab.location.href = `${url}#starbuddy=${data.token}`
        }
      } catch (error) {
        tab?.close()
        throw error
      }
    },
    onSettled: refresh,
  })
  const unlink = useMutation({
    mutationFn: async () => api.delete('/api/me/udi-link'),
    onSuccess: refresh,
  })

  const profile = status?.profile
  const [dot, text] = !status?.linked
    ? [hud.textFaint, t('udi.notLinked')]
    : profile
      ? [hud.teal, t('udi.sent', { revision: profile.revision })]
      : status.reachable === false
        ? [hud.amber, t('udi.unreachable')]
        : [hud.amber, t('udi.waiting')]

  return (
    <HudPanel
      title={t('udi.title')}
      component="h3"
      id="client-udi"
      raised
      aside={
        <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 12.5, color: hud.textMuted }}>
          <StatusDot colour={dot} />
          {text}
          <HelpButton size="small" topic="starlabels" />
        </Box>
      }
    >
      <Typography variant="body2" sx={{ color: hud.textMuted, lineHeight: 1.55 }}>
        {t('udi.help')}
      </Typography>
      {profile && (
        <Typography variant="body2" sx={{ color: hud.textDim }}>
          {t('udi.details', {
            channel: profile.channel.toUpperCase(),
            what: [profile.labels && 'global.ini', profile.config && 'user.cfg'].filter(Boolean).join(' + ') || '—',
          })}{' '}
          <Mono colour={hud.text}>{stamp(profile.updated_at)}</Mono>
        </Typography>
      )}
      {open.isError && <Alert severity="error">{t('udi.openError')}</Alert>}
      {unlink.isError && <Alert severity="error">{t('udi.unlinkError')}</Alert>}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" color="primary" startIcon={<OpenInNewIcon />} onClick={() => open.mutate()} disabled={open.isPending}>
          {t('udi.open')}
        </Button>
        {status?.linked && (
          <Button variant="outlined" color="inherit" disabled={unlink.isPending} onClick={() => window.confirm(t('udi.unlinkConfirm')) && unlink.mutate()}>
            {t('udi.unlink')}
          </Button>
        )}
      </Box>
    </HudPanel>
  )
}

/**
 * /client: everything about the desktop client in one place. Download it,
 * connect it, see the clients paired to this account, and link the UDI
 * StarLabels/StarConfig setup the client installs. The top bar's Desktop
 * client button opens it.
 */
export function ClientPage() {
  const { t } = useTranslation()
  return (
    <Box>
      <PageHeader title={t('clientPage.title')} subtitle={t('clientPage.subtitle')} />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 3fr) minmax(0, 2fr)' }, gap: 2.25, alignItems: 'start' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, minWidth: 0 }}>
          <SetupPanel />
          <DevicesPanel />
        </Box>
        <UdiPanel />
      </Box>
    </Box>
  )
}
