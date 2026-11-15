import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { Modal, useToast } from './ui'
import {
  IconCalendar,
  IconDashboard,
  IconLayers,
  IconLogout,
  IconMedia,
  IconPlaylist,
  IconSettings,
  IconHelp,
  IconSignal,
  IconStreams,
  IconUsers,
} from './icons'
import { LogoMark } from './Logo'
import { t } from '../i18n'

// Menu order requested by the operator.
const NAV = [
  { to: '/', label: 'nav.dashboard', icon: IconDashboard, end: true },
  { to: '/preview', label: 'nav.preview', icon: IconSignal },
  { to: '/scenes', label: 'nav.scenes', icon: IconLayers },
  { to: '/playlists', label: 'nav.playlists', icon: IconPlaylist },
  { to: '/streams', label: 'nav.streams', icon: IconStreams },
  { to: '/schedule', label: 'nav.schedule', icon: IconCalendar },
  { to: '/media', label: 'nav.media', icon: IconMedia },
  { to: '/users', label: 'nav.users', icon: IconUsers, adminOnly: true },
  { to: '/settings', label: 'nav.settings', icon: IconSettings },
  { to: '/faq', label: 'nav.faq', icon: IconHelp },
]

const TITLES: Record<string, string> = {
  '/': 'dashboard.title',
  '/preview': 'preview.title',
  '/streams': 'streams.title',
  '/media': 'media.title',
  '/playlists': 'playlists.title',
  '/scenes': 'scenes.title',
  '/schedule': 'schedule.title',
  '/users': 'users.title',
  '/settings': 'settings.title',
  '/faq': 'faq.title',
}

export default function Layout() {
  const { user, channelName, logout } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [version, setVersion] = useState('')
  const [changelog, setChangelog] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<{ version: string; changelog: string }>('/api/system/version')
      .then((d) => setVersion(d.version))
      .catch(() => {})
  }, [])

  // Show the one-shot "updated to X" notice left by a successful update. The
  // backend clears it on read, so it appears exactly once.
  useEffect(() => {
    api
      .get<{ show: boolean; version?: string }>('/api/system/update-notice')
      .then((d) => {
        if (d.show) push({ kind: 'ok', title: `Application mise à jour vers la version ${d.version ?? ''}`.trim() })
      })
      .catch(() => {})
  }, [push])

  const showChangelog = async () => {
    try {
      const d = await api.get<{ version: string; changelog: string }>('/api/system/version')
      setChangelog(d.changelog || `Version ${d.version}`)
    } catch {
      setChangelog('Journal indisponible')
    }
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <LogoMark size={34} />
          <div className="brand-text">
            <span className="brand-name">{t('app.name')}</span>
            <span className="brand-sub">{channelName}</span>
          </div>
        </div>
        {NAV.filter((item) => !item.adminOnly || user?.is_admin).map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} />
              <span>{t(item.label)}</span>
            </NavLink>
          )
        })}
        <div className="nav-spacer" />
        <div className="nav-user">
          <span className="nav-user-avatar">{(user?.username ?? '?').slice(0, 1).toUpperCase()}</span>
          <div className="nav-user-info">
            <span className="truncate nav-user-name">{user?.username ?? '—'}</span>
            <span className="nav-user-role">{user?.role ?? 'viewer'}</span>
          </div>
          <button className="nav-user-logout" onClick={handleLogout} title={t('nav.logout')} aria-label={t('nav.logout')}>
            <IconLogout size={17} />
          </button>
        </div>
        <button className="nav-version" onClick={showChangelog} title="Journal des versions">
          {version ? `v${version}` : '—'}
        </button>
      </aside>
      <main className="main">
        <div className="topbar">
          <div className="topbar-title">
            <h1>{t(TITLES[location.pathname] ?? 'dashboard.title')}</h1>
            <span>{t('app.tagline')}</span>
          </div>
        </div>
        <div className="page fade-in">
          <Outlet />
        </div>
      </main>
      {changelog !== null && (
        <Modal title={`Journal des versions — v${version}`} onClose={() => setChangelog(null)} wide>
          <pre className="mono changelog">{changelog}</pre>
        </Modal>
      )}
    </div>
  )
}
