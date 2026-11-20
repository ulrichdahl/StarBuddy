import { Trans, useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import ListItemIcon from '@mui/material/ListItemIcon'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import LogoutIcon from '@mui/icons-material/Logout'
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined'
import { api } from '../lib/api'
import { deviceState, latestSync, useDevices } from '../lib/devices'
import type { Me } from '../lib/types'
import { fonts, hud } from '../theme'
import { displayName } from '../lib/people'
import { HudAvatar, Mono, StatusDot } from './hud'

interface UserMenuProps {
  me: Me
  anchor: HTMLElement | null
  onClose: () => void
  onOpenProfile: () => void
  onOpenOrganizations: () => void
}

const itemSx = { minHeight: 44, gap: 1.5, px: 2, color: hud.textSoft, '&:hover': { color: hud.text } }

async function signOut() {
  try {
    await api.post('/api/auth/logout')
  } finally {
    window.location.assign('/')
  }
}

/** The account menu under the avatar: who you are, client sync, profile, sign out. */
export function UserMenu({ me, anchor, onClose, onOpenProfile, onOpenOrganizations }: UserMenuProps) {
  const { t, i18n } = useTranslation()
  const { data: devices } = useDevices()
  const latest = latestSync(devices)
  const org = me.orgs[0]
  const time = latest?.last_used_at
    ? new Date(latest.last_used_at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <Menu
      anchorEl={anchor}
      open={anchor !== null}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { width: 300, mt: 1 } }, list: { 'aria-label': t('nav.account'), sx: { py: 0 } } }}
    >
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', p: 2 }}>
        <HudAvatar me={me} size={44} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
          <Box component="span" sx={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, letterSpacing: '0.03em' }}>
            {displayName(me)}
          </Box>
          {org && (
            <Box component="span" sx={{ fontSize: 12.5, color: hud.textDim }}>
              {org.name}
              {org.pivot && (
                <>
                  {' · '}
                  <Box component="span" sx={{ color: hud.amber }}>
                    {t(`org.role.${org.pivot.role}`)}
                  </Box>
                </>
              )}
            </Box>
          )}
        </Box>
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mx: 2,
          mb: 1.5,
          px: 1.25,
          py: 1,
          bgcolor: hud.well,
          border: `1px solid ${hud.lineSoft}`,
          fontSize: 12,
          color: hud.textMuted,
        }}
      >
        {latest && time ? (
          <>
            <StatusDot colour={deviceState(latest) === 'active' ? hud.teal : hud.amber} />
            <span>
              <Trans
                i18nKey="account.synced"
                values={{ time, device: latest.name }}
                components={{ t: <Mono colour={hud.text} /> }}
              />
            </span>
          </>
        ) : (
          <>
            <StatusDot colour={hud.textFaint} />
            {t('account.notPaired')}
          </>
        )}
      </Box>
      <Divider sx={{ my: '0 !important' }} />
      <MenuItem
        sx={{ ...itemSx, color: hud.text, my: 0.75 }}
        onClick={() => {
          onClose()
          onOpenProfile()
        }}
      >
        <ListItemIcon sx={{ minWidth: '0 !important', color: hud.teal }}>
          <PersonOutlinedIcon fontSize="small" />
        </ListItemIcon>
        {t('account.profile')}
      </MenuItem>
      <MenuItem
        sx={{ ...itemSx, mb: 0.75 }}
        onClick={() => {
          onClose()
          onOpenOrganizations()
        }}
      >
        <ListItemIcon sx={{ minWidth: '0 !important', color: 'inherit' }}>
          <GroupsOutlinedIcon fontSize="small" />
        </ListItemIcon>
        {t('account.organizations')}
      </MenuItem>
      <Divider sx={{ my: '0 !important' }} />
      <MenuItem sx={{ ...itemSx, my: 0.75 }} onClick={() => void signOut()}>
        <ListItemIcon sx={{ minWidth: '0 !important', color: 'inherit' }}>
          <LogoutIcon fontSize="small" />
        </ListItemIcon>
        {t('account.signOut')}
      </MenuItem>
    </Menu>
  )
}
