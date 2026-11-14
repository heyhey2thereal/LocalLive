// Interactive scene editor canvas.
//
// Layers can be dragged to move and resized from eight handles (corners and
// edge midpoints). Holding Shift snaps to a 10px grid, Alt locks the aspect
// ratio, and the arrow keys nudge the selected layer (1px, or 10px with Shift).
// Everything works in scene coordinates and is scaled to the displayed width.
//
// Resizing a text layer scales its font size with the box (so "enlarging" text
// actually enlarges the text), and images are drawn from their full-resolution
// stream rather than the low-resolution thumbnail so stretching keeps quality.

import { useCallback, useEffect, useRef } from 'react'
import type { SceneLayer } from '../api'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const GRID = 10
const MIN_SIZE = 8
const MIN_FONT = 8

export interface MediaInfo {
  id: number
  title: string
  kind: string
  thumbnail_url: string | null
  stream_url?: string
}

interface Props {
  width: number
  height: number
  background: string
  layers: SceneLayer[]
  selected: number | null
  displayWidth: number
  mediaFor: (id?: number | null) => MediaInfo | undefined
  onSelect: (index: number | null) => void
  onChange: (layers: SceneLayer[]) => void
}

function snap(value: number, active: boolean): number {
  return active ? Math.round(value / GRID) * GRID : Math.round(value)
}

export default function SceneCanvas({
  width,
  height,
  background,
  layers,
  selected,
  displayWidth,
  mediaFor,
  onSelect,
  onChange,
}: Props) {
  const scale = displayWidth / width
  const layerRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const drag = useRef<{
    index: number
    handle: Handle | 'move'
    startX: number
    startY: number
    orig: SceneLayer
    baseW: number
    baseH: number
    baseFont: number
    isText: boolean
  } | null>(null)

  const patchLayer = useCallback(
    (index: number, patch: Partial<SceneLayer>) => {
      onChange(layers.map((l, i) => (i === index ? { ...l, ...patch } : l)))
    },
    [layers, onChange],
  )

  // Keyboard nudging for the selected layer.
  useEffect(() => {
    if (selected === null) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const step = e.shiftKey ? GRID : 1
      const layer = layers[selected]
      if (!layer) return
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else return
      e.preventDefault()
      patchLayer(selected, { x: layer.x + dx, y: layer.y + dy })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, layers, patchLayer])

  const startDrag = (e: React.MouseEvent, index: number, handle: Handle | 'move') => {
    e.stopPropagation()
    onSelect(index)
    const layer = layers[index]
    const isText = layer.type === 'text' || layer.type === 'overlay'
    const el = layerRefs.current.get(index)
    const rect = el?.getBoundingClientRect()
    const baseW = rect && rect.width > 0 ? rect.width / scale : layer.width ?? 200
    const baseH = rect && rect.height > 0 ? rect.height / scale : layer.height ?? 100
    const baseFont = layer.font_size ?? (layer.type === 'text' ? 48 : 36)
    drag.current = {
      index,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...layer },
      baseW,
      baseH,
      baseFont,
      isText,
    }
    const onMove = (ev: MouseEvent) => {
      const d = drag.current
      if (!d) return
      const dx = (ev.clientX - d.startX) / scale
      const dy = (ev.clientY - d.startY) / scale
      const shift = ev.shiftKey
      const alt = ev.altKey
      if (d.handle === 'move') {
        patchLayer(d.index, {
          x: snap(d.orig.x + dx, shift),
          y: snap(d.orig.y + dy, shift),
        })
        return
      }
      let x = d.orig.x
      let y = d.orig.y
      let w = d.baseW
      let h = d.baseH
      const hnd = d.handle
      if (hnd.includes('w')) {
        x = d.orig.x + dx
        w = d.baseW - dx
      }
      if (hnd.includes('e')) w = d.baseW + dx
      if (hnd.includes('n')) {
        y = d.orig.y + dy
        h = d.baseH - dy
      }
      if (hnd.includes('s')) h = d.baseH + dy
      if (w < MIN_SIZE) {
        if (hnd.includes('w')) x = d.orig.x + (d.baseW - MIN_SIZE)
        w = MIN_SIZE
      }
      if (h < MIN_SIZE) {
        if (hnd.includes('n')) y = d.orig.y + (d.baseH - MIN_SIZE)
        h = MIN_SIZE
      }
      if (alt && hnd.length === 2 && d.baseW > 0 && d.baseH > 0) {
        const ratio = d.baseW / d.baseH
        h = w / ratio
        if (hnd.includes('n')) y = d.orig.y + (d.baseH - h)
      }
      const patch: Partial<SceneLayer> = {
        x: snap(x, shift),
        y: snap(y, shift),
        width: snap(w, shift),
        height: snap(h, shift),
      }
      // Text layers scale their font with the box so "enlarging" the box really
      // enlarges the text (otherwise the box grows but the glyphs stay small).
      if (d.isText && d.baseH > 0) {
        patch.font_size = Math.max(MIN_FONT, Math.round((d.baseFont * h) / d.baseH))
      }
      patchLayer(d.index, patch)
    }
    const onUp = () => {
      drag.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className="scene-canvas"
      style={{ width: displayWidth, aspectRatio: `${width}/${height}`, background }}
      onClick={() => onSelect(null)}
    >
      {layers
        .map((l, i) => ({ l, i }))
        .sort((a, b) => (a.l.z ?? 0) - (b.l.z ?? 0))
        .map(({ l, i }) => {
          const m = mediaFor(l.media_id)
          const isText = l.type === 'text' || l.type === 'overlay'
          const isCode = l.type === 'code'
          const isReactive = l.type === 'reactive'
          const isChat = l.type === 'chat'
          // Prefer the full-resolution stream for stills so stretching keeps
          // quality; fall back to the thumbnail.
          const imgSrc = m ? m.stream_url ?? m.thumbnail_url : null
          return (
            <div
              key={i}
              ref={(el) => {
                if (el) layerRefs.current.set(i, el)
                else layerRefs.current.delete(i)
              }}
              className={`scene-layer ${selected === i ? 'selected' : ''}`}
              style={{
                left: l.x * scale,
                top: l.y * scale,
                width: l.width ? l.width * scale : undefined,
                height: l.height ? l.height * scale : undefined,
                opacity: l.visible === false ? 0.3 : l.opacity ?? 1,
                color: l.color,
                fontSize: isText ? (l.font_size ?? 32) * scale : undefined,
                background: isText ? l.background ?? 'transparent' : 'transparent',
                padding: isText ? '4px 8px' : 0,
                transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
                zIndex: (l.z ?? 0) + 1,
              }}
              onMouseDown={(e) => startDrag(e, i, 'move')}
              onClick={(e) => e.stopPropagation()}
            >
              {!isText && !isCode && !isReactive && !isChat && imgSrc && (
                <img src={imgSrc} alt="" draggable={false} />
              )}
              {!isText && !isCode && !isReactive && !isChat && !imgSrc && (
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
                  {l.type === 'logo' ? 'Logo' : 'Média'}
                </span>
              )}
              {isReactive && (
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Réactif · {l.visualizer}</span>
              )}
              {isCode && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Code</span>}
              {isChat && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Chat</span>}
              {isText && (l.text || 'Texte')}
              {selected === i &&
                HANDLES.map((h) => (
                  <span
                    key={h}
                    className={`scene-handle h-${h}`}
                    onMouseDown={(e) => startDrag(e, i, h)}
                  />
                ))}
            </div>
          )
        })}
    </div>
  )
}
