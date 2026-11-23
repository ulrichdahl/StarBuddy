import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Trans, useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import DownloadIcon from '@mui/icons-material/Download'
import { api } from '../lib/api'
import { hud } from '../theme'
import { HudPanel } from './hud'

/** The word the player must type to confirm. Not localized on purpose, as for clearing stock. */
const CONFIRM_WORD = 'DELETE'

/**
 * The member's own data: everything StarBuddy keeps about them as one JSON
 * file, or the whole account deleted.
 */
export function YourDataSection() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const exportData = useMutation({
    mutationFn: async () => {
      const res = await api.get<Blob>('/api/me/export', { responseType: 'blob' })
      const name = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ?? 'starbuddy.json'
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    },
  })

  const remove = useMutation({
    mutationFn: async () => api.delete('/api/me', { data: { confirm: CONFIRM_WORD } }),
    // Signed out with the account: start over on the sign-in page.
    onSuccess: () => window.location.assign('/'),
  })

  const close = () => {
    setOpen(false)
    setConfirmText('')
  }

  return (
    <HudPanel title={t('yourData.title')} component="h3" id="pm-data" raised>
      <Typography variant="body2" sx={{ color: hud.textMuted, lineHeight: 1.55 }}>
        {t('yourData.help')}
      </Typography>
      {exportData.isError && <Alert severity="error">{t('yourData.exportError')}</Alert>}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => exportData.mutate()} disabled={exportData.isPending}>
          {t('yourData.export')}
        </Button>
        <Button variant="outlined" color="error" onClick={() => setOpen(true)}>
          {t('yourData.delete')}
        </Button>
      </Box>

      <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>{t('yourData.deleteTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>{t('yourData.deleteWhat')}</DialogContentText>
          <DialogContentText sx={{ mb: 2 }}>
            <Trans i18nKey="yourData.deleteConfirm" values={{ word: CONFIRM_WORD }} components={{ strong: <strong /> }} />
          </DialogContentText>
          <TextField fullWidth label={t('admin.typeWord', { word: CONFIRM_WORD })} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          {remove.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {t('yourData.deleteError')}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button color="error" variant="contained" disabled={confirmText !== CONFIRM_WORD || remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? t('yourData.deleting') : t('yourData.deleteFinal')}
          </Button>
        </DialogActions>
      </Dialog>
    </HudPanel>
  )
}
