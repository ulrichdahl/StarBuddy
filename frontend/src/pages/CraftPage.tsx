import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import GroupsIcon from '@mui/icons-material/Groups'
import HowToRegIcon from '@mui/icons-material/HowToReg'
import PublicIcon from '@mui/icons-material/Public'
import { api } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { CraftDetailDialog } from '../components/CraftDetailDialog'

interface CraftResult {
  id: number
  name: string
  item_class: string | null
  type: string | null
  sub_type: string | null
  grade: string | null
  type_display: string | null
  owner_count: number
  owned_by_me: boolean
  is_default: boolean
  craftable: boolean
  coverage: number
  missing: { name: string; missing: number; unit: 'mscu' | 'pieces' }[]
  est_output_quality: number | null
}

interface CraftabilityResponse {
  types: { value: string; label: string }[]
  results: CraftResult[]
}

/** Numeric blueprint grades map to letters: 1=A, 2=B, 3=C, 4=D (game data, not localized). */
export function gradeLabel(grade: string | null): string | null {
  if (grade === null) return null
  return { '1': 'A', '2': 'B', '3': 'C', '4': 'D' }[grade] ?? grade
}

function missingLabel(m: CraftResult['missing'][number], t: TFunction, locale: string): string {
  return m.unit === 'mscu'
    ? t('craft.missingScu', {
        amount: (m.missing / 1000).toLocaleString(locale, { maximumFractionDigits: 3 }),
        name: m.name,
      })
    : t('craft.missingPieces', { count: m.missing, name: m.name })
}

export function CraftPage() {
  const { t, i18n } = useTranslation()
  // `search` and `all` live in the URL too, so the global item search can deep-link here.
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [type, setType] = useState('')
  const [craftableOnly, setCraftableOnly] = useState(false)
  const [includeUnowned, setIncludeUnowned] = useState(searchParams.get('all') === '1')

  // A new navigation (e.g. another AppBar search while already here) re-seeds the filters.
  useEffect(() => {
    setSearch(searchParams.get('search') ?? '')
    setIncludeUnowned(searchParams.get('all') === '1')
  }, [searchParams])

  const syncUrl = (nextSearch: string, nextAll: boolean) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (nextSearch) next.set('search', nextSearch)
        else next.delete('search')
        if (nextAll) next.set('all', '1')
        else next.delete('all')
        return next
      },
      { replace: true },
    )
  }
  const [detailId, setDetailId] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  const rowsPerPage = 50

  const { data, isLoading, isError } = useQuery({
    queryKey: ['craftability', search, type, craftableOnly, includeUnowned],
    queryFn: async () =>
      (
        await api.get<CraftabilityResponse>('/api/craftability', {
          params: {
            search: search || undefined,
            type: type || undefined,
            craftable: craftableOnly ? 1 : undefined,
            all: includeUnowned ? 1 : undefined,
          },
        })
      ).data,
    placeholderData: (prev) => prev,
  })

  // Back to the first page whenever a filter changes the result set.
  useEffect(() => {
    setPage(0)
  }, [search, type, craftableOnly, includeUnowned])

  return (
    <Box>
      <PageHeader title={t('craft.title')} subtitle={t('craft.subtitle')} />
      <Paper sx={{ p: 2, mb: 2, display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        <TextField
          size="small"
          label={t('craft.search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            syncUrl(e.target.value, includeUnowned)
          }}
          sx={{ minWidth: 200 }}
        />
        <TextField
          size="small"
          select
          label={t('craft.type')}
          value={type}
          onChange={(e) => setType(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">{t('craft.allTypes')}</MenuItem>
          {(data?.types ?? []).map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={<Switch checked={craftableOnly} onChange={(e) => setCraftableOnly(e.target.checked)} />}
          label={t('craft.craftableNow')}
        />
        <FormControlLabel
          control={
            <Switch
              checked={includeUnowned}
              onChange={(e) => {
                setIncludeUnowned(e.target.checked)
                syncUrl(search, e.target.checked)
              }}
            />
          }
          label={t('craft.includeUnowned')}
        />
      </Paper>
      <Paper>
        {isLoading && <LinearProgress />}
        {isError && <Alert severity="error">{t('craft.loadError')}</Alert>}
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label={t('craft.tableAria')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('craft.colBlueprint')}</TableCell>
                <TableCell>{t('craft.colTypeGrade')}</TableCell>
                <TableCell align="center">{t('craft.colHolders')}</TableCell>
                <TableCell sx={{ minWidth: 160 }}>{t('craft.colMaterials')}</TableCell>
                <TableCell>{t('craft.colMissing')}</TableCell>
                <TableCell align="right">{t('craft.colEstQuality')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.results ?? []).slice(page * rowsPerPage, (page + 1) * rowsPerPage).map((r) => (
                <TableRow key={r.id} hover onClick={() => setDetailId(r.id)} sx={{ cursor: 'pointer' }}>
                  {/* Craftable-now reads as a thick primary edge, not a pill. */}
                  <TableCell
                    sx={{
                      borderLeft: 4,
                      borderLeftColor: r.craftable ? 'primary.main' : 'transparent',
                    }}
                  >
                    {r.name}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {r.type_display ?? [r.type, r.sub_type].filter(Boolean).join(' · ')}
                      {r.grade ? ` · ${t('craft.grade', { grade: gradeLabel(r.grade) })}` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                      {r.is_default && (
                        <Tooltip title={t('craft.defaultBlueprintTooltip')}>
                          <PublicIcon fontSize="small" color="disabled" />
                        </Tooltip>
                      )}
                      {r.owned_by_me && (
                        <Tooltip title={t('craft.youHaveTooltip')}>
                          <HowToRegIcon fontSize="small" color="primary" />
                        </Tooltip>
                      )}
                      {r.owner_count > 0 && (
                        <Tooltip
                          title={t(r.owned_by_me ? 'craft.ownersBesidesYouTooltip' : 'craft.ownersTooltip', {
                            count: r.owner_count,
                          })}
                        >
                          <Chip
                            size="small"
                            variant="outlined"
                            icon={<GroupsIcon />}
                            label={r.owner_count}
                            sx={{ fontVariantNumeric: 'tabular-nums' }}
                          />
                        </Tooltip>
                      )}
                      {!r.is_default && r.owner_count === 0 && !r.owned_by_me && (
                        <Typography variant="body2" color="text.disabled">
                          —
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <LinearProgress
                        variant="determinate"
                        value={r.coverage * 100}
                        color={r.craftable ? 'primary' : 'secondary'}
                        sx={{ flex: 1, height: 6, borderRadius: 3 }}
                      />
                      <Typography variant="caption" sx={{ minWidth: 36, textAlign: 'right' }}>
                        {Math.round(r.coverage * 100)}%
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {r.missing
                        .slice(0, 3)
                        .map((m) => missingLabel(m, t, i18n.language))
                        .join(', ')}
                      {r.missing.length > 3 ? ` ${t('craft.moreMissing', { count: r.missing.length - 3 })}` : ''}
                      {r.missing.length === 0 ? '—' : ''}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{r.est_output_quality ?? '—'}</TableCell>
                </TableRow>
              ))}
              {!isLoading && (data?.results ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                      {t('craft.emptyState')}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {(data?.results ?? []).length > rowsPerPage && (
          <TablePagination
            component="div"
            count={data?.results.length ?? 0}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            rowsPerPageOptions={[rowsPerPage]}
            labelDisplayedRows={({ from, to, count }) => t('craft.displayedRows', { from, to, count })}
            getItemAriaLabel={(kind) => t(`craft.page.${kind}`)}
          />
        )}
      </Paper>
      {detailId !== null && <CraftDetailDialog blueprintId={detailId} onClose={() => setDetailId(null)} />}
    </Box>
  )
}
