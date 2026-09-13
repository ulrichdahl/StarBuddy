import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { api } from '../lib/api'
import type { Location, StockKind } from '../lib/types'
import { LocationSelect } from './LocationSelect'

type Mode = 'move' | 'sell'

/** One picked stack, in the little the dialog needs of it. */
export interface HandoverStack {
  id: number
  name: string
  quality: number | null
  amount: string
}

interface Props {
  open: boolean
  stock: StockKind
  stacks: HandoverStack[]
  onClose: () => void
  onDone: (mode: Mode, count: number) => void
}

/**
 * What to do with a hold someone has picked out: move it, or hand it to
 * another player.
 *
 * Both do one thing to every stack selected, because the alternative —
 * correcting twenty stacks one at a time after flying a load somewhere — is
 * why inventories go stale. There is no separate "give away": a price of zero
 * is a gift, and recording it the same way keeps one ledger instead of two.
 */
export function StockHandoverDialog({ open, stock, stacks, onClose, onDone }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('move')
  const [location, setLocation] = useState<Location | null>(null)
  const [handle, setHandle] = useState('')
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')

  // Org mates are the likely recipients, so they are offered before anything
  // is typed — but the field takes any name, so this is a convenience only.
  const { data: mates = [] } = useQuery({
    queryKey: ['org-mates'],
    queryFn: async () => (await api.get<{ id: number; handle: string }[]>('/api/org/mates')).data,
    enabled: open,
  })

  const ids = stacks.map((s) => s.id)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
    void queryClient.invalidateQueries({ queryKey: ['item-stacks'] })
    void queryClient.invalidateQueries({ queryKey: ['stock-transfers'] })
    void queryClient.invalidateQueries({ queryKey: ['craftability'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const act = useMutation({
    mutationFn: async () => {
      const body = { stock, stack_ids: ids }
      if (mode === 'move') {
        return (await api.post('/api/stock-transfers/move', { ...body, location_id: location?.id })).data
      }
      return (
        await api.post('/api/stock-transfers', {
          ...body,
          to_handle: handle.trim(),
          price: Number(price.replace(',', '.')),
          note: note.trim() || null,
        })
      ).data
    },
    onSuccess: () => {
      refresh()
      onDone(mode, stacks.length)
      close()
    },
  })

  const close = () => {
    setMode('move')
    setLocation(null)
    setHandle('')
    setPrice('')
    setNote('')
    act.reset()
    onClose()
  }

  const priceNumber = Number(price.replace(',', '.'))
  const ready =
    mode === 'move'
      ? location !== null
      : handle.trim() !== '' && price.trim() !== '' && Number.isFinite(priceNumber) && priceNumber >= 0

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 0 }}>
        {t('stock.handover.title', { count: stacks.length })}
        <Typography variant="body2" color="text.secondary">
          {t('stock.handover.subtitle')}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Tabs value={mode} onChange={(_, m: Mode) => setMode(m)} sx={{ mb: 2 }}>
          <Tab value="move" label={t('stock.handover.move')} />
          <Tab value="sell" label={t('stock.handover.sell')} />
        </Tabs>

        <Stack spacing={2}>
          {mode === 'move' && (
            <LocationSelect value={location} onChange={setLocation} label={t('stock.handover.newLocation')} required />
          )}

          {mode === 'sell' && (
            <>
              {/* Free text with the org offered: a buyer may never have heard
                  of StarBuddy, and the sale is worth recording anyway. */}
              <Autocomplete
                freeSolo
                options={mates.map((m) => m.handle)}
                value={handle}
                onInputChange={(_, v) => setHandle(v)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t('stock.handover.buyer')}
                    helperText={t('stock.handover.handleHelp')}
                    required
                  />
                )}
              />
              <TextField
                label={t('stock.handover.price')}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                type="number"
                required
                helperText={t('stock.handover.priceHelp')}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
              />
              <TextField
                label={t('stock.handover.note')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                multiline
                minRows={2}
              />
              <Alert severity="info">{t('stock.handover.handoverHelp')}</Alert>
            </>
          )}

          {act.isError && <Alert severity="error">{t('stock.handover.failed')}</Alert>}

          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('stock.handover.contents')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {stacks
                .map((s) => `${s.name}${s.quality === null ? '' : ` ${s.quality}`} · ${s.amount}`)
                .join(' · ')}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={!ready || act.isPending} onClick={() => act.mutate()}>
          {act.isPending
            ? t('common.saving')
            : mode === 'move'
              ? t('stock.handover.confirmMove')
              : priceNumber > 0
                ? t('stock.handover.confirmSell')
                : t('stock.handover.confirmGive')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
