import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { api, apiErrorDetail, unwrapList } from '../lib/api'
import { formatDuration, parseDuration } from '../lib/refining'
import { LocationSelect } from './LocationSelect'
import { VisibilitySelect } from './VisibilitySelect'
import {
  blankLine,
  lineIsComplete,
  linesToMaterials,
  materialsToLines,
  RefineryOrderSheet,
  type OrderLine,
} from './RefineryOrderSheet'
import { useNow } from '../lib/useNow'
import type { Location, RefineryOrderDetail, ResourceType, Visibility } from '../lib/types'

/** `'new'` records an order by hand; a number opens the one with that id. */
export type RefineryOrderTarget = number | 'new' | null

/**
 * One refinery order, in the shape the terminal shows it.
 *
 * The same sheet records a new order, corrects one the refinery is still
 * holding, and shows a collected one frozen — so a player reads a job in the
 * layout they typed it in, and a mistake stays fixable right up until the
 * materials are in hand. Collecting is the other thing the dialog does: the
 * materials already count as the player's while they refine, and collecting
 * says where they physically went, which is often not the refinery.
 */
export function RefineryOrderDialog({ id, onClose }: { id: RefineryOrderTarget; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const creating = id === 'new'

  // Where a collected haul went. It only holds a value once the player picks
  // one, and the order it was picked for is remembered — the dialog is reused
  // for every order, so a pick made for one must not carry into the next.
  const [picked, setPicked] = useState<{ order: number; destination?: Location | null }>()

  // The sheet's own state. An existing order fills it in once loaded; a new one
  // starts on a single empty line.
  const [station, setStation] = useState<Location | null>(null)
  const [method, setMethod] = useState<string | null>(null)
  const [rows, setRows] = useState<OrderLine[]>(() => [blankLine()])
  const [cost, setCost] = useState('')
  const [duration, setDuration] = useState('')
  /**
   * Whether anyone has actually set the clock. Until they have, a running
   * order is saved with the time it has left rather than the time it was
   * given: re-anchoring an untouched order to its original length would push
   * the finish out by a whole job every time a number beside it was corrected.
   */
  const [timeEdited, setTimeEdited] = useState(false)
  const [shareWith, setShareWith] = useState<Visibility>('private')
  /** The order the sheet was filled from, so it refills when a different one opens. */
  const [filled, setFilled] = useState<RefineryOrderTarget>(null)
  const [showLines, setShowLines] = useState(false)

  const order = useQuery({
    queryKey: ['refinery-order', id],
    queryFn: async () => (await api.get<RefineryOrderDetail>(`/api/refinery-orders/${id}`)).data,
    enabled: id !== null && !creating,
  })

  // The catalogue, so an order's materials come back as the rows they were —
  // with their quality bands — rather than as bare names.
  const { data: catalog = [] } = useQuery({
    queryKey: ['resource-types', ''],
    queryFn: async () => unwrapList<ResourceType>((await api.get('/api/resource-types')).data),
    enabled: id !== null,
  })

  const data = order.data
  const unit = data?.unit ?? 'cSCU'

  useEffect(() => {
    if (id === null || id === filled) return
    if (creating) {
      setStation(null)
      setMethod(null)
      setRows([blankLine()])
      setCost('')
      setDuration('')
      setTimeEdited(false)
      setShareWith('private')
      setFilled(id)
      return
    }
    // Wait for both the order and the catalogue: hydrating from one without the
    // other would drop the quality bands from every row.
    if (!data || catalog.length === 0) return
    setStation(data.location)
    setMethod(data.method)
    setRows([...materialsToLines(data.materials, catalog), blankLine()])
    setShareWith(data.visibility)
    setCost(data.cost === null ? '' : String(data.cost))
    // Exact, so an order opened and saved without touching the field keeps
    // the length it had rather than being rounded down to whole minutes.
    setDuration(data.duration_seconds === null ? '' : formatDuration(data.duration_seconds, undefined, { exact: true }))
    setTimeEdited(false)
    setFilled(id)
  }, [id, filled, creating, data, catalog])

  // Ticks, so an order counts down while the dialog is open.
  const now = useNow(1000)
  const remaining = useMemo(() => {
    if (!data?.eta || !data.open) return null
    return Math.round((new Date(data.eta).getTime() - now) / 1000)
  }, [data, now])

  /**
   * Which of the three things an order can be, which is what decides both
   * whether the sheet edits and which single button ends its footer row.
   *
   * An order with no ETA counts as still running: nothing has said it is done,
   * and locking a job nobody gave a length to would leave it uneditable with
   * no way back. Setting its time left to zero is what finishes it.
   */
  const collected = !creating && data !== undefined && !data.open
  const ready = data?.open === true && remaining !== null && remaining <= 0
  // Editing is for a job the refinery is still working on. Once it is ready the
  // numbers are what they were, and the only thing left to do is pick it up.
  const frozen = collected || ready

  const mine = picked?.order === id ? picked : undefined
  // The materials are at the refinery until someone moves them, so that is the
  // honest default: collecting without touching this records where they already
  // are, and changing it records the transfer.
  const destination = mine && 'destination' in mine ? mine.destination ?? null : data?.location ?? null
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString(i18n.language))

  /** What the sheet says, in the shape the API takes. */
  const body = () => {
    const materials = linesToMaterials(rows)
    const seconds = !timeEdited && remaining !== null ? Math.max(0, remaining) : parseDuration(duration)
    return {
      station: station?.name ?? '',
      method,
      materials,
      // A new order is read off a terminal, which counts in centi-SCU; an
      // edit keeps whatever unit the order was recorded in.
      unit,
      duration_seconds: seconds,
      // An order still running has an ETA; one already done does not need one.
      eta: seconds === null ? null : new Date(Date.now() + seconds * 1000).toISOString(),
      state: seconds !== null && seconds > 0 ? ('processing' as const) : ('completed' as const),
      cost: cost.trim() === '' ? null : Number(cost.replace(',', '.')),
      yield_total: materials.reduce((sum, m) => sum + (m.yield_amount ?? 0), 0),
      // Always what the sheet is showing. An edit cannot reshare by accident
      // because the control starts on the order's own answer.
      visibility: shareWith,
    }
  }

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['refinery-orders'] })
    void queryClient.invalidateQueries({ queryKey: ['refinery-order', id] })
    void queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
    void queryClient.invalidateQueries({ queryKey: ['craftability'] })
  }

  const save = useMutation({
    mutationFn: async () =>
      creating
        ? (await api.post<RefineryOrderDetail>('/api/refinery-orders', { ...body(), source: 'manual' })).data
        : (await api.patch<RefineryOrderDetail>(`/api/refinery-orders/${id}`, body())).data,
    onSuccess: () => {
      refresh()
      close()
    },
  })

  const collect = useMutation({
    mutationFn: async (locationId: number) =>
      (
        await api.post<RefineryOrderDetail>(`/api/refinery-orders/${id}/collect`, {
          location_id: locationId,
          // Whatever the sheet is showing, which started as the order's own
          // answer — so collecting cannot quietly reshare a haul either.
          visibility: shareWith,
        })
      ).data,
    onSuccess: () => {
      // The stacks moved, so the material lists are stale too.
      refresh()
      close()
    },
  })

  // Deleting is destructive and sits next to the buttons that are not, so it
  // asks first — in place, rather than stacking a second dialog on this one.
  const [confirmDelete, setConfirmDelete] = useState(false)

  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/refinery-orders/${id}`)
    },
    onSuccess: () => {
      refresh()
      close()
    },
  })

  const close = () => {
    setFilled(null)
    setConfirmDelete(false)
    onClose()
  }

  const savable = station !== null && rows.some(lineIsComplete) && !save.isPending

  return (
    <Dialog open={id !== null} onClose={close} maxWidth="md" fullWidth>
      {/* The refinery is named in the sheet's first field, so the title says
          what the dialog is and leaves the marks about this particular order
          to the right-hand end. */}
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          {creating ? t('refinery.sheet.newTitle') : t('refinery.sheet.title')}
        </Box>
        {data && (
          <>
            {data.work_order_number !== null && (
              <Chip size="small" label={t('refinery.dialog.number', { number: data.work_order_number })} />
            )}
            {/* Read off the same clock the buttons are, so an order that
                finishes while the dialog is open says so as it happens. */}
            <Chip
              size="small"
              variant="outlined"
              color={collected ? 'primary' : ready ? 'success' : 'secondary'}
              label={t(
                collected ? 'refinery.status.collected' : ready ? 'refinery.status.ready' : 'refinery.status.inProgress',
              )}
            />
            <Chip size="small" variant="outlined" label={data.source} />
          </>
        )}
      </DialogTitle>

      <DialogContent dividers>
        {order.isLoading && <CircularProgress aria-label={t('common.loading')} />}
        {order.isError && <Alert severity="error">{t('refinery.loadFailed')}</Alert>}

        {(creating || data) && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <RefineryOrderSheet
              location={station}
              onLocation={setStation}
              method={method}
              onMethod={setMethod}
              rows={rows}
              setRows={setRows}
              cost={cost}
              onCost={setCost}
              duration={duration}
              onDuration={(next, typed) => { if (typed) setTimeEdited(true); setDuration(next) }}
              unit={unit}
              autoFocus={creating}
              readOnly={frozen}
              remaining={remaining}
            />

            {ready && <Alert severity="success">{t('refinery.sheet.readyFrozen')}</Alert>}
            {collected && <Alert severity="info">{t('refinery.sheet.frozen')}</Alert>}

            {data && data.unmatched.length > 0 && (
              <Alert severity="warning">
                {t('refinery.dialog.unmatched', { materials: data.unmatched.join(', ') })}
              </Alert>
            )}

            {data?.capture && (
              <Box>
                <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {data.capture.ship && <Detail label={t('refinery.dialog.ship')} value={data.capture.ship} />}
                  {data.capture.method_traits && (
                    <Detail label={t('refinery.dialog.traits')} value={data.capture.method_traits} />
                  )}
                  {data.capture.captures !== undefined && data.capture.captures > 1 && (
                    <Detail label={t('refinery.dialog.captures')} value={String(data.capture.captures)} />
                  )}
                  {data.yield_total !== null && (
                    <Detail
                      label={t('refinery.sheet.recordedYield')}
                      value={`${fmt(data.yield_total)} ${data.unit}`}
                    />
                  )}
                </Stack>
                {data.capture.lines && data.capture.lines.length > 0 && (
                  <>
                    <Button size="small" sx={{ mt: 1 }} onClick={() => setShowLines((v) => !v)}>
                      {t(showLines ? 'refinery.dialog.hideLines' : 'refinery.dialog.showLines', {
                        count: data.capture.lines.length,
                      })}
                    </Button>
                    {showLines && (
                      <Box
                        component="pre"
                        sx={{
                          mt: 1,
                          maxHeight: 200,
                          overflow: 'auto',
                          fontSize: '0.75rem',
                          bgcolor: 'action.hover',
                          p: 1,
                          borderRadius: 1,
                        }}
                      >
                        {data.capture.lines.join('\n')}
                      </Box>
                    )}
                  </>
                )}
              </Box>
            )}

            {data && !data.open && data.collected_location && (
              <Alert severity="success">
                {t('refinery.dialog.collectedTo', { location: data.collected_location.name })}
              </Alert>
            )}

            {save.isError && (
              <Alert severity="error">{apiErrorDetail(save.error) ?? t('refinery.sheet.saveFailed')}</Alert>
            )}
            {collect.isError && (
              <Alert severity="error">{apiErrorDetail(collect.error) ?? t('refinery.dialog.collectFailed')}</Alert>
            )}
            {remove.isError && (
              <Alert severity="error">{apiErrorDetail(remove.error) ?? t('refinery.sheet.deleteFailed')}</Alert>
            )}
          </Stack>
        )}
      </DialogContent>

      {/*
        One row, one action. Which one the order's state decides: a job the
        refinery is still working on is saved, a finished one is collected, a
        collected one asks for nothing. Who sees the haul is the question every
        state shares, so it sits immediately left of whichever button commits.
        Aligned to the top, with the buttons held to the band an input occupies,
        so the pickers' helper text cannot drag them off the line.
      */}
      <DialogActions sx={{ px: 3, py: 2, gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/*
          Held at the far left, as far from the commit button as the row
          allows: an order deleted by accident cannot be got back, and the
          confirmation is what makes the second click mean it.
        */}
        {!creating && data && (
          // Kept to two controls at their widest, so the row it shares with the
          // collect picker, the sharing switch and the commit button stays one
          // row: wrapping put the delete on a line of its own, which reads as
          // belonging to the sheet rather than to the actions.
          <Box sx={{ height: 40, display: 'flex', alignItems: 'center', gap: 1, mr: ready ? 2 : 'auto' }}>
            {confirmDelete ? (
              <>
                <Button
                  color="error"
                  variant="contained"
                  disabled={remove.isPending}
                  title={t(collected ? 'refinery.sheet.deleteHelpCollected' : 'refinery.sheet.deleteHelp')}
                  onClick={() => remove.mutate()}
                >
                  {remove.isPending ? t('refinery.sheet.deleting') : t('refinery.sheet.deleteConfirm')}
                </Button>
                <Button onClick={() => setConfirmDelete(false)}>{t('refinery.sheet.deleteCancel')}</Button>
              </>
            ) : (
              <Button color="error" onClick={() => setConfirmDelete(true)}>
                {t('refinery.sheet.delete')}
              </Button>
            )}
          </Box>
        )}
        {ready && (
          <LocationSelect
            value={destination}
            onChange={(next) => setPicked({ order: id as number, destination: next })}
            label={t('refinery.dialog.destination')}
            helperText={t('refinery.dialog.destinationHelp')}
            required
            size="small"
            // Held to the left edge, under the sheet's own left-hand fields;
            // the auto margin pushes the sharing switch and the buttons to the
            // other end of the row.
            sx={{ width: 220, mr: 'auto' }}
          />
        )}
        {(creating || data) && !collected && (
          // No caption beside the switch. Private/Org-visible says what it
          // does, and the words that explained it were the last thing the row
          // could afford: with them there the commit button wrapped to a line
          // of its own, away from the delete and the collect picker it belongs
          // with. The explanation stays on the switch itself.
          <Box
            sx={{ height: 40, display: 'flex', alignItems: 'center' }}
            title={t('refinery.dialog.visibilityHelp')}
          >
            <VisibilitySelect
              value={shareWith}
              onChange={setShareWith}
              label={t('refinery.dialog.visibility')}
              fullWidth={false}
            />
          </Box>
        )}
        <Box sx={{ height: 40, display: 'flex', alignItems: 'center', gap: 1 }}>
          {!collected && (ready ? (
            <Button
              variant="contained"
              disabled={destination === null || collect.isPending}
              onClick={() => destination !== null && collect.mutate(destination.id)}
            >
              {collect.isPending ? t('refinery.dialog.collecting') : t('refinery.dialog.collect')}
            </Button>
          ) : (
            <Button variant="contained" disabled={!savable} onClick={() => save.mutate()}>
              {save.isPending
                ? t('common.saving')
                : creating
                  ? t('refinery.sheet.create')
                  : t('refinery.sheet.save')}
            </Button>
          ))}
          <Button onClick={close}>{t('common.close')}</Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  )
}
