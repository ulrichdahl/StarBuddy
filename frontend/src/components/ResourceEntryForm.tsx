import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import InputAdornment from '@mui/material/InputAdornment'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { api, unwrapList } from '../lib/api'
import type { CreateResourceStack, Location, ResourceType, Visibility } from '../lib/types'
import { LocationSelect } from './LocationSelect'

/**
 * Sticky quick-entry form for resource stacks, tuned for keyboard-only
 * bulk entry: resource → quality → quantity → Enter, and focus jumps
 * forward on every selection. After submit, location, visibility and
 * quality stay; resource + quantity clear; focus returns to resource.
 */
export function ResourceEntryForm() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const resourceInputRef = useRef<HTMLInputElement>(null)
  const qualityInputRef = useRef<HTMLInputElement>(null)
  const quantityInputRef = useRef<HTMLInputElement>(null)

  // Sticky fields — survive submits.
  const [location, setLocation] = useState<Location | null>(null)
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
        (
          await api.get('/api/resource-types', {
            // Entry is for stash-able crafting materials: refined + gems only.
            params: { search: resourceSearch, categories: 'refined,gem' },
          })
        ).data,
      ),
  })

  const isPieces = resource?.unit === 'pieces'
  const knownQualities = resource?.known_qualities ?? []

  const createStack = useMutation({
    mutationFn: (body: CreateResourceStack) => api.post('/api/resource-stacks', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
      queryClient.invalidateQueries({ queryKey: ['org-materials'] })
      queryClient.invalidateQueries({ queryKey: ['resource-types'] })
      setResource(null)
      setResourceSearch('')
      setQuantity('')
      resourceInputRef.current?.focus()
    },
  })

  const canSubmit =
    resource !== null && location !== null && quantity !== '' && Number(quantity) > 0 && quality !== ''

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!resource || !location || !canSubmit) return
    createStack.mutate({
      resource_type_id: resource.id,
      quality: Number(quality),
      location_id: location.id,
      visibility,
      ...(isPieces
        ? { quantity_pieces: Math.round(Number(quantity)) }
        : { quantity_mscu: Math.round(Number(quantity) * 1000) }),
    })
  }

  // Arrows step 0.001 SCU (native `step`), Ctrl+arrows 0.01, Shift+arrows
  // 0.1 — for gems: 1 / 10 / 100 pieces.
  const handleQuantityKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    const dir = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0
    if (dir === 0) return

    let step: number | null = null
    if (event.shiftKey) step = isPieces ? 100 : 0.1
    else if (event.ctrlKey) step = isPieces ? 10 : 0.01
    if (step === null) return // plain arrows: native 0.001 / 1 step

    event.preventDefault()
    const next = Math.max(0, (Number(quantity) || 0) + dir * step)
    setQuantity(isPieces ? String(Math.round(next)) : next.toFixed(3).replace(/\.?0+$/, '').replace(/\.$/, ''))
  }

  return (
    <Paper component="form" onSubmit={handleSubmit} sx={{ p: 2.5 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {t('materials.entry.title')}
      </Typography>
      <Stack spacing={2}>
        <Autocomplete
          options={resourceOptions}
          value={resource}
          onChange={(_, value) => {
            setResource(value)
            // A different resource has different bands — a stale sticky
            // quality must not survive the switch.
            if (value && quality && (value.known_qualities ?? []).length > 0
              && !(value.known_qualities ?? []).includes(Number(quality))) {
              setQuality('')
            }
            if (value) setTimeout(() => qualityInputRef.current?.focus(), 0)
          }}
          inputValue={resourceSearch}
          onInputChange={(_, value) => setResourceSearch(value)}
          getOptionLabel={(option) => option.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          // Category group headers are UI labels; unknown categories shown verbatim.
          groupBy={(option) => t(`materials.category.${option.category}`, { defaultValue: option.category })}
          loading={searching}
          autoHighlight
          openOnFocus
          filterOptions={(x) => x} // server-side search
          renderInput={(params) => (
            <TextField
              {...params}
              inputRef={resourceInputRef}
              label={t('materials.fields.material')}
              autoFocus
              required
              placeholder={t('materials.entry.materialPlaceholder')}
            />
          )}
        />

        {knownQualities.length > 0 ? (
          // Strict: only this resource's actual bands are selectable.
          <Autocomplete
            options={knownQualities.map(String)}
            value={quality || null}
            onChange={(_, value) => {
              setQuality(value ?? '')
              if (value) setTimeout(() => quantityInputRef.current?.focus(), 0)
            }}
            autoHighlight
            openOnFocus
            renderInput={(params) => (
              <TextField
                {...params}
                inputRef={qualityInputRef}
                label={t('materials.fields.quality')}
                required
                helperText={t('materials.entry.qualityBandsHelp')}
              />
            )}
          />
        ) : (
          <TextField
            label={t('materials.fields.quality')}
            type="number"
            required
            inputRef={qualityInputRef}
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            slotProps={{ htmlInput: { min: 0, max: 1000, step: 1 } }}
            helperText={t('materials.entry.qualityNoBandsHelp')}
          />
        )}
      </Stack>
      <Stack spacing={2} sx={{ mt: 2 }}>

        <TextField
          label={t('materials.fields.quantity')}
          type="number"
          required
          inputRef={quantityInputRef}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onKeyDown={handleQuantityKeys}
          slotProps={{
            htmlInput: { min: 0, step: isPieces ? 1 : 0.001 },
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  {isPieces ? t('materials.units.pcs') : t('materials.units.scu')}
                </InputAdornment>
              ),
            },
          }}
          helperText={isPieces ? t('materials.entry.quantityHintPieces') : t('materials.entry.quantityHintScu')}
        />

        <LocationSelect
          value={location}
          onChange={setLocation}
          label={t('materials.fields.location')}
          required
          helperText={t('materials.entry.locationKept')}
        />

        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={visibility}
          onChange={(_, value: Visibility | null) => value && setVisibility(value)}
          // Arrows switch the value directly — no Space needed.
          onKeyDown={(e) => {
            if (e.key.startsWith('Arrow')) {
              e.preventDefault()
              setVisibility(visibility === 'private' ? 'org' : 'private')
            }
          }}
          aria-label={t('materials.fields.visibility')}
        >
          <ToggleButton value="private">{t('materials.visibility.private')}</ToggleButton>
          <ToggleButton value="org">{t('materials.visibility.org')}</ToggleButton>
        </ToggleButtonGroup>

        {createStack.isError && <Alert severity="error">{t('materials.entry.saveError')}</Alert>}

        <Button type="submit" variant="contained" disabled={!canSubmit || createStack.isPending}>
          {createStack.isPending ? t('common.saving') : t('materials.entry.addStack')}
        </Button>
      </Stack>
    </Paper>
  )
}
