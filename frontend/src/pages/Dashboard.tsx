import { useCallback, useEffect, useState } from 'react'
import { api, type BroadcastStatus, type Playlist } from '../api'
import { usePoll } from '../lib/usePoll'
import { useToast } from '../components/ui'
import {
  IconCpu,
  IconDisk,
  IconPlay,
  IconRam,
  IconRefresh,
  IconSignal,
  IconStop,
} from '../components/icons'
import { EmptyState, formatBytes, formatDuration, formatUptime, Loading } from '../components/ui'

function MetricBar({ percent }: { percent: number }) {
  const cls = percent >= 90 ? 'crit' : percent >= 70 ? 'warn' : 'ok'
  return (
    <div className={`bar ${cls}`}>
      <span style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  )
}

export default function Dashboard() {
  const { push } = useToast()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selected, setSelected] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)

  // Poll the full status: it carries the engine state, the system metrics and
  // the fallback playlist name that the panel below displays. usePoll keeps the
  // requests from overlapping and pauses while the tab is hidden.
  const poll = usePoll<BroadcastStatus>(
    (signal) => api.get<BroadcastStatus>('/api/broadcast/status', signal),
    2000,
  )
  const status = poll.data

  const loadPlaylists = useCallback(async () => {
    try {
      const data = await api.get<{ items: Playlist[] }>('/api/playlists')
      setPlaylists(data.items)
      setSelected((prev) => prev || data.items[0]?.id || '')
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void loadPlaylists()
  }, [loadPlaylists])

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true)
    try {
      await fn()
      push({ kind: 'ok', title: okMsg })
      poll.refresh()
    } catch (err: any) {
      push({ kind: 'err', title: 'Action impossible', message: err?.message ?? '' })
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <Loading />

  const engine = status.engine
  const sys = status.system
  const current = engine.current
  const next = engine.next
  const progress =
    engine.cycle_duration > 0
      ? Math.min((engine.position / engine.cycle_duration) * 100, 100)
      : 0
  const itemProgress =
    current && current.duration > 0
      ? Math.min(
          ((engine.position -
            engine.items.slice(0, engine.current_index).reduce((a, i) => a + i.duration, 0)) /
            current.duration) *
            100,
          100,
        )
      : 0

  const previewUrl = current?.stream_url ?? null
  const rtmpOk = engine.running && engine.output?.kind === 'rtmp'

  return (
    <>
      <div className="grid grid-4 mb-16" style={{ marginBottom: 18 }}>
        <MetricCard
          icon={<IconCpu size={18} />}
          label="Processeur"
          value={`${sys.cpu}`}
          unit="%"
          sub={`${sys.cpu_count} cœur(s) · charge ${sys.load[0]}`}
          percent={sys.cpu}
        />
        <MetricCard
          icon={<IconRam size={18} />}
          label="Mémoire"
          value={`${sys.memory.percent}`}
          unit="%"
          sub={`${formatBytes(sys.memory.used)} / ${formatBytes(sys.memory.total)}`}
          percent={sys.memory.percent}
        />
        <MetricCard
          icon={<IconDisk size={18} />}
          label="Stockage"
          value={`${sys.disk.percent}`}
          unit="%"
          sub={`${formatBytes(sys.disk.free)} libres`}
          percent={sys.disk.percent}
        />
        <MetricCard
          icon={<IconSignal size={18} />}
          label="Diffusion"
          value={engine.running ? 'EN DIRECT' : 'ARRÊT'}
          sub={engine.running ? formatUptime(engine.uptime) : 'Aucun flux actif'}
          tone={engine.running ? 'live' : 'off'}
        />
      </div>

      <div className="grid grid-2" style={{ gridTemplateColumns: '1.55fr 1fr' }}>
        <div className="card">
          <div className="card-head">
            <span className="card-title">Aperçu du programme</span>
            {engine.running && (
              <span className="badge badge-live">
                <span className="dot dot-live" /> EN DIRECT
              </span>
            )}
          </div>
          <div className="stage">
            {engine.running && previewUrl ? (
              current?.kind === 'image' ? (
                <img src={previewUrl} alt="aperçu" />
              ) : (
                <video src={previewUrl} muted autoPlay loop playsInline />
              )
            ) : (
              <div className="stage-empty">
                <IconSignal size={34} />
                <span>La diffusion est à l'arrêt</span>
              </div>
            )}
            {engine.running && (
              <div className="stage-live-tag">
                <span className="dot dot-live" /> {engine.pipeline === 'copy' ? 'COPIE DIRECTE' : 'ENCODAGE'}
              </div>
            )}
          </div>

          <div className="mt-16">
            <div className="flex justify-between items-center mb-8">
              <div className="truncate">
                <div className="text-sm muted-2">En cours</div>
                <div style={{ fontWeight: 600 }}>{current?.title ?? '—'}</div>
              </div>
              <div className="text-sm muted-2 nowrap">
                {formatDuration(engine.position)} / {formatDuration(engine.cycle_duration)}
              </div>
            </div>
            <div className="bar">
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="flex justify-between items-center mt-8">
              <span className="text-sm muted-2">
                Élément {engine.current_index + 1} / {engine.item_count} · {engine.playlist_name || '—'}
              </span>
              <span className="text-sm muted-2">
                {current ? `${Math.round(itemProgress)}% de l'élément` : ''}
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Commandes de diffusion</span>
            <button className="btn btn-ghost btn-icon" onClick={poll.refresh} title="Rafraîchir">
              <IconRefresh size={16} />
            </button>
          </div>

          <div className="field">
            <label>Playlist à diffuser</label>
            <select
              className="select"
              value={selected}
              onChange={(e) => setSelected(Number(e.target.value))}
              disabled={engine.running}
            >
              {playlists.length === 0 && <option value="">Aucune playlist</option>}
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.item_count} éléments)
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-8 mb-16">
            {!engine.running ? (
              <button
                className="btn btn-primary grow"
                disabled={busy || !selected}
                onClick={() => act(() => api.post('/api/broadcast/start', { playlist_id: selected }), 'Diffusion démarrée')}
              >
                <IconPlay size={16} /> Démarrer
              </button>
            ) : (
              <button
                className="btn btn-danger grow"
                disabled={busy}
                onClick={() => act(() => api.post('/api/broadcast/stop'), 'Diffusion arrêtée')}
              >
                <IconStop size={16} /> Arrêter
              </button>
            )}
            <button
              className="btn"
              disabled={busy || !engine.running}
              onClick={() => act(() => api.post('/api/broadcast/recover'), 'Diffusion relancée')}
              title="Relancer proprement le moteur"
            >
              <IconRefresh size={16} /> Récupérer
            </button>
          </div>

          <div className="list">
            <InfoRow label="État du moteur" value={engine.running ? 'Actif' : 'Arrêté'} ok={engine.running} />
            <InfoRow
              label="Pipeline"
              value={engine.pipeline === 'copy' ? 'Copie directe (sans réencodage)' : 'Encodage FFmpeg'}
            />
            <InfoRow label="Sortie" value={engine.output?.kind === 'rtmp' ? 'RTMP' : 'Fichier local'} />
            <InfoRow
              label="Connexion RTMP"
              value={rtmpOk ? 'Connectée' : engine.running ? 'Fichier local' : 'Inactive'}
              ok={rtmpOk}
            />
            <InfoRow label="Redémarrages" value={String(engine.restarts)} />
            <InfoRow
              label="Erreurs"
              value={String(engine.errors)}
              tone={engine.errors > 0 ? 'warn' : undefined}
            />
            <InfoRow label="Playlist de secours" value={status.fallback_playlist_name ?? '—'} />
          </div>

          {engine.last_error && (
            <div className="mt-16">
              <div className="text-sm muted-2 mb-8">Dernière erreur</div>
              <div className="mono" style={{ color: 'var(--red)', wordBreak: 'break-all' }}>
                {engine.last_error}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-2 mt-24">
        <div className="card">
          <div className="card-head">
            <span className="card-title">Élément suivant</span>
          </div>
          {next ? (
            <div className="row" style={{ background: 'transparent', border: 'none', padding: 0 }}>
              {next.thumbnail ? (
                <img className="row-thumb" src={next.thumbnail} alt="" />
              ) : (
                <div className="row-thumb" />
              )}
              <div className="row-main">
                <div className="row-title">{next.title}</div>
                <div className="row-sub">
                  {next.kind} · {formatDuration(next.duration)}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState title="Fin de la playlist" hint="Le cycle redémarrera automatiquement." />
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">Progression de la playlist</span>
          </div>
          <div className="list" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {engine.items.map((item, i) => (
              <div
                key={item.id}
                className="flex items-center gap-12"
                style={{
                  padding: '7px 10px',
                  borderRadius: 7,
                  background: i === engine.current_index ? 'var(--accent-soft)' : 'transparent',
                  border: `1px solid ${i === engine.current_index ? 'var(--accent-line)' : 'transparent'}`,
                }}
              >
                <span className="text-sm muted-2" style={{ width: 20 }}>
                  {i + 1}
                </span>
                <span className="truncate grow" style={{ fontSize: 13 }}>
                  {item.title}
                </span>
                <span className="text-sm muted-2 nowrap">{formatDuration(item.duration)}</span>
              </div>
            ))}
            {engine.items.length === 0 && <EmptyState title="Playlist vide" />}
          </div>
        </div>
      </div>

      {engine.log_tail.length > 0 && (
        <div className="card mt-24">
          <div className="card-head">
            <span className="card-title">Journal du moteur</span>
          </div>
          <pre
            className="mono"
            style={{
              maxHeight: 180,
              overflow: 'auto',
              margin: 0,
              color: 'var(--text-2)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {engine.log_tail.slice(-12).join('\n')}
          </pre>
        </div>
      )}
    </>
  )
}

function MetricCard({
  icon,
  label,
  value,
  unit,
  sub,
  percent,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  unit?: string
  sub: string
  percent?: number
  tone?: 'live' | 'off'
}) {
  return (
    <div className="card metric">
      <div className="metric-top">
        <span className="metric-label">{label}</span>
        <span style={{ color: 'var(--text-2)' }}>{icon}</span>
      </div>
      <div className="metric-value" style={tone === 'live' ? { color: 'var(--red)', fontSize: 20 } : undefined}>
        {value}
        {unit && <small> {unit}</small>}
      </div>
      {percent !== undefined && <MetricBar percent={percent} />}
      <div className="metric-sub truncate">{sub}</div>
    </div>
  )
}

function InfoRow({
  label,
  value,
  ok,
  tone,
}: {
  label: string
  value: string
  ok?: boolean
  tone?: 'warn'
}) {
  return (
    <div className="flex justify-between items-center" style={{ padding: '4px 0' }}>
      <span className="text-sm muted-2">{label}</span>
      <span className="flex items-center gap-8">
        {ok !== undefined && <span className={`dot ${ok ? 'dot-ok' : ''}`} />}
        <span
          className="text-sm"
          style={{ color: tone === 'warn' ? 'var(--accent)' : 'var(--text-0)' }}
        >
          {value}
        </span>
      </span>
    </div>
  )
}
