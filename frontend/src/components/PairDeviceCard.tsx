import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import Link from '@mui/material/Link'
import DeleteIcon from '@mui/icons-material/Delete'
import DevicesIcon from '@mui/icons-material/Devices'
import DownloadIcon from '@mui/icons-material/Download'
import { api } from '../lib/api'

interface PairingCode {
  code: string
  expires_at: string
}

interface Device {
  id: number
  name: string
  last_used_at: string | null
  created_at: string
}

export function PairDeviceCard() {
  const [code, setCode] = useState<PairingCode | null>(null)
  const queryClient = useQueryClient()

  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await api.get<Device[]>('/api/devices')).data,
  })

  const generate = useMutation({
    mutationFn: async () => (await api.post<PairingCode>('/api/devices/pairing-code')).data,
    onSuccess: setCode,
  })

  const revoke = useMutation({
    mutationFn: async (id: number) => api.delete(`/api/devices/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  })

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <DevicesIcon color="primary" />
        <Typography variant="h6">Desktop client</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Pair the StarMaker desktop app to sync blueprints and refinery events from your Game.log.
        Generate a code, then enter it in the app's Server panel within 10 minutes.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          component="a"
          href="https://github.com/ulrichdahl/StarMaker/releases/latest"
          target="_blank"
          rel="noopener"
        >
          Download the desktop app
        </Button>
        <Typography variant="caption" color="text.secondary">
          Windows installer · Linux AppImage/deb/rpm —{' '}
          <Link
            href="https://github.com/ulrichdahl/StarMaker/releases/tag/dev"
            target="_blank"
            rel="noopener"
            color="inherit"
          >
            dev builds
          </Link>
        </Typography>
      </Box>

      {code ? (
        <Box sx={{ mb: 2 }}>
          <Typography
            variant="h4"
            sx={{ fontFamily: 'monospace', letterSpacing: '0.2em', color: 'primary.main' }}
          >
            {code.code}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Single use · expires {new Date(code.expires_at).toLocaleTimeString()}
          </Typography>
        </Box>
      ) : null}

      <Button variant="outlined" onClick={() => generate.mutate()} disabled={generate.isPending}>
        {generate.isPending ? 'Generating…' : code ? 'Generate new code' : 'Generate pairing code'}
      </Button>

      {devices && devices.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Paired devices
          </Typography>
          {devices.map((d) => (
            <Box key={d.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ flex: 1 }}>
                {d.name}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  {d.last_used_at
                    ? `last sync ${new Date(d.last_used_at).toLocaleString()}`
                    : 'never used'}
                </Typography>
              </Typography>
              <IconButton
                size="small"
                aria-label={`Revoke ${d.name}`}
                onClick={() => revoke.mutate(d.id)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  )
}
