// Preview / Program switcher.
//
// Two identical monitors: PREVIEW (left) and PROGRAM (right). The arrow between
// them takes the preview to air and swaps the two (the old program becomes the
// preview). A transition style is chosen below and is played as a visual effect
// on the monitors when you take. There is also a single live start/stop button.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Catalog, type EngineItem, type Playlist, type PreviewData } from '../api'
import { usePoll } from '../lib/usePoll'
import ProgramPreview from '../components/ProgramPreview'
import { formatDuration, Loading, useToast } from '../components/ui'
import { IconArrowRight, IconPlay, IconStop } from '../components/icons'

// Map a transition id to a CSS animation class used to animate the monitors.
function transitionClass(id: string): string {
  if (id === 'cut') return ''
  if (id.startsWith('slide') || id.startsWith('cover') || id.startsWith('reveal')) return 'tx-slide'
  if (id.startsWith('wipe') || id.startsWith('smooth')) return 'tx-wipe'
  if (id === 'circleopen' || id === 'circleclose' || id === 'circlecrop') return 'tx-circle'
  if (id === 'zoomin' || id === 'squeezeh' || id === 'squeezev') return 'tx-zoom'
  if (id === 'pixelize' || id === 'hblur') return 'tx-blur'
  return 'tx-fade'
}

export default function PreviewProgram() {
  const { push } = useToast()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedId, setSelectedId] = useState<number | ''>('')
  const [transition, setTransition] = useState('fade')
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [busy, setBusy] = useState(false)
  const [txClass, setTxClass] = useState('')
  const txTimer = useRef<number | null>(null)

  // Fast polling so preview/program react quickly (no perceptible delay).
  const poll = usePoll<PreviewData>(
    (signal) =>
      api.get<PreviewData>(
        '/api/broadcast/preview' + (selectedId ? `?playlist_id=${selectedId}` : ''),
        signal,
      ),
    1000,
  )

  const loadPlaylists = useCallback(async () => {
    try {
      const [data, cat] = await Promise.all([
        api.get<{ items: Playlist[] }>('/api/playlists'),
        api.get<Catalog>('/api/meta/catalog').catch(() => null),
      ])
      setPlaylists(data.items)
      setCatalog(cat)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void loadPlaylists()
  }, [loadPlaylists])

  const program = poll.data?.program
  const preview = poll.data?.preview

  // Periodically refresh the rendered content so scene edits appear live.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 2000)
    return () => window.clearInterval(t)
  }, [])
  const reloadKey = `${program?.playlist_id ?? ''}-${preview?.playlist_id ?? ''}-${tick}`

  const previewItem: EngineItem | null = preview?.items[0] ?? null
  const programItem: EngineItem | null = program?.current ?? null
  const target = selectedId || preview?.playlist_id || null
  const running = Boolean(program?.running)

  const playTransition = () => {
    const cls = transitionClass(transition)
    setTxClass(cls)
    if (txTimer.current) window.clearTimeout(txTimer.current)
    txTimer.current = window.setTimeout(() => setTxClass(''), 900)
  }

  // Take the preview to air, then swap preview/program.
  const swap = async () => {
    if (!target) {
      push({ kind: 'err', title: 'Choisissez d’abord une playlist dans l’aperçu' })
      return
    }
    setBusy(true)
    const previousProgram = program?.playlist_id ?? null
    playTransition()
    try {
      await api.post('/api/broadcast/take', { playlist_id: target })
      push({ kind: 'ok', title: 'Prise d’antenne effectuée' })
      setSelectedId(previousProgram ?? '')
      poll.refresh()
    } catch (err: any) {
      push({ kind: 'err', title: 'Prise d’antenne impossible', message: err?.message })
    } finally {
      setBusy(false)
    }
  }

  const toggleLive = async () => {
    setBusy(true)
    try {
      if (running) {
        await api.post('/api/broadcast/stop')
        push({ kind: 'ok', title: 'Diffusion arrêtée' })
      } else {
        await api.post('/api/broadcast/start', {})
        push({ kind: 'ok', title: 'Diffusion démarrée' })
      }
      poll.refresh()
    } catch (err: any) {
      push({ kind: 'err', title: 'Action impossible', message: err?.message })
    } finally {
      setBusy(false)
    }
  }

  if (poll.loading && !program) return <Loading />

  return (
    <div className="switcher-page">
      <div className="switcher-row">
        {/* PREVIEW (left) */}
        <div className={`switcher-monitor ${txClass}`}>
          <div className="switcher-head">
            <span className="badge badge-info">APERÇU</span>
            <span className="text-sm muted-2 truncate">{preview?.playlist_name || '—'}</span>
          </div>
          <ProgramPreview item={previewItem} emptyLabel="Aucune playlist dans l'aperçu" width={520} height={293} reloadKey={reloadKey} />
          <div className="switcher-monitor-foot">
            <select
              className="select grow"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">— Choisir une playlist —</option>
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.item_count})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Transition arrow between the monitors */}
        <div className="switcher-arrow">
          <button className="switcher-arrow-btn" disabled={busy || !target} onClick={swap} title="Prendre l'antenne">
            <IconArrowRight size={22} />
          </button>
        </div>

        {/* PROGRAM (right) */}
        <div className={`switcher-monitor ${txClass}`}>
          <div className="switcher-head">
            <span className="badge badge-live">
              <span className="dot dot-live" /> PROGRAMME
            </span>
            <span className="text-sm muted-2 truncate">{program?.playlist_name || '—'}</span>
          </div>
          <ProgramPreview item={programItem} emptyLabel="La diffusion est à l'arrêt" width={520} height={293} reloadKey={reloadKey} sound />
          <div className="switcher-monitor-foot">
            <span className="text-sm muted-2">
              {running && program
                ? `${formatDuration(program.position)} / ${formatDuration(program.cycle_duration)}`
                : 'Diffusion à l’arrêt'}
            </span>
          </div>
        </div>
      </div>

      {/* Controls: live start/stop + transition */}
      <div className="switcher-controls">
        <div className="flex gap-8 items-center">
          <button className={`btn ${running ? 'btn-danger' : 'btn-primary'} btn-lg`} disabled={busy} onClick={toggleLive}>
            {running ? <IconStop size={18} /> : <IconPlay size={18} />}
            {running ? 'Arrêter le direct' : 'Démarrer le direct'}
          </button>
          <button className="btn btn-primary btn-lg" disabled={busy || !target} onClick={swap}>
            <IconPlay size={18} /> {busy ? 'Prise d’antenne…' : 'Mettre à l’antenne'}
          </button>
        </div>
        <div className="flex gap-8 items-center">
          <span className="text-sm muted-2 nowrap">Transition</span>
          <select className="select" style={{ maxWidth: 220 }} value={transition} onChange={(e) => setTransition(e.target.value)}>
            {(catalog?.transitions ?? []).map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Preview contents */}
      {preview && preview.items.length > 0 && (
        <div className="card mt-16">
          <div className="card-head">
            <span className="card-title">Contenu de l'aperçu</span>
          </div>
          <div className="list" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {preview.items.map((item, i) => (
              <div key={item.id} className="row" style={{ padding: '6px 10px' }}>
                <span className="text-sm muted-2" style={{ width: 20 }}>
                  {i + 1}
                </span>
                <div className="row-main">
                  <div className="row-title">{item.title}</div>
                  <div className="row-sub">
                    {item.kind} · {formatDuration(item.duration)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
