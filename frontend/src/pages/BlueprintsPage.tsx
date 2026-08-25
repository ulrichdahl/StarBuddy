import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
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
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import { api, unwrapList } from '../lib/api'
import type { Blueprint, OwnedBlueprint } from '../lib/types'
import { usePaginatedList } from '../lib/usePaginatedList'
import { PageHeader } from '../components/PageHeader'

/** Dialog for marking a blueprint as owned, with server-side search. */
function MarkOwnedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
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
    mutationFn: (blueprint: Blueprint) =>
      api.post('/api/blueprints-owned', { blueprint_id: blueprint.id, blueprint_name: blueprint.name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blueprints-owned'] })
      setSelected(null)
      setSearch('')
      onClose()
    },
  })

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('blueprints.dialog.title')}</DialogTitle>
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
            <TextField
              {...params}
              label={t('blueprints.dialog.blueprint')}
              autoFocus
              placeholder={t('blueprints.dialog.searchPlaceholder')}
            />
          )}
        />
        {markOwned.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {t('blueprints.dialog.failed')}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!selected || markOwned.isPending}
          onClick={() => selected && markOwned.mutate(selected)}
        >
          {markOwned.isPending ? t('common.saving') : t('blueprints.dialog.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function BlueprintsPage() {
  const { t, i18n } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const { rows: owned, total, page, setPage, rowsPerPage, isLoading, isError } =
    usePaginatedList<OwnedBlueprint>('blueprints-owned', '/api/blueprints-owned', 100)

  return (
    <Box>
      <PageHeader
        title={t('blueprints.title')}
        subtitle={t('blueprints.subtitle')}
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
            {t('blueprints.markOwnedAction')}
          </Button>
        }
      />
      <Paper>
        {isLoading && <LinearProgress />}
        {isError && <Alert severity="error">{t('blueprints.loadFailed')}</Alert>}
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label={t('blueprints.tableAria')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('blueprints.columns.blueprint')}</TableCell>
                <TableCell>{t('blueprints.columns.itemClass')}</TableCell>
                <TableCell>{t('blueprints.columns.owner')}</TableCell>
                <TableCell>{t('blueprints.columns.acquired')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {owned.map((entry) => (
                <TableRow key={entry.id} hover>
                  <TableCell>{entry.blueprint?.name ?? entry.blueprint_name}</TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                      {entry.item_class ?? t('common.none')}
                    </Typography>
                  </TableCell>
                  <TableCell>{entry.user?.handle ?? entry.user?.name ?? t('common.none')}</TableCell>
                  <TableCell>
                    {entry.acquired_at
                      ? new Date(entry.acquired_at).toLocaleDateString(i18n.language)
                      : t('common.none')}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && owned.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                      {t('blueprints.empty')}
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
      <MarkOwnedDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Box>
  )
}
