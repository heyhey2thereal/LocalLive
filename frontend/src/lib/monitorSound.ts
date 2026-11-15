// Monitor sound: the audio of a monitor (preview, program, detached window),
// played through a single HTMLAudioElement that lives outside React. Because the
// element is not owned by any page component, the sound keeps playing while the
// operator moves between pages; it is only stopped explicitly.
//
// Only one source plays at a time: the engine mixes the whole playlist into one
// stream, so hearing two monitors at once would be wrong. `source` identifies
// which monitor owns the element (e.g. "preview", "program", "window").

import type { EngineItem } from '../api'

export interface MonitorSoundState {
  /** The source that currently owns the sound, or null. */
  source: string | null
  /** The element is actually producing sound right now. */
  playing: boolean
  /** URL currently loaded (null when nothing is loaded). */
  url: string | null
}

type Listener = (state: MonitorSoundState) => void

let element: HTMLAudioElement | null = null
let currentUrl: string | null = null
let currentSource: string | null = null
const listeners = new Set<Listener>()

function state(): MonitorSoundState {
  return {
    source: currentSource,
    playing: Boolean(element && currentUrl && !element.paused && !element.ended),
    url: currentUrl,
  }
}

function emit(): void {
  const snapshot = state()
  listeners.forEach((fn) => fn(snapshot))
}

function ensureElement(): HTMLAudioElement {
  if (!element) {
    element = document.createElement('audio')
    element.loop = true
    element.preload = 'auto'
    element.style.display = 'none'
    element.addEventListener('play', emit)
    element.addEventListener('pause', emit)
    element.addEventListener('ended', emit)
    document.body.appendChild(element)
  }
  return element
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

/** True when `source` is the monitor currently owning the sound. */
export function isMonitorSoundActive(source: string): boolean {
  return currentSource === source
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

function load(url: string, volume: number): void {
  const el = ensureElement()
  if (currentUrl !== url) {
    currentUrl = url
    el.src = url
  }
  el.volume = Math.min(Math.max(volume, 0), 1)
  void el.play().catch(() => {
    /* autoplay may be blocked until the next user gesture */
  })
}

/** Turn the monitor sound on for `source`, playing `url`. */
export function playMonitorSound(url: string, volume: number, source: string): void {
  currentSource = source
  load(url, volume)
  emit()
}

/** Keep `source`'s sound in sync with the current item (no-op when it does not
 * own the sound), so the element follows the playlist without an interruption. */
export function syncMonitorSound(url: string | null, volume: number, source: string): void {
  if (currentSource !== source) return
  if (!url) {
    stopMonitorSound()
    return
  }
  load(url, volume)
  emit()
}

/** Stop the monitor sound and clear the source. */
export function stopMonitorSound(): void {
  currentSource = null
  currentUrl = null
  if (element) {
    element.pause()
    element.removeAttribute('src')
    element.load()
  }
  emit()
}

/** Toggle the monitor sound for `source`; returns the new "on" state. */
export function toggleMonitorSound(url: string | null, volume: number, source: string): boolean {
  if (currentSource === source) {
    stopMonitorSound()
    return false
  }
  if (!url) return false
  playMonitorSound(url, volume, source)
  return true
}
