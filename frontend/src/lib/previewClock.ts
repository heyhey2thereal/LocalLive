// Preview clock.
//
// The preview monitor walks through its playlist on its own timer, showing one
// item after another. That walk lives here — outside React — so it keeps
// advancing while the operator is on another page, exactly like the monitor
// sound: the position is derived from wall-clock time, so returning to the page
// shows the item that *would* be playing right now instead of restarting from
// the first one. Nothing has to run in the background: when the page is shown
// again, `getPreviewSnapshot()` simply catches up with the elapsed time.
//
// One playlist at a time (the one currently selected in the preview monitor).

import type { EngineItem } from '../api'

export interface PreviewSnapshot {
  playlistId: number | null
  index: number
}

let playlistId: number | null = null
let items: EngineItem[] = []
let index = 0
// ms epoch when the *current* item started, moved forward as items elapse.
let itemStartedAt = 0
const listeners = new Set<(snapshot: PreviewSnapshot) => void>()

function itemSeconds(i: number): number {
  return Math.max(0.5, items[i]?.duration || 5)
}

/** Advance from `itemStartedAt` to `now`, consuming every elapsed item. */
function sync(now: number): void {
  if (items.length === 0) {
    index = 0
    return
  }
  if (index >= items.length) index = 0
  const before = index
  // The guard stops a pathological (zero-length) list from spinning forever.
  let guard = 0
  while (guard++ < 100000 && now - itemStartedAt >= itemSeconds(index) * 1000) {
    itemStartedAt += itemSeconds(index) * 1000
    index = (index + 1) % items.length
  }
  // Persist the advanced position so a full reload restores the same item.
  if (index !== before) savePreviewIndex(index)
}

function notify(): void {
  const snapshot = { playlistId, index }
  listeners.forEach((fn) => fn(snapshot))
}

/** Current preview position, caught up with the wall clock. */
export function getPreviewSnapshot(): PreviewSnapshot {
  sync(Date.now())
  return { playlistId, index }
}

export function subscribePreviewClock(fn: (snapshot: PreviewSnapshot) => void): () => void {
  listeners.add(fn)
  fn(getPreviewSnapshot())
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Keep the clock in step with the playlist shown in the preview. A *different*
 * playlist restarts the walk at its first item; re-supplying the same playlist
 * (the poll refreshes it every second) only refreshes the item durations, so the
 * current position is preserved.
 */
export function setPreviewPlaylist(id: number | null, list: EngineItem[]): void {
  const changed = id !== playlistId
  playlistId = id
  items = list
  if (changed) {
    // Restore the item the operator last picked for this playlist (persisted
    // across navigation and reloads) instead of always starting at the first.
    const saved = getSavedPreviewIndex()
    index = list.length > 0 ? ((saved % list.length) + list.length) % list.length : 0
    itemStartedAt = Date.now()
  } else {
    sync(Date.now())
  }
  notify()
}

/** Jump the preview to a specific item (operator click); its timer restarts. */
export function setPreviewIndex(i: number): void {
  const count = Math.max(items.length, 1)
  index = ((i % count) + count) % count
  itemStartedAt = Date.now()
  savePreviewIndex(index)
  notify()
}

// ---------------------------------------------------------------------------
// Persisted preview selection
// ---------------------------------------------------------------------------
// The playlist chosen for the preview monitor and the item the operator picked
// are remembered in localStorage, so leaving the page (or reloading) restores
// the same selection instead of falling back to the first item.
const LS_PLAYLIST = 'locallive.preview.playlist'
const LS_INDEX = 'locallive.preview.index'

export function getSavedPreviewPlaylist(): number | null {
  try {
    const v = localStorage.getItem(LS_PLAYLIST)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function savePreviewPlaylist(id: number | null): void {
  try {
    if (id == null) localStorage.removeItem(LS_PLAYLIST)
    else localStorage.setItem(LS_PLAYLIST, String(id))
  } catch {
    /* storage may be unavailable (private mode); the in-memory state still works */
  }
}

function savePreviewIndex(i: number): void {
  try {
    localStorage.setItem(LS_INDEX, String(i))
  } catch {
    /* ignore */
  }
}

/** The item index the operator last had selected (0 when unknown). */
export function getSavedPreviewIndex(): number {
  try {
    const v = localStorage.getItem(LS_INDEX)
    return v ? Math.max(0, Number(v)) : 0
  } catch {
    return 0
  }
}
