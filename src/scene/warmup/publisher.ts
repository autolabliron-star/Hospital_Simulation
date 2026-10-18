/**
 * Throttle for the warm-up's state: the run reports on every slice (many times a second), the stores and the DOM only need about 4 Hz
 * (CLAUDE.md: slow state goes to zustand at about 4 Hz, never per frame). A change of phase, and the end, always go through at once.
 */
import type { WarmupSnapshot } from './run'

export const PUBLISH_INTERVAL_MS = 250

export type WarmupPublish = Pick<WarmupSnapshot, 'phase' | 'progress' | 'ready' | 'failed' | 'timedOut'>

export class WarmupPublisher {
  private last = Number.NEGATIVE_INFINITY
  private phase: string | null = null

  constructor(
    private readonly sink: (s: WarmupPublish) => void,
    private readonly now: () => number = () => performance.now(),
    private readonly intervalMs: number = PUBLISH_INTERVAL_MS,
  ) {}

  /** Publish `s` if it is the end, a new phase, or the interval has passed. Returns whether it went out. */
  push(s: WarmupSnapshot): boolean {
    const t = this.now()
    if (!s.ready && s.phase === this.phase && t - this.last < this.intervalMs) return false
    this.phase = s.phase
    this.last = t
    this.sink({ phase: s.phase, progress: s.progress, ready: s.ready, failed: s.failed, timedOut: s.timedOut })
    return true
  }
}
