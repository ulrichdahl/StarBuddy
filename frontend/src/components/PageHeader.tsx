import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import { HelpButton } from '../help/HelpContext'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** Optional action slot rendered on the right (e.g. a primary button). */
  action?: ReactNode
}

/** Consistent page heading: title, optional subtitle, optional action. */
export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 3, flexWrap: 'wrap' }}>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="h4" component="h2">
            {title}
          </Typography>
          <HelpButton size="small" />
        </Box>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Box>
  )
}
