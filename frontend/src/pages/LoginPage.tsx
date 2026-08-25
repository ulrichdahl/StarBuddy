import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
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
  const { t } = useTranslation()
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
      <Box sx={{ maxWidth: 560, width: '100%' }}>
      <Paper sx={{ p: 5, maxWidth: 420, width: '100%', textAlign: 'center', mx: 'auto' }}>
        <Box component="img" src="/logo.svg" alt="" aria-hidden sx={{ width: 72, height: 72, mb: 1 }} />
        <Box component="h1" sx={{ m: 0, mb: 1 }}>
          <Wordmark variant="h4" />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
          {t('login.tagline')}
        </Typography>
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
      <FanSiteFooter />
      </Box>
    </Box>
  )
}
