import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import Box from '@mui/material/Box'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import LoginIcon from '@mui/icons-material/Login'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined'
import { FanSiteFooter } from '../components/FanSiteFooter'
import { Wordmark } from '../components/BrandMark'
import { LanguageSwitcher } from '../components/LanguageSwitcher'

/**
 * Shown when GET /api/me returns 401. Discord OAuth is a full-page
 * redirect handled by the backend, so this is a plain anchor.
 */
export function LoginPage() {
  const { t, i18n } = useTranslation()
  // Two files: browsers cannot switch the audio track inside one.
  const intro = i18n.language === 'da' ? 'da' : 'en'
  // Set by the sign-in callback when it refuses the account.
  const error = new URLSearchParams(window.location.search).get('error')
  const toPair = window.location.pathname === '/pair'
  const { data: instance } = useQuery({
    queryKey: ['instance'],
    queryFn: async () => (await api.get<{ discord_invite: string | null; discord_server: { name: string; icon_url: string | null } | null }>('/api/instance')).data,
    staleTime: Infinity,
  })
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        p: 2,
        background:
          'radial-gradient(circle at 30% 20%, rgba(91,200,219,0.08), transparent 40%), radial-gradient(circle at 75% 80%, rgba(232,180,90,0.06), transparent 45%)',
      }}
    >
      <Box sx={{ maxWidth: 1360, width: '100%' }}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '40px',
        }}
      >
      <Box component="figure" sx={{ m: 0, flex: '1 1 640px', maxWidth: 900, minWidth: 0 }}>
        <Box
          component="video"
          key={intro}
          controls
          preload="metadata"
          playsInline
          poster="/intro/poster.jpg"
          src={`/intro/starbuddy-intro.${intro}.mp4`}
          aria-label={t('login.introLabel')}
          sx={{
            display: 'block',
            width: '100%',
            aspectRatio: '16 / 9',
            bgcolor: '#000',
            border: '1px solid rgba(60,201,240,0.35)',
            borderRadius: 1,
            boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
          }}
        />
        <Typography component="figcaption" variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t('login.introCaption')}
        </Typography>
      </Box>
      <Paper sx={{ p: 5, flex: '0 1 420px', maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <Box component="img" src="/logo.svg" alt="" aria-hidden sx={{ width: 72, height: 72, mb: 1 }} />
        <Box component="h1" sx={{ m: 0, mb: 1 }}>
          <Wordmark variant="h4" />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
          {t('login.tagline')}
        </Typography>
        {instance?.discord_server && error !== 'not_a_member' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1, textAlign: 'left' }}>
            {instance.discord_server.icon_url && <Avatar src={instance.discord_server.icon_url} alt="" sx={{ width: 40, height: 40 }} />}
            <Typography variant="body2" color="text.secondary">
              {t('login.membersOnly', { name: instance.discord_server.name })}
            </Typography>
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>
            {t(error === 'not_a_member' ? 'login.notAMember' : 'login.failed')}
          </Alert>
        )}
        {error === 'not_a_member' && instance?.discord_invite && (
          <Button
            variant="outlined"
            size="large"
            fullWidth
            href={instance.discord_invite}
            target="_blank"
            rel="noopener"
            startIcon={
              instance.discord_server?.icon_url ? (
                <Avatar src={instance.discord_server.icon_url} alt="" sx={{ width: 28, height: 28 }} />
              ) : undefined
            }
            sx={{ mb: 1.5, py: 1, textTransform: 'none', letterSpacing: 0.2 }}
          >
            {instance.discord_server ? t('login.joinServer', { name: instance.discord_server.name }) : t('login.joinDiscord')}
          </Button>
        )}
        {toPair && !error && (
          <Alert severity="info" sx={{ mb: 2, textAlign: 'left' }}>
            {t('login.toPair')}
          </Alert>
        )}
        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={<LoginIcon />}
          href="/api/auth/discord/redirect"
        >
          {t('login.signIn')}
        </Button>
        <Button variant="outlined" size="large" fullWidth startIcon={<HelpOutlineIcon />} href="/help/getting-started" sx={{ mt: 1.5 }}>
          {t('help.loginLink')}
        </Button>
        <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 1 }}>
          {t('help.loginHint')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t('help.ownServer')}{' '}
          <Link href="/help/your-own-server">{t('help.ownServerLink')}</Link>
        </Typography>
        <Box sx={{ mt: 2 }}>
          <LanguageSwitcher />
        </Box>
      </Paper>
      </Box>
      <FanSiteFooter />
      </Box>
    </Box>
  )
}
