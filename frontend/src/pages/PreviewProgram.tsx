// Preview / Program switcher, redesigned.
//
// Layout: two identical monitors side by side (same size, same baseline).
// Left = PREVIEW (what will go on air), right = PROGRAM (what is on air).
// An arrow button between them performs the transition: the preview goes to the
// program and the program becomes the preview (a swap). The transition style is
// chosen underneath. Under the preview monitor there is a single button to put a
// playlist on air, and the preview contents are listed at the bottom.

import { useCallback, useEffect, useState } from 'react'
import { api, type Catalog, type EngineItem, type Playlist, type PreviewData } from '../api'
import { usePoll } from '../lib/usePoll'
import ProgramPreview from '../components/ProgramPreview'
import { formatDuration, Loading, useToast } from '../components/ui'
import { IconArrowRight, IconPlay } from '../components/icons'

export default function PreviewProgram() {
  const { push } = useToast()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedId, setSelectedId] = useState<number | ''>('')
  const [transition, setTransition] = useState('fade')
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [busy, setBusy] = useState(false)
  const [showContents, setShowContents] = useState(true)

  const poll = usePoll<PreviewData>(
    (signal) =>
      api.get<PreviewData>(
        '/api/broadcast/preview' + (selectedId ? `?playlist_id=${selectedId}` : ''),
        signal,
      ),
    2000,
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

  // Refresh the monitor content periodically so edits show up without reloading.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 3000)
    return () => window.clearInterval(t)
  }, [])
  const reloadKey = `${program?.playlist_id ?? ''}-${preview?.playlist_id ?? ''}-${tick}`

  const previewItem: EngineItem | null = preview?.items[0] ?? null
  const programItem: EngineItem | null = program?.current ?? null

  const target = selectedId || preview?.playlist_id || null

  // Put the preview playlist on air, then make the previous program the preview.
  const swap = async () => {
    if (!target) {
      push({ kind: 'err', title: 'Choisissez d’abord une playlist dans l’aperçu' })
      return
    }
    setBusy(true)
    const previousProgram = program?.playlist_id ?? null
    try {
      await api.post('/api/broadcast/take', { playlist_id: target })
      push({ kind: 'ok', title: 'Prise d’antenne effectuée' })
      // Swap: the old program becomes the new preview.
      setSelectedId(previousProgram ?? '')
      poll.refresh()
    } catch (err: any) {
      push({ kind: 'err', title: 'Prise d’antenne impossible', message: err?.message })
    } finally {
      setBusy(false)
    }
  }

  if (poll.loading && !program) return <Loading />

  return (
    <div className="switcher-page">
      {/* Monitors */}
      <div className="switcher-row">
        {/* PREVIEW (left) */}
        <div className="switcher-monitor">
          <div className="switcher-head">
            <span className="badge badge-info">APERÇU</span>
            <span className="text-sm muted-2 truncate">{preview?.playlist_name || '—'}</span>
          </div>
          <ProgramPreview item={previewItem} emptyLabel="Aucune playlist dans l'aperçu" width={520} height={293} reloadKey={reloadKey} />
          <div className="switcher-monitor-foot">
            <select
              className="select"
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

        {/* Transition arrow between the two monitors */}
        <div className="switcher-arrow">
          <button className="switcher-arrow-btn" disabled={busy || !target} onClick={swap} title="Prendre l'antenne">
            <IconArrowRight size={22} />
          </button>
        </div>

        {/* PROGRAM (right) */}
        <div className="switcher-monitor">
          <div className="switcher-head">
            <span className="badge badge-live">
              <span className="dot dot-live" /> PROGRAMME
            </span>
            <span className="text-sm muted-2 truncate">{program?.playlist_name || '—'}</span>
          </div>
          <ProgramPreview item={programItem} emptyLabel="La diffusion est à l'arrêt" width={520} height={293} reloadKey={reloadKey} />
          <div className="switcher-monitor-foot">
            <span className="text-sm muted-2">
              {program?.running
                ? `${formatDuration(program.position)} / ${formatDuration(program.cycle_duration)}`
                : 'Diffusion à l’arrêt'}
            </span>
          </div>
        </div>
      </div>

      {/* Single "put on air" button + transition picker */}
      <div className="switcher-controls">
        <button className="btn btn-primary btn-lg" disabled={busy || !target} onClick={swap}>
          <IconPlay size={18} /> {busy ? 'Prise d’antenne…' : 'Mettre à l’antenne'}
        </button>
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
            <button className="btn btn-ghost btn-sm" onClick={() => setShowContents((v) => !v)}>
              {showContents ? 'Masquer' : 'Afficher'}
            </button>
          </div>
          {showContents && (
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
          )}
        </div>
      )}
    </div>
  )
}
