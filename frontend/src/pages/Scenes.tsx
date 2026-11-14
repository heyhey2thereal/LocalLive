import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Media, type Scene, type SceneLayer } from '../api'
import { ConfirmDialog, EmptyState, Loading, Modal, useToast } from '../components/ui'
import { IconLayers, IconPlus, IconTrash } from '../components/icons'

const PREVIEW_W = 640

export default function Scenes() {
  const { push } = useToast()
  const [scenes, setScenes] = useState<Scene[]>([])
  const [media, setMedia] = useState<Media[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Scene | null>(null)
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null)
  const [toDelete, setToDelete] = useState<Scene | null>(null)
  const dragRef = useRef<{ index: number; startX: number; startY: number; origX: number; origY: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, m] = await Promise.all([
        api.get<{ items: Scene[] }>('/api/scenes'),
        api.get<{ items: Media[] }>('/api/media'),
      ])
      setScenes(s.items)
      setMedia(m.items)
    } catch (err: any) {
      push({ kind: 'err', title: 'Chargement impossible', message: err?.message })
    } finally {
      setLoading(false)
    }
  }, [push])

  useEffect(() => {
    void load()
  }, [load])

  const newScene = () => {
    setEditing({
      id: 0,
      name: 'Nouvelle scène',
      width: 1920,
      height: 1080,
      background: '#0b0d12',
      layers: [],
    })
    setSelectedLayer(null)
  }

  const addLayer = (type: SceneLayer['type']) => {
    if (!editing) return
    const layer: SceneLayer = {
      type,
      x: 60,
      y: 60,
      width: type === 'text' || type === 'overlay' ? undefined : 480,
      height: type === 'text' || type === 'overlay' ? undefined : 270,
      opacity: 1,
      visible: true,
      z: editing.layers.length,
      text: type === 'text' ? 'Texte' : type === 'overlay' ? 'Bandeau' : null,
      font_size: type === 'text' ? 64 : 36,
      color: '#ffffff',
      background: type === 'overlay' ? '#000000' : null,
      media_id: null,
    }
    setEditing({ ...editing, layers: [...editing.layers, layer] })
    setSelectedLayer(editing.layers.length)
  }

  const updateLayer = (index: number, patch: Partial<SceneLayer>) => {
    if (!editing) return
    setEditing({
      ...editing,
      layers: editing.layers.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    })
  }

  const removeLayer = (index: number) => {
    if (!editing) return
    setEditing({ ...editing, layers: editing.layers.filter((_, i) => i !== index) })
    setSelectedLayer(null)
  }

  const saveScene = async () => {
    if (!editing) return
    if (!editing.name.trim()) {
      push({ kind: 'err', title: 'Le nom est requis' })
      return
    }
    try {
      const payload = { ...editing }
      if (editing.id === 0) {
        await api.post('/api/scenes', payload)
      } else {
        await api.put(`/api/scenes/${editing.id}`, payload)
      }
      push({ kind: 'ok', title: 'Scène enregistrée' })
      setEditing(null)
      await load()
    } catch (err: any) {
      push({ kind: 'err', title: 'Enregistrement impossible', message: err?.message })
    }
  }

  const deleteScene = async () => {
    if (!toDelete) return
    try {
      await api.del(`/api/scenes/${toDelete.id}`)
      setToDelete(null)
      await load()
      push({ kind: 'ok', title: 'Scène supprimée' })
    } catch (err: any) {
      push({ kind: 'err', title: 'Suppression impossible', message: err?.message })
    }
  }

  // --- drag handling on the canvas -----------------------------------------
  const onLayerMouseDown = (e: React.MouseEvent, index: number) => {
    if (!editing) return
    e.stopPropagation()
    setSelectedLayer(index)
    const layer = editing.layers[index]
    dragRef.current = { index, startX: e.clientX, startY: e.clientY, origX: layer.x, origY: layer.y }
    const scale = editing.width / PREVIEW_W
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = (ev.clientX - d.startX) * scale
      const dy = (ev.clientY - d.startY) * scale
      updateLayer(d.index, { x: Math.round(d.origX + dx), y: Math.round(d.origY + dy) })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (loading) return <Loading />

  const layer = editing && selectedLayer !== null ? editing.layers[selectedLayer] : null
  const mediaFor = (id?: number | null) => media.find((m) => m.id === id)

  return (
    <>
      <div className="page-head">
        <span className="muted">{scenes.length} scène(s)</span>
        <button className="btn btn-primary" onClick={newScene}>
          <IconPlus size={16} /> Nouvelle scène
        </button>
      </div>

      {scenes.length === 0 ? (
        <EmptyState
          icon={<IconLayers size={40} />}
          title="Aucune scène"
          hint="Composez des habillages avec vidéos, images, textes et logos."
        />
      ) : (
        <div className="media-grid">
          {scenes.map((s) => (
            <div key={s.id} className="media-card" onClick={() => setEditing({ ...s })}>
              <div
                className="media-thumb"
                style={{ background: s.background, aspectRatio: `${s.width}/${s.height}` }}
              >
                <div style={{ textAlign: 'center', color: 'var(--text-2)' }}>
                  <IconLayers size={28} />
                  <div className="text-sm mt-8">{s.layers.length} calques</div>
                </div>
              </div>
              <div className="media-body">
                <div className="media-title">{s.name}</div>
                <div className="media-meta">
                  {s.width}×{s.height}
                </div>
              </div>
              <div className="row-actions" style={{ position: 'absolute', top: 8, right: 8 }}>
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={(e) => {
                    e.stopPropagation()
                    setToDelete(s)
                  }}
                >
                  <IconTrash size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id === 0 ? 'Nouvelle scène' : `Éditer : ${editing.name}`}
          onClose={() => setEditing(null)}
          wide
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={saveScene}>
                Enregistrer
              </button>
            </>
          }
        >
          <div className="field">
            <label>Nom de la scène</label>
            <input
              className="input"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </div>

          <div className="grid grid-4 mb-16">
            <div className="field">
              <label>Largeur</label>
              <input
                className="input"
                type="number"
                value={editing.width}
                onChange={(e) => setEditing({ ...editing, width: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Hauteur</label>
              <input
                className="input"
                type="number"
                value={editing.height}
                onChange={(e) => setEditing({ ...editing, height: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Fond</label>
              <input
                className="input"
                type="color"
                value={editing.background}
                onChange={(e) => setEditing({ ...editing, background: e.target.value })}
              />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <div className="flex gap-8">
                <button className="btn btn-sm" onClick={() => addLayer('text')}>
                  + Texte
                </button>
                <button className="btn btn-sm" onClick={() => addLayer('image')}>
                  + Image
                </button>
              </div>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 300px', gap: 16 }}>
            <div className="scene-canvas-wrap">
              <div
                className="scene-canvas"
                style={{
                  width: PREVIEW_W,
                  aspectRatio: `${editing.width}/${editing.height}`,
                  background: editing.background,
                }}
                onClick={() => setSelectedLayer(null)}
              >
                {editing.layers
                  .map((l, i) => ({ l, i }))
                  .sort((a, b) => (a.l.z ?? 0) - (b.l.z ?? 0))
                  .map(({ l, i }) => {
                    const scale = PREVIEW_W / editing.width
                    const m = mediaFor(l.media_id)
                    const isText = l.type === 'text' || l.type === 'overlay'
                    return (
                      <div
                        key={i}
                        className={`scene-layer ${selectedLayer === i ? 'selected' : ''}`}
                        style={{
                          left: l.x * scale,
                          top: l.y * scale,
                          width: l.width ? l.width * scale : undefined,
                          height: l.height ? l.height * scale : undefined,
                          opacity: l.visible === false ? 0.3 : l.opacity ?? 1,
                          color: l.color,
                          fontSize: (l.font_size ?? 32) * scale * 0.9,
                          background: isText ? l.background ?? 'transparent' : 'transparent',
                          padding: isText ? '4px 8px' : 0,
                          zIndex: (l.z ?? 0) + 1,
                        }}
                        onMouseDown={(e) => onLayerMouseDown(e, i)}
                      >
                        {!isText && m?.thumbnail_url && (
                          <img src={m.thumbnail_url} alt="" draggable={false} />
                        )}
                        {!isText && !m?.thumbnail_url && (
                          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
                            {l.type === 'logo' ? 'Logo' : 'Média'}
                          </span>
                        )}
                        {isText && (l.text || 'Texte')}
                      </div>
                    )
                  })}
              </div>
            </div>

            <div className="list">
              {editing.layers.length === 0 && <EmptyState title="Aucun calque" hint="Ajoutez un texte ou une image." />}
              {editing.layers.map((l, i) => (
                <div
                  key={i}
                  className={`row ${selectedLayer === i ? 'drag-over' : ''}`}
                  onClick={() => setSelectedLayer(i)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="row-main">
                    <div className="row-title">
                      {l.type === 'text' || l.type === 'overlay' ? l.text || l.type : l.type}
                    </div>
                    <div className="row-sub">
                      z{l.z ?? 0} · {Math.round(l.x)},{Math.round(l.y)}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeLayer(i)
                    }}
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {layer && (
            <div className="card mt-16">
              <div className="card-title mb-8">Calque sélectionné</div>
              <div className="grid grid-4">
                <div className="field">
                  <label>Type</label>
                  <select
                    className="select"
                    value={layer.type}
                    onChange={(e) => updateLayer(selectedLayer!, { type: e.target.value as SceneLayer['type'] })}
                  >
                    <option value="text">Texte</option>
                    <option value="overlay">Bandeau</option>
                    <option value="image">Image</option>
                    <option value="video">Vidéo</option>
                    <option value="logo">Logo</option>
                  </select>
                </div>
                {(layer.type === 'text' || layer.type === 'overlay') && (
                  <div className="field">
                    <label>Texte</label>
                    <input
                      className="input"
                      value={layer.text ?? ''}
                      onChange={(e) => updateLayer(selectedLayer!, { text: e.target.value })}
                    />
                  </div>
                )}
                {layer.type !== 'text' && layer.type !== 'overlay' && (
                  <div className="field">
                    <label>Média</label>
                    <select
                      className="select"
                      value={layer.media_id ?? ''}
                      onChange={(e) =>
                        updateLayer(selectedLayer!, { media_id: e.target.value ? Number(e.target.value) : null })
                      }
                    >
                      <option value="">— Choisir —</option>
                      {media.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="field">
                  <label>Position X</label>
                  <input
                    className="input"
                    type="number"
                    value={Math.round(layer.x)}
                    onChange={(e) => updateLayer(selectedLayer!, { x: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Position Y</label>
                  <input
                    className="input"
                    type="number"
                    value={Math.round(layer.y)}
                    onChange={(e) => updateLayer(selectedLayer!, { y: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Largeur</label>
                  <input
                    className="input"
                    type="number"
                    value={layer.width ?? ''}
                    onChange={(e) =>
                      updateLayer(selectedLayer!, { width: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </div>
                <div className="field">
                  <label>Hauteur</label>
                  <input
                    className="input"
                    type="number"
                    value={layer.height ?? ''}
                    onChange={(e) =>
                      updateLayer(selectedLayer!, { height: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </div>
                <div className="field">
                  <label>Opacité</label>
                  <input
                    className="input"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={layer.opacity ?? 1}
                    onChange={(e) => updateLayer(selectedLayer!, { opacity: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Ordre (z)</label>
                  <input
                    className="input"
                    type="number"
                    value={layer.z ?? 0}
                    onChange={(e) => updateLayer(selectedLayer!, { z: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Couleur</label>
                  <input
                    className="input"
                    type="color"
                    value={layer.color ?? '#ffffff'}
                    onChange={(e) => updateLayer(selectedLayer!, { color: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Visible</label>
                  <label className="flex items-center gap-8">
                    <input
                      type="checkbox"
                      checked={layer.visible !== false}
                      onChange={(e) => updateLayer(selectedLayer!, { visible: e.target.checked })}
                    />
                    <span className="text-sm muted">Affiché</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Supprimer la scène"
          message={`« ${toDelete.name} » sera supprimée et retirée des playlists.`}
          onConfirm={deleteScene}
          onCancel={() => setToDelete(null)}
        />
      )}
    </>
  )
}
