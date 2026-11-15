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
  // The guard stops a pathological (zero-length) list from spinning forever.
  let guard = 0
  while (guard++ < 100000 && now - itemStartedAt >= itemSeconds(index) * 1000) {
    itemStartedAt += itemSeconds(index) * 1000
    index = (index + 1) % items.length
  }
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
    index = 0
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
  notify()
}
