import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { api } from '../lib/api'
import { gradeLabel } from '../pages/CraftPage'

interface Holding {
  member: string
  location: string
  system: string | null
  quality: number
  quantity: number
}

interface IngredientDetail {
  name: string
  kind: string | null
  need: number
  unit: 'mscu' | 'pieces'
  available: number
  holdings: Holding[]
}

interface CraftDetail {
  blueprint: {
    id: number
    name: string
    item_class: string | null
    type: string | null
    sub_type: string | null
    grade: string | null
    craft_time_seconds: number | null
    is_default: boolean
    description: string | null
    image_url: string | null
    manufacturer: string | null
    item_meta: { mass?: number; size?: number; item_grade?: string; classification?: string } | null
    game_version: string | null
  }
  owners: string[]
  ingredients: IngredientDetail[]
  craftable: boolean
  est_output_quality: number | null
  est_stat_modifier_percent: number | null
}

function qualityTierColor(q: number): string {
  if (q >= 900) return '#c98a3d'
  if (q >= 800) return '#9a6bc9'
  if (q >= 700) return '#4f8fce'
  if (q >= 600) return '#58a862'
  if (q >= 400) return '#c9d1d9'
  return '#8f8f8f'
}

function amount(value: number, unit: 'mscu' | 'pieces'): string {
  return unit === 'mscu'
    ? `${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} SCU`
    : `${value.toLocaleString()} pcs`
}

function craftTime(seconds: number | null): string | null {
  if (!seconds) return null
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  return `${(seconds / 3600).toLocaleString(undefined, { maximumFractionDigits: 1 })} h`
}

interface CraftResultResponse {
  crafted: string
  quality: number | null
  consumed: { name: string; quantity: number; unit: 'mscu' | 'pieces' }[]
}

export function CraftDetailDialog({ blueprintId, onClose }: { blueprintId: number; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['craft-detail', blueprintId],
    queryFn: async () => (await api.get<CraftDetail>(`/api/craftability/${blueprintId}`)).data,
  })

  const craft = useMutation({
    mutationFn: async () =>
      (await api.post<CraftResultResponse>(`/api/craftability/${blueprintId}/craft`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['craft-detail', blueprintId] })
      queryClient.invalidateQueries({ queryKey: ['craftability'] })
      queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
      queryClient.invalidateQueries({ queryKey: ['item-stacks'] })
    },
  })

  const bp = data?.blueprint

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      {isLoading && <LinearProgress />}
      {isError && <Alert severity="error">Could not load the blueprint details.</Alert>}
      {bp && (
        <>
          <DialogTitle sx={{ pb: 0.5 }}>
            {bp.name}
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              {bp.manufacturer && <Chip size="small" label={bp.manufacturer} variant="outlined" />}
              {bp.type && <Chip size="small" label={bp.sub_type ? `${bp.type} · ${bp.sub_type}` : bp.type} variant="outlined" />}
              {bp.grade && <Chip size="small" label={`Grade ${gradeLabel(bp.grade)}`} variant="outlined" />}
              {bp.item_meta?.size !== undefined && <Chip size="small" label={`Size ${bp.item_meta.size}`} variant="outlined" />}
              {craftTime(bp.craft_time_seconds) && (
                <Chip size="small" color="secondary" variant="outlined" label={`Craft time ${craftTime(bp.craft_time_seconds)}`} />
              )}
            </Stack>
          </DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mt: 1.5, flexWrap: 'wrap' }}>
              {bp.image_url && (
                <Box
                  component="img"
                  src={bp.image_url}
                  alt={bp.name}
                  sx={{ width: 220, maxWidth: '40%', borderRadius: 1, border: 1, borderColor: 'divider' }}
                />
              )}
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 240 }}>
                {bp.description || 'No description available.'}
              </Typography>
            </Box>

            {data.est_output_quality !== null && (
              <>
                <Divider sx={{ my: 2 }} />
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Typography variant="subtitle2">Best craft with current materials</Typography>
                  <Typography
                    variant="h5"
                    sx={{ color: qualityTierColor(data.est_output_quality), fontVariantNumeric: 'tabular-nums' }}
                  >
                    {data.est_output_quality}
                  </Typography>
                  {data.est_stat_modifier_percent !== null && (
                    <Typography variant="body2" color="text.secondary">
                      ≈ {data.est_stat_modifier_percent > 0 ? '+' : ''}
                      {data.est_stat_modifier_percent}% stats vs. shop baseline
                      <Typography component="span" variant="caption" sx={{ ml: 0.5 }}>
                        (community-measured estimate)
                      </Typography>
                    </Typography>
                  )}
                  {!data.craftable && (
                    <Chip size="small" label="Materials incomplete" color="secondary" variant="outlined" />
                  )}
                </Box>
              </>
            )}

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Blueprint holders
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              {bp.is_default && <Chip size="small" label="Everyone (default blueprint)" color="primary" variant="outlined" />}
              {(data?.owners ?? []).map((o) => (
                <Chip key={o} size="small" label={o} />
              ))}
              {!bp.is_default && (data?.owners ?? []).length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  Nobody in the org owns this blueprint yet.
                </Typography>
              )}
            </Stack>

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Materials
            </Typography>
            <Stack spacing={2}>
              {(data?.ingredients ?? []).map((ing) => {
                const enough = ing.available >= ing.need
                return (
                  <Box key={ing.name}>
                    <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: 'baseline' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {ing.name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: enough ? 'primary.main' : 'text.secondary' }}>
                        {amount(ing.available, ing.unit)} of {amount(ing.need, ing.unit)} needed
                      </Typography>
                      {enough && <Chip size="small" label="Covered" color="primary" variant="outlined" />}
                    </Stack>
                    {ing.holdings.length > 0 ? (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Member</TableCell>
                            <TableCell>Location</TableCell>
                            <TableCell align="right">Quality</TableCell>
                            <TableCell align="right">Quantity</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {ing.holdings.map((h, i) => (
                            <TableRow key={i}>
                              <TableCell>{h.member}</TableCell>
                              <TableCell>
                                {h.location}
                                {h.system && (
                                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                                    ({h.system})
                                  </Typography>
                                )}
                              </TableCell>
                              <TableCell align="right">{h.quality}</TableCell>
                              <TableCell align="right">{amount(h.quantity, ing.unit)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Nobody has any — this is the missing piece.
                      </Typography>
                    )}
                  </Box>
                )
              })}
            </Stack>

            {craft.isSuccess && (
              <Alert severity="success" sx={{ mt: 2 }}>
                Crafted {craft.data.crafted}
                {craft.data.quality !== null ? ` at quality ${craft.data.quality}` : ''} — materials
                deducted, item added to your Items ledger.
              </Alert>
            )}
            {craft.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                Could not record the craft — materials may have changed. Reopen to refresh.
              </Alert>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={onClose}>Close</Button>
            <Button
              variant="contained"
              disabled={!data?.craftable || craft.isPending || craft.isSuccess}
              onClick={() => {
                if (window.confirm(`Record crafting ${bp.name}? The listed materials will be deducted from the ledger.`)) {
                  craft.mutate()
                }
              }}
            >
              {craft.isPending ? 'Recording…' : craft.isSuccess ? 'Crafted' : 'I crafted this'}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
