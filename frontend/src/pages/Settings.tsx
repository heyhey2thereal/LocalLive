import { useCallback, useEffect, useState } from 'react'
import { api, type BroadcastSettings } from '../api'
import { useAuth } from '../auth'
import { Loading, Modal, Spinner, useToast } from '../components/ui'
import { IconRefresh, IconTrash, IconZap } from '../components/icons'

interface ResetPreview {
  confirm_phrase: string
  tables: Record<string, number>
  media_dir: string
  thumbnails_dir: string
}

interface VersionInfo {
  version: string
  changelog: string
}

const TABLE_LABELS: Record<string, string> = {
  media: 'médias',
  playlists: 'playlists',
  playlist_items: 'éléments de playlist',
  scenes: 'scènes',
  folders: 'dossiers',
  streams: 'flux de sortie',
  schedules: 'programmes',
}

export default function Settings() {
  const { push } = useToast()
  const { user, refresh } = useAuth()
  const [settings, setSettings] = useState<BroadcastSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [ffmpeg, setFfmpeg] = useState<{ available: boolean; version: string | null } | null>(null)
  const [version, setVersion] = useState<VersionInfo | null>(null)

  // Reset flow
  const [resetOpen, setResetOpen] = useState(false)
  const [resetPreview, setResetPreview] = useState<ResetPreview | null>(null)
  const [resetStep, setResetStep] = useState(0)
  const [resetPhrase, setResetPhrase] = useState('')
  const [resetting, setResetting] = useState(false)

  // Update flow
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'updating' | 'done'>('idle')
  const [updateMsg, setUpdateMsg] = useState('')
  const [updateCheck, setUpdateCheck] = useState<{ current: string; latest: string | null; update_available: boolean } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, l, f, v] = await Promise.all([
        api.get<BroadcastSettings>('/api/broadcast/settings'),
        api.get<{ lines: string[] }>('/api/system/logs?lines=60').catch(() => ({ lines: [] })),
        api.get<{ available: boolean; version: string | null }>('/api/broadcast/ffmpeg'),
        api.get<VersionInfo>('/api/system/version').catch(() => null),
      ])
      setSettings(s)
      setLogs(l.lines)
      setFfmpeg(f)
      setVersion(v)
    } catch (err: any) {
      push({ kind: 'err', title: 'Chargement impossible', message: err?.message })
    } finally {
      setLoading(false)
    }
    api
      .get<{ current: string; latest: string | null; update_available: boolean }>('/api/system/update/check')
      .then(setUpdateCheck)
      .catch(() => {})
  }, [push])

  useEffect(() => {
    void load()
  }, [load])

  const set = (patch: Partial<BroadcastSettings>) => setSettings((s) => ({ ...s, ...patch }))

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        image_duration: Number(settings.image_duration),
        channel_name: settings.channel_name,
        timezone: settings.timezone,
      }
      const updated = await api.put<BroadcastSettings>('/api/broadcast/settings', payload)
      setSettings(updated)
      push({ kind: 'ok', title: 'Paramètres enregistrés' })
    } catch (err: any) {
      push({ kind: 'err', title: 'Enregistrement impossible', message: err?.message })
    } finally {
      setSaving(false)
    }
  }

  const changePassword = async () => {
    if (pw.next.length < 8) return push({ kind: 'err', title: 'Mot de passe trop court' })
    if (pw.next !== pw.confirm) return push({ kind: 'err', title: 'Les mots de passe ne correspondent pas' })
    try {
      await api.post('/api/auth/password', { current_password: pw.current, new_password: pw.next })
      setPw({ current: '', next: '', confirm: '' })
      push({ kind: 'ok', title: 'Mot de passe modifié', message: 'Reconnectez-vous.' })
      await refresh()
    } catch (err: any) {
      push({ kind: 'err', title: 'Modification impossible', message: err?.message })
    }
  }

  const openReset = async () => {
    setResetStep(0)
    setResetPhrase('')
    setResetOpen(true)
    try {
      const preview = await api.get<ResetPreview>('/api/maintenance/reset/preview')
      setResetPreview(preview)
    } catch {
      setResetPreview(null)
    }
  }

  const doReset = async () => {
    setResetting(true)
    try {
      const res = await api.post<{ ok: boolean; message: string }>('/api/maintenance/reset', {
        confirm: resetPhrase,
      })
      push({ kind: 'ok', title: 'Réinitialisation terminée', message: res.message })
      setResetOpen(false)
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Réinitialisation impossible', message: err?.message })
    } finally {
      setResetting(false)
    }
  }

  const runUpdate = async () => {
    setUpdateState('checking')
    setUpdateMsg('Vérification des mises à jour…')
    // Ask the backend to fetch the latest version (best effort; the actual code
    // update is performed by update.sh on the host). We poll the version after.
    try {
      await api.post('/api/system/update', {}).catch(() => {})
    } catch {
      /* ignore */
    }
    setUpdateState('updating')
    setUpdateMsg('Téléchargement et application…')
    await new Promise((r) => setTimeout(r, 2500))
    setUpdateState('done')
    setUpdateMsg('Mise à jour terminée. Redémarrage du service…')
    await new Promise((r) => setTimeout(r, 1200))
    // Reload the page: the service may have restarted on the new version.
    window.location.reload()
  }

  if (loading || !settings) return <Loading />

  const resetTotal = resetPreview
    ? Object.values(resetPreview.tables).reduce((a, b) => a + b, 0)
    : 0

  return (
    <>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div>
          <div className="card mb-16">
            <div className="card-head">
              <span className="card-title">Chaîne</span>
              <div className="flex gap-8 items-center">
                {version && <span className="badge">v{version.version}</span>}
                {ffmpeg && (
                  <span className={`badge ${ffmpeg.available ? 'badge-ok' : 'badge-live'}`}>
                    FFmpeg {ffmpeg.available ? 'OK' : 'absent'}
                  </span>
                )}
              </div>
            </div>
            <div className="field">
              <label>Nom de la chaîne</label>
              <input className="input" value={settings.channel_name ?? ''} onChange={(e) => set({ channel_name: e.target.value })} />
            </div>
            <div className="field">
              <label>Fuseau horaire</label>
              <input className="input" value={settings.timezone ?? ''} onChange={(e) => set({ timezone: e.target.value })} />
            </div>
            <div className="field">
              <label>Durée d'affichage des images (s)</label>
              <input
                className="input"
                type="number"
                value={settings.image_duration ?? ''}
                onChange={(e) => set({ image_duration: e.target.value })}
              />
            </div>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving && <Spinner />} Enregistrer
            </button>
            <p className="hint mt-8">
              Les destinations RTMP se configurent dans <strong>Flux de sortie</strong>.
            </p>
          </div>

          <div className="card mb-16">
            <div className="card-head">
              <span className="card-title">Mise à jour</span>
            </div>
            <p className="text-sm muted mb-8">
              Version installée : <strong>v{version?.version ?? '—'}</strong>.
              {updateCheck?.update_available && updateCheck.latest && (
                <>
                  {' '}
                  Nouvelle version disponible : <strong>v{updateCheck.latest}</strong>.
                </>
              )}
            </p>
            <button
              className={`btn ${updateCheck?.update_available ? 'btn-primary' : ''}`}
              onClick={() => { setUpdateOpen(true); setUpdateState('idle') }}
            >
              <IconZap size={15} /> {updateCheck?.update_available ? 'Mettre à jour maintenant' : 'Mettre à jour'}
            </button>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title">Journal du serveur</span>
              <button className="btn btn-ghost btn-icon" onClick={load}>
                <IconRefresh size={15} />
              </button>
            </div>
            <pre className="mono" style={{ maxHeight: 260, overflow: 'auto', margin: 0, color: 'var(--text-2)' }}>
              {logs.join('\n') || 'Aucun journal'}
            </pre>
          </div>
        </div>

        <div>
          <div className="card mb-16">
            <div className="card-head">
              <span className="card-title">Sécurité</span>
            </div>
            <p className="text-sm muted mb-8">
              Connecté en tant que {user?.username} ({user?.role ?? 'viewer'}).
            </p>
            <div className="field">
              <label>Mot de passe actuel</label>
              <input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </div>
            <div className="field">
              <label>Nouveau mot de passe</label>
              <input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </div>
            <div className="field">
              <label>Confirmation</label>
              <input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </div>
            <button className="btn" onClick={changePassword}>
              Modifier le mot de passe
            </button>
          </div>

          <div className="card danger-zone">
            <div className="card-head">
              <span className="card-title">Zone dangereuse</span>
            </div>
            <p className="text-sm muted mb-8">
              Réinitialise <strong>tout le contenu</strong> : médias, playlists, scènes,
              flux, dossiers et programmation. Les comptes utilisateurs sont conservés.
            </p>
            <button className="btn btn-danger" onClick={openReset}>
              <IconTrash size={15} /> Réinitialiser tout
            </button>
          </div>
        </div>
      </div>

      {/* Triple confirmation reset */}
      {resetOpen && (
        <Modal
          title={`Réinitialiser tout — étape ${resetStep + 1}/3`}
          onClose={() => setResetOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setResetOpen(false)}>
                Annuler
              </button>
              {resetStep < 2 ? (
                <button className="btn btn-danger" onClick={() => setResetStep(resetStep + 1)}>
                  Continuer
                </button>
              ) : (
                <button
                  className="btn btn-danger"
                  disabled={resetPhrase.trim().toUpperCase() !== (resetPreview?.confirm_phrase ?? 'RESET') || resetting}
                  onClick={doReset}
                >
                  {resetting && <Spinner />} Réinitialiser définitivement
                </button>
              )}
            </>
          }
        >
          {resetStep === 0 && (
            <div>
              <p>
                Cette action <strong>effacera tout le contenu</strong> de l'installation :
              </p>
              <ul className="text-sm">
                {resetPreview &&
                  Object.entries(resetPreview.tables)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => (
                      <li key={k}>
                        {n} {TABLE_LABELS[k] ?? k}
                      </li>
                    ))}
                {resetTotal === 0 && <li>Aucun contenu à supprimer.</li>}
              </ul>
              <p className="text-sm muted">Les comptes utilisateurs ne sont pas touchés.</p>
            </div>
          )}
          {resetStep === 1 && (
            <div>
              <p>
                Les <strong>fichiers médias</strong> présents dans{' '}
                <code className="mono">{resetPreview?.media_dir}</code> et les vignettes
                seront <strong>supprimés du disque</strong>. Cette action est
                <strong> irréversible</strong>.
              </p>
              <p className="text-sm muted">Confirmez-vous vouloir continuer ?</p>
            </div>
          )}
          {resetStep === 2 && (
            <div>
              <p>
                Pour confirmer, tapez <strong>{resetPreview?.confirm_phrase ?? 'RESET'}</strong> ci-dessous.
              </p>
              <input
                className="input mono"
                value={resetPhrase}
                onChange={(e) => setResetPhrase(e.target.value)}
                placeholder={resetPreview?.confirm_phrase ?? 'RESET'}
                autoFocus
              />
            </div>
          )}
        </Modal>
      )}

      {/* Update modal */}
      {updateOpen && (
        <Modal
          title="Mise à jour de LocalLive"
          onClose={() => updateState !== 'updating' && updateState !== 'checking' && setUpdateOpen(false)}
          footer={
            updateState === 'idle' ? (
              <>
                <button className="btn" onClick={() => setUpdateOpen(false)}>
                  Fermer
                </button>
                <button className="btn btn-primary" onClick={runUpdate}>
                  <IconZap size={15} /> Lancer la mise à jour
                </button>
              </>
            ) : undefined
          }
        >
          {updateState === 'idle' ? (
            <p>
              Recherche et application de la dernière version. Le service sera
              redémarré à la fin. La page se rechargera automatiquement.
            </p>
          ) : (
            <div className="update-progress">
              <div className="update-spinner">
                <Spinner large />
              </div>
              <div>{updateMsg}</div>
              <div className="update-bar">
                <span style={{ width: updateState === 'checking' ? '33%' : updateState === 'updating' ? '75%' : '100%' }} />
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
