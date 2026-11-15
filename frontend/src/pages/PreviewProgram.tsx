// Preview / Program switcher.
//
// Two identical monitors: PREVIEW (left) and PROGRAM (right). The arrow between
// them takes the preview to air and swaps the two (the old program becomes the
// preview). A transition style is chosen below and is played as a visual effect
// on the monitors when you take. There is also a single live start/stop button.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Catalog, type EngineItem, type Playlist, type PreviewData } from '../api'
import { usePoll } from '../lib/usePoll'
import ProgramPreview from '../components/ProgramPreview'
import MusicBar from '../components/MusicBar'
import { formatDuration, formatUptime, Loading, Modal, useToast } from '../components/ui'
import { IconArrowRight, IconPlay, IconStop } from '../components/icons'
import { setMonitorPageVisible } from '../lib/monitorSound'

// Map a transition id to a CSS animation class used to animate the monitors.
function transitionClass(id: string): string {
  if (id === 'cut') return ''
  if (id.startsWith('slide') || id.startsWith('cover') || id.startsWith('reveal')) return 'tx-slide'
  if (id.startsWith('wipe') || id.startsWith('smooth')) return 'tx-wipe'
  if (id === 'circleopen' || id === 'circleclose' || id === 'circlecrop') return 'tx-circle'
  if (id === 'zoomin' || id === 'squeezeh' || id === 'squeezev') return 'tx-zoom'
  if (id === 'pixelize' || id === 'hblur') return 'tx-blur'
  return 'tx-fade'
}

// Controls shown under a monitor whose item carries a countdown layer: start /
// restart it, or add time (the seconds are added to the scene's starting value,
// so the engine draws a longer timer too).
function CountdownControls({
  item,
  onChanged,
  onStart,
  running,
}: {
  item: EngineItem
  onChanged: () => void
  onStart: () => void
  running: boolean
}) {
  const { push } = useToast()
  const [busy, setBusy] = useState(false)
  const seconds = item.countdown?.seconds ?? 60
  const send = async (action: 'restart' | 'add', amount = 0) => {
    setBusy(true)
    try {
      await api.post('/api/broadcast/countdown', { item_id: item.id, action, seconds: amount })
      push({
        kind: 'ok',
        title: action === 'restart' ? 'Compte à rebours relancé' : `+${amount} s ajoutées`,
      })
      onChanged()
    } catch (err: any) {
      push({ kind: 'err', title: 'Compte à rebours impossible', message: err?.message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="countdown-controls">
      <span className="text-sm muted-2 nowrap">Compte à rebours · {seconds}s</span>
      <button
        className="btn btn-sm btn-primary"
        disabled={busy}
        onClick={() => {
          // On air: restart the item so the countdown starts now. In the preview
          // (or stopped) it just starts the local timer.
          if (running) void send('restart')
          onStart()
        }}
        title="Démarrer / relancer le décompte"
      >
        ▶ Démarrer
      </button>
      {running && (
        <button className="btn btn-sm" disabled={busy} onClick={() => void send('restart')} title="Relancer le décompte">
          ↻ Relancer
        </button>
      )}
      {[10, 30, 60].map((amount) => (
        <button key={amount} className="btn btn-sm" disabled={busy} onClick={() => void send('add', amount)}>
          +{amount}s
        </button>
      ))}
    </div>
  )
}

export default function PreviewProgram() {
  const { push } = useToast()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedId, setSelectedId] = useState<number | ''>('')
  const [transition, setTransition] = useState('fade')
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [busy, setBusy] = useState(false)
  const [txClass, setTxClass] = useState('')
  const [confirm, setConfirm] = useState<'start' | 'stop' | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  // Output chosen in the start dialog: 'primary', 'all' or a stream id.
  const [startOutput, setStartOutput] = useState<string>('primary')
  const txTimer = useRef<number | null>(null)

  // Fast polling so preview/program react quickly (no perceptible delay).
  const poll = usePoll<PreviewData>(
    (signal) =>
      api.get<PreviewData>(
        '/api/broadcast/preview' + (selectedId ? `?playlist_id=${selectedId}` : ''),
        signal,
      ),
    1000,
  )

  const loadPlaylists = useCallback(async () => {
    try {
      const [data, cat] = await Promise.all([
        api.get<{ items: Playlist[] }>('/api/playlists'),
        api.get<Catalog>('/api/meta/catalog').catch(() => null),
      ])
      setPlaylists(data.items)
      setCatalog(cat)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void loadPlaylists()
  }, [loadPlaylists])

  // Periodically refresh the rendered content so scene edits appear live.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 2000)
    return () => window.clearInterval(t)
  }, [])

  const program = poll.data?.program
  const preview = poll.data?.preview
  const availableOutputs = poll.data?.outputs ?? []
  const reloadKey = `${program?.playlist_id ?? ''}-${preview?.playlist_id ?? ''}-${tick}`

  // The preview monitor walks through the playlist on its own timer, advancing to
  // the next item once the current one's duration has elapsed (so a 5 s scene is
  // followed by the next item). Reset whenever the playlist changes.
  const [previewIndex, setPreviewIndex] = useState(0)
  const previewItems = preview?.items ?? []
  useEffect(() => {
    setPreviewIndex(0)
  }, [preview?.playlist_id])
  useEffect(() => {
    if (previewItems.length <= 1) return
    const current = previewItems[previewIndex] ?? previewItems[0]
    const seconds = Math.max(0.5, current?.duration || 5)
    const t = window.setTimeout(() => {
      setPreviewIndex((i) => (i + 1) % previewItems.length)
    }, seconds * 1000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewIndex, preview?.playlist_id, previewItems.map((i) => i.id).join(','), previewItems.map((i) => i.duration).join(',')])

  const previewItem: EngineItem | null = preview?.items[previewIndex] ?? null
  const programItem: EngineItem | null = program?.current ?? null
  const target = selectedId || preview?.playlist_id || null
  const running = Boolean(program?.running)

  // Preview countdown: ms epoch when the operator pressed "Démarrer" for the
  // current preview item, so the preview timer runs (it is otherwise frozen).
  const [countdownStart, setCountdownStart] = useState<number | null>(null)
  useEffect(() => {
    setCountdownStart(null)
  }, [previewItem?.id])

  // Monitor sound: the sound is controlled from the program monitor only. This
  // page just makes the shared element audible while it is shown (leaving only
  // mutes it, never stops it, so returning is instant).
  useEffect(() => {
    setMonitorPageVisible(true)
    return () => setMonitorPageVisible(false)
  }, [])

  // Seconds the *current program item* has been playing: total position minus
  // the durations of the items already passed. Used by the countdown layer so
  // the monitor matches the actual on-air timer instead of restarting on load.
  const programElapsed =
    program && program.current_index >= 0
      ? Math.max(
          0,
          program.position -
            program.items
              .slice(0, program.current_index)
              .reduce((sum, it) => sum + (it.duration || 0), 0),
        )
      : 0

  // Live stream timer (uptime of the broadcast), ticking every second.
  const [, forceTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => forceTick((v) => v + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  const streamSeconds = program?.started_at
    ? Math.max(0, Math.floor(Date.now() / 1000 - program.started_at))
    : 0

  const playTransition = () => {
    const cls = transitionClass(transition)
    setTxClass(cls)
    if (txTimer.current) window.clearTimeout(txTimer.current)
    txTimer.current = window.setTimeout(() => setTxClass(''), 900)
  }

  // Take the preview to air. When the live is running the playlist is swapped on
  // air; when it is stopped the programme is still switched (the program monitor
  // shows the chosen playlist) but nothing is streamed.
  const swap = async () => {
    if (!target) {
      push({ kind: 'err', title: 'Choisissez d’abord une playlist dans l’aperçu' })
      return
    }
    setBusy(true)
    const previousProgram = program?.playlist_id ?? null
    try {
      const res = await api.post<{ ok: boolean; switched?: boolean; live?: boolean }>(
        '/api/broadcast/take',
        { playlist_id: target },
      )
      if (res.switched === false) return
      playTransition()
      push({
        kind: 'ok',
        title: 'Prise d’antenne effectuée',
        ...(res.live === false ? { message: 'Le direct est arrêté : cliquez sur « Démarrer le direct » pour diffuser.' } : {}),
      })
      setSelectedId(previousProgram ?? '')
      poll.refresh()
    } catch (err: any) {
      push({ kind: 'err', title: 'Prise d’antenne impossible', message: err?.message })
    } finally {
      setBusy(false)
    }
  }

  const startLive = async () => {
    setBusy(true)
    try {
      const outputId: number | string =
        startOutput === 'primary' || startOutput === 'all' ? startOutput : Number(startOutput)
      await api.post('/api/broadcast/start', {
        ...(target ? { playlist_id: target } : {}),
        output_id: outputId,
      })
      push({ kind: 'ok', title: 'Diffusion démarrée' })
      poll.refresh()
    } catch (err: any) {
      push({ kind: 'err', title: 'Démarrage impossible', message: err?.message })
    } finally {
      setBusy(false)
    }
  }

  const stopLive = async () => {
    setBusy(true)
    try {
      await api.post('/api/broadcast/stop')
      push({ kind: 'ok', title: 'Diffusion arrêtée' })
      poll.refresh()
    } catch (err: any) {
      push({ kind: 'err', title: 'Arrêt impossible', message: err?.message })
    } finally {
      setBusy(false)
    }
  }

  const skip = async (direction: 1 | -1) => {
    setBusy(true)
    try {
      await api.post(`/api/broadcast/${direction > 0 ? 'next' : 'previous'}`, {})
      push({ kind: 'ok', title: direction > 0 ? 'Élément suivant' : 'Élément précédent' })
      poll.refresh()
    } catch (err: any) {
      push({ kind: 'err', title: 'Passage impossible', message: err?.message })
    } finally {
      setBusy(false)
    }
  }

  // Keyboard shortcuts for a live operator: space takes the preview to air,
  // arrows skip items, ? shows the help. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (e.key === '?') {
        e.preventDefault()
        setShowHelp((v) => !v)
      } else if (e.key === ' ' && !busy && target) {
        e.preventDefault()
        void swap()
      } else if (e.key === 'ArrowRight' && running && !busy) {
        e.preventDefault()
        void skip(1)
      } else if (e.key === 'ArrowLeft' && running && !busy) {
        e.preventDefault()
        void skip(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, running, target, transition])

  if (poll.loading && !program) return <Loading />

  return (
    <div className="switcher-page">
      <div className="flex justify-between items-center mb-8">
        <span className="text-sm muted-2">
          Raccourcis : Espace = prise d'antenne · ← → = élément précédent/suivant
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowHelp(true)} title="Aide des raccourcis">
          ? Aide
        </button>
      </div>
      <div className="switcher-row">
        {/* PREVIEW (left) */}
        <div className="switcher-monitor">
          <span className={`switcher-tx ${txClass}`} aria-hidden />
          <div className="switcher-head">
            <span className="badge badge-info">APERÇU</span>
            {preview && (
              <span
                className={`badge ${preview.loop ? 'badge-ok' : ''}`}
                title={preview.loop ? 'La playlist tourne en boucle' : 'Lecture unique'}
              >
                {preview.loop ? '↻ Boucle' : '→ Lecture unique'}
              </span>
            )}
            <span className="text-sm muted-2 truncate">{preview?.playlist_name || '—'}</span>
          </div>
          <ProgramPreview
            item={previewItem}
            emptyLabel="Aucune playlist dans l'aperçu"
            width={520}
            soundSource="preview"
            reloadKey={reloadKey}
            animate
            startedAt={countdownStart}
          />
          {previewItem?.countdown && (
            <CountdownControls
              item={previewItem}
              running={false}
              onChanged={poll.refresh}
              onStart={() => setCountdownStart(Date.now())}
            />
          )}
          <div className="switcher-monitor-foot">
            <select
              className="select grow"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">— Choisir une playlist —</option>
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.item_count})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Transition arrow between the monitors */}
        <div className="switcher-arrow">
          <button className="switcher-arrow-btn" disabled={busy || !target} onClick={swap} title="Prendre l'antenne">
            <IconArrowRight size={22} />
          </button>
        </div>

        {/* PROGRAM (right) */}
        <div className="switcher-monitor">
          <span className={`switcher-tx ${txClass}`} aria-hidden />
          <div className="switcher-head">
            <span className="badge badge-live">
              <span className="dot dot-live" /> PROGRAMME
            </span>
            <span className="text-sm muted-2 truncate">{program?.playlist_name || '—'}</span>
          </div>
          <ProgramPreview
            item={programItem}
            emptyLabel="La diffusion est à l'arrêt"
            width={520}
            soundSource="program"
            sound
            reloadKey={reloadKey}
            animate
            elapsed={running ? programElapsed : null}
          />
          {running && programItem?.countdown && (
            <CountdownControls
              item={programItem}
              running
              onChanged={poll.refresh}
              onStart={() => poll.refresh()}
            />
          )}
          <div className="switcher-monitor-foot">
            <span className="text-sm muted-2">
              {running && program
                ? `${formatDuration(program.position)} / ${formatDuration(program.cycle_duration)}`
                : 'Diffusion à l’arrêt'}
            </span>
            {running ? (
              <span className="badge badge-live" title="Durée du direct">
                ● {formatUptime(streamSeconds)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Controls: live start/stop + transition */}
      <div className="switcher-controls">
        <div className="flex gap-8 items-center">
          {running ? (
            <button className="btn btn-danger btn-lg" disabled={busy} onClick={() => setConfirm('stop')}>
              <IconStop size={18} /> Arrêter le direct
            </button>
          ) : (
            <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => setConfirm('start')}>
              <IconPlay size={18} /> Démarrer le direct
            </button>
          )}
          <button
            className="btn"
            disabled={busy || !running}
            onClick={() => void skip(-1)}
            title="Élément précédent"
          >
            ⏮
          </button>
          <button
            className="btn"
            disabled={busy || !running}
            onClick={() => void skip(1)}
            title="Élément suivant"
          >
            ⏭
          </button>
        </div>
        <div className="flex gap-8 items-center">
          <span className="text-sm muted-2 nowrap">Transition</span>
          <select className="select" style={{ maxWidth: 220 }} value={transition} onChange={(e) => setTransition(e.target.value)}>
            {(catalog?.transitions ?? []).map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Preview contents */}
      {preview && preview.items.length > 0 && (
        <div className="card mt-16">
          <div className="card-head">
            <span className="card-title">Contenu de l'aperçu</span>
            <span className="text-sm muted-2">
              {preview.items.length} élément(s) · {formatDuration(preview.duration)}
            </span>
          </div>
          <div className="list" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {preview.items.map((item, i) => (
              <div
                key={item.id}
                className="row"
                onClick={() => setPreviewIndex(i)}
                title="Afficher cet élément dans l'aperçu"
                style={{
                  padding: '6px 10px',
                  cursor: 'pointer',
                  background: i === previewIndex ? 'var(--accent-soft)' : undefined,
                  border: `1px solid ${i === previewIndex ? 'var(--accent-line)' : 'transparent'}`,
                }}
              >
                <span className="text-sm muted-2" style={{ width: 20 }}>
                  {i + 1}
                </span>
                <div className="row-main">
                  <div className="row-title">{item.title}</div>
                  <div className="row-sub">
                    {item.kind} · {formatDuration(item.duration)}
                    {item.background_audio_url
                      ? item.background_audio_continue
                        ? ' · ♪ musique (suite)'
                        : ' · ♪ musique'
                      : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sound console: follows the program when on air, else the preview. */}
      {((preview && preview.items.length > 0) || running) && (
        <MusicBar items={preview?.items ?? []} program={program ?? null} onChanged={poll.refresh} />
      )}

      {showHelp && (
        <Modal title="Raccourcis clavier" onClose={() => setShowHelp(false)}>
          <div className="list">
            {[
              ['Espace', "Prendre l'antenne (aperçu → programme)"],
              ['→', 'Élément suivant'],
              ['←', 'Élément précédent'],
              ['?', 'Afficher / masquer cette aide'],
            ].map(([key, label]) => (
              <div key={key} className="flex justify-between items-center" style={{ padding: '6px 0' }}>
                <span className="badge mono">{key}</span>
                <span className="text-sm muted">{label}</span>
              </div>
            ))}
          </div>
          <p className="text-sm muted-2 mt-16">
            Les raccourcis sont ignorés pendant la saisie dans un champ.
          </p>
        </Modal>
      )}

      {confirm && (
        <Modal
          title={confirm === 'start' ? 'Démarrer le direct ?' : 'Arrêter le direct ?'}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                Annuler
              </button>
              <button
                className={`btn ${confirm === 'stop' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => {
                  const action = confirm
                  setConfirm(null)
                  if (action === 'start') void startLive()
                  else void stopLive()
                }}
              >
                {confirm === 'start' ? 'Démarrer' : 'Arrêter'}
              </button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            {confirm === 'start'
              ? 'Le direct va être mis à l’antenne. Confirmez-vous le démarrage de la diffusion ?'
              : 'La diffusion va être coupée immédiatement. Confirmez-vous l’arrêt du direct ?'}
          </p>
          {confirm === 'start' ? (
            <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
              <label>Flux de sortie</label>
              <select className="select" value={startOutput} onChange={(e) => setStartOutput(e.target.value)}>
                <option value="primary">
                  Sortie principale
                  {availableOutputs[0]?.destination ? ` (${availableOutputs[0].destination})` : ''}
                </option>
                {availableOutputs
                  .filter((o) => o.id !== 'primary')
                  .map((o) => (
                    <option key={o.id} value={String(o.id)}>
                      {o.name}
                      {o.destination ? ` — ${o.destination}` : ''}
                    </option>
                  ))}
                {availableOutputs.some((o) => o.id !== 'primary') ? (
                  <option value="all">Tous les flux activés</option>
                ) : null}
              </select>
              <div className="hint">
                Choisissez la destination diffusée. La sortie principale est le réglage de l’onglet
                Flux de sortie.
              </div>
            </div>
          ) : null}
        </Modal>
      )}
    </div>
  )
}
