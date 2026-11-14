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
  const [streamKey, setStreamKey] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
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
        stream_rtmp_url: settings.stream_rtmp_url,
        stream_width: Number(settings.stream_width),
        stream_height: Number(settings.stream_height),
        stream_fps: Number(settings.stream_fps),
        stream_bitrate: Number(settings.stream_bitrate),
        stream_audio_bitrate: Number(settings.stream_audio_bitrate),
        stream_preset: settings.stream_preset,
        output_kind: settings.output_kind,
        output_file: settings.output_file,
        image_duration: Number(settings.image_duration),
        channel_name: settings.channel_name,
        timezone: settings.timezone,
      }
      if (streamKey) payload.stream_key = streamKey
      const updated = await api.put<BroadcastSettings>('/api/broadcast/settings', payload)
      setSettings(updated)
      setStreamKey('')
      push({ kind: 'ok', title: 'Paramètres enregistrés' })
    } catch (err: any) {
      push({ kind: 'err', title: 'Enregistrement impossible', message: err?.message })
    } finally {
      setSaving(false)
    }
  }

  const testRtmp = async () => {
    setTesting(true)
    try {
      const res = await api.post<{ ok: boolean; message?: string; error?: string }>(
        '/api/broadcast/test-rtmp',
        {},
      )
      push(
        res.ok
          ? { kind: 'ok', title: 'Connexion RTMP réussie' }
          : { kind: 'err', title: 'Échec RTMP', message: res.error },
      )
    } catch (err: any) {
      push({ kind: 'err', title: 'Test impossible', message: err?.message })
    } finally {
      setTesting(false)
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
        <div className="card">
          <div className="card-head">
            <span className="card-title">Diffusion RTMP</span>
            {ffmpeg && (
              <span className={`badge ${ffmpeg.available ? 'badge-ok' : 'badge-live'}`}>
                FFmpeg {ffmpeg.available ? 'OK' : 'absent'}
              </span>
            )}
          </div>

          <div className="field">
            <label>URL du serveur RTMP</label>
            <input
              className="input mono"
              value={settings.stream_rtmp_url ?? ''}
              onChange={(e) => set({ stream_rtmp_url: e.target.value })}
              placeholder="rtmp://a.rtmp.youtube.com/live2"
            />
            <span className="hint">YouTube Live, Facebook, Twitch ou votre propre serveur.</span>
          </div>

          <div className="field">
            <label>Clé de flux</label>
            <input
              className="input mono"
              type="password"
              value={streamKey}
              onChange={(e) => setStreamKey(e.target.value)}
              placeholder={settings.has_stream_key ? settings.stream_key_masked : 'Clé de diffusion'}
            />
            <span className="hint">
              {settings.has_stream_key
                ? 'Une clé est enregistrée. Laissez vide pour la conserver.'
                : 'Jamais affichée en clair.'}
            </span>
          </div>

          <div className="field">
            <label>Type de sortie</label>
            <select
              className="select"
              value={settings.output_kind ?? 'rtmp'}
              onChange={(e) => set({ output_kind: e.target.value })}
            >
              <option value="rtmp">RTMP (YouTube Live, etc.)</option>
              <option value="file">Fichier local (test)</option>
            </select>
          </div>

          {settings.output_kind === 'file' && (
            <div className="field">
              <label>Chemin du fichier</label>
              <input
                className="input mono"
                value={settings.output_file ?? ''}
                onChange={(e) => set({ output_file: e.target.value })}
              />
            </div>
          )}

          <div className="grid grid-3">
            <div className="field">
              <label>Largeur</label>
              <input
                className="input"
                type="number"
                value={settings.stream_width ?? ''}
                onChange={(e) => set({ stream_width: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Hauteur</label>
              <input
                className="input"
                type="number"
                value={settings.stream_height ?? ''}
                onChange={(e) => set({ stream_height: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Images/s</label>
              <input
                className="input"
                type="number"
                value={settings.stream_fps ?? ''}
                onChange={(e) => set({ stream_fps: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-3">
            <div className="field">
              <label>Débit vidéo (kbps)</label>
              <input
                className="input"
                type="number"
                value={settings.stream_bitrate ?? ''}
                onChange={(e) => set({ stream_bitrate: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Débit audio (kbps)</label>
              <input
                className="input"
                type="number"
                value={settings.stream_audio_bitrate ?? ''}
                onChange={(e) => set({ stream_audio_bitrate: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Préréglage</label>
              <select
                className="select"
                value={settings.stream_preset ?? 'veryfast'}
                onChange={(e) => set({ stream_preset: e.target.value })}
              >
                {['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-8">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving && <Spinner />} Enregistrer
            </button>
            <button className="btn" onClick={testRtmp} disabled={testing}>
              {testing ? <Spinner /> : <IconRefresh size={15} />} Tester la connexion RTMP
            </button>
          </div>

          <div className="mt-16">
            <button className="btn btn-sm" onClick={() => set({ stream_width: '854', stream_height: '480', stream_fps: '25', stream_bitrate: '1200', stream_preset: 'veryfast' })}>
              Préréglage basse consommation (480p / 25 i/s)
            </button>
          </div>
        </div>

        <div>
          <div className="card mb-16">
            <div className="card-head">
              <span className="card-title">Chaîne</span>
            </div>
            <div className="field">
              <label>Nom de la chaîne</label>
              <input
                className="input"
                value={settings.channel_name ?? ''}
                onChange={(e) => set({ channel_name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Fuseau horaire</label>
              <input
                className="input"
                value={settings.timezone ?? ''}
                onChange={(e) => set({ timezone: e.target.value })}
              />
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
          </div>

          <div className="card mb-16">
            <div className="card-head">
              <span className="card-title">Sécurité</span>
            </div>
            <p className="text-sm muted mb-8">Connecté en tant que {user?.username}.</p>
            <div className="field">
              <label>Mot de passe actuel</label>
              <input
                className="input"
                type="password"
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Nouveau mot de passe</label>
              <input
                className="input"
                type="password"
                value={pw.next}
                onChange={(e) => setPw({ ...pw, next: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Confirmation</label>
              <input
                className="input"
                type="password"
                value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              />
            </div>
            <button className="btn" onClick={changePassword}>
              Modifier le mot de passe
            </button>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title">Journal du serveur</span>
              <button className="btn btn-ghost btn-icon" onClick={load}>
                <IconRefresh size={15} />
              </button>
            </div>
            <pre
              className="mono"
              style={{ maxHeight: 260, overflow: 'auto', margin: 0, color: 'var(--text-2)' }}
            >
              {logs.join('\n') || 'Aucun journal'}
            </pre>
          </div>
        </div>
      </div>
    </>
  )
}
