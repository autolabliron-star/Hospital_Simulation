/**
 * The porters' job board: a FIFO queue with admissions first. Pure and deterministic.
 *   toDiagnostics   bay -> Lab & imaging, by wheelchair
 *   fromDiagnostics Lab & imaging -> the same bay, by wheelchair
 *   admit           bay -> the nearest lift, by stretcher (goes ahead of the other jobs)
 *   toImaging       bay -> the scan table (CT, X-ray, ultrasound), by wheelchair, or by stretcher for acuity 1-2
 *   fromImaging     the scan table -> the same bay, in the same kind of vehicle
 */
export type PorterJobKind = 'toDiagnostics' | 'fromDiagnostics' | 'admit' | 'toImaging' | 'fromImaging'

export interface PorterJob {
  id: number
  kind: PorterJobKind
  /** The patient (an ErCase id). */
  caseId: string
  createdAt: number
  porterId: string | null
  done: boolean
}

export class PorterBoard {
  private nextId = 1
  private readonly open: PorterJob[] = []
  /** Every job ever requested (tests check that all complete). */
  readonly history: PorterJob[] = []

  request(kind: PorterJobKind, caseId: string, t: number): PorterJob {
    const job: PorterJob = { id: this.nextId++, kind, caseId, createdAt: t, porterId: null, done: false }
    this.open.push(job)
    this.history.push(job)
    return job
  }

  /** Unclaimed jobs. */
  get pending(): number {
    let n = 0
    for (const j of this.open) if (j.porterId === null) n++
    return n
  }

  /** The next job for this porter: admissions first, then the oldest. */
  claim(porterId: string): PorterJob | null {
    let best: PorterJob | null = null
    for (const j of this.open) {
      if (j.porterId !== null) continue
      if (best === null) best = j
      else if (j.kind === 'admit' && best.kind !== 'admit') best = j
      else if ((j.kind === 'admit') === (best.kind === 'admit') && j.id < best.id) best = j
    }
    if (best) best.porterId = porterId
    return best
  }

  complete(job: PorterJob): void {
    job.done = true
    const i = this.open.indexOf(job)
    if (i >= 0) this.open.splice(i, 1)
  }
}
