import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Catalog, type LayerType, type Media, type Scene, type SceneLayer } from '../api'
import SceneCanvas from '../components/SceneCanvas'
import { SceneThumb } from '../components/ProgramPreview'
import AddLayerMenu from '../components/AddLayerMenu'
import { ConfirmDialog, EmptyState, Loading, Modal, useToast } from '../components/ui'
import { IconDuplicate, IconLayers, IconPlus, IconRotate, IconTrash, IconZDown, IconZUp } from '../components/icons'

// The editor canvas scales to the available space so the whole window fits
// without scrolling. The scene keeps its own aspect ratio.
const MAX_PREVIEW_W = 720

// Every layer gets an explicit size so it can never overflow the frame: text
// and box layers are sized too (the font scales with the box).
const NEW_LAYER = (type: LayerType, z: number): SceneLayer => {
  const isBox = type === 'text' || type === 'overlay' || type === 'chat' || type === 'countdown'
  return {
    type,
    x: 80,
    y: 80,
    width: isBox ? 600 : 480,
    height: isBox ? 160 : 270,
    opacity: 1,
    visible: true,
    z,
    rotation: 0,
    text: type === 'text' ? 'Votre texte' : type === 'overlay' ? 'Bandeau' : null,
    font_size: type === 'text' ? 64 : type === 'countdown' ? 96 : type === 'chat' ? 28 : 36,
    color: '#ffffff',
    background: type === 'overlay' || type === 'chat' || type === 'countdown' ? '#000000' : null,
    media_id: null,
    animation: 'none',
    anim_in: 'none',
    anim_loop: 'none',
    anim_out: 'none',
    animation_speed: null,
    visualizer: type === 'reactive' ? 'spectrum' : null,
    code: type === 'code' ? 'hflip' : null,
    chat_source: type === 'chat' ? 'chat' : null,
    chat_lines: type === 'chat' ? 8 : undefined,
    countdown_seconds: type === 'countdown' ? 60 : undefined,
    countdown_mode: type === 'countdown' ? 'down' : undefined,
    url: type === 'web' ? 'https://' : null,
  }
}

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

  // Recompute the canvas size when the window changes so it keeps fitting.
  const [viewport, setViewport] = useState(0)
  useEffect(() => {
    const onResize = () => setViewport((v) => v + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  const moveZ = (index: number, dir: -1 | 1) => {
    if (!editing) return
    const layer = editing.layers[index]
    updateLayer(index, { z: (layer.z ?? 0) + dir })
  }

  // Quality-of-life: duplicate via Ctrl+D, delete via Delete/Backspace.
  useEffect(() => {
    if (!editing || selectedLayer === null) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateLayer(selectedLayer)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeLayer(selectedLayer)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, selectedLayer])

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

  // Size the canvas so it always fits the window height (minus chrome) as well
  // as the available width, avoiding any scrollbar around the editor.
  const previewWidth = useMemo(() => {
    const w = editing?.width ?? 1920
    const h = editing?.height ?? 1080
    const byWidth = Math.min(MAX_PREVIEW_W, Math.max(window.innerWidth - 520, 240))
    const maxH = Math.max(window.innerHeight - 340, 180)
    const byHeight = maxH * (w / h)
    return Math.round(Math.min(byWidth, byHeight))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.width, editing?.height, viewport])

  if (loading) return <Loading />

  const layer = editing && selectedLayer !== null ? editing.layers[selectedLayer] : null
  const mediaFor = (id?: number | null) => media.find((x) => x.id === id)
  const layerTypes = catalog?.layer_types ?? []
  const animIn = catalog?.anim_in ?? []
  const animLoop = catalog?.anim_loop ?? []
  const animOut = catalog?.anim_out ?? []
  const visualizers = catalog?.visualizers ?? []
  const codeExamples = catalog?.code_examples ?? []
  const layerHelp = layer ? layerTypes.find((t) => t.id === layer.type)?.help : undefined

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
                <SceneThumb scene={s} media={media} />
                <div className="scene-thumb-badge text-sm">{s.layers.length} calques</div>
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
          full
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
              <AddLayerMenu
                types={layerTypes}
                onAdd={(id) => addLayer(id as LayerType)}
              />
            </div>
          </div>

          <div className="scene-editor">
            <div className="scene-canvas-wrap">
              <SceneCanvas
                width={editing.width}
                height={editing.height}
                background={editing.background}
                layers={editing.layers}
                selected={selectedLayer}
                displayWidth={previewWidth}
                mediaFor={mediaFor}
                onSelect={setSelectedLayer}
                onChange={setLayers}
              />
            </div>

            <div className="list scene-layers-list">
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
                    title="Descendre (z-1)"
                    onClick={(e) => {
                      e.stopPropagation()
                      moveZ(i, -1)
                    }}
                  >
                    <IconZDown size={15} />
                  </button>
                  <button
                    className="btn btn-ghost btn-icon"
                    title="Monter (z+1)"
                    onClick={(e) => {
                      e.stopPropagation()
                      moveZ(i, 1)
                    }}
                  >
                    <IconZUp size={15} />
                  </button>
                  <button
                    className="btn btn-ghost btn-icon"
                    title="Dupliquer (Ctrl+D)"
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
              {layerHelp && <p className="hint mb-8">{layerHelp}</p>}
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
                    <option value="chat">Chat box</option>
                    <option value="countdown">Compte à rebours</option>
                    <option value="web">URL web</option>
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

                {layer.type === 'chat' && (
                  <div className="field" style={{ gridColumn: 'span 3' }}>
                    <label>Source du chat (Twitch, YouTube, relais…)</label>
                    <input
                      className="input mono"
                      value={layer.chat_source ?? 'chat'}
                      onChange={(e) => updateLayer(selectedLayer!, { chat_source: e.target.value })}
                      placeholder="chat"
                    />
                    <div className="flex gap-8 items-center mt-8">
                      <label className="text-sm muted-2">Lignes affichées</label>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={50}
                        style={{ width: 90 }}
                        value={layer.chat_lines ?? 8}
                        onChange={(e) => updateLayer(selectedLayer!, { chat_lines: Number(e.target.value) })}
                      />
                    </div>
                    <span className="hint">
                      Les messages arrivent via <code className="mono">POST /api/chat/&lt;source&gt;</code>.
                    </span>
                  </div>
                )}

                {layer.type === 'countdown' && (
                  <div className="field" style={{ gridColumn: 'span 3' }}>
                    <label>Compte à rebours</label>
                    <div className="flex gap-12 items-center">
                      <div className="field" style={{ margin: 0 }}>
                        <span className="text-sm muted-2">Départ (secondes)</span>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          value={layer.countdown_seconds ?? 60}
                          onChange={(e) => updateLayer(selectedLayer!, { countdown_seconds: Number(e.target.value) })}
                        />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <span className="text-sm muted-2">Sens</span>
                        <select
                          className="select"
                          value={layer.countdown_mode ?? 'down'}
                          onChange={(e) => updateLayer(selectedLayer!, { countdown_mode: e.target.value as 'up' | 'down' })}
                        >
                          <option value="down">Décompte</option>
                          <option value="up">Comptage</option>
                        </select>
                      </div>
                    </div>
                    <span className="hint">Rendu par FFmpeg (drawtext avec expression temporelle).</span>
                  </div>
                )}

                {layer.type === 'web' && (
                  <div className="field" style={{ gridColumn: 'span 3' }}>
                    <label>URL de l'image (http/https, png ou jpg)</label>
                    <input
                      className="input mono"
                      value={layer.url ?? ''}
                      onChange={(e) => updateLayer(selectedLayer!, { url: e.target.value })}
                      placeholder="https://exemple.com/image.png"
                    />
                    <span className="hint">
                      FFmpeg récupère l'image distante. Pour une page HTML, capturez-la d'abord en image.
                    </span>
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

                {['image', 'video', 'logo'].includes(layer.type) && (
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
                  <label>Animation d'entrée (IN)</label>
                  <select
                    className="select"
                    value={layer.anim_in ?? 'none'}
                    onChange={(e) => updateLayer(selectedLayer!, { anim_in: e.target.value })}
                  >
                    {animIn.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>Animation en boucle (LOOP)</label>
                  <select
                    className="select"
                    value={layer.anim_loop ?? 'none'}
                    onChange={(e) => updateLayer(selectedLayer!, { anim_loop: e.target.value })}
                  >
                    {animLoop.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label>Animation de sortie (OUT)</label>
                  <select
                    className="select"
                    value={layer.anim_out ?? 'none'}
                    onChange={(e) => updateLayer(selectedLayer!, { anim_out: e.target.value })}
                  >
                    {animOut.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>

                {(layer.anim_in !== 'none' || layer.anim_loop !== 'none' || layer.anim_out !== 'none') && (
                  <div className="field">
                    <label>Vitesse / durée des animations</label>
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
