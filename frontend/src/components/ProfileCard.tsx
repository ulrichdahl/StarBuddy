import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import BadgeIcon from '@mui/icons-material/Badge'
import { api } from '../lib/api'
import type { Me } from '../lib/types'

/** Set your Star Citizen handle — used for org-wide display and CSV imports. */
export function ProfileCard({ me }: { me: Me }) {
  const { t } = useTranslation()
  const [handle, setHandle] = useState(me.handle ?? '')
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async () => (await api.patch<Me>('/api/me', { handle: handle.trim() || null })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })

  const dirty = (me.handle ?? '') !== handle.trim()

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <BadgeIcon color="primary" />
        <Typography variant="h6">{t('profile.title')}</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('profile.help')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          label={t('profile.handleLabel')}
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          sx={{ flex: 1 }}
        />
        <Button variant="contained" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </Box>
      {save.isError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {t('profile.saveError')}
        </Alert>
      )}
      {save.isSuccess && !dirty && (
        <Alert severity="success" sx={{ mt: 1 }}>
          {t('profile.saved')}
        </Alert>
      )}
    </Paper>
  )
}
