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
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CallMadeIcon from '@mui/icons-material/CallMade'
import CallReceivedIcon from '@mui/icons-material/CallReceived'
import { usePaginatedList } from '../lib/usePaginatedList'
import type { StockKind, StockTransfer, TransferLine } from '../lib/types'
import { ListPager } from './ListPager'

/** "Iron 783 · 200" — what changed hands, as it read on the day. */
function contents(lines: TransferLine[], locale: string): string {
  return lines
    .map((l) => `${l.name ?? '?'}${l.quality === null ? '' : ` ${l.quality}`} · ${l.quantity.toLocaleString(locale)}`)
    .join(' · ')
}

/**
 * Stock that changed hands, both directions.
 *
 * "Where did that Iron go" and "where did this Iron come from" are the same
 * question asked from either end, so one list answers both — an arrow says
 * which way it went.
 */
export function StockLedger({ stock }: { stock: StockKind }) {
  const { t, i18n } = useTranslation()
  const { rows, total, extra, page, setPage, rowsPerPage, setRowsPerPage, isLoading, isError } =
    usePaginatedList<StockTransfer, { sold_total: number }>('stock-transfers', '/api/stock-transfers', 25, { stock })

  const soldTotal = extra?.sold_total ?? 0

  return (
    <Paper>
      {isLoading && <LinearProgress />}
      {isError && <Alert severity="error">{t('stock.ledger.loadFailed')}</Alert>}
      {soldTotal > 0 && (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="body2" color="text.secondary">
            {t('stock.ledger.total', { amount: soldTotal.toLocaleString(i18n.language) })}
          </Typography>
        </Box>
      )}
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-label={t('stock.ledger.tableAria')}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40 }} />
              <TableCell>{t('stock.ledger.when')}</TableCell>
              <TableCell>{t('stock.ledger.who')}</TableCell>
              <TableCell>{t('stock.ledger.what')}</TableCell>
              <TableCell>{t('materials.fields.location')}</TableCell>
              <TableCell align="right">{t('stock.ledger.price')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} hover>
                <TableCell align="center">
                  <Tooltip title={t(`stock.ledger.direction.${row.direction}`)}>
                    <Box
                      component="span"
                      sx={{ display: 'inline-flex', color: row.direction === 'out' ? 'warning.main' : 'success.main' }}
                    >
                      {row.direction === 'out' ? <CallMadeIcon fontSize="small" /> : <CallReceivedIcon fontSize="small" />}
                    </Box>
                  </Tooltip>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {row.created_at ? new Date(row.created_at).toLocaleDateString(i18n.language) : '—'}
                </TableCell>
                <TableCell>
                  {row.counterparty ?? '—'}
                  {/* A buyer StarBuddy has never heard of: the stock left the
                      books rather than moving to anyone's inventory. */}
                  {row.direction === 'out' && !row.known_player && (
                    <Chip size="small" variant="outlined" sx={{ ml: 0.75 }} label={t('stock.ledger.stranger')} />
                  )}
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>
                  {contents(row.lines, i18n.language)}
                  {row.note && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {row.note}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>{row.location?.name ?? '—'}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {/* Zero is how a gift is recorded, and reads as one. */}
                  {row.price > 0
                    ? t('stock.ledger.amount', { amount: row.price.toLocaleString(i18n.language) })
                    : t('stock.ledger.gift')}
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    {t('stock.ledger.empty')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <ListPager total={total} page={page} rowsPerPage={rowsPerPage} onPageChange={setPage} onRowsPerPageChange={setRowsPerPage} />
    </Paper>
  )
}
