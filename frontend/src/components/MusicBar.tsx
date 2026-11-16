// Sound console shown at the bottom of the Aperçu page.
//
// It is the control of the **current music**:
//   * when the live is running it follows the program: the progress bar shows
//     the position of what is on air (from the engine, not a local guess), and
//     dragging it seeks the live. Pausing pauses the live too (the engine
//     freezes); resuming continues where it stopped.
//   * when the live is stopped it follows the item currently shown in the
//     preview: the track plays locally with a seekable bar.
//
// A volume slider sets the monitor output level (it never changes the on-air
// mix — only what the operator hears).

import { useEffect, useRef, useState } from 'react'
import { api, type EngineItem, type EngineStatus } from '../api'
import { formatDuration } from './ui'
import { IconMusic } from './icons'
import { getMonitorVolume, setMonitorVolume, subscribeMonitorSound } from '../lib/monitorSound'

export default function MusicBar({
  item,
  program,
  onChanged,
}: {
  /** Item currently shown in the preview (when the live is stopped). */
  item: EngineItem | null
  program: EngineStatus | null
  onChanged: () => void
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [busy, setBusy] = useState(false)
  const [volume, setVolume] = useState(() => getMonitorVolume())

  const running = Boolean(program?.running)
  const programItem = program?.current ?? null
  // On air the console follows the program; otherwise the preview item.
  const active = running ? programItem : item
  const url = active?.background_audio_url ?? null
  const paused = Boolean(program?.paused)

  // Keep the local slider in step with the shared volume (it can be changed
  // elsewhere, e.g. from another monitor).
  useEffect(() => subscribeMonitorSound((st) => setVolume(st.volume)), [])

  // Local preview playback (only when the live is stopped). Reload only when the
  // track actually changes, so the preview music keeps playing otherwise.
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (running) return
    if (url && el.getAttribute('src') !== url) {
      el.src = url
      setPosition(0)
      setDuration(0)
      setPlaying(false)
      void el.play().catch(() => {
        /* autoplay may be blocked until the next user gesture */
      })
    } else if (!url) {
      el.pause()
      el.removeAttribute('src')
      el.load()
      setPlaying(false)
    }
  }, [url, running])

  if (!active || (!url && !running)) return null

  // On air the position/duration come from the engine, so the bar matches the live.
  const livePos = running ? Math.min(program?.position ?? 0, program?.cycle_duration ?? 0) : position
  const liveDur = running ? program?.cycle_duration ?? 0 : duration

  const toggle = async () => {
    if (running) {
      setBusy(true)
      try {
        await api.post(paused ? '/api/broadcast/resume' : '/api/broadcast/pause')
        onChanged()
      } finally {
        setBusy(false)
      }
      return
    }
    const el = audioRef.current
    if (!el) return
    if (el.paused) void el.play().catch(() => {})
    else el.pause()
  }

  const seek = async (value: number) => {
    if (running) {
      setBusy(true)
      try {
        await api.post('/api/broadcast/seek', { position: value })
        onChanged()
      } finally {
        setBusy(false)
      }
      return
    }
    const el = audioRef.current
    if (!el || !Number.isFinite(el.duration)) return
    el.currentTime = Math.max(0, Math.min(value, el.duration))
    setPosition(el.currentTime)
  }

  const visual = active.background_audio_id
    ? `/api/media/${active.background_audio_id}/preview`
    : null

  return (
    <div className="music-bar">
      <div className="music-bar-visual">
        {visual ? <img src={visual} alt="" /> : <IconMusic size={22} />}
      </div>
      <button
        className="btn btn-sm btn-icon"
        onClick={() => void toggle()}
        disabled={busy}
        title={
          running
            ? paused
              ? 'Reprendre le direct'
              : 'Mettre le direct en pause'
            : playing
              ? 'Pause'
              : 'Lecture'
        }
      >
        {running ? (paused ? '▶' : '❚❚') : playing ? '❚❚' : '▶'}
      </button>
      <div className="music-bar-main">
        <div className="music-bar-title">
          <IconMusic size={13} /> {active.background_audio_title ?? active.title ?? 'Musique'}
          {running && <span className="badge badge-live">EN DIRECT</span>}
        </div>
        <input
          className="music-bar-seek"
          type="range"
          min={0}
          max={liveDur || 0}
          step={0.1}
          value={Math.min(livePos, liveDur || 0)}
          onChange={(e) => void seek(Number(e.target.value))}
          title="Reculer / avancer"
        />
      </div>
      <span className="text-sm muted-2 nowrap">
        {formatDuration(livePos)} / {formatDuration(liveDur)}
      </span>
      {/* Monitor output volume (what the operator hears, not the on-air mix). */}
      <div className="music-bar-volume" title="Volume du moniteur">
        <span aria-hidden>🔊</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => {
            const v = Number(e.target.value)
            setVolume(v)
            setMonitorVolume(v)
          }}
        />
      </div>
      {!running && (
        <audio
          ref={audioRef}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        />
      )}
    </div>
  )
}
