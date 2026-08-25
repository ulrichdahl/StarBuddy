import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

/** StarBuddy logo mark, optionally with the wordmark beside it. */
export function BrandMark({ size = 28, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25 }}>
      <Box component="img" src="/logo.svg" alt="" aria-hidden sx={{ width: size, height: size, display: 'block' }} />
      {wordmark && (
        <Typography variant="h6" component="span" sx={{ color: 'primary.main', fontWeight: 700, lineHeight: 1 }}>
          StarBuddy
        </Typography>
      )}
    </Box>
  )
}
