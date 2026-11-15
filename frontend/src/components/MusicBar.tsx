// Music bar shown at the bottom of the Aperçu page.
//
// When the preview playlist carries background music, this bar shows the current
// track, its visual (the waveform the server renders for the audio) and a
// seekable progress bar: dragging the bar seeks the music forward or backward.
//
// It owns its own <audio> element (separate from the monitor sound): the preview
// page's music is heard here, while the live sound is controlled from the program
// monitor.

import { useEffect, useRef, useState } from 'react'
import type { EngineItem } from '../api'
import { formatDuration } from './ui'
import { IconMusic } from './icons'

/** The first preview item that carries background music, or null. */
function musicItem(items: EngineItem[]): EngineItem | null {
  for (const item of items) {
    if (item.background_audio_url) return item
  }
  return null
}

export default function MusicBar({ items }: { items: EngineItem[] }) {
  const item = musicItem(items)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const url = item?.background_audio_url ?? null

  // (Re)load the element whenever the track changes.
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    setPosition(0)
    setDuration(0)
    setPlaying(false)
    if (url) el.load()
  }, [url])

  if (!item || !url) return null

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      void el.play().catch(() => {})
    } else {
      el.pause()
    }
  }

  const seek = (value: number) => {
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
      <button className="btn btn-sm btn-icon" onClick={toggle} title={playing ? 'Pause' : 'Lecture'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="music-bar-main">
        <div className="music-bar-title">
          <IconMusic size={13} /> {item.background_audio_title ?? item.title ?? 'Musique'}
        </div>
        <input
          className="music-bar-seek"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(position, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          title="Reculer / avancer dans la musique"
        />
      </div>
      <span className="text-sm muted-2 nowrap">
        {formatDuration(position)} / {formatDuration(duration)}
      </span>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
      />
    </div>
  )
}
