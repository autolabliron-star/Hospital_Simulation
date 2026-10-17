/**
 * Simulation-time clock for xstate (pattern: Waltz `SimClock`). The patient pathway's waiting times are `after`
 * delays inside the machine; handing xstate this clock instead of the browser's timers makes them run on sim time,
 * so they honour pause and the 1x / 2x / 4x speeds, and a replay with the same seed fires them at the same moments.
 *
 * Timers fire in (time, creation order), so two timers due in the same step always run in the same order.
 */
interface SimTimer {
  id: number
  at: number
  seq: number
  fn: () => void
}

export class SimClock {
  /** Current time in milliseconds of simulation time. */
  now = 0
  private seq = 0
  private nextId = 1
  private readonly timers: SimTimer[] = []

  setTimeout(fn: () => void, ms: number): number {
    const delay = Number.isFinite(ms) ? Math.max(0, ms) : 1e15
    const timer: SimTimer = { id: this.nextId++, at: this.now + delay, seq: this.seq++, fn }
    // binary insert keeps the list ordered by (at, seq)
    let lo = 0
    let hi = this.timers.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const t = this.timers[mid]
      if (t.at < timer.at || (t.at === timer.at && t.seq < timer.seq)) lo = mid + 1
      else hi = mid
    }
    this.timers.splice(lo, 0, timer)
    return timer.id
  }

  clearTimeout(id: number): void {
    const i = this.timers.findIndex((t) => t.id === id)
    if (i >= 0) this.timers.splice(i, 1)
  }

  /** Advance to `ms` and run every timer that has come due, including timers those timers schedule. */
  advanceTo(ms: number): void {
    while (this.timers.length > 0 && this.timers[0].at <= ms) {
      const t = this.timers.shift()!
      this.now = t.at
      t.fn()
    }
    this.now = ms
  }

  get pending(): number {
    return this.timers.length
  }
}
