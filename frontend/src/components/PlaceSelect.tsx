import { useTranslation } from 'react-i18next'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SxProps, Theme } from '@mui/material/styles'
import { locationLabel, useLocations } from '../lib/locations'
import type { Location } from '../lib/types'

/** A filter target: a whole star system, or one place inside it. */
export type Place = { kind: 'system'; system: string } | { kind: 'location'; location: Location }

/** Personal and unknown places head a group nothing can filter on, so their row is a label only. */
type Option = Place | { kind: 'header'; label: string }

/** Within each system: major landing zones first, then stations, then the rest. */
const kindRank = (l: Location) => (l.kind === 'landing_zone' ? 0 : l.kind === 'station' ? 1 : 2)

/** The kinds that belong to the player rather than to a place in the universe. */
const PERSONAL = new Set(['ship', 'hangar', 'base'])

interface PlaceSelectProps {
  value: Place | null
  onChange: (value: Place | null) => void
  label?: string
  size?: 'small' | 'medium'
  sx?: SxProps<Theme>
}

/**
 * System and location in one filter, listed the way the craft type filter
 * lists Armor and its subtypes: the system's own name is the row that selects
 * all of it, and the places under it are indented beneath. Personal locations
 * (ships, hangars, bases) sit under a heading that selects nothing — there is
 * no system to filter by.
 */
export function PlaceSelect({ value, onChange, label, size, sx }: PlaceSelectProps) {
  const { t } = useTranslation()
  const { data: locations = [] } = useLocations()

  const groupOf = (l: Location) =>
    l.system ?? (PERSONAL.has(l.kind ?? '') ? t('locations.groupPersonal') : t('locations.groupUnknown'))

  const sorted = [...locations].sort(
    (a, b) =>
      (a.system ?? '￿').localeCompare(b.system ?? '￿') ||
      kindRank(a) - kindRank(b) ||
      a.name.localeCompare(b.name),
  )

  const options: Option[] = []
  let lastGroup: string | null = null
  for (const location of sorted) {
    const group = groupOf(location)
    if (group !== lastGroup) {
      options.push(location.system ? { kind: 'system', system: location.system } : { kind: 'header', label: group })
      lastGroup = group
    }
    options.push({ kind: 'location', location })
  }

  const optionLabel = (option: Option) =>
    option.kind === 'system' ? option.system : option.kind === 'header' ? option.label : locationLabel(option.location)

  return (
    <Autocomplete<Option>
      options={options}
      value={value}
      onChange={(_, next) => onChange(next && next.kind !== 'header' ? next : null)}
      getOptionLabel={optionLabel}
      getOptionDisabled={(option) => option.kind === 'header'}
      isOptionEqualToValue={(a, b) =>
        a.kind === 'system' && b.kind === 'system'
          ? a.system === b.system
          : a.kind === 'location' && b.kind === 'location' && a.location.id === b.location.id
      }
      renderOption={(props, option) => {
        const { key, ...rest } = props
        const heads = option.kind !== 'location'
        return (
          <Box
            component="li"
            key={key}
            {...rest}
            sx={{
              ...(heads ? {} : { '&.MuiAutocomplete-option': { pl: 4 } }),
              ...(heads && option !== options[0] ? { borderTop: 1, borderColor: 'divider' } : {}),
            }}
          >
            <Typography
              noWrap
              title={option.kind === 'location' ? option.location.name : undefined}
              sx={{ minWidth: 0, fontWeight: heads ? 700 : undefined, color: heads ? 'primary.main' : undefined }}
            >
              {/* Indented under its system, a place needs only its own name;
                  the picked value still reads "System – Name". */}
              {option.kind === 'location' ? option.location.name : optionLabel(option)}
            </Typography>
          </Box>
        )
      }}
      autoHighlight
      openOnFocus
      size={size}
      sx={sx}
      renderInput={(params) => <TextField {...params} label={label ?? t('locations.placeLabel')} />}
    />
  )
}
