// Sound console shown at the bottom of the Aperçu page.
//
// It follows the **program** when the live is running: the progress bar shows the
// position of what is on air (from the engine, not a local guess), and dragging
// it seeks the live. Pausing pauses the live too (the engine freezes); resuming
// continues where it stopped.
//
// When the live is stopped it falls back to the preview playlist: the current
// track is played locally with a seekable bar.

import { useEffect, useRef, useState } from 'react'
import { api, type EngineItem, type EngineStatus } from '../api'
import { formatDuration } from './ui'
import { IconMusic } from './icons'

function firstWithMusic(items: EngineItem[]): EngineItem | null {
  for (const item of items) {
    if (item.background_audio_url) return item
  }
  return null
}

export default function MusicBar({
  items,
  program,
  onChanged,
}: {
  items: EngineItem[]
  program: EngineStatus | null
  onChanged: () => void
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [busy, setBusy] = useState(false)

  const running = Boolean(program?.running)
  const programItem = program?.current ?? null
  const previewItem = firstWithMusic(items)
  // On air the console follows the program; otherwise the preview playlist.
  const item = running ? programItem : previewItem
  const url = item?.background_audio_url ?? null
  const paused = Boolean(program?.paused)

  // Local preview playback (only when the live is stopped).
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    setPosition(0)
    setDuration(0)
    setPlaying(false)
    if (!running && url) el.load()
  }, [url, running])

  if (!item || (!url && !running)) return null

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

  const visual = item.background_audio_id
    ? `/api/media/${item.background_audio_id}/preview`
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
          <IconMusic size={13} /> {item.background_audio_title ?? item.title ?? 'Musique'}
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
      {!running && (
        <audio
          ref={audioRef}
          src={url ?? undefined}
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
