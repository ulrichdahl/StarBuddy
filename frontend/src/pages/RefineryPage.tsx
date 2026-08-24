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

function status(order: RefineryOrder): { label: string; color: 'primary' | 'secondary' } {
  return order.completed_at
    ? { label: 'Completed', color: 'primary' }
    : { label: 'In progress', color: 'secondary' }
}

export function RefineryPage() {
  const { rows: orders, total, page, setPage, rowsPerPage, isLoading, isError } =
    usePaginatedList<RefineryOrder>('refinery-orders', '/api/refinery-orders')

  return (
    <Box>
      <PageHeader title="Refinery" subtitle="Refinery work orders across the org" />
      <Paper>
        {isLoading && <LinearProgress />}
        {isError && <Alert severity="error">Failed to load refinery orders.</Alert>}
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Refinery orders">
            <TableHead>
              <TableRow>
                <TableCell>Station</TableCell>
                <TableCell>Method</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Completed</TableCell>
                <TableCell>ETA</TableCell>
                <TableCell>Source</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} hover>
                  <TableCell>{order.station}</TableCell>
                  <TableCell>{order.method ?? '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" {...status(order)} variant="outlined" />
                  </TableCell>
                  <TableCell>
                    {order.completed_at ? new Date(order.completed_at).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>{order.eta ? new Date(order.eta).toLocaleString() : '—'}</TableCell>
                  <TableCell>{order.source}</TableCell>
                </TableRow>
              ))}
              {!isLoading && orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                      No refinery orders.
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
