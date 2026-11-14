// Read-only renderer for a playlist item, used by the Preview/Program switcher,
// the pop-out program window and the scene list thumbnails. It draws a scene's
// layers (or a media's video/image) scaled to fit its box, mirroring what the
// engine sends to air.
//
// This is a faithful *approximation* for the operator (text, images, video,
// positions, rotations, opacity). Effects that only exist inside FFmpeg
// (animations, reactive visualisers, code filters) are indicated by a small
// badge instead of being rendered pixel-for-pixel. Chat layers show a live
// sample of the recent messages.

import { useEffect, useState } from 'react'
import type { EngineItem, Media, Scene, SceneLayer } from '../api'

interface SceneLike {
  width: number
  height: number
  background: string
  layers: SceneLayer[]
}

function layerBadge(l: SceneLayer): string | null {
  if (l.type === 'reactive') return `Réactif · ${l.visualizer ?? ''}`
  if (l.type === 'code') return `Code · ${l.code ?? ''}`
  if (l.type === 'chat') return `Chat · ${l.chat_source ?? ''}`
  if (l.type === 'countdown') return `Compte à rebours · ${l.countdown_seconds ?? 60}s`
  if (l.type === 'web') return `URL · ${l.url ?? ''}`
  return null
}

export function SceneRender({
  scene,
  media,
  width,
  preferThumb = false,
}: {
  scene: SceneLike
  media: Media[]
  width: number
  preferThumb?: boolean
}) {
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
          const isBox = isText || l.type === 'chat' || l.type === 'countdown'
          const badge = layerBadge(l)
          const isMedia = l.type === 'image' || l.type === 'video' || l.type === 'logo'
          // The cached medium-resolution preview loads fast and stays sharp; the
          // small list uses the lighter thumbnail.
          const imgSrc = isMedia && m
            ? preferThumb
              ? m.thumbnail_url ?? m.preview_url ?? m.stream_url
              : m.preview_url ?? m.stream_url ?? m.thumbnail_url
            : null
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
                fontSize: isBox ? (l.font_size ?? 32) * scale : undefined,
                background: isBox ? l.background ?? 'transparent' : 'transparent',
                padding: isBox ? '4px 8px' : 0,
                transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
                zIndex: (l.z ?? 0) + 1,
              }}
            >
              {isMedia && imgSrc && <img src={imgSrc} alt="" />}
              {isMedia && !imgSrc && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{l.type}</span>}
              {!isMedia && !isBox && badge && (
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{badge}</span>
              )}
              {l.type === 'chat' && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>💬 {l.chat_source ?? 'chat'}</span>}
              {l.type === 'countdown' && (
                <span style={{ fontSize: (l.font_size ?? 96) * scale * 0.6 }}>
                  {l.countdown_mode === 'up' ? `+${l.countdown_seconds ?? 60}` : l.countdown_seconds ?? 60}
                </span>
              )}
              {isText && (l.text || 'Texte')}
            </div>
          )
        })}
    </div>
  )
}

// Small thumbnail used in the scene list: renders the scene read-only.
export function SceneThumb({ scene, media }: { scene: Scene; media: Media[] }) {
  return <SceneRender scene={scene} media={media} width={220} preferThumb />
}

function MediaRender({
  item,
  width,
  height,
  sound,
  reloadKey,
}: {
  item: EngineItem
  width: number
  height: number
  sound: boolean
  reloadKey?: string | number
}) {
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
    // reloadKey forces a re-fetch when the source changes, so the monitor
    // reflects edits without a manual refresh.
  }, [item.scene_id, item.media_id, reloadKey])

  if (item.scene_id) {
    if (!ready || !scene) return <div className="stage-empty">Chargement…</div>
    return <SceneRender scene={scene} media={media} width={width} preferThumb={width < 480} />
  }
  if (item.kind === 'image' && item.stream_url) {
    return <img src={item.stream_url} alt={item.title} style={{ maxWidth: width, maxHeight: height }} />
  }
  if (item.kind === 'video' && item.stream_url) {
    return (
      <video
        src={item.stream_url}
        style={{ maxWidth: width, maxHeight: height }}
        muted={!sound}
        autoPlay
        loop
        playsInline
        controls={sound}
      />
    )
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
  sound?: boolean
  reloadKey?: string | number
}

export default function ProgramPreview({ item, emptyLabel, width, height, sound = false, reloadKey }: Props) {
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
      <MediaRender item={item} width={width} height={height} sound={sound} reloadKey={reloadKey} />
      <button
        className="program-fullscreen"
        title="Plein écran"
        onClick={() => {
          const el = document.querySelector('.program-tile')
          if (document.fullscreenElement) void document.exitFullscreen()
          else void (el as HTMLElement | null)?.requestFullscreen?.()
        }}
      >
        ⛶
      </button>
    </div>
  )
}
