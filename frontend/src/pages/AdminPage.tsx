import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { api, unwrapList } from '../lib/api'
import type { BulkClearRequest, BulkClearResult, Location, ResourceType } from '../lib/types'
import { PageHeader } from '../components/PageHeader'

type ScopeMode = 'category' | 'type' | 'everything'

/** The word the admin must type to confirm a bulk clear. Not localized on purpose. */
const CONFIRM_WORD = 'CLEAR'

/**
 * Admin: bulk-clear org inventory. Scope by resource category OR a
 * specific resource type, optionally narrowed to a member and/or
 * location. Destructive, so committing requires typing CLEAR.
 */
export function AdminPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<ScopeMode>('category')
  const [includePrivate, setIncludePrivate] = useState(false)
  const [category, setCategory] = useState('')
  const [resourceType, setResourceType] = useState<ResourceType | null>(null)
  const [memberId, setMemberId] = useState('')
  const [locationId, setLocationId] = useState<number | ''>('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const { data: resourceTypes = [] } = useQuery({
    queryKey: ['resource-types', ''],
    queryFn: async () =>
      unwrapList<ResourceType>((await api.get('/api/resource-types', { params: { search: '' } })).data),
  })

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: async () => unwrapList<Location>((await api.get('/api/locations')).data),
  })

  const categories = [...new Set(resourceTypes.map((rt) => rt.category))].sort()

  const clearInventory = useMutation({
    mutationFn: (body: BulkClearRequest) =>
      api.delete<BulkClearResult>('/api/admin/inventory', { data: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
      queryClient.invalidateQueries({ queryKey: ['item-stacks'] })
      queryClient.invalidateQueries({ queryKey: ['craftability'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setConfirmOpen(false)
      setConfirmText('')
    },
  })

  const hasTarget = mode === 'everything' || (mode === 'category' ? category !== '' : resourceType !== null)

  const buildRequest = (): BulkClearRequest => ({
    ...(mode === 'everything'
      ? { everything: true }
      : mode === 'category'
        ? { category, include_private: includePrivate }
        : { resource_type_id: resourceType?.id, include_private: includePrivate }),
    ...(memberId !== '' ? { member_id: Number(memberId) } : {}),
    ...(locationId !== '' ? { location_id: locationId } : {}),
  })

  // Category, resource and location names are game data — interpolated verbatim.
  const scopeSummary = [
    mode === 'everything'
      ? t('admin.scopeEverything')
      : mode === 'category'
        ? t('admin.scopeCategory', { name: category })
        : t('admin.scopeResource', { name: resourceType?.name }),
    mode === 'everything' || includePrivate ? t('admin.scopeWithPrivate') : t('admin.scopeOrgOnly'),
    memberId !== '' ? t('admin.scopeMember', { id: memberId }) : t('admin.scopeAllMembers'),
    locationId !== ''
      ? t('admin.scopeLocation', { name: locations.find((l) => l.id === locationId)?.name })
      : t('admin.scopeAllLocations'),
  ].join(', ')

  return (
    <Box>
      <PageHeader title={t('admin.title')} subtitle={t('admin.subtitle')} />

      <Paper sx={{ p: 3, maxWidth: 560, borderColor: 'rgba(232, 180, 90, 0.35)' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
          <WarningAmberIcon color="secondary" />
          <Typography variant="h6">{t('admin.bulkClearTitle')}</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t('admin.bulkClearDescription')}
        </Typography>

        <Stack spacing={2}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={mode}
            onChange={(_, value: ScopeMode | null) => value && setMode(value)}
            aria-label={t('admin.clearBy')}
          >
            <ToggleButton value="category">{t('admin.byCategory')}</ToggleButton>
            <ToggleButton value="type">{t('admin.byResourceType')}</ToggleButton>
            <ToggleButton value="everything">{t('admin.everything')}</ToggleButton>
          </ToggleButtonGroup>

          {mode === 'everything' ? (
            <Alert severity="warning" variant="outlined">
              {t('admin.everythingHelp')}
            </Alert>
          ) : mode === 'category' ? (
            <TextField
              select
              label={t('admin.resourceCategory')}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((cat) => (
                <MenuItem key={cat} value={cat}>
                  {cat}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Autocomplete
              options={resourceTypes}
              value={resourceType}
              onChange={(_, value) => setResourceType(value)}
              getOptionLabel={(option) => option.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              groupBy={(option) => option.category}
              renderInput={(params) => <TextField {...params} label={t('admin.resourceType')} />}
            />
          )}

          {mode !== 'everything' && (
            <FormControlLabel
              control={<Checkbox checked={includePrivate} onChange={(e) => setIncludePrivate(e.target.checked)} />}
              label={t('admin.includePrivate')}
            />
          )}

          <TextField
            label={t('admin.memberIdOptional')}
            type="number"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            helperText={t('admin.memberIdHelp')}
          />

          <TextField
            select
            label={t('admin.locationOptional')}
            value={locationId}
            onChange={(e) => setLocationId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <MenuItem value="">{t('admin.allLocations')}</MenuItem>
            {locations.map((loc) => (
              <MenuItem key={loc.id} value={loc.id}>
                {loc.name}
              </MenuItem>
            ))}
          </TextField>

          {clearInventory.isSuccess && (
            <Alert severity="success">
              {t('admin.clearedCounts', {
                materials: clearInventory.data.data.cleared.resource_stacks,
                items: clearInventory.data.data.cleared.item_stacks,
              })}
            </Alert>
          )}
          {clearInventory.isError && (
            <Alert severity="error">
              {(clearInventory.error as { response?: { data?: { message?: string } } }).response?.data?.message ??
                t('admin.clearFailed')}
            </Alert>
          )}

          <Button
            variant="contained"
            color="secondary"
            disabled={!hasTarget}
            onClick={() => setConfirmOpen(true)}
          >
            {t('admin.clearInventoryEllipsis')}
          </Button>
        </Stack>
      </Paper>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('admin.confirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            <Trans
              i18nKey="admin.confirmBody"
              values={{ scope: scopeSummary, word: CONFIRM_WORD }}
              components={{ strong: <strong /> }}
            />
          </DialogContentText>
          <TextField
            fullWidth
            autoFocus
            label={t('admin.typeWord', { word: CONFIRM_WORD })}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={confirmText !== CONFIRM_WORD || clearInventory.isPending}
            onClick={() => clearInventory.mutate(buildRequest())}
          >
            {clearInventory.isPending ? t('admin.clearing') : t('admin.clearInventory')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
