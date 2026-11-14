// Interactive scene editor canvas.
//
// Layers can be dragged to move and resized from eight handles (corners and
// edge midpoints). Holding Shift snaps to a 10px grid, Alt locks the aspect
// ratio, and the arrow keys nudge the selected layer (1px, or 10px with Shift).
// Everything works in scene coordinates and is scaled to the displayed width.
//
// A resize starts from the layer's *measured* on-screen size (not from a
// hard-coded default), so layers that have no explicit width/height — such as
// text — resize smoothly instead of collapsing to a sliver.

import { useCallback, useEffect, useRef } from 'react'
import type { SceneLayer } from '../api'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const GRID = 10
const MIN_SIZE = 8

interface Props {
  width: number
  height: number
  background: string
  layers: SceneLayer[]
  selected: number | null
  displayWidth: number
  mediaFor: (id?: number | null) => { thumbnail_url: string | null; title: string } | undefined
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
    // Measure the real rendered size so resizing starts from what the user sees.
    const el = layerRefs.current.get(index)
    const rect = el?.getBoundingClientRect()
    const baseW = rect && rect.width > 0 ? rect.width / scale : layer.width ?? 200
    const baseH = rect && rect.height > 0 ? rect.height / scale : layer.height ?? 100
    drag.current = {
      index,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...layer },
      baseW,
      baseH,
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
      // Clamp to the minimum size, keeping the anchored edge fixed.
      if (w < MIN_SIZE) {
        if (hnd.includes('w')) x = d.orig.x + (d.baseW - MIN_SIZE)
        w = MIN_SIZE
      }
      if (h < MIN_SIZE) {
        if (hnd.includes('n')) y = d.orig.y + (d.baseH - MIN_SIZE)
        h = MIN_SIZE
      }
      // Alt locks the aspect ratio on the corner handles.
      if (alt && hnd.length === 2 && d.baseW > 0 && d.baseH > 0) {
        const ratio = d.baseW / d.baseH
        h = w / ratio
        if (hnd.includes('n')) y = d.orig.y + (d.baseH - h)
      }
      patchLayer(d.index, {
        x: snap(x, shift),
        y: snap(y, shift),
        width: snap(w, shift),
        height: snap(h, shift),
      })
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
              {!isText && m?.thumbnail_url && <img src={m.thumbnail_url} alt="" draggable={false} />}
              {!isText && !m?.thumbnail_url && (
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
                  {isCode ? 'Code' : isReactive ? 'Réactif' : l.type === 'logo' ? 'Logo' : 'Média'}
                </span>
              )}
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
