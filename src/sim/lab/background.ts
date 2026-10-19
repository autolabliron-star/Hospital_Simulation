/**
 * W4 lab: the ward's own samples (agent L). They are drawn at the bedside (not modelled) and reach the receive station directly, at
 * `config.lab.backgroundPerHour` (an inhomogeneous Poisson process, seeded): they keep the track busy and the archive filling.
 */
import { CONFIG } from '../config'
import { ArrivalProcess } from '../population/schedule'
import type { Rng } from '../rng'

export class BackgroundFlow {
  private proc: ArrivalProcess
  private nextAt: number

  constructor(
    private readonly rng: Rng,
    startT: number,
  ) {
    this.proc = new ArrivalProcess(rng.fork('arrivals'), CONFIG.lab.backgroundPerHour, startT)
    this.nextAt = this.proc.next()
  }

  /** Start the arrivals again from sim time `startT` (a warm start at another hour: the lab is empty, arrivals continue from there). */
  reset(startT: number): void {
    this.proc = new ArrivalProcess(this.rng.fork('arrivals'), CONFIG.lab.backgroundPerHour, startT)
    this.nextAt = this.proc.next()
  }

  /** True once per arrival whose time has come (call in a loop until false). */
  due(t: number): boolean {
    if (t < this.nextAt) return false
    this.nextAt = this.proc.next()
    return true
  }
}
