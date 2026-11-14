// Read-only renderer for a playlist item, used by the Preview/Program switcher
// and the pop-out program window. It draws a scene's layers (or a media's
// video/image) scaled to fit its box, mirroring what the engine sends to air.
//
// This is a faithful *approximation* for the operator (text, images, video,
// positions, rotations, opacity). Effects that only exist inside FFmpeg
// (animations, reactive visualisers, code filters) are indicated by a small
// badge instead of being rendered pixel-for-pixel.

import { useEffect, useState } from 'react'
import type { EngineItem, Media } from '../api'

interface SceneLike {
  width: number
  height: number
  background: string
  layers: {
    type: string
    x: number
    y: number
    width?: number | null
    height?: number | null
    opacity?: number
    visible?: boolean
    z?: number
    rotation?: number
    media_id?: number | null
    text?: string | null
    font_size?: number
    color?: string
    background?: string | null
    animation?: string
    visualizer?: string | null
    code?: string | null
  }[]
}

function SceneRender({ scene, media, width }: { scene: SceneLike; media: Media[]; width: number }) {
  const scale = width / scene.width
  return (
    <div
      className="scene-canvas"
      style={{ width, aspectRatio: `${scene.width}/${scene.height}`, background: scene.background }}
    >
      {scene.layers
        .map((l, i) => ({ l, i }))
        .sort((a, b) => (a.l.z ?? 0) - (b.l.z ?? 0))
        .map(({ l, i }) => {
          const m = media.find((x) => x.id === l.media_id)
          const isText = l.type === 'text' || l.type === 'overlay'
          return (
            <div
              key={i}
              className="scene-layer"
              style={{
                left: l.x * scale,
                top: l.y * scale,
                width: l.width ? l.width * scale : undefined,
                height: l.height ? l.height * scale : undefined,
                opacity: l.visible === false ? 0.3 : l.opacity ?? 1,
                color: l.color,
                fontSize: isText ? (l.font_size ?? 32) * scale : undefined,
                background: isText ? l.background ?? 'transparent' : 'transparent',
                padding: isText ? '4px 8px' : 0,
                transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
                zIndex: (l.z ?? 0) + 1,
              }}
            >
              {!isText && m?.thumbnail_url && <img src={m.thumbnail_url} alt="" />}
              {!isText && !m?.thumbnail_url && (
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {l.type === 'reactive' ? `Réactif · ${l.visualizer ?? ''}` : l.type === 'code' ? `Code · ${l.code ?? ''}` : l.type}
                </span>
              )}
              {isText && (l.text || 'Texte')}
            </div>
          )
        })}
    </div>
  )
}

function MediaRender({ item, width, height }: { item: EngineItem; width: number; height: number }) {
  const [scene, setScene] = useState<SceneLike | null>(null)
  const [media, setMedia] = useState<Media[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    if (item.scene_id) {
      Promise.all([
        fetch(`/api/scenes/${item.scene_id}`, { credentials: 'same-origin' }).then((r) => r.json()),
        fetch('/api/media', { credentials: 'same-origin' }).then((r) => r.json()),
      ])
        .then(([s, m]) => {
          if (!active) return
          setScene(s)
          setMedia(m.items ?? [])
          setReady(true)
        })
        .catch(() => setReady(true))
    } else {
      setReady(true)
    }
    return () => {
      active = false
    }
  }, [item.scene_id])

  if (item.scene_id) {
    if (!ready || !scene) return <div className="stage-empty">Chargement…</div>
    return <SceneRender scene={scene} media={media} width={width} />
  }
  if (item.kind === 'image' && item.stream_url) {
    return <img src={item.stream_url} alt={item.title} style={{ maxWidth: width, maxHeight: height }} />
  }
  if (item.kind === 'video' && item.stream_url) {
    return <video src={item.stream_url} style={{ maxWidth: width, maxHeight: height }} muted autoPlay loop playsInline />
  }
  if (item.kind === 'audio') {
    return (
      <div className="stage-empty">
        <span style={{ fontWeight: 600 }}>{item.title}</span>
        <span className="text-sm muted-2">Piste audio</span>
      </div>
    )
  }
  return <div className="stage-empty">—</div>
}

interface Props {
  item: EngineItem | null
  emptyLabel: string
  width: number
  height: number
}

export default function ProgramPreview({ item, emptyLabel, width, height }: Props) {
  if (!item) {
    return (
      <div className="program-tile">
        <div className="stage-empty">
          <span>{emptyLabel}</span>
        </div>
      </div>
    )
  }
  return (
    <div className="program-tile">
      <MediaRender item={item} width={width} height={height} />
    </div>
  )
}
