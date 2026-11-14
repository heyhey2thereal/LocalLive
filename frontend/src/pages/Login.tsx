import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { Spinner } from '../components/ui'
import { t } from '../i18n'

export default function Login() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.post('/api/auth/login', { username, password })
      await refresh()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connexion impossible')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="flex items-center gap-12 mb-16">
          <div className="brand-mark" style={{ width: 44, height: 44, fontSize: 20 }}>
            L
          </div>
          <div>
            <h1 style={{ fontSize: 20 }}>{t('app.name')}</h1>
            <span className="text-sm muted-2">{t('app.tagline')}</span>
          </div>
        </div>
        <h2 className="mb-16" style={{ fontSize: 16 }}>
          {t('login.title')}
        </h2>
        <div className="field">
          <label htmlFor="username">{t('login.username')}</label>
          <input
            id="username"
            className="input"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="password">{t('login.password')}</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && (
          <div className="field">
            <span className="error">{error}</span>
          </div>
        )}
        <button className="btn btn-primary w-full" type="submit" disabled={busy}>
          {busy ? <Spinner /> : null}
          {t('login.submit')}
        </button>
      </form>
    </div>
  )
}
