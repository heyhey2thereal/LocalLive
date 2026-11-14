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

import { useEffect, useRef, useState } from 'react'
import type { EngineItem, Media, Scene, SceneLayer } from '../api'
import { layerAnimation } from '../lib/animations'

interface SceneLike {
  width: number
  height: number
  background: string
  layers: SceneLayer[]
}

// Live MM:SS clock, ticking every second, mirroring the FFmpeg drawtext timer.
function Countdown({ total, mode, fontPx }: { total: number; mode: string; fontPx: number }) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const t = window.setInterval(() => setNow(Math.floor((Date.now() - start) / 1000)), 250)
    return () => window.clearInterval(t)
  }, [total, mode])
  const secs = mode === 'up' ? total + now : Math.max(0, total - now)
  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')
  return <span style={{ fontSize: fontPx }}>{mm}:{ss}</span>
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
  animate = false,
  layerDuration = 0,
}: {
  scene: SceneLike
  media: Media[]
  width: number
  preferThumb?: boolean
  /** Play the layers' IN/LOOP/OUT animations (monitors + editor). */
  animate?: boolean
  /** On-air duration of each layer, used to delay OUT animations. */
  layerDuration?: number
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
          // Always give the layer an explicit size (same rule as the editor) so
          // nothing can overflow the frame even if a stored layer has no size.
          const lw = l.width ?? Math.round(scene.width * 0.25)
          let lh = l.height ?? 0
          if (!lh) {
            const ratio = m && m.width && m.height ? m.height / m.width : 9 / 16
            lh = Math.round(lw * ratio)
          }
          const blur = l.blur ?? 0
          const anim = animate ? layerAnimation(l, layerDuration, width) : null
          return (
            <div
              key={i}
              className={`scene-layer ${anim ? anim.className : ''}`}
              style={{
                left: l.x * scale,
                top: l.y * scale,
                width: lw * scale,
                height: lh * scale,
                opacity: l.visible === false ? 0.3 : l.opacity ?? 1,
                color: l.color,
                fontSize: isBox ? (l.font_size ?? 32) * scale : undefined,
                background: isBox ? l.background ?? 'transparent' : 'transparent',
                padding: isBox ? '4px 8px' : 0,
                transform: !anim && l.rotation ? `rotate(${l.rotation}deg)` : undefined,
                zIndex: (l.z ?? 0) + 1,
                ...(anim ? anim.style : {}),
              }}
            >
              <span className="scene-layer-inner" style={{ filter: blur ? `blur(${blur * scale}px)` : undefined }}>
                {isMedia && imgSrc && <img src={imgSrc} alt="" draggable={false} />}
                {isMedia && !imgSrc && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{l.type}</span>}
                {!isMedia && !isBox && badge && (
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{badge}</span>
                )}
                {l.type === 'chat' && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>💬 {l.chat_source ?? 'chat'}</span>}
                {l.type === 'countdown' && (
                  <Countdown
                    total={l.countdown_seconds ?? 60}
                    mode={l.countdown_mode ?? 'down'}
                    fontPx={(l.font_size ?? 96) * scale}
                  />
                )}
                {isText && (l.text || 'Texte')}
              </span>
            </div>
          )
        })}
    </div>
  )
}

// Fills its container: measures the parent and renders the scene at that exact
// size, so the monitor never grows/shrinks because of a big image. The aspect
// ratio is preserved by the parent (which owns the 16:9 box).
export function FitScene({
  scene,
  media,
  preferThumb,
  animate = false,
  layerDuration = 0,
}: {
  scene: SceneLike
  media: Media[]
  preferThumb?: boolean
  animate?: boolean
  layerDuration?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className="fit-scene">
      {w > 0 && (
        <SceneRender
          scene={scene}
          media={media}
          width={w}
          preferThumb={preferThumb}
          animate={animate}
          layerDuration={layerDuration}
        />
      )}
    </div>
  )
}

// Small thumbnail of a scene: renders it read-only. Used everywhere a scene is
// listed or chosen (scene grid, playlist pickers, playlist rows, dashboard) so
// the operator can see what the scene looks like at a glance.
export function SceneThumb({
  scene,
  media,
  width = 220,
}: {
  scene: Scene
  media: Media[]
  width?: number
}) {
  return <SceneRender scene={scene} media={media} width={width} preferThumb />
}

function MediaRender({
  item,
  width,
  sound,
  reloadKey,
  animate,
}: {
  item: EngineItem
  width: number
  sound: boolean
  reloadKey?: string | number
  animate: boolean
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
    return (
      <FitScene
        scene={scene}
        media={media}
        preferThumb={width < 480}
        animate={animate}
        layerDuration={item.duration}
      />
    )
  }
  if (item.kind === 'image' && item.stream_url) {
    return <img className="fit-media" src={item.stream_url} alt={item.title} />
  }
  if (item.kind === 'video' && item.stream_url) {
    return (
      <video
        className="fit-media"
        src={item.stream_url}
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
  sound?: boolean
  reloadKey?: string | number
  /** Play the scene layers' IN/LOOP/OUT animations (monitors). */
  animate?: boolean
}

export default function ProgramPreview({
  item,
  emptyLabel,
  width,
  sound = false,
  reloadKey,
  animate = false,
}: Props) {
  const tileRef = useRef<HTMLDivElement>(null)
  // Enabling sound is allowed once the user has interacted; the full-screen
  // button counts as that interaction, so the audio plays right away.
  const [soundOn, setSoundOn] = useState(sound)
  useEffect(() => setSoundOn(sound), [sound])

  if (!item) {
    return (
      <div className="program-tile" ref={tileRef}>
        <div className="stage-empty">
          <span>{emptyLabel}</span>
        </div>
      </div>
    )
  }
  return (
    <div className="program-tile" ref={tileRef}>
      <MediaRender item={item} width={width} sound={soundOn} reloadKey={reloadKey} animate={animate} />
      <button
        className="program-fullscreen"
        title="Plein écran (avec son)"
        onClick={() => {
          setSoundOn(true)
          if (document.fullscreenElement) void document.exitFullscreen()
          else void tileRef.current?.requestFullscreen?.()
        }}
      >
        ⛶
      </button>
    </div>
  )
}
