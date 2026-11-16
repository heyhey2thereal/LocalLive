import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'updating' | 'done' | 'error'>('idle')
  const [updateMsg, setUpdateMsg] = useState('')
  const [updateConsole, setUpdateConsole] = useState<string[]>([])
  const [updateCheck, setUpdateCheck] = useState<{ current: string; latest: string | null; update_available: boolean; repo: string; branch: string } | null>(null)
  const updateLogTimer = useRef<number | null>(null)
  const [configBusy, setConfigBusy] = useState(false)
  const configInput = useRef<HTMLInputElement>(null)

  // Export the configuration as a downloadable JSON file.
  const exportConfig = async () => {
    setConfigBusy(true)
    try {
      const data = await api.get<Record<string, unknown>>('/api/system/config/export')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `locallive-config-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      push({ kind: 'ok', title: 'Configuration exportée' })
    } catch (err: any) {
      push({ kind: 'err', title: 'Export impossible', message: err?.message })
    } finally {
      setConfigBusy(false)
    }
  }

  const importConfig = async (file: File) => {
    setConfigBusy(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const res = await api.post<{ counts: Record<string, number> }>('/api/system/config/import', { data })
      const total = Object.values(res.counts).reduce((a, b) => a + b, 0)
      push({ kind: 'ok', title: 'Configuration importée', message: `${total} élément(s) ajouté(s).` })
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Import impossible', message: err?.message })
    } finally {
      setConfigBusy(false)
      if (configInput.current) configInput.current.value = ''
    }
  }

  const checkUpdate = useCallback(async () => {
    try {
      const data = await api.get<{ current: string; latest: string | null; update_available: boolean; repo: string; branch: string }>(
        '/api/system/update/check',
      )
      setUpdateCheck(data)
    } catch {
      /* ignore */
    }
  }, [])

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
    void checkUpdate()
  }, [push, checkUpdate])

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

  // Poll the update console log while an update runs, so the operator can watch
  // every step (git pull, code copy, pip, npm build, service restart).
  const startUpdateLogPolling = useCallback(() => {
    const fetchLog = async () => {
      try {
        const data = await api.get<{ lines: string[] }>('/api/system/update/log?lines=400')
        setUpdateConsole(data.lines ?? [])
      } catch {
        /* the service is restarting; keep the last lines we have */
      }
    }
    void fetchLog()
    if (updateLogTimer.current) window.clearInterval(updateLogTimer.current)
    updateLogTimer.current = window.setInterval(fetchLog, 2000)
  }, [])

  const stopUpdateLogPolling = useCallback(() => {
    if (updateLogTimer.current) {
      window.clearInterval(updateLogTimer.current)
      updateLogTimer.current = null
    }
  }, [])

  useEffect(() => () => stopUpdateLogPolling(), [stopUpdateLogPolling])

  // Wait for the service to come back after a background update, then reload.
  // The update restarts the service, so its API is briefly unavailable. We only
  // reload once the service has actually gone down and come back (or its version
  // changed), otherwise we would reload while the *old* instance is still up.
  const waitForRestart = async (previousVersion: string | undefined) => {
    const deadline = Date.now() + 15 * 60 * 1000 // 15 minutes max (npm build can be slow)
    let sawDown = false
    // Give the updater a moment to start stopping the service before probing.
    await new Promise((r) => setTimeout(r, 3000))
    while (Date.now() < deadline) {
      try {
        const health = await api.get<{ status: string; version: string }>('/api/health')
        if (health?.status === 'ok') {
          const versionChanged = previousVersion && health.version !== previousVersion
          if (sawDown || versionChanged) {
            stopUpdateLogPolling()
            setUpdateState('done')
            setUpdateMsg(
              versionChanged
                ? `Mise à jour vers la version ${health.version} terminée. Rechargement…`
                : 'Service redémarré. Rechargement…',
            )
            await new Promise((r) => setTimeout(r, 1500))
            window.location.reload()
            return
          }
          // Still the old instance (the updater has not stopped it yet).
        }
      } catch {
        sawDown = true
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
    stopUpdateLogPolling()
    setUpdateState('done')
    setUpdateMsg('Mise à jour lancée. Rechargez la page dans quelques instants.')
  }

  const runUpdate = async () => {
    setUpdateState('checking')
    setUpdateMsg('Vérification…')
    setUpdateConsole([])
    // Ask the backend to run the configured update command. The service usually
    // runs unprivileged and cannot update itself, so when no command is set (or
    // it fails) we show the exact shell commands to run on the host.
    try {
      const previousVersion = version?.version
      const res = await api.post<{
        ok: boolean
        manual?: boolean
        detached?: boolean
        hint?: string
        error?: string
        output?: string
      }>('/api/system/update', {})
      if (res.ok) {
        setUpdateState('updating')
        setUpdateMsg('Mise à jour appliquée. Redémarrage du service…')
        if (res.detached) {
          // The helper runs in the background (it stops/restarts the service).
          setUpdateMsg('Mise à jour en cours… Le service va redémarrer.')
          startUpdateLogPolling()
          await waitForRestart(previousVersion)
          return
        }
        // Synchronous success (rare): show its output, then reload.
        if (res.output) setUpdateConsole(res.output.split('\n'))
        stopUpdateLogPolling()
        await new Promise((r) => setTimeout(r, 1500))
        window.location.reload()
        return
      }
      // Failure: keep the modal open and show the console output (or the hint).
      stopUpdateLogPolling()
      if (res.error) setUpdateConsole(res.error.split('\n'))
      setUpdateState('error')
      setUpdateMsg(
        res.manual
          ? res.hint ?? 'Mise à jour manuelle requise. Lancez update.sh sur le serveur.'
          : res.hint ?? 'La mise à jour a échoué. Consultez la console ci-dessous.',
      )
    } catch (err: any) {
      stopUpdateLogPolling()
      setUpdateState('error')
      setUpdateMsg(err?.message ?? 'Mise à jour impossible')
    }
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
              {updateCheck && (
                <span className={`badge ${updateCheck.update_available ? 'badge-warn' : 'badge-ok'}`}>
                  {updateCheck.update_available ? 'Mise à jour disponible' : 'À jour'}
                </span>
              )}
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
            <p className="text-sm muted-2 mb-8">
              {updateCheck?.repo
                ? `Source de mise à jour configurée sur le serveur (${updateCheck.repo} · ${updateCheck.branch}).`
                : "Aucune source de mise à jour configurée sur le serveur : relancez install.sh pour la définir."}
            </p>
            <div className="flex gap-8">
              <button className="btn btn-ghost" onClick={checkUpdate}>
                <IconRefresh size={15} /> Vérifier
              </button>
              <button
                className={`btn ${updateCheck?.update_available ? 'btn-primary' : ''}`}
                onClick={() => { setUpdateOpen(true); setUpdateState('idle'); setUpdateConsole([]) }}
              >
                <IconZap size={15} /> Mettre à jour
              </button>
            </div>
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

          <div className="card mb-16">
            <div className="card-head">
              <span className="card-title">Sauvegarde de la configuration</span>
            </div>
            <p className="text-sm muted mb-8">
              Exporte scènes, playlists, flux, programmes et réglages dans un fichier
              JSON. Les médias ne sont pas inclus (trop volumineux). L'import ajoute
              le contenu au serveur.
            </p>
            <div className="flex gap-8">
              <button className="btn" onClick={() => void exportConfig()} disabled={configBusy}>
                Exporter (.json)
              </button>
              <button className="btn" onClick={() => configInput.current?.click()} disabled={configBusy}>
                Importer un fichier
              </button>
              <input
                ref={configInput}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => e.target.files?.[0] && void importConfig(e.target.files[0])}
              />
            </div>
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
          wide
          onClose={() => {
            if (updateState === 'updating' || updateState === 'checking') return
            stopUpdateLogPolling()
            setUpdateOpen(false)
          }}
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
            ) : updateState === 'error' ? (
              <>
                <button
                  className="btn"
                  onClick={() => {
                    stopUpdateLogPolling()
                    setUpdateOpen(false)
                  }}
                >
                  Fermer
                </button>
                <button className="btn btn-primary" onClick={runUpdate}>
                  <IconZap size={15} /> Réessayer
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
              {updateState !== 'error' && (
                <div className="update-spinner">
                  <Spinner large />
                </div>
              )}
              <div>{updateMsg}</div>
              <div className="update-bar">
                <span
                  style={{
                    width:
                      updateState === 'checking'
                        ? '20%'
                        : updateState === 'updating'
                          ? '75%'
                          : '100%',
                    background: updateState === 'error' ? 'var(--red)' : undefined,
                  }}
                />
              </div>
            </div>
          )}
          {/* Console output of the update (git pull, code copy, pip, npm build,
              service restart). Kept visible while running and on failure. */}
          {updateState !== 'idle' && (
            <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
              <label>Console de mise à jour</label>
              <pre
                className="mono update-console"
                style={{
                  maxHeight: 320,
                  overflow: 'auto',
                  margin: 0,
                  padding: '10px 12px',
                  background: 'var(--bg-3)',
                  border: '1px solid var(--line-soft)',
                  borderRadius: 8,
                  color: 'var(--text-2)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {updateConsole.length > 0 ? updateConsole.join('\n') : 'En attente de la sortie de la mise à jour…'}
              </pre>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
