import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckIcon from '@mui/icons-material/Check'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { api } from '../lib/api'
import type { BlueprintInfo, BlueprintPool } from '../lib/types'
import { gradeLabel } from '../pages/CraftPage'
import { ProductStats } from './ProductStats'

function craftTime(seconds: number | null, t: TFunction, locale: string): string | null {
  if (!seconds) return null
  if (seconds < 3600) return t('craft.minutes', { count: Math.round(seconds / 60) })
  return t('craft.hours', { hours: (seconds / 3600).toLocaleString(locale, { maximumFractionDigits: 1 }) })
}

/**
 * Where a recipe comes from. A blueprint is not bought: finishing a mission
 * draws one blueprint from the pool its contract names. So the pool is the
 * unit a player plans around — what else is in it, how much of it they hold
 * already, and which missions feed it.
 */
function MissionSources({ pools, onOpen }: { pools: BlueprintPool[]; onOpen: (id: number) => void }) {
  const { t } = useTranslation()

  return (
    <>
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {t('blueprints.info.missionsTitle')}
      </Typography>
      {/* Rather more than half the recipes in the game sit in no pool at all.
          Saying so is the honest answer: it is what the game data says, and it
          is more use than an empty space. */}
      {pools.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t('blueprints.info.noMissions')}
        </Typography>
      )}
      <Stack spacing={2.5}>
        {pools.map((pool) => {
          const contracts = pool.sources.filter((s) => s.kind === 'contract')
          const events = pool.sources.filter((s) => s.kind === 'event')
          return (
            <Box key={pool.pool_key}>
              <Typography variant="body2">
                {pool.in_pool === 1
                  ? t('blueprints.info.poolHeadingSolo', { pool: pool.pool_label })
                  : t('blueprints.info.poolHeading', {
                      pool: pool.pool_label,
                      owned: pool.owned_in_pool,
                      count: pool.in_pool,
                      percent: pool.owned_percent,
                    })}
              </Typography>
              {/* What else the same mission can hand out. A recipe already
                  held is filled in; the ones still missing are why anyone
                  reads this list. */}
              <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
                {pool.contents.map((member) => (
                  <Chip
                    key={member.key}
                    size="small"
                    variant={member.owned ? 'filled' : 'outlined'}
                    color={member.is_this_one ? 'secondary' : member.owned ? 'success' : 'default'}
                    icon={member.owned ? <CheckIcon /> : undefined}
                    label={member.name ?? member.key}
                    onClick={
                      member.blueprint_id !== null && !member.is_this_one
                        ? () => onOpen(member.blueprint_id as number)
                        : undefined
                    }
                  />
                ))}
              </Stack>

              {(contracts.length > 0 || events.length > 0) && (
                <>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                    {t('blueprints.info.missionsUsing')}
                  </Typography>
                  <Box sx={{ mt: 0.5, pl: 1, borderLeft: 2, borderColor: 'divider' }}>
                    {contracts.map((source, i) => (
                      <Box key={i} sx={{ mb: 0.75 }}>
                        <Typography variant="body2" color="primary">
                          {source.contractor ?? t('blueprints.info.unknownContractor')}
                        </Typography>
                        {/* One line of titles rather than one line each: a
                            pool can be fed by thirty missions, and the point
                            is to recognise one on the contract board. */}
                        <Typography variant="body2" color="text.secondary">
                          {source.missions.length > 0
                            ? source.missions.join(' · ')
                            : t('blueprints.info.missionsUnnamed')}
                        </Typography>
                      </Box>
                    ))}
                    {events.map((source, i) => (
                      <Typography key={i} variant="body2" color="text.secondary">
                        {t('blueprints.info.eventTier', {
                          event: source.event,
                          points: source.min_points.toLocaleString(),
                        })}
                      </Typography>
                    ))}
                  </Box>
                </>
              )}
            </Box>
          )
        })}
      </Stack>
    </>
  )
}

interface Props {
  blueprintId: number | null
  onClose: () => void
  /** Mark / unmark as owned from inside the dialog. */
  onToggleOwned?: (info: BlueprintInfo) => void
}

/**
 * What a blueprint is — the craft dialog without the crafting: lore,
 * known stats with the span crafting quality can move them across, who in the
 * org holds it, and which missions pay it out.
 */
export function BlueprintInfoDialog({ blueprintId, onClose, onToggleOwned }: Props) {
  const { t, i18n } = useTranslation()
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
  const bp = data?.blueprint
  const time = bp ? craftTime(bp.craft_time_seconds, t, i18n.language) : null
  const others = (data?.owners ?? []).filter((o) => !o.mine)

  const close = () => {
    setTrail([])
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="md">
      {isLoading && <LinearProgress />}
      {isError && <Alert severity="error">{t('craft.detailLoadError')}</Alert>}
      {bp && data && (
        <>
          <DialogTitle sx={{ pb: 0.5 }}>
            {trail.length > 0 && (
              <Tooltip title={t('common.back')}>
                <IconButton size="small" onClick={() => setTrail(trail.slice(0, -1))} sx={{ mr: 1 }}>
                  <ArrowBackIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {bp.name}
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              {bp.manufacturer && <Chip size="small" label={bp.manufacturer} variant="outlined" />}
              <Chip size="small" label={data.category_label} variant="outlined" />
              {bp.type_display && bp.type_display !== data.category_label && <Chip size="small" label={bp.type_display} variant="outlined" />}
              {bp.grade && <Chip size="small" label={t('craft.grade', { grade: gradeLabel(bp.grade) })} variant="outlined" />}
              {bp.item_meta?.size !== undefined && <Chip size="small" label={t('craft.size', { size: bp.item_meta.size })} variant="outlined" />}
              {time && <Chip size="small" color="secondary" variant="outlined" label={t('craft.craftTime', { time })} />}
            </Stack>
          </DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', mt: 1.5, flexWrap: 'wrap' }}>
              <Box sx={{ flex: '0 1 61%', minWidth: 300 }}>
                {bp.item_meta?.stats && (
                  <ProductStats
                    stats={bp.item_meta.stats}
                    mass={bp.item_meta.mass}
                    factors={null}
                    ranges={data.stat_ranges}
                    groups={data.requirement_groups ?? []}
                  />
                )}
              </Box>
              <Box sx={{ flex: '1 1 300px', minWidth: 240 }}>
                {bp.image_url && (
                  <Tooltip title={t('craft.clickToZoom')}>
                    <Box
                      component="img"
                      src={bp.image_url}
                      alt={bp.name}
                      onClick={() => setImageZoom(true)}
                      sx={{ width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 1, border: 1, borderColor: 'divider', cursor: 'zoom-in', mb: 1.5 }}
                    />
                  </Tooltip>
                )}
                <Typography variant="body2" color="text.secondary">
                  {bp.description || t('craft.noDescription')}
                </Typography>
              </Box>
            </Box>

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('blueprints.info.ownersTitle')}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              {bp.is_default && <Chip size="small" label={t('craft.everyoneDefault')} color="primary" variant="outlined" />}
              {data.owned_by_me && <Chip size="small" label={t('craft.you')} color="primary" />}
              {others.map((o) => (
                <Chip key={o.id} size="small" label={o.handle} variant="outlined" />
              ))}
              {!bp.is_default && !data.owned_by_me && others.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('craft.nobodyOwns')}
                </Typography>
              )}
            </Stack>

            <MissionSources pools={data.missions} onOpen={(id) => setTrail([...trail, id])} />
          </DialogContent>
          <DialogActions>
            {onToggleOwned && (
              <Button variant={data.owned_by_me ? 'outlined' : 'contained'} onClick={() => onToggleOwned(data)}>
                {data.owned_by_me ? t('blueprints.info.unmarkOwned') : t('blueprints.info.markOwned')}
              </Button>
            )}
            <Button onClick={close}>{t('common.close')}</Button>
          </DialogActions>
          {bp.image_url && (
            <Dialog open={imageZoom} onClose={() => setImageZoom(false)} maxWidth="lg">
              <Box component="img" src={bp.image_url} alt={bp.name} onClick={() => setImageZoom(false)} sx={{ maxWidth: '90vw', maxHeight: '85vh', display: 'block', cursor: 'zoom-out' }} />
            </Dialog>
          )}
        </>
      )}
    </Dialog>
  )
}
