import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import UndoIcon from '@mui/icons-material/Undo'
import { api } from '../lib/api'
import { useMe } from '../lib/auth'
import type { ItemStack } from '../lib/types'
import { usePaginatedList } from '../lib/usePaginatedList'
import { PageHeader } from '../components/PageHeader'
import { ItemEntryForm } from '../components/ItemEntryForm'

export function ItemsPage() {
  const { t, i18n } = useTranslation()
  const { rows: stacks, total, page, setPage, rowsPerPage, isLoading, isError } =
    usePaginatedList<ItemStack>('item-stacks', '/api/item-stacks')
  const { me } = useMe()
  const queryClient = useQueryClient()
  // Undo is two-click: the first click arms the row, the second confirms.
  const [armedId, setArmedId] = useState<number | null>(null)

  const undo = useMutation({
    mutationFn: async (craftId: number) => (await api.post(`/api/crafts/${craftId}/undo`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item-stacks'] })
      queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
      queryClient.invalidateQueries({ queryKey: ['craftability'] })
      queryClient.invalidateQueries({ queryKey: ['craft-detail'] })
    },
    onSettled: () => setArmedId(null),
  })

  return (
    <Box>
      <PageHeader title={t('items.title')} subtitle={t('items.subtitle')} />
      <Box
        sx={{
          display: 'grid',
          gap: 3,
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 340px' },
          alignItems: 'start',
        }}
      >
        <Paper>
          {isLoading && <LinearProgress />}
          {isError && <Alert severity="error">{t('items.loadFailed')}</Alert>}
          {undo.isSuccess && (
            <Alert severity="info" onClose={() => undo.reset()}>
              {t('items.undoSuccess')}
            </Alert>
          )}
          {undo.isError && (
            <Alert severity="error" onClose={() => undo.reset()}>
              {t('items.undoFailed')}
            </Alert>
          )}
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label={t('items.tableAria')}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('items.columns.item')}</TableCell>
                  <TableCell align="right">{t('items.columns.quantity')}</TableCell>
                  <TableCell>{t('items.columns.location')}</TableCell>
                  <TableCell>{t('items.columns.visibility')}</TableCell>
                  <TableCell>{t('items.columns.updated')}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {stacks.map((stack) => (
                  <TableRow key={stack.id} hover>
                    <TableCell>
                      {stack.item_name ?? stack.item_class}
                      {stack.source === 'craft' && (
                        <Chip
                          size="small"
                          label={t('items.crafted')}
                          variant="outlined"
                          color="secondary"
                          sx={{ ml: 1 }}
                        />
                      )}
                    </TableCell>
                    <TableCell align="right">{stack.quantity.toLocaleString(i18n.language)}</TableCell>
                    <TableCell>{stack.location.name}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={t(`items.visibility.${stack.visibility}`)}
                        color={stack.visibility === 'org' ? 'secondary' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{new Date(stack.updated_at).toLocaleDateString(i18n.language)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {stack.craft_id !== null &&
                        me?.id === stack.user_id &&
                        (armedId === stack.id ? (
                          <Button
                            size="small"
                            color="error"
                            variant="contained"
                            disabled={undo.isPending}
                            onClick={() => undo.mutate(stack.craft_id!)}
                            onMouseLeave={() => setArmedId(null)}
                          >
                            {undo.isPending ? t('items.undoing') : t('items.undoConfirm')}
                          </Button>
                        ) : (
                          <Tooltip title={t('items.undoTooltip')}>
                            <IconButton size="small" onClick={() => setArmedId(stack.id)}>
                              <UndoIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        ))}
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && stacks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                        {t('items.empty')}
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
        <ItemEntryForm />
      </Box>
    </Box>
  )
}
