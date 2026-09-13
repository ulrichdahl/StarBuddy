import { Fragment, useState } from 'react'
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
import Chip from '@mui/material/Chip'
import type { Location, StockKind, Visibility } from '../lib/types'
import { qualityColor, rarityColor } from '../lib/rarity'
import { LocationSelect } from './LocationSelect'
import { VisibilitySelect } from './VisibilitySelect'

type Mode = 'move' | 'share' | 'sell'

/** One picked stack, in the little the dialog needs of it. */
export interface HandoverStack {
  id: number
  name: string
  quality: number | null
  /** How much is held, in the unit the player types. */
  held: number
  /** What that number means: "SCU" or "pcs". */
  unit: string
  /** Storage units per typed unit — 1000 for SCU-measured materials, else 1. */
  factor: number
  /** Smallest step the field allows, in the typed unit. */
  step: number
  /** The material's own rarity, where it has one — items go by quality. */
  rarity?: string | null
}

interface Props {
  open: boolean
  stock: StockKind
  stacks: HandoverStack[]
  onClose: () => void
  onDone: (mode: Mode, count: number) => void
}

/**
 * What to do with a hold someone has picked out: move it, share it, or sell
 * it.
 *
 * Each does one thing to every stack selected, because the alternative —
 * correcting twenty stacks one at a time after flying a load somewhere — is
 * why inventories go stale. There is no separate "give away": a price of zero
 * is a gift, and recording it the same way keeps one ledger instead of two.
 */
export function StockHandoverDialog({ open, stock, stacks, onClose, onDone }: Props) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('move')
  const [location, setLocation] = useState<Location | null>(null)
  const [handle, setHandle] = useState('')
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('org')
  /**
   * How much of each stack is going, in the unit the player reads. Empty until
   * they touch it, which means "all of it" — the common answer, and the one
   * that needs no typing.
   */
  const [amounts, setAmounts] = useState<Record<number, string>>({})

  // Org mates are the likely recipients, so they are offered before anything
  // is typed — but the field takes any name, so this is a convenience only.
  const { data: mates = [] } = useQuery({
    queryKey: ['org-mates'],
    queryFn: async () => (await api.get<{ id: number; handle: string }[]>('/api/org/mates')).data,
    enabled: open,
  })

  /** What was typed for a stack, or everything it holds. */
  const taken = (s: HandoverStack) => {
    const typed = amounts[s.id]
    if (typed === undefined || typed.trim() === '') return s.held
    const value = Number(typed.replace(',', '.'))
    return Number.isFinite(value) ? Math.min(Math.max(value, 0), s.held) : s.held
  }
  // Storage units: mSCU for crate goods, pieces for everything else.
  const lines = () => stacks.map((s) => ({ id: s.id, quantity: Math.round(taken(s) * s.factor) }))
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
    void queryClient.invalidateQueries({ queryKey: ['item-stacks'] })
    void queryClient.invalidateQueries({ queryKey: ['stock-transfers'] })
    void queryClient.invalidateQueries({ queryKey: ['craftability'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const act = useMutation({
    mutationFn: async () => {
      const body = { stock, stacks: lines() }
      if (mode === 'move') {
        return (await api.post('/api/stock-transfers/move', { ...body, location_id: location?.id })).data
      }
      if (mode === 'share') {
        return (await api.post('/api/stock-transfers/visibility', { ...body, visibility })).data
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
    setVisibility('org')
    setAmounts({})
    act.reset()
    onClose()
  }

  const priceNumber = Number(price.replace(',', '.'))
  // Nothing at all is not an action; the rest of the amounts may be zero.
  const anyTaken = stacks.some((s) => taken(s) > 0)
  const ready =
    mode === 'move'
      ? location !== null && anyTaken
      : mode === 'share'
        ? true
        : handle.trim() !== '' && price.trim() !== '' && Number.isFinite(priceNumber) && priceNumber >= 0 && anyTaken

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
          <Tab value="share" label={t('stock.handover.share')} />
          <Tab value="sell" label={t('stock.handover.sell')} />
        </Tabs>

        <Stack spacing={2}>
          {mode === 'move' && (
            <LocationSelect value={location} onChange={setLocation} label={t('stock.handover.newLocation')} required />
          )}

          {mode === 'share' && (
            <>
              <VisibilitySelect value={visibility} onChange={setVisibility} label={t('stock.handover.visibility')} />
              <Alert severity="info">{t('stock.handover.visibilityHelp')}</Alert>
            </>
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
              {/* Sharing is per stack whatever is typed here, so the amounts
                  only mean something when something is leaving. */}
              {mode === 'share' ? t('stock.handover.contents') : t('stock.handover.howMuch')}
            </Typography>
            {mode === 'share' ? (
              <Typography variant="body2" color="text.secondary">
                {stacks
                  .map((s) => `${s.name}${s.quality === null ? '' : ` ${s.quality}`} · ${s.held} ${s.unit}`)
                  .join(' · ')}
              </Typography>
            ) : (
              // One grid rather than a stack of rows: a column sized to the
              // widest cell in it is the only way the pills, the fields and
              // the totals line up down the list.
              <Box
                sx={{
                  mt: 1,
                  maxHeight: 260,
                  overflowY: 'auto',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto 116px auto auto',
                  alignItems: 'center',
                  columnGap: 1,
                  rowGap: 1,
                }}
              >
                {stacks.map((s) => (
                  <Fragment key={s.id}>
                    <Typography
                      variant="body2"
                      noWrap
                      title={s.name}
                      sx={{
                        minWidth: 0,
                        // The same rarity edge the lists carry, so a hold
                        // reads the same here as in the table it came from.
                        borderLeft: 3,
                        borderColor: rarityColor(s.rarity),
                        pl: 1,
                      }}
                    >
                      {s.name}
                    </Typography>
                    {s.quality === null ? (
                      <Box />
                    ) : (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={s.quality}
                        sx={{
                          fontVariantNumeric: 'tabular-nums',
                          color: qualityColor(s.quality),
                          borderColor: qualityColor(s.quality),
                        }}
                      />
                    )}
                    <TextField
                      size="small"
                      type="number"
                      value={amounts[s.id] ?? String(s.held)}
                      onChange={(e) => setAmounts({ ...amounts, [s.id]: e.target.value })}
                      slotProps={{ htmlInput: { min: 0, max: s.held, step: s.step, 'aria-label': s.name } }}
                    />
                    {/* What "all of it" would be, so a part can be judged
                        against the whole without leaving the field. */}
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                      {t('stock.handover.ofHeld', { held: s.held.toLocaleString(i18n.language), unit: s.unit })}
                    </Typography>
                    <Button
                      size="small"
                      sx={{ minWidth: 0, px: 1 }}
                      disabled={taken(s) === s.held}
                      onClick={() => setAmounts({ ...amounts, [s.id]: String(s.held) })}
                    >
                      {t('stock.handover.all')}
                    </Button>
                  </Fragment>
                ))}
              </Box>
            )}
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
              : mode === 'share'
                ? t('stock.handover.confirmShare')
                : priceNumber > 0
                  ? t('stock.handover.confirmSell')
                  : t('stock.handover.confirmGive')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
