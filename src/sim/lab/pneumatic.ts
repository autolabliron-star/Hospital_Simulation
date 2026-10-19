/**
 * W4 lab: the single-tube pneumatic line (agent L). One tube in the pipe at a time: sends queue first in, first out, and the next tube is
 * launched `sendGapSeconds` after the previous one landed. A flight over a source's path (src/sim/pneumaticPath.ts) lasts `flightDuration`
 * and moves the sample along it with `flightDistance`, the same profile the scene draws. After landing the tube sits `receiveSeconds` in the
 * receive station, then is taken out (stage 'received') and handed on.
 *
 * Sample.where while it is here: line 'pneumatic', source = the riser it left, s = metres along that path (0 while it waits for the line,
 * the path length while it sits in the receive station). It is in flight exactly when `state.pneumatic.inFlight` is its id.
 */
import { flightDistance, flightDuration, PNEUMATIC_PATHS } from '../pneumaticPath'
import type { Job, LabHost } from './job'

export class Pneumatic {
  private readonly queue: Job[] = []
  private flying: Job | null = null
  private receiving: Job | null = null
  private t0 = 0
  private len = 0
  private dur = 0
  private receiveAt = 0
  private nextLaunchAt = -Infinity
  /** A tube has been taken out of the receive station: the lab sorts it next. */
  onReceived: (job: Job, t: number) => void = () => {}
  /** Debug hook for the tests: a launch (with the flight length and duration) and a landing. */
  onLaunch: ((job: Job, t: number, length: number, duration: number) => void) | null = null
  onLand: ((job: Job, t: number) => void) | null = null

  constructor(private readonly host: LabHost) {}

  /** A drawn tube goes into the line at riser `source` (0..3), behind the tubes already waiting. */
  enqueue(job: Job, source: number): void {
    const w = job.sample.where
    w.line = 'pneumatic'
    w.s = 0
    w.sDraw = 0
    w.module = null
    w.source = source
    job.prevS = 0
    this.queue.push(job)
    this.host.state.pneumatic.queued = this.queue.length
    this.host.dirty()
  }

  get idle(): boolean {
    return this.flying === null && this.receiving === null && this.queue.length === 0
  }

  step(t: number): void {
    const st = this.host.state.pneumatic
    const f = this.flying
    if (f !== null) {
      const w = f.sample.where
      const el = t - this.t0
      if (el >= this.dur) {
        w.s = this.len
        this.flying = null
        st.inFlight = null
        this.receiving = f
        this.receiveAt = t + this.host.cfg.receiveSeconds
        this.nextLaunchAt = t + this.host.cfg.sendGapSeconds
        this.host.dirty()
        this.onLand?.(f, t)
      } else w.s = flightDistance(this.len, el)
    }
    const r = this.receiving
    if (r !== null && t >= this.receiveAt) {
      this.receiving = null
      this.onReceived(r, t)
    }
    if (this.flying === null && this.receiving === null && this.queue.length > 0 && t >= this.nextLaunchAt) {
      const job = this.queue.shift()!
      const path = PNEUMATIC_PATHS[job.sample.where.source]
      this.flying = job
      this.t0 = t
      this.len = path.length
      this.dur = flightDuration(path.length)
      job.sample.where.s = 0
      st.inFlight = job.sample.id
      st.queued = this.queue.length
      st.sentToday++
      this.host.dirty()
      this.onLaunch?.(job, t, this.len, this.dur)
    }
  }
}
