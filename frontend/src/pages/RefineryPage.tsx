import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableSortLabel from '@mui/material/TableSortLabel'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import type { RefineryOrder } from '../lib/types'
import { RefineryOrderDialog } from '../components/RefineryOrderDialog'
import { usePaginatedList } from '../lib/usePaginatedList'
import { useNow } from '../lib/useNow'
import { PageHeader } from '../components/PageHeader'
import { ListPager } from '../components/ListPager'

/**
 * Status chip for an order.
 *
 * What matters is whether the refinery still has the materials, not whether the
 * job has finished running: a completed order the player has not picked up is
 * still holding their ore.
 */
function status(order: RefineryOrder, ready: boolean): { labelKey: string; color: 'primary' | 'secondary' | 'success' } {
  if (!order.open) return { labelKey: 'refinery.status.collected', color: 'primary' }
  return ready
    ? { labelKey: 'refinery.status.ready', color: 'success' }
    : { labelKey: 'refinery.status.inProgress', color: 'secondary' }
}

/** Time until an order is done, against a clock the caller ticks. */
function remaining(order: RefineryOrder, now: number): number | null {
  if (!order.eta) return null
  return Math.round((new Date(order.eta).getTime() - now) / 1000)
}

export function RefineryPage() {
  const { t, i18n } = useTranslation()
  type SortField = 'placed_at' | 'station' | 'method' | 'completed_at' | 'eta' | 'source'
  const [sort, setSort] = useState<SortField>('placed_at')
  const [openId, setOpenId] = useState<number | null>(null)
  // A minute is enough for a list; the dialog ticks every second.
  const now = useNow(30_000)
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const sortBy = (field: SortField) => {
    if (sort === field) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setSort(field)
      setDir(field === 'station' || field === 'method' || field === 'source' ? 'asc' : 'desc')
    }
  }
  const header = (label: string, field: SortField) => (
    <TableCell sortDirection={sort === field ? dir : false}>
      <TableSortLabel active={sort === field} direction={sort === field ? dir : 'asc'} onClick={() => sortBy(field)}>
        {label}
      </TableSortLabel>
    </TableCell>
  )
  const { rows: orders, total, page, setPage, rowsPerPage, setRowsPerPage, isLoading, isError } =
    usePaginatedList<RefineryOrder>('refinery-orders', '/api/refinery-orders', 50, { sort, dir })

  /** The refined materials, named, so a row says what is in the refinery. */
  const materialSummary = (order: RefineryOrder) => {
    const refined = order.materials.filter((m) => m.refine && (m.yield_amount ?? 0) > 0)
    if (refined.length === 0) return t('common.none')
    const names = refined.map((m) => m.resource)
    return names.length <= 2 ? names.join(', ') : t('refinery.andMore', { first: names.slice(0, 2).join(', '), count: names.length - 2 })
  }

  const countdown = (order: RefineryOrder) => {
    if (!order.open) return t('common.none')
    const seconds = remaining(order, now)
    if (seconds === null) return t('common.none')
    if (seconds <= 0) return t('refinery.dialog.ready')
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  return (
    <Box>
      <PageHeader title={t('refinery.title')} subtitle={t('refinery.subtitle')} />
      <Paper>
        {isLoading && <LinearProgress />}
        {isError && <Alert severity="error">{t('refinery.loadFailed')}</Alert>}
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label={t('refinery.tableAria')}>
            <TableHead>
              <TableRow>
                {header(t('refinery.columns.station'), 'station')}
                <TableCell>{t('refinery.columns.materials')}</TableCell>
                {header(t('refinery.columns.method'), 'method')}
                <TableCell>{t('refinery.columns.status')}</TableCell>
                <TableCell>{t('refinery.columns.remaining')}</TableCell>
                {header(t('refinery.columns.eta'), 'eta')}
                {header(t('refinery.columns.source'), 'source')}
              </TableRow>
            </TableHead>
            <TableBody>
              {orders.map((order) => {
                const seconds = remaining(order, now)
                const { labelKey, color } = status(order, seconds !== null && seconds <= 0)
                return (
                  <TableRow
                    key={order.id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => setOpenId(order.id)}
                  >
                    <TableCell>{order.location?.name ?? order.station}</TableCell>
                    <TableCell>{materialSummary(order)}</TableCell>
                    <TableCell>{order.method ?? t('common.none')}</TableCell>
                    <TableCell>
                      <Chip size="small" label={t(labelKey)} color={color} variant="outlined" />
                    </TableCell>
                    <TableCell>{countdown(order)}</TableCell>
                    <TableCell>
                      {order.eta ? new Date(order.eta).toLocaleString(i18n.language) : t('common.none')}
                    </TableCell>
                    <TableCell>{order.source}</TableCell>
                  </TableRow>
                )
              })}
              {!isLoading && orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                      {t('refinery.empty')}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <ListPager total={total} page={page} rowsPerPage={rowsPerPage} onPageChange={setPage} onRowsPerPageChange={setRowsPerPage} />
      </Paper>
      <RefineryOrderDialog id={openId} onClose={() => setOpenId(null)} />
    </Box>
  )
}
