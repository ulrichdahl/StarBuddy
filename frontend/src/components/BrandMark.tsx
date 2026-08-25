import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { TypographyProps } from '@mui/material/Typography'

/** "Star·Buddy" — the dot is the companion star's amber. */
export function Wordmark({ variant = 'h6', ...props }: TypographyProps) {
  return (
    <Typography
      variant={variant}
      component="span"
      {...props}
      sx={{ color: 'primary.main', fontWeight: 700, lineHeight: 1, letterSpacing: '0.01em', ...props.sx }}
    >
      Star
      <Box component="span" sx={{ color: 'secondary.main', mx: '0.06em' }}>
        ·
      </Box>
      Buddy
    </Typography>
  )
}

/** StarBuddy logo mark with the wordmark beside it. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25 }}>
      <Box component="img" src="/logo.svg" alt="" aria-hidden sx={{ width: size, height: size, display: 'block' }} />
      <Wordmark />
    </Box>
  )
}
