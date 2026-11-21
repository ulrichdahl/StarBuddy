import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { api, unwrapList } from '../lib/api'
import type { BulkClearResult, OwnClearRequest, ResourceType } from '../lib/types'
import { hud } from '../theme'
import { HudPanel } from './hud'

/** The word the player must type to confirm. Not localized on purpose, as on the Admin page. */
const CONFIRM_WORD = 'CLEAR'

/**
 * The player's own stock, cleared after a game wipe: the material categories
 * the patch took and, if ticked, items. Private and org-visible stacks alike;
 * nobody else's.
 */
export function OwnStockSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string> | null>(null) // null = all
  const [items, setItems] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const { data: resourceTypes = [] } = useQuery({
    queryKey: ['resource-types', ''],
    enabled: open,
    queryFn: async () =>
      unwrapList<ResourceType>((await api.get('/api/resource-types', { params: { search: '' } })).data),
  })
  const categories = [...new Set(resourceTypes.map((rt) => rt.category))].sort()
  const selected = picked ?? new Set(categories)

  const clear = useMutation({
    mutationFn: (body: OwnClearRequest) => api.delete<BulkClearResult>('/api/me/inventory', { data: body }),
    onSuccess: () => {
      for (const key of ['resource-stacks', 'item-stacks', 'craftability', 'dashboard']) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
      setOpen(false)
      setConfirmText('')
    },
  })

  const close = () => {
    setOpen(false)
    setConfirmText('')
  }
  const request = (): OwnClearRequest => ({
    everything: true,
    items,
    ...(picked && selected.size < categories.length ? { resource_categories: [...selected] } : {}),
  })
  // Category names are game data, interpolated verbatim.
  const scope = [
    selected.size === categories.length
      ? t('admin.scopeAllMaterials')
      : t('admin.scopeMaterialsIn', { list: [...selected].sort().join(', ') || '—' }),
    items ? t('admin.scopeItemsToo') : t('admin.scopeItemsKept'),
  ].join(', ')

  return (
    <HudPanel title={t('ownStock.title')} component="h3" id="pm-stock" raised>
      <Typography variant="body2" sx={{ color: hud.textMuted, lineHeight: 1.55 }}>
        {t('ownStock.help')}
      </Typography>
      {clear.isSuccess && (
        <Alert severity="success">
          {t('admin.clearedCounts', {
            materials: clear.data.data.cleared.resource_stacks,
            items: clear.data.data.cleared.item_stacks,
          })}
        </Alert>
      )}
      <Box>
        <Button variant="outlined" color="secondary" onClick={() => setOpen(true)}>
          {t('ownStock.open')}
        </Button>
      </Box>

      <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>{t('ownStock.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {t('admin.wipeWhat')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2 }}>
            {categories.map((cat) => (
              <FormControlLabel
                key={cat}
                control={
                  <Checkbox
                    checked={selected.has(cat)}
                    onChange={(e) => {
                      const next = new Set(selected)
                      if (e.target.checked) next.add(cat)
                      else next.delete(cat)
                      setPicked(next)
                    }}
                  />
                }
                label={cat}
              />
            ))}
            <FormControlLabel
              control={<Checkbox checked={items} onChange={(e) => setItems(e.target.checked)} />}
              label={t('admin.wipeItems')}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 2 }}>
            {t('admin.wipeWhatHelp')}
          </Typography>
          <DialogContentText sx={{ mb: 2 }}>
            <Trans
              i18nKey="ownStock.confirmBody"
              values={{ scope, word: CONFIRM_WORD }}
              components={{ strong: <strong /> }}
            />
          </DialogContentText>
          <TextField
            fullWidth
            label={t('admin.typeWord', { word: CONFIRM_WORD })}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          {clear.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {t('admin.clearFailed')}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={confirmText !== CONFIRM_WORD || clear.isPending || (selected.size === 0 && !items)}
            onClick={() => clear.mutate(request())}
          >
            {clear.isPending ? t('admin.clearing') : t('ownStock.clear')}
          </Button>
        </DialogActions>
      </Dialog>
    </HudPanel>
  )
}
