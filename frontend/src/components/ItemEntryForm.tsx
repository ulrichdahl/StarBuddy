import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { api, unwrapList } from '../lib/api'
import type { CreateItemStack, Item, Location, Visibility } from '../lib/types'
import { LocationSelect } from './LocationSelect'

function useItemSearch(search: string) {
  return useQuery({
    queryKey: ['items', search],
    queryFn: async () => unwrapList<Item>((await api.get('/api/items', { params: { search } })).data),
    placeholderData: keepPreviousData,
  })
}

/**
 * Sticky quick-entry form for item stacks, mirroring the materials form:
 * item → quantity → Enter, focus moving forward on every pick. Items come
 * from the synced wiki catalog; a name with no match is kept verbatim as
 * the class (freeSolo). After submit, location and visibility stay; item +
 * quantity clear; focus returns to the item field.
 */
export function ItemEntryForm() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const itemInputRef = useRef<HTMLInputElement>(null)
  const quantityInputRef = useRef<HTMLInputElement>(null)

  // Sticky fields — survive submits.
  const [location, setLocation] = useState<Location | null>(null)
  const [visibility, setVisibility] = useState<Visibility>('private')

  // Cleared on each submit. `item` is a catalog row or the free-typed class.
  const [item, setItem] = useState<Item | string | null>(null)
  const [itemSearch, setItemSearch] = useState('')
  const [quantity, setQuantity] = useState('')

  const { data: itemOptions = [], isFetching: searching } = useItemSearch(itemSearch)

  const createStack = useMutation({
    mutationFn: (body: CreateItemStack) => api.post('/api/item-stacks', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item-stacks'] })
      queryClient.invalidateQueries({ queryKey: ['org-items'] })
      setItem(null)
      setItemSearch('')
      setQuantity('')
      itemInputRef.current?.focus()
    },
  })

  const chosen = item ?? (itemSearch.trim() !== '' ? itemSearch.trim() : null)
  const canSubmit = chosen !== null && location !== null && quantity !== '' && Number(quantity) > 0

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (chosen === null || !location || !canSubmit) return
    createStack.mutate(
      typeof chosen === 'string'
        ? { item_class: chosen, item_name: null, quantity: Math.round(Number(quantity)), location_id: location.id, visibility }
        : {
            item_class: chosen.class_name ?? chosen.name,
            item_name: chosen.name,
            quantity: Math.round(Number(quantity)),
            location_id: location.id,
            visibility,
          },
    )
  }

  // Arrows step 1 (native), Ctrl+arrows 10, Shift+arrows 100.
  const handleQuantityKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    const dir = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0
    if (dir === 0) return
    const step = event.shiftKey ? 100 : event.ctrlKey ? 10 : null
    if (step === null) return
    event.preventDefault()
    setQuantity(String(Math.max(0, (Number(quantity) || 0) + dir * step)))
  }

  return (
    <Paper component="form" onSubmit={handleSubmit} sx={{ p: 2.5 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {t('items.entry.title')}
      </Typography>
      <Stack spacing={2}>
        <Autocomplete<Item, false, false, true>
          freeSolo
          options={itemOptions}
          value={item}
          onChange={(_, value) => {
            setItem(value)
            if (value) setTimeout(() => quantityInputRef.current?.focus(), 0)
          }}
          inputValue={itemSearch}
          onInputChange={(_, value) => setItemSearch(value)}
          getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
          isOptionEqualToValue={(a, b) => typeof a !== 'string' && typeof b !== 'string' && a.id === b.id}
          // Group headers are the wiki's own type labels — game data, verbatim.
          groupBy={(option) => option.type_label ?? ''}
          renderOption={(props, option) => {
            const { key, ...rest } = props
            const detail = [option.sub_type_label, option.manufacturer].filter(Boolean).join(' · ')
            return (
              <li key={key} {...rest}>
                <Typography noWrap title={detail ? `${option.name} — ${detail}` : option.name} sx={{ minWidth: 0 }}>
                  {option.name}
                  {detail && (
                    <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                      {detail}
                    </Typography>
                  )}
                </Typography>
              </li>
            )
          }}
          loading={searching}
          autoHighlight
          openOnFocus
          filterOptions={(x) => x} // server-side search
          noOptionsText={t('items.entry.noMatch')}
          renderInput={(params) => (
            <TextField
              {...params}
              inputRef={itemInputRef}
              label={t('items.entry.item')}
              autoFocus
              required
              placeholder={t('items.entry.itemPlaceholder')}
            />
          )}
        />

        <TextField
          label={t('items.entry.quantity')}
          type="number"
          required
          inputRef={quantityInputRef}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onKeyDown={handleQuantityKeys}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
          helperText={t('items.entry.quantityHint')}
        />

        <LocationSelect
          value={location}
          onChange={setLocation}
          label={t('items.entry.location')}
          required
          helperText={t('items.entry.locationKept')}
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
          aria-label={t('items.entry.visibilityAria')}
        >
          <ToggleButton value="private">{t('items.entry.private')}</ToggleButton>
          <ToggleButton value="org">{t('items.entry.orgVisible')}</ToggleButton>
        </ToggleButtonGroup>

        {createStack.isError && <Alert severity="error">{t('items.entry.saveFailed')}</Alert>}

        <Button type="submit" variant="contained" disabled={!canSubmit || createStack.isPending}>
          {createStack.isPending ? t('common.saving') : t('items.entry.submit')}
        </Button>
      </Stack>
    </Paper>
  )
}
