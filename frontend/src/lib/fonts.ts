// Maps a layer's font id to a CSS font-family, so the editor and the monitors
// render text with the same look the engine produces on air. The ids match
// fx.FONT_CHOICES on the backend. Generic families are used as a fallback since
// the operator's browser may not have the exact face installed.
export const FONT_CSS: Record<string, string> = {
  default: '"DejaVu Sans", Verdana, sans-serif',
  sans: '"DejaVu Sans", Verdana, sans-serif',
  'sans-bold': '"DejaVu Sans", Verdana, sans-serif',
  serif: '"DejaVu Serif", Georgia, serif',
  'serif-bold': '"DejaVu Serif", Georgia, serif',
  mono: '"DejaVu Sans Mono", "Courier New", monospace',
  'mono-bold': '"DejaVu Sans Mono", "Courier New", monospace',
  'liberation-sans': '"Liberation Sans", Arial, sans-serif',
  'liberation-serif': '"Liberation Serif", "Times New Roman", serif',
  'noto-sans': '"Noto Sans", sans-serif',
  ubuntu: 'Ubuntu, sans-serif',
  'free-sans': '"FreeSans", sans-serif',
}

export function fontFamily(id?: string | null): string {
  return FONT_CSS[id ?? "default"] ?? FONT_CSS.default
}

export function fontWeight(id?: string | null): number {
  return id && id.endsWith("-bold") ? 700 : 400
}
