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
import { fontFamily, fontWeight } from '../lib/fonts'
import {
  followMonitorSound,
  isMonitorSoundSelected,
  monitorAudioUrl,
  monitorAudioVolume,
  requestMonitorSound,
  subscribeMonitorSound,
  toggleMonitorSound,
  type MonitorSource,
} from '../lib/monitorSound'
import { IconMusic } from './icons'
import { Spinner } from './ui'

interface SceneLike {
  width: number
  height: number
  background: string
  layers: SceneLayer[]
}

// Countdown layer. On air, `elapsed` is the number of seconds the item has been
// playing (from the engine), so the timer reflects reality. In the preview
// (nothing on air yet) `elapsed` is null and we show the starting value, frozen,
// so the preview never runs ahead of the programme.
function Countdown({
  total,
  mode,
  fontPx,
  elapsed = null,
}: {
  total: number
  mode: string
  fontPx: number
  elapsed?: number | null
}) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (elapsed !== null) return
    const start = Date.now()
    const t = window.setInterval(() => setNow(Math.floor((Date.now() - start) / 1000)), 250)
    return () => window.clearInterval(t)
  }, [total, mode, elapsed])
  const played = elapsed !== null ? elapsed + now : 0
  const secs = mode === 'up' ? total + played : Math.max(0, total - played)
  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')
  return <span style={{ fontSize: fontPx }}>{mm}:{ss}</span>
}

// Live date/time, mirroring the FFmpeg `%{localtime:...}` expansion. The format
// is a strftime string; we translate the tokens the editor offers.
const FR_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const FR_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

export function formatClock(date: Date, fmt: string, utc: boolean): string {
  const d = utc
    ? new Date(date.getTime() + date.getTimezoneOffset() * 60000)
    : date
  const pad = (n: number) => String(n).padStart(2, '0')
  const hours24 = d.getHours()
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  const map: Record<string, string> = {
    '%H': pad(hours24),
    '%M': pad(d.getMinutes()),
    '%S': pad(d.getSeconds()),
    '%I': pad(hours12),
    '%p': hours24 < 12 ? 'AM' : 'PM',
    '%d': pad(d.getDate()),
    '%m': pad(d.getMonth() + 1),
    '%Y': String(d.getFullYear()),
    '%A': FR_DAYS[d.getDay()],
    '%B': FR_MONTHS[d.getMonth()],
  }
  return fmt.replace(/%[HMSIpdmYA B]/g, (token) => map[token] ?? token)
}

function Clock({ fmt, utc, fontPx }: { fmt: string; utc: boolean; fontPx: number }) {
  const [text, setText] = useState(() => formatClock(new Date(), fmt, utc))
  useEffect(() => {
    const t = window.setInterval(() => setText(formatClock(new Date(), fmt, utc)), 1000)
    return () => window.clearInterval(t)
  }, [fmt, utc])
  return <span style={{ fontSize: fontPx }}>{text}</span>
}

// Scrolling headline band fed by an RSS feed. The editor previews the first
// headline; the on-air text is built by the engine from the cached feed.
function Ticker({ layer, fontPx }: { layer: SceneLayer; fontPx: number }) {
  const [headline, setHeadline] = useState(layer.text || 'Bandeau d’actualités')
  useEffect(() => {
    const url = layer.feed_url
    if (!url) return
    let active = true
    fetch(`/api/meta/feed?url=${encodeURIComponent(url)}&limit=1`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => {
        if (active && d.items?.length) setHeadline(d.items[0].title)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [layer.feed_url, layer.text])
  return <span style={{ fontSize: fontPx }}>{headline}</span>
}

function layerBadge(l: SceneLayer): string | null {
  if (l.type === 'reactive') return `Réactif · ${l.visualizer ?? ''}`
  if (l.type === 'code') return `Code · ${l.code ?? ''}`
  if (l.type === 'chat') return `Chat · ${l.chat_source ?? ''}`
  if (l.type === 'countdown') return `Compte à rebours · ${l.countdown_seconds ?? 60}s`
  if (l.type === 'clock') return `Horloge · ${l.clock_format ?? '%H:%M'}`
  if (l.type === 'ticker') return `Bandeau · ${l.feed_url ? 'RSS' : 'vide'}`
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
  elapsed = null,
}: {
  scene: SceneLike
  media: Media[]
  width: number
  preferThumb?: boolean
  /** Play the layers' IN/LOOP/OUT animations (monitors + editor). */
  animate?: boolean
  /** On-air duration of each layer, used to delay OUT animations. */
  layerDuration?: number
  /** Seconds the item has been on air (drives the countdown); null in preview. */
  elapsed?: number | null
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
          const isBox =
            isText || l.type === 'chat' || l.type === 'countdown' || l.type === 'clock' || l.type === 'ticker'
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
                fontFamily: isBox ? fontFamily(l.font) : undefined,
                fontWeight: isBox ? fontWeight(l.font) : undefined,
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
                    elapsed={elapsed}
                  />
                )}
                {l.type === 'clock' && (
                  <Clock
                    fmt={l.clock_format ?? '%H:%M'}
                    utc={Boolean(l.clock_utc)}
                    fontPx={(l.font_size ?? 64) * scale}
                  />
                )}
                {l.type === 'ticker' && <Ticker layer={l} fontPx={(l.font_size ?? 40) * scale} />}
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
  elapsed = null,
}: {
  scene: SceneLike
  media: Media[]
  preferThumb?: boolean
  animate?: boolean
  layerDuration?: number
  elapsed?: number | null
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
          elapsed={elapsed}
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
  soundSource,
  reloadKey,
  animate,
  elapsed,
}: {
  item: EngineItem
  width: number
  soundSource: MonitorSource
  reloadKey?: string | number
  animate: boolean
  elapsed?: number | null
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

  // The monitor's sound is played by the shared element (monitorSound.ts), not
  // by an <audio> inside this component, so it keeps playing when the operator
  // leaves the page. This keeps the element in step with the current item.
  const audioUrl = monitorAudioUrl(item)
  const audioVolume = monitorAudioVolume(item)
  useEffect(() => {
    followMonitorSound(soundSource, item)
  }, [soundSource, item, audioUrl, audioVolume])

  if (item.scene_id) {
    // A visible loader (spinner + label) instead of a black box, so a slow load
    // never looks like a dead/black screen.
    if (!ready) {
      return (
        <div className="stage-empty stage-loading">
          <Spinner large />
          <span>Chargement de la scène…</span>
        </div>
      )
    }
    if (!scene) {
      return (
        <div className="stage-empty stage-loading">
          <span>Scène indisponible</span>
          <span className="text-sm muted-2">Vérifiez la connexion au serveur.</span>
        </div>
      )
    }
    return (
      <FitScene
        scene={scene}
        media={media}
        preferThumb={width < 480}
        animate={animate}
        layerDuration={item.duration}
        elapsed={elapsed}
      />
    )
  }

  if (item.kind === 'image' && item.stream_url) {
    return <img className="fit-media" src={item.stream_url} alt={item.title} />
  }
  if (item.kind === 'video' && item.stream_url) {
    // Always muted here: the sound comes from the shared element above.
    return (
      <video className="fit-media" src={item.stream_url} muted autoPlay loop playsInline />
    )
  }
  if (item.kind === 'audio' && item.stream_url) {
    // An audio-only item has no picture: keep a short label on screen; the sound
    // is played by the shared element.
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
  /** Ask for this monitor's sound on mount (program monitor, detached window). */
  sound?: boolean
  /** Identity of this monitor for the shared sound element (default "preview"). */
  soundSource?: MonitorSource
  reloadKey?: string | number
  /** Play the scene layers' IN/LOOP/OUT animations (monitors). */
  animate?: boolean
  /** Seconds the item has been on air (drives the countdown). */
  elapsed?: number | null
}

export default function ProgramPreview({
  item,
  emptyLabel,
  width,
  sound = false,
  soundSource = 'preview',
  reloadKey,
  animate = false,
  elapsed = null,
}: Props) {
  const tileRef = useRef<HTMLDivElement>(null)
  // Whether this monitor is the one the operator selected to hear. It is the
  // module state (not a local flag) so the sound survives page changes.
  const [soundOn, setSoundOn] = useState(false)
  useEffect(
    () => subscribeMonitorSound((st) => setSoundOn(st.source === soundSource && st.enabled)),
    [soundSource],
  )
  // `sound` asks to select this monitor on mount. Idempotent: it never turns an
  // already-selected monitor off, so a page remount does not interrupt it.
  useEffect(() => {
    if (!sound) return
    if (monitorAudioUrl(item) && !isMonitorSoundSelected(soundSource)) {
      requestMonitorSound(soundSource, item)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sound, soundSource])

  if (!item) {
    return (
      <div className="program-tile" ref={tileRef}>
        <div className="stage-empty">
          <span>{emptyLabel}</span>
        </div>
      </div>
    )
  }
  const audioUrl = monitorAudioUrl(item)
  return (
    <div className="program-tile" ref={tileRef}>
      <MediaRender
        item={item}
        width={width}
        soundSource={soundSource}
        reloadKey={reloadKey}
        animate={animate}
        elapsed={elapsed}
      />
      {audioUrl && (
        <button
          className="program-fullscreen"
          style={{ right: 44 }}
          title={soundOn ? 'Couper le son du moniteur' : 'Activer le son du moniteur'}
          onClick={() => toggleMonitorSound(soundSource, item)}
        >
          <IconMusic size={15} />
        </button>
      )}
      <button
        className="program-fullscreen"
        title="Plein écran (avec son)"
        onClick={() => {
          if (!soundOn && audioUrl) {
            requestMonitorSound(soundSource, item)
          }
          if (document.fullscreenElement) void document.exitFullscreen()
          else void tileRef.current?.requestFullscreen?.()
        }}
      >
        ⛶
      </button>
    </div>
  )
}
