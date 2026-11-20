import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import type { Me } from '../lib/types'
import { hud } from '../theme'
import { OrgListCard } from './OrgListCard'

/** Every org, with join, leave and (for managers) member moderation. */
export function OrganizationsDialog({ me, open, onClose }: { me: Me; open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="orgs-title">
      <DialogTitle id="orgs-title" sx={{ display: 'flex', alignItems: 'center', gap: 2, pr: 2 }}>
        <Box component="span" sx={{ flex: 1 }}>
          {t('org.title')}
        </Box>
        <IconButton aria-label={t('common.close')} onClick={onClose} sx={{ border: `1px solid ${hud.lineStrong}` }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <OrgListCard me={me} bare />
      </DialogContent>
    </Dialog>
  )
}
