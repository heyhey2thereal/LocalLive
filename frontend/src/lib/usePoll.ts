// Polling hook with two safety properties:
//   * requests never overlap — a new tick is skipped while the previous fetch
//     is still in flight, so a slow backend cannot pile up work;
//   * polling pauses while the tab is hidden, resuming (with an immediate
//     refresh) when it becomes visible again.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface PollResult<T> {
  data: T | null
  error: string | null
  loading: boolean
  refresh: () => void
}

export function usePoll<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  options: { enabled?: boolean } = {},
): PollResult<T> {
  const enabled = options.enabled ?? true
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const inFlight = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const run = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    controller.current = new AbortController()
    try {
      const result = await fetcherRef.current(controller.current.signal)
      setData(result)
      setError(null)
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError(err?.message ?? 'Erreur inattendue')
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let timer: number | null = null
    const start = () => {
      void run()
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void run()
      }, intervalMs)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void run()
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (timer) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      controller.current?.abort()
    }
  }, [enabled, intervalMs, run])

  const refresh = useCallback(() => {
    void run()
  }, [run])

  return { data, error, loading, refresh }
}
