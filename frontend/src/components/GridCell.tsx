import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Popper from '@mui/material/Popper'
import Typography from '@mui/material/Typography'
import type { SxProps, Theme } from '@mui/material/styles'
import { qualityColor } from '../lib/rarity'

/**
 * The look of an entry grid, in one place so the bulk stack sheet and the
 * refinery order sheet cannot drift apart. The behaviour they share lives in
 * `useCellGrid`; this is the part you can see.
 */

/** A cell: focused cells are outlined, the one being edited more strongly. */
export function cellSx({ on, editing, align, readOnly }: {
  on: boolean
  editing: boolean
  align: 'flex-start' | 'flex-end' | 'center'
  readOnly?: boolean
}): SxProps<Theme> {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    px: 1.25,
    py: 0.875,
    minHeight: 22,
    borderRadius: 1,
    cursor: readOnly ? 'default' : 'pointer',
    justifyContent: align,
    border: '1px solid',
    borderColor: on && !readOnly ? 'primary.main' : 'transparent',
    bgcolor: on && !editing && !readOnly ? 'rgba(91, 200, 219, 0.07)' : 'transparent',
    boxShadow: on && editing && !readOnly ? (theme: Theme) => `0 0 0 1px ${theme.palette.primary.main}` : 'none',
  }
}

/** The bare input a focused cell turns into — it must not look like a field. */
export const gridInputSx = {
  width: '100%',
  minWidth: 0,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: 'inherit',
  font: 'inherit',
  fontVariantNumeric: 'tabular-nums',
  padding: 0,
} as const

/** A column heading. */
export function HeadCell({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, textAlign: align }}
    >
      {children}
    </Typography>
  )
}

/** The line separating rows, dim enough to read as a sheet rather than a table. */
export const GRID_ROW_BORDER = 'rgba(91, 200, 219, 0.06)'

/** The band list, hanging off the focused quality cell. */
export function BandPopper({ open, anchorEl, bands, activeIndex, onPick }: {
  open: boolean
  anchorEl: () => HTMLElement
  bands: number[]
  activeIndex: number
  onPick: (band: number) => void
}) {
  const { t } = useTranslation()
  return (
    <Popper open={open} anchorEl={anchorEl} placement="bottom-end" style={{ zIndex: 1400 }}>
      <Paper sx={{ mt: 0.5, py: 0.5, minWidth: 130, maxHeight: 260, overflowY: 'auto', border: 1, borderColor: 'primary.main' }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, pb: 0.5, textAlign: 'right' }}>
          {t('bulk.bands')}
        </Typography>
        {bands.map((band, i) => (
          <Box
            key={band}
            onMouseDown={(e) => { e.preventDefault(); onPick(band) }}
            sx={{
              px: 1.5,
              py: 0.75,
              cursor: 'pointer',
              textAlign: 'right',
              fontWeight: 600,
              fontSize: 13,
              fontVariantNumeric: 'tabular-nums',
              color: qualityColor(band),
              bgcolor: i === activeIndex ? 'rgba(91, 200, 219, 0.16)' : 'transparent',
            }}
          >
            {band}
          </Box>
        ))}
      </Paper>
    </Popper>
  )
}
