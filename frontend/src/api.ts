// Thin typed wrapper around the REST API. Every call sends credentials so the
// httpOnly session cookie is included, and errors surface a readable message.

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Options = {
  method?: string
  body?: unknown
  formData?: FormData
  signal?: AbortSignal
}

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    headers: {},
    signal: opts.signal,
  }
  if (opts.formData) {
    init.body = opts.formData
  } else if (opts.body !== undefined) {
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
    init.body = JSON.stringify(opts.body)
  }
  const res = await fetch(path, init)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: any = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const detail = data && typeof data === 'object' ? data.detail : data
    throw new ApiError(res.status, typeof detail === 'string' ? detail : 'Erreur inattendue')
  }
  return data as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
export type MediaKind = 'video' | 'audio' | 'image'

export interface Media {
  id: number
  title: string
  filename: string
  kind: MediaKind
  size: number
  duration: number
  width: number | null
  height: number | null
  fps: number | null
  video_codec: string | null
  audio_codec: string | null
  has_audio: boolean
  thumbnail_url: string | null
  stream_url: string
  folder_id: number | null
  category: string | null
  created_at: string
  used_in?: { id: number; name: string }[]
}

export interface Folder {
  id: number
  name: string
  count: number
}

export interface PlaylistItem {
  id: number
  media_id: number | null
  scene_id: number | null
  position: number
  duration: number
  effective_duration: number
  title: string
  kind: string | null
  thumbnail_url: string | null
  media_duration: number | null
  transition: string
  transition_duration: number
  background_audio_id: number | null
  background_audio_title: string | null
  background_volume: number
}

export interface Playlist {
  id: number
  name: string
  description: string | null
  loop: boolean
  items: PlaylistItem[]
  item_count: number
  total_duration: number
}

export type LayerType =
  | 'video'
  | 'image'
  | 'text'
  | 'logo'
  | 'overlay'
  | 'reactive'
  | 'code'

export interface SceneLayer {
  type: LayerType
  x: number
  y: number
  width?: number | null
  height?: number | null
  opacity?: number
  visible?: boolean
  z?: number
  rotation?: number
  media_id?: number | null
  text?: string | null
  font_size?: number
  color?: string
  background?: string | null
  animation?: string
  animation_speed?: number | null
  visualizer?: string | null
  code?: string | null
}

export interface Scene {
  id: number
  name: string
  width: number
  height: number
  background: string
  layers: SceneLayer[]
}

export interface Schedule {
  id: number
  name: string
  playlist_id: number | null
  days: number[]
  start_time: string
  end_time: string
  enabled: boolean
}

export interface EngineItem {
  id: number
  media_id: number | null
  scene_id?: number | null
  title: string
  kind: string
  duration: number
  thumbnail: string | null
  stream_url: string | null
  exists: boolean
}

export interface EngineStatus {
  running: boolean
  starting: boolean
  pipeline: string
  playlist_id: number | null
  playlist_name: string
  output: Record<string, unknown>
  started_at: number | null
  uptime: number
  current: EngineItem | null
  next: EngineItem | null
  current_index: number
  position: number
  cycle_duration: number
  item_count: number
  items: EngineItem[]
  restarts: number
  errors: number
  last_error: string
  pid: number | null
  ffmpeg: boolean
  log_tail: string[]
}

export interface BroadcastStatus {
  engine: EngineStatus
  fallback_playlist_id: number | null
  fallback_playlist_name: string | null
  active_scheduled_playlist_id: number | null
  system: SystemMetrics
  storage: { media: number; thumbnails: number }
}

export interface SystemMetrics {
  cpu: number
  cpu_count: number
  memory: { total: number; used: number; available: number; percent: number }
  disk: { total: number; used: number; free: number; percent: number }
  load: number[]
  uptime: number
}

export interface BroadcastSettings {
  stream_rtmp_url?: string
  stream_key_masked?: string
  has_stream_key?: boolean
  stream_width?: string
  stream_height?: string
  stream_fps?: string
  stream_bitrate?: string
  stream_audio_bitrate?: string
  stream_preset?: string
  output_kind?: string
  output_file?: string
  fallback_playlist_id?: string
  image_duration?: string
  channel_name?: string
  timezone?: string
  language?: string
}

// Lightweight polling payload (engine + system only).
export interface LiveStatus {
  engine: EngineStatus
  system: SystemMetrics
}

export interface OutputTarget {
  id: number | 'primary'
  name: string
  kind: string | null
  destination: string | null
  width: number | null
  height: number | null
  primary: boolean
}

export interface OutputsResponse {
  items: OutputTarget[]
  count: number
}

export interface PreviewData {
  program: EngineStatus
  preview: {
    playlist_id: number | null
    playlist_name: string
    items: EngineItem[]
    duration: number
  }
  outputs: OutputTarget[]
}

export interface Stream {
  id: number
  name: string
  description: string | null
  tags: string[]
  privacy: 'public' | 'unlisted' | 'private'
  category: string | null
  encoding: string
  kind: 'rtmp' | 'file'
  rtmp_url: string | null
  output_file: string | null
  width: number
  height: number
  fps: number
  bitrate: number
  audio_bitrate: number
  enabled: boolean
  has_stream_key: boolean
  stream_key_masked: string
}

export interface CatalogOption {
  id: string
  label: string
  description?: string
  default_duration?: number
  hard_cut?: boolean
  speed_default?: string | null
}

export interface Catalog {
  transitions: CatalogOption[]
  animations: CatalogOption[]
  visualizers: CatalogOption[]
  layer_types: CatalogOption[]
  code_examples: { label: string; code: string }[]
  roles?: { id: string; label: string; description: string }[]
  capabilities?: { id: string; label: string }[]
}
