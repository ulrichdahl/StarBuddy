import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { alpha } from '@mui/material/styles'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import ListItemText from '@mui/material/ListItemText'
import Skeleton from '@mui/material/Skeleton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import PersonRemoveIcon from '@mui/icons-material/PersonRemove'
import { api, unwrapList } from '../lib/api'
import type { OrgMember } from '../lib/types'

export interface OrgMembersDialogProps {
  /** Org whose roster is moderated. */
  orgId: number
  /** Org name, shown in the dialog title. */
  orgName: string
  /** The caller's own user id (from GET /api/me) — hides the Kick action on their own row. */
  selfId: number
  open: boolean
  onClose: () => void
}

const membersKey = (orgId: number) => ['orgs', orgId, 'members'] as const

/**
 * Manager moderation dialog for a single org: approve pending join requests
 * (server sorts pending rows first) and kick active members. Requires a
 * manager+ role server-side; a 403 is surfaced as an inline alert.
 */
export function OrgMembersDialog({ orgId, orgName, selfId, open, onClose }: OrgMembersDialogProps) {
  const queryClient = useQueryClient()

  const membersQuery = useQuery({
    queryKey: membersKey(orgId),
    queryFn: async () => unwrapList<OrgMember>((await api.get(`/api/orgs/${orgId}/members`)).data),
    enabled: open,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['orgs'] })
    void queryClient.invalidateQueries({ queryKey: membersKey(orgId) })
  }

  const accept = useMutation({
    mutationFn: async (userId: number) => api.post(`/api/orgs/${orgId}/members/${userId}/accept`),
    onSuccess: invalidate,
  })

  const kick = useMutation({
    mutationFn: async (userId: number) => api.delete(`/api/orgs/${orgId}/members/${userId}`),
    onSuccess: invalidate,
  })

  const busy = accept.isPending || kick.isPending
  const mutationFailed = accept.isError || kick.isError

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="org-members-title">
      <DialogTitle id="org-members-title">{orgName} — members</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {membersQuery.isLoading && (
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {[0, 1, 2].map((i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Skeleton variant="circular" width={40} height={40} />
                <Skeleton variant="text" sx={{ flex: 1 }} />
              </Box>
            ))}
          </Box>
        )}
        {membersQuery.isError && (
          <Alert severity="error" sx={{ m: 2 }}>
            Could not load the member list — you need a manager role in this org.
          </Alert>
        )}
        {mutationFailed && (
          <Alert severity="error" sx={{ m: 2, mb: 0 }}>
            That action failed — the roster may have changed. It has been refreshed.
          </Alert>
        )}
        {membersQuery.isSuccess && membersQuery.data.length === 0 && (
          <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            No members yet.
          </Typography>
        )}
        {membersQuery.isSuccess && membersQuery.data.length > 0 && (
          <List disablePadding>
            {membersQuery.data.map((member) => {
              const pending = member.status === 'pending'
              const displayName = member.handle ?? member.name
              return (
                <ListItem
                  key={member.id}
                  divider
                  sx={pending ? { bgcolor: (theme) => alpha(theme.palette.secondary.main, 0.08) } : undefined}
                  secondaryAction={
                    pending ? (
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                          size="small"
                          variant="contained"
                          disabled={busy}
                          onClick={() => accept.mutate(member.id)}
                        >
                          Accept
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          disabled={busy}
                          onClick={() => kick.mutate(member.id)}
                        >
                          Decline
                        </Button>
                      </Box>
                    ) : member.id !== selfId ? (
                      <Tooltip title={`Kick ${displayName}`}>
                        <span>
                          <IconButton
                            edge="end"
                            color="error"
                            disabled={busy}
                            aria-label={`Kick ${displayName}`}
                            onClick={() => {
                              if (window.confirm(`Kick ${displayName} from ${orgName}?`)) {
                                kick.mutate(member.id)
                              }
                            }}
                          >
                            <PersonRemoveIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                    ) : undefined
                  }
                >
                  <ListItemAvatar>
                    <Avatar src={member.avatar_url ?? undefined} alt={displayName}>
                      {displayName.charAt(0).toUpperCase()}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={displayName}
                    secondary={
                      <Box component="span" sx={{ display: 'inline-flex', gap: 0.5, mt: 0.5 }}>
                        <Chip
                          component="span"
                          size="small"
                          label={member.role}
                          color={member.role === 'manager' ? 'secondary' : 'default'}
                          variant="outlined"
                        />
                        <Chip
                          component="span"
                          size="small"
                          label={pending ? 'pending' : 'active'}
                          color={pending ? 'warning' : 'default'}
                          variant={pending ? 'filled' : 'outlined'}
                        />
                      </Box>
                    }
                    slotProps={{ secondary: { component: 'span' } }}
                  />
                </ListItem>
              )
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
