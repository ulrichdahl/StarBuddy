import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { api, unwrapList } from '../lib/api'
import type { CreateItemStack, Location, Visibility } from '../lib/types'

/**
 * Sticky quick-entry form for item stacks (same bulk-entry ergonomics as
 * resources, minus quality): location + visibility persist across submits,
 * item + quantity clear, focus returns to the item field.
 */
export function ItemEntryForm() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const itemInputRef = useRef<HTMLInputElement>(null)

  const [location, setLocation] = useState<number | ''>('')
  const [visibility, setVisibility] = useState<Visibility>('private')
  const [itemClass, setItemClass] = useState('')
  const [quantity, setQuantity] = useState('')

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: async () => unwrapList<Location>((await api.get('/api/locations')).data),
  })

  const createStack = useMutation({
    mutationFn: (body: CreateItemStack) => api.post('/api/item-stacks', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item-stacks'] })
      setItemClass('')
      setQuantity('')
      itemInputRef.current?.focus()
    },
  })

  const canSubmit = itemClass.trim() !== '' && location !== '' && quantity !== '' && Number(quantity) > 0

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (location === '' || !canSubmit) return
    createStack.mutate({
      item_class: itemClass.trim(),
      quantity: Math.round(Number(quantity)),
      location_id: location,
      visibility,
    })
  }

  return (
    <Paper component="form" onSubmit={handleSubmit} sx={{ p: 2.5 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {t('items.entry.title')}
      </Typography>
      <Stack spacing={2}>
        <TextField
          label={t('items.entry.itemClass')}
          required
          autoFocus
          inputRef={itemInputRef}
          value={itemClass}
          onChange={(e) => setItemClass(e.target.value)}
          placeholder={t('items.entry.itemClassPlaceholder')}
        />
        <TextField
          label={t('items.entry.quantity')}
          type="number"
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
        />
        <TextField
          select
          label={t('items.entry.location')}
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
