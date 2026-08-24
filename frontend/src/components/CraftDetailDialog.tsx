import { useQuery } from '@tanstack/react-query'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
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

export function CraftDetailDialog({ blueprintId, onClose }: { blueprintId: number; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['craft-detail', blueprintId],
    queryFn: async () => (await api.get<CraftDetail>(`/api/craftability/${blueprintId}`)).data,
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
              {bp.grade && <Chip size="small" label={`Blueprint grade ${bp.grade}`} variant="outlined" />}
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
          </DialogContent>
        </>
      )}
    </Dialog>
  )
}
