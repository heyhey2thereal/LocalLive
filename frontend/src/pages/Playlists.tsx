import { useCallback, useEffect, useState } from 'react'
import { api, type Media, type Playlist, type PlaylistItem, type Scene } from '../api'
import {
  ConfirmDialog,
  EmptyState,
  formatDuration,
  KindBadge,
  Loading,
  Modal,
  useToast,
} from '../components/ui'
import { IconGrip, IconPlaylist, IconPlus, IconTrash } from '../components/icons'

export default function Playlists() {
  const { push } = useToast()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [media, setMedia] = useState<Media[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [toDelete, setToDelete] = useState<Playlist | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const selected = playlists.find((p) => p.id === selectedId) ?? null

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ items: Playlist[] }>('/api/playlists')
      setPlaylists(data.items)
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
    try {
      const pl = await api.post<Playlist>(`/api/playlists/${selected.id}/reorder`, { item_ids: ids })
      setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? pl : p)))
    } catch (err: any) {
      push({ kind: 'err', title: 'Réorganisation impossible', message: err?.message })
    }
  }

  if (loading) return <Loading />

  return (
    <>
      <div className="page-head">
        <span className="muted">{playlists.length} playlist(s)</span>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <IconPlus size={16} /> Nouvelle playlist
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '300px 1fr', alignItems: 'start' }}>
        <div className="card" style={{ padding: 10 }}>
          {playlists.length === 0 && <EmptyState title="Aucune playlist" />}
          {playlists.map((p) => (
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
                    {item.thumbnail_url ? (
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
                    <div className="row-thumb" />
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
