import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import LoginIcon from '@mui/icons-material/Login'
import { FanSiteFooter } from '../components/FanSiteFooter'

/**
 * Shown when GET /api/me returns 401. Discord OAuth is a full-page
 * redirect handled by the backend, so this is a plain anchor.
 */
export function LoginPage() {
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
        <Typography variant="h4" component="h1" sx={{ color: 'primary.main', mb: 1 }}>
          StarBuddy
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
          Org resource and blueprint tracking for Star Citizen. Sign in with the
          Discord account linked to your org.
        </Typography>
        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={<LoginIcon />}
          href="/api/auth/discord/redirect"
        >
          Sign in with Discord
        </Button>
      </Paper>
      <FanSiteFooter />
      </Box>
    </Box>
  )
}
