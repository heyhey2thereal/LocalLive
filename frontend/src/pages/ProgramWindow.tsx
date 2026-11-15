// Standalone render window (opened with window.open from the switcher). Shows
// either the PROGRAM (live) or a PREVIEW playlist full-size with sound, and can
// go full-screen. Meant to be placed on a second screen for the operator.
//
// Browsers block autoplay with sound until the user interacts with the page, so
// a small "Activer le son" button appears until the first interaction.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type PreviewData } from '../api'
import { usePoll } from '../lib/usePoll'
import ProgramPreview from '../components/ProgramPreview'

export default function ProgramWindow() {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view') === 'preview' ? 'preview' : 'program'
  const playlistId = params.get('playlist_id')
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [fullscreen, setFullscreen] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement))
    window.addEventListener('resize', onResize)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      window.removeEventListener('resize', onResize)
      document.removeEventListener('fullscreenchange', onFs)
    }
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void rootRef.current?.requestFullscreen?.()
    }
  }, [])

  const poll = usePoll<PreviewData>(
    (signal) =>
      api.get<PreviewData>(
        '/api/broadcast/preview' + (playlistId ? `?playlist_id=${playlistId}` : ''),
        signal,
      ),
    2000,
  )

  const program = poll.data?.program
  const preview = poll.data?.preview
  const item = view === 'program' ? program?.current ?? null : preview?.items[0] ?? null
  // Elapsed seconds of the current program item (drives the countdown), so the
  // detached window matches the switcher.
  const programElapsed =
    program && program.current_index >= 0
      ? Math.max(
          0,
          program.position -
            program.items.slice(0, program.current_index).reduce((s, it) => s + (it.duration || 0), 0),
        )
      : 0

  // Fit the 16:9 render inside the window; no margin in full-screen.
  const pad = fullscreen ? 0 : 24
  const width = Math.min(size.w - pad, ((size.h - (fullscreen ? 0 : 48)) * 16) / 9)

  return (
    <div className="program-window" ref={rootRef} onClick={() => setSoundEnabled(true)}>
      {!fullscreen && (
        <div className="program-window-bar">
          <span className={`badge ${view === 'program' ? 'badge-live' : 'badge-info'}`}>
            {view === 'program' ? 'PROGRAMME' : 'APERÇU'}
          </span>
          <span className="text-sm muted-2 truncate">
            {view === 'program' ? program?.playlist_name || '—' : preview?.playlist_name || '—'}
          </span>
          <div className="flex gap-8 items-center" style={{ marginLeft: 'auto' }}>
            {!soundEnabled && (
              <button className="btn btn-sm" onClick={() => setSoundEnabled(true)}>
                Activer le son
              </button>
            )}
            <button className="btn btn-sm" onClick={toggleFullscreen}>
              Plein écran
            </button>
          </div>
        </div>
      )}
      <div className="program-window-stage">
        <ProgramPreview item={item} emptyLabel="Rien à afficher" width={width} sound={soundEnabled} animate elapsed={view === 'program' ? programElapsed : null} />
      </div>
    </div>
  )
}
