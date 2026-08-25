import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
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
import Tooltip from '@mui/material/Tooltip'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { api } from '../lib/api'
import { gradeLabel } from '../pages/CraftPage'
import { ProductStats } from './ProductStats'
import { qualityColor as qualityTierColor } from '../lib/rarity'

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
    type_display: string | null
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


function amount(value: number, unit: 'mscu' | 'pieces', t: TFunction, locale: string): string {
  return unit === 'mscu'
    ? t('craft.amountScu', { amount: (value / 1000).toLocaleString(locale, { maximumFractionDigits: 3 }) })
    : t('craft.amountPcs', { amount: value.toLocaleString(locale) })
}

function craftTime(seconds: number | null, t: TFunction, locale: string): string | null {
  if (!seconds) return null
  if (seconds < 3600) return t('craft.minutes', { count: Math.round(seconds / 60) })
  return t('craft.hours', { hours: (seconds / 3600).toLocaleString(locale, { maximumFractionDigits: 1 }) })
}

interface CraftResultResponse {
  crafted: string
  quantity: number
  quality: number | null
  consumed: { name: string; quantity: number; unit: 'mscu' | 'pieces' }[]
  craft_id: number
}

type Selection = Record<string, Set<number>>
type QualityPref = 'low' | 'mid' | 'high'
const LIST_STEP = 5

/** Order holdings by the member's quality preference for this material. */
function sortHoldings(holdings: Holding[], pref: QualityPref): Holding[] {
  const sorted = [...holdings]
  if (pref === 'low') {
    sorted.sort((a, b) => a.quality - b.quality)
  } else if (pref === 'mid') {
    const qs = holdings.map((h) => h.quality)
    const mid = (Math.min(...qs) + Math.max(...qs)) / 2
    sorted.sort((a, b) => Math.abs(a.quality - mid) - Math.abs(b.quality - mid))
  } else {
    sorted.sort((a, b) => b.quality - a.quality)
  }
  return sorted
}

/** Pick stacks per ingredient, in preference order, until the need is covered. */
function defaultSelection(
  ingredients: IngredientDetail[],
  qty: number,
  prefs: Record<string, QualityPref>,
): Selection {
  const sel: Selection = {}
  for (const ing of ingredients) {
    const picked = new Set<number>()
    let left = ing.need * qty
    for (const h of sortHoldings(ing.holdings, prefs[ing.name] ?? 'high')) {
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
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['craft-detail', blueprintId],
    queryFn: async () => (await api.get<CraftDetail>(`/api/craftability/${blueprintId}`)).data,
  })

  const [qty, setQty] = useState(1)
  const [useType, setUseType] = useState<'personal' | 'org'>('personal')
  const [ownedId, setOwnedId] = useState<number | null>(null)
  const [selection, setSelection] = useState<Selection>({})
  const [prefs, setPrefs] = useState<Record<string, QualityPref>>({})
  const [visible, setVisible] = useState<Record<string, number>>({})
  const [imageZoom, setImageZoom] = useState(false)

  // Re-plan defaults whenever the data, craft count, or a quality
  // preference changes; the lists grow to show everything pre-selected.
  useEffect(() => {
    if (!data) return
    const sel = defaultSelection(data.ingredients, qty, prefs)
    setSelection(sel)
    setVisible((prev) => {
      const next = { ...prev }
      for (const ing of data.ingredients) {
        next[ing.name] = Math.max(prev[ing.name] ?? LIST_STEP, sel[ing.name]?.size ?? 0, LIST_STEP)
      }
      return next
    })
    setOwnedId((prev) => {
      if (prev !== null && data.owners.some((o) => o.id === prev)) return prev
      return (data.owners.find((o) => o.mine) ?? data.owners[0])?.id ?? null
    })
  }, [data, qty, prefs])

  const plan = useMemo(
    () => (data ? planCraft(data.ingredients, selection, qty) : null),
    [data, selection, qty],
  )

  const invalidateLedgers = () => {
    queryClient.invalidateQueries({ queryKey: ['craft-detail', blueprintId] })
    queryClient.invalidateQueries({ queryKey: ['craftability'] })
    queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
    queryClient.invalidateQueries({ queryKey: ['item-stacks'] })
  }

  const undo = useMutation({
    mutationFn: async (craftId: number) => (await api.post(`/api/crafts/${craftId}/undo`)).data,
    onSuccess: invalidateLedgers,
  })

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
      undo.reset()
      invalidateLedgers()
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
  const craftTimeLabel = bp ? craftTime(bp.craft_time_seconds, t, locale) : null

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      {isLoading && <LinearProgress />}
      {isError && <Alert severity="error">{t('craft.detailLoadError')}</Alert>}
      {bp && plan && (
        <>
          <DialogTitle sx={{ pb: 0.5 }}>
            {bp.name}
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              {bp.manufacturer && <Chip size="small" label={bp.manufacturer} variant="outlined" />}
              {(bp.type_display ?? bp.type) && (
                <Chip size="small" label={bp.type_display ?? bp.type} variant="outlined" />
              )}
              {bp.grade && (
                <Chip size="small" label={t('craft.grade', { grade: gradeLabel(bp.grade) })} variant="outlined" />
              )}
              {bp.item_meta?.size !== undefined && (
                <Chip size="small" label={t('craft.size', { size: bp.item_meta.size })} variant="outlined" />
              )}
              {craftTimeLabel && (
                <Chip
                  size="small"
                  color="secondary"
                  variant="outlined"
                  label={t('craft.craftTime', { time: craftTimeLabel })}
                />
              )}
            </Stack>
          </DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mt: 1.5, flexWrap: 'wrap' }}>
              {bp.image_url && (
                <Tooltip title={t('craft.clickToZoom')}>
                  <Box
                    component="img"
                    src={bp.image_url}
                    alt={bp.name}
                    onClick={() => setImageZoom(true)}
                    sx={{
                      maxWidth: { xs: '40%', sm: 220 },
                      maxHeight: 180,
                      objectFit: 'contain',
                      borderRadius: 1,
                      border: 1,
                      borderColor: 'divider',
                      cursor: 'zoom-in',
                    }}
                  />
                </Tooltip>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 240 }}>
                {bp.description || t('craft.noDescription')}
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
              {t('craft.holdersTitle')}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {t('craft.holdersHint')}
              </Typography>
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              {bp.is_default && (
                <Chip size="small" label={t('craft.everyoneDefault')} color="primary" variant="outlined" />
              )}
              {(data?.owners ?? []).map((o) => (
                <Chip
                  key={o.id}
                  size="small"
                  label={t('craft.ownerUses', { member: o.member, personal: o.uses_personal, org: o.uses_org })}
                  color={ownedId === o.id ? 'primary' : 'default'}
                  variant={ownedId === o.id ? 'filled' : 'outlined'}
                  onClick={() => setOwnedId(o.id)}
                />
              ))}
              {!bp.is_default && (data?.owners ?? []).length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('craft.nobodyOwns')}
                </Typography>
              )}
            </Stack>

            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={2} sx={{ mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="subtitle2">{t('craft.title')}</Typography>
              <TextField
                type="number"
                size="small"
                label={t('craft.howMany')}
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
                <ToggleButton value="personal">{t('craft.personalUse')}</ToggleButton>
                <ToggleButton value="org">{t('craft.orgUse')}</ToggleButton>
              </ToggleButtonGroup>
              {plan.estQuality !== null && (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                  <Typography variant="body2" color="text.secondary">
                    {t('craft.outputQuality')}
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
              {t('craft.stacksHint')}
            </Typography>

            <Stack spacing={2}>
              {(data?.ingredients ?? []).map((ing) => {
                const p = plan.perIngredient[ing.name]
                const chosen = selection[ing.name] ?? new Set()
                const pref = prefs[ing.name] ?? 'high'
                const rows = sortHoldings(ing.holdings, pref)
                const shown = visible[ing.name] ?? LIST_STEP
                const hidden = Math.max(0, rows.length - shown)
                return (
                  <Box key={ing.name}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5, flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {ing.name}
                      </Typography>
                      {ing.holdings.length > 1 && (
                        <ToggleButtonGroup
                          size="small"
                          exclusive
                          value={pref}
                          onChange={(_, v) => v && setPrefs((prev) => ({ ...prev, [ing.name]: v }))}
                          sx={{ '& .MuiToggleButton-root': { py: 0, px: 1, fontSize: 11 } }}
                        >
                          <ToggleButton value="low">{t('craft.prefLow')}</ToggleButton>
                          <ToggleButton value="mid">{t('craft.prefMid')}</ToggleButton>
                          <ToggleButton value="high">{t('craft.prefHigh')}</ToggleButton>
                        </ToggleButtonGroup>
                      )}
                      <Typography
                        variant="caption"
                        sx={{
                          ml: 'auto',
                          fontVariantNumeric: 'tabular-nums',
                          color: p?.covered ? 'primary.main' : 'error.main',
                        }}
                      >
                        {t('craft.selectedOfNeeded', {
                          selected: amount(p?.selected ?? 0, ing.unit, t, locale),
                          need: amount(p?.need ?? 0, ing.unit, t, locale),
                        })}
                      </Typography>
                    </Box>
                    {rows.length > 0 ? (
                      <>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell padding="checkbox">{t('craft.colUse')}</TableCell>
                              <TableCell>{t('craft.colMember')}</TableCell>
                              <TableCell>{t('craft.colLocation')}</TableCell>
                              <TableCell align="right">{t('craft.colQuality')}</TableCell>
                              <TableCell align="right">{t('craft.colQuantity')}</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {rows.slice(0, shown).map((h) => (
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
                                      {t('craft.you')}
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
                                <TableCell align="right">{amount(h.quantity, ing.unit, t, locale)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {hidden > 0 && (
                          <Button
                            size="small"
                            sx={{ mt: 0.5 }}
                            onClick={() =>
                              setVisible((prev) => ({ ...prev, [ing.name]: shown + LIST_STEP }))
                            }
                          >
                            {t('craft.showMore', { count: Math.min(LIST_STEP, hidden), hidden })}
                          </Button>
                        )}
                      </>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {t('craft.nobodyHasAny')}
                      </Typography>
                    )}
                  </Box>
                )
              })}
            </Stack>

          </DialogContent>
          {/* Outside the scroll area so the outcome is never scrolled out of view. */}
          {(craft.isSuccess || craft.isError || undo.isSuccess || undo.isError) && (
            <Box sx={{ px: 3, pt: 1 }}>
              {craft.isSuccess && (
                <Alert
                  severity="success"
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      disabled={undo.isPending}
                      onClick={() =>
                        undo.mutate(craft.data.craft_id, { onSuccess: () => craft.reset() })
                      }
                    >
                      {undo.isPending ? t('craft.undoing') : t('craft.undo')}
                    </Button>
                  }
                >
                  {t(craft.data.quality !== null ? 'craft.craftedAlertQuality' : 'craft.craftedAlert', {
                    item:
                      craft.data.quantity > 1
                        ? t('craft.quantityTimes', { count: craft.data.quantity, name: craft.data.crafted })
                        : craft.data.crafted,
                    quality: craft.data.quality,
                  })}
                </Alert>
              )}
              {undo.isSuccess && !craft.isSuccess && (
                <Alert severity="info">{t('craft.undoneAlert')}</Alert>
              )}
              {craft.isError && <Alert severity="error">{t('craft.craftError')}</Alert>}
              {undo.isError && <Alert severity="error">{t('craft.undoError')}</Alert>}
            </Box>
          )}
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={onClose}>{t('common.close')}</Button>
            <Button
              variant="contained"
              disabled={!plan.craftable || craft.isPending || craft.isSuccess}
              onClick={() => craft.mutate()}
            >
              {craft.isPending
                ? t('craft.recording')
                : craft.isSuccess
                  ? t('craft.crafted')
                  : qty > 1
                    ? t('craft.iCraftedThisTimes', { count: qty })
                    : t('craft.iCraftedThis')}
            </Button>
          </DialogActions>

          {imageZoom && bp.image_url && (
            <Dialog open onClose={() => setImageZoom(false)} maxWidth={false}>
              <Box
                component="img"
                src={bp.image_url}
                alt={bp.name}
                onClick={() => setImageZoom(false)}
                sx={{ maxWidth: '90vw', maxHeight: '85vh', display: 'block', cursor: 'zoom-out' }}
              />
            </Dialog>
          )}
        </>
      )}
    </Dialog>
  )
}
