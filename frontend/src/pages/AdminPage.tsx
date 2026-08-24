import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
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
import type { BulkClearRequest, Location, ResourceType } from '../lib/types'
import { PageHeader } from '../components/PageHeader'

type ScopeMode = 'category' | 'type'

/**
 * Admin: bulk-clear org inventory. Scope by resource category OR a
 * specific resource type, optionally narrowed to a member and/or
 * location. Destructive, so committing requires typing CLEAR.
 */
export function AdminPage() {
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<ScopeMode>('category')
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
    mutationFn: (body: BulkClearRequest) => api.delete('/api/admin/inventory', { data: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-stacks'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setConfirmOpen(false)
      setConfirmText('')
    },
  })

  const hasTarget = mode === 'category' ? category !== '' : resourceType !== null

  const buildRequest = (): BulkClearRequest => ({
    ...(mode === 'category' ? { category } : { resource_type_id: resourceType?.id }),
    ...(memberId !== '' ? { member_id: Number(memberId) } : {}),
    ...(locationId !== '' ? { location_id: locationId } : {}),
  })

  const scopeSummary = [
    mode === 'category' ? `category "${category}"` : `resource "${resourceType?.name}"`,
    memberId !== '' ? `member #${memberId}` : 'all members',
    locationId !== '' ? `location "${locations.find((l) => l.id === locationId)?.name}"` : 'all locations',
  ].join(', ')

  return (
    <Box>
      <PageHeader title="Admin" subtitle="Org administration tools" />

      <Paper sx={{ p: 3, maxWidth: 560, borderColor: 'rgba(232, 180, 90, 0.35)' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
          <WarningAmberIcon color="secondary" />
          <Typography variant="h6">Bulk-clear inventory</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Permanently removes matching resource stacks from the org inventory. This cannot be undone.
        </Typography>

        <Stack spacing={2}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={mode}
            onChange={(_, value: ScopeMode | null) => value && setMode(value)}
            aria-label="Clear by"
          >
            <ToggleButton value="category">By category</ToggleButton>
            <ToggleButton value="type">By resource type</ToggleButton>
          </ToggleButtonGroup>

          {mode === 'category' ? (
            <TextField
              select
              label="Resource category"
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
              renderInput={(params) => <TextField {...params} label="Resource type" />}
            />
          )}

          <TextField
            label="Member ID (optional)"
            type="number"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            helperText="Leave empty to clear across all members"
          />

          <TextField
            select
            label="Location (optional)"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <MenuItem value="">All locations</MenuItem>
            {locations.map((loc) => (
              <MenuItem key={loc.id} value={loc.id}>
                {loc.name}
              </MenuItem>
            ))}
          </TextField>

          {clearInventory.isSuccess && <Alert severity="success">Inventory cleared.</Alert>}
          {clearInventory.isError && <Alert severity="error">Clear failed. Check your permissions.</Alert>}

          <Button
            variant="contained"
            color="secondary"
            disabled={!hasTarget}
            onClick={() => setConfirmOpen(true)}
          >
            Clear inventory…
          </Button>
        </Stack>
      </Paper>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Confirm bulk clear</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            You are about to delete all stacks matching: {scopeSummary}. Type <strong>CLEAR</strong> to
            confirm.
          </DialogContentText>
          <TextField
            fullWidth
            autoFocus
            label="Type CLEAR"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={confirmText !== 'CLEAR' || clearInventory.isPending}
            onClick={() => clearInventory.mutate(buildRequest())}
          >
            {clearInventory.isPending ? 'Clearing…' : 'Clear inventory'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
