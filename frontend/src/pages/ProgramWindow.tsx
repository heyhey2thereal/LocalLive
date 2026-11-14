// Standalone render window (opened with window.open from the switcher). Shows
// either the PROGRAM (live) or a PREVIEW playlist full-size, refreshed by poll.
// Meant to be placed on a second screen for the operator.

import { useEffect, useState } from 'react'
import { api, type PreviewData } from '../api'
import { usePoll } from '../lib/usePoll'
import ProgramPreview from '../components/ProgramPreview'

export default function ProgramWindow() {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view') === 'preview' ? 'preview' : 'program'
  const playlistId = params.get('playlist_id')
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
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

  // Fit the 16:9 render inside the window with a small margin.
  const width = Math.min(size.w - 24, ((size.h - 48) * 16) / 9)
  const height = (width * 9) / 16

  return (
    <div className="program-window">
      <div className="program-window-bar">
        <span className={`badge ${view === 'program' ? 'badge-live' : 'badge-info'}`}>
          {view === 'program' ? 'PROGRAMME' : 'APERÇU'}
        </span>
        <span className="text-sm muted-2 truncate">
          {view === 'program' ? program?.playlist_name || '—' : preview?.playlist_name || '—'}
        </span>
      </div>
      <div className="program-window-stage">
        <ProgramPreview item={item} emptyLabel="Rien à afficher" width={width} height={height} />
      </div>
    </div>
  )
}
