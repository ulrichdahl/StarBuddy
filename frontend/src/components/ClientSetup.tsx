import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import DownloadIcon from '@mui/icons-material/Download'
import LinkIcon from '@mui/icons-material/Link'
import { api } from '../lib/api'
import { detectPlatform, linuxPackage, useClientRelease, type DownloadKey } from '../lib/clientRelease'
import { useDevices } from '../lib/devices'
import { useNow } from '../lib/useNow'
import { fonts, hud } from '../theme'

interface PairingCode {
  code: string
  expires_at: string
}

const stepSx = {
  fontFamily: fonts.display,
  fontWeight: 700,
  fontSize: 13,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: hud.teal,
} as const

const boxSx = { border: `1px solid ${hud.line}`, bgcolor: '#0f161b', p: 1.75, display: 'flex', flexDirection: 'column', gap: 1.25, minWidth: 0 } as const

/** Every download, in the order the "other downloads" line lists them. */
const ORDER: DownloadKey[] = ['windows', 'windows_msi', 'appimage', 'deb', 'rpm']

/**
 * Step 1 of setting up the desktop client: one button straight to the
 * installer for the visitor's platform, the others as small links.
 */
export function DownloadStep({ step = '01' }: { step?: string }) {
  const { t } = useTranslation()
  const { data: release } = useClientRelease()
  const platform = detectPlatform()
  const best: DownloadKey | null = platform === 'windows' ? 'windows' : platform === 'linux' ? linuxPackage() : null
  const url = (key: DownloadKey) => release?.downloads[key] ?? release?.page ?? 'https://github.com/ulrichdahl/StarBuddy/releases/latest'
  const devBuilds = (release?.page ?? 'https://github.com/ulrichdahl/StarBuddy/releases/latest').replace(/\/latest$/, '/tag/dev')
  const others = ORDER.filter((key) => key !== best)

  return (
    <Box sx={boxSx}>
      <Box component="span" sx={stepSx}>
        {step} · {t('pair.install')}
      </Box>
      {best ? (
        <Button
          variant="contained"
          component="a"
          href={url(best)}
          rel="noopener"
          startIcon={<DownloadIcon />}
          sx={{ justifyContent: 'flex-start', textTransform: 'none', letterSpacing: 0, fontFamily: fonts.body, fontWeight: 600 }}
        >
          {t(`pair.get.${best}`)}
        </Button>
      ) : (
        <Alert severity="info" sx={{ py: 0 }}>
          {t(platform === 'mac' ? 'pair.onMac' : 'pair.onOther')}
        </Alert>
      )}
      <Typography variant="body2" sx={{ fontSize: 12.5, color: hud.textDim, lineHeight: 1.7 }}>
        {release?.version && (
          <>
            {t('pair.version')} <Box component="span" sx={{ fontFamily: fonts.mono, color: hud.textMuted }}>{release.version}</Box>
            {' · '}
          </>
        )}
        {best ? t('pair.otherDownloads') : t('pair.allDownloads')}{' '}
        {others.map((key, i) => (
          <span key={key}>
            {i > 0 && ' · '}
            <Link href={url(key)} rel="noopener">
              {t(`pair.file.${key}`)}
            </Link>
          </span>
        ))}
        {' · '}
        <Link href={devBuilds} target="_blank" rel="noopener">
          {t('pair.devBuilds')}
        </Link>
      </Typography>
    </Box>
  )
}

export function PairStep({ step = '02' }: { step?: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [code, setCode] = useState<PairingCode | null>(null)
  // The devices known when the code was made: one more means it was used.
  const [before, setBefore] = useState<number[] | null>(null)
  const now = useNow()
  const left = code ? Math.max(0, new Date(code.expires_at).getTime() - now) : 0
  const live = code !== null && left > 0
  const { data: devices } = useDevices({ poll: live })
  const paired = before && devices?.find((d) => !before.includes(d.id))
  const generate = useMutation({
    mutationFn: async () => (await api.post<PairingCode>('/api/devices/pairing-code')).data,
    onSuccess: (data) => {
      setCode(data)
      setBefore((devices ?? []).map((d) => d.id))
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
  })
  const clock = `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`

  return (
    <Box sx={{ border: `1px solid ${hud.line}`, bgcolor: '#0f161b', p: 1.75, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box component="span" sx={stepSx}>
        {step} · {t('pair.pair')}
      </Box>
      {paired ? (
        <Alert icon={<CheckCircleIcon fontSize="inherit" />} severity="success" sx={{ py: 0 }}>
          {t('pair.paired', { name: paired.name })}
        </Alert>
      ) : live ? (
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
          {/* Sign-in with the browser is the way in; a code is the fallback. */}
          <Typography variant="body2" sx={{ color: hud.textMuted, lineHeight: 1.55 }}>
            {t('pair.signIn')}
          </Typography>
          <Box>
            <Button size="small" color="inherit" startIcon={<LinkIcon />} onClick={() => generate.mutate()} disabled={generate.isPending} sx={{ color: hud.textDim }}>
              {generate.isPending ? t('pair.generating') : code ? t('pair.generateNew') : t('pair.useCode')}
            </Button>
          </Box>
          {code && (
            <Typography variant="body2" sx={{ fontSize: 12.5, color: hud.textDim }}>
              {t('pair.expired')}
            </Typography>
          )}
        </>
      )}
    </Box>
  )
}

