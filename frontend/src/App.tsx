import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import { useMe } from './lib/auth'
import { api } from './lib/api'
import { browserLocale, isLocale, setLocale } from './i18n'
import type { Me } from './lib/types'
import { AppShell } from './components/AppShell'
import { LoginPage } from './pages/LoginPage'
import { CraftPage } from './pages/CraftPage'
import { GatheringPage } from './pages/GatheringPage'
import { DashboardPage } from './pages/DashboardPage'
import { ResourcesPage } from './pages/ResourcesPage'
import { ItemsPage } from './pages/ItemsPage'
import { BlueprintsPage } from './pages/BlueprintsPage'
import { RefineryPage } from './pages/RefineryPage'
import { ImportPage } from './pages/ImportPage'
import { AdminPage } from './pages/AdminPage'
import { TrainingPage } from './pages/TrainingPage'
import { canSee } from './lib/access'
import { AboutPage } from './pages/AboutPage'

// The public help: its own chunk, reachable without signing in.
const HelpSite = lazy(() => import('./help/HelpSite').then((m) => ({ default: m.HelpSite })))

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
  const { pathname, search } = useLocation()
  const inHelp = pathname === '/help' || pathname.startsWith('/help/')
  // A help link that names its language (the desktop client's ?lang=) wins
  // over the profile's.
  const helpLang = inHelp ? new URLSearchParams(search).get('lang') : null
  useLocaleSync(isLocale(helpLang) ? null : me)

  if (inHelp) {
    return (
      <Suspense fallback={null}>
        <HelpSite signedIn={!!me} />
      </Suspense>
    )
  }

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
        <Route path="/gathering" element={<GatheringPage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/blueprints" element={<BlueprintsPage />} />
        <Route path="/refinery" element={<RefineryPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/admin" element={canSee(me, 'admin') ? <AdminPage /> : <Navigate to="/" replace />} />
        <Route path="/training" element={canSee(me, 'training') ? <TrainingPage /> : <Navigate to="/" replace />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
