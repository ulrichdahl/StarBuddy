import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import GroupsIcon from '@mui/icons-material/Groups'
import HowToRegIcon from '@mui/icons-material/HowToReg'
import PublicIcon from '@mui/icons-material/Public'
import { useTranslation } from 'react-i18next'

interface OwnersCellProps {
  isDefault: boolean
  ownedByMe: boolean
  /** Org members besides the viewer who own it. */
  owners: string[]
}

/**
 * Who has a blueprint: default globe, "you have it" mark, and an org count
 * chip whose tooltip lists the members. Shared by the craft list and the
 * blueprint pages so the column reads the same everywhere.
 */
export function OwnersCell({ isDefault, ownedByMe, owners }: OwnersCellProps) {
  const { t } = useTranslation()
  const count = owners.length

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      {isDefault && (
        <Tooltip title={t('craft.defaultBlueprintTooltip')}>
          <PublicIcon fontSize="small" color="disabled" />
        </Tooltip>
      )}
      {ownedByMe && (
        <Tooltip title={t('craft.youHaveTooltip')}>
          <HowToRegIcon fontSize="small" color="primary" />
        </Tooltip>
      )}
      {count > 0 && (
        <Tooltip
          title={
            <Box component="span" sx={{ whiteSpace: 'pre-line' }}>
              {t(ownedByMe ? 'craft.ownersBesidesYouTooltip' : 'craft.ownersTooltip', { count })}
              {'\n'}
              {owners.join('\n')}
            </Box>
          }
        >
          <Chip size="small" variant="outlined" icon={<GroupsIcon />} label={count} sx={{ fontVariantNumeric: 'tabular-nums' }} />
        </Tooltip>
      )}
      {!isDefault && count === 0 && !ownedByMe && (
        <Typography variant="body2" color="text.disabled">
          —
        </Typography>
      )}
    </Box>
  )
}
