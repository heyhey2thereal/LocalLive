// CSS styles for an image layer's frame, mirroring the FFmpeg geq masks in
// fx.py so the editor and the monitors show the same shape the engine renders.
import type { CSSProperties } from 'react'
import type { SceneLayer } from '../api'

/**
 * Return the CSS to apply to a layer's inner box to reproduce its frame shape
 * and border. Returns null when there is no frame.
 */
export function frameStyle(layer: SceneLayer, scale = 1): CSSProperties | null {
  const shape = layer.frame ?? 'none'
  if (!shape || shape === 'none') return null
  const border = Math.max(0, layer.frame_border ?? 0) * scale
  const style: CSSProperties = {}
  const color = layer.frame_color ?? '#ffffff'
  if (border > 0) {
    style.border = `${border}px solid ${color}`
    style.boxSizing = 'border-box'
  }
  const radius = Math.max(0, layer.frame_radius ?? 40) * scale
  switch (shape) {
    case 'rect':
      break
    case 'rounded':
      style.borderRadius = radius
      break
    case 'circle':
      style.borderRadius = '50%'
      break
    case 'ellipse':
      style.borderRadius = '50%'
      break
    case 'diamond':
      style.clipPath = 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)'
      break
    case 'triangle':
      style.clipPath = 'polygon(50% 0, 100% 100%, 0 100%)'
      break
    case 'hexagon':
      style.clipPath = 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)'
      break
    default:
      return null
  }
  return style
}
