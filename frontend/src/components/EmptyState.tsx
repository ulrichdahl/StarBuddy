import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { hud } from '../theme'

/**
 * What an empty list says: what goes here and how to add the first one, or,
 * when filters hide everything, just that nothing matches.
 */
export function EmptyState({ title, text, actions }: { title?: string; text: string; actions?: ReactNode }) {
  return (
    <Box sx={{ py: 4, px: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.25, textAlign: 'center' }}>
      {title && (
        <Typography component="p" sx={{ m: 0, fontWeight: 600, fontSize: 17, color: hud.text }}>
          {title}
        </Typography>
      )}
      <Typography variant="body2" sx={{ color: hud.textDim, maxWidth: 560, lineHeight: 1.6 }}>
        {text}
      </Typography>
      {actions && <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', justifyContent: 'center', mt: 0.5 }}>{actions}</Box>}
    </Box>
  )
}

/** EmptyState as the only row of a table. */
export function EmptyRow({ colSpan, ...props }: { colSpan: number; title?: string; text: string; actions?: ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} sx={{ borderBottom: 0 }}>
        <EmptyState {...props} />
      </TableCell>
    </TableRow>
  )
}
