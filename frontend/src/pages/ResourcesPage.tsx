import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import MenuItem from '@mui/material/MenuItem'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableSortLabel from '@mui/material/TableSortLabel'
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
import DeleteIcon from '@mui/icons-material/Delete'
import DiamondIcon from '@mui/icons-material/Diamond'
import EditIcon from '@mui/icons-material/Edit'
import Inventory2Icon from '@mui/icons-material/Inventory2'
import { api, unwrapList } from '../lib/api'
import type { Location, ResourceStack, Visibility } from '../lib/types'
import { usePaginatedList } from '../lib/usePaginatedList'
import { PageHeader } from '../components/PageHeader'
import { ResourceEntryForm } from '../components/ResourceEntryForm'

/** Desaturated WoW ladder, shared by both rarity axes. */
const TIER_COLORS = {
  poor: '#8f8f8f',
  common: '#c9d1d9',
  uncommon: '#58a862',
  rare: '#4f8fce',
  epic: '#9a6bc9',
  legendary: '#c98a3d',
} as const

/** Quality value → tier color (per-stack quality axis). */
function qualityColor(quality: number | null): string {
  if (quality === null) return 'transparent'
  if (quality >= 900) return TIER_COLORS.legendary
  if (quality >= 800) return TIER_COLORS.epic
  if (quality >= 700) return TIER_COLORS.rare
  if (quality >= 600) return TIER_COLORS.uncommon
  if (quality >= 400) return TIER_COLORS.common
  return TIER_COLORS.poor
}

/** Resource rarity (spawn-rate derived) → tier color (row border axis). */
function resourceRarityColor(rarity: string | null | undefined): string {
  return TIER_COLORS[rarity as keyof typeof TIER_COLORS] ?? 'transparent'
}

function CategoryIcon({ category }: { category: string }) {
  return category === 'gem' ? (
    <DiamondIcon fontSize="small" sx={{ color: 'text.secondary' }} />
  ) : (
    <Inventory2Icon fontSize="small" sx={{ color: 'text.secondary' }} />
  )
}

function formatQuantity(stack: ResourceStack): string {
  if (stack.resource_type.unit === 'pieces') {
    return `${(stack.quantity_pieces ?? 0).toLocaleString()} pcs`
  }
  return `${((stack.quantity_mscu ?? 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} SCU`
}

function EditStackDialog({ stack, onClose }: { stack: ResourceStack; onClose: () => void }) {
  const queryClient = useQueryClient()
  const isPieces = stack.resource_type.unit === 'pieces'
  const [quality, setQuality] = useState(String(stack.quality ?? ''))
  const [quantity, setQuantity] = useState(
    isPieces ? String(stack.quantity_pieces ?? 0) : String((stack.quantity_mscu ?? 0) / 1000),
  )
  const [location, setLocation] = useState<Location | null>(stack.location)
  const [visibility, setVisibility] = useState<Visibility>(stack.visibility)

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: async () => unwrapList<Location>((await api.get('/api/locations')).data),
  })

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
      onClose()
    },
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/resource-stacks/${stack.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
      onClose()
    },
  })

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {stack.resource_type.name}
        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          edit stack
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Quality"
            type="number"
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            slotProps={{ htmlInput: { min: 0, max: 1000, step: 1 } }}
          />
          <TextField
            label={isPieces ? 'Quantity (pcs)' : 'Quantity (SCU)'}
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            slotProps={{ htmlInput: { min: 0, step: isPieces ? 1 : 0.001 } }}
            helperText="Set to 0 to consume the stack"
          />
          <Autocomplete
            options={locations}
            value={location}
            onChange={(_, value) => setLocation(value)}
            getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            groupBy={(o) => o.system ?? 'Personal'}
            renderInput={(params) => <TextField {...params} label="Location" />}
          />
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
            <ToggleButton value="private">Private</ToggleButton>
            <ToggleButton value="org">Org-visible</ToggleButton>
          </ToggleButtonGroup>
          {(save.isError || remove.isError) && (
            <Alert severity="error">Could not save the change. Try again.</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
        <Button color="error" startIcon={<DeleteIcon />} onClick={() => remove.mutate()} disabled={remove.isPending}>
          Delete
        </Button>
        <Box>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !location}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}

type SortField = 'resource' | 'quality' | 'quantity' | 'location' | 'visibility' | 'updated_at'

export function ResourcesPage() {
  const [editing, setEditing] = useState<ResourceStack | null>(null)
  const [search, setSearch] = useState('')
  const [qualityMin, setQualityMin] = useState('')
  const [qualityMax, setQualityMax] = useState('')
  const [filterLocation, setFilterLocation] = useState<Location | null>(null)
  const [filterVisibility, setFilterVisibility] = useState('')
  const [sort, setSort] = useState<SortField>('updated_at')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: async () => unwrapList<Location>((await api.get('/api/locations')).data),
  })

  const { rows: stacks, total, page, setPage, rowsPerPage, isLoading, isError } =
    usePaginatedList<ResourceStack>('resource-stacks', '/api/resource-stacks', 50, {
      search: search || undefined,
      quality_min: qualityMin || undefined,
      quality_max: qualityMax || undefined,
      location_id: filterLocation?.id,
      visibility: filterVisibility || undefined,
      sort,
      dir,
    })

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
      <PageHeader title="Resources" subtitle="Raw and refined resource stacks across your locations" />
      <Paper sx={{ p: 1.5, mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField
          size="small"
          label="Search resource"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 180 }}
        />
        <TextField
          size="small"
          label="Quality min"
          type="number"
          value={qualityMin}
          onChange={(e) => setQualityMin(e.target.value)}
          sx={{ width: 110 }}
          slotProps={{ htmlInput: { min: 0, max: 1000 } }}
        />
        <TextField
          size="small"
          label="Quality max"
          type="number"
          value={qualityMax}
          onChange={(e) => setQualityMax(e.target.value)}
          sx={{ width: 110 }}
          slotProps={{ htmlInput: { min: 0, max: 1000 } }}
        />
        <Autocomplete
          size="small"
          options={locations}
          value={filterLocation}
          onChange={(_, v) => setFilterLocation(v)}
          getOptionLabel={(o) => o.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          groupBy={(o) => o.system ?? 'Personal'}
          sx={{ minWidth: 200 }}
          renderInput={(p) => <TextField {...p} label="Location" />}
        />
        <TextField
          size="small"
          select
          label="Visibility"
          value={filterVisibility}
          onChange={(e) => setFilterVisibility(e.target.value)}
          sx={{ width: 130 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="private">Private</MenuItem>
          <MenuItem value="org">Org-visible</MenuItem>
        </TextField>
      </Paper>
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
          {isError && <Alert severity="error">Failed to load resource stacks.</Alert>}
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Resource stacks">
              <TableHead>
                <TableRow>
                  {header('Resource', 'resource')}
                  <TableCell align="center" sx={{ width: 40 }} aria-label="Category" />
                  {header('Quality', 'quality', 'right')}
                  {header('Quantity', 'quantity', 'right')}
                  {header('Location', 'location')}
                  {header('Visibility', 'visibility')}
                  <TableCell sx={{ width: 40 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {stacks.map((stack) => (
                  <TableRow
                    key={stack.id}
                    hover
                    onDoubleClick={() => setEditing(stack)}
                    sx={{
                      '& td:first-of-type': {
                        borderLeft: `4px solid ${resourceRarityColor(stack.resource_type.rarity)}`,
                      },
                    }}
                  >
                    <TableCell>{stack.resource_type.name}</TableCell>
                    <TableCell align="center">
                      <Tooltip title={stack.resource_type.category}>
                        <Box component="span" sx={{ display: 'inline-flex', verticalAlign: 'middle' }}>
                          <CategoryIcon category={stack.resource_type.category} />
                        </Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right" sx={{ color: qualityColor(stack.quality), fontVariantNumeric: 'tabular-nums' }}>
                      {stack.quality ?? '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatQuantity(stack)}
                    </TableCell>
                    <TableCell>{stack.location.name}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={stack.visibility}
                        color={stack.visibility === 'org' ? 'secondary' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <IconButton size="small" aria-label="Edit stack" onClick={() => setEditing(stack)}>
                        <EditIcon fontSize="inherit" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && stacks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                        No stacks yet — add your first one with the quick-entry form.
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
        <ResourceEntryForm />
      </Box>
      {editing && <EditStackDialog stack={editing} onClose={() => setEditing(null)} />}
    </Box>
  )
}
