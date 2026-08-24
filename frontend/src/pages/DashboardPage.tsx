import { useQuery } from '@tanstack/react-query'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import DiamondIcon from '@mui/icons-material/Diamond'
import SchemaIcon from '@mui/icons-material/Schema'
import FactoryIcon from '@mui/icons-material/Factory'
import { api } from '../lib/api'
import type { DashboardStats, Me } from '../lib/types'
import { OrgListCard } from '../components/OrgListCard'
import { PageHeader } from '../components/PageHeader'
import { PairDeviceCard } from '../components/PairDeviceCard'
import { ProfileCard } from '../components/ProfileCard'
import type { ReactNode } from 'react'

interface StatCardProps {
  label: string
  value: number | undefined
  unit?: string
  icon: ReactNode
  loading: boolean
}

function StatCard({ label, value, unit, icon, loading }: StatCardProps) {
  return (
    <Paper sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
      <Box sx={{ color: 'primary.main', display: 'flex' }} aria-hidden>
        {icon}
      </Box>
      <Box>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        {loading ? (
          <Skeleton width={80} height={36} />
        ) : (
          <Typography variant="h5">
            {(value ?? 0).toLocaleString()}
            {unit && (
              <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                {unit}
              </Typography>
            )}
          </Typography>
        )}
      </Box>
    </Paper>
  )
}

export function DashboardPage({ me }: { me: Me }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<DashboardStats>('/api/dashboard')).data,
  })

  return (
    <Box>
      <PageHeader
        title={`Welcome back, ${me.handle ?? me.discord_username}`}
        subtitle={me.orgs.length > 0 ? `Tracking for ${me.orgs.map((o) => o.name).join(', ')}` : 'No org membership yet'}
      />
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
        }}
      >
        <StatCard
          label="Total resources"
          value={data?.total_resources_scu}
          unit="SCU"
          icon={<DiamondIcon fontSize="large" />}
          loading={isLoading}
        />
        <StatCard
          label="Blueprints owned"
          value={data?.blueprint_count}
          icon={<SchemaIcon fontSize="large" />}
          loading={isLoading}
        />
        <StatCard
          label="Open refinery orders"
          value={data?.open_refinery_orders}
          icon={<FactoryIcon fontSize="large" />}
          loading={isLoading}
        />
      </Box>
      <Box
        sx={{
          mt: 2,
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 560px))' },
        }}
      >
        <ProfileCard me={me} />
        <PairDeviceCard />
      </Box>
      <Box sx={{ mt: 2 }}>
        <OrgListCard me={me} />
      </Box>
    </Box>
  )
}
