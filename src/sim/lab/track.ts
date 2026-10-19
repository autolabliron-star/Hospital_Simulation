/**
 * W4 lab: the sample track's outbound lane (agent L). Pucks carrying a tube move forward along the lane (src/sim/labTrack.ts) at
 * `trackSpeed`, never closer than `puckGap` to the puck ahead. A puck that reaches the stop of the next module it needs leaves the lane there
 * (the module "diverts" it: Sample.where.line 'module'); when the module is done the tube asks to re-enter at the same stop and does so as
 * soon as the lane is clear of other pucks by `puckGap` on both sides. Tubes only ever travel forward, and end in the archive, so the lane
 * never blocks: a puck is held back only by one ahead of it, and every puck ahead is on its way to a stop.
 *
 * (Empty pucks and the return lane carry no sample and are not simulated.) Allocation-free in `step`.
 */
import { LAB_OUTBOUND_LENGTH } from '../labTrack'
import type { Job, LabHost } from './job'

export class Lane {
  /** The pucks on the lane, the one furthest along first. */
  readonly pucks: Job[] = []
  private readonly pending: Job[] = []
  /** A puck reached the stop of its next module. */
  onDivert: (job: Job, t: number) => void = () => {}
  /** A tube has been put on the lane (from the sorter or from a module). */
  onEnter: (job: Job, t: number) => void = () => {}

  constructor(private readonly host: LabHost) {}

  /** A tube wants to enter the lane at `s` (0 from the sorter, else the stop of the module it just left). */
  release(job: Job, s: number): void {
    job.exitS = s
    this.pending.push(job)
  }

  get waiting(): number {
    return this.pending.length
  }

  private clearAt(s: number): boolean {
    const gap = this.host.cfg.puckGap - 1e-9
    const pucks = this.pucks
    for (let i = 0; i < pucks.length; i++) if (Math.abs(pucks[i].sample.where.s - s) < gap) return false
    return true
  }

  step(t: number, dt: number): void {
    const pucks = this.pucks
    const gap = this.host.cfg.puckGap
    const v = this.host.cfg.trackSpeed
    let aheadS = Infinity
    let i = 0
    while (i < pucks.length) {
      const j = pucks[i]
      const w = j.sample.where
      let ns = w.s + v * dt
      const lim = aheadS - gap
      if (ns > lim) ns = lim > w.s ? lim : w.s
      if (ns >= j.stopS - 1e-9 || ns >= LAB_OUTBOUND_LENGTH) {
        w.s = ns > j.stopS ? j.stopS : ns
        for (let k = i; k < pucks.length - 1; k++) pucks[k] = pucks[k + 1]
        pucks.length--
        this.onDivert(j, t)
        continue
      }
      w.s = ns
      aheadS = ns
      i++
    }
    // tubes waiting to (re-)enter, oldest first
    const pend = this.pending
    let n = 0
    for (let k = 0; k < pend.length; k++) {
      const job = pend[k]
      if (this.clearAt(job.exitS)) {
        let at = 0
        while (at < pucks.length && pucks[at].sample.where.s > job.exitS) at++
        pucks.length++
        for (let m = pucks.length - 1; m > at; m--) pucks[m] = pucks[m - 1]
        pucks[at] = job
        this.host.placeOnLane(job, job.exitS)
        this.onEnter(job, t)
      } else pend[n++] = job
    }
    pend.length = n
  }
}
