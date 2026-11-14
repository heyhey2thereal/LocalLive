import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api } from './api'
import { useAuth } from './auth'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import MediaLibrary from './pages/MediaLibrary'
import Playlists from './pages/Playlists'
import Scenes from './pages/Scenes'
import Scheduling from './pages/Scheduling'
import Settings from './pages/Settings'
import SetupWizard from './pages/SetupWizard'

function Protected({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <Loading />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return <>{children}</>
}

export default function App() {
  const [installed, setInstalled] = useState<boolean | null>(null)

  useEffect(() => {
    api
      .get<{ installed: boolean }>('/api/config')
      .then((c) => setInstalled(c.installed))
      .catch(() => setInstalled(true))
  }, [])

  if (installed === null) return <Loading />
  if (!installed) return <SetupWizard onDone={() => setInstalled(true)} />

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="media" element={<MediaLibrary />} />
        <Route path="playlists" element={<Playlists />} />
        <Route path="scenes" element={<Scenes />} />
        <Route path="schedule" element={<Scheduling />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
