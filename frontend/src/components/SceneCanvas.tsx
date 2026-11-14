// Interactive scene editor canvas.
//
// Features:
//   * drag to move, eight handles to resize (corners + edge midpoints);
//   * Canva-style smart guides: while dragging, edges/centres snap to the canvas
//     edges, the canvas centre and the other layers' edges/centres. Holding
//     Shift disables the smart guides (free movement);
//   * Alt locks the aspect ratio while resizing;
//   * arrow keys nudge the selected layer (1px, or 10px with Shift);
//   * layers are always clamped inside the frame, so an image can never overflow;
//   * text layers scale their font with the box; images use the cached
//     medium-resolution preview (fast to load, sharp enough to enlarge).

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SceneLayer } from '../api'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const GRID = 10
const MIN_SIZE = 8
const MIN_FONT = 8
const SNAP = 6 // scene units within which a guide snaps

export interface MediaInfo {
  id: number
  title: string
  kind: string
  thumbnail_url: string | null
  stream_url?: string
  preview_url?: string
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

interface Guides {
  v: number[]
  h: number[]
}

function snapGrid(value: number, active: boolean): number {
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
  const [guides, setGuides] = useState<Guides>({ v: [], h: [] })
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

  // Clamp a layer so it always stays inside the frame.
  const clamp = (l: { x: number; y: number; width?: number | null; height?: number | null }) => {
    const w = l.width ?? 0
    const h = l.height ?? 0
    return {
      x: Math.max(0, Math.min(l.x, Math.max(0, width - w))),
      y: Math.max(0, Math.min(l.y, Math.max(0, height - h))),
    }
  }

  // Build the list of smart-guide positions (canvas + other layers).
  const guidePositions = (index: number) => {
    const v = [0, width / 2, width]
    const h = [0, height / 2, height]
    layers.forEach((l, i) => {
      if (i === index) return
      const w = l.width ?? 0
      const hh = l.height ?? 0
      v.push(l.x, l.x + w / 2, l.x + w)
      h.push(l.y, l.y + hh / 2, l.y + hh)
    })
    return { v, h }
  }

  // Snap a moving box's edges/centre to the nearest guide.
  const applyGuides = (
    index: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): { x: number; y: number; guides: Guides } => {
    const { v, h: hs } = guidePositions(index)
    const activeV: number[] = []
    const activeH: number[] = []
    const xs = [x, x + w / 2, x + w]
    const ys = [y, y + h / 2, y + h]
    let bestDx = Infinity
    let bestX = x
    for (const gx of v) {
      for (const px of xs) {
        const d = Math.abs(px - gx)
        if (d < SNAP && d < bestDx) {
          bestDx = d
          bestX = x + (gx - px)
        }
      }
    }
    if (bestDx < SNAP) {
      const moved = bestX - x
      xs.forEach((px) => {
        if (v.some((gx) => Math.abs(px + moved - gx) < 0.5)) activeV.push(px + moved)
      })
      x = bestX
    }
    let bestDy = Infinity
    let bestY = y
    for (const gy of hs) {
      for (const py of ys) {
        const d = Math.abs(py - gy)
        if (d < SNAP && d < bestDy) {
          bestDy = d
          bestY = y + (gy - py)
        }
      }
    }
    if (bestDy < SNAP) {
      const moved = bestY - y
      ys.forEach((py) => {
        if (hs.some((gy) => Math.abs(py + moved - gy) < 0.5)) activeH.push(py + moved)
      })
      y = bestY
    }
    return { x, y, guides: { v: activeV, h: activeH } }
  }

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
      patchLayer(selected, clamp({ x: layer.x + dx, y: layer.y + dy, width: layer.width, height: layer.height }))
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
    drag.current = { index, handle, startX: e.clientX, startY: e.clientY, orig: { ...layer }, baseW, baseH, baseFont, isText }

    const onMove = (ev: MouseEvent) => {
      const d = drag.current
      if (!d) return
      const dx = (ev.clientX - d.startX) / scale
      const dy = (ev.clientY - d.startY) / scale
      const shift = ev.shiftKey
      const alt = ev.altKey
      if (d.handle === 'move') {
        const w = d.orig.width ?? 0
        const h = d.orig.height ?? 0
        let nx = d.orig.x + dx
        let ny = d.orig.y + dy
        if (!shift) {
          const res = applyGuides(d.index, nx, ny, w, h)
          nx = res.x
          ny = res.y
          setGuides(res.guides)
        } else {
          setGuides({ v: [], h: [] })
        }
        const c = clamp({ x: nx, y: ny, width: w, height: h })
        patchLayer(d.index, c)
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
        x: snapGrid(x, shift),
        y: snapGrid(y, shift),
        width: snapGrid(w, shift),
        height: snapGrid(h, shift),
      }
      if (d.isText && d.baseH > 0) {
        patch.font_size = Math.max(MIN_FONT, Math.round((d.baseFont * h) / d.baseH))
      }
      patchLayer(d.index, patch)
    }
    const onUp = () => {
      drag.current = null
      setGuides({ v: [], h: [] })
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
      {guides.v.map((gx, i) => (
        <div key={`gv${i}`} className="scene-guide v" style={{ left: gx * scale }} />
      ))}
      {guides.h.map((gy, i) => (
        <div key={`gh${i}`} className="scene-guide h" style={{ top: gy * scale }} />
      ))}
      {layers
        .map((l, i) => ({ l, i }))
        .sort((a, b) => (a.l.z ?? 0) - (b.l.z ?? 0))
        .map(({ l, i }) => {
          const m = mediaFor(l.media_id)
          const isText = l.type === 'text' || l.type === 'overlay'
          const isCode = l.type === 'code'
          const isReactive = l.type === 'reactive'
          const isChat = l.type === 'chat'
          const isCountdown = l.type === 'countdown'
          const isMedia = l.type === 'image' || l.type === 'video' || l.type === 'logo'
          // Cached medium-resolution preview loads fast; thumbnail is the fallback.
          const imgSrc = isMedia && m ? m.preview_url ?? m.stream_url ?? m.thumbnail_url : null
          const blur = l.blur ?? 0
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
                fontSize: isText || isChat || isCountdown ? (l.font_size ?? 32) * scale : undefined,
                background: isText || isChat || isCountdown ? l.background ?? 'transparent' : 'transparent',
                padding: isText || isChat || isCountdown ? '4px 8px' : 0,
                transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
                filter: blur ? `blur(${blur * scale}px)` : undefined,
                zIndex: (l.z ?? 0) + 1,
              }}
              onMouseDown={(e) => startDrag(e, i, 'move')}
              onClick={(e) => e.stopPropagation()}
            >
              {isMedia && imgSrc && <img src={imgSrc} alt="" draggable={false} />}
              {isMedia && !imgSrc && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{l.type}</span>}
              {isReactive && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Réactif · {l.visualizer}</span>}
              {isCode && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Code</span>}
              {isChat && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Chat</span>}
              {isCountdown && <span style={{ fontSize: (l.font_size ?? 96) * scale * 0.5 }}>{l.countdown_seconds ?? 60}</span>}
              {isText && (l.text || 'Texte')}
              {selected === i &&
                HANDLES.map((h) => (
                  <span key={h} className={`scene-handle h-${h}`} onMouseDown={(e) => startDrag(e, i, h)} />
                ))}
            </div>
          )
        })}
    </div>
  )
}
