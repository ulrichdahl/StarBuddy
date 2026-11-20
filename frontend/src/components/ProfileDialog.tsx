import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import DesktopWindowsOutlinedIcon from '@mui/icons-material/DesktopWindowsOutlined'
import DownloadIcon from '@mui/icons-material/Download'
import LinkIcon from '@mui/icons-material/Link'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { api } from '../lib/api'
import { deviceState, latestSync, useDevices, type DeviceState } from '../lib/devices'
import type { Me } from '../lib/types'
import { useNow } from '../lib/useNow'
import { fonts, hud } from '../theme'
import { HudAvatar, HudBadge, HudPanel, Mono, OrgTag, StatusDot } from './hud'

const RELEASES = 'https://github.com/ulrichdahl/StarBuddy/releases'

interface PairingCode {
  code: string
  expires_at: string
}

const labelSx = {
  fontFamily: fonts.display,
  fontWeight: 600,
  fontSize: 13,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: hud.textDim,
} as const

const stepSx = { ...labelSx, fontWeight: 700, color: hud.teal, letterSpacing: '0.18em' } as const

const STATE_COLOUR: Record<DeviceState, string> = { active: hud.teal, stale: hud.amber, never: hud.textFaint }

function useStamp() {
  const { i18n } = useTranslation()
  return (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })
}

function IdentitySection({ me }: { me: Me }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [handle, setHandle] = useState(me.handle ?? '')
  const save = useMutation({
    mutationFn: async () => (await api.patch<Me>('/api/me', { handle: handle.trim() || null })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })
  const dirty = (me.handle ?? '') !== handle.trim()
  const org = me.orgs[0]

  return (
    <HudPanel title={t('profileDialog.identity')} component="h3" id="pm-id" raised>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.25 }}>
          <Box sx={{ borderRadius: '50%', boxShadow: `0 0 0 6px ${hud.panelRaised}, 0 0 0 7px ${hud.lineStrong}` }}>
            <HudAvatar me={me} size={104} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('profileDialog.avatarFromDiscord')}
          </Typography>
        </Box>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault()
            if (dirty) save.mutate()
          }}
          sx={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          <Box component="label" htmlFor="pm-handle" sx={labelSx}>
            {t('profileDialog.handleLabel')}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <InputBase
              id="pm-handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              sx={{
                flex: 1,
                minWidth: 0,
                height: 44,
                px: 1.75,
                bgcolor: hud.well,
                border: `1px solid ${hud.lineStrong}`,
                fontFamily: fonts.mono,
                fontSize: 15,
                '&.Mui-focused': { borderColor: hud.teal },
              }}
            />
            <Button type="submit" variant="contained" disabled={!dirty || save.isPending} sx={{ height: 44, px: 2.5 }}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </Box>
          <Typography variant="body2" sx={{ fontSize: 12.5, color: hud.textDim }}>
            {t('profileDialog.handleHelp')}
          </Typography>
          {save.isError && <Alert severity="error">{t('profile.saveError')}</Alert>}
          {save.isSuccess && !dirty && <Alert severity="success">{t('profile.saved')}</Alert>}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75, fontSize: 13, color: hud.textMuted }}>
            {org ? (
              <>
                <OrgTag org={org} />
                {org.name}
                {org.pivot && (
                  <>
                    {' · '}
                    <Box component="span" sx={{ color: hud.amber }}>
                      {t(`org.role.${org.pivot.role}`)}
                    </Box>
                  </>
                )}
              </>
            ) : (
              t('profileDialog.noOrg')
            )}
          </Box>
        </Box>
      </Box>
    </HudPanel>
  )
}

function PairStep() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [code, setCode] = useState<PairingCode | null>(null)
  const now = useNow()
  const generate = useMutation({
    mutationFn: async () => (await api.post<PairingCode>('/api/devices/pairing-code')).data,
    onSuccess: (data) => {
      setCode(data)
      // The app shows up in the device list once it has paired.
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
  })
  const left = code ? Math.max(0, new Date(code.expires_at).getTime() - now) : 0
  const live = code !== null && left > 0
  const clock = `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`

  return (
    <Box sx={{ border: `1px solid ${hud.line}`, bgcolor: '#0f161b', p: 1.75, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box component="span" sx={stepSx}>
        02 · {t('pair.pair')}
      </Box>
      {live ? (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              height: 52,
              px: 1.75,
              border: `1px dashed ${hud.teal}`,
              bgcolor: 'rgba(79,209,197,0.06)',
            }}
          >
            <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: 22, letterSpacing: '0.18em', color: hud.teal }}>
              {code.code}
            </Box>
            <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: 12, color: hud.amber }} aria-live="off">
              {clock}
            </Box>
          </Box>
          <Typography variant="body2" sx={{ fontSize: 12.5, color: hud.textDim }}>
            {t('pair.waiting')}
          </Typography>
        </>
      ) : (
        <>
          <Button
            variant="outlined"
            color="primary"
            startIcon={<LinkIcon />}
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            {generate.isPending ? t('pair.generating') : code ? t('pair.generateNew') : t('pair.generate')}
          </Button>
          <Typography variant="body2" sx={{ fontSize: 12.5, color: hud.textDim }}>
            {code ? t('pair.expired') : t('pair.enterWithin')}
          </Typography>
        </>
      )}
    </Box>
  )
}

function DesktopClientSection() {
  const { t } = useTranslation()
  const stamp = useStamp()
  const queryClient = useQueryClient()
  const { data: devices } = useDevices()
  const latest = latestSync(devices)
  const revoke = useMutation({
    mutationFn: async (id: number) => api.delete(`/api/devices/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  })

  const download = (label: string) => (
    <Button
      variant="outlined"
      color="inherit"
      component="a"
      href={`${RELEASES}/latest`}
      target="_blank"
      rel="noopener"
      startIcon={<DownloadIcon sx={{ color: hud.teal }} />}
      sx={{ justifyContent: 'flex-start', fontFamily: fonts.body, fontWeight: 500, fontSize: 13, letterSpacing: 0, textTransform: 'none' }}
    >
      {label}
    </Button>
  )

  return (
    <HudPanel
      title={t('pair.title')}
      component="h3"
      id="pm-client"
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
      <Typography variant="body2" sx={{ color: hud.textMuted, lineHeight: 1.55 }}>
        {t('pair.clientHelp')}
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
        <Box sx={{ border: `1px solid ${hud.line}`, bgcolor: '#0f161b', p: 1.75, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Box component="span" sx={stepSx}>
            01 · {t('pair.install')}
          </Box>
          {download(t('pair.linux'))}
          {download(t('pair.windows'))}
          <Link href={`${RELEASES}/tag/dev`} target="_blank" rel="noopener" sx={{ fontSize: 12.5 }}>
            {t('pair.devBuilds')}
          </Link>
        </Box>
        <PairStep />
      </Box>

      {devices && devices.length > 0 && (
        <Box>
          <Box sx={{ ...labelSx, pb: 1 }}>{t('pair.pairedDevices')}</Box>
          {devices.map((d) => {
            const state = deviceState(d)
            return (
              <Box key={d.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1.25, borderTop: `1px solid ${hud.lineSoft}` }}>
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
function UdiSection() {
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
      id="pm-udi"
      raised
      aside={
        <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 12.5, color: hud.textMuted }}>
          <StatusDot colour={dot} />
          {text}
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
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" color="primary" startIcon={<OpenInNewIcon />} onClick={() => open.mutate()} disabled={open.isPending}>
          {t('udi.open')}
        </Button>
        {status?.linked && (
          <Button
            variant="outlined"
            color="inherit"
            disabled={unlink.isPending}
            onClick={() => window.confirm(t('udi.unlinkConfirm')) && unlink.mutate()}
          >
            {t('udi.unlink')}
          </Button>
        )}
      </Box>
    </HudPanel>
  )
}

/** Profile & desktop client, opened from the avatar menu. */
export function ProfileDialog({ me, open, onClose }: { me: Me; open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth={false} aria-labelledby="pm-title"
      slotProps={{ paper: { sx: { width: 760, maxWidth: '100%', m: fullScreen ? 0 : 2 } } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, py: 2, pl: 2.75, pr: 2, borderBottom: `1px solid ${hud.lineSoft}` }}>
        <Typography id="pm-title" variant="h4" component="h2" sx={{ flex: 1, m: 0 }}>
          {t('profileDialog.title')}
        </Typography>
        <IconButton aria-label={t('common.close')} onClick={onClose} sx={{ width: 44, height: 44, border: `1px solid ${hud.lineStrong}`, color: hud.textMuted }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ p: 2.75, display: 'flex', flexDirection: 'column', gap: 2.25, overflowY: 'auto' }}>
        <IdentitySection me={me} />
        <DesktopClientSection />
        <UdiSection />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', py: 1.75, px: 2.75, borderTop: `1px solid ${hud.lineSoft}`, bgcolor: hud.well }}>
        <Button variant="outlined" color="inherit" onClick={onClose} sx={{ height: 44, px: 2.75 }}>
          {t('common.done')}
        </Button>
      </Box>
    </Dialog>
  )
}
