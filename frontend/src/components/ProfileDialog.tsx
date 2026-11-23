import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import { api } from '../lib/api'
import type { Me } from '../lib/types'
import { fonts, hud } from '../theme'
import { HudAvatar, HudPanel, OrgTag } from './hud'
import { OwnStockSection } from './OwnStockSection'
import { YourDataSection } from './YourDataSection'

const labelSx = {
  fontFamily: fonts.display,
  fontWeight: 600,
  fontSize: 13,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: hud.textDim,
} as const

function IdentitySection({ me }: { me: Me }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [handle, setHandle] = useState(me.handle ?? '')
  const save = useMutation({
    mutationFn: async () => (await api.patch<Me>('/api/me', { handle: handle.trim() || null })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })
  const dirty = (me.handle ?? '') !== handle.trim()
  const org = me.orgs[0]

  return (
    <HudPanel title={t('profileDialog.identity')} component="h3" id="pm-id" raised>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.25 }}>
          <Box sx={{ borderRadius: '50%', boxShadow: `0 0 0 6px ${hud.panelRaised}, 0 0 0 7px ${hud.lineStrong}` }}>
            <HudAvatar me={me} size={104} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('profileDialog.avatarFromDiscord')}
          </Typography>
        </Box>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault()
            if (dirty) save.mutate()
          }}
          sx={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          <Box component="label" htmlFor="pm-handle" sx={labelSx}>
            {t('profileDialog.handleLabel')}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <InputBase
              id="pm-handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              sx={{
                flex: 1,
                minWidth: 0,
                height: 44,
                px: 1.75,
                bgcolor: hud.well,
                border: `1px solid ${hud.lineStrong}`,
                fontFamily: fonts.mono,
                fontSize: 15,
                '&.Mui-focused': { borderColor: hud.teal },
              }}
            />
            <Button type="submit" variant="contained" disabled={!dirty || save.isPending} sx={{ height: 44, px: 2.5 }}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </Box>
          <Typography variant="body2" sx={{ fontSize: 12.5, color: hud.textDim }}>
            {t('profileDialog.handleHelp')}
          </Typography>
          {save.isError && <Alert severity="error">{t('profile.saveError')}</Alert>}
          {save.isSuccess && !dirty && <Alert severity="success">{t('profile.saved')}</Alert>}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75, fontSize: 13, color: hud.textMuted }}>
            {org ? (
              <>
                <OrgTag org={org} />
                {org.name}
                {org.pivot && (
                  <>
                    {' · '}
                    <Box component="span" sx={{ color: hud.amber }}>
                      {t(`org.role.${org.pivot.role}`)}
                    </Box>
                  </>
                )}
              </>
            ) : (
              t('profileDialog.noOrg')
            )}
          </Box>
        </Box>
      </Box>
    </HudPanel>
  )
}

/** The member's profile, opened from the avatar menu. The desktop client and the UDI link have their own page, /client. */
export function ProfileDialog({ me, open, onClose }: { me: Me; open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth={false} aria-labelledby="pm-title"
      slotProps={{
        paper: { sx: { width: 760, maxWidth: '100%', m: fullScreen ? 0 : 2 } },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, py: 2, pl: 2.75, pr: 2, borderBottom: `1px solid ${hud.lineSoft}` }}>
        <Typography id="pm-title" variant="h4" component="h2" sx={{ flex: 1, m: 0 }}>
          {t('profileDialog.title')}
        </Typography>
        <IconButton aria-label={t('common.close')} onClick={onClose} sx={{ width: 44, height: 44, border: `1px solid ${hud.lineStrong}`, color: hud.textMuted }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ p: 2.75, display: 'flex', flexDirection: 'column', gap: 2.25, overflowY: 'auto' }}>
        <IdentitySection me={me} />
        <OwnStockSection />
        <YourDataSection />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', py: 1.75, px: 2.75, borderTop: `1px solid ${hud.lineSoft}`, bgcolor: hud.well }}>
        <Button variant="outlined" color="inherit" onClick={onClose} sx={{ height: 44, px: 2.75 }}>
          {t('common.done')}
        </Button>
      </Box>
    </Dialog>
  )
}
