// Brand mark: a stylised "signal/broadcast" glyph used in the sidebar, the
// login card and the setup wizard. Pure SVG so it scales and themes with CSS.

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
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
        <linearGradient id="ll-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2, #7c5cff)" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="42" height="42" rx="12" fill="url(#ll-grad)" />
      <circle cx="24" cy="24" r="5" fill="#0b0d12" />
      <path
        d="M24 9v6M24 33v6M9 24h6M33 24h6M14 14l4 4M30 30l4 4M34 14l-4 4M18 30l-4 4"
        stroke="#0b0d12"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="24" cy="24" r="9.5" stroke="#0b0d12" strokeWidth="2.2" opacity="0.55" />
    </svg>
  )
}
