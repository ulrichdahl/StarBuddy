import { useQuery } from '@tanstack/react-query'
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
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { api, unwrapList } from '../lib/api'
import type { RefineryOrder } from '../lib/types'
import { PageHeader } from '../components/PageHeader'

function statusColor(status: string): 'primary' | 'secondary' | 'default' {
  if (status === 'processing' || status === 'open') return 'secondary'
  if (status === 'ready' || status === 'done') return 'primary'
  return 'default'
}

export function RefineryPage() {
  const { data: orders = [], isLoading, isError } = useQuery({
    queryKey: ['refinery-orders'],
    queryFn: async () => unwrapList<RefineryOrder>((await api.get('/api/refinery-orders')).data),
  })

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
                <TableCell>Refinery</TableCell>
                <TableCell>Method</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Yield (SCU)</TableCell>
                <TableCell>Completes</TableCell>
                <TableCell>Owner</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} hover>
                  <TableCell>{order.refinery}</TableCell>
                  <TableCell>{order.method}</TableCell>
                  <TableCell>
                    <Chip size="small" label={order.status} color={statusColor(order.status)} variant="outlined" />
                  </TableCell>
                  <TableCell align="right">{order.yield_scu.toLocaleString()}</TableCell>
                  <TableCell>
                    {order.completes_at ? new Date(order.completes_at).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>{order.owner?.handle ?? '—'}</TableCell>
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
      </Paper>
    </Box>
  )
}
