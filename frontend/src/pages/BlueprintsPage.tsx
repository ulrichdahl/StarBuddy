import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import { api, unwrapList } from '../lib/api'
import type { Blueprint, OwnedBlueprint } from '../lib/types'
import { PageHeader } from '../components/PageHeader'

/** Dialog for marking a blueprint as owned, with server-side search. */
function MarkOwnedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Blueprint | null>(null)

  const { data: options = [], isFetching } = useQuery({
    queryKey: ['blueprints', search],
    queryFn: async () =>
      unwrapList<Blueprint>((await api.get('/api/blueprints', { params: { search } })).data),
    enabled: open,
  })

  const markOwned = useMutation({
    mutationFn: (blueprint: Blueprint) => api.post('/api/blueprints-owned', { blueprint_id: blueprint.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blueprints-owned'] })
      setSelected(null)
      setSearch('')
      onClose()
    },
  })

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Mark blueprint as owned</DialogTitle>
      <DialogContent>
        <Autocomplete
          sx={{ mt: 1 }}
          options={options}
          value={selected}
          onChange={(_, value) => setSelected(value)}
          inputValue={search}
          onInputChange={(_, value) => setSearch(value)}
          getOptionLabel={(option) => option.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          loading={isFetching}
          filterOptions={(x) => x}
          renderInput={(params) => (
            <TextField {...params} label="Blueprint" autoFocus placeholder="Search blueprints…" />
          )}
        />
        {markOwned.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            Could not mark the blueprint as owned.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!selected || markOwned.isPending}
          onClick={() => selected && markOwned.mutate(selected)}
        >
          {markOwned.isPending ? 'Saving…' : 'Mark owned'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function BlueprintsPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data: owned = [], isLoading, isError } = useQuery({
    queryKey: ['blueprints-owned'],
    queryFn: async () => unwrapList<OwnedBlueprint>((await api.get('/api/blueprints-owned')).data),
  })

  return (
    <Box>
      <PageHeader
        title="Blueprints"
        subtitle="Blueprints owned across the org"
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
            Mark blueprint owned
          </Button>
        }
      />
      <Paper>
        {isLoading && <LinearProgress />}
        {isError && <Alert severity="error">Failed to load owned blueprints.</Alert>}
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Owned blueprints">
            <TableHead>
              <TableRow>
                <TableCell>Blueprint</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell>Acquired</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {owned.map((entry) => (
                <TableRow key={entry.id} hover>
                  <TableCell>{entry.blueprint.name}</TableCell>
                  <TableCell>{entry.blueprint.category ?? '—'}</TableCell>
                  <TableCell>{entry.owner?.handle ?? '—'}</TableCell>
                  <TableCell>
                    {entry.acquired_at ? new Date(entry.acquired_at).toLocaleDateString() : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && owned.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                      No blueprints marked as owned yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <MarkOwnedDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Box>
  )
}
