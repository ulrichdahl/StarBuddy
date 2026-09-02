import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'
import Autocomplete from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SxProps, Theme } from '@mui/material/styles'
import { locationLabel, useLocations } from '../lib/locations'
import type { Location } from '../lib/types'

interface LocationSelectProps {
  value: Location | null
  onChange: (value: Location | null) => void
  label?: string
  required?: boolean
  helperText?: string
  size?: 'small' | 'medium'
  inputRef?: Ref<HTMLInputElement>
  autoFocus?: boolean
  /** Fires after a pick — entry forms use it to move focus along. */
  onPick?: (value: Location) => void
  sx?: SxProps<Theme>
}

/** Within each system: major landing zones first, then stations, then the rest. */
const kindRank = (l: Location) => (l.kind === 'landing_zone' ? 0 : l.kind === 'station' ? 1 : 2)

/** The kinds that belong to the player rather than to a place in the universe. */
const PERSONAL = new Set(['ship', 'hangar', 'base'])

/**
 * The one location picker: grouped by star system (personal ships/bases
 * last), landing zones before stations, every option a single ellipsised
 * line with the full name in its tooltip. The picked value reads
 * "System – Name" — several stations share a name across systems — and
 * typing a system narrows the list too. Used by entry forms, edit dialogs
 * and list filters alike.
 */
export function LocationSelect({
  value,
  onChange,
  label,
  required,
  helperText,
  size,
  inputRef,
  autoFocus,
  onPick,
  sx,
}: LocationSelectProps) {
  const { t } = useTranslation()
  const { data: locations = [] } = useLocations()
  const sorted = [...locations].sort(
    (a, b) =>
      (a.system ?? '￿').localeCompare(b.system ?? '￿') ||
      kindRank(a) - kindRank(b) ||
      a.name.localeCompare(b.name),
  )

  return (
    <Autocomplete
      options={sorted}
      value={value}
      onChange={(_, next) => {
        onChange(next)
        if (next && onPick) setTimeout(() => onPick(next), 0)
      }}
      getOptionLabel={locationLabel}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      // A missing system means "personal" only for the kinds that are the
      // player's own. A station or refinery without one is a place in the
      // universe whose system nobody has recorded, and filing it under
      // Personal says something untrue about it.
      groupBy={(option) =>
        option.system ?? (PERSONAL.has(option.kind ?? '') ? t('locations.groupPersonal') : t('locations.groupUnknown'))
      }
      renderOption={(props, option) => {
        const { key, ...rest } = props
        return (
          <li key={key} {...rest}>
            <Typography noWrap title={option.name} sx={{ minWidth: 0 }}>
              {option.name}
            </Typography>
          </li>
        )
      }}
      autoHighlight
      openOnFocus
      size={size}
      sx={sx}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          label={label ?? t('locations.label')}
          required={required}
          autoFocus={autoFocus}
          helperText={helperText}
        />
      )}
    />
  )
}
