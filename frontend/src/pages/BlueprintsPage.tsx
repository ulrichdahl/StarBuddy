import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Snackbar from '@mui/material/Snackbar'
import Switch from '@mui/material/Switch'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckIcon from '@mui/icons-material/Check'
import GridOnIcon from '@mui/icons-material/GridOn'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import SearchIcon from '@mui/icons-material/Search'
import { api, unwrapList } from '../lib/api'
import { useMe } from '../lib/auth'
import type { Blueprint, BlueprintInfo, CatalogResponse, CatalogRow } from '../lib/types'
import { PageHeader } from '../components/PageHeader'
import { OwnersCell } from '../components/OwnersCell'
import { ListPager } from '../components/ListPager'
import { BlueprintInfoDialog } from '../components/BlueprintInfoDialog'
import { gradeLabel } from './CraftPage'

type View = 'checklist' | 'matrix'
type SortField = 'kiosk' | 'name' | 'type' | 'grade' | 'owners'

interface Filters {
  search: string
  category: string
  grade: string
  /** Owned by anyone in the org (or a default blueprint) — the page's default view. */
  owned: boolean
  unownedByMe: boolean
  unowned: boolean
}

const CATALOG_KEY = 'blueprints-catalog'

/** Type column: the kiosk/type label, with the size for ship parts ("Cooler · S2"). */
const typeText = (row: CatalogRow) => `${row.type_display ?? row.category_label}${row.size !== null ? ` · S${row.size}` : ''}`

/** Debounce typed text so the catalog is not refetched on every keystroke. */
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/** Mark / unmark one blueprint as owned, with optimistic rows and an undo toast. */
function useToggleOwned() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [toast, setToast] = useState<{ row: CatalogRow; owned: boolean } | null>(null)

  const mutation = useMutation({
    mutationFn: async (row: CatalogRow) =>
      (await api.post<{ owned: boolean; blueprint_id: number }>('/api/blueprints-owned/toggle', { blueprint_id: row.id })).data,
    onMutate: async (row) => {
      await queryClient.cancelQueries({ queryKey: [CATALOG_KEY] })
      queryClient.setQueriesData<CatalogResponse>({ queryKey: [CATALOG_KEY] }, (old) =>
        old
          ? {
              ...old,
              data: old.data.map((r) => (r.id === row.id ? { ...r, owned_by_me: !r.owned_by_me } : r)),
            }
          : old,
      )
    },
    onSuccess: (res, row) => setToast({ row, owned: res.owned }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [CATALOG_KEY] })
      queryClient.invalidateQueries({ queryKey: ['craftability'] })
    },
  })

  const snackbar = (
    <Snackbar
      open={toast !== null}
      autoHideDuration={5000}
      onClose={() => setToast(null)}
      message={toast ? t(toast.owned ? 'blueprints.toast.marked' : 'blueprints.toast.unmarked', { name: toast.row.name }) : ''}
      action={
        toast && (
          <Button
            size="small"
            onClick={() => {
              mutation.mutate(toast.row)
              setToast(null)
            }}
          >
            {t('common.undo')}
          </Button>
        )
      }
    />
  )
  return { toggle: mutation.mutate, isError: mutation.isError, snackbar }
}

function FilterBar({
  filters,
  onChange,
  categories,
  matrix,
}: {
  filters: Filters
  onChange: (patch: Partial<Filters>) => void
  categories: CatalogResponse['categories']
  matrix: boolean
}) {
  const { t } = useTranslation()
  return (
    <Paper sx={{ p: 2, mb: 2, display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
      <TextField
        size="small"
        label={t('craft.search')}
        placeholder={t('blueprints.searchPlaceholder')}
        value={filters.search}
        onChange={(e) => onChange({ search: e.target.value })}
        sx={{ minWidth: 240 }}
        slotProps={{ input: { startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> } }}
      />
      <TextField size="small" select label={t('craft.type')} value={filters.category} onChange={(e) => onChange({ category: e.target.value })} sx={{ minWidth: 260 }}>
        <MenuItem value="">{t('craft.allTypes')}</MenuItem>
        {categories.flatMap((c) => [
          <MenuItem key={c.key} value={c.key} sx={{ fontWeight: 700, color: 'primary.main', borderTop: 1, borderColor: 'divider', mt: 0.5 }}>
            {c.label}
          </MenuItem>,
          ...(c.subs.length > 1
            ? c.subs.map((s) => (
                <MenuItem key={s.key} value={s.key} sx={{ pl: 4 }}>
                  {s.label}
                </MenuItem>
              ))
            : []),
        ])}
      </TextField>
      <TextField size="small" select label={t('blueprints.grade')} value={filters.grade} onChange={(e) => onChange({ grade: e.target.value })} sx={{ minWidth: 140 }}>
        <MenuItem value="">{t('blueprints.allGrades')}</MenuItem>
        {['1', '2', '3', '4'].map((g) => (
          <MenuItem key={g} value={g}>
            {t('craft.grade', { grade: gradeLabel(g) })}
          </MenuItem>
        ))}
      </TextField>
      <FormControlLabel
        control={<Switch checked={filters.owned} onChange={(e) => onChange({ owned: e.target.checked, ...(e.target.checked ? { unownedByMe: false, unowned: false } : {}) })} />}
        label={t('blueprints.ownedOnly')}
      />
      {!matrix && (
        <FormControlLabel
          control={<Switch checked={filters.unownedByMe} onChange={(e) => onChange({ unownedByMe: e.target.checked, ...(e.target.checked ? { owned: false } : {}) })} />}
          label={t('blueprints.onlyUnownedByMe')}
        />
      )}
      <FormControlLabel
        control={<Switch checked={filters.unowned} onChange={(e) => onChange({ unowned: e.target.checked, ...(e.target.checked ? { owned: false } : {}) })} />}
        label={t('blueprints.unownedByAnyone')}
      />
    </Paper>
  )
}

/** Sortable column header shared by both views. */
function SortHeader({
  label,
  field,
  sort,
  dir,
  onSort,
  align,
  sx,
}: {
  label: string
  field: SortField
  sort: SortField
  dir: 'asc' | 'desc'
  onSort: (f: SortField) => void
  align?: 'center' | 'right'
  sx?: object
}) {
  return (
    <TableCell align={align} sortDirection={sort === field ? dir : false} sx={sx}>
      <TableSortLabel active={sort === field} direction={sort === field ? dir : 'asc'} onClick={() => onSort(field)}>
        {label}
      </TableSortLabel>
    </TableCell>
  )
}

/** Design A: every blueprint in kiosk order with a live "Owned" tick. */
function ChecklistView({
  data,
  sort,
  dir,
  onSort,
  toggle,
  onInfo,
}: {
  data: CatalogResponse | undefined
  sort: SortField
  dir: 'asc' | 'desc'
  onSort: (f: SortField) => void
  toggle: (row: CatalogRow) => void
  onInfo: (id: number) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const rows = data?.data ?? []
  const unownedShown = rows.filter((r) => !r.owned_by_me)
  const [focus, setFocus] = useState(0)
  const bodyRef = useRef<HTMLTableSectionElement>(null)

  const bulk = useMutation({
    mutationFn: async (ids: number[]) => (await api.post<{ added: number }>('/api/blueprints-owned/bulk', { blueprint_ids: ids })).data,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [CATALOG_KEY] })
      queryClient.invalidateQueries({ queryKey: ['craftability'] })
    },
  })

  // Keyboard: arrows move the highlighted row, space ticks it.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocus((f) => Math.min(rows.length - 1, f + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocus((f) => Math.max(0, f - 1))
    } else if (e.key === ' ' && rows[focus]) {
      e.preventDefault()
      toggle(rows[focus])
    }
  }
  useEffect(() => setFocus(0), [data?.current_page, data?.total])

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<PlaylistAddCheckIcon />}
          disabled={unownedShown.length === 0 || bulk.isPending}
          onClick={() => bulk.mutate(unownedShown.map((r) => r.id))}
        >
          {t('blueprints.markAllShownOwned', { count: unownedShown.length })}
        </Button>
        <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto', textAlign: 'right' }}>
          {t('blueprints.checklistHelp')}
        </Typography>
      </Box>
      <TableContainer sx={{ overflowX: 'auto' }} onKeyDown={onKey} tabIndex={0}>
        <Table size="small" aria-label={t('blueprints.checklistAria')}>
          <TableHead>
            <TableRow>
              <TableCell align="center" sx={{ width: 56 }}>
                {t('blueprints.colOwned')}
              </TableCell>
              <SortHeader label={t('blueprints.colBlueprint')} field="name" sort={sort} dir={dir} onSort={onSort} />
              <SortHeader label={t('blueprints.colType')} field="type" sort={sort} dir={dir} onSort={onSort} />
              <SortHeader label={t('blueprints.colGrade')} field="grade" sort={sort} dir={dir} onSort={onSort} sx={{ width: 100 }} />
              <SortHeader label={t('blueprints.colOwners')} field="owners" sort={sort} dir={dir} onSort={onSort} align="center" sx={{ width: 150 }} />
            </TableRow>
          </TableHead>
          <TableBody ref={bodyRef}>
            {rows.map((row, i) => {
              // Group header whenever the kiosk category changes (kiosk order only).
              const showGroup = sort === 'kiosk' && (i === 0 || rows[i - 1].category_label !== row.category_label)
              return (
                <Fragment key={row.id}>
                  {showGroup && (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ bgcolor: 'rgba(91, 200, 219, 0.06)', color: 'primary.main', fontWeight: 700, fontSize: '0.8125rem', letterSpacing: '0.02em' }}>
                        {row.category_label}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow hover selected={i === focus} onClick={() => setFocus(i)} sx={{ cursor: 'default' }}>
                    <TableCell align="center" padding="checkbox">
                      <Checkbox
                        checked={row.owned_by_me}
                        onChange={() => toggle(row)}
                        slotProps={{ input: { 'aria-label': t('blueprints.tickAria', { name: row.name }) } }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontWeight: row.owned_by_me ? 600 : 400, cursor: 'pointer' }} onClick={() => onInfo(row.id)}>
                      {row.name}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{typeText(row)}</TableCell>
                    <TableCell>{row.grade ? t('craft.grade', { grade: gradeLabel(row.grade) }) : t('common.none')}</TableCell>
                    <TableCell align="center">
                      <OwnersCell isDefault={row.is_default} ownedByMe={row.owned_by_me} owners={row.owners} />
                    </TableCell>
                  </TableRow>
                </Fragment>
              )
            })}
            {data && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    {t('blueprints.emptyFiltered')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  )
}

/** Type a few letters, pick a suggestion, Enter marks it — and the field keeps focus. */
function QuickAdd({ toggle, rows }: { toggle: (row: CatalogRow) => void; rows: CatalogRow[] }) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [pick, setPick] = useState(0)
  const [recent, setRecent] = useState<Blueprint[]>([])
  const search = useDebounced(text, 200)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: options = [] } = useQuery({
    queryKey: ['blueprints', search],
    queryFn: async () => unwrapList<Blueprint>((await api.get('/api/blueprints', { params: { search } })).data),
    enabled: search.trim().length >= 2,
    placeholderData: keepPreviousData,
  })
  useEffect(() => setPick(0), [search])

  // Toggling needs a CatalogRow shape; the lookup result only has id/name.
  const asRow = (b: Blueprint): CatalogRow =>
    rows.find((r) => r.id === b.id) ?? {
      id: b.id,
      name: b.name,
      category: '',
      subcategory: '',
      category_label: '',
      type_display: null,
      grade: null,
      size: null,
      is_default: false,
      owned_by_me: false,
      my_owned_id: null,
      owner_ids: [],
      owner_count: 0,
      owners: [],
    }
  const add = (b: Blueprint) => {
    toggle(asRow(b))
    setRecent((r) => [b, ...r.filter((x) => x.id !== b.id)].slice(0, 8))
    setText('')
    inputRef.current?.focus()
  }

  return (
    <Paper sx={{ p: 1.5, px: 2, mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
      <TextField
        size="small"
        inputRef={inputRef}
        label={t('blueprints.quickAdd.label')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && options[pick]) {
            e.preventDefault()
            add(options[pick])
          } else if (e.key === 'Tab' && options.length > 0) {
            e.preventDefault()
            setPick((p) => (p + 1) % options.length)
          }
        }}
        sx={{ minWidth: 360, flex: 1 }}
      />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {options.slice(0, 6).map((o, i) => (
          <Chip key={o.id} label={o.name} color={i === pick ? 'primary' : 'default'} variant={i === pick ? 'filled' : 'outlined'} onClick={() => add(o)} />
        ))}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {recent.length > 0 && (
          <>
            {t('blueprints.quickAdd.justAdded')}
            {recent.map((b) => (
              <Chip key={b.id} size="small" variant="outlined" color="primary" label={b.name} onDelete={() => add(b)} />
            ))}
            —
          </>
        )}
        {t('blueprints.quickAdd.hint')}
      </Typography>
    </Paper>
  )
}

/** Design B: blueprint × member grid; your column is the clickable one. */
function MatrixView({
  data,
  sort,
  dir,
  onSort,
  toggle,
  onInfo,
}: {
  data: CatalogResponse | undefined
  sort: SortField
  dir: 'asc' | 'desc'
  onSort: (f: SortField) => void
  toggle: (row: CatalogRow) => void
  onInfo: (id: number) => void
}) {
  const { t } = useTranslation()
  const { me } = useMe()
  const rows = data?.data ?? []
  const others = (data?.members ?? []).filter((m) => m.id !== me?.id)
  const memberCol = { width: 44, minWidth: 44, maxWidth: 44, px: 0.5 } as const
  const meCol = { ...memberCol, bgcolor: 'action.hover' } as const

  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" stickyHeader aria-label={t('blueprints.matrix.tableAria')}>
        <TableHead>
          <TableRow>
            <SortHeader label={t('blueprints.colBlueprint')} field="name" sort={sort} dir={dir} onSort={onSort} sx={{ minWidth: 240 }} />
            <SortHeader label={t('blueprints.colType')} field="type" sort={sort} dir={dir} onSort={onSort} />
            <SortHeader label={t('blueprints.colGrade')} field="grade" sort={sort} dir={dir} onSort={onSort} />
            <TableCell align="center" sx={{ ...meCol, verticalAlign: 'bottom' }}>
              <Typography variant="caption" component="span" sx={{ display: 'inline-block', writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontWeight: 700, color: 'primary.main' }}>
                {t('blueprints.matrix.you')}
              </Typography>
            </TableCell>
            {others.map((m) => (
              <TableCell key={m.id} align="center" sx={{ ...memberCol, verticalAlign: 'bottom' }}>
                <Tooltip title={m.handle}>
                  <Typography
                    variant="caption"
                    component="span"
                    sx={{ display: 'inline-block', writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}
                  >
                    {m.handle}
                  </Typography>
                </Tooltip>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell sx={{ fontWeight: row.owned_by_me ? 600 : 400, cursor: 'pointer' }} onClick={() => onInfo(row.id)}>
                {row.name}
              </TableCell>
              <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{typeText(row)}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.grade ? t('craft.grade', { grade: gradeLabel(row.grade) }) : t('common.none')}</TableCell>
              <TableCell align="center" sx={meCol} padding="checkbox">
                <Checkbox
                  size="small"
                  checked={row.owned_by_me}
                  onChange={() => toggle(row)}
                  slotProps={{ input: { 'aria-label': t('blueprints.tickAria', { name: row.name }) } }}
                />
              </TableCell>
              {others.map((m) => (
                <TableCell key={m.id} align="center" sx={memberCol}>
                  {row.owner_ids.includes(m.id) && (
                    <CheckIcon fontSize="small" color="primary" titleAccess={t('blueprints.matrix.ownedBy', { member: m.handle })} sx={{ display: 'block', mx: 'auto' }} />
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {data && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={4 + others.length}>
                <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  {t('blueprints.emptyFiltered')}
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

export function BlueprintsPage() {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('checklist')
  const [filters, setFilters] = useState<Filters>({ search: '', category: '', grade: '', owned: true, unownedByMe: false, unowned: false })
  const [sort, setSort] = useState<SortField>('kiosk')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const [perPage, setPerPage] = useState(50)
  const [infoId, setInfoId] = useState<number | null>(null)
  const search = useDebounced(filters.search)

  const params = useMemo(
    () => ({
      search: search || undefined,
      category: filters.category || undefined,
      grade: filters.grade || undefined,
      owned: filters.owned ? 1 : undefined,
      unowned_by_me: view === 'checklist' && filters.unownedByMe ? 1 : undefined,
      unowned: filters.unowned ? 1 : undefined,
      sort: sort === 'kiosk' ? undefined : sort,
      dir: sort === 'kiosk' ? undefined : dir,
      per_page: perPage,
      page: page + 1,
    }),
    [search, filters.category, filters.grade, filters.owned, filters.unownedByMe, filters.unowned, view, sort, dir, perPage, page],
  )
  // Any change other than the page itself restarts from the first page.
  const filterKey = JSON.stringify({ ...params, page: undefined })
  useEffect(() => setPage(0), [filterKey])

  const { data, isLoading, isError } = useQuery({
    queryKey: [CATALOG_KEY, params],
    queryFn: async () => (await api.get<CatalogResponse>('/api/blueprints/catalog', { params })).data,
    placeholderData: keepPreviousData,
  })
  const { toggle, isError: toggleError, snackbar } = useToggleOwned()
  const queryClient = useQueryClient()

  const onSort = (field: SortField) => {
    if (sort === field) {
      if (dir === 'asc') setDir('desc')
      else {
        setSort('kiosk')
        setDir('asc')
      }
    } else {
      setSort(field)
      setDir(field === 'owners' ? 'desc' : 'asc')
    }
  }

  return (
    <Box>
      <PageHeader
        title={t('blueprints.title')}
        subtitle={t('blueprints.subtitle')}
        action={
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: View | null) => v && setView(v)} aria-label={t('blueprints.view.aria')}>
            <ToggleButton value="checklist">
              <PlaylistAddCheckIcon fontSize="small" sx={{ mr: 0.5 }} />
              {t('blueprints.view.checklist')}
            </ToggleButton>
            <ToggleButton value="matrix">
              <GridOnIcon fontSize="small" sx={{ mr: 0.5 }} />
              {t('blueprints.view.matrix')}
            </ToggleButton>
          </ToggleButtonGroup>
        }
      />
      <FilterBar filters={filters} onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))} categories={data?.categories ?? []} matrix={view === 'matrix'} />
      {view === 'matrix' && <QuickAdd toggle={toggle} rows={data?.data ?? []} />}
      <Paper>
        {isLoading && <LinearProgress />}
        {isError && <Alert severity="error">{t('blueprints.loadFailed')}</Alert>}
        {toggleError && <Alert severity="error">{t('blueprints.toggleFailed')}</Alert>}
        {view === 'checklist' ? (
          <ChecklistView data={data} sort={sort} dir={dir} onSort={onSort} toggle={toggle} onInfo={setInfoId} />
        ) : (
          <MatrixView data={data} sort={sort} dir={dir} onSort={onSort} toggle={toggle} onInfo={setInfoId} />
        )}
        <ListPager total={data?.total ?? 0} page={page} rowsPerPage={perPage} onPageChange={setPage} onRowsPerPageChange={setPerPage} />
      </Paper>
      <BlueprintInfoDialog
        blueprintId={infoId}
        onClose={() => setInfoId(null)}
        onToggleOwned={(info: BlueprintInfo) => {
          const row = data?.data.find((r) => r.id === info.blueprint.id)
          toggle(
            row ?? {
              id: info.blueprint.id,
              name: info.blueprint.name,
              category: '',
              subcategory: '',
              category_label: info.category_label,
              type_display: info.blueprint.type_display,
              grade: info.blueprint.grade,
              size: info.blueprint.item_meta?.size ?? null,
              is_default: info.blueprint.is_default,
              owned_by_me: info.owned_by_me,
              my_owned_id: null,
              owner_ids: info.owners.map((o) => o.id),
              owner_count: info.owners.filter((o) => !o.mine).length,
              owners: info.owners.filter((o) => !o.mine).map((o) => o.handle),
            },
          )
          queryClient.invalidateQueries({ queryKey: ['blueprint-info', info.blueprint.id] })
        }}
      />
      {snackbar}
    </Box>
  )
}
