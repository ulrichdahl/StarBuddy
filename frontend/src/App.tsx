import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import { useMe } from './lib/auth'
import { api } from './lib/api'
import { browserLocale, isLocale, setLocale } from './i18n'
import type { Me } from './lib/types'
import { AppShell } from './components/AppShell'
import { LoginPage } from './pages/LoginPage'
import { CraftPage } from './pages/CraftPage'
import { DashboardPage } from './pages/DashboardPage'
import { ResourcesPage } from './pages/ResourcesPage'
import { ItemsPage } from './pages/ItemsPage'
import { BlueprintsPage } from './pages/BlueprintsPage'
import { RefineryPage } from './pages/RefineryPage'
import { ImportPage } from './pages/ImportPage'
import { AdminPage } from './pages/AdminPage'
import { TrainingPage } from './pages/TrainingPage'
import { AboutPage } from './pages/AboutPage'

/**
 * Profile locale wins once it exists; on first login (locale null) the
 * browser's language is stored so it follows the member to other devices.
 */
function useLocaleSync(me: Me | null) {
  useEffect(() => {
    if (!me) return
    if (isLocale(me.locale)) {
      setLocale(me.locale)
    } else if (me.locale === null) {
      const detected = browserLocale()
      setLocale(detected)
      void api.patch('/api/me', { locale: detected }).catch(() => undefined)
    }
  }, [me])
}

export default function App() {
  const { me, isLoading } = useMe()
  useLocaleSync(me)

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
        <Route path="/craft" element={<CraftPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/blueprints" element={<BlueprintsPage />} />
        <Route path="/refinery" element={<RefineryPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/training" element={<TrainingPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
