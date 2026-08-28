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
import { usePaginatedList } from '../lib/usePaginatedList'
import { PageHeader } from '../components/PageHeader'
import { ListPager } from '../components/ListPager'

/** Status chip for an order: the translation key for its label plus the chip color. */
function status(order: RefineryOrder): { labelKey: string; color: 'primary' | 'secondary' } {
  return order.completed_at
    ? { labelKey: 'refinery.status.completed', color: 'primary' }
    : { labelKey: 'refinery.status.inProgress', color: 'secondary' }
}

export function RefineryPage() {
  const { t, i18n } = useTranslation()
  type SortField = 'placed_at' | 'station' | 'method' | 'completed_at' | 'eta' | 'source'
  const [sort, setSort] = useState<SortField>('placed_at')
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
                {header(t('refinery.columns.method'), 'method')}
                <TableCell>{t('refinery.columns.status')}</TableCell>
                {header(t('refinery.columns.completed'), 'completed_at')}
                {header(t('refinery.columns.eta'), 'eta')}
                {header(t('refinery.columns.source'), 'source')}
              </TableRow>
            </TableHead>
            <TableBody>
              {orders.map((order) => {
                const { labelKey, color } = status(order)
                return (
                  <TableRow key={order.id} hover>
                    <TableCell>{order.station}</TableCell>
                    <TableCell>{order.method ?? t('common.none')}</TableCell>
                    <TableCell>
                      <Chip size="small" label={t(labelKey)} color={color} variant="outlined" />
                    </TableCell>
                    <TableCell>
                      {order.completed_at
                        ? new Date(order.completed_at).toLocaleString(i18n.language)
                        : t('common.none')}
                    </TableCell>
                    <TableCell>
                      {order.eta ? new Date(order.eta).toLocaleString(i18n.language) : t('common.none')}
                    </TableCell>
                    <TableCell>{order.source}</TableCell>
                  </TableRow>
                )
              })}
              {!isLoading && orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
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
    </Box>
  )
}
