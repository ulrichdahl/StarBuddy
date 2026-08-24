import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
        Quick entry
      </Typography>
      <Stack spacing={2}>
        <TextField
          label="Item class"
          required
          autoFocus
          inputRef={itemInputRef}
          value={itemClass}
          onChange={(e) => setItemClass(e.target.value)}
          placeholder="e.g. Quantum Drive — Atlas"
        />
        <TextField
          label="Quantity"
          type="number"
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
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

        {createStack.isError && <Alert severity="error">Could not save the item stack. Try again.</Alert>}

        <Button type="submit" variant="contained" disabled={!canSubmit || createStack.isPending}>
          {createStack.isPending ? 'Saving…' : 'Add stack'}
        </Button>
      </Stack>
    </Paper>
  )
}
