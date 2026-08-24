import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { api, unwrapList } from '../lib/api'
import type { CreateResourceStack, Location, ResourceType, Visibility } from '../lib/types'

/**
 * Sticky quick-entry form for resource stacks, tuned for bulk entry:
 * after a successful submit the form KEEPS location, visibility and
 * quality, clears resource + quantity, and refocuses the resource field
 * so the next stack can be typed immediately.
 */
export function ResourceEntryForm() {
  const queryClient = useQueryClient()
  const resourceInputRef = useRef<HTMLInputElement>(null)

  // Sticky fields — survive submits.
  const [location, setLocation] = useState<number | ''>('')
  const [visibility, setVisibility] = useState<Visibility>('private')
  const [quality, setQuality] = useState('')

  // Cleared on each submit.
  const [resource, setResource] = useState<ResourceType | null>(null)
  const [resourceSearch, setResourceSearch] = useState('')
  const [quantity, setQuantity] = useState('')

  const { data: resourceOptions = [], isFetching: searching } = useQuery({
    queryKey: ['resource-types', resourceSearch],
    queryFn: async () =>
      unwrapList<ResourceType>(
        (await api.get('/api/resource-types', { params: { search: resourceSearch } })).data,
      ),
  })

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: async () => unwrapList<Location>((await api.get('/api/locations')).data),
  })

  const isPieces = resource?.unit === 'pieces'

  const createStack = useMutation({
    mutationFn: (body: CreateResourceStack) => api.post('/api/resource-stacks', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
      // Bulk-entry ergonomics: only resource + quantity reset.
      setResource(null)
      setResourceSearch('')
      setQuantity('')
      resourceInputRef.current?.focus()
    },
  })

  const canSubmit = resource !== null && location !== '' && quantity !== '' && Number(quantity) > 0

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (location === '' || !resource || !canSubmit) return
    const body: CreateResourceStack = {
      resource_type_id: resource.id,
      quality: quality === '' ? null : Number(quality),
      location_id: location,
      visibility,
      ...(isPieces
        ? { quantity_pieces: Math.round(Number(quantity)) }
        : // Crates are 0.001 SCU; API stores milli-SCU.
          { quantity_mscu: Math.round(Number(quantity) * 1000) }),
    }
    createStack.mutate(body)
  }

  return (
    <Paper component="form" onSubmit={handleSubmit} sx={{ p: 2.5 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Quick entry
      </Typography>
      <Stack spacing={2}>
        <Autocomplete
          options={resourceOptions}
          value={resource}
          onChange={(_, value) => setResource(value)}
          inputValue={resourceSearch}
          onInputChange={(_, value) => setResourceSearch(value)}
          getOptionLabel={(option) => option.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          groupBy={(option) => option.category}
          loading={searching}
          filterOptions={(x) => x} // server-side search
          renderInput={(params) => (
            <TextField
              {...params}
              inputRef={resourceInputRef}
              label="Resource"
              autoFocus
              required
              placeholder="Search resources…"
            />
          )}
        />

        <Box>
          <TextField
            label="Quality"
            type="number"
            fullWidth
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            slotProps={{ htmlInput: { min: 0, step: 0.1, 'aria-describedby': 'quality-quick-picks' } }}
            helperText="Optional — kept between entries"
          />
          {resource?.known_qualities && resource.known_qualities.length > 0 && (
            <Stack id="quality-quick-picks" direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
              {resource.known_qualities.map((q) => (
                <Chip
                  key={q}
                  label={q}
                  size="small"
                  color={quality === String(q) ? 'primary' : 'default'}
                  onClick={() => setQuality(String(q))}
                />
              ))}
            </Stack>
          )}
        </Box>

        <TextField
          label={isPieces ? 'Quantity (pieces)' : 'Quantity (SCU)'}
          type="number"
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          slotProps={{ htmlInput: { min: 0, step: isPieces ? 1 : 0.001 } }}
          helperText={isPieces ? 'Whole pieces' : '1 crate = 0.001 SCU'}
        />

        <TextField
          select
          label="Location"
          required
          value={location}
          onChange={(e) => setLocation(e.target.value === '' ? '' : Number(e.target.value))}
        >
          {locations.map((loc) => (
            <MenuItem key={loc.id} value={loc.id}>
              {loc.name}
            </MenuItem>
          ))}
        </TextField>

        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={visibility}
          onChange={(_, value: Visibility | null) => value && setVisibility(value)}
          aria-label="Visibility"
        >
          <ToggleButton value="private">Private</ToggleButton>
          <ToggleButton value="org">Org-visible</ToggleButton>
        </ToggleButtonGroup>

        {createStack.isError && <Alert severity="error">Could not save the stack. Try again.</Alert>}

        <Button type="submit" variant="contained" disabled={!canSubmit || createStack.isPending}>
          {createStack.isPending ? 'Saving…' : 'Add stack'}
        </Button>
      </Stack>
    </Paper>
  )
}
