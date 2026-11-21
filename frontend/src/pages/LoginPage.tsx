import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import LoginIcon from '@mui/icons-material/Login'
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
        {error && (
          <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>
            {t(error === 'not_a_member' ? 'login.notAMember' : 'login.failed')}
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
