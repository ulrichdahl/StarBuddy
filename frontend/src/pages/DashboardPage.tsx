import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Link from '@mui/material/Link'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined'
import SchemaOutlinedIcon from '@mui/icons-material/SchemaOutlined'
import TrackChangesIcon from '@mui/icons-material/TrackChanges'
import DiamondOutlinedIcon from '@mui/icons-material/DiamondOutlined'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { api, unwrapList } from '../lib/api'
import { displayName } from '../lib/people'
import { formatDuration } from '../lib/refining'
import type {
  Competition,
  CompetitionMetric,
  CompetitionOrg,
  CompetitionPeriod,
  Me,
  OrgSummary,
  RefineryOrder,
} from '../lib/types'
import { useNow } from '../lib/useNow'
import { HudBadge, HudPanel, Mono, OrgTag, PersonAvatar } from '../components/hud'
import { OrganizationsDialog } from '../components/OrganizationsDialog'
import { BlueprintInfoDialog } from '../components/BlueprintInfoDialog'
import { OrgMembersDialog } from '../components/OrgMembersDialog'
import { fonts, hud } from '../theme'

type Tab = 'overall' | CompetitionMetric
const MAX_SCORE = 3000

/** The value a tab ranks by. */
const valueOf = (org: CompetitionOrg, tab: Tab) => (tab === 'overall' ? org.score : org[tab])

/** Gold, silver, bronze, then grey. */
function medal(rank: number): string {
  return rank === 1 ? hud.gold : rank === 2 ? hud.silver : rank === 3 ? hud.bronze : hud.textFaint
}

function useFormat() {
  const { i18n } = useTranslation()
  return {
    n: (value: number, digits = 0) => value.toLocaleString(i18n.language, { maximumFractionDigits: digits }),
  }
}

const labelSx = {
  display: 'flex',
  gap: 1,
  alignItems: 'center',
  fontFamily: fonts.display,
  fontWeight: 600,
  fontSize: 13,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  '& svg': { fontSize: 17 },
} as const

function Bar({ pct, colour = hud.teal, height = 4 }: { pct: number; colour?: string; height?: number }) {
  return (
    <Box sx={{ flex: 1, height, bgcolor: '#1c262d' }} aria-hidden>
      <Box sx={{ height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, bgcolor: colour }} />
    </Box>
  )
}

/** "Leading Nordlys by 34" / "34 behind Nordlys" for one metric. */
function useGap() {
  const { t } = useTranslation()
  const { n } = useFormat()
  return (orgs: CompetitionOrg[], tab: Tab, unit = '') => {
    const sorted = [...orgs].sort((a, b) => valueOf(b, tab) - valueOf(a, tab))
    const i = sorted.findIndex((o) => o.mine)
    if (i < 0) return ''
    const me = sorted[i]
    const fmt = (v: number) => n(v, tab === 'resources_scu' ? 1 : 0) + unit
    if (sorted.length === 1) return t('dashboard.alone')
    if (i === 0) {
      const next = sorted[1]
      const lead = valueOf(me, tab) - valueOf(next, tab)
      return lead === 0 ? t('dashboard.tiedWith', { org: next.name }) : t('dashboard.leading', { org: next.name, amount: fmt(lead) })
    }
    const ahead = sorted[i - 1]
    const gap = valueOf(ahead, tab) - valueOf(me, tab)
    return gap === 0 ? t('dashboard.tiedWith', { org: ahead.name }) : t('dashboard.behind', { org: ahead.name, amount: fmt(gap) })
  }
}

interface TileProps {
  label: string
  icon: ReactNode
  rank: number
  value: ReactNode
  pct: number
  gap: string
}

function MetricTile({ label, icon, rank, value, pct, gap }: TileProps) {
  const { t } = useTranslation()
  return (
    <Box sx={{ bgcolor: hud.input, border: `1px solid ${hud.line}`, px: 2.5, py: 2.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box component="span" sx={{ ...labelSx, color: hud.textDim }}>
          {icon}
          {label}
        </Box>
        <Box
          component="span"
          aria-label={t('dashboard.rankOf', { rank })}
          sx={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, color: medal(rank), border: `1px solid ${medal(rank)}`, px: 1, py: '1px' }}
        >
          #{rank}
        </Box>
      </Box>
      <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: 32, fontWeight: 500, lineHeight: 1.2 }}>
        {value}
      </Box>
      <Bar pct={pct} />
      <Box component="span" sx={{ fontSize: 12.5, color: hud.textMuted }}>
        {gap}
      </Box>
    </Box>
  )
}

function Standings({ data, myOrg }: { data: Competition; myOrg: CompetitionOrg }) {
  const { t } = useTranslation()
  const { n } = useFormat()
  const gap = useGap()
  const lead = (tab: Tab) => Math.max(...data.orgs.map((o) => valueOf(o, tab)), 0)
  const pct = (tab: Tab) => (lead(tab) > 0 ? (valueOf(myOrg, tab) / lead(tab)) * 100 : 0)

  return (
    <Box
      component="section"
      aria-label={t('dashboard.standings', { org: myOrg.name })}
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 2 }}
    >
      <Box sx={{ bgcolor: '#10201f', border: '1px solid #2f6f6a', px: 2.5, py: 2.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box component="span" sx={{ ...labelSx, color: hud.teal }}>
          <EmojiEventsOutlinedIcon />
          {t('dashboard.overallRank')}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25, flexWrap: 'wrap' }}>
          <Box component="span" sx={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 52, lineHeight: 1, color: medal(myOrg.rank.overall) }}>
            #{myOrg.rank.overall}
          </Box>
          <Box component="span" sx={{ color: hud.textDim, fontSize: 13 }}>
            {t('dashboard.ofOrgs', { count: data.orgs.length, points: n(myOrg.score) })}
          </Box>
        </Box>
        <Bar pct={(myOrg.score / MAX_SCORE) * 100} />
        <Box component="span" sx={{ fontSize: 12.5, color: hud.textMuted }}>
          {gap(data.orgs, 'overall', ' pts')}
        </Box>
      </Box>
      <MetricTile
        label={t('dashboard.blueprints')}
        icon={<SchemaOutlinedIcon />}
        rank={myOrg.rank.blueprints}
        value={n(myOrg.blueprints)}
        pct={pct('blueprints')}
        gap={gap(data.orgs, 'blueprints')}
      />
      <MetricTile
        label={t('dashboard.missions')}
        icon={<TrackChangesIcon />}
        rank={myOrg.rank.missions}
        value={n(myOrg.missions)}
        pct={pct('missions')}
        gap={gap(data.orgs, 'missions')}
      />
      <MetricTile
        label={t('dashboard.resources')}
        icon={<DiamondOutlinedIcon />}
        rank={myOrg.rank.resources_scu}
        value={
          <>
            {n(myOrg.resources_scu, 1)}
            <Box component="span" sx={{ fontSize: 15, color: hud.textDim }}>
              {' '}
              SCU
            </Box>
          </>
        }
        pct={pct('resources_scu')}
        gap={gap(data.orgs, 'resources_scu', ' SCU')}
      />
    </Box>
  )
}

const TABS: { id: Tab; label: string; metric: string; rankKey: keyof CompetitionOrg['rank'] }[] = [
  { id: 'overall', label: 'tabOverall', metric: 'metricScore', rankKey: 'overall' },
  { id: 'blueprints', label: 'tabBlueprints', metric: 'metricBlueprints', rankKey: 'blueprints' },
  { id: 'missions', label: 'tabMissions', metric: 'metricMissions', rankKey: 'missions' },
  { id: 'resources_scu', label: 'tabResources', metric: 'metricResources', rankKey: 'resources_scu' },
]

const GRID = '56px minmax(0, 1.4fr) 84px minmax(0, 1.7fr) 72px'

function Trend({ value }: { value: number | null }) {
  const { t } = useTranslation()
  const [text, label, colour] =
    value === null
      ? ['—', t('dashboard.trendNew'), hud.textFaint]
      : value > 0
        ? [`▲ ${value}`, t('dashboard.trendUp', { count: value }), hud.teal]
        : value < 0
          ? [`▼ ${-value}`, t('dashboard.trendDown', { count: -value }), hud.amber]
          : ['— 0', t('dashboard.trendSame'), hud.textFaint]
  return (
    <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: 12.5, color: colour, textAlign: 'right' }}>
      <span aria-hidden>{text}</span>
      <Box component="span" sx={visuallyHidden}>
        {label}
      </Box>
    </Box>
  )
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const

function Leaderboard({ data }: { data: Competition }) {
  const { t } = useTranslation()
  const { n } = useFormat()
  const [tab, setTab] = useState<Tab>('overall')
  const current = TABS.find((x) => x.id === tab)!
  const sorted = [...data.orgs].sort((a, b) => a.rank[current.rankKey] - b.rank[current.rankKey] || a.name.localeCompare(b.name))
  const top = Math.max(...sorted.map((o) => valueOf(o, tab)), 0)
  const unit = tab === 'overall' ? ' pts' : tab === 'resources_scu' ? ' SCU' : ''

  return (
    <Box component="section" aria-labelledby="lb-title" sx={{ flex: '2 1 560px', minWidth: 0, bgcolor: hud.input, border: `1px solid ${hud.line}` }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', justifyContent: 'space-between', px: 2.5, py: 2, borderBottom: `1px solid ${hud.line}` }}>
        <Typography
          id="lb-title"
          variant="h6"
          component="h2"
          sx={{ m: 0, display: 'flex', gap: 1.25, alignItems: 'center', color: hud.text, fontSize: 17, letterSpacing: '0.18em' }}
        >
          <EmojiEventsOutlinedIcon sx={{ color: hud.teal, fontSize: 19 }} />
          {t('dashboard.leaderboard')}
        </Typography>
        <Box role="tablist" aria-label={t('dashboard.category')} sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {TABS.map((x) => {
            const on = x.id === tab
            return (
              <ButtonBase
                key={x.id}
                role="tab"
                aria-selected={on}
                onClick={() => setTab(x.id)}
                sx={{
                  height: 36,
                  px: 1.75,
                  fontFamily: fonts.display,
                  fontWeight: 600,
                  fontSize: 14,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  bgcolor: on ? 'rgba(79,209,197,0.14)' : 'transparent',
                  color: on ? hud.teal : hud.textMuted,
                  border: `1px solid ${on ? hud.teal : hud.lineStrong}`,
                }}
              >
                {t(`dashboard.${x.label}`)}
              </ButtonBase>
            )
          })}
        </Box>
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Box role="table" aria-labelledby="lb-title" sx={{ minWidth: 620 }}>
          <Box
            role="row"
            sx={{ display: 'grid', gridTemplateColumns: GRID, gap: 1.5, px: 2.5, py: 1.25, fontFamily: fonts.display, fontWeight: 600, fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: hud.textFaint }}
          >
            <span role="columnheader">{t('dashboard.colRank')}</span>
            <span role="columnheader">{t('dashboard.colOrg')}</span>
            <span role="columnheader">{t('dashboard.colPilots')}</span>
            <span role="columnheader">{t(`dashboard.${current.metric}`)}</span>
            <Box component="span" role="columnheader" sx={{ textAlign: 'right' }}>
              {t('dashboard.colTrend')}
            </Box>
          </Box>
          {sorted.map((org) => {
            const rank = org.rank[current.rankKey]
            const value = valueOf(org, tab)
            return (
              <Box
                key={org.id}
                role="row"
                sx={{
                  display: 'grid',
                  gridTemplateColumns: GRID,
                  alignItems: 'center',
                  gap: 1.5,
                  px: 2.5,
                  py: 1.375,
                  borderTop: `1px solid ${hud.lineSoft}`,
                  bgcolor: org.mine ? 'rgba(79,209,197,0.07)' : 'transparent',
                  boxShadow: org.mine ? `inset 3px 0 0 ${hud.teal}` : 'none',
                }}
              >
                <Box component="span" role="cell" sx={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 21, color: medal(rank) }}>
                  {String(rank).padStart(2, '0')}
                </Box>
                <Box component="span" role="cell" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                  <Box
                    component="span"
                    sx={{ flex: 'none', '& > span': { width: 34, height: 34, bgcolor: '#0f161b', border: `1px solid ${org.mine ? hud.teal : '#2f3d48'}`, color: org.mine ? hud.teal : '#b6c3cc' } }}
                  >
                    <OrgTag org={org} size={34} />
                  </Box>
                  <Box component="span" sx={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <Box component="span" sx={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {org.name}
                    </Box>
                    {org.mine && (
                      <Box component="span" sx={{ fontFamily: fonts.display, fontSize: 12, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: hud.teal }}>
                        {t('dashboard.yourOrg')}
                      </Box>
                    )}
                  </Box>
                </Box>
                <Box component="span" role="cell" sx={{ color: hud.textMuted, fontSize: 13 }}>
                  {org.member_count}
                </Box>
                <Box component="span" role="cell" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Bar pct={top > 0 ? (value / top) * 100 : 0} colour={org.mine ? hud.teal : '#3b4c58'} height={6} />
                  <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: 13.5, minWidth: 104, textAlign: 'right' }}>
                    {n(value, tab === 'resources_scu' ? 1 : 0)}
                    {unit}
                  </Box>
                </Box>
                <Box component="span" role="cell" sx={{ textAlign: 'right' }}>
                  <Trend value={org.trend} />
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>
      <Box sx={{ px: 2.5, py: 1.5, borderTop: `1px solid ${hud.line}`, fontSize: 12.5, color: hud.textDim }}>
        {t(data.period === 'month' ? 'dashboard.footnoteMonth' : 'dashboard.footnoteAll', { max: n(MAX_SCORE) })}
      </Box>
    </Box>
  )
}

function Contribution({ data }: { data: NonNullable<Competition['contribution']> }) {
  const { t } = useTranslation()
  const { n } = useFormat()
  const rows: { label: string; key: CompetitionMetric; digits: number }[] = [
    { label: t('dashboard.blueprints'), key: 'blueprints', digits: 0 },
    { label: t('dashboard.missions'), key: 'missions', digits: 0 },
    { label: t('dashboard.contribResources'), key: 'resources_scu', digits: 1 },
  ]
  return (
    <HudPanel title={t('dashboard.contribution')} id="contrib" sx={{ bgcolor: hud.input, gap: 1.75 }}>
      {rows.map(({ label, key, digits }) => {
        const { mine, org } = data[key]
        const share = org > 0 ? Math.round((mine / org) * 100) : 0
        return (
          <Box key={key} sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <Box component="span" sx={{ color: hud.textMuted }}>
                {label}
              </Box>
              <Mono colour={hud.text}>
                {n(mine, digits)}{' '}
                <Box component="span" sx={{ color: hud.textFaint }}>
                  / {n(org, digits)}
                </Box>
              </Mono>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Bar pct={share} />
              <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: 12, color: hud.teal, minWidth: 36, textAlign: 'right' }}>
                {share}%
              </Box>
            </Box>
          </Box>
        )
      })}
    </HudPanel>
  )
}

function RefineryOrders() {
  const { t } = useTranslation()
  const { n } = useFormat()
  const now = useNow(1000)
  const { data } = useQuery({
    queryKey: ['refinery-orders', 'dashboard-open'],
    queryFn: async () => {
      const res = await api.get('/api/refinery-orders', { params: { open: 1, per_page: 10, sort: 'eta', dir: 'asc' } })
      return { orders: unwrapList<RefineryOrder>(res.data), total: (res.data as { total?: number }).total }
    },
  })
  const orders = data?.orders ?? []
  const total = data?.total ?? orders.length

  return (
    <HudPanel
      title={t('dashboard.refineryQueue')}
      id="refq"
      sx={{ bgcolor: hud.input, gap: 1.5 }}
      aside={total > 0 && <HudBadge>{t('dashboard.openCount', { count: total })}</HudBadge>}
    >
      {orders.length === 0 ? (
        <Typography variant="body2" sx={{ color: hud.textDim }}>
          {t('dashboard.noOpenOrders')}
        </Typography>
      ) : (
        orders.slice(0, 3).map((o) => {
          const left = o.eta ? Math.round((new Date(o.eta).getTime() - now) / 1000) : null
          return (
            <Box key={o.id} sx={{ border: `1px solid ${hud.line}`, bgcolor: '#0f161b', px: 1.75, py: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                <Box component="span" sx={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {o.location?.name ?? o.station}
                </Box>
                <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: 12.5, color: left !== null && left <= 0 ? hud.teal : hud.amber }}>
                  {left === null ? '—' : formatDuration(left, t('dashboard.ready'))}
                </Box>
              </Box>
              <Box component="span" sx={{ fontSize: 12.5, color: hud.textMuted }}>
                {[o.method, o.materials.filter((m) => m.refine).map((m) => m.resource).join(', ')].filter(Boolean).join(' · ')}
              </Box>
              {(o.yield_total !== null || o.cost !== null) && (
                <Box component="span" sx={{ fontSize: 12.5, color: hud.textDim }}>
                  {o.yield_total !== null && (
                    <>
                      {t('dashboard.yield')} <Mono colour={hud.text}>{n(o.yield_total)} {o.unit}</Mono>
                    </>
                  )}
                  {o.yield_total !== null && o.cost !== null && ' · '}
                  {o.cost !== null && (
                    <>
                      {t('dashboard.cost')} <Mono colour={hud.text}>{n(o.cost)} aUEC</Mono>
                    </>
                  )}
                </Box>
              )}
            </Box>
          )
        })
      )}
      <Link component={RouterLink} to="/refinery" sx={{ fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
        {t('dashboard.openRefinery')}
      </Link>
    </HudPanel>
  )
}

/** One tracked reward pool, from GET /api/tracked-pools. */
interface TrackedPool {
  pool_key: string
  pool_label: string
  factions: string[]
  in_pool: number
  owned_in_pool: number
  missing: { blueprint_id: number | null; name: string | null; key: string }[]
}

/**
 * Reward pools the member is farming, as the blueprint dialog folds them:
 * who hands it out, how much is held, and (opened) what is still missing.
 * Fewest missing first, finished pools last.
 */
function TrackedPools({ onOpenBlueprint }: { onOpenBlueprint: (id: number) => void }) {
  const { t } = useTranslation()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const { data: pools = [] } = useQuery({
    queryKey: ['tracked-pools'],
    queryFn: async () => (await api.get<TrackedPool[]>('/api/tracked-pools')).data,
  })
  const left = (p: TrackedPool) => p.in_pool - p.owned_in_pool
  const sorted = [...pools].sort((a, b) => Number(left(a) === 0) - Number(left(b) === 0) || left(a) - left(b))

  return (
    <HudPanel
      title={t('dashboard.trackedPools')}
      id="pools"
      sx={{ bgcolor: hud.input, gap: 1 }}
      aside={pools.length > 0 && <HudBadge>{pools.length}</HudBadge>}
    >
      {pools.length === 0 && (
        <Typography variant="body2" sx={{ color: hud.textDim }}>
          {t('dashboard.noTrackedPools')}
        </Typography>
      )}
      {sorted.map((p) => {
        const open = openKey === p.pool_key
        const done = left(p) === 0
        return (
          <Box key={p.pool_key} sx={{ border: `1px solid ${open ? '#2f6f6a' : hud.lineSoft}`, bgcolor: '#0f161b' }}>
            <ButtonBase
              aria-expanded={open}
              onClick={() => setOpenKey(open ? null : p.pool_key)}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', minHeight: 44, px: 1.25, textAlign: 'left', '&:hover': { bgcolor: '#151e25' } }}
            >
              <ChevronRightIcon sx={{ fontSize: 16, flexShrink: 0, color: open ? hud.teal : hud.textFaint, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }} />
              <Box component="span" sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                <Box component="span" sx={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.factions[0] ?? p.pool_label}
                </Box>
                {p.factions[0] && (
                  <Box component="span" sx={{ fontSize: 12, color: hud.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.pool_label}
                  </Box>
                )}
              </Box>
              <Box sx={{ width: 56, height: 4, bgcolor: '#1c262d', flexShrink: 0 }} aria-hidden>
                <Box sx={{ height: '100%', width: `${p.in_pool ? (p.owned_in_pool / p.in_pool) * 100 : 0}%`, bgcolor: done ? hud.teal : '#5b7080' }} />
              </Box>
              <Box
                component="span"
                sx={{ flexShrink: 0, fontFamily: fonts.mono, fontSize: 12, px: 1, py: 0.25, border: `1px solid ${done ? '#2f6f6a' : '#34424e'}`, color: done ? hud.teal : '#c9d4db', bgcolor: done ? 'rgba(79,209,197,0.10)' : 'transparent' }}
              >
                {p.owned_in_pool}/{p.in_pool}
              </Box>
            </ButtonBase>
            {open && (
              <Box sx={{ px: 1.5, pb: 1.5, pt: 0.25, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {done ? (
                  <Box component="span" sx={{ fontSize: 12.5, color: hud.teal }}>
                    {t('dashboard.poolComplete')}
                  </Box>
                ) : (
                  <>
                    <Box component="span" sx={{ fontSize: 12, color: hud.textDim }}>
                      {t('dashboard.stillMissing')}
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                      {p.missing.map((m) => (
                        <ButtonBase
                          key={m.key}
                          disabled={m.blueprint_id === null}
                          onClick={() => m.blueprint_id !== null && onOpenBlueprint(m.blueprint_id)}
                          sx={{ fontSize: 12, px: 1.125, py: 0.5, border: '1px solid #2f3d48', color: hud.textMuted, '&:hover': { borderColor: '#3d5260', color: hud.text } }}
                        >
                          {m.name ?? t('dashboard.unnamedBlueprint')}
                        </ButtonBase>
                      ))}
                    </Box>
                  </>
                )}
              </Box>
            )}
          </Box>
        )
      })}
    </HudPanel>
  )
}

function Crew({ me, memberCount, onJoin }: { me: Me; memberCount: number; onJoin: () => void }) {
  const { t } = useTranslation()
  const [managing, setManaging] = useState(false)
  const org = me.orgs[0]
  const canManage = org?.pivot && (org.pivot.role === 'manager' || org.pivot.role === 'admin')
  const { data: mates = [] } = useQuery({
    queryKey: ['org-mates'],
    queryFn: async () => (await api.get<{ id: number; handle: string }[]>('/api/org/mates')).data,
  })
  const shown = mates.slice(0, 5)
  const rest = Math.max(0, memberCount - 1 - shown.length)
  const ring = { boxShadow: `0 0 0 2px ${hud.input}`, borderRadius: '50%', ml: '-6px' }

  return (
    <HudPanel
      title={t('dashboard.crew')}
      id="crew"
      sx={{ bgcolor: hud.input, gap: 1.5 }}
      aside={
        <Box component="span" sx={{ fontSize: 12.5, color: hud.textDim }}>
          {t('dashboard.pilots', { count: memberCount })}
        </Box>
      }
    >
      <Box sx={{ display: 'flex', alignItems: 'center', pl: '6px' }}>
        <Box sx={{ ...ring, boxShadow: `0 0 0 2px ${hud.input}, 0 0 0 3px ${hud.teal}` }} title={displayName(me)}>
          <PersonAvatar name={displayName(me)} src={me.avatar_url} size={34} ring={false} />
        </Box>
        {shown.map((m) => (
          <Box key={m.id} sx={ring} title={m.handle}>
            <PersonAvatar name={m.handle} size={34} ring={false} />
          </Box>
        ))}
        {rest > 0 && (
          <Box
            sx={{ ...ring, width: 34, height: 34, bgcolor: '#1f2a33', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.display, fontWeight: 700, fontSize: 12, color: hud.textMuted }}
          >
            +{rest}
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {canManage && (
          <Button variant="outlined" color="inherit" onClick={() => setManaging(true)} sx={ghostLink(hud.teal)}>
            {t('dashboard.manageMembers')}
          </Button>
        )}
        <Button variant="outlined" color="inherit" onClick={onJoin} sx={ghostLink(hud.textMuted)}>
          {t('dashboard.joinAnother')}
        </Button>
      </Box>
      {managing && org && <OrgMembersDialog orgId={org.id} orgName={org.name} selfId={me.id} open onClose={() => setManaging(false)} />}
    </HudPanel>
  )
}

const ghostLink = (colour: string) => ({
  minHeight: 38,
  px: 1.75,
  color: colour,
  fontFamily: fonts.body,
  fontWeight: 500,
  fontSize: 13,
  letterSpacing: 0,
  textTransform: 'none',
})

function PeriodToggle({ value, onChange }: { value: CompetitionPeriod; onChange: (p: CompetitionPeriod) => void }) {
  const { t } = useTranslation()
  const options: { id: CompetitionPeriod; label: string }[] = [
    { id: 'month', label: t('dashboard.thisMonth') },
    { id: 'all', label: t('dashboard.allTime') },
  ]
  return (
    <Box role="group" aria-label={t('dashboard.period')} sx={{ display: 'flex', border: `1px solid ${hud.lineStrong}` }}>
      {options.map((o, i) => {
        const on = o.id === value
        return (
          <ButtonBase
            key={o.id}
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            sx={{
              height: 40,
              px: 2,
              fontFamily: fonts.display,
              fontWeight: 600,
              fontSize: 14,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
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

export function DashboardPage({ me }: { me: Me }) {
  const { t } = useTranslation()
  const { n } = useFormat()
  const [period, setPeriod] = useState<CompetitionPeriod>('month')
  const [orgsOpen, setOrgsOpen] = useState(false)
  const [blueprintId, setBlueprintId] = useState<number | null>(null)
  const org = me.orgs[0]

  const competition = useQuery({
    queryKey: ['competition', period],
    queryFn: async () => (await api.get<Competition>('/api/dashboard/competition', { params: { period } })).data,
    placeholderData: (previous) => previous,
  })
  const { data: orgSummaries } = useQuery({
    queryKey: ['orgs'],
    queryFn: async () => unwrapList<OrgSummary>((await api.get('/api/orgs')).data),
    enabled: !!org,
  })
  const summary = orgSummaries?.find((o) => o.id === org?.id)
  const data = competition.data
  const myOrg = data?.orgs.find((o) => o.mine)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography variant="h1" component="h2" sx={{ fontSize: { xs: '2rem', md: '2.625rem' } }}>
            {t('dashboard.welcome', { name: displayName(me) })}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', mt: 1.5, flexWrap: 'wrap', color: hud.textDim, fontSize: 13 }}>
            {org ? (
              <>
                <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 30, pl: 0.5, pr: 1.25, border: `1px solid ${hud.lineStrong}`, bgcolor: hud.input, color: hud.text }}>
                  <OrgTag org={org} />
                  {org.name}
                </Box>
                {org.pivot && org.pivot.role !== 'member' && <HudBadge colour={hud.amber}>{t(`org.role.${org.pivot.role}`)}</HudBadge>}
                {summary && (
                  <span>
                    {t('dashboard.pilots', { count: summary.member_count })}
                    {summary.total_pieces > 0 && <> · {t('dashboard.hangar', { count: summary.total_pieces, formatted: n(summary.total_pieces) })}</>}
                  </span>
                )}
              </>
            ) : (
              <span>{t('dashboard.noOrgHelp')}</span>
            )}
          </Box>
        </Box>
        {org && <PeriodToggle value={period} onChange={setPeriod} />}
      </Box>

      {!org && (
        <Box>
          <Button variant="outlined" color="primary" onClick={() => setOrgsOpen(true)}>
            {t('dashboard.findOrg')}
          </Button>
        </Box>
      )}

      {org && competition.isError && <Alert severity="error">{t('dashboard.loadError')}</Alert>}
      {org && competition.isLoading && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 2 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rectangular" height={150} />
          ))}
        </Box>
      )}

      {data && myOrg && <Standings data={data} myOrg={myOrg} />}

      {org && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
          {data ? <Leaderboard data={data} /> : <Skeleton variant="rectangular" height={420} sx={{ flex: '2 1 560px' }} />}
          <Box sx={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {data?.contribution && <Contribution data={data.contribution} />}
            <RefineryOrders />
            <TrackedPools onOpenBlueprint={setBlueprintId} />
            <Crew me={me} memberCount={myOrg?.member_count ?? summary?.member_count ?? 1} onJoin={() => setOrgsOpen(true)} />
          </Box>
        </Box>
      )}

      <OrganizationsDialog me={me} open={orgsOpen} onClose={() => setOrgsOpen(false)} />
      <BlueprintInfoDialog blueprintId={blueprintId} onClose={() => setBlueprintId(null)} />
    </Box>
  )
}
