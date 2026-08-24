import { Navigate, Route, Routes } from 'react-router-dom'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import { useMe } from './lib/auth'
import { AppShell } from './components/AppShell'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { ResourcesPage } from './pages/ResourcesPage'
import { ItemsPage } from './pages/ItemsPage'
import { BlueprintsPage } from './pages/BlueprintsPage'
import { RefineryPage } from './pages/RefineryPage'
import { ImportPage } from './pages/ImportPage'
import { AdminPage } from './pages/AdminPage'

export default function App() {
  const { me, isLoading } = useMe()

  if (isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress aria-label="Loading session" />
      </Box>
    )
  }

  if (!me) {
    return <LoginPage />
  }

  return (
    <Routes>
      <Route element={<AppShell me={me} />}>
        <Route index element={<DashboardPage me={me} />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/blueprints" element={<BlueprintsPage />} />
        <Route path="/refinery" element={<RefineryPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
