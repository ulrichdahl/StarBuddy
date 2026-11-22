import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import Skeleton from '@mui/material/Skeleton'
import Snackbar from '@mui/material/Snackbar'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import RemoveIcon from '@mui/icons-material/Remove'
import { api, apiErrorDetail } from '../lib/api'
import { useCraftTargets, type CraftTarget, type GatheringLine } from '../lib/craftTargets'
import { BlueprintInfoDialog } from '../components/BlueprintInfoDialog'
import { PageHeader } from '../components/PageHeader'
import { PinMark } from '../components/PinMark'
import { fonts, hud } from '../theme'

type Scope = 'mine' | 'org'

function useAmount() {
  const { t, i18n } = useTranslation()
  return (value: number, unit: GatheringLine['unit']) =>
    unit === 'mscu'
      ? `${(value / 1000).toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SCU`
      : t('craft.amountPcs', { amount: value.toLocaleString(i18n.language) })
}

function TargetCard({ target, scope, onOpen }: { target: CraftTarget; scope: Scope; onOpen: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['craft-targets'] })
    void queryClient.invalidateQueries({ queryKey: ['blueprint-info', target.blueprint_id] })
  }
  const setQuantity = useMutation({
    mutationFn: async (quantity: number) => api.post('/api/craft-targets', { blueprint_id: target.blueprint_id, quantity }),
    onSuccess: refresh,
  })
  const unpin = useMutation({
    mutationFn: async () => api.delete(`/api/craft-targets/${target.blueprint_id}`),
    onSuccess: refresh,
  })
  const missing = scope === 'org' ? target.materials_missing_with_org : target.materials_missing
  const busy = setQuantity.isPending || unpin.isPending
  const step = {
    width: 32,
    height: 32,
    color: hud.textSoft,
    border: `1px solid ${hud.lineStrong}`,
    '&:hover': { borderColor: '#3d5260', color: hud.text },
  }

  return (
    <Box sx={{ bgcolor: hud.input, border: `1px solid ${missing === 0 ? '#2f6f6a' : hud.line}`, p: 1.75, display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <ButtonBase onClick={onOpen} sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', textAlign: 'left', fontWeight: 600, fontSize: 14, lineHeight: 1.35, '&:hover': { color: hud.teal } }}>
          {target.name}
          <PinMark />
        </ButtonBase>
        <IconButton aria-label={t('gathering.unpin', { name: target.name })} onClick={() => unpin.mutate()} disabled={busy} sx={{ ...step, flex: 'none' }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <IconButton
            aria-label={t('gathering.fewer', { name: target.name })}
            disabled={busy || target.quantity <= 1}
            onClick={() => setQuantity.mutate(target.quantity - 1)}
            sx={step}
          >
            <RemoveIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <Box component="span" aria-live="polite" sx={{ fontFamily: fonts.mono, fontSize: 14, minWidth: 36, textAlign: 'center' }}>
            {t('gathering.quantity', { count: target.quantity })}
          </Box>
          <IconButton
            aria-label={t('gathering.more', { name: target.name })}
            disabled={busy || target.quantity >= 999}
            onClick={() => setQuantity.mutate(target.quantity + 1)}
            sx={step}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
        <Box component="span" sx={{ fontSize: 12.5, color: missing === 0 ? hud.teal : '#f0b44c' }}>
          {missing === 0 ? t('gathering.ready') : t('gathering.needs', { count: missing })}
        </Box>
      </Box>
    </Box>
  )
}

function ScopeToggle({ value, onChange }: { value: Scope; onChange: (s: Scope) => void }) {
  const { t } = useTranslation()
  const options: { id: Scope; label: string }[] = [
    { id: 'mine', label: t('gathering.onlyMine') },
    { id: 'org', label: t('gathering.includeOrg') },
  ]
  return (
    <Box role="group" aria-label={t('gathering.countScope')} sx={{ display: 'flex', border: `1px solid ${hud.lineStrong}` }}>
      {options.map((o, i) => {
        const on = o.id === value
        return (
          <ButtonBase
            key={o.id}
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            sx={{
              height: 36,
              px: 1.75,
              fontSize: 13,
              fontWeight: 500,
              bgcolor: on ? 'rgba(79,209,197,0.14)' : 'transparent',
              color: on ? hud.teal : hud.textMuted,
              borderLeft: i > 0 ? `1px solid ${hud.lineStrong}` : 0,
            }}
          >
            {o.label}
          </ButtonBase>
        )
      })}
    </Box>
  )
}

const GRID = 'minmax(140px, 1.3fr) 0.8fr 0.6fr minmax(150px, 1.1fr) 0.8fr 0.8fr minmax(160px, 1.4fr)'

function ShoppingTable({ lines, scope }: { lines: GatheringLine[]; scope: Scope }) {
  const { t } = useTranslation()
  const amount = useAmount()
  const headSx = { fontFamily: fonts.display, fontWeight: 600, fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: hud.textFaint } as const

  return (
    <Box sx={{ bgcolor: hud.input, border: `1px solid ${hud.line}`, overflowX: 'auto' }}>
      <Box role="table" aria-label={t('gathering.list')} sx={{ minWidth: 900 }}>
        <Box role="row" sx={{ display: 'grid', gridTemplateColumns: GRID, gap: 1.5, px: 2.5, py: 1.25, ...headSx }}>
          <span role="columnheader">{t('gathering.colMaterial')}</span>
          <span role="columnheader">{t('gathering.colNeeded')}</span>
          <span role="columnheader">{t('gathering.colQuality')}</span>
          <span role="columnheader">{t('gathering.colYouHave')}</span>
          <span role="columnheader">{t('gathering.colOrgHas')}</span>
          <span role="columnheader">{t('gathering.colStillToGet')}</span>
          <span role="columnheader">{t('gathering.colFor')}</span>
        </Box>
        {lines.map((g) => {
          const left = scope === 'org' ? g.missing_with_org : g.missing
          const pct = g.need > 0 ? Math.min(100, (g.have_mine / g.need) * 100) : 100
          return (
            <Box
              key={`${g.name}|${g.unit}`}
              role="row"
              sx={{ display: 'grid', gridTemplateColumns: GRID, gap: 1.5, alignItems: 'center', px: 2.5, py: 1.25, borderTop: `1px solid ${hud.lineSoft}`, fontSize: 13 }}
            >
              <Box component="span" role="cell" sx={{ fontWeight: 500 }}>
                {g.name}
              </Box>
              <Box component="span" role="cell" sx={{ fontFamily: fonts.mono }}>
                {amount(g.need, g.unit)}
              </Box>
              <Box component="span" role="cell" sx={{ fontFamily: fonts.mono, color: hud.textDim }}>
                ≥ {g.min_quality ?? '—'}
              </Box>
              <Box role="cell" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Box component="span" sx={{ fontFamily: fonts.mono }}>
                  {amount(g.have_mine, g.unit)}
                </Box>
                <Box sx={{ height: 4, bgcolor: '#1c262d' }} aria-hidden>
                  <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: pct >= 100 ? hud.teal : '#5b7080' }} />
                </Box>
                {g.have_mine_below > 0 && (
                  <Box component="span" sx={{ fontSize: 11.5, color: hud.textFaint }}>
                    {t('gathering.belowQuality', { amount: amount(g.have_mine_below, g.unit) })}
                  </Box>
                )}
              </Box>
              <Box component="span" role="cell" sx={{ fontFamily: fonts.mono, color: scope === 'org' ? hud.text : hud.textDim }}>
                {amount(g.have_org, g.unit)}
              </Box>
              <Box component="span" role="cell" sx={{ fontFamily: fonts.mono, fontWeight: 500, color: left === 0 ? hud.teal : '#f0b44c' }}>
                {left === 0 ? t('gathering.done') : amount(left, g.unit)}
              </Box>
              <Box component="span" role="cell" sx={{ color: hud.textMuted, fontSize: 12.5 }}>
                {g.for_targets.map((f) => (f.quantity > 1 ? `${f.name} ×${f.quantity}` : f.name)).join(' · ')}
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/**
 * The shopping list for the player's pinned craft targets: how many of each
 * to make, and every material they add up to against what the player (or the
 * org) holds at the quality the recipes ask for.
 */
export function GatheringPage() {
  const { t } = useTranslation()
  const [scope, setScope] = useState<Scope>('mine')
  const [openId, setOpenId] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const { data, isLoading, isError } = useCraftTargets()
  const post = useMutation({
    mutationFn: async () => api.post('/api/craft-targets/share', { scope }),
    onSuccess: () => setToast(t('gathering.posted')),
    onError: (e) => setToast(`${t('gathering.postError')} ${apiErrorDetail(e) ?? ''}`.trim()),
  })

  const total = data?.summary.materials ?? 0
  const left = scope === 'org' ? (data?.summary.still_to_gather_with_org ?? 0) : (data?.summary.still_to_gather ?? 0)
  // Still to get first, done last, in the scope being looked at.
  const lines = [...(data?.gathering ?? [])].sort((a, b) => {
    const ma = scope === 'org' ? a.missing_with_org : a.missing
    const mb = scope === 'org' ? b.missing_with_org : b.missing
    return Number(ma === 0) - Number(mb === 0) || a.name.localeCompare(b.name)
  })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <PageHeader
        title={t('gathering.title')}
        subtitle={t('gathering.subtitle')}
        action={
          data?.discord.can_post && (
            <Button variant="outlined" color="primary" onClick={() => post.mutate()} disabled={post.isPending || left === 0}>
              {t('gathering.postDiscord')}
            </Button>
          )
        }
      />

      {isError && <Alert severity="error">{t('gathering.loadError')}</Alert>}
      {isLoading && <Skeleton variant="rectangular" height={120} />}

      {data && (
        <Box
          component="section"
          aria-label={t('gathering.targets')}
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1.5 }}
        >
          {data.targets.map((target) => (
            <TargetCard key={target.blueprint_id} target={target} scope={scope} onOpen={() => setOpenId(target.blueprint_id)} />
          ))}
          <Box
            component={RouterLink}
            to="/blueprints"
            title={t('gathering.pinHelp')}
            sx={{
              minHeight: 100,
              border: `1px dashed ${hud.lineStrong}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.5,
              textDecoration: 'none',
              color: hud.teal,
              fontSize: 14,
              fontWeight: 500,
              '&:hover': { borderColor: hud.teal, bgcolor: 'rgba(79,209,197,0.05)' },
            }}
          >
            <span>+ {t('gathering.pinBlueprint')}</span>
            {data.targets.length === 0 && (
              <Box component="span" sx={{ fontSize: 12, color: hud.textDim, px: 2, textAlign: 'center' }}>
                {t('gathering.empty')}
              </Box>
            )}
          </Box>
        </Box>
      )}

      {data && data.gathering.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="h6" component="h2" sx={{ m: 0 }}>
              {t('gathering.list')}
              <Box component="span" sx={{ ml: 1.5, fontFamily: fonts.body, fontWeight: 400, fontSize: 13, letterSpacing: 0, textTransform: 'none', color: left === 0 ? hud.teal : hud.textDim }}>
                {left === 0 ? t('gathering.allGathered') : t('gathering.stillToGather', { count: left, total })}
              </Box>
            </Typography>
            <ScopeToggle value={scope} onChange={setScope} />
          </Box>
          <ShoppingTable lines={lines} scope={scope} />
          <Typography variant="body2" sx={{ color: hud.textDim }}>
            {t('gathering.note')}
          </Typography>
        </>
      )}

      <BlueprintInfoDialog blueprintId={openId} onClose={() => setOpenId(null)} />
      <Snackbar open={toast !== null} autoHideDuration={4000} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  )
}
