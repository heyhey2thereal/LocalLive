// Maps a layer's IN / LOOP / OUT animation ids to a CSS animation, so the
// editor and the preview/program monitors show the same motion the FFmpeg
// engine produces on air. The engine drives its expressions from fx.py; the
// keyframes (styles.css) mirror them: fade, slide, zoom, marquee, blink, pulse,
// shake, float, spin, breathing, rainbow.
//
// The animation runs on the positioned box itself so a marquee/float moves the
// whole layer, like the engine. Rotation is carried in the CSS variable
// --ll-rot, which every keyframe composes with, so a rotated layer keeps its
// angle while it animates (an animation would otherwise override the inline
// `transform`).
import type { CSSProperties } from 'react'
import type { SceneLayer } from '../api'

export interface LayerAnimation {
  className: string
  style: CSSProperties
}

// IN animation ids -> keyframe name. Direction matches fx.py:
// "slideleft" enters from the right, "slideright" from the left, etc.
const IN_KEYFRAMES: Record<string, string> = {
  fade: 'll-in-fade',
  slideleft: 'll-in-right',
  slideright: 'll-in-left',
  slideup: 'll-in-up',
  slidedown: 'll-in-down',
  zoomin: 'll-in-zoom',
  pop: 'll-in-pop',
}

// OUT animation ids -> keyframe name.
const OUT_KEYFRAMES: Record<string, string> = {
  fade: 'll-out-fade',
  slideleft: 'll-out-left',
  slideright: 'll-out-right',
  slideup: 'll-out-up',
  slidedown: 'll-out-down',
  zoomout: 'll-out-zoom',
}

// LOOP animation ids -> keyframe name.
const LOOP_KEYFRAMES: Record<string, string> = {
  marquee: 'll-loop-marquee',
  blink: 'll-loop-blink',
  pulse: 'll-loop-pulse',
  shake: 'll-loop-shake',
  float: 'll-loop-float',
  spin: 'll-loop-spin',
  pulse_size: 'll-loop-breathe',
  rainbow: 'll-loop-rainbow',
  audio_reactive: 'll-loop-audio',
}

const IN_DEFAULT = 0.5
const OUT_DEFAULT = 0.5
const LOOP_DEFAULT: Record<string, number> = {
  marquee: 80,
  blink: 1.5,
  pulse: 1.0,
  shake: 6,
  float: 0.5,
  spin: 0.1,
  pulse_size: 0.8,
  rainbow: 0.5,
  audio_reactive: 1.0,
}

// Map the ffmpeg "speed" value to a CSS duration (rough but faithful preview).
function loopDuration(kind: string, speed: number | null | undefined): number {
  const value = typeof speed === 'number' && speed > 0 ? speed : LOOP_DEFAULT[kind] ?? 1
  switch (kind) {
    case 'marquee':
      return Math.max(1.5, 12 - value / 12)
    case 'blink':
      return Math.max(0.3, (1 / value) * 2)
    case 'pulse':
      return Math.max(0.4, 1 / value)
    case 'shake':
      return 0.35
    case 'float':
      return 3.2
    case 'spin':
      return Math.max(2, 6 / Math.max(value, 0.05))
    case 'pulse_size':
      return Math.max(0.5, 1 / value)
    case 'rainbow':
      return Math.max(1, 1 / value)
    default:
      return 1
  }
}

/**
 * Build the CSS animation for a layer.
 *
 * @param layer         the scene layer (anim_in / anim_loop / anim_out fields)
 * @param layerDuration total on-air duration of the layer; used to delay the OUT
 *   animation so it plays at the end (0 = unknown, play OUT straight away).
 * @param canvasWidth   display width of the scene canvas in px; sets the marquee
 *   travel distance so it traverses the whole frame.
 * @param preview       editor mode: play every animation on a loop so the
 *   operator always sees the motion (IN/OUT are one-shot on air, which would
 *   otherwise leave the layer invisible once the OUT finished).
 * @param once          one-shot preview (hover): each animation plays exactly
 *   once and the layer then rests in its natural state, so hovering an element
 *   shows a single pass of the motion instead of a loop.
 */
export function layerAnimation(
  layer: SceneLayer,
  layerDuration = 0,
  canvasWidth = 0,
  preview = false,
  once = false,
): LayerAnimation | null {
  const animIn = layer.anim_in && layer.anim_in !== 'none' ? layer.anim_in : null
  const animLoop = layer.anim_loop && layer.anim_loop !== 'none' ? layer.anim_loop : null
  const animOut = layer.anim_out && layer.anim_out !== 'none' ? layer.anim_out : null
  if (!animIn && !animLoop && !animOut) return null

  const speed = layer.animation_speed ?? null
  const animations: string[] = []

  if (animIn && IN_KEYFRAMES[animIn]) {
    // On air the IN ends at its natural state ("both"); in a one-shot hover
    // preview it must NOT keep the end state ("none"), otherwise an OUT/LOOP
    // sharing the property would never show.
    const fill = once ? 'none' : preview ? 'infinite' : 'both'
    animations.push(`${IN_KEYFRAMES[animIn]} ${speed ?? IN_DEFAULT}s ease ${fill}`)
  }
  if (animLoop && LOOP_KEYFRAMES[animLoop]) {
    animations.push(
      `${LOOP_KEYFRAMES[animLoop]} ${loopDuration(animLoop, speed)}s linear ${once ? '1' : 'infinite'}`,
    )
  }
  if (animOut && OUT_KEYFRAMES[animOut]) {
    const dur = speed ?? OUT_DEFAULT
    if (once) {
      // One pass, then back to the natural state (no fill).
      animations.push(`${OUT_KEYFRAMES[animOut]} ${dur}s ease none`)
    } else if (preview) {
      // In the editor loop every animation, but keep the IN and drop the OUT
      // when both are set so the two do not fight over the same property.
      if (!animIn) animations.push(`${OUT_KEYFRAMES[animOut]} ${dur}s ease infinite`)
    } else {
      const delay = layerDuration > 0 ? Math.max(0, layerDuration - dur) : 0
      animations.push(`${OUT_KEYFRAMES[animOut]} ${dur}s ease ${delay}s both`)
    }
  }
  if (animations.length === 0) return null

  // Audio-reactive loop: mirror the engine's scaling range (which depends on the
  // sensitivity) so the monitor grows/shrinks like the on-air render.
  const audioVars: Record<string, string> = {}
  if (animLoop === 'audio_reactive') {
    const sens = Math.min(Math.max(layer.audio_sensitivity ?? 1, 0.1), 5)
    const amplitude = Math.min(0.6, 0.25 + 0.2 * sens)
    audioVars['--ll-audio-min'] = String(Math.max(0.3, 1 - amplitude / 2).toFixed(3))
    audioVars['--ll-audio-max'] = String(Math.min(1.6, 1 + amplitude / 2).toFixed(3))
  }

  const style = {
    animation: animations.join(', '),
    ['--ll-rot']: `${layer.rotation ?? 0}deg`,
    ...audioVars,
    ...(canvasWidth > 0 ? { ['--ll-marquee']: `${Math.round(canvasWidth)}px` } : {}),
  } as CSSProperties

  return { className: 'll-anim', style }
}
