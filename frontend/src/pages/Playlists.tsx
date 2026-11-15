import { useCallback, useEffect, useState } from 'react'
import { api, type Catalog, type Media, type Playlist, type PlaylistItem, type Scene } from '../api'
import {
  ConfirmDialog,
  EmptyState,
  formatDuration,
  KindBadge,
  Loading,
  Modal,
  useToast,
} from '../components/ui'
import { IconDuplicate, IconGrip, IconMusic, IconPlay, IconPlaylist, IconPlus, IconSearch, IconTransition, IconTrash } from '../components/icons'
import { SceneThumb } from '../components/ProgramPreview'

export default function Playlists() {
  const { push } = useToast()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [media, setMedia] = useState<Media[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [toDelete, setToDelete] = useState<Playlist | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [audioMedia, setAudioMedia] = useState<Media[]>([])
  const [settingsItem, setSettingsItem] = useState<PlaylistItem | null>(null)
  const [preview, setPreview] = useState<PlaylistItem | null>(null)

  const selected = playlists.find((p) => p.id === selectedId) ?? null

  // Resolve a playlist item's scene so its row can show the scene render.
  const sceneFor = (id: number | null | undefined) => (id ? scenes.find((s) => s.id === id) : undefined)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [data, cat, m, s] = await Promise.all([
        api.get<{ items: Playlist[] }>('/api/playlists'),
        api.get<Catalog>('/api/meta/catalog').catch(() => null),
        api.get<{ items: Media[] }>('/api/media').catch(() => ({ items: [] })),
        api.get<{ items: Scene[] }>('/api/scenes').catch(() => ({ items: [] })),
      ])
      setPlaylists(data.items)
      setCatalog(cat)
      setMedia(m.items)
      setScenes(s.items)
      setSelectedId((prev) => prev ?? data.items[0]?.id ?? null)
    } catch (err: any) {
      push({ kind: 'err', title: 'Chargement impossible', message: err?.message })
    } finally {
      setLoading(false)
    }
  }, [push])

  useEffect(() => {
    void load()
  }, [load])

  const createPlaylist = async () => {
    if (!newName.trim()) return
    try {
      const pl = await api.post<Playlist>('/api/playlists', { name: newName, loop: true })
      setNewName('')
      setCreating(false)
      await load()
      setSelectedId(pl.id)
      push({ kind: 'ok', title: 'Playlist créée' })
    } catch (err: any) {
      push({ kind: 'err', title: 'Création impossible', message: err?.message })
    }
  }

  const updatePlaylist = async (patch: Partial<Playlist>) => {
    if (!selected) return
    try {
      await api.patch(`/api/playlists/${selected.id}`, {
        name: patch.name ?? selected.name,
        description: patch.description ?? selected.description,
        loop: patch.loop ?? selected.loop,
      })
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Modification impossible', message: err?.message })
    }
  }

  const duplicatePlaylist = async () => {
    if (!selected) return
    try {
      const copy = await api.post<Playlist>(`/api/playlists/${selected.id}/duplicate`, {})
      await load()
      setSelectedId(copy.id)
      push({ kind: 'ok', title: 'Playlist dupliquée', message: copy.name })
    } catch (err: any) {
      push({ kind: 'err', title: 'Duplication impossible', message: err?.message })
    }
  }

  const deletePlaylist = async () => {
    if (!toDelete) return
    try {
      await api.del(`/api/playlists/${toDelete.id}`)
      setToDelete(null)
      setSelectedId(null)
      await load()
      push({ kind: 'ok', title: 'Playlist supprimée' })
    } catch (err: any) {
      push({ kind: 'err', title: 'Suppression impossible', message: err?.message })
    }
  }

  const openAdd = async () => {
    setAddOpen(true)
    const [m, s] = await Promise.all([
      api.get<{ items: Media[] }>('/api/media'),
      api.get<{ items: Scene[] }>('/api/scenes'),
    ])
    setMedia(m.items)
    setScenes(s.items)
  }

  const addItem = async (payload: { media_id?: number; scene_id?: number }) => {
    if (!selected) return
    try {
      await api.post(`/api/playlists/${selected.id}/items`, payload)
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Ajout impossible', message: err?.message })
    }
  }

  const removeItem = async (item: PlaylistItem) => {
    if (!selected) return
    try {
      await api.del(`/api/playlists/${selected.id}/items/${item.id}`)
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Suppression impossible', message: err?.message })
    }
  }

  const setItemDuration = async (item: PlaylistItem, duration: number) => {
    if (!selected) return
    try {
      await api.patch(`/api/playlists/${selected.id}/items/${item.id}`, { duration })
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Modification impossible', message: err?.message })
    }
  }

  const openSettings = async (item: PlaylistItem) => {
    setSettingsItem(item)
    if (audioMedia.length === 0) {
      try {
        const data = await api.get<{ items: Media[] }>('/api/media?kind=audio')
        setAudioMedia(data.items)
      } catch {
        const data = await api.get<{ items: Media[] }>('/api/media').catch(() => ({ items: [] }))
        setAudioMedia(data.items.filter((m) => m.kind === 'audio'))
      }
    }
  }

  const saveItemSettings = async (patch: Partial<PlaylistItem>) => {
    if (!selected || !settingsItem) return
    try {
      await api.patch(`/api/playlists/${selected.id}/items/${settingsItem.id}`, {
        // Keep the raw override (0 = "use the default"); substituting the
        // effective duration would permanently pin the item to today's value.
        duration: settingsItem.duration,
        transition: patch.transition ?? settingsItem.transition,
        transition_duration: patch.transition_duration ?? settingsItem.transition_duration,
        background_audio_id:
          patch.background_audio_id !== undefined ? patch.background_audio_id : settingsItem.background_audio_id,
        background_volume: patch.background_volume ?? settingsItem.background_volume,
      })
      setSettingsItem(null)
      await load()
      push({ kind: 'ok', title: 'Réglages enregistrés' })
    } catch (err: any) {
      push({ kind: 'err', title: 'Modification impossible', message: err?.message })
    }
  }

  const reorderIds = async (ids: number[]) => {
    if (!selected) return
    try {
      const pl = await api.post<Playlist>(`/api/playlists/${selected.id}/reorder`, { item_ids: ids })
      setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? pl : p)))
    } catch (err: any) {
      push({ kind: 'err', title: 'Réorganisation impossible', message: err?.message })
    }
  }

  // Move an item one position up/down without dragging (touch-friendly).
  const moveItem = (index: number, delta: -1 | 1) => {
    if (!selected) return
    const target = index + delta
    if (target < 0 || target >= selected.items.length) return
    const ids = selected.items.map((i) => i.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(target, 0, moved)
    void reorderIds(ids)
  }

  const onDrop = async (targetIndex: number) => {
    if (dragIndex === null || !selected || dragIndex === targetIndex) {
      setDragIndex(null)
      setOverIndex(null)
      return
    }
    const ids = selected.items.map((i) => i.id)
    const [moved] = ids.splice(dragIndex, 1)
    ids.splice(targetIndex, 0, moved)
    setDragIndex(null)
    setOverIndex(null)
    await reorderIds(ids)
  }

  if (loading) return <Loading />

  const visiblePlaylists = query.trim()
    ? playlists.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    : playlists

  return (
    <>
      <div className="page-head">
        <div className="flex gap-8 items-center">
          <span className="muted">{playlists.length} playlist(s)</span>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-3)' }}>
              <IconSearch size={16} />
            </span>
            <input
              className="input"
              style={{ paddingLeft: 36, width: 240 }}
              placeholder="Rechercher une playlist…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <IconPlus size={16} /> Nouvelle playlist
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '300px 1fr', alignItems: 'start' }}>
        <div className="card" style={{ padding: 10 }}>
          {visiblePlaylists.length === 0 && <EmptyState title="Aucune playlist" />}
          {visiblePlaylists.map((p) => (
            <div
              key={p.id}
              className={`nav-item ${p.id === selectedId ? 'active' : ''}`}
              onClick={() => setSelectedId(p.id)}
            >
              <IconPlaylist size={16} />
              <div className="grow truncate">
                <div className="truncate" style={{ fontWeight: 600 }}>
                  {p.name}
                </div>
                <div className="text-sm muted-2">
                  {p.item_count} éléments · {formatDuration(p.total_duration)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          {!selected ? (
            <EmptyState icon={<IconPlaylist size={40} />} title="Sélectionnez une playlist" />
          ) : (
            <>
              <div className="card-head">
                <input
                  className="input"
                  style={{ maxWidth: 320, fontWeight: 600 }}
                  value={selected.name}
                  onChange={(e) =>
                    setPlaylists((prev) =>
                      prev.map((p) => (p.id === selected.id ? { ...p, name: e.target.value } : p)),
                    )
                  }
                  onBlur={() => updatePlaylist({ name: selected.name })}
                />
                <div className="flex gap-8 items-center">
                  <label className="flex items-center gap-8 text-sm muted">
                    <input
                      type="checkbox"
                      checked={selected.loop}
                      onChange={(e) => updatePlaylist({ loop: e.target.checked })}
                    />
                    Boucle
                  </label>
                  <button className="btn" onClick={openAdd}>
                    <IconPlus size={16} /> Ajouter
                  </button>
                  <button className="btn btn-ghost btn-icon" title="Dupliquer la playlist" onClick={() => void duplicatePlaylist()}>
                    <IconDuplicate size={16} />
                  </button>
                  <button className="btn btn-danger btn-icon" onClick={() => setToDelete(selected)}>
                    <IconTrash size={16} />
                  </button>
                </div>
              </div>

              <div className="list">
                {selected.items.length === 0 && (
                  <EmptyState title="Playlist vide" hint="Ajoutez des médias ou des scènes." />
                )}
                {selected.items.map((item, index) => (
                  <div
                    key={item.id}
                    className={`row ${dragIndex === index ? 'dragging' : ''} ${overIndex === index ? 'drag-over' : ''}`}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setOverIndex(index)
                    }}
                    onDrop={() => onDrop(index)}
                    onDragEnd={() => {
                      setDragIndex(null)
                      setOverIndex(null)
                    }}
                  >
                    <span className="grip">
                      <IconGrip size={16} />
                    </span>
                    <span className="text-sm muted-2" style={{ width: 18 }}>
                      {index + 1}
                    </span>
                    {item.scene_id && sceneFor(item.scene_id) ? (
                      <div className="row-thumb scene-thumb-mini">
                        <SceneThumb scene={sceneFor(item.scene_id)!} media={media} width={64} />
                      </div>
                    ) : item.thumbnail_url ? (
                      <img className="row-thumb" src={item.thumbnail_url} alt="" />
                    ) : (
                      <div className="row-thumb" />
                    )}
                    <div className="row-main">
                      <div className="row-title">{item.title}</div>
                      <div className="row-sub flex gap-8 items-center">
                        <KindBadge kind={item.kind ?? 'scene'} />
                        <span>{formatDuration(item.effective_duration)}</span>
                      </div>
                    </div>
                    <div className="row-actions">
                      <input
                        className="input"
                        style={{ width: 76, padding: '5px 8px' }}
                        type="number"
                        min={0}
                        step={1}
                        value={Math.round(item.duration || item.effective_duration)}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          setPlaylists((prev) =>
                            prev.map((p) =>
                              p.id === selected.id
                                ? {
                                    ...p,
                                    items: p.items.map((it) =>
                                      it.id === item.id ? { ...it, duration: v } : it,
                                    ),
                                  }
                                : p,
                            ),
                          )
                        }}
                        onBlur={(e) => setItemDuration(item, Number(e.target.value))}
                        title="Durée (secondes)"
                      />
                      <button
                        className="btn btn-ghost btn-icon"
                        title="Monter"
                        disabled={index === 0}
                        onClick={() => moveItem(index, -1)}
                      >
                        ▲
                      </button>
                      <button
                        className="btn btn-ghost btn-icon"
                        title="Descendre"
                        disabled={index === selected.items.length - 1}
                        onClick={() => moveItem(index, 1)}
                      >
                        ▼
                      </button>
                      <button className="btn btn-ghost btn-icon" title="Transition et musique" onClick={() => openSettings(item)}>
                        <IconTransition size={15} />
                      </button>
                      <button
                        className="btn btn-ghost btn-icon"
                        title="Dupliquer l'élément"
                        onClick={async () => {
                          try {
                            const pl = await api.post<Playlist>(
                              `/api/playlists/${selected.id}/items/${item.id}/duplicate`,
                              {},
                            )
                            setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? pl : p)))
                          } catch (err: any) {
                            push({ kind: 'err', title: 'Duplication impossible', message: err?.message })
                          }
                        }}
                      >
                        <IconDuplicate size={15} />
                      </button>
                      <button className="btn btn-ghost btn-icon" title="Aperçu" onClick={() => setPreview(item)}>
                        <IconPlay size={15} />
                      </button>
                      <button className="btn btn-ghost btn-icon" onClick={() => removeItem(item)}>
                        <IconTrash size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {creating && (
        <Modal
          title="Nouvelle playlist"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCreating(false)}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={createPlaylist}>
                Créer
              </button>
            </>
          }
        >
          <div className="field">
            <label>Nom de la playlist</label>
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createPlaylist()}
              autoFocus
            />
          </div>
        </Modal>
      )}

      {addOpen && selected && (
        <Modal title="Ajouter à la playlist" onClose={() => setAddOpen(false)} wide>
          <div className="tabs mb-16">
            <span className="tab active">Médias et scènes</span>
          </div>
          <div className="grid grid-2">
            <div>
              <div className="text-sm muted-2 mb-8">Médiathèque</div>
              <div className="list" style={{ maxHeight: 380, overflowY: 'auto' }}>
                {media.map((m) => (
                  <div key={m.id} className="row">
                    {m.thumbnail_url ? (
                      <img className="row-thumb" src={m.thumbnail_url} alt="" />
                    ) : (
                      <div className="row-thumb" />
                    )}
                    <div className="row-main">
                      <div className="row-title">{m.title}</div>
                      <div className="row-sub">{formatDuration(m.duration)}</div>
                    </div>
                    <button className="btn btn-sm" onClick={() => addItem({ media_id: m.id })}>
                      Ajouter
                    </button>
                  </div>
                ))}
                {media.length === 0 && <EmptyState title="Aucun média" />}
              </div>
            </div>
            <div>
              <div className="text-sm muted-2 mb-8">Scènes</div>
              <div className="list" style={{ maxHeight: 380, overflowY: 'auto' }}>
                {scenes.map((s) => (
                  <div key={s.id} className="row">
                    <div className="row-thumb scene-thumb-mini">
                      <SceneThumb scene={s} media={media} width={64} />
                    </div>
                    <div className="row-main">
                      <div className="row-title">{s.name}</div>
                      <div className="row-sub">
                        {s.width}×{s.height} · {s.layers.length} calques
                      </div>
                    </div>
                    <button className="btn btn-sm" onClick={() => addItem({ scene_id: s.id })}>
                      Ajouter
                    </button>
                  </div>
                ))}
                {scenes.length === 0 && <EmptyState title="Aucune scène" />}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {settingsItem && (
        <ItemSettingsModal
          item={settingsItem}
          transitions={catalog?.transitions ?? []}
          audio={audioMedia}
          onClose={() => setSettingsItem(null)}
          onSave={saveItemSettings}
        />
      )}

      {preview && (
        <Modal title={`Aperçu : ${preview.title}`} onClose={() => setPreview(null)} wide>
          <div className="stage">
            {preview.scene_id && sceneFor(preview.scene_id) ? (
              <SceneThumb scene={sceneFor(preview.scene_id)!} media={media} width={880} />
            ) : preview.kind === 'image' ? (
              <img src={preview.thumbnail_url ?? ''} alt="" />
            ) : preview.media_id ? (
              <video src={`/api/media/${preview.media_id}/stream`} controls autoPlay />
            ) : (
              <div className="stage-empty">
                <IconPlay size={30} />
                <span>Scène — aperçu disponible en direct</span>
              </div>
            )}
          </div>
          <div className="text-sm muted-2 mt-8">
            {preview.kind ?? 'scène'} · {formatDuration(preview.effective_duration)}
          </div>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Supprimer la playlist"
          message={`« ${toDelete.name} » et son ordre de lecture seront supprimés.`}
          onConfirm={deletePlaylist}
          onCancel={() => setToDelete(null)}
        />
      )}
    </>
  )
}

function ItemSettingsModal({
  item,
  transitions,
  audio,
  onClose,
  onSave,
}: {
  item: PlaylistItem
  transitions: { id: string; label: string; default_duration?: number }[]
  audio: Media[]
  onClose: () => void
  onSave: (patch: Partial<PlaylistItem>) => void
}) {
  const [transition, setTransition] = useState(item.transition || 'cut')
  const [duration, setDuration] = useState(item.transition_duration || 0)
  const [audioId, setAudioId] = useState<number | ''>(item.background_audio_id ?? '')
  const [volume, setVolume] = useState(item.background_volume ?? 0.15)

  return (
    <Modal
      title={`Transition et musique : ${item.title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-primary"
            onClick={() =>
              onSave({
                transition,
                transition_duration: duration,
                background_audio_id: audioId === '' ? null : Number(audioId),
                background_volume: volume,
              })
            }
          >
            Enregistrer
          </button>
        </>
      }
    >
      <div className="grid grid-2">
        <div className="field">
          <label>Transition d'entrée</label>
          <select className="select" value={transition} onChange={(e) => setTransition(e.target.value)}>
            {transitions.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Durée de la transition (s)</label>
          <input
            className="input"
            type="number"
            min={0}
            step={0.1}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="field">
        <label>
          <IconMusic size={14} /> Musique de fond
        </label>
        <select
          className="select"
          value={audioId}
          onChange={(e) => setAudioId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">— Aucune —</option>
          {audio.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
        <span className="hint">Piste audio mixée sous l'élément (boucle automatique via la durée).</span>
      </div>

      <div className="field">
        <label>Volume de la musique ({Math.round(volume * 100)} %)</label>
        <input
          className="input"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>
    </Modal>
  )
}
