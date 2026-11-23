import { useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import DesktopWindowsOutlinedIcon from '@mui/icons-material/DesktopWindowsOutlined'
import { api } from '../lib/api'
import { HudPanel } from '../components/hud'
import { PageHeader } from '../components/PageHeader'
import { fonts, hud } from '../theme'

interface DeviceRequest {
  user_code: string
  device_name: string
  expires_at: string
  status: 'pending' | 'approved' | 'denied'
}

/**
 * /pair?code=ABCD-EFGH: the desktop client's "Sign in with browser" lands
 * here. The member checks the code matches the one in the client, and
 * approves or denies. The client then picks up its token by itself.
 */
export function PairPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const code = (params.get('code') ?? '').trim()
  useEffect(() => {
    try {
      sessionStorage.removeItem('starbuddy.afterLogin')
    } catch {
      // Nothing was kept.
    }
  }, [])

  const request = useQuery({
    queryKey: ['device-request', code],
    queryFn: async () => (await api.get<DeviceRequest>(`/api/devices/authorize/${encodeURIComponent(code)}`)).data,
    enabled: code !== '',
    retry: false,
  })
  const decide = useMutation({
    mutationFn: async (approve: boolean) => (await api.post<{ status: 'approved' | 'denied' }>(`/api/devices/authorize/${encodeURIComponent(code)}`, { approve })).data,
  })

  const status = decide.data?.status ?? request.data?.status
  const unknown = code === '' || (request.isError && isAxiosError(request.error) && request.error.response?.status === 404)

  return (
    <Box>
      <PageHeader title={t('pairPage.title')} />
      <HudPanel raised sx={{ maxWidth: 720 }}>
        {request.isLoading && <Skeleton variant="rectangular" height={160} />}
        {unknown && <Alert severity="warning">{t('pairPage.unknown')}</Alert>}
        {request.isError && !unknown && <Alert severity="error">{t('pairPage.loadError')}</Alert>}

        {request.data && status === 'pending' && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <DesktopWindowsOutlinedIcon sx={{ fontSize: 40, color: hud.teal }} />
              <Box>
                <Typography variant="h6" component="h3" sx={{ m: 0 }}>
                  {t('pairPage.question', { name: request.data.device_name })}
                </Typography>
                <Typography variant="body2" sx={{ color: hud.textDim, mt: 0.5 }}>
                  {t('pairPage.explain')}
                </Typography>
              </Box>
            </Box>
            <Box>
              <Typography variant="body2" sx={{ color: hud.textMuted, mb: 1 }}>
                {t('pairPage.checkCode')}
              </Typography>
              <Box
                sx={{
                  display: 'inline-block',
                  px: 2.5,
                  py: 1.25,
                  border: `1px dashed ${hud.teal}`,
                  bgcolor: 'rgba(79,209,197,0.06)',
                  fontFamily: fonts.mono,
                  fontSize: 28,
                  letterSpacing: '0.18em',
                  color: hud.teal,
                }}
              >
                {request.data.user_code}
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <Button variant="contained" size="large" onClick={() => decide.mutate(true)} disabled={decide.isPending}>
                {t('pairPage.approve')}
              </Button>
              <Button variant="outlined" color="inherit" size="large" onClick={() => decide.mutate(false)} disabled={decide.isPending}>
                {t('pairPage.deny')}
              </Button>
            </Box>
            {decide.isError && <Alert severity="error">{t('pairPage.decideError')}</Alert>}
          </>
        )}

        {status === 'approved' && (
          <Alert icon={<CheckCircleIcon fontSize="inherit" />} severity="success">
            {t('pairPage.approved', { name: request.data?.device_name ?? '' })}
          </Alert>
        )}
        {status === 'denied' && <Alert severity="info">{t('pairPage.denied')}</Alert>}
        {(status === 'approved' || status === 'denied' || unknown) && (
          <Box>
            <Button component={RouterLink} to="/client" variant="outlined">
              {t('pairPage.toClient')}
            </Button>
          </Box>
        )}
      </HudPanel>
    </Box>
  )
}
