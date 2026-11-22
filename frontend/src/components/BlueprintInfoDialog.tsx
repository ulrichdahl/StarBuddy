import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Dialog from '@mui/material/Dialog'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CheckIcon from '@mui/icons-material/Check'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import { api } from '../lib/api'
import { useMe } from '../lib/auth'
import type { BlueprintInfo, BlueprintPool, PoolMember } from '../lib/types'
import { gradeLabel } from '../pages/CraftPage'
import { fonts, hud } from '../theme'
import { ProductStats } from './ProductStats'

function craftTime(seconds: number | null, t: TFunction, locale: string): string | null {
  if (!seconds) return null
  if (seconds < 3600) return t('craft.minutes', { count: Math.round(seconds / 60) })
  return t('craft.hours', { hours: (seconds / 3600).toLocaleString(locale, { maximumFractionDigits: 1 }) })
}

/** One ingredient with every visible stack of it, from GET /api/craftability/{id}. */
interface Ingredient {
  name: string
  need: number
  unit: 'mscu' | 'pieces'
  holdings: { member: string; mine: boolean; quality: number; quantity: number }[]
}

type Scope = 'you' | 'org'

const sectionHeading = {
  m: 0,
  fontFamily: fonts.display,
  fontWeight: 700,
  fontSize: 15,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: hud.text,
} as const

const smallLabel = {
  fontFamily: fonts.display,
  fontWeight: 600,
  fontSize: 12,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: hud.teal,
} as const

function Tag({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.04em',
        px: 1.125,
        py: 0.375,
        border: `1px solid ${accent ? '#7a5b22' : '#34424e'}`,
        color: accent ? '#f0b44c' : '#c9d4db',
      }}
    >
      {children}
    </Box>
  )
}

function Section({ id, title, aside, children }: { id: string; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box component="section" aria-labelledby={id} sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 2, borderTop: `1px solid ${hud.lineSoft}` }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25, flexWrap: 'wrap' }}>
        <Typography id={id} component="h3" sx={sectionHeading}>
          {title}
        </Typography>
        {aside}
      </Box>
      {children}
    </Box>
  )
}

function ScopeToggle({ value, onChange, orgName }: { value: Scope; onChange: (s: Scope) => void; orgName: string | null }) {
  const { t } = useTranslation()
  const options: { id: Scope; label: string }[] = [
    { id: 'you', label: t('blueprints.info.scopeYou') },
    { id: 'org', label: orgName ?? t('blueprints.info.scopeOrg') },
  ]
  return (
    <Box role="group" aria-label={t('blueprints.info.scopeLabel')} sx={{ ml: 'auto', display: 'flex', border: `1px solid ${hud.lineStrong}` }}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <ButtonBase
            key={o.id}
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            sx={{
              height: 30,
              px: 1.5,
              fontFamily: fonts.display,
              fontWeight: 600,
              fontSize: 13,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              bgcolor: on ? 'rgba(79,209,197,0.14)' : 'transparent',
              color: on ? hud.teal : hud.textMuted,
            }}
          >
            {o.label}
          </ButtonBase>
        )
      })}
    </Box>
  )
}

/** One reward pool, folded: who hands it out and how much of it is held. */
function PoolRow({
  pool,
  scope,
  open,
  onToggle,
  onOpenBlueprint,
}: {
  pool: BlueprintPool
  scope: Scope
  open: boolean
  onToggle: () => void
  onOpenBlueprint: (id: number) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const has = (m: PoolMember) => m.owned || (scope === 'org' && m.holders.length > 0)
  const got = pool.contents.filter(has).length
  const done = got === pool.in_pool
  const contracts = pool.sources.filter((s) => s.kind === 'contract')
  const events = pool.sources.filter((s) => s.kind === 'event')
  const missions = contracts.flatMap((s) => s.missions)
  const faction = pool.factions[0] ?? t('blueprints.info.unknownContractor')
  const others = pool.contents.filter((m) => !m.is_this_one)

  const track = useMutation({
    mutationFn: async () =>
      pool.tracked
        ? api.delete(`/api/tracked-pools/${encodeURIComponent(pool.pool_key)}`)
        : api.post('/api/tracked-pools', { pool_key: pool.pool_key }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['blueprint-info'] })
      void queryClient.invalidateQueries({ queryKey: ['tracked-pools'] })
    },
  })

  return (
    <Box sx={{ border: `1px solid ${open ? '#2f6f6a' : hud.lineSoft}`, bgcolor: '#0f161b' }}>
      <ButtonBase
        aria-expanded={open}
        onClick={onToggle}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, width: '100%', minHeight: 46, px: 1.5, textAlign: 'left', '&:hover': { bgcolor: '#151e25' } }}
      >
        <ChevronRightIcon sx={{ fontSize: 17, color: open ? hud.teal : hud.textFaint, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }} />
        <Box component="span" sx={{ fontSize: 14, fontWeight: 600 }}>
          {faction}
        </Box>
        <Box component="span" sx={{ fontSize: 13, color: hud.textDim, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          · {pool.pool_label}
        </Box>
        {pool.tracked && <VisibilityOutlinedIcon sx={{ fontSize: 15, color: hud.teal }} aria-label={t('blueprints.info.tracking')} />}
        <Box component="span" sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
          <Box sx={{ width: 80, height: 4, bgcolor: '#1c262d' }} aria-hidden>
            <Box sx={{ height: '100%', width: `${pool.in_pool ? (got / pool.in_pool) * 100 : 0}%`, bgcolor: done ? hud.teal : '#5b7080' }} />
          </Box>
          <Box
            component="span"
            sx={{
              fontFamily: fonts.mono,
              fontSize: 12,
              fontWeight: 500,
              px: 1.125,
              py: 0.25,
              border: `1px solid ${done ? '#2f6f6a' : '#34424e'}`,
              color: done ? hud.teal : '#c9d4db',
              bgcolor: done ? 'rgba(79,209,197,0.10)' : 'transparent',
            }}
          >
            {got}/{pool.in_pool}
          </Box>
        </Box>
      </ButtonBase>
      {open && (
        <Box sx={{ pt: 0.5, pr: 1.75, pb: 1.75, pl: { xs: 1.75, sm: 4.625 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {!pool.awardable && (
            <Alert severity="warning" sx={{ py: 0 }}>
              {t('blueprints.info.poolUnawardable')}
            </Alert>
          )}
          {missions.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Box component="span" sx={{ fontSize: 12, color: hud.textDim }}>
                {t('blueprints.info.missionsFromPool')}
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: '4px 18px', fontSize: 13, color: '#c9d4db' }}>
                {missions.map((m, i) => (
                  <Box
                    key={i}
                    component="span"
                    title={m.unreleased ? t('blueprints.info.missionUnreleased') : undefined}
                    sx={m.unreleased ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}
                  >
                    {m.title ?? t('blueprints.info.missionsUnnamed')}
                    {m.unreleased && ` (${t('blueprints.info.missionUnreleasedShort')})`}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
          {events.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Box component="span" sx={{ fontSize: 12, color: hud.textDim }}>
                {t('blueprints.info.eventsFromPool')}
              </Box>
              {events.map((e, i) => (
                <Box key={i} component="span" sx={{ fontSize: 13, color: '#c9d4db' }}>
                  {t('blueprints.info.eventTier', { event: e.event, points: e.min_points.toLocaleString() })}
                </Box>
              ))}
            </Box>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Box component="span" sx={{ fontSize: 12, color: hud.textDim }}>
              {t('blueprints.info.otherInPool')}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
              <Box sx={{ flex: '1 1 360px', minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {others.length === 0 && (
                  <Box component="span" sx={{ fontSize: 13, color: hud.textMuted }}>
                    {t('blueprints.info.onlyOneInPool')}
                  </Box>
                )}
                {others.map((m) => {
                  const h = has(m)
                  const who = m.holders.map((x) => x.handle).filter(Boolean).join(', ')
                  return (
                    <ButtonBase
                      key={m.key}
                      disabled={m.blueprint_id === null}
                      onClick={() => m.blueprint_id !== null && onOpenBlueprint(m.blueprint_id)}
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.625,
                        fontSize: 12,
                        px: 1.25,
                        py: 0.5,
                        border: `1px solid ${h ? '#2f6f6a' : '#2f3d48'}`,
                        color: h ? hud.teal : hud.textMuted,
                        '&:hover': { borderColor: h ? hud.teal : '#3d5260' },
                      }}
                    >
                      {h && <CheckIcon sx={{ fontSize: 13 }} />}
                      {m.name ?? m.key}
                      {scope === 'org' && who && (
                        <Box component="span" sx={{ color: hud.textFaint }}>
                          {' '}
                          · {who}
                        </Box>
                      )}
                    </ButtonBase>
                  )
                })}
              </Box>
              <Button
                variant={pool.tracked ? 'contained' : 'outlined'}
                color="primary"
                startIcon={<VisibilityOutlinedIcon />}
                onClick={() => track.mutate()}
                disabled={track.isPending}
                aria-label={pool.tracked ? t('blueprints.info.untrack', { pool: pool.pool_label }) : undefined}
                sx={{ minHeight: 36, height: 36, flex: 'none', fontSize: 14 }}
              >
                {pool.tracked ? t('blueprints.info.tracking') : t('blueprints.info.track')}
              </Button>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}

function WhereItDrops({ pools, orgName, onOpenBlueprint }: { pools: BlueprintPool[]; orgName: string | null; onOpenBlueprint: (id: number) => void }) {
  const { t } = useTranslation()
  const [scope, setScope] = useState<Scope>('you')
  const missing = (p: BlueprintPool) => p.in_pool - (scope === 'org' ? p.owned_in_pool_org : p.owned_in_pool)
  // Fewest missing first, with a finished pool last: nothing left to fly for.
  const sorted = [...pools].sort((a, b) => Number(missing(a) === 0) - Number(missing(b) === 0) || missing(a) - missing(b))
  const [openKey, setOpenKey] = useState<string | null>(sorted[0]?.pool_key ?? null)

  return (
    <Section
      id="bp-drops"
      title={t('blueprints.info.whereItDrops')}
      aside={
        pools.length > 0 && (
          <>
            <Box component="span" sx={{ fontSize: 13, color: hud.textDim }}>
              {t('blueprints.info.poolsCount', { count: pools.length })}
            </Box>
            <ScopeToggle value={scope} onChange={setScope} orgName={orgName} />
          </>
        )
      }
    >
      {pools.length === 0 && (
        <Typography variant="body2" sx={{ color: hud.textMuted }}>
          {t('blueprints.info.noMissions')}
        </Typography>
      )}
      {sorted.map((pool) => (
        <PoolRow
          key={pool.pool_key}
          pool={pool}
          scope={scope}
          open={openKey === pool.pool_key}
          onToggle={() => setOpenKey(openKey === pool.pool_key ? null : pool.pool_key)}
          onOpenBlueprint={onOpenBlueprint}
        />
      ))}
    </Section>
  )
}

const MAT_GRID = '1.3fr 0.8fr 0.7fr 0.9fr 1.2fr 0.8fr'

function NeededToCraft({ blueprintId, info }: { blueprintId: number; info: BlueprintInfo }) {
  const { t, i18n } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['craft-detail', blueprintId],
    queryFn: async () => (await api.get<{ ingredients: Ingredient[] }>(`/api/craftability/${blueprintId}`)).data,
  })
  const amount = (value: number, unit: Ingredient['unit']) =>
    unit === 'mscu'
      ? `${(value / 1000).toLocaleString(i18n.language, { maximumFractionDigits: 3 })} SCU`
      : `${value.toLocaleString(i18n.language)} pcs`
  const minQuality = (name: string) =>
    info.requirement_groups.find((g) => g.material?.toLowerCase() === name.toLowerCase())?.min_quality ?? null

  return (
    <Section
      id="bp-mats"
      title={t('blueprints.info.neededToCraft')}
      aside={
        <Box component="span" sx={{ fontSize: 13, color: hud.textDim }}>
          {t('blueprints.info.checkedAgainst')}
        </Box>
      }
    >
      {isLoading && <LinearProgress />}
      {data && data.ingredients.length === 0 && (
        <Typography variant="body2" sx={{ color: hud.textMuted }}>
          {t('blueprints.info.noRecipe')}
        </Typography>
      )}
      {data && data.ingredients.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Box role="table" aria-labelledby="bp-mats" sx={{ minWidth: 640 }}>
            <Box
              role="row"
              sx={{ display: 'grid', gridTemplateColumns: MAT_GRID, gap: 1.5, pb: 0.75, fontFamily: fonts.display, fontWeight: 600, fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: hud.textFaint }}
            >
              <span role="columnheader">{t('blueprints.info.colMaterial')}</span>
              <span role="columnheader">{t('blueprints.info.colNeed')}</span>
              <span role="columnheader">{t('blueprints.info.colQuality')}</span>
              <span role="columnheader">{t('blueprints.info.colYouHave')}</span>
              <span role="columnheader">{t('blueprints.info.colOrgBest')}</span>
              <Box component="span" role="columnheader" sx={{ textAlign: 'right' }}>
                {t('blueprints.info.colStatus')}
              </Box>
            </Box>
            {data.ingredients.map((ing) => {
              const min = minQuality(ing.name)
              const usable = ing.holdings.filter((h) => min === null || h.quality >= min)
              const mine = usable.filter((h) => h.mine).reduce((s, h) => s + h.quantity, 0)
              const all = usable.reduce((s, h) => s + h.quantity, 0)
              const best = ing.holdings[0]
              const [status, colour] =
                mine >= ing.need
                  ? [t('blueprints.info.statusCovered'), hud.teal]
                  : all >= ing.need
                    ? [t('blueprints.info.statusOrg'), hud.silver]
                    : [t('blueprints.info.statusGather'), '#f0b44c']
              return (
                <Box
                  key={ing.name}
                  role="row"
                  sx={{ display: 'grid', gridTemplateColumns: MAT_GRID, gap: 1.5, alignItems: 'center', py: 1.25, borderTop: `1px solid ${hud.lineSoft}`, fontSize: 13 }}
                >
                  <Box component="span" role="cell" sx={{ fontWeight: 500 }}>
                    {ing.name}
                  </Box>
                  <Box component="span" role="cell" sx={{ fontFamily: fonts.mono }}>
                    {amount(ing.need, ing.unit)}
                  </Box>
                  <Box component="span" role="cell" sx={{ fontFamily: fonts.mono, color: hud.textDim }}>
                    {min !== null ? `≥ ${min}` : '—'}
                  </Box>
                  <Box component="span" role="cell" sx={{ fontFamily: fonts.mono }}>
                    {amount(mine, ing.unit)}
                  </Box>
                  <Box component="span" role="cell" sx={{ fontFamily: fonts.mono, color: hud.textDim }}>
                    {best ? `${best.quality} · ${best.mine ? t('blueprints.info.you') : best.member}` : '—'}
                  </Box>
                  <Box component="span" role="cell" sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 0.75, color: colour }}>
                    <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colour }} />
                    {status}
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Box>
      )}
    </Section>
  )
}

interface Props {
  blueprintId: number | null
  onClose: () => void
  /** Mark / unmark as owned from inside the dialog. */
  onToggleOwned?: (info: BlueprintInfo) => void
}

/**
 * What a blueprint is and how to get it: who in the org holds it, the reward
 * pools that drop it (with how much of each pool you, or the org, already
 * hold), and what it takes to craft. It can be pinned as a craft target and
 * a pool can be tracked.
 */
export function BlueprintInfoDialog({ blueprintId, onClose, onToggleOwned }: Props) {
  const { t, i18n } = useTranslation()
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const queryClient = useQueryClient()
  const { me } = useMe()
  const [imageZoom, setImageZoom] = useState(false)
  /**
   * Recipes walked into from a pool's contents, so a player can follow the
   * pool around and come back. The dialog was opened on `blueprintId`, which
   * stays the bottom of the trail.
   */
  const [trail, setTrail] = useState<number[]>([])
  const open = blueprintId !== null
  const showing = trail.at(-1) ?? blueprintId

  const { data, isLoading, isError } = useQuery({
    queryKey: ['blueprint-info', showing],
    queryFn: async () => (await api.get<BlueprintInfo>(`/api/blueprints/${showing}`)).data,
    enabled: open,
  })
  const { data: mates } = useQuery({
    queryKey: ['org-mates'],
    queryFn: async () => (await api.get<{ id: number; handle: string }[]>('/api/org/mates')).data,
    enabled: open,
  })
  const pin = useMutation({
    mutationFn: async () =>
      data?.craft_target ? api.delete(`/api/craft-targets/${showing}`) : api.post('/api/craft-targets', { blueprint_id: showing }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['blueprint-info', showing] })
      void queryClient.invalidateQueries({ queryKey: ['craft-targets'] })
    },
  })

  const bp = data?.blueprint
  const time = bp ? craftTime(bp.craft_time_seconds, t, i18n.language) : null
  const org = me?.orgs[0] ?? null
  const others = (data?.owners ?? []).filter((o) => !o.mine)
  const orgSize = (mates?.length ?? 0) + 1

  const stats = bp?.item_meta?.stats ? (
    <ProductStats
      stats={bp.item_meta.stats}
      mass={bp.item_meta.mass}
      factors={null}
      ranges={data?.stat_ranges ?? {}}
      groups={data?.requirement_groups ?? []}
    />
  ) : null

  const close = () => {
    setTrail([])
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      fullScreen={fullScreen}
      maxWidth={false}
      aria-labelledby="bp-title"
      slotProps={{ paper: { sx: { width: 900, maxWidth: '100%', m: fullScreen ? 0 : 2 } } }}
    >
      {isLoading && <LinearProgress />}
      {isError && <Alert severity="error">{t('craft.detailLoadError')}</Alert>}
      {bp && data && showing !== null && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.75, pt: 2.25, pr: 2, pb: 2, pl: 2.75, borderBottom: `1px solid ${hud.lineSoft}` }}>
            {trail.length > 0 && (
              <Tooltip title={t('common.back')}>
                <IconButton
                  aria-label={t('common.back')}
                  onClick={() => setTrail(trail.slice(0, -1))}
                  sx={{ width: 44, height: 44, flex: 'none', border: `1px solid ${hud.lineStrong}`, color: hud.textMuted }}
                >
                  <ArrowBackIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography id="bp-title" variant="h3" component="h2" sx={{ m: 0, fontSize: 28, lineHeight: 1.1 }}>
                {bp.name}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {bp.manufacturer && <Tag>{bp.manufacturer}</Tag>}
                <Tag>{data.category_label}</Tag>
                {bp.type_display && bp.type_display !== data.category_label && <Tag>{bp.type_display}</Tag>}
                {bp.grade && <Tag>{t('craft.grade', { grade: gradeLabel(bp.grade) })}</Tag>}
                {bp.item_meta?.size !== undefined && <Tag>{t('craft.size', { size: bp.item_meta.size })}</Tag>}
                {time && <Tag accent>{t('craft.craftTime', { time })}</Tag>}
              </Box>
            </Box>
            <IconButton
              aria-label={t('common.close')}
              onClick={close}
              sx={{ width: 44, height: 44, flex: 'none', border: `1px solid ${hud.lineStrong}`, color: hud.textMuted }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          <Box sx={{ px: 2.75, py: 2.5, display: 'flex', flexDirection: 'column', gap: 2.25, overflowY: 'auto' }}>
            {(() => {
              const description = (
                <Typography sx={{ m: 0, fontSize: 14, lineHeight: 1.6, color: '#c9d4db' }}>
                  {bp.description || t('craft.noDescription')}
                </Typography>
              )
              const holders = (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25 }}>
                    <Box component="span" sx={smallLabel}>
                      {t('blueprints.info.whoHasIt')}
                    </Box>
                    {org && (
                      <Box component="span" sx={{ fontSize: 12, color: hud.textDim }}>
                        {t('blueprints.info.holdersIn', { count: data.owners.length, total: orgSize, org: org.name })}
                      </Box>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
                    {bp.is_default && <Tag>{t('craft.everyoneDefault')}</Tag>}
                    {data.owned_by_me && (
                      <Box component="span" sx={{ fontSize: 13, fontWeight: 600, px: 1.5, py: 0.625, bgcolor: hud.teal, color: '#0b1014', border: `1px solid ${hud.teal}` }}>
                        {t('blueprints.info.you')}
                      </Box>
                    )}
                    {others.map((o) => (
                      <Box key={o.id} component="span" sx={{ fontSize: 13, fontWeight: 500, px: 1.5, py: 0.625, border: '1px solid #34424e' }}>
                        {o.handle}
                      </Box>
                    ))}
                    {!bp.is_default && data.owners.length === 0 && (
                      <Typography variant="body2" sx={{ color: hud.textMuted }}>
                        {t('craft.nobodyOwns')}
                      </Typography>
                    )}
                  </Box>
                </Box>
              )
              // Beside stats the picture heads its column; otherwise it sits to the right.
              const pictureBox = stats ? { width: '100%', height: 180 } : { flex: '0 1 280px', height: 170 }
              const picture = bp.image_url ? (
                <Tooltip title={t('craft.clickToZoom')}>
                  <ButtonBase
                    onClick={() => setImageZoom(true)}
                    sx={{ ...pictureBox, border: `1px solid ${hud.line}`, bgcolor: hud.well, cursor: 'zoom-in' }}
                  >
                    <Box component="img" src={bp.image_url} alt={bp.name} sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </ButtonBase>
                </Tooltip>
              ) : (
                <Box
                  sx={{ ...pictureBox, border: '1px dashed #2f3d48', bgcolor: hud.well, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.mono, fontSize: 12, color: hud.textFaint }}
                >
                  {t('blueprints.info.imagePlaceholder')}
                </Box>
              )
              // A blueprint with stats keeps them on the left, where they are
              // read beside the picture; without, the description takes the room.
              return stats ? (
                <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <Box sx={{ flex: '0 1 61%', minWidth: 300 }}>{stats}</Box>
                  <Box sx={{ flex: '1 1 300px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 2}}>
                    {picture}
                    {description}
                    {holders}
                  </Box>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap', alignItems: 'stretch' }}>
                  <Box sx={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {description}
                    {holders}
                  </Box>
                  {picture}
                </Box>
              )
            })()}

            <WhereItDrops key={showing} pools={data.missions} orgName={org?.name ?? null} onOpenBlueprint={(id) => setTrail([...trail, id])} />

            <NeededToCraft blueprintId={showing} info={data} />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', px: 2.75, py: 1.75, borderTop: `1px solid ${hud.lineSoft}`, bgcolor: hud.well }}>
            <Button
              variant={data.craft_target ? 'contained' : 'outlined'}
              color={data.craft_target ? 'primary' : 'inherit'}
              startIcon={<PushPinOutlinedIcon />}
              onClick={() => pin.mutate()}
              disabled={pin.isPending}
              aria-label={data.craft_target ? t('blueprints.info.unpin') : undefined}
              sx={{ height: 44, fontSize: 14 }}
            >
              {data.craft_target ? t('blueprints.info.pinned') : t('blueprints.info.pinTarget')}
            </Button>
            <Box component="span" sx={{ fontSize: 12, color: hud.textDim }}>
              {t('blueprints.info.pinHelp')}
            </Box>
            <Box sx={{ ml: 'auto', display: 'flex', gap: 1.25 }}>
              {onToggleOwned && (
                <Button
                  variant={data.owned_by_me ? 'outlined' : 'contained'}
                  color="primary"
                  onClick={() => onToggleOwned(data)}
                  startIcon={data.owned_by_me ? <CheckIcon /> : undefined}
                  aria-label={data.owned_by_me ? t('blueprints.info.unmarkOwned') : undefined}
                  sx={{ height: 44 }}
                >
                  {data.owned_by_me ? t('blueprints.info.owned') : t('blueprints.info.markOwned')}
                </Button>
              )}
              <Button variant="outlined" color="inherit" onClick={close} sx={{ height: 44 }}>
                {t('common.close')}
              </Button>
            </Box>
          </Box>

          {bp.image_url && (
            <Dialog open={imageZoom} onClose={() => setImageZoom(false)} maxWidth="lg">
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
