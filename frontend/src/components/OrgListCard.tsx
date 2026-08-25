import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import GroupsIcon from '@mui/icons-material/Groups'
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts'
import { api, unwrapList } from '../lib/api'
import type { Me, OrgSummary } from '../lib/types'
import { OrgMembersDialog } from './OrgMembersDialog'

/** Compact "12,340 SCU · 87 pcs · 5 blueprints" line for one org's pooled stats. */
function orgStats(org: OrgSummary): string {
  const parts = [
    `${org.member_count.toLocaleString()} ${org.member_count === 1 ? 'member' : 'members'}`,
    `${org.total_scu.toLocaleString()} SCU`,
  ]
  if (org.total_pieces > 0) parts.push(`${org.total_pieces.toLocaleString()} pcs`)
  parts.push(`${org.blueprint_count.toLocaleString()} blueprints`)
  return parts.join(' · ')
}

/**
 * Dashboard card listing every org with pooled stats and the caller's
 * membership actions: request to join, cancel a pending request, leave,
 * and (for managers/admins) open the member-moderation dialog.
 */
export function OrgListCard({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const [manageOrg, setManageOrg] = useState<OrgSummary | null>(null)

  const orgsQuery = useQuery({
    queryKey: ['orgs'],
    queryFn: async () => unwrapList<OrgSummary>((await api.get('/api/orgs')).data),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['orgs'] })
    void queryClient.invalidateQueries({ queryKey: ['me'] })
  }

  const join = useMutation({
    mutationFn: async (orgId: number) => api.post(`/api/orgs/${orgId}/join`),
    onSuccess: invalidate,
    // A 409 means the request already exists server-side — refetch to resync.
    onError: invalidate,
  })

  const leave = useMutation({
    mutationFn: async (orgId: number) => api.delete(`/api/orgs/${orgId}/leave`),
    onSuccess: invalidate,
  })

  const busy = join.isPending || leave.isPending

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <GroupsIcon color="primary" />
        <Typography variant="h6">Organizations</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Join an org to pool materials, items and blueprints with your org mates.
      </Typography>

      {orgsQuery.isLoading && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {[0, 1].map((i) => (
            <Skeleton key={i} variant="rounded" height={56} />
          ))}
        </Box>
      )}
      {orgsQuery.isError && <Alert severity="error">Could not load organizations.</Alert>}
      {orgsQuery.isSuccess && orgsQuery.data.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
          No organizations registered yet.
        </Typography>
      )}

      {orgsQuery.isSuccess && orgsQuery.data.length > 0 && (
        <List disablePadding>
          {orgsQuery.data.map((org) => {
            const membership = org.membership
            const canManage =
              membership !== null && (membership.role === 'manager' || membership.role === 'admin')
            return (
              <ListItem key={org.id} divider disableGutters sx={{ flexWrap: 'wrap', gap: 1 }}>
                <ListItemText
                  primary={org.name}
                  secondary={orgStats(org)}
                  sx={{ minWidth: 200, mr: 1 }}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  {membership === null && (
                    <Button
                      size="small"
                      variant="contained"
                      disabled={busy}
                      onClick={() => join.mutate(org.id)}
                    >
                      Request to join
                    </Button>
                  )}
                  {membership?.status === 'pending' && (
                    <>
                      <Chip size="small" label="Pending approval" color="warning" disabled />
                      <Button
                        size="small"
                        color="inherit"
                        disabled={busy}
                        onClick={() => leave.mutate(org.id)}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                  {membership?.status === 'active' && (
                    <>
                      <Chip
                        size="small"
                        label={membership.role}
                        color={membership.role === 'manager' ? 'secondary' : 'default'}
                        variant="outlined"
                      />
                      {canManage && (
                        <Button
                          size="small"
                          startIcon={<ManageAccountsIcon />}
                          onClick={() => setManageOrg(org)}
                        >
                          Manage members
                        </Button>
                      )}
                      <Button
                        size="small"
                        color="error"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Leave ${org.name}?`)) leave.mutate(org.id)
                        }}
                      >
                        Leave
                      </Button>
                    </>
                  )}
                </Box>
              </ListItem>
            )
          })}
        </List>
      )}

      {manageOrg && (
        <OrgMembersDialog
          orgId={manageOrg.id}
          orgName={manageOrg.name}
          selfId={me.id}
          open
          onClose={() => setManageOrg(null)}
        />
      )}
    </Paper>
  )
}
