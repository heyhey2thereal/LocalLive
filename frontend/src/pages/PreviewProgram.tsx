import { useCallback, useEffect, useState } from 'react'
import { api, type Playlist, type PreviewData } from '../api'
import { usePoll } from '../lib/usePoll'
import { EmptyState, formatDuration, Loading, useToast } from '../components/ui'
import { IconPlay, IconSignal, IconStreams } from '../components/icons'

export default function PreviewProgram() {
  const { push } = useToast()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedId, setSelectedId] = useState<number | ''>('')
  const [taking, setTaking] = useState(false)
  const [busy, setBusy] = useState(false)

  const poll = usePoll<PreviewData>(
    (signal) => api.get<PreviewData>('/api/broadcast/preview' + (selectedId ? `?playlist_id=${selectedId}` : ''), signal),
    2500,
  )

  const loadPlaylists = useCallback(async () => {
    try {
      const data = await api.get<{ items: Playlist[] }>('/api/playlists')
      setPlaylists(data.items)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void loadPlaylists()
  }, [loadPlaylists])

  const program = poll.data?.program
  const preview = poll.data?.preview
  const outputs = poll.data?.outputs ?? []

  const take = async () => {
    const target = selectedId || preview?.playlist_id
    if (!target) return
    setTaking(true)
    setBusy(true)
    try {
      await api.post('/api/broadcast/take', { playlist_id: target })
      push({ kind: 'ok', title: 'Prise d’antenne effectuée' })
      poll.refresh()
    } catch (err: any) {
      push({ kind: 'err', title: 'Prise d’antenne impossible', message: err?.message })
    } finally {
      setTaking(false)
      setBusy(false)
    }
  }

  if (poll.loading && !program) return <Loading />

  return (
    <>
      <div className="grid grid-2" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        {/* Aperçu (preview) */}
        <div className="card">
          <div className="card-head">
            <span className="card-title">Aperçu</span>
            <select
              className="select"
              style={{ maxWidth: 260 }}
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
          <div className="stage">
            {preview && preview.items.length > 0 ? (
              <div className="stage-empty" style={{ gap: 6 }}>
                <IconSignal size={30} />
                <span style={{ fontWeight: 600 }}>{preview.playlist_name}</span>
                <span className="text-sm muted-2">
                  {preview.items.length} éléments · {formatDuration(preview.duration)}
                </span>
              </div>
            ) : (
              <div className="stage-empty">
                <IconSignal size={30} />
                <span>Aucune playlist sélectionnée</span>
              </div>
            )}
          </div>
          <div className="list mt-16" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {preview?.items.map((item, i) => (
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
          <div className="mt-16">
            <button className="btn btn-primary" disabled={busy || !(selectedId || preview?.playlist_id)} onClick={take}>
              <IconPlay size={16} /> {taking ? 'Prise d’antenne…' : 'Prendre l’antenne'}
            </button>
          </div>
        </div>

        {/* Programme (on air) */}
        <div className="card">
          <div className="card-head">
            <span className="card-title">Programme</span>
            {program?.running && (
              <span className="badge badge-live">
                <span className="dot dot-live" /> EN DIRECT
              </span>
            )}
          </div>
          <div className="stage">
            {program?.running ? (
              <div className="stage-empty" style={{ gap: 6 }}>
                <span className="dot dot-live" />
                <span style={{ fontWeight: 600 }}>{program.current?.title ?? '—'}</span>
                <span className="text-sm muted-2">
                  {formatDuration(program.position)} / {formatDuration(program.cycle_duration)}
                </span>
              </div>
            ) : (
              <div className="stage-empty">
                <IconSignal size={30} />
                <span>La diffusion est à l'arrêt</span>
              </div>
            )}
          </div>
          <div className="list mt-16">
            <div className="flex justify-between items-center" style={{ padding: '4px 0' }}>
              <span className="text-sm muted-2">Playlist</span>
              <span className="text-sm">{program?.playlist_name || '—'}</span>
            </div>
            <div className="flex justify-between items-center" style={{ padding: '4px 0' }}>
              <span className="text-sm muted-2">Élément</span>
              <span className="text-sm">
                {program ? `${program.current_index + 1} / ${program.item_count}` : '—'}
              </span>
            </div>
            <div className="flex justify-between items-center" style={{ padding: '4px 0' }}>
              <span className="text-sm muted-2">Pipeline</span>
              <span className="text-sm">{program?.pipeline === 'copy' ? 'Copie directe' : 'Encodage'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sorties actives */}
      <div className="card mt-24">
        <div className="card-head">
          <span className="card-title">
            <IconStreams size={16} /> Sorties actives
          </span>
          <span className="muted text-sm">{outputs.length}</span>
        </div>
        {outputs.length === 0 ? (
          <EmptyState title="Aucune sortie configurée" />
        ) : (
          <div className="list">
            {outputs.map((o) => (
              <div key={o.id} className="row">
                <span className={`dot ${o.primary ? 'dot-live' : 'dot-ok'}`} />
                <div className="row-main">
                  <div className="row-title">
                    {o.name} {o.primary && <span className="badge badge-info">Principale</span>}
                  </div>
                  <div className="row-sub mono truncate">{o.destination}</div>
                </div>
                <span className="text-sm muted-2 nowrap">
                  {o.width}×{o.height}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
