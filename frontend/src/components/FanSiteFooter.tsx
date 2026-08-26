import { Trans, useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'

/**
 * Cloud Imperium fan-kit compliance: the "Made by the Community" logo (only
 * resized, never recolored, ≥50% opacity), the required fan-site notice in
 * readable type, a link to the official site, and the trademark notice.
 * https://support.robertsspaceindustries.com/hc/en-us/articles/360006895793
 * Above it, the project credit: the community it was built for and by whom.
 */
export function FanSiteFooter() {
  const { t } = useTranslation()
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
        aria-label={t('footer.badgeAlt')}
        sx={{ display: 'inline-flex', flexShrink: 0, opacity: 0.85, '&:hover': { opacity: 1 } }}
      >
        <Box
          component="img"
          src="/made-by-the-community.svg"
          alt={t('footer.badgeAlt')}
          sx={{ height: 72, width: 72 }}
        />
      </Box>
      <Box sx={{ flex: 1, minWidth: 260 }}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          <Trans
            i18nKey="footer.credit"
            components={{
              community: <Link href="https://uniteddanes.org" target="_blank" rel="noopener" color="primary" />,
              author: <Link href="https://robertsspaceindustries.com/citizens/DK-Raven" target="_blank" rel="noopener" color="inherit" />,
              claude: <Link href="https://claude.ai" target="_blank" rel="noopener" color="inherit" />,
            }}
          />
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('footer.notice')}{' '}
          <Link href="https://robertsspaceindustries.com/" target="_blank" rel="noopener" color="inherit">
            robertsspaceindustries.com
          </Link>
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {t('footer.trademarks')} {t('footer.freeSoftware')}{' '}
          <Link href="https://github.com/ulrichdahl/StarBuddy" target="_blank" rel="noopener" color="inherit">
            {t('footer.source')}
          </Link>
          .
        </Typography>
      </Box>
    </Box>
  )
}
