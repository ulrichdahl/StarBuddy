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
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { api } from '../lib/api'
import type { BlueprintInfo } from '../lib/types'
import { gradeLabel } from '../pages/CraftPage'
import { ProductStats } from './ProductStats'

function craftTime(seconds: number | null, t: TFunction, locale: string): string | null {
  if (!seconds) return null
  if (seconds < 3600) return t('craft.minutes', { count: Math.round(seconds / 60) })
  return t('craft.hours', { hours: (seconds / 3600).toLocaleString(locale, { maximumFractionDigits: 1 }) })
}

interface Props {
  blueprintId: number | null
  onClose: () => void
  /** Mark / unmark as owned from inside the dialog. */
  onToggleOwned?: (info: BlueprintInfo) => void
}

/**
 * What a blueprint is — the craft dialog without the crafting: lore,
 * known stats with the span crafting quality can move them across, and
 * who in the org holds it. (Missions that award it come later.)
 */
export function BlueprintInfoDialog({ blueprintId, onClose, onToggleOwned }: Props) {
  const { t, i18n } = useTranslation()
  const [imageZoom, setImageZoom] = useState(false)
  const open = blueprintId !== null

  const { data, isLoading, isError } = useQuery({
    queryKey: ['blueprint-info', blueprintId],
    queryFn: async () => (await api.get<BlueprintInfo>(`/api/blueprints/${blueprintId}`)).data,
    enabled: open,
  })
  const bp = data?.blueprint
  const time = bp ? craftTime(bp.craft_time_seconds, t, i18n.language) : null
  const others = (data?.owners ?? []).filter((o) => !o.mine)

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      {isLoading && <LinearProgress />}
      {isError && <Alert severity="error">{t('craft.detailLoadError')}</Alert>}
      {bp && data && (
        <>
          <DialogTitle sx={{ pb: 0.5 }}>
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
          </DialogContent>
          <DialogActions>
            {onToggleOwned && (
              <Button variant={data.owned_by_me ? 'outlined' : 'contained'} onClick={() => onToggleOwned(data)}>
                {data.owned_by_me ? t('blueprints.info.unmarkOwned') : t('blueprints.info.markOwned')}
              </Button>
            )}
            <Button onClick={onClose}>{t('common.close')}</Button>
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
