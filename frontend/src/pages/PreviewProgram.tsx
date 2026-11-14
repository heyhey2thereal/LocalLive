// OBS-style Preview / Program switcher.
//
// Left: PROGRAM (what is on air). Right: PREVIEW (the next playlist). A
// transition picker selects how the take will look, and "Prendre l'antenne"
// switches the live playlist. Each monitor has a pop-out button that opens the
// render in a separate browser window.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Catalog, type EngineItem, type Media, type Playlist, type PreviewData, type Scene } from '../api'
import { usePoll } from '../lib/usePoll'
import ProgramPreview from '../components/ProgramPreview'
import { EmptyState, formatDuration, Loading, useToast } from '../components/ui'
import { IconLayers, IconMedia, IconPlay, IconPlaylist, IconPlus, IconStreams, IconZap } from '../components/icons'

// OBS-like quick add: pick a scene or a media and append it to the preview
// playlist without leaving the switcher.
function QuickAdd({
  scenes,
  media,
  onScene,
  onMedia,
}: {
  scenes: Scene[]
  media: Media[]
  onScene: (id: number) => void
  onMedia: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="quick-add">
      <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
        <IconPlus size={14} /> Source
      </button>
      {open && (
        <div className="quick-add-menu" onMouseLeave={() => setOpen(false)}>
          <div className="quick-add-group">
            <div className="quick-add-label">Scènes</div>
            {scenes.map((s) => (
              <button key={`s${s.id}`} className="quick-add-item" onClick={() => { onScene(s.id); setOpen(false) }}>
                <IconLayers size={14} /> {s.name}
              </button>
            ))}
            {scenes.length === 0 && <div className="text-sm muted-2">Aucune scène</div>}
          </div>
          <div className="quick-add-group">
            <div className="quick-add-label">Médias</div>
            <div className="quick-add-scroll">
              {media.map((m) => (
                <button key={`m${m.id}`} className="quick-add-item" onClick={() => { onMedia(m.id); setOpen(false) }}>
                  <IconMedia size={14} /> <span className="truncate">{m.title}</span>
                </button>
              ))}
              {media.length === 0 && <div className="text-sm muted-2">Aucun média</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PreviewProgram() {
  const { push } = useToast()
  const navigate = useNavigate()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedId, setSelectedId] = useState<number | ''>('')
  const [transition, setTransition] = useState('fade')
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [busy, setBusy] = useState(false)
  const [programIndex, setProgramIndex] = useState(0)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [media, setMedia] = useState<Media[]>([])

  const poll = usePoll<PreviewData>(
    (signal) =>
      api.get<PreviewData>(
        '/api/broadcast/preview' + (selectedId ? `?playlist_id=${selectedId}` : ''),
        signal,
      ),
    2500,
  )

  const loadPlaylists = useCallback(async () => {
    try {
      const [data, cat, sc, md] = await Promise.all([
        api.get<{ items: Playlist[] }>('/api/playlists'),
        api.get<Catalog>('/api/meta/catalog').catch(() => null),
        api.get<{ items: Scene[] }>('/api/scenes').catch(() => ({ items: [] })),
        api.get<{ items: Media[] }>('/api/media').catch(() => ({ items: [] })),
      ])
      setPlaylists(data.items)
      setCatalog(cat)
      setScenes(sc.items)
      setMedia(md.items)
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

  // Refresh the monitor content periodically (and on playlist changes) so edits
  // to the scene/playlist show up without a manual refresh. A slow tick avoids
  // remounting the render on every poll while still catching source changes.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 3000)
    return () => window.clearInterval(t)
  }, [])
  const reloadKey = useMemo(
    () => `${program?.playlist_id ?? ''}-${preview?.playlist_id ?? ''}-${tick}`,
    [program?.playlist_id, preview?.playlist_id, tick],
  )

  // Which program item is shown on the monitor (default: the live one).
  const programItem: EngineItem | null =
    program?.running && program.items.length > 0
      ? program.items[Math.min(programIndex, program.items.length - 1)]
      : program?.current ?? null

  const take = async () => {
    const target = selectedId || preview?.playlist_id
    if (!target) return
    setBusy(true)
    try {
      await api.post('/api/broadcast/take', { playlist_id: target })
      push({ kind: 'ok', title: 'Prise d’antenne effectuée' })
      setProgramIndex(0)
      poll.refresh()
    } catch (err: any) {
      push({ kind: 'err', title: 'Prise d’antenne impossible', message: err?.message })
    } finally {
      setBusy(false)
    }
  }

  const openWindow = (which: 'program' | 'preview') => {
    const params = new URLSearchParams({ view: which })
    if (which === 'preview' && selectedId) params.set('playlist_id', String(selectedId))
    window.open(`/program?${params.toString()}`, `locallive-${which}`, 'width=960,height=620')
  }

  const addToPreview = async (payload: { scene_id?: number; media_id?: number }) => {
    const target = selectedId || preview?.playlist_id
    if (!target) {
      push({ kind: 'err', title: 'Choisissez d’abord une playlist d’aperçu' })
      return
    }
    try {
      await api.post(`/api/playlists/${target}/items`, payload)
      push({ kind: 'ok', title: 'Ajouté à la playlist d’aperçu' })
      poll.refresh()
    } catch (err: any) {
      push({ kind: 'err', title: 'Ajout impossible', message: err?.message })
    }
  }

  if (poll.loading && !program) return <Loading />

  return (
    <>
      {/* Quick actions: everything to manage the sources lives here (like OBS). */}
      <div className="switcher-toolbar">
        <span className="text-sm muted-2 nowrap">Ajouter à l'aperçu :</span>
        <QuickAdd
          scenes={scenes}
          media={media}
          onScene={(id) => addToPreview({ scene_id: id })}
          onMedia={(id) => addToPreview({ media_id: id })}
        />
        <button className="btn btn-sm" onClick={() => navigate('/playlists')}>
          <IconPlaylist size={15} /> Playlists
        </button>
        <button className="btn btn-sm" onClick={() => navigate('/scenes')}>
          <IconLayers size={15} /> Scènes
        </button>
        <button className="btn btn-sm" onClick={() => navigate('/media')}>
          <IconMedia size={15} /> Médias
        </button>
        <div className="grow" />
        {program?.running ? (
          <button
            className="btn btn-sm btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api.post('/api/broadcast/stop')
                poll.refresh()
              } finally {
                setBusy(false)
              }
            }}
          >
            Arrêter la diffusion
          </button>
        ) : (
          <span className="text-sm muted-2">Diffusion à l'arrêt</span>
        )}
      </div>

      <div className="switcher">
        {/* PREVIEW (left) */}
        <div className="switcher-monitor">
          <div className="switcher-head">
            <span className="badge badge-info">APERÇU</span>
            <div className="flex gap-8 items-center">
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
              <button className="btn btn-ghost btn-icon" title="Ouvrir dans une fenêtre" onClick={() => openWindow('preview')}>
                <IconStreams size={15} />
              </button>
            </div>
          </div>
          <ProgramPreview
            item={preview?.items[0] ?? null}
            emptyLabel="Aucune playlist sélectionnée"
            width={520}
            height={293}
            reloadKey={reloadKey}
          />
          <div className="switcher-foot">
            <span className="text-sm muted-2">
              {preview && preview.items.length > 0
                ? `${preview.items.length} éléments · ${formatDuration(preview.duration)}`
                : '—'}
            </span>
            <button className="btn btn-primary" disabled={busy || !(selectedId || preview?.playlist_id)} onClick={take}>
              <IconPlay size={16} /> {busy ? 'Prise d’antenne…' : 'Prendre l’antenne'}
            </button>
          </div>
        </div>

        {/* PROGRAM (right) */}
        <div className="switcher-monitor">
          <div className="switcher-head">
            <span className="badge badge-live">
              <span className="dot dot-live" /> PROGRAMME
            </span>
            <div className="flex gap-8 items-center">
              <span className="text-sm muted-2">{program?.playlist_name || '—'}</span>
              <button className="btn btn-ghost btn-icon" title="Ouvrir dans une fenêtre" onClick={() => openWindow('program')}>
                <IconStreams size={15} />
              </button>
            </div>
          </div>
          <ProgramPreview item={programItem} emptyLabel="La diffusion est à l'arrêt" width={520} height={293} reloadKey={reloadKey} />
          <div className="switcher-foot">
            <div className="flex gap-8 items-center">
              {program?.running && program.items.length > 1 && (
                <select className="select" value={programIndex} onChange={(e) => setProgramIndex(Number(e.target.value))}>
                  {program.items.map((it, i) => (
                    <option key={it.id} value={i}>
                      {i + 1}. {it.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <span className="text-sm muted-2">
              {program?.running
                ? `${formatDuration(program.position)} / ${formatDuration(program.cycle_duration)}`
                : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Transition bar (applies to the next take) */}
      <div className="card mt-16 switcher-bar">
        <div className="flex gap-12 items-center grow">
          <span className="text-sm muted-2 nowrap">Transition de prise d'antenne</span>
          <select className="select" style={{ maxWidth: 240 }} value={transition} onChange={(e) => setTransition(e.target.value)}>
            {(catalog?.transitions ?? []).map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Preview playlist contents */}
      {preview && preview.items.length > 0 && (
        <div className="card mt-16">
          <div className="card-head">
            <span className="card-title">Contenu de l'aperçu</span>
          </div>
          <div className="list" style={{ maxHeight: 200, overflowY: 'auto' }}>
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

      {/* Outputs */}
      <div className="card mt-16">
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
                  <div className="row-sub mono truncate">{o.destination || '—'}</div>
                </div>
                <span className="text-sm muted-2 nowrap">
                  {o.width}×{o.height}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {program?.running && (
        <div className="flex items-center gap-8 mt-16 muted text-sm">
          <IconZap size={14} /> Diffusion en cours — pipeline {program.pipeline === 'copy' ? 'copie directe' : 'encodage'}
        </div>
      )}
    </>
  )
}
