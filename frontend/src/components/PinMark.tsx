import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import { hud } from '../theme'

/**
 * The teal push pin beside a pinned blueprint's name. The same glyph the
 * desktop client uses, so a pin reads the same in both.
 */
export function PinMark({ quantity }: { quantity?: number }) {
  const { t } = useTranslation()
  const label = quantity && quantity > 1 ? t('blueprints.info.pinnedCount', { count: quantity }) : t('blueprints.info.pinned')
  return (
    <Tooltip title={label}>
      <Box
        component="svg"
        role="img"
        aria-label={label}
        viewBox="0 0 24 24"
        sx={{ width: 15, height: 15, ml: 0.75, verticalAlign: '-2px', flexShrink: 0, fill: 'none', stroke: hud.teal, strokeWidth: 1.8, strokeLinejoin: 'round', strokeLinecap: 'round' }}
      >
        <path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z" />
      </Box>
    </Tooltip>
  )
}
