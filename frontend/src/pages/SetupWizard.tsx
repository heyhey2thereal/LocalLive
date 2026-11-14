import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { CheckIcon, Spinner } from '../components/ui'
import { t } from '../i18n'

interface Checks {
  all_ok: boolean
  ffmpeg: { ok: boolean; version: string; path: string }
  ffprobe: { ok: boolean; version: string; path: string }
  storage: { ok: boolean; free_gb: number; path: string; writable: boolean }
  hardware: { ok: boolean; cores: number; ram_gb: number }
  python: { ok: boolean; version: string }
}

const STEP_LABELS = [
  'Vérification du système',
  'Compte administrateur',
  'Configuration de la chaîne',
  'Accès au serveur',
  'Installation terminée',
]

export default function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [checks, setChecks] = useState<Checks | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  // Step 2
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  // Step 3
  const [channelName, setChannelName] = useState('Ma Chaîne TV')
  const [timezone, setTimezone] = useState('Europe/Paris')
  const [timezones, setTimezones] = useState<string[]>([])

  // Step 4
  const [network, setNetwork] = useState<{ ips: string[]; url: string; hostname: string } | null>(null)

  useEffect(() => {
    if (step === 0) void runChecks()
    if (step === 2)
      api
        .get<{ timezones: string[]; suggested: string }>('/api/setup/timezones')
        .then((d) => {
          setTimezones(d.timezones)
          setTimezone(d.suggested)
        })
        .catch(() => {})
    if (step === 3)
      api
        .get<{ ips: string[]; url: string; hostname: string }>('/api/setup/network')
        .then(setNetwork)
        .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const runChecks = async () => {
    setChecking(true)
    setChecks(null)
    try {
      // Brief delay so the animated statuses are perceptible.
      const [data] = await Promise.all([
        api.get<Checks>('/api/setup/checks'),
        new Promise((r) => setTimeout(r, 700)),
      ])
      setChecks(data)
    } catch {
      setError('Impossible de lire les vérifications système.')
    } finally {
      setChecking(false)
    }
  }

  const next = () => setStep((s) => Math.min(s + 1, 4))
  const back = () => setStep((s) => Math.max(s - 1, 0))

  const submitAdmin = async () => {
    setError('')
    if (password.length < 8) return setError('Le mot de passe doit contenir au moins 8 caractères.')
    if (password !== confirm) return setError('Les mots de passe ne correspondent pas.')
    try {
      await api.post('/api/setup/admin', { username, password })
      next()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur')
    }
  }

  const submitChannel = async () => {
    setError('')
    if (!channelName.trim()) return setError('Indiquez un nom de chaîne.')
    try {
      await api.post('/api/setup/channel', { channel_name: channelName, timezone, language: 'fr' })
      next()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur')
    }
  }

  const finish = async () => {
    setError('')
    try {
      await api.post('/api/setup/finish')
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur')
    }
  }

  const checkRows = checks
    ? [
        { key: 'ffmpeg', label: 'FFmpeg', sub: checks.ffmpeg.version, ok: checks.ffmpeg.ok },
        { key: 'ffprobe', label: 'FFprobe', sub: checks.ffprobe.version, ok: checks.ffprobe.ok },
        {
          key: 'storage',
          label: 'Stockage',
          sub: `${checks.storage.free_gb} Go libres · ${checks.storage.path}`,
          ok: checks.storage.ok && checks.storage.writable,
        },
        {
          key: 'hardware',
          label: 'Matériel',
          sub: `${checks.hardware.cores} cœur(s) · ${checks.hardware.ram_gb} Go RAM`,
          ok: checks.hardware.ok,
        },
        { key: 'python', label: 'Python', sub: checks.python.version, ok: checks.python.ok },
      ]
    : []

  return (
    <div className="setup-wrap">
      <div className="setup-card">
        <div className="setup-steps">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className={`step-pip ${i < step ? 'done' : ''} ${i === step ? 'active' : ''}`}>
              <div className="line">
                <i />
              </div>
              <span className="text-sm" style={{ color: i <= step ? 'var(--text-1)' : 'var(--text-3)' }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        <div className="setup-body">
          {step === 0 && (
            <>
              <h2 className="mb-8">Vérification des prérequis</h2>
              <p className="muted mb-16">
                LocalLive vérifie les composants nécessaires à la diffusion 24/7.
              </p>
              {checking && (
                <div className="check-item">
                  <div className="check-icon pending">
                    <Spinner />
                  </div>
                  <div className="check-main">
                    <div className="check-title">Analyse du système…</div>
                    <div className="check-sub">Détection de FFmpeg, du stockage et du matériel</div>
                  </div>
                </div>
              )}
              {checkRows.map((row) => (
                <div className="check-item" key={row.key}>
                  <div className={`check-icon ${row.ok ? 'ok' : 'bad'}`}>
                    <CheckIcon ok={row.ok} />
                  </div>
                  <div className="check-main">
                    <div className="check-title">{row.label}</div>
                    <div className="check-sub truncate">{row.sub}</div>
                  </div>
                </div>
              ))}
              {checks && !checks.all_ok && (
                <div className="badge badge-warn mt-8">
                  Certains prérequis manquent — installez-les avant de continuer.
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="mb-8">Créer le compte administrateur</h2>
              <p className="muted mb-16">Ce compte protège l'accès à la régie.</p>
              <div className="field">
                <label>Nom d'utilisateur</label>
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="field">
                <label>Mot de passe</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <span className="hint">Au moins 8 caractères.</span>
              </div>
              <div className="field">
                <label>Confirmation</label>
                <input
                  className="input"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="mb-8">Configuration de la chaîne</h2>
              <p className="muted mb-16">Ces informations apparaîtront dans la régie.</p>
              <div className="field">
                <label>Nom de la chaîne</label>
                <input
                  className="input"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Fuseau horaire</label>
                <select className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {(timezones.length ? timezones : ['Europe/Paris', 'UTC']).map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
                <span className="hint">Utilisé pour la programmation quotidienne et hebdomadaire.</span>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="mb-8">Accès au serveur</h2>
              <p className="muted mb-16">Adresse à utiliser depuis vos navigateurs et encodeurs.</p>
              <div className="check-item">
                <div className="check-icon ok">
                  <CheckIcon ok />
                </div>
                <div className="check-main">
                  <div className="check-title">Nom d'hôte</div>
                  <div className="check-sub">{network?.hostname ?? '—'}</div>
                </div>
              </div>
              {(network?.ips ?? []).map((ip) => (
                <div className="check-item" key={ip}>
                  <div className="check-icon ok">
                    <CheckIcon ok />
                  </div>
                  <div className="check-main">
                    <div className="check-title mono">{ip}</div>
                    <div className="check-sub">Adresse IP détectée</div>
                  </div>
                </div>
              ))}
              <div className="field mt-16">
                <label>URL d'accès recommandée</label>
                <input className="input mono" readOnly value={network?.url ?? '—'} />
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div
                  className="check-icon ok"
                  style={{ width: 56, height: 56, margin: '0 auto 16px', borderRadius: 16 }}
                >
                  <CheckIcon ok />
                </div>
                <h2 className="mb-8">Installation terminée</h2>
                <p className="muted">
                  LocalLive est prêt. Connectez-vous pour gérer vos médias, playlists et la diffusion.
                </p>
              </div>
            </>
          )}

          {error && <div className="field"><span className="error">{error}</span></div>}
        </div>

        <div className="setup-foot">
          <button className="btn" onClick={back} disabled={step === 0}>
            {t('common.back')}
          </button>
          <div className="flex gap-8">
            {step === 0 && (
              <button className="btn btn-primary" onClick={next} disabled={checking || !checks}>
                {t('common.next')}
              </button>
            )}
            {step === 1 && (
              <button className="btn btn-primary" onClick={submitAdmin}>
                {t('common.next')}
              </button>
            )}
            {step === 2 && (
              <button className="btn btn-primary" onClick={submitChannel}>
                {t('common.next')}
              </button>
            )}
            {step === 3 && (
              <button className="btn btn-primary" onClick={next}>
                {t('common.next')}
              </button>
            )}
            {step === 4 && (
              <button className="btn btn-primary" onClick={finish}>
                {t('common.finish')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
