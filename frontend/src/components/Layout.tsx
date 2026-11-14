import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import {
  IconCalendar,
  IconDashboard,
  IconLayers,
  IconLogout,
  IconMedia,
  IconPlaylist,
  IconSettings,
  IconSignal,
  IconStreams,
  IconUsers,
} from './icons'
import { LogoMark } from './Logo'
import { t } from '../i18n'

const NAV = [
  { to: '/', label: 'nav.dashboard', icon: IconDashboard, end: true },
  { to: '/preview', label: 'nav.preview', icon: IconSignal },
  { to: '/streams', label: 'nav.streams', icon: IconStreams },
  { to: '/media', label: 'nav.media', icon: IconMedia },
  { to: '/playlists', label: 'nav.playlists', icon: IconPlaylist },
  { to: '/scenes', label: 'nav.scenes', icon: IconLayers },
  { to: '/schedule', label: 'nav.schedule', icon: IconCalendar },
  { to: '/users', label: 'nav.users', icon: IconUsers, adminOnly: true },
  { to: '/settings', label: 'nav.settings', icon: IconSettings },
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
}

export default function Layout() {
  const { user, channelName, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

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
        <div className="nav-live">
          <span className="dot" />
          <span className="truncate">{user?.username ?? '—'}</span>
        </div>
        <button className="nav-item" onClick={handleLogout} style={{ width: '100%', textAlign: 'left' }}>
          <IconLogout size={18} />
          <span>{t('nav.logout')}</span>
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
    </div>
  )
}
