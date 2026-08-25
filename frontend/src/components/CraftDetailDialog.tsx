import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
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
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { api } from '../lib/api'
import { gradeLabel } from '../pages/CraftPage'
import { ProductStats } from './ProductStats'

interface Holding {
  id: number
  member: string
  mine: boolean
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

interface Owner {
  id: number
  member: string
  mine: boolean
  uses_personal: number
  uses_org: number
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
    item_meta: {
      mass?: number
      size?: number
      item_grade?: string
      classification?: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stats?: Record<string, any>
    } | null
    game_version: string | null
  }
  owners: Owner[]
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
  quantity: number
  quality: number | null
  consumed: { name: string; quantity: number; unit: 'mscu' | 'pieces' }[]
}

type Selection = Record<string, Set<number>>

/** Pick the best-quality stacks per ingredient until the need is covered. */
function defaultSelection(ingredients: IngredientDetail[], qty: number): Selection {
  const sel: Selection = {}
  for (const ing of ingredients) {
    const picked = new Set<number>()
    let left = ing.need * qty
    for (const h of ing.holdings) {
      // already sorted best quality first
      if (left <= 0) break
      picked.add(h.id)
      left -= h.quantity
    }
    sel[ing.name] = picked
  }
  return sel
}

interface Plan {
  perIngredient: Record<string, { need: number; selected: number; covered: boolean }>
  craftable: boolean
  estQuality: number | null
  modifierPercent: number | null
}

/** Simulate consumption of the selected stacks the way the backend will. */
function planCraft(ingredients: IngredientDetail[], sel: Selection, qty: number): Plan {
  const perIngredient: Plan['perIngredient'] = {}
  let craftable = true
  let weighted = 0
  let consumedMscu = 0

  for (const ing of ingredients) {
    const need = ing.need * qty
    const chosen = sel[ing.name] ?? new Set()
    let left = need
    let selectedTotal = 0
    for (const h of ing.holdings) {
      if (!chosen.has(h.id)) continue
      selectedTotal += h.quantity
      if (left <= 0) continue
      const use = Math.min(left, h.quantity)
      left -= use
      if (ing.unit === 'mscu') {
        weighted += use * h.quality
        consumedMscu += use
      }
    }
    const covered = need <= 0 || left <= 0
    if (!covered) craftable = false
    perIngredient[ing.name] = { need, selected: selectedTotal, covered }
  }

  const estQuality = consumedMscu > 0 ? Math.round(weighted / consumedMscu) : null
  return {
    perIngredient,
    craftable,
    estQuality,
    modifierPercent: estQuality !== null ? Math.round((estQuality - 500) * 1.5) / 100 : null,
  }
}

export function CraftDetailDialog({ blueprintId, onClose }: { blueprintId: number; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['craft-detail', blueprintId],
    queryFn: async () => (await api.get<CraftDetail>(`/api/craftability/${blueprintId}`)).data,
  })

  const [qty, setQty] = useState(1)
  const [useType, setUseType] = useState<'personal' | 'org'>('personal')
  const [ownedId, setOwnedId] = useState<number | null>(null)
  const [selection, setSelection] = useState<Selection>({})

  // Re-plan defaults whenever the data or the craft count changes.
  useEffect(() => {
    if (!data) return
    setSelection(defaultSelection(data.ingredients, qty))
    setOwnedId((prev) => {
      if (prev !== null && data.owners.some((o) => o.id === prev)) return prev
      return (data.owners.find((o) => o.mine) ?? data.owners[0])?.id ?? null
    })
  }, [data, qty])

  const plan = useMemo(
    () => (data ? planCraft(data.ingredients, selection, qty) : null),
    [data, selection, qty],
  )

  const craft = useMutation({
    mutationFn: async () =>
      (
        await api.post<CraftResultResponse>(`/api/craftability/${blueprintId}/craft`, {
          quantity: qty,
          use_type: useType,
          owned_id: ownedId,
          stack_ids: Object.values(selection).flatMap((s) => [...s]),
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['craft-detail', blueprintId] })
      queryClient.invalidateQueries({ queryKey: ['craftability'] })
      queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
      queryClient.invalidateQueries({ queryKey: ['item-stacks'] })
    },
  })

  const toggleStack = (ingredient: string, id: number) => {
    setSelection((prev) => {
      const next = { ...prev }
      const set = new Set(next[ingredient] ?? [])
      if (set.has(id)) set.delete(id)
      else set.add(id)
      next[ingredient] = set
      return next
    })
  }

  const bp = data?.blueprint

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      {isLoading && <LinearProgress />}
      {isError && <Alert severity="error">Could not load the blueprint details.</Alert>}
      {bp && plan && (
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

            {bp.item_meta?.stats && (
              <>
                <Divider sx={{ my: 2 }} />
                <ProductStats
                  stats={bp.item_meta.stats}
                  mass={bp.item_meta.mass}
                  modifierPercent={plan.modifierPercent ?? data.est_stat_modifier_percent}
                />
              </>
            )}

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Blueprint holders
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                blueprints are never consumed — pick whose copy this craft counts against
              </Typography>
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              {bp.is_default && <Chip size="small" label="Everyone (default blueprint)" color="primary" variant="outlined" />}
              {(data?.owners ?? []).map((o) => (
                <Chip
                  key={o.id}
                  size="small"
                  label={`${o.member} · ${o.uses_personal}× personal / ${o.uses_org}× org`}
                  color={ownedId === o.id ? 'primary' : 'default'}
                  variant={ownedId === o.id ? 'filled' : 'outlined'}
                  onClick={() => setOwnedId(o.id)}
                />
              ))}
              {!bp.is_default && (data?.owners ?? []).length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  Nobody in the org owns this blueprint yet.
                </Typography>
              )}
            </Stack>

            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={2} sx={{ mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="subtitle2">Craft</Typography>
              <TextField
                type="number"
                size="small"
                label="How many"
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                slotProps={{ htmlInput: { min: 1, max: 100 } }}
                sx={{ width: 100 }}
              />
              <ToggleButtonGroup
                size="small"
                exclusive
                value={useType}
                onChange={(_, v) => v && setUseType(v)}
              >
                <ToggleButton value="personal">Personal use</ToggleButton>
                <ToggleButton value="org">Org use</ToggleButton>
              </ToggleButtonGroup>
              {plan.estQuality !== null && (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                  <Typography variant="body2" color="text.secondary">
                    Output quality
                  </Typography>
                  <Typography
                    variant="h6"
                    sx={{ color: qualityTierColor(plan.estQuality), fontVariantNumeric: 'tabular-nums' }}
                  >
                    {plan.estQuality}
                  </Typography>
                </Stack>
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Tick the stacks the craft should draw from — the best qualities are pre-selected. Amounts
              beyond what is needed stay untouched.
            </Typography>

            <Stack spacing={2}>
              {(data?.ingredients ?? []).map((ing) => {
                const p = plan.perIngredient[ing.name]
                const chosen = selection[ing.name] ?? new Set()
                return (
                  <Box key={ing.name}>
                    <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: 'baseline' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {ing.name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: p?.covered ? 'primary.main' : 'error.main' }}>
                        {amount(p?.selected ?? 0, ing.unit)} selected of {amount(p?.need ?? 0, ing.unit)} needed
                      </Typography>
                      {p?.covered ? (
                        <Chip size="small" label="Covered" color="primary" variant="outlined" />
                      ) : (
                        <Chip size="small" label="Not enough selected" color="error" variant="outlined" />
                      )}
                    </Stack>
                    {ing.holdings.length > 0 ? (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell padding="checkbox">Use</TableCell>
                            <TableCell>Member</TableCell>
                            <TableCell>Location</TableCell>
                            <TableCell align="right">Quality</TableCell>
                            <TableCell align="right">Quantity</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {ing.holdings.map((h) => (
                            <TableRow
                              key={h.id}
                              hover
                              onClick={() => toggleStack(ing.name, h.id)}
                              sx={{ cursor: 'pointer' }}
                              selected={chosen.has(h.id)}
                            >
                              <TableCell padding="checkbox">
                                <Checkbox size="small" checked={chosen.has(h.id)} />
                              </TableCell>
                              <TableCell>
                                {h.member}
                                {h.mine && (
                                  <Typography component="span" variant="caption" color="primary.main" sx={{ ml: 0.5 }}>
                                    (you)
                                  </Typography>
                                )}
                              </TableCell>
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
                Crafted {craft.data.quantity > 1 ? `${craft.data.quantity}× ` : ''}
                {craft.data.crafted}
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
              disabled={!plan.craftable || craft.isPending || craft.isSuccess}
              onClick={() => {
                if (
                  window.confirm(
                    `Record crafting ${qty > 1 ? `${qty}× ` : ''}${bp.name}? The selected materials will be deducted from the ledger.`,
                  )
                ) {
                  craft.mutate()
                }
              }}
            >
              {craft.isPending
                ? 'Recording…'
                : craft.isSuccess
                  ? 'Crafted'
                  : `I crafted this${qty > 1 ? ` ×${qty}` : ''}`}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
