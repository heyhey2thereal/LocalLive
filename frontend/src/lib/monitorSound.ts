// Monitor sound.
//
// A single HTMLAudioElement lives outside React. The model has two independent
// flags so the sound can be muted without ever stopping it:
//
//   * `enabled`  — the operator wants the monitor sound on (the speaker button).
//     Turning it off is a *mute*: the element keeps playing at gain 0, so turning
//     it back on never restarts or reloads the audio.
//   * `audible`  — the broadcast page (Aperçu / Programme) is currently shown.
//     Leaving the page only mutes; returning makes it audible again instantly,
//     without a restart.
//
// The element is never paused, seeked or reloaded while a source is selected, so
// the sound always continues from where it was. The only thing that reloads it is
// the playlist moving to the next item (a genuinely different stream).
//
// One source at a time: the engine mixes the whole playlist into one stream, so
// the element follows a single chosen source ("preview" or "program").

import type { EngineItem } from '../api'

export type MonitorSource = 'preview' | 'program' | 'window' | 'dashboard'

export interface MonitorSoundState {
  /** The source the operator selected, or null when nothing is selected. */
  source: MonitorSource | null
  /** The operator wants the sound on (speaker button). */
  enabled: boolean
  /** The element is actually playing (not paused). */
  playing: boolean
  /** The element is currently audible (enabled and on its page). */
  audible: boolean
  /** URL currently loaded (null when nothing is loaded). */
  url: string | null
}

type Listener = (state: MonitorSoundState) => void

let element: HTMLAudioElement | null = null
let gain: GainNode | null = null
let currentUrl: string | null = null
let currentSource: MonitorSource | null = null
let enabled = false
let visibleClaims = 0
let lastVolume = 1
const listeners = new Set<Listener>()

function shouldBeAudible(): boolean {
  return enabled && visibleClaims > 0
}

function state(): MonitorSoundState {
  return {
    source: currentSource,
    enabled,
    playing: Boolean(element && currentUrl && !element.paused && !element.ended),
    audible: shouldBeAudible(),
    url: currentUrl,
  }
}

function emit(): void {
  const snapshot = state()
  listeners.forEach((fn) => fn(snapshot))
}

function ensureElement(): HTMLAudioElement {
  if (element) return element
  const el = document.createElement('audio')
  el.loop = true
  el.preload = 'auto'
  el.style.display = 'none'
  // Route the audio through a gain node so we can mute without pausing (pausing
  // or reloading the element is what used to restart the sound).
  try {
    const Ctor: typeof AudioContext | undefined =
      (window as any).AudioContext || (window as any).webkitAudioContext
    if (Ctor) {
      const ctx = new Ctor()
      const src = ctx.createMediaElementSource(el)
      const g = ctx.createGain()
      src.connect(g)
      g.connect(ctx.destination)
      gain = g
      // A browser keeps the AudioContext suspended until a user gesture.
      const resume = () => void ctx.resume().catch(() => {})
      resume()
      el.addEventListener('play', resume)
    }
  } catch {
    gain = null // fall back to element.volume below
  }
  el.addEventListener('play', emit)
  el.addEventListener('pause', emit)
  el.addEventListener('ended', emit)
  document.body.appendChild(el)
  element = el
  return el
}

function applyGain(): void {
  if (!element) return
  const value = shouldBeAudible() ? Math.min(Math.max(lastVolume, 0), 1) : 0
  if (gain) {
    gain.gain.value = value
  } else {
    element.volume = value
  }
}

/** Start (or keep) playing `url`. Never restarts an already-loaded stream. */
function playUrl(url: string): void {
  const el = ensureElement()
  if (currentUrl !== url) {
    currentUrl = url
    el.src = url
  }
  void el.play().catch(() => {
    /* autoplay may be blocked until the next user gesture */
  })
  applyGain()
}

export function subscribeMonitorSound(fn: Listener): () => void {
  listeners.add(fn)
  fn(state())
  return () => {
    listeners.delete(fn)
  }
}

export function getMonitorSoundState(): MonitorSoundState {
  return state()
}

/** The audio URL of an item, or null when it carries no sound. */
export function monitorAudioUrl(item: EngineItem | null): string | null {
  if (!item) return null
  if (item.kind === 'video' || item.kind === 'audio') return item.stream_url ?? null
  return item.background_audio_url ?? null
}

/** Volume to use for an item's monitor sound (background music is quieter). */
export function monitorAudioVolume(item: EngineItem | null): number {
  if (!item) return 1
  if (item.kind === 'video' || item.kind === 'audio') return 1
  return Math.min(Math.max(item.background_volume ?? 0.15, 0), 1)
}

/**
 * Tell the module that `source` is the monitor the operator wants to hear, and
 * start playing it. Idempotent: calling it while already playing the same stream
 * changes nothing (no reload, no restart).
 */
export function requestMonitorSound(source: MonitorSource, item: EngineItem | null): void {
  const url = monitorAudioUrl(item)
  if (!url) return
  currentSource = source
  enabled = true
  lastVolume = monitorAudioVolume(item)
  playUrl(url)
  emit()
}

/**
 * Keep `source` in sync with the current item. Called on every item change so the
 * element follows the playlist; a no-op for the monitor that is not selected.
 * Reloading only happens when the item's stream actually changes.
 */
export function followMonitorSound(source: MonitorSource, item: EngineItem | null): void {
  if (currentSource !== source) return
  const url = monitorAudioUrl(item)
  if (!url) return
  lastVolume = monitorAudioVolume(item)
  playUrl(url)
  emit()
}

/** Turn the sound off. It is a *mute*: playback continues so it never restarts. */
export function muteMonitorSound(): void {
  enabled = false
  applyGain()
  emit()
}

/** Turn the sound back on (continues where it was — never restarts). */
export function unmuteMonitorSound(): void {
  if (!currentSource) return
  enabled = true
  if (element) void element.play().catch(() => {})
  applyGain()
  emit()
}

/**
 * Speaker button: mute/unmute the selected source, or select it when another
 * monitor is currently the one we hear. Returns the new "on" state.
 */
export function toggleMonitorSound(source: MonitorSource, item: EngineItem | null): boolean {
  if (currentSource === source) {
    if (enabled) {
      muteMonitorSound()
      return false
    }
    unmuteMonitorSound()
    return true
  }
  if (!monitorAudioUrl(item)) return false
  requestMonitorSound(source, item)
  return true
}

/** Stop the monitor sound completely (clears the source and the stream). */
export function stopMonitorSound(): void {
  currentSource = null
  currentUrl = null
  enabled = false
  if (element) {
    element.pause()
    element.removeAttribute('src')
    element.load()
  }
  emit()
}

/** True when `source` is the monitor the operator selected. */
export function isMonitorSoundSelected(source: MonitorSource): boolean {
  return currentSource === source
}

/**
 * Page-scoped audibility. The broadcast page calls this with `true` on mount and
 * `false` on unmount. The element keeps playing in between, so another page only
 * mutes it (never stops it) and returning is instant.
 */
export function setMonitorPageVisible(value: boolean): void {
  // Counted claims so a route swap (one page unmounts as another mounts) can
  // never leave the sound muted: the element stays audible while any broadcast
  // page is shown.
  visibleClaims = Math.max(0, visibleClaims + (value ? 1 : -1))
  applyGain()
  emit()
}
