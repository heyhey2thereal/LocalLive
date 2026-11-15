import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Catalog, type LayerType, type Media, type Scene, type SceneLayer } from '../api'
import SceneCanvas from '../components/SceneCanvas'
import { SceneThumb } from '../components/ProgramPreview'
import { fontFamily, fontWeight } from '../lib/fonts'
import AddLayerMenu from '../components/AddLayerMenu'
import { ConfirmDialog, EmptyState, Loading, Modal, useToast } from '../components/ui'
import { IconDuplicate, IconLayers, IconPlus, IconRotate, IconSearch, IconTrash, IconZDown, IconZUp } from '../components/icons'

// The editor canvas scales to the available space so the whole window fits
// without scrolling. The scene keeps its own aspect ratio.
const MAX_PREVIEW_W = 720

// Every layer gets an explicit size so it can never overflow the frame: text
// and box layers are sized too (the font scales with the box).
const NEW_LAYER = (type: LayerType, z: number): SceneLayer => {
  const isBox =
    type === 'text' ||
    type === 'overlay' ||
    type === 'chat' ||
    type === 'countdown' ||
    type === 'clock' ||
    type === 'ticker'
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
    text:
      type === 'text'
        ? 'Votre texte'
        : type === 'overlay'
          ? 'Bandeau'
          : type === 'ticker'
            ? 'Bandeau d’actualités'
            : null,
    font_size: type === 'text' ? 64 : type === 'countdown' ? 96 : type === 'clock' ? 72 : type === 'ticker' ? 40 : type === 'chat' ? 28 : 36,
    font: 'default',
    color: '#ffffff',
    // Countdown and clock are just numbers/text: no black box behind them by
    // default (only the explicit "Bandeau"/"Chat" layers get a background).
    background: type === 'overlay' || type === 'chat' || type === 'ticker' ? '#000000' : null,
    media_id: null,
    animation: 'none',
    anim_in: 'none',
    anim_loop: type === 'ticker' ? 'marquee' : 'none',
    anim_out: 'none',
    animation_speed: null,
    visualizer: type === 'reactive' ? 'spectrum' : null,
    code: type === 'code' ? 'hflip' : null,
    chat_source: type === 'chat' ? 'chat' : null,
    chat_lines: type === 'chat' ? 8 : undefined,
    countdown_seconds: type === 'countdown' ? 60 : undefined,
    countdown_mode: type === 'countdown' ? 'down' : undefined,
    clock_format: type === 'clock' ? '%H:%M' : undefined,
    clock_utc: type === 'clock' ? false : undefined,
    feed_url: type === 'ticker' ? '' : undefined,
    feed_limit: type === 'ticker' ? 8 : undefined,
    url: type === 'web' ? 'https://' : null,
  }
}

export default function Scenes() {
  const { push } = useToast()
  const [scenes, setScenes] = useState<Scene[]>([])
  const [sceneQuery, setSceneQuery] = useState('')
  const [media, setMedia] = useState<Media[]>([])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Scene | null>(null)
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null)
  const [toDelete, setToDelete] = useState<Scene | null>(null)
  const [fullscreenMedia, setFullscreenMedia] = useState<Media | null>(null)

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

  // Keep a stored layer's size sane (never below 8px, never bigger than the
  // frame) but leave its position free: an element is allowed to sit outside the
  // frame. Normalising on open guarantees a box is never zero-sized.
  const normalizeLayer = (l: SceneLayer, w: number, h: number): SceneLayer => {
    const width = Math.max(8, Math.min(l.width ?? Math.round(w * 0.25), w))
    const height = Math.max(8, Math.min(l.height ?? Math.round((l.width ?? w * 0.25) * 9 / 16), h))
    return { ...l, width, height }
  }

  const openScene = (s: Scene) =>
    setEditing({ ...s, layers: s.layers.map((l) => normalizeLayer(l, s.width, s.height)) })

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
    const id = toDelete.id
    try {
      await api.del(`/api/scenes/${id}`)
      setToDelete(null)
      setEditing(null)
      await load()
      push({ kind: 'ok', title: 'Scène supprimée' })
    } catch (err: any) {
      push({ kind: 'err', title: 'Suppression impossible', message: err?.message })
    }
  }

  const duplicateScene = async (s: Scene) => {
    try {
      const copy = await api.post<Scene>(`/api/scenes/${s.id}/duplicate`, {})
      await load()
      push({ kind: 'ok', title: 'Scène dupliquée', message: copy.name })
    } catch (err: any) {
      push({ kind: 'err', title: 'Duplication impossible', message: err?.message })
    }
  }

  // Size the canvas so it always fits both the available width and the window
  // height (minus chrome), so the editor never overflows. It is the exact
  // preview frame — nothing larger.
  const previewWidth = useMemo(() => {
    const w = editing?.width ?? 1920
    const h = editing?.height ?? 1080
    const byWidth = Math.min(MAX_PREVIEW_W, Math.max(window.innerWidth - 560, 220))
    const maxH = Math.max(window.innerHeight - 360, 160)
    const byHeight = maxH * (w / h)
    return Math.round(Math.max(160, Math.min(byWidth, byHeight)))
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

  // Client-side filter so the search box reacts instantly.
  const visibleScenes = sceneQuery.trim()
    ? scenes.filter((s) => s.name.toLowerCase().includes(sceneQuery.trim().toLowerCase()))
    : scenes

  return (
    <>
      <div className="page-head">
        <div className="flex gap-8 items-center">
          <span className="muted">{scenes.length} scène(s)</span>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-3)' }}>
              <IconSearch size={16} />
            </span>
            <input
              className="input"
              style={{ paddingLeft: 36, width: 240 }}
              placeholder="Rechercher une scène…"
              value={sceneQuery}
              onChange={(e) => setSceneQuery(e.target.value)}
            />
          </div>
        </div>
        <button className="btn btn-primary" onClick={newScene}>
          <IconPlus size={16} /> Nouvelle scène
        </button>
      </div>

      {visibleScenes.length === 0 ? (
        <EmptyState
          icon={<IconLayers size={40} />}
          title={sceneQuery ? 'Aucune scène trouvée' : 'Aucune scène'}
          hint={
            sceneQuery
              ? 'Aucune scène ne correspond à cette recherche.'
              : 'Composez des habillages avec vidéos, images, textes, logos, visuels réactifs et code FFmpeg.'
          }
        />
      ) : (
        <div className="media-grid">
          {visibleScenes.map((s) => (
            <div key={s.id} className="media-card" onClick={() => openScene(s)}>
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
              <button
                className="card-duplicate"
                title="Dupliquer la scène"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  void duplicateScene(s)
                }}
              >
                <IconDuplicate size={15} />
              </button>
              <button
                className="card-delete"
                title="Supprimer la scène"
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  setToDelete(s)
                }}
              >
                <IconTrash size={15} />
              </button>
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
              {editing.id !== 0 && (
                <button
                  className="btn btn-danger"
                  style={{ marginRight: 'auto' }}
                  onClick={() => setToDelete(editing)}
                >
                  <IconTrash size={15} /> Supprimer
                </button>
              )}
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
                    onChange={(e) => {
                      const type = e.target.value as LayerType
                      // Start from a clean, type-appropriate layer so fields that
                      // belong to the old type (countdown_seconds, feed_url…) do
                      // not linger and leak into the engine.
                      const fresh = NEW_LAYER(type, layer.z ?? 0)
                      updateLayer(selectedLayer!, {
                        ...fresh,
                        x: layer.x,
                        y: layer.y,
                        width: layer.width,
                        height: layer.height,
                        rotation: layer.rotation,
                        opacity: layer.opacity,
                        z: layer.z,
                        visible: layer.visible,
                        blur: layer.blur,
                      })
                    }}
                  >
                    <option value="text">Texte</option>
                    <option value="overlay">Bandeau</option>
                    <option value="image">Image</option>
                    <option value="video">Vidéo</option>
                    <option value="logo">Logo</option>
                    <option value="reactive">Réactif (audio)</option>
                    <option value="chat">Chat box</option>
                    <option value="countdown">Compte à rebours</option>
                    <option value="clock">Horloge (date / heure)</option>
                    <option value="ticker">Bandeau d'actualités (RSS)</option>
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

                {layer.type === 'clock' && (
                  <div className="field" style={{ gridColumn: 'span 3' }}>
                    <label>Horloge</label>
                    <div className="flex gap-12 items-center" style={{ flexWrap: 'wrap' }}>
                      <div className="field" style={{ margin: 0, minWidth: 240 }}>
                        <span className="text-sm muted-2">Format</span>
                        <select
                          className="select"
                          value={layer.clock_format ?? '%H:%M'}
                          onChange={(e) => updateLayer(selectedLayer!, { clock_format: e.target.value })}
                        >
                          {(catalog?.clock_formats ?? []).map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <label className="flex items-center gap-8" style={{ marginTop: 18 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(layer.clock_utc)}
                          onChange={(e) => updateLayer(selectedLayer!, { clock_utc: e.target.checked })}
                        />
                        <span className="text-sm muted">Heure UTC</span>
                      </label>
                    </div>
                    <span className="hint">Affichée en direct, mise à jour par FFmpeg (aucun rechargement).</span>
                  </div>
                )}

                {layer.type === 'ticker' && (
                  <div className="field" style={{ gridColumn: 'span 3' }}>
                    <label>Bandeau d'actualités — source RSS / Atom</label>
                    <div className="flex gap-8 items-center">
                      <input
                        className="input mono grow"
                        value={layer.feed_url ?? ''}
                        onChange={(e) => updateLayer(selectedLayer!, { feed_url: e.target.value })}
                        placeholder="https://exemple.com/rss.xml"
                      />
                      <button
                        className="btn btn-sm"
                        onClick={async () => {
                          if (!layer.feed_url) return
                          try {
                            const d = await api.get<{ items: { title: string }[] }>(
                              `/api/meta/feed?url=${encodeURIComponent(layer.feed_url)}&limit=3`,
                            )
                            push({
                              kind: d.items.length ? 'ok' : 'err',
                              title: d.items.length ? `${d.items.length} titre(s) trouvé(s)` : 'Aucun titre',
                              message: d.items.map((i) => i.title).join(' • '),
                            })
                          } catch (err: any) {
                            push({ kind: 'err', title: 'Flux illisible', message: err?.message })
                          }
                        }}
                      >
                        Tester
                      </button>
                      <div className="field" style={{ margin: 0 }}>
                        <span className="text-sm muted-2">Titres</span>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={20}
                          style={{ width: 80 }}
                          value={layer.feed_limit ?? 8}
                          onChange={(e) => updateLayer(selectedLayer!, { feed_limit: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    <span className="hint">
                      Les titres sont récupérés et mis en cache quelques minutes, puis défilent (animation LOOP).
                    </span>
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
                    <div className="flex gap-8 items-center">
                      <select
                        className="select grow"
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
                      {layer.media_id && (
                        <>
                          <button
                            className="btn btn-sm"
                            title="Étendre sur tout le cadre de la scène"
                            onClick={() => {
                              if (!editing) return
                              updateLayer(selectedLayer!, { x: 0, y: 0, width: editing.width, height: editing.height })
                            }}
                          >
                            Étendre
                          </button>
                          <button
                            className="btn btn-sm"
                            title="Afficher en plein écran"
                            onClick={() => {
                              const m = media.find((x) => x.id === layer.media_id)
                              if (m) setFullscreenMedia(m)
                            }}
                          >
                            ⛶
                          </button>
                        </>
                      )}
                    </div>
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
                <div className="field">
                  <label>Flou ({layer.blur ?? 0})</label>
                  <input
                    className="input"
                    type="range"
                    min={0}
                    max={40}
                    step={1}
                    value={layer.blur ?? 0}
                    onChange={(e) => updateLayer(selectedLayer!, { blur: Number(e.target.value) })}
                  />
                </div>
                {(layer.type === 'text' || layer.type === 'overlay') && (
                  <>
                    <div className="field">
                      <label>Police</label>
                      <select
                        className="select"
                        value={layer.font ?? 'default'}
                        onChange={(e) => updateLayer(selectedLayer!, { font: e.target.value })}
                      >
                        {(catalog?.fonts ?? [{ id: 'default', label: 'Par défaut' }]).map((f) => (
                          <option key={f.id} value={f.id} style={{ fontFamily: fontFamily(f.id), fontWeight: fontWeight(f.id) }}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>
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

      {fullscreenMedia && (
        <div className="media-fullscreen" onClick={() => setFullscreenMedia(null)}>
          {fullscreenMedia.kind === 'video' ? (
            <video src={fullscreenMedia.stream_url} controls autoPlay onClick={(e) => e.stopPropagation()} />
          ) : (
            <img src={fullscreenMedia.stream_url} alt={fullscreenMedia.title} onClick={(e) => e.stopPropagation()} />
          )}
          <button className="media-fullscreen-close" onClick={() => setFullscreenMedia(null)} aria-label="Fermer">
            ×
          </button>
        </div>
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
