import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import GridOnIcon from '@mui/icons-material/GridOn'
import ViewListIcon from '@mui/icons-material/ViewList'
import { api, unwrapList } from '../lib/api'
import { useMe } from '../lib/auth'
import type { Blueprint, BlueprintMatrixResponse, OwnedBlueprint } from '../lib/types'
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

/** Flat list of owned blueprints (one row per owned copy). */
function OwnedListView() {
  const { t, i18n } = useTranslation()
  const { rows: owned, total, page, setPage, rowsPerPage, isLoading, isError } =
    usePaginatedList<OwnedBlueprint>('blueprints-owned', '/api/blueprints-owned', 100)

  return (
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
  )
}

const MATRIX_MEMBER_COL = 44
const MATRIX_DEFAULT_PER_PAGE = 50

/** Blueprint × member grid: who owns what, one narrow column per active org-mate. */
function MatrixView() {
  const { t } = useTranslation()
  const { me } = useMe()
  const [page, setPage] = useState(0)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['blueprints-matrix', page],
    queryFn: async () =>
      (await api.get<BlueprintMatrixResponse>('/api/blueprints/matrix', { params: { page: page + 1 } })).data,
    placeholderData: keepPreviousData,
  })

  const rows = data?.data ?? []
  const members = data?.members ?? []
  const total = data?.total ?? 0
  const rowsPerPage = data?.per_page ?? MATRIX_DEFAULT_PER_PAGE

  // The first column stays put while member columns scroll underneath it.
  const stickyFirst = {
    position: 'sticky',
    left: 0,
    bgcolor: 'background.paper',
    minWidth: 220,
    maxWidth: 320,
  } as const

  return (
    <Paper>
      {isLoading && <LinearProgress />}
      {isError && <Alert severity="error">{t('blueprints.matrix.loadFailed')}</Alert>}
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" stickyHeader aria-label={t('blueprints.matrix.tableAria')}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...stickyFirst, zIndex: 3 }}>{t('blueprints.columns.blueprint')}</TableCell>
              {members.map((m) => {
                const isMe = m.id === me?.id
                return (
                  <TableCell
                    key={m.id}
                    align="center"
                    sx={{
                      width: MATRIX_MEMBER_COL,
                      minWidth: MATRIX_MEMBER_COL,
                      maxWidth: MATRIX_MEMBER_COL,
                      px: 0.5,
                      verticalAlign: 'bottom',
                      ...(isMe && { bgcolor: 'action.hover' }),
                    }}
                  >
                    <Tooltip title={isMe ? t('blueprints.matrix.youTooltip', { handle: m.handle }) : m.handle}>
                      {/* Rotated so a dozen handles fit without a mile-wide table. */}
                      <Typography
                        variant="caption"
                        component="span"
                        sx={{
                          display: 'inline-block',
                          writingMode: 'vertical-rl',
                          transform: 'rotate(180deg)',
                          maxHeight: 120,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: isMe ? 700 : 500,
                          color: isMe ? 'primary.main' : 'text.primary',
                        }}
                      >
                        {m.handle}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                )
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.blueprint_id} hover>
                <TableCell sx={{ ...stickyFirst, zIndex: 2 }}>
                  <Typography variant="body2" noWrap>
                    {row.name}
                  </Typography>
                  {row.type_display && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {row.type_display}
                    </Typography>
                  )}
                </TableCell>
                {members.map((m) => {
                  const isMe = m.id === me?.id
                  const owns = row.owner_ids.includes(m.id)
                  return (
                    <TableCell
                      key={m.id}
                      align="center"
                      sx={{ px: 0.5, ...(isMe && { bgcolor: 'action.hover' }) }}
                    >
                      {owns && (
                        <CheckIcon
                          fontSize="small"
                          color="primary"
                          titleAccess={t('blueprints.matrix.ownedBy', { member: m.handle })}
                          sx={{ display: 'block', mx: 'auto' }}
                        />
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={members.length + 1}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    {t('blueprints.matrix.empty')}
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
  )
}

type BlueprintView = 'list' | 'matrix'

export function BlueprintsPage() {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [view, setView] = useState<BlueprintView>('list')

  return (
    <Box>
      <PageHeader
        title={t('blueprints.title')}
        subtitle={t('blueprints.subtitle')}
        action={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={view}
              onChange={(_, v: BlueprintView | null) => v && setView(v)}
              aria-label={t('blueprints.view.aria')}
            >
              <ToggleButton value="list">
                <ViewListIcon fontSize="small" sx={{ mr: 0.5 }} />
                {t('blueprints.view.list')}
              </ToggleButton>
              <ToggleButton value="matrix">
                <GridOnIcon fontSize="small" sx={{ mr: 0.5 }} />
                {t('blueprints.view.matrix')}
              </ToggleButton>
            </ToggleButtonGroup>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
              {t('blueprints.markOwnedAction')}
            </Button>
          </Box>
        }
      />
      {view === 'list' ? <OwnedListView /> : <MatrixView />}
      <MarkOwnedDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Box>
  )
}
