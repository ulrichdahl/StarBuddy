import { useMemo, useState } from 'react'
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
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { api, apiErrorDetail } from '../lib/api'
import { LocationSelect } from './LocationSelect'
import { VisibilitySelect } from './VisibilitySelect'
import { useNow } from '../lib/useNow'
import type { Location, RefineryOrderDetail, Visibility } from '../lib/types'

/**
 * One refinery order in full: what the terminal showed, and what to do with it.
 *
 * Collecting is the point of the dialog. The materials are already counted as
 * the player's while they refine; collecting says where they physically went,
 * which is often not the refinery — a haul is usually transferred straight into
 * a ship or a hangar on pickup.
 */
export function RefineryOrderDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  // Both controls start from the order and only hold a value once the player
  // changes one, and the order they were changed for is remembered — the
  // dialog is reused for every order, so a pick made for one must not carry
  // into the next.
  const [picked, setPicked] = useState<{ order: number; destination?: Location | null; visibility?: Visibility }>()
  const [showLines, setShowLines] = useState(false)

  const order = useQuery({
    queryKey: ['refinery-order', id],
    queryFn: async () => (await api.get<RefineryOrderDetail>(`/api/refinery-orders/${id}`)).data,
    enabled: id !== null,
  })

  const collect = useMutation({
    mutationFn: async (locationId: number) =>
      (
        await api.post<RefineryOrderDetail>(`/api/refinery-orders/${id}/collect`, {
          location_id: locationId,
          // Left alone unless the player changed it, so collecting does not
          // quietly reshare a haul they had kept to themselves.
          ...(mine?.visibility ? { visibility: mine.visibility } : {}),
        })
      ).data,
    onSuccess: () => {
      // The stacks moved, so the material lists are stale too.
      void queryClient.invalidateQueries({ queryKey: ['refinery-orders'] })
      void queryClient.invalidateQueries({ queryKey: ['refinery-order', id] })
      void queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
      void queryClient.invalidateQueries({ queryKey: ['craftability'] })
      onClose()
    },
  })

  const data = order.data
  const mine = picked?.order === id ? picked : undefined
  // The materials are at the refinery until someone moves them, so that is
  // the honest default: collecting without touching this records where they
  // already are, and changing it records the transfer.
  const destination = mine && 'destination' in mine ? mine.destination ?? null : data?.location ?? null
  const visibility = mine?.visibility ?? data?.visibility ?? 'private'
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString(i18n.language))

  // Ticks, so an order counts down while the dialog is open.
  const now = useNow(1000)
  const remaining = useMemo(() => {
    if (!data?.eta || !data.open) return null
    return Math.round((new Date(data.eta).getTime() - now) / 1000)
  }, [data, now])

  const duration = (seconds: number | null) => {
    if (seconds === null) return '—'
    if (seconds <= 0) return t('refinery.dialog.ready')
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return [d && `${d}d`, h && `${h}h`, m && `${m}m`, !d && !h && s ? `${s}s` : 0].filter(Boolean).join(' ')
  }

  return (
    <Dialog open={id !== null} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {data ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <span>{data.station}</span>
            {data.work_order_number !== null && (
              <Chip size="small" label={t('refinery.dialog.number', { number: data.work_order_number })} />
            )}
            <Chip
              size="small"
              color={data.open ? 'secondary' : 'primary'}
              variant="outlined"
              label={t(data.open ? 'refinery.status.inProgress' : 'refinery.status.collected')}
            />
            <Chip size="small" variant="outlined" label={data.source} />
          </Stack>
        ) : (
          t('refinery.title')
        )}
      </DialogTitle>

      <DialogContent dividers>
        {order.isLoading && <CircularProgress aria-label={t('common.loading')} />}
        {order.isError && <Alert severity="error">{t('refinery.loadFailed')}</Alert>}

        {data && (
          <Stack spacing={2}>
            <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' } }}>
              <Detail label={t('refinery.dialog.method')} value={data.method ?? '—'} />
              <Detail label={t('refinery.dialog.remaining')} value={duration(remaining)} />
              <Detail label={t('refinery.dialog.cost')} value={data.cost === null ? '—' : `${fmt(data.cost)} aUEC`} />
              <Detail
                label={t('refinery.dialog.yieldTotal')}
                value={data.yield_total === null ? '—' : `${fmt(data.yield_total)} ${data.unit}`}
              />
            </Box>

            {data.unmatched.length > 0 && (
              <Alert severity="warning">
                {t('refinery.dialog.unmatched', { materials: data.unmatched.join(', ') })}
              </Alert>
            )}

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {t('refinery.dialog.materials')}
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('refinery.dialog.material')}</TableCell>
                    <TableCell align="right">{t('refinery.dialog.quality')}</TableCell>
                    <TableCell align="right">{`${t('refinery.dialog.qty')} (${data.unit})`}</TableCell>
                    <TableCell align="right">{`${t('refinery.dialog.yield')} (${data.unit})`}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.materials.map((material, index) => (
                    <TableRow key={index} sx={{ opacity: material.refine ? 1 : 0.5 }}>
                      <TableCell>
                        {material.resource}
                        {!material.refine && ` — ${t('refinery.dialog.notRefined')}`}
                      </TableCell>
                      <TableCell align="right">{fmt(material.quality)}</TableCell>
                      <TableCell align="right">{fmt(material.qty)}</TableCell>
                      <TableCell align="right">{fmt(material.yield_amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>

            {data.capture && (
              <Box>
                <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {data.capture.ship && <Detail label={t('refinery.dialog.ship')} value={data.capture.ship} />}
                  {data.capture.method_traits && (
                    <Detail label={t('refinery.dialog.traits')} value={data.capture.method_traits} />
                  )}
                  {data.capture.captures !== undefined && data.capture.captures > 1 && (
                    <Detail
                      label={t('refinery.dialog.captures')}
                      value={String(data.capture.captures)}
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

            {!data.open && data.collected_location && (
              <Alert severity="success">
                {t('refinery.dialog.collectedTo', { location: data.collected_location.name })}
              </Alert>
            )}

            {/* Collecting is a decision about the haul, so its two controls
                sit with the order they describe rather than in the button
                row, where a picker cannot carry its own helper text. */}
            {data.open && (
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr auto' } }}>
                <LocationSelect
                  value={destination}
                  onChange={(next) => setPicked({ ...mine, order: id!, destination: next })}
                  label={t('refinery.dialog.destination')}
                  helperText={t('refinery.dialog.destinationHelp')}
                  required
                  size="small"
                />
                <Box>
                  <VisibilitySelect
                    value={visibility}
                    onChange={(next) => setPicked({ ...mine, order: id!, visibility: next })}
                    label={t('refinery.dialog.visibility')}
                    fullWidth={false}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {t('refinery.dialog.visibilityHelp')}
                  </Typography>
                </Box>
              </Box>
            )}

            {collect.isError && (
              <Alert severity="error">{apiErrorDetail(collect.error) ?? t('refinery.dialog.collectFailed')}</Alert>
            )}
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ gap: 1, flexWrap: 'wrap' }}>
        {data?.open && (
          <Button
            variant="contained"
            disabled={destination === null || collect.isPending}
            onClick={() => destination !== null && collect.mutate(destination.id)}
          >
            {collect.isPending ? t('refinery.dialog.collecting') : t('refinery.dialog.collect')}
          </Button>
        )}
        <Button onClick={onClose}>{t('common.close')}</Button>
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
