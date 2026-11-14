// Inline SVG icon set (stroke-based, 1.7px). Keeps the bundle tiny — no icon
// font or external library is loaded.

type P = { size?: number; className?: string }
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const IconDashboard = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
)

export const IconMedia = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 15l4-4 4 4 3-3 4 4" />
    <circle cx="8.5" cy="8.5" r="1.5" />
  </svg>
)

export const IconPlaylist = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 6h16M4 12h10M4 18h10" />
    <circle cx="18" cy="16" r="3" />
    <path d="M21 16V9" />
  </svg>
)

export const IconLayers = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
    <path d="M3 17l9 5 9-5" />
  </svg>
)

export const IconCalendar = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 9h18M8 3v4M16 3v4" />
  </svg>
)

export const IconSettings = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6 1.65 1.65 0 0010 3.09V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.14.61.65 1.05 1.28 1.09H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
)

export const IconPlay = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none" />
  </svg>
)

export const IconStop = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </svg>
)

export const IconPlus = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconTrash = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
  </svg>
)

export const IconEdit = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
)

export const IconUpload = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <path d="M17 8l-5-5-5 5M12 3v12" />
  </svg>
)

export const IconSearch = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
)

export const IconCheck = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
)

export const IconX = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)

export const IconGrip = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="9" cy="6" r="1" fill="currentColor" />
    <circle cx="15" cy="6" r="1" fill="currentColor" />
    <circle cx="9" cy="12" r="1" fill="currentColor" />
    <circle cx="15" cy="12" r="1" fill="currentColor" />
    <circle cx="9" cy="18" r="1" fill="currentColor" />
    <circle cx="15" cy="18" r="1" fill="currentColor" />
  </svg>
)

export const IconCpu = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
  </svg>
)

export const IconRam = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="7" width="18" height="10" rx="2" />
    <path d="M7 17v3M17 17v3M7 4v3M17 4v3" />
  </svg>
)

export const IconDisk = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export const IconSignal = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12.55a11 11 0 0114 0M8.5 16a6 6 0 017 0M12 20h.01M2 8.82a15 15 0 0120 0" />
  </svg>
)

export const IconLogout = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
  </svg>
)

export const IconImage = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
)

export const IconVideo = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="M16 10l6-3v10l-6-3" />
  </svg>
)

export const IconAudio = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
)

export const IconFolder = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
  </svg>
)

export const IconRefresh = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M21 12a9 9 0 11-3-6.7M21 3v6h-6" />
  </svg>
)

export const IconStreams = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M5.6 5.6a9 9 0 000 12.8M18.4 5.6a9 9 0 010 12.8M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7" />
  </svg>
)

export const IconRotate = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 12a9 9 0 109-9 9 9 0 00-6.7 3M3 3v6h6" />
  </svg>
)

export const IconDuplicate = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
)

export const IconZap = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
  </svg>
)

export const IconCode = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
  </svg>
)
