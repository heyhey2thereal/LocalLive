import { useCallback, useEffect, useState } from 'react'
import { api, type BroadcastSettings } from '../api'
import { useAuth } from '../auth'
import { Loading, Spinner, useToast } from '../components/ui'
import { IconRefresh } from '../components/icons'

export default function Settings() {
  const { push } = useToast()
  const { user, refresh } = useAuth()
  const [settings, setSettings] = useState<BroadcastSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [ffmpeg, setFfmpeg] = useState<{ available: boolean; version: string | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, l, f] = await Promise.all([
        api.get<BroadcastSettings>('/api/broadcast/settings'),
        api.get<{ lines: string[] }>('/api/system/logs?lines=60').catch(() => ({ lines: [] })),
        api.get<{ available: boolean; version: string | null }>('/api/broadcast/ffmpeg'),
      ])
      setSettings(s)
      setLogs(l.lines)
      setFfmpeg(f)
    } catch (err: any) {
      push({ kind: 'err', title: 'Chargement impossible', message: err?.message })
    } finally {
      setLoading(false)
    }
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

  if (loading || !settings) return <Loading />

  return (
    <>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div>
          <div className="card mb-16">
            <div className="card-head">
              <span className="card-title">Chaîne</span>
              {ffmpeg && (
                <span className={`badge ${ffmpeg.available ? 'badge-ok' : 'badge-live'}`}>
                  FFmpeg {ffmpeg.available ? 'OK' : 'absent'}
                </span>
              )}
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

          <div className="card">
            <div className="card-head">
              <span className="card-title">Journal du serveur</span>
              <button className="btn btn-ghost btn-icon" onClick={load}>
                <IconRefresh size={15} />
              </button>
            </div>
            <pre className="mono" style={{ maxHeight: 300, overflow: 'auto', margin: 0, color: 'var(--text-2)' }}>
              {logs.join('\n') || 'Aucun journal'}
            </pre>
          </div>
        </div>

        <div className="card">
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
      </div>
    </>
  )
}
