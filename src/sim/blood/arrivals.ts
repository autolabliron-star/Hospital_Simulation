/**
 * When booked blood outpatients arrive: `config.blood.outpatientsPerHour` (piecewise linear by clock hour, peak 07:30-09:30), seeded.
 *
 * Booked patients come at appointment slots, not as a Poisson stream, so the arrivals are stratified: the expected-arrivals count (the
 * integral of the rate) runs up, and arrival k fires when it reaches k + a seeded place inside (0.05, 0.95). The count is within one of
 * the curve's integral every time (a morning is never an empty hour by bad luck), the gaps are uneven, and the same seed gives the same times.
 */
import { CONFIG } from '../config'
import { rateAt, type Curve } from '../population/schedule'

export class ArrivalSchedule {
  private acc = 0
  private k = 0
  private threshold: number

  constructor(
    private readonly rng: { float(): number },
    private readonly curve: Curve = CONFIG.blood.outpatientsPerHour,
  ) {
    this.threshold = this.drawThreshold()
  }

  /** Expected arrivals so far (the integral of the rate since the schedule started). */
  get expected(): number {
    return this.acc
  }
  get count(): number {
    return this.k
  }

  /** Advance `dt` seconds at clock hour `hour`; the number of patients who arrive in this step (0 or 1 at 60 Hz). */
  step(hour: number, dt: number): number {
    this.acc += (rateAt(this.curve, hour) * dt) / 3600
    let n = 0
    while (this.acc >= this.threshold) {
      n++
      this.k++
      this.threshold = this.drawThreshold()
    }
    return n
  }

  private drawThreshold(): number {
    return this.k + 0.05 + 0.9 * this.rng.float()
  }
}

/** Expected arrivals between two clock hours (a warm start numbers the day's tickets from this). */
export function expectedArrivals(from: number, to: number, curve: Curve = CONFIG.blood.outpatientsPerHour): number {
  if (to <= from) return 0
  const n = 400
  let sum = 0
  for (let i = 0; i < n; i++) sum += rateAt(curve, from + ((i + 0.5) * (to - from)) / n)
  return (sum * (to - from)) / n
}
