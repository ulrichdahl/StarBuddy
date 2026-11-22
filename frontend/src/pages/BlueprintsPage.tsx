import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Snackbar from '@mui/material/Snackbar'
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
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import GridOnIcon from '@mui/icons-material/GridOn'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import SearchIcon from '@mui/icons-material/Search'
import { api, unwrapList } from '../lib/api'
import { useMe } from '../lib/auth'
import type { Blueprint, BlueprintInfo, CatalogResponse, CatalogRow, PoolProgress } from '../lib/types'
import { PageHeader } from '../components/PageHeader'
import { OwnersCell } from '../components/OwnersCell'
import { ListPager } from '../components/ListPager'
import { BlueprintInfoDialog } from '../components/BlueprintInfoDialog'
import { gradeLabel } from './CraftPage'
import { usePinnedBlueprints } from '../lib/craftTargets'
import { hud } from '../theme'
import { PinMark } from '../components/PinMark'

type View = 'checklist' | 'matrix'
type SortField = 'kiosk' | 'name' | 'type' | 'grade' | 'poolName' | 'pool' | 'owners'

interface Filters {
  search: string
  category: string
  grade: string
  /** Owned by anyone in the org (or a default blueprint) — the page's default view. */
  ownedByMe: boolean
  owned: boolean
  unownedByMe: boolean
  unowned: boolean
}

const CATALOG_KEY = 'blueprints-catalog'

/** Type column: the kiosk/type label, with the size for ship parts ("Cooler · S2"). */
const typeText = (row: CatalogRow) => `${row.type_display ?? row.category_label}${row.size !== null ? ` · S${row.size}` : ''}`

/** "Faction · Pool", the way the client names a pool too; the pool alone when nobody hands it out. Game data, shown as-is. */
const poolName = (pool: PoolProgress) => [(pool.factions ?? []).join(', '), pool.pool_label].filter(Boolean).join(' · ')

/**
 * The reward pool a recipe comes out of, and how far through it the player is,
 * as two cells.
 *
 * The smallest pool only: a recipe is rarely in more than two, the small one
 * is the better chance of it, and a second line of pool names would cost the
 * column more than it is worth. "+N more" names the others on hover, and the
 * dialog lists them all.
 */
function PoolCells({ row }: { row: CatalogRow }) {
  const { t } = useTranslation()
  const pool = row.pools[0]
  if (!pool) {
    return (
      <>
        <TableCell sx={{ color: 'text.disabled' }}>{t('common.none')}</TableCell>
        <TableCell />
      </>
    )
  }

  return (
    <>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        {/* Who hands it out, on a line of its own so the column stays narrow. */}
        {(pool.factions ?? []).length > 0 && (
          <Typography variant="caption" component="div" color="text.secondary" sx={{ lineHeight: 1.3, whiteSpace: 'normal' }}>
            {pool.factions!.join(', ')}
          </Typography>
        )}
        {/* A pool no live mission hands out: the recipe is in the game files
            and nowhere on the contract board. */}
        {!pool.awardable && (
          <Tooltip title={t('blueprints.info.poolUnawardable')}>
            <WarningAmberIcon
              fontSize="inherit"
              color="warning"
              sx={{ mr: 0.5, verticalAlign: 'text-bottom' }}
            />
          </Tooltip>
        )}
        <Typography
          variant="body2"
          component="span"
          sx={{ color: pool.awardable ? undefined : 'text.disabled' }}
        >
          {pool.pool_label}
        </Typography>
        {row.pools.length > 1 && (
          <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{row.pools.slice(1).map(poolName).join('\n')}</Box>}>
            <Typography variant="caption" component="span" color="text.secondary" sx={{ ml: 0.75, cursor: 'help' }}>
              {t('blueprints.poolMore', { count: row.pools.length - 1 })}
            </Typography>
          </Tooltip>
        )}
      </TableCell>
      <TableCell
        align="right"
        sx={{ whiteSpace: 'nowrap', color: pool.owned_percent === 100 ? 'success.main' : 'text.secondary' }}
      >
        {t('blueprints.poolProgressShort', {
          owned: pool.owned_in_pool,
          count: pool.in_pool,
          percent: pool.owned_percent,
        })}
      </TableCell>
    </>
  )
}

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
      <OwnershipToggles filters={filters} matrix={matrix} onChange={onChange} />
    </Paper>
  )
}

type OwnKey = 'ownedByMe' | 'owned' | 'unownedByMe' | 'unowned'

const svgIcon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
)
// The desktop client's glyphs, so a filter looks the same in both: a person
// or a group, ticked (owned) or struck through (not).
const PERSON = (
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.7-3.6 3.3-5.5 6.5-5.5 1.3 0 2.5.3 3.5.9" />
  </>
)
const PEOPLE = (
  <>
    <circle cx="8" cy="8" r="3" />
    <path d="M2 19c.6-3 2.8-4.5 6-4.5 1.2 0 2.3.2 3.2.7" />
    <path d="M14 5a3 3 0 0 1 0 6" />
  </>
)
const TICK = <path d="M14.5 17.5l2.5 2.5 5-5.5" />
const CROSS = <path d="M15.5 14.5l6 6M21.5 14.5l-6 6" />

const OWN_TOGGLES: { key: OwnKey; icon: ReactNode; label: string; good: boolean; off: OwnKey[]; checklistOnly?: boolean }[] = [
  { key: 'ownedByMe', icon: svgIcon(<>{PERSON}{TICK}</>), label: 'blueprints.own.mine', good: true, off: ['unownedByMe', 'unowned'], checklistOnly: true },
  { key: 'owned', icon: svgIcon(<>{PEOPLE}{TICK}</>), label: 'blueprints.own.owned', good: true, off: ['unowned'] },
  { key: 'unownedByMe', icon: svgIcon(<>{PERSON}{CROSS}</>), label: 'blueprints.own.unownedByMe', good: false, off: ['ownedByMe'], checklistOnly: true },
  { key: 'unowned', icon: svgIcon(<>{PEOPLE}{CROSS}</>), label: 'blueprints.own.unowned', good: false, off: ['ownedByMe', 'owned'] },
]

/**
 * Who owns it, as four toggles: by me, in the org, not by me, by nobody in
 * the org. Turning one on turns off those it contradicts; "the org has it,
 * I do not" stays possible.
 */
function OwnershipToggles({ filters, matrix, onChange }: { filters: Filters; matrix: boolean; onChange: (patch: Partial<Filters>) => void }) {
  const { t } = useTranslation()
  return (
    <Box role="group" aria-label={t('blueprints.own.label')} sx={{ display: 'flex', gap: 0.75 }}>
      {OWN_TOGGLES.filter((o) => !(matrix && o.checklistOnly)).map((o) => {
        const on = filters[o.key]
        return (
          <Tooltip key={o.key} title={t(o.label)}>
            <ToggleButton
              value={o.key}
              selected={on}
              aria-label={t(o.label)}
              onChange={() => onChange({ [o.key]: !on, ...(on ? {} : Object.fromEntries(o.off.map((k) => [k, false]))) })}
              sx={{
                width: 40,
                height: 40,
                color: hud.textDim,
                '&.Mui-selected, &.Mui-selected:hover': {
                  color: o.good ? 'success.main' : hud.danger,
                  bgcolor: o.good ? 'rgba(102,187,106,0.12)' : 'rgba(242,118,107,0.12)',
                  borderColor: o.good ? 'success.main' : hud.danger,
                },
              }}
            >
              {o.icon}
            </ToggleButton>
          </Tooltip>
        )
      })}
    </Box>
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
  const pinned = usePinnedBlueprints()
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
              <SortHeader label={t('blueprints.colPool')} field="poolName" sort={sort} dir={dir} onSort={onSort} />
              <SortHeader label={t('blueprints.colPoolDone')} field="pool" sort={sort} dir={dir} onSort={onSort} align="right" sx={{ width: 120 }} />
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
                      <TableCell colSpan={7} sx={{ bgcolor: 'rgba(91, 200, 219, 0.06)', color: 'primary.main', fontWeight: 700, fontSize: '0.8125rem', letterSpacing: '0.02em' }}>
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
                      {pinned.has(row.id) && <PinMark quantity={pinned.get(row.id)} />}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{typeText(row)}</TableCell>
                    <TableCell>{row.grade ? t('craft.grade', { grade: gradeLabel(row.grade) }) : t('common.none')}</TableCell>
                    <PoolCells row={row} />
                    <TableCell align="center">
                      <OwnersCell isDefault={row.is_default} ownedByMe={row.owned_by_me} owners={row.owners} />
                    </TableCell>
                  </TableRow>
                </Fragment>
              )
            })}
            {data && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
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
      pools: [],
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
  const pinned = usePinnedBlueprints()
  const { t } = useTranslation()
  const { me } = useMe()
  const rows = data?.data ?? []
  const others = (data?.members ?? []).filter((m) => m.id !== me?.id)
  const memberCol = { width: 44, minWidth: 44, maxWidth: 44, px: 0.5 } as const
  const meCol = { ...memberCol, bgcolor: 'action.hover' } as const
  // A column of types or grades is as wide as its words; the blueprint name
  // takes whatever is left. 1% and 100% is how a table is told which is which.
  const tightCol = { width: '1%', whiteSpace: 'nowrap' } as const
  // Handles written up the page at a slant, so a dozen fit across a screen
  // and still read as words.
  const handleSlant = { display: 'inline-block', writingMode: 'vertical-rl', transform: 'rotate(225deg)' } as const

  return (
    <TableContainer sx={{ overflowX: 'auto' }}>
      <Table size="small" stickyHeader aria-label={t('blueprints.matrix.tableAria')}>
        <TableHead>
          <TableRow>
            <SortHeader label={t('blueprints.colBlueprint')} field="name" sort={sort} dir={dir} onSort={onSort} sx={{ minWidth: 240, width: '100%' }} />
            <SortHeader label={t('blueprints.colType')} field="type" sort={sort} dir={dir} onSort={onSort} sx={tightCol} />
            <SortHeader label={t('blueprints.colGrade')} field="grade" sort={sort} dir={dir} onSort={onSort} sx={tightCol} />
            <TableCell align="center" sx={{ ...meCol, verticalAlign: 'bottom' }}>
              <Typography variant="caption" component="span" sx={{ ...handleSlant, fontWeight: 700, color: 'primary.main' }}>
                {t('blueprints.matrix.you')}
              </Typography>
            </TableCell>
            {others.map((m) => (
              <TableCell key={m.id} align="center" sx={{ ...memberCol, verticalAlign: 'bottom' }}>
                <Tooltip title={m.handle}>
                  <Typography
                    variant="caption"
                    component="span"
                    sx={{ ...handleSlant, maxHeight: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}
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
              <TableCell sx={{ width: '100%', fontWeight: row.owned_by_me ? 600 : 400, cursor: 'pointer' }} onClick={() => onInfo(row.id)}>
                {row.name}
                {pinned.has(row.id) && <PinMark quantity={pinned.get(row.id)} />}
              </TableCell>
              <TableCell sx={{ ...tightCol, color: 'text.secondary' }}>{typeText(row)}</TableCell>
              <TableCell sx={tightCol}>{row.grade ? t('craft.grade', { grade: gradeLabel(row.grade) }) : t('common.none')}</TableCell>
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
  const [filters, setFilters] = useState<Filters>({ search: '', category: '', grade: '', ownedByMe: false, owned: false, unownedByMe: false, unowned: false })
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
      owned_by_me: view === 'checklist' && filters.ownedByMe ? 1 : undefined,
      unowned_by_me: view === 'checklist' && filters.unownedByMe ? 1 : undefined,
      unowned: filters.unowned ? 1 : undefined,
      sort: sort === 'kiosk' ? undefined : sort,
      dir: sort === 'kiosk' ? undefined : dir,
      per_page: perPage,
      page: page + 1,
    }),
    [search, filters.category, filters.grade, filters.ownedByMe, filters.owned, filters.unownedByMe, filters.unowned, view, sort, dir, perPage, page],
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
              pools: info.missions.map((pool) => ({
                pool_key: pool.pool_key,
                pool_label: pool.pool_label,
                awardable: pool.awardable,
                in_pool: pool.in_pool,
                owned_in_pool: pool.owned_in_pool,
                owned_percent: pool.owned_percent,
              })),
            },
          )
          queryClient.invalidateQueries({ queryKey: ['blueprint-info', info.blueprint.id] })
        }}
      />
      {snackbar}
    </Box>
  )
}
