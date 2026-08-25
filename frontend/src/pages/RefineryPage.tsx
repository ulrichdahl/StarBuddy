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
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import type { RefineryOrder } from '../lib/types'
import { usePaginatedList } from '../lib/usePaginatedList'
import { PageHeader } from '../components/PageHeader'

/** Status chip for an order: the translation key for its label plus the chip color. */
function status(order: RefineryOrder): { labelKey: string; color: 'primary' | 'secondary' } {
  return order.completed_at
    ? { labelKey: 'refinery.status.completed', color: 'primary' }
    : { labelKey: 'refinery.status.inProgress', color: 'secondary' }
}

export function RefineryPage() {
  const { t, i18n } = useTranslation()
  const { rows: orders, total, page, setPage, rowsPerPage, isLoading, isError } =
    usePaginatedList<RefineryOrder>('refinery-orders', '/api/refinery-orders')

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
                <TableCell>{t('refinery.columns.station')}</TableCell>
                <TableCell>{t('refinery.columns.method')}</TableCell>
                <TableCell>{t('refinery.columns.status')}</TableCell>
                <TableCell>{t('refinery.columns.completed')}</TableCell>
                <TableCell>{t('refinery.columns.eta')}</TableCell>
                <TableCell>{t('refinery.columns.source')}</TableCell>
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
        {total > rowsPerPage && (
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            rowsPerPageOptions={[rowsPerPage]}
          />
        )}
      </Paper>
    </Box>
  )
}
