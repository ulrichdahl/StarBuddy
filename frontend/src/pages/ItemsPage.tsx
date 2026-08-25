import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
      <PageHeader title="Items" subtitle="Components, weapons and other tracked items" />
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
          {isError && <Alert severity="error">Failed to load item stacks.</Alert>}
          {undo.isSuccess && (
            <Alert severity="info" onClose={() => undo.reset()}>
              Craft undone — the materials are back in the resource ledger and the blueprint use was
              rolled back.
            </Alert>
          )}
          {undo.isError && (
            <Alert severity="error" onClose={() => undo.reset()}>
              Could not undo the craft.
            </Alert>
          )}
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Item stacks">
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell align="right">Quantity</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell>Visibility</TableCell>
                  <TableCell>Updated</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {stacks.map((stack) => (
                  <TableRow key={stack.id} hover>
                    <TableCell>
                      {stack.item_name ?? stack.item_class}
                      {stack.source === 'craft' && (
                        <Chip size="small" label="crafted" variant="outlined" color="secondary" sx={{ ml: 1 }} />
                      )}
                    </TableCell>
                    <TableCell align="right">{stack.quantity.toLocaleString()}</TableCell>
                    <TableCell>{stack.location.name}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={stack.visibility}
                        color={stack.visibility === 'org' ? 'secondary' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{new Date(stack.updated_at).toLocaleDateString()}</TableCell>
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
                            {undo.isPending ? 'Undoing…' : 'Undo craft?'}
                          </Button>
                        ) : (
                          <Tooltip title="Undo this craft — remove the item and restore the materials">
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
                        No item stacks yet.
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
