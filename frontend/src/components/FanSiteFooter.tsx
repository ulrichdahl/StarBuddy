import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'

/**
 * Cloud Imperium fan-kit compliance: the "Made by the Community" logo (only
 * resized, never recolored, ≥50% opacity), the required fan-site notice in
 * readable type, a link to the official site, and the trademark notice.
 * https://support.robertsspaceindustries.com/hc/en-us/articles/360006895793
 */
export function FanSiteFooter() {
  return (
    <Box
      component="footer"
      sx={{
        mt: 6,
        pt: 3,
        borderTop: 1,
        borderColor: 'divider',
        display: 'flex',
        gap: 3,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <Box
        component="a"
        href="https://robertsspaceindustries.com/"
        target="_blank"
        rel="noopener"
        aria-label="Star Citizen — Made by the Community"
        sx={{ display: 'inline-flex', flexShrink: 0, opacity: 0.85, '&:hover': { opacity: 1 } }}
      >
        <Box
          component="img"
          src="/made-by-the-community.svg"
          alt="Star Citizen — Made by the Community"
          sx={{ height: 72, width: 72 }}
        />
      </Box>
      <Box sx={{ flex: 1, minWidth: 260 }}>
        <Typography variant="body2" color="text.secondary">
          This is an unofficial{' '}
          <Link href="https://robertsspaceindustries.com/" target="_blank" rel="noopener" color="inherit">
            Star Citizen
          </Link>{' '}
          fan site, not affiliated with the Cloud Imperium group of companies. All content on this
          site not authored by its host or users are property of their respective owners.
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Star Citizen®, Roberts Space Industries® and Cloud Imperium® are registered trademarks of
          Cloud Imperium Rights LLC. StarBuddy is free software (AGPL-3.0).
        </Typography>
      </Box>
    </Box>
  )
}
