import { useCallback, useEffect, useState } from 'react'
import { api, type Catalog, type LayerType, type Media, type Scene, type SceneLayer } from '../api'
import SceneCanvas from '../components/SceneCanvas'
import { ConfirmDialog, EmptyState, Loading, Modal, useToast } from '../components/ui'
import {
  IconCode,
  IconDuplicate,
  IconLayers,
  IconPlus,
  IconRotate,
  IconTrash,
  IconZap,
} from '../components/icons'

const PREVIEW_W = 640

const NEW_LAYER = (type: LayerType, z: number): SceneLayer => ({
  type,
  x: 60,
  y: 60,
  width: type === 'text' || type === 'overlay' ? undefined : 480,
  height: type === 'text' || type === 'overlay' ? undefined : 270,
  opacity: 1,
  visible: true,
  z,
  rotation: 0,
  text: type === 'text' ? 'Texte' : type === 'overlay' ? 'Bandeau' : null,
  font_size: type === 'text' ? 64 : 36,
  color: '#ffffff',
  background: type === 'overlay' ? '#000000' : null,
  media_id: null,
  animation: 'none',
  animation_speed: null,
  visualizer: type === 'reactive' ? 'spectrum' : null,
  code: type === 'code' ? 'hflip' : null,
})

export default function Scenes() {
  const { push } = useToast()
  const [scenes, setScenes] = useState<Scene[]>([])
  const [media, setMedia] = useState<Media[]>([])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Scene | null>(null)
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null)
  const [toDelete, setToDelete] = useState<Scene | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, m, c] = await Promise.all([
        api.get<{ items: Scene[] }>('/api/scenes'),
        api.get<{ items: Media[] }>('/api/media'),
        api.get<Catalog>('/api/meta/catalog'),
      ])
      setScenes(s.items)
      setMedia(m.items)
      setCatalog(c)
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
    setEditing({ id: 0, name: 'Nouvelle scène', width: 1920, height: 1080, background: '#0b0d12', layers: [] })
    setSelectedLayer(null)
  }

  const setLayers = (layers: SceneLayer[]) => {
    if (editing) setEditing({ ...editing, layers })
  }

  const addLayer = (type: LayerType) => {
    if (!editing) return
    const layer = NEW_LAYER(type, editing.layers.length)
    setLayers([...editing.layers, layer])
    setSelectedLayer(editing.layers.length)
  }

  const duplicateLayer = (index: number) => {
    if (!editing) return
    const source = editing.layers[index]
    const copy: SceneLayer = {
      ...source,
      x: source.x + 20,
      y: source.y + 20,
      z: editing.layers.length,
    }
    setLayers([...editing.layers, copy])
    setSelectedLayer(editing.layers.length)
  }

  const updateLayer = (index: number, patch: Partial<SceneLayer>) => {
    if (!editing) return
    setLayers(editing.layers.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  const removeLayer = (index: number) => {
    if (!editing) return
    setLayers(editing.layers.filter((_, i) => i !== index))
    setSelectedLayer(null)
  }

  const saveScene = async () => {
    if (!editing) return
    if (!editing.name.trim()) {
      push({ kind: 'err', title: 'Le nom est requis' })
      return
    }
    try {
      if (editing.id === 0) await api.post('/api/scenes', editing)
      else await api.put(`/api/scenes/${editing.id}`, editing)
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

  if (loading) return <Loading />

  const layer = editing && selectedLayer !== null ? editing.layers[selectedLayer] : null
  const mediaFor = (id?: number | null) => media.find((m) => m.id === id)
  const animations = catalog?.animations ?? []
  const visualizers = catalog?.visualizers ?? []
  const codeExamples = catalog?.code_examples ?? []

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
          hint="Composez des habillages avec vidéos, images, textes, logos, visuels réactifs et code FFmpeg."
        />
      ) : (
        <div className="media-grid">
          {scenes.map((s) => (
            <div key={s.id} className="media-card" onClick={() => setEditing({ ...s })}>
              <div className="media-thumb" style={{ background: s.background, aspectRatio: `${s.width}/${s.height}` }}>
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
            <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
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
              <label>Ajouter un calque</label>
              <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-sm" onClick={() => addLayer('text')}>
                  + Texte
                </button>
                <button className="btn btn-sm" onClick={() => addLayer('image')}>
                  + Image
                </button>
                <button className="btn btn-sm" onClick={() => addLayer('reactive')}>
                  <IconZap size={14} /> Réactif
                </button>
                <button className="btn btn-sm" onClick={() => addLayer('code')}>
                  <IconCode size={14} /> Code
                </button>
              </div>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 300px', gap: 16 }}>
            <div className="scene-canvas-wrap">
              <SceneCanvas
                width={editing.width}
                height={editing.height}
                background={editing.background}
                layers={editing.layers}
                selected={selectedLayer}
                displayWidth={PREVIEW_W}
                mediaFor={mediaFor}
                onSelect={setSelectedLayer}
                onChange={setLayers}
              />
              <div className="text-sm muted-2 mt-8">
                Glissez pour déplacer · 8 poignées pour redimensionner · Maj = magnétisme · flèches = ajustement
              </div>
            </div>

            <div className="list">
              {editing.layers.length === 0 && <EmptyState title="Aucun calque" hint="Ajoutez un texte, une image, un visuel réactif ou du code." />}
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
                      {l.rotation ? ` · ${Math.round(l.rotation)}°` : ''}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-icon"
                    title="Dupliquer"
                    onClick={(e) => {
                      e.stopPropagation()
                      duplicateLayer(i)
                    }}
                  >
                    <IconDuplicate size={15} />
                  </button>
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
                    onChange={(e) => updateLayer(selectedLayer!, { type: e.target.value as LayerType })}
                  >
                    <option value="text">Texte</option>
                    <option value="overlay">Bandeau</option>
                    <option value="image">Image</option>
                    <option value="video">Vidéo</option>
                    <option value="logo">Logo</option>
                    <option value="reactive">Réactif (audio)</option>
                    <option value="code">Code FFmpeg</option>
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

                {layer.type === 'reactive' && (
                  <div className="field">
                    <label>Visualiseur</label>
                    <select
                      className="select"
                      value={layer.visualizer ?? 'spectrum'}
                      onChange={(e) => updateLayer(selectedLayer!, { visualizer: e.target.value })}
                    >
                      {visualizers.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {layer.type === 'code' && (
                  <div className="field" style={{ gridColumn: 'span 3' }}>
                    <label>Code FFmpeg (filtres séparés par des virgules)</label>
                    <input
                      className="input mono"
                      value={layer.code ?? ''}
                      onChange={(e) => updateLayer(selectedLayer!, { code: e.target.value })}
                      placeholder="hflip"
                    />
                    <div className="flex gap-8 mt-8" style={{ flexWrap: 'wrap' }}>
                      {codeExamples.map((ex) => (
                        <button key={ex.label} className="btn btn-sm" onClick={() => updateLayer(selectedLayer!, { code: ex.code })}>
                          {ex.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {layer.type !== 'text' && layer.type !== 'overlay' && layer.type !== 'code' && layer.type !== 'reactive' && (
                  <div className="field">
                    <label>Média</label>
                    <select
                      className="select"
                      value={layer.media_id ?? ''}
                      onChange={(e) => updateLayer(selectedLayer!, { media_id: e.target.value ? Number(e.target.value) : null })}
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
                  <label>Animation</label>
                  <select
                    className="select"
                    value={layer.animation ?? 'none'}
                    onChange={(e) => updateLayer(selectedLayer!, { animation: e.target.value })}
                  >
                    {animations.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>

                {layer.animation && layer.animation !== 'none' && (
                  <div className="field">
                    <label>Vitesse d'animation</label>
                    <input
                      className="input"
                      type="number"
                      step="0.1"
                      value={layer.animation_speed ?? ''}
                      onChange={(e) => updateLayer(selectedLayer!, { animation_speed: e.target.value ? Number(e.target.value) : null })}
                    />
                  </div>
                )}

                <div className="field">
                  <label>Position X</label>
                  <input className="input" type="number" value={Math.round(layer.x)} onChange={(e) => updateLayer(selectedLayer!, { x: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Position Y</label>
                  <input className="input" type="number" value={Math.round(layer.y)} onChange={(e) => updateLayer(selectedLayer!, { y: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Largeur</label>
                  <input
                    className="input"
                    type="number"
                    value={layer.width ?? ''}
                    onChange={(e) => updateLayer(selectedLayer!, { width: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
                <div className="field">
                  <label>Hauteur</label>
                  <input
                    className="input"
                    type="number"
                    value={layer.height ?? ''}
                    onChange={(e) => updateLayer(selectedLayer!, { height: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
                <div className="field">
                  <label>Rotation (°)</label>
                  <div className="flex items-center gap-8">
                    <input
                      className="input"
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={layer.rotation ?? 0}
                      onChange={(e) => updateLayer(selectedLayer!, { rotation: Number(e.target.value) })}
                    />
                    <span className="text-sm nowrap">{Math.round(layer.rotation ?? 0)}°</span>
                    <button className="btn btn-ghost btn-icon" title="Réinitialiser" onClick={() => updateLayer(selectedLayer!, { rotation: 0 })}>
                      <IconRotate size={14} />
                    </button>
                  </div>
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
                  <input className="input" type="number" value={layer.z ?? 0} onChange={(e) => updateLayer(selectedLayer!, { z: Number(e.target.value) })} />
                </div>
                {(layer.type === 'text' || layer.type === 'overlay') && (
                  <>
                    <div className="field">
                      <label>Taille de police</label>
                      <input
                        className="input"
                        type="number"
                        value={layer.font_size ?? 48}
                        onChange={(e) => updateLayer(selectedLayer!, { font_size: Number(e.target.value) })}
                      />
                    </div>
                    <div className="field">
                      <label>Couleur</label>
                      <input className="input" type="color" value={layer.color ?? '#ffffff'} onChange={(e) => updateLayer(selectedLayer!, { color: e.target.value })} />
                    </div>
                  </>
                )}
                <div className="field">
                  <label>Visible</label>
                  <label className="flex items-center gap-8">
                    <input type="checkbox" checked={layer.visible !== false} onChange={(e) => updateLayer(selectedLayer!, { visible: e.target.checked })} />
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
