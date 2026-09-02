import { useTranslation } from 'react-i18next'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import type { SxProps, Theme } from '@mui/material/styles'
import type { Visibility } from '../lib/types'

interface VisibilitySelectProps {
  value: Visibility
  onChange: (value: Visibility) => void
  /** Overrides for wordings that are specific to what is being shared. */
  privateLabel?: string
  orgLabel?: string
  label?: string
  size?: 'small' | 'medium'
  fullWidth?: boolean
  sx?: SxProps<Theme>
}

/**
 * The one private/org switch.
 *
 * A pair of toggle buttons rather than a dropdown: there are only ever two
 * answers, and both are worth reading before choosing one. Arrow keys move
 * the value directly instead of moving focus between the buttons, so the
 * whole thing is one stop in a keyboard run through an entry form.
 *
 * Filters use a select instead, because "either" is a third answer there.
 */
export function VisibilitySelect({
  value,
  onChange,
  privateLabel,
  orgLabel,
  label,
  size = 'small',
  fullWidth = true,
  sx,
}: VisibilitySelectProps) {
  const { t } = useTranslation()

  return (
    <ToggleButtonGroup
      exclusive
      fullWidth={fullWidth}
      size={size}
      sx={sx}
      value={value}
      onChange={(_, next: Visibility | null) => next && onChange(next)}
      onKeyDown={(event) => {
        if (event.key.startsWith('Arrow')) {
          event.preventDefault()
          onChange(value === 'private' ? 'org' : 'private')
        }
      }}
      aria-label={label ?? t('materials.fields.visibility')}
    >
      <ToggleButton value="private">{privateLabel ?? t('materials.visibility.private')}</ToggleButton>
      <ToggleButton value="org">{orgLabel ?? t('materials.visibility.org')}</ToggleButton>
    </ToggleButtonGroup>
  )
}
