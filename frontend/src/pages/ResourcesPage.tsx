import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import Stack from '@mui/material/Stack'
import MenuItem from '@mui/material/MenuItem'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableSortLabel from '@mui/material/TableSortLabel'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import DiamondIcon from '@mui/icons-material/Diamond'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import EditIcon from '@mui/icons-material/Edit'
import GroupsIcon from '@mui/icons-material/Groups'
import Inventory2Icon from '@mui/icons-material/Inventory2'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import ViewListIcon from '@mui/icons-material/ViewList'
import { qualityColor, rarityColor as resourceRarityColor } from '../lib/rarity'
import { api, apiErrorDetail } from '../lib/api'
import type { Location, OrgInventoryExtra, OrgMaterialRow, ResourceStack, Visibility } from '../lib/types'
import { formatResourceQuantity } from '../lib/quantity'
import { usePaginatedList } from '../lib/usePaginatedList'
import { PageHeader } from '../components/PageHeader'
import { ListPager } from '../components/ListPager'
import { MaterialGridDialog } from '../components/MaterialGridDialog'
import { StockHandoverDialog } from '../components/StockHandoverDialog'
import { StockLedger } from '../components/StockLedger'
import { LocationSelect } from '../components/LocationSelect'
import { PlaceSelect, type Place } from '../components/PlaceSelect'
import { VisibilitySelect } from '../components/VisibilitySelect'
import { OrgMatrixTable } from '../components/OrgMatrixTable'
import { useMe } from '../lib/auth'

/** Desaturated WoW ladder, shared by both rarity axes. */

/** Quality value → tier color (per-stack quality axis). */

function CategoryIcon({ category }: { category: string }) {
  return category === 'gem' ? (
    <DiamondIcon fontSize="small" sx={{ color: 'text.secondary' }} />
  ) : (
    <Inventory2Icon fontSize="small" sx={{ color: 'text.secondary' }} />
  )
}

/** UI label for a resource category (ore / refined / gem); unknown values shown verbatim. */
function categoryLabel(t: TFunction, category: string): string {
  return t(`materials.category.${category}`, { defaultValue: category })
}

function formatQuantity(stack: ResourceStack, t: TFunction, lang: string): string {
  const raw = stack.resource_type.unit === 'pieces' ? stack.quantity_pieces : stack.quantity_mscu
  return formatResourceQuantity(stack.resource_type.unit, raw ?? 0, t, lang)
}

function EditStackDialog({ stack, onClose }: { stack: ResourceStack; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isPieces = stack.resource_type.unit === 'pieces'
  const [quality, setQuality] = useState(String(stack.quality ?? ''))
  const [quantity, setQuantity] = useState(
    isPieces ? String(stack.quantity_pieces ?? 0) : String((stack.quantity_mscu ?? 0) / 1000),
  )
  const [location, setLocation] = useState<Location | null>(stack.location)
  const [visibility, setVisibility] = useState<Visibility>(stack.visibility)

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/resource-stacks/${stack.id}`, {
        quality: quality === '' ? undefined : Number(quality),
        location_id: location?.id,
        visibility,
        ...(isPieces
          ? { quantity_pieces: Math.round(Number(quantity)) }
          : { quantity_mscu: Math.round(Number(quantity) * 1000) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
      queryClient.invalidateQueries({ queryKey: ['org-materials'] })
      onClose()
    },
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/resource-stacks/${stack.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
      queryClient.invalidateQueries({ queryKey: ['org-materials'] })
      onClose()
    },
  })

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {stack.resource_type.name}
        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          {t('materials.edit.title')}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t('materials.fields.quality')}
            type="number"
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            slotProps={{ htmlInput: { min: 0, max: 1000, step: 1 } }}
          />
          <TextField
            label={t('materials.fields.quantityWithUnit', {
              unit: isPieces ? t('materials.units.pcs') : t('materials.units.scu'),
            })}
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            slotProps={{ htmlInput: { min: 0, step: isPieces ? 1 : 0.001 } }}
            helperText={t('materials.edit.zeroConsumes')}
          />
          <LocationSelect value={location} onChange={setLocation} label={t('materials.fields.location')} />
          <VisibilitySelect value={visibility} onChange={setVisibility} />
          {(save.isError || remove.isError) && (
            <Alert severity="error">
              {t('materials.edit.saveError')}
              {' '}
              {apiErrorDetail(save.error ?? remove.error)}
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
          <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !location}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}

type SortField = 'resource' | 'quality' | 'quantity' | 'system' | 'location' | 'visibility' | 'updated_at'
type OrgSortField = 'name' | 'quality' | 'total' | 'stacks' | 'holders'
type View = 'stacks' | 'org' | 'ledger'

export function ResourcesPage() {
  const { t, i18n } = useTranslation()
  const [view, setView] = useState<View>('stacks')
  const [editing, setEditing] = useState<ResourceStack | null>(null)
  const [search, setSearch] = useState('')
  const [qualityMin, setQualityMin] = useState('')
  const [qualityMax, setQualityMax] = useState('')
  const [place, setPlace] = useState<Place | null>(null)
  // Stock the player is carrying themselves, rather than everything the org
  // has pooled — the question behind "what do I actually have on me".
  const [mineOnly, setMineOnly] = useState(false)
  /**
   * The hold being worked on, kept by id and by row: the rows are needed for
   * the dialog's summary and a selected stack can page out of the list.
   */
  const [picked, setPicked] = useState<Map<number, ResourceStack>>(new Map())
  const [handover, setHandover] = useState(false)
  const [filterVisibility, setFilterVisibility] = useState('')
  const { me } = useMe()
  // Org mates' org-visible stacks are listed too; only your own can be edited.
  const isMine = (stack: ResourceStack) => me?.id === stack.user_id
  const [bulkOpen, setBulkOpen] = useState(false)
  const [sort, setSort] = useState<SortField>('resource')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')

  const { rows: stacks, total, page, setPage, rowsPerPage, setRowsPerPage, isLoading, isError } =
    usePaginatedList<ResourceStack>('resource-stacks', '/api/resource-stacks', 50, {
      search: search || undefined,
      quality_min: qualityMin || undefined,
      quality_max: qualityMax || undefined,
      system: place?.kind === 'system' ? place.system : undefined,
      location_id: place?.kind === 'location' ? place.location.id : undefined,
      visibility: filterVisibility || undefined,
      mine: mineOnly ? 1 : undefined,
      sort,
      dir,
    }, { enabled: view === 'stacks' })

  // Picking is per stack and survives paging, so a hold gathered across three
  // pages can be moved in one go.
  const mineHere = stacks.filter(isMine)
  const pick = (stack: ResourceStack) =>
    setPicked((prev) => {
      const next = new Map(prev)
      if (next.has(stack.id)) next.delete(stack.id)
      else next.set(stack.id, stack)
      return next
    })
  const pickAll = (on: boolean) =>
    setPicked((prev) => {
      const next = new Map(prev)
      for (const stack of mineHere) {
        if (on) next.set(stack.id, stack)
        else next.delete(stack.id)
      }
      return next
    })

  // Org view: org-visible stacks of every member, one row per material + quality.
  const [orgSort, setOrgSort] = useState<OrgSortField>('name')
  const [orgDir, setOrgDir] = useState<'asc' | 'desc'>('asc')
  const orgSortBy = (field: OrgSortField) => {
    if (orgSort === field) setOrgDir(orgDir === 'asc' ? 'desc' : 'asc')
    else {
      setOrgSort(field)
      setOrgDir(field === 'name' ? 'asc' : 'desc')
    }
  }
  const org = usePaginatedList<OrgMaterialRow, OrgInventoryExtra>('org-materials', '/api/org/materials', 50, {
    search: search || undefined,
    quality_min: qualityMin || undefined,
    quality_max: qualityMax || undefined,
    system: place?.kind === 'system' ? place.system : undefined,
    location_id: place?.kind === 'location' ? place.location.id : undefined,
    sort: orgSort,
    dir: orgDir,
  }, { enabled: view === 'org' })
  const orgUnit: Record<string, string> = Object.fromEntries(org.rows.map((r) => [r.key, r.resource_type?.unit ?? 'mscu']))

  const sortBy = (field: SortField) => {
    if (sort === field) {
      setDir(dir === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(field)
      setDir(field === 'updated_at' ? 'desc' : 'asc')
    }
  }

  const header = (label: string, field: SortField, align?: 'right') => (
    <TableCell align={align} sortDirection={sort === field ? dir : false}>
      <TableSortLabel active={sort === field} direction={sort === field ? dir : 'asc'} onClick={() => sortBy(field)}>
        {label}
      </TableSortLabel>
    </TableCell>
  )

  return (
    <Box>
      <PageHeader
        title={t('materials.title')}
        subtitle={view === 'org' ? t('materials.org.subtitle') : t('materials.subtitle')}
        action={
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: View | null) => v && setView(v)} aria-label={t('materials.view.aria')}>
            <ToggleButton value="stacks">
              <ViewListIcon fontSize="small" sx={{ mr: 0.5 }} />
              {t('materials.view.stacks')}
            </ToggleButton>
            <ToggleButton value="org">
              <GroupsIcon fontSize="small" sx={{ mr: 0.5 }} />
              {t('materials.view.org')}
            </ToggleButton>
            <ToggleButton value="ledger">
              <SwapHorizIcon fontSize="small" sx={{ mr: 0.5 }} />
              {t('stock.ledgerView')}
            </ToggleButton>
          </ToggleButtonGroup>
        }
      />
      {/* What is picked out, and the one button that acts on it. It sits
          under the view switch so it is in the same place whatever is on
          screen, and says nothing at all until something is picked. */}
      {view === 'stacks' && picked.size > 0 && (
        <Paper sx={{ p: 1.5, mb: 2, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2">
            {t('stock.selected', { count: picked.size })}
          </Typography>
          <Button size="small" onClick={() => setPicked(new Map())}>
            {t('stock.clear')}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<SwapHorizIcon />}
            sx={{ ml: 'auto' }}
            onClick={() => setHandover(true)}
          >
            {t('stock.handover.open')}
          </Button>
        </Paper>
      )}
      {/* One row from tablet up: the fields give up width to each other
          rather than pushing the button onto a line of its own. Hidden on the
          sales view, which none of them narrow. */}
      {view !== 'ledger' && (
      <Paper
        sx={{
          p: 1.5,
          mb: 2,
          display: 'flex',
          flexWrap: { xs: 'wrap', md: 'nowrap' },
          gap: 1.5,
          alignItems: 'center',
        }}
      >
        <TextField
          size="small"
          label={t('materials.filters.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: '2 1 140px', minWidth: 110 }}
        />
        <TextField
          size="small"
          label={t('materials.filters.qualityMin')}
          type="number"
          value={qualityMin}
          onChange={(e) => setQualityMin(e.target.value)}
          sx={{ flex: '0 1 110px', minWidth: 84 }}
          slotProps={{ htmlInput: { min: 0, max: 1000 } }}
        />
        <TextField
          size="small"
          label={t('materials.filters.qualityMax')}
          type="number"
          value={qualityMax}
          onChange={(e) => setQualityMax(e.target.value)}
          sx={{ flex: '0 1 110px', minWidth: 84 }}
          slotProps={{ htmlInput: { min: 0, max: 1000 } }}
        />
        <PlaceSelect
          size="small"
          value={place}
          onChange={setPlace}
          sx={{ flex: '3 1 200px', minWidth: 150 }}
        />
        {view === 'stacks' && (
          <TextField
            size="small"
            select
            label={t('materials.fields.visibility')}
            value={filterVisibility}
            onChange={(e) => setFilterVisibility(e.target.value)}
            sx={{ flex: '0 1 130px', minWidth: 104 }}
          >
            <MenuItem value="">{t('materials.filters.all')}</MenuItem>
            <MenuItem value="private">{t('materials.visibility.private')}</MenuItem>
            <MenuItem value="org">{t('materials.visibility.org')}</MenuItem>
          </TextField>
        )}
        {view === 'stacks' && (
          <FormControlLabel
            sx={{ mr: 0 }}
            control={<Switch size="small" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />}
            label={<Typography variant="body2">{t('stock.mineOnly')}</Typography>}
          />
        )}
        <Button
          variant="contained"
          startIcon={<PlaylistAddIcon />}
          onClick={() => setBulkOpen(true)}
          sx={{ ml: 'auto', flexShrink: 0 }}
        >
          {t('materials.bulk.add')}
        </Button>
      </Paper>
      )}
      {view === 'ledger' ? (
        <StockLedger stock="material" />
      ) : view === 'org' ? (
        <Paper>
          {org.isLoading && <LinearProgress />}
          {org.isError && <Alert severity="error">{t('materials.loadError')}</Alert>}
          <OrgMatrixTable<OrgSortField>
            columns={[
              { label: t('materials.columns.material'), field: 'name', wide: true, sx: { minWidth: 200 } },
              { label: '', align: 'center', sx: { width: 40 } },
              { label: t('materials.fields.quality'), field: 'quality', align: 'right' },
            ]}
            rows={org.rows.map((row) => ({
              key: row.key,
              cells: [
                row.resource_type?.name ?? '—',
                row.resource_type ? (
                  <Tooltip key="cat" title={categoryLabel(t, row.resource_type.category)}>
                    <Box component="span" sx={{ display: 'inline-flex', verticalAlign: 'middle' }}>
                      <CategoryIcon category={row.resource_type.category} />
                    </Box>
                  </Tooltip>
                ) : null,
                <Box key="q" component="span" sx={{ color: qualityColor(row.quality), fontVariantNumeric: 'tabular-nums' }}>
                  {row.quality}
                </Box>,
              ],
              total: row.total,
              stacks: row.stacks,
              holders: row.holders,
              sx: { '& td:first-of-type': { borderLeft: `4px solid ${resourceRarityColor(row.resource_type?.rarity)}` } },
            }))}
            members={org.extra?.members ?? []}
            format={(row, quantity) => formatResourceQuantity(orgUnit[row.key] ?? 'mscu', quantity, t, i18n.language)}
            sort={orgSort}
            dir={orgDir}
            onSort={orgSortBy}
            loaded={!org.isLoading}
            emptyText={t('materials.org.empty')}
            ariaLabel={t('materials.org.tableAria')}
          />
          <ListPager total={org.total} page={org.page} rowsPerPage={org.rowsPerPage} onPageChange={org.setPage} onRowsPerPageChange={org.setRowsPerPage} />
        </Paper>
      ) : (
      <Paper>
        {isLoading && <LinearProgress />}
        {isError && <Alert severity="error">{t('materials.loadError')}</Alert>}
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label={t('materials.tableLabel')}>
            <TableHead>
              <TableRow>
                {header(t('materials.columns.material'), 'resource')}
                <TableCell align="center" sx={{ width: 40 }} aria-label={t('materials.columns.category')} />
                {header(t('materials.fields.quality'), 'quality', 'right')}
                {header(t('materials.fields.quantity'), 'quantity', 'right')}
                {header(t('materials.fields.system'), 'system')}
                {header(t('materials.fields.location'), 'location')}
                {header(t('materials.fields.visibility'), 'visibility')}
                <TableCell sx={{ width: 40 }} />
                <TableCell align="center" padding="checkbox">
                  {/* Picks every one of yours on this page; an org mate's
                      stock is visible so it can be counted, not spent. */}
                  <Checkbox
                    size="small"
                    checked={mineHere.length > 0 && mineHere.every((s) => picked.has(s.id))}
                    indeterminate={mineHere.some((s) => picked.has(s.id)) && !mineHere.every((s) => picked.has(s.id))}
                    disabled={mineHere.length === 0}
                    onChange={(e) => pickAll(e.target.checked)}
                    slotProps={{ input: { 'aria-label': t('stock.pickAllAria') } }}
                  />
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {stacks.map((stack) => (
                <TableRow
                  key={stack.id}
                  hover
                  onDoubleClick={() => isMine(stack) && setEditing(stack)}
                  sx={{
                    '& td:first-of-type': {
                      borderLeft: `4px solid ${resourceRarityColor(stack.resource_type.rarity)}`,
                    },
                  }}
                >
                  <TableCell>
                    {stack.resource_type.name}
                    {stack.refining && (
                      // Owned, but the refinery still has it. Marked rather
                      // than hidden: it counts towards what can be crafted,
                      // it just is not in hand yet.
                      <Tooltip title={t('materials.refiningAt', { station: stack.refining_at ?? '' })}>
                        <Box
                          component="span"
                          sx={{ ml: 0.75, color: 'text.secondary', fontSize: '0.8em', whiteSpace: 'nowrap' }}
                        >
                          {t('materials.refining')}
                        </Box>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title={categoryLabel(t, stack.resource_type.category)}>
                      <Box component="span" sx={{ display: 'inline-flex', verticalAlign: 'middle' }}>
                        <CategoryIcon category={stack.resource_type.category} />
                      </Box>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right" sx={{ color: qualityColor(stack.quality), fontVariantNumeric: 'tabular-nums' }}>
                    {stack.quality ?? '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatQuantity(stack, t, i18n.language)}
                  </TableCell>
                  <TableCell>{stack.location.system ?? t('locations.groupPersonal')}</TableCell>
                  <TableCell>{stack.location.name}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={t(`materials.visibilityChip.${stack.visibility}`)}
                      color={stack.visibility === 'org' ? 'secondary' : 'default'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    {isMine(stack) ? (
                      <IconButton size="small" aria-label={t('materials.editStack')} onClick={() => setEditing(stack)}>
                        <EditIcon fontSize="inherit" />
                      </IconButton>
                    ) : (
                      <Tooltip title={t('materials.ownedBy', { handle: stack.user?.handle ?? stack.user?.name ?? '?' })}>
                        <Box component="span" sx={{ display: 'inline-flex', p: 0.5, color: 'text.disabled' }}>
                          <GroupsIcon fontSize="small" />
                        </Box>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="center" padding="checkbox">
                    {isMine(stack) && (
                      <Checkbox
                        size="small"
                        checked={picked.has(stack.id)}
                        onChange={() => pick(stack)}
                        slotProps={{ input: { 'aria-label': t('stock.pickAria', { name: stack.resource_type.name }) } }}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && stacks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                      {t('materials.empty')}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <ListPager total={total} page={page} rowsPerPage={rowsPerPage} onPageChange={setPage} onRowsPerPageChange={setRowsPerPage} />
      </Paper>
      )}
      {editing && <EditStackDialog stack={editing} onClose={() => setEditing(null)} />}
      <MaterialGridDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <StockHandoverDialog
        open={handover}
        stock="material"
        stacks={[...picked.values()].map((s) => {
          const pieces = s.resource_type.unit === 'pieces'
          return {
            id: s.id,
            name: s.resource_type.name,
            quality: s.quality,
            held: pieces ? (s.quantity_pieces ?? 0) : (s.quantity_mscu ?? 0) / 1000,
            unit: pieces ? t('materials.units.pcs') : t('materials.units.scu'),
            factor: pieces ? 1 : 1000,
            step: pieces ? 1 : 0.001,
            rarity: s.resource_type.rarity,
          }
        })}
        onClose={() => setHandover(false)}
        onDone={() => setPicked(new Map())}
      />
    </Box>
  )
}
