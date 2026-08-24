import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { api } from '../lib/api'
import { PageHeader } from '../components/PageHeader'

interface CraftResult {
  id: number
  name: string
  item_class: string | null
  type: string | null
  sub_type: string | null
  grade: string | null
  owners: string[]
  is_default: boolean
  craftable: boolean
  coverage: number
  missing: { name: string; missing: number; unit: 'mscu' | 'pieces' }[]
  est_output_quality: number | null
}

interface CraftabilityResponse {
  types: string[]
  results: CraftResult[]
}

function missingLabel(m: CraftResult['missing'][number]): string {
  return m.unit === 'mscu'
    ? `${(m.missing / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} SCU ${m.name}`
    : `${m.missing} × ${m.name}`
}

export function CraftPage() {
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [craftableOnly, setCraftableOnly] = useState(false)
  const [includeUnowned, setIncludeUnowned] = useState(false)

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

  return (
    <Box>
      <PageHeader
        title="Craft"
        subtitle="What the org can craft with the resources on hand — best options first, nearest misses after"
      />
      <Paper sx={{ p: 2, mb: 2, display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        <TextField
          size="small"
          label="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 200 }}
        />
        <TextField
          size="small"
          select
          label="Type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All types</MenuItem>
          {(data?.types ?? []).map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={<Switch checked={craftableOnly} onChange={(e) => setCraftableOnly(e.target.checked)} />}
          label="Craftable now"
        />
        <FormControlLabel
          control={<Switch checked={includeUnowned} onChange={(e) => setIncludeUnowned(e.target.checked)} />}
          label="Include unowned blueprints"
        />
      </Paper>
      <Paper>
        {isLoading && <LinearProgress />}
        {isError && <Alert severity="error">Could not compute craftability.</Alert>}
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Craftability">
            <TableHead>
              <TableRow>
                <TableCell>Blueprint</TableCell>
                <TableCell>Type / grade</TableCell>
                <TableCell>Blueprint holders</TableCell>
                <TableCell sx={{ minWidth: 160 }}>Materials</TableCell>
                <TableCell>Missing</TableCell>
                <TableCell align="right">Est. quality</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.results ?? []).map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell>
                    {r.name}
                    {r.craftable && (
                      <Chip label="Craftable" color="primary" size="small" variant="outlined" sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {[r.type, r.sub_type].filter(Boolean).join(' · ')}
                      {r.grade ? ` · G${r.grade}` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {r.is_default ? 'Everyone (default)' : r.owners.join(', ') || '—'}
                    </Typography>
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
                      {r.missing.slice(0, 3).map(missingLabel).join(', ')}
                      {r.missing.length > 3 ? ` +${r.missing.length - 3} more` : ''}
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
                      Nothing to show — add resources to the ledger, sync blueprints from the desktop
                      client, or widen the filters.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  )
}
