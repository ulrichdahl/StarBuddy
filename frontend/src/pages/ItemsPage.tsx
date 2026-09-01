import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableSortLabel from '@mui/material/TableSortLabel'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import GroupsIcon from '@mui/icons-material/Groups'
import UndoIcon from '@mui/icons-material/Undo'
import ViewListIcon from '@mui/icons-material/ViewList'
import { qualityColor } from '../lib/rarity'
import { api, apiErrorDetail } from '../lib/api'
import { useMe } from '../lib/auth'
import type { ItemStack, Location, OrgInventoryExtra, OrgItemRow, Visibility } from '../lib/types'
import { usePaginatedList } from '../lib/usePaginatedList'
import { PageHeader } from '../components/PageHeader'
import { ListPager } from '../components/ListPager'
import { ItemEntryForm } from '../components/ItemEntryForm'
import { ItemGridDialog } from '../components/ItemGridDialog'
import { LocationSelect } from '../components/LocationSelect'
import { OrgMatrixTable } from '../components/OrgMatrixTable'
import { useSystems } from '../lib/locations'

function EditItemStackDialog({ stack, onClose }: { stack: ItemStack; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [quantity, setQuantity] = useState(String(stack.quantity))
  const [quality, setQuality] = useState(stack.quality === null ? '' : String(stack.quality))
  const [location, setLocation] = useState<Location | null>(stack.location)
  const [visibility, setVisibility] = useState<Visibility>(stack.visibility)

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['item-stacks'] })
    queryClient.invalidateQueries({ queryKey: ['org-items'] })
    onClose()
  }
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/item-stacks/${stack.id}`, {
        quantity: Math.max(0, Math.round(Number(quantity))),
        quality: quality === '' ? null : Number(quality),
        location_id: location?.id,
        visibility,
      }),
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/item-stacks/${stack.id}`),
    onSuccess: done,
  })

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {stack.item_name ?? stack.item_class}
        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          {t('items.edit.title')}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t('items.columns.quantity')}
            type="number"
            autoFocus
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            slotProps={{ htmlInput: { min: 0, step: 1 } }}
            helperText={t('items.edit.zeroRemoves')}
          />
          <TextField
            label={t('items.columns.quality')}
            type="number"
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            slotProps={{ htmlInput: { min: 0, max: 1000, step: 1 } }}
            helperText={t('items.edit.qualityOptional')}
          />
          <LocationSelect value={location} onChange={setLocation} label={t('items.columns.location')} />
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={visibility}
            onChange={(_, v: Visibility | null) => v && setVisibility(v)}
            onKeyDown={(e) => {
              if (e.key.startsWith('Arrow')) {
                e.preventDefault()
                setVisibility(visibility === 'private' ? 'org' : 'private')
              }
            }}
          >
            <ToggleButton value="private">{t('items.entry.private')}</ToggleButton>
            <ToggleButton value="org">{t('items.entry.orgVisible')}</ToggleButton>
          </ToggleButtonGroup>
          {(save.isError || remove.isError) && (
            <Alert severity="error">
              {t('items.edit.saveError')} {apiErrorDetail(save.error ?? remove.error)}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
        <Button color="error" startIcon={<DeleteIcon />} onClick={() => remove.mutate()} disabled={remove.isPending}>
          {t('common.delete')}
        </Button>
        <Box>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => save.mutate()}
            disabled={save.isPending || !location || quantity === ''}
          >
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}

type SortField = 'updated_at' | 'item' | 'quantity' | 'quality' | 'system' | 'location' | 'visibility'
type OrgSortField = 'name' | 'total' | 'stacks' | 'holders'
type View = 'stacks' | 'org'

export function ItemsPage() {
  const { t, i18n } = useTranslation()
  const [view, setView] = useState<View>('stacks')
  const [editing, setEditing] = useState<ItemStack | null>(null)
  const [search, setSearch] = useState('')
  const [filterSystem, setFilterSystem] = useState('')
  const [filterLocation, setFilterLocation] = useState<Location | null>(null)
  const [filterVisibility, setFilterVisibility] = useState('')
  const systems = useSystems()
  const [sort, setSort] = useState<SortField>('updated_at')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const sortBy = (field: SortField) => {
    if (sort === field) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setSort(field)
      setDir(field === 'updated_at' || field === 'quantity' ? 'desc' : 'asc')
    }
  }
  const header = (label: string, field: SortField, align?: 'right') => (
    <TableCell align={align} sortDirection={sort === field ? dir : false}>
      <TableSortLabel active={sort === field} direction={sort === field ? dir : 'asc'} onClick={() => sortBy(field)}>
        {label}
      </TableSortLabel>
    </TableCell>
  )
  const { rows: stacks, total, page, setPage, rowsPerPage, setRowsPerPage, isLoading, isError } =
    usePaginatedList<ItemStack>('item-stacks', '/api/item-stacks', 50, {
      search: search || undefined,
      system: filterSystem || undefined,
      location_id: filterLocation?.id,
      visibility: filterVisibility || undefined,
      sort,
      dir,
    }, { enabled: view === 'stacks' })

  // Org view: org-visible stacks of every member, one row per item.
  const [orgSort, setOrgSort] = useState<OrgSortField>('name')
  const [orgDir, setOrgDir] = useState<'asc' | 'desc'>('asc')
  const orgSortBy = (field: OrgSortField) => {
    if (orgSort === field) setOrgDir(orgDir === 'asc' ? 'desc' : 'asc')
    else {
      setOrgSort(field)
      setOrgDir(field === 'name' ? 'asc' : 'desc')
    }
  }
  const org = usePaginatedList<OrgItemRow, OrgInventoryExtra>('org-items', '/api/org/items', 50, {
    search: search || undefined,
    system: filterSystem || undefined,
    location_id: filterLocation?.id,
    sort: orgSort,
    dir: orgDir,
  }, { enabled: view === 'org' })
  const { me } = useMe()
  const [bulkOpen, setBulkOpen] = useState(false)
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

  const isMine = (stack: ItemStack) => me?.id === stack.user_id

  return (
    <Box>
      <PageHeader
        title={t('items.title')}
        subtitle={view === 'org' ? t('items.org.subtitle') : t('items.subtitle')}
        action={
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: View | null) => v && setView(v)} aria-label={t('items.view.aria')}>
            <ToggleButton value="stacks">
              <ViewListIcon fontSize="small" sx={{ mr: 0.5 }} />
              {t('items.view.stacks')}
            </ToggleButton>
            <ToggleButton value="org">
              <GroupsIcon fontSize="small" sx={{ mr: 0.5 }} />
              {t('items.view.org')}
            </ToggleButton>
          </ToggleButtonGroup>
        }
      />
      <Paper sx={{ p: 1.5, mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField
          size="small"
          label={t('items.filters.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 180 }}
        />
        <TextField
          size="small"
          select
          label={t('items.columns.system')}
          value={filterSystem}
          onChange={(e) => setFilterSystem(e.target.value)}
          sx={{ width: 150 }}
        >
          <MenuItem value="">{t('items.filters.all')}</MenuItem>
          {systems.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <LocationSelect
          size="small"
          value={filterLocation}
          onChange={setFilterLocation}
          label={t('items.columns.location')}
          sx={{ minWidth: 220 }}
        />
        {view === 'stacks' && (
          <TextField
            size="small"
            select
            label={t('items.columns.visibility')}
            value={filterVisibility}
            onChange={(e) => setFilterVisibility(e.target.value)}
            sx={{ width: 130 }}
          >
            <MenuItem value="">{t('items.filters.all')}</MenuItem>
            <MenuItem value="private">{t('items.entry.private')}</MenuItem>
            <MenuItem value="org">{t('items.entry.orgVisible')}</MenuItem>
          </TextField>
        )}
      </Paper>
      {view === 'org' ? (
        <Paper>
          {org.isLoading && <LinearProgress />}
          {org.isError && <Alert severity="error">{t('items.loadFailed')}</Alert>}
          <OrgMatrixTable<OrgSortField>
            columns={[{ label: t('items.columns.item'), field: 'name', sx: { minWidth: 240 } }]}
            rows={org.rows.map((row) => ({
              key: row.key,
              cells: [
                <Tooltip key="name" title={row.item_class} placement="top-start">
                  <span>{row.name}</span>
                </Tooltip>,
              ],
              total: row.total,
              stacks: row.stacks,
              holders: row.holders,
            }))}
            members={org.extra?.members ?? []}
            format={(_, quantity) => quantity.toLocaleString(i18n.language)}
            sort={orgSort}
            dir={orgDir}
            onSort={orgSortBy}
            loaded={!org.isLoading}
            emptyText={t('items.org.empty')}
            ariaLabel={t('items.org.tableAria')}
          />
          <ListPager total={org.total} page={org.page} rowsPerPage={org.rowsPerPage} onPageChange={org.setPage} onRowsPerPageChange={org.setRowsPerPage} />
        </Paper>
      ) : (
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
                  {header(t('items.columns.item'), 'item')}
                  {header(t('items.columns.quantity'), 'quantity', 'right')}
                  {header(t('items.columns.quality'), 'quality', 'right')}
                  {header(t('items.columns.system'), 'system')}
                  {header(t('items.columns.location'), 'location')}
                  {header(t('items.columns.visibility'), 'visibility')}
                  {header(t('items.columns.updated'), 'updated_at')}
                  <TableCell align="right" sx={{ width: 80 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {stacks.map((stack) => (
                  <TableRow key={stack.id} hover onDoubleClick={() => isMine(stack) && setEditing(stack)}>
                    <TableCell>
                      <Tooltip title={stack.item_name ? stack.item_class : ''} placement="top-start">
                        <span>{stack.item_name ?? stack.item_class}</span>
                      </Tooltip>
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
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {stack.quantity.toLocaleString(i18n.language)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: qualityColor(stack.quality), fontVariantNumeric: 'tabular-nums' }}>
                      {stack.quality ?? t('common.none')}
                    </TableCell>
                    <TableCell>{stack.location.system ?? t('locations.groupPersonal')}</TableCell>
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
                      {isMine(stack) && (
                        <IconButton size="small" aria-label={t('items.editStack')} onClick={() => setEditing(stack)}>
                          <EditIcon fontSize="inherit" />
                        </IconButton>
                      )}
                      {stack.craft_id !== null &&
                        isMine(stack) &&
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
                    <TableCell colSpan={8}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                        {t('items.empty')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <ListPager total={total} page={page} rowsPerPage={rowsPerPage} onPageChange={setPage} onRowsPerPageChange={setRowsPerPage} />
        </Paper>
        <ItemEntryForm onAddMultiple={() => setBulkOpen(true)} />
      </Box>
      )}
      <ItemGridDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
      {editing && <EditItemStackDialog stack={editing} onClose={() => setEditing(null)} />}
    </Box>
  )
}
