import { useEffect, useState } from 'react'

/** The room panel reads the sim this often: about 4 Hz, never per frame. */
export const POLL_MS = 250

/**
 * Re-read some sim state a few times a second. `read` must be stable (wrap it in `useCallback`) and return a small plain
 * object of strings and numbers; the hook keeps the previous object when nothing changed, so a quiet room costs no re-render.
 */
export function usePoll<T>(read: () => T, ms: number = POLL_MS): T {
  const [value, setValue] = useState<T>(read)

  useEffect(() => {
    const tick = () => {
      const next = read()
      setValue((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    tick()
    const id = window.setInterval(tick, ms)
    return () => window.clearInterval(id)
  }, [read, ms])

  return value
}
