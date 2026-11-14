// Brand mark: a rounded "on-air" tile with broadcast waves radiating from a
// play triangle. Pure SVG so it scales, themes with CSS variables and stays
// crisp at any size. The gradient ids are unique per instance to avoid clashing
// when several marks are on the same page.

import { useId } from 'react'

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  const uid = useId().replace(/:/g, '')
  const grad = `ll-grad-${uid}`
  const glow = `ll-glow-${uid}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={grad} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff5d5d" />
          <stop offset="0.55" stopColor="#e5484d" />
          <stop offset="1" stopColor="#7c5cff" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="3" y="3" width="42" height="42" rx="13" fill={`url(#${grad})`} />
      <rect x="3" y="3" width="42" height="42" rx="13" fill={`url(#${glow})`} />
      <rect x="3.75" y="3.75" width="40.5" height="40.5" rx="12.25" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1.5" />

      {/* Broadcast waves */}
      <path d="M30.5 17.5a9 9 0 010 13M35.5 13.5a15 15 0 010 21" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />

      {/* Play triangle */}
      <path d="M15 14.5c0-1.6 1.7-2.6 3.1-1.8l14 8.1c1.4.8 1.4 2.8 0 3.6l-14 8.1c-1.4.8-3.1-.2-3.1-1.8V14.5z" fill="#0b0d12" />
      <path d="M18.5 18.2l9.4 5.4-9.4 5.4V18.2z" fill="#ffffff" opacity="0.92" />
    </svg>
  )
}
