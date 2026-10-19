/**
 * W4 lab: the modules on the outer side of the track (agent L): the sorter, the sample-quality camera, two centrifuges, the decapper, the
 * four analysers, the recapper and the fridge archive. A tube that a module "diverts" waits in that module's queue (STAT before routine,
 * first come first served inside each), is worked on one at a time, then is handed back to the lab, which puts it on the lane again.
 *
 * The centrifuges are different: a batch is loaded, spun and unloaded together. STAT tubes start a 'stat' spin at once (a free unit takes
 * them as soon as they arrive); routine tubes batch up until the unit is full or the oldest has waited `routineBatchMaxWaitSeconds`.
 * EDTA tubes (the blood count) never spin: their route skips the centrifuges.
 *
 * Nothing here reads a result value. Allocation-light: queues are plain arrays that only change when a tube arrives or leaves.
 */
import type { AnalyserKind, CentrifugeState, LabPriority } from '../types'
import { MODULE_STAGE, type Job, type LabHost } from './job'

export interface ModuleEvents {
  /** A module finished with a tube: the lab sends it on its way. */
  done(job: Job, moduleId: string, t: number): void
  /** An analyser finished aspirating a tube: its tests are now measuring. */
  aspirated(job: Job, kind: AnalyserKind, t: number): void
}

/** Lid opening or closing, seconds. */
export const LID_SECONDS = 1.2
/** Rotor run-up and braking, seconds: the spin's `spinSeconds` is the time at speed in between. */
export const RAMP_UP_SECONDS = 12
export const BRAKE_SECONDS = 18
/** Putting a tube into its rack in the fridge. */
export const ARCHIVE_SECONDS = 3

function ease(k: number): number {
  const x = k < 0 ? 0 : k > 1 ? 1 : k
  return x * x * (3 - 2 * x)
}

// ---------------------------------------------------------------------------------------------
// One-at-a-time stations
// ---------------------------------------------------------------------------------------------

export class Station {
  readonly queue: Job[] = []
  busy: Job | null = null
  protected until = 0
  protected startedAt = 0

  constructor(
    protected readonly host: LabHost,
    protected readonly events: ModuleEvents,
    readonly id: string,
    readonly stopS: number,
  ) {}

  /** The tube is inside the module now (diverted off the lane, or taken from the receive station). */
  enqueue(job: Job, t: number): void {
    this.host.placeInModule(job, this.id, this.stopS)
    job.since = t
    const stage = MODULE_STAGE[this.id]
    if (stage) this.host.setStage(job, stage, t)
    this.host.traceVisit(job, this.id, t)
    const q = this.queue
    if (job.sample.priority === 'stat') {
      let i = 0
      while (i < q.length && q[i].sample.priority === 'stat') i++
      q.splice(i, 0, job)
    } else q.push(job)
    this.queueChanged()
    this.host.dirty()
  }

  protected duration(_job: Job): number {
    return 0
  }
  protected started(_job: Job, _t: number): void {}
  protected finished(_job: Job, _t: number): void {}
  protected queueChanged(): void {}

  step(t: number, _dt: number): void {
    const b = this.busy
    if (b !== null && t >= this.until) {
      this.busy = null
      this.finished(b, t)
      this.events.done(b, this.id, t)
      this.host.dirty()
    }
    if (this.busy === null && this.queue.length > 0) {
      const j = this.queue.shift()!
      this.busy = j
      this.startedAt = t
      this.until = t + this.duration(j)
      this.queueChanged()
      this.started(j, t)
      this.host.dirty()
    }
  }
}

/** The receive station's sorter: takes each tube out of the pipe and puts it in a puck. */
export class Sorter extends Station {
  protected override duration(): number {
    return this.host.rng.between(this.host.cfg.sortSeconds)
  }
}

/** The sample-quality camera: looks at every tube (a haemolysed one is only flagged: nothing branches on it). */
export class Camera extends Station {
  protected override duration(): number {
    return this.host.cfg.cameraSeconds
  }
  protected override finished(job: Job): void {
    if (this.host.rng.chance(this.host.cfg.haemolysisChance)) job.sample.qc = 'haemolysed'
  }
}

export class Decapper extends Station {
  protected override duration(): number {
    return this.host.cfg.decapSeconds
  }
}

export class Recapper extends Station {
  protected override duration(): number {
    return this.host.cfg.recapSeconds
  }
}

export class Archive extends Station {
  protected override duration(): number {
    return ARCHIVE_SECONDS
  }
}

/** One analyser: one probe, one aspiration at a time. A tube's tests on this analyser are aspirated one after the other. */
export class Analyser extends Station {
  constructor(
    host: LabHost,
    events: ModuleEvents,
    id: string,
    stopS: number,
    readonly kind: AnalyserKind,
    private readonly testsOf: (job: Job, kind: AnalyserKind) => number,
  ) {
    super(host, events, id, stopS)
  }

  private get st() {
    return this.host.state.analysers[this.kind]
  }
  private get aspirateSeconds(): number {
    return this.host.cfg.aspirateSeconds[this.kind]
  }

  protected override duration(job: Job): number {
    return this.testsOf(job, this.kind) * this.aspirateSeconds
  }
  protected override queueChanged(): void {
    this.st.queue = this.queue.length
  }
  protected override started(job: Job): void {
    this.st.aspirating = job.sample.id
  }
  protected override finished(job: Job, t: number): void {
    const st = this.st
    st.aspirating = null
    st.probe = 0
    this.events.aspirated(job, this.kind, t)
  }

  override step(t: number, dt: number): void {
    super.step(t, dt)
    const st = this.st
    if (this.busy === null) {
      if (st.probe !== 0) st.probe = 0
      return
    }
    // the probe dips once per test: down, hold, up
    const c = (t - this.startedAt) / this.aspirateSeconds
    const f = c - Math.floor(c)
    st.probe = f < 0.2 ? ease(f / 0.2) : f < 0.7 ? 1 : ease((1 - f) / 0.3)
  }
}

// ---------------------------------------------------------------------------------------------
// Centrifuges
// ---------------------------------------------------------------------------------------------

type Phase = CentrifugeState['phase']

export class CentrifugeUnit {
  readonly waitStat: Job[] = []
  readonly waitRoutine: Job[] = []
  /** Tubes assigned to this unit that are still on the lane. */
  enRoute = 0
  private readonly rotor: Job[] = []
  private phaseStart = 0
  private phaseLength = 0
  private released = 0
  private lastLeft = -1

  constructor(
    private readonly host: LabHost,
    private readonly events: ModuleEvents,
    readonly id: string,
    readonly stopS: number,
    readonly st: CentrifugeState,
  ) {}

  get phase(): Phase {
    return this.st.phase
  }
  get waiting(): number {
    return this.waitStat.length + this.waitRoutine.length
  }
  /** The tubes in the rotor now (loading, spinning or being unloaded). */
  get tubes(): readonly Job[] {
    return this.rotor
  }

  /** Seconds until this unit can start another batch (0 when it is idle). */
  remaining(t: number): number {
    if (this.st.phase === 'idle') return 0
    const el = t - this.phaseStart
    const perTube = this.host.cfg.loadSecondsPerTube
    const n = this.rotor.length
    const unload = LID_SECONDS * 2 + n * perTube
    if (this.st.phase === 'loading') return Math.max(0, this.phaseLength - el) + this.spinLength(this.st.program ?? 'routine') + unload
    if (this.st.phase === 'spinning') return Math.max(0, this.phaseLength - el) + unload
    return Math.max(0, this.phaseLength - el)
  }

  private spinLength(program: LabPriority): number {
    return RAMP_UP_SECONDS + this.host.cfg.spinSeconds[program] + BRAKE_SECONDS
  }

  /** A tube arrived at this unit's stop. */
  enqueue(job: Job, t: number): void {
    this.host.placeInModule(job, this.id, this.stopS)
    job.since = t
    this.host.setStage(job, 'centrifuge', t)
    this.host.traceVisit(job, this.id, t)
    if (this.enRoute > 0) this.enRoute--
    if (job.sample.priority === 'stat') this.waitStat.push(job)
    else this.waitRoutine.push(job)
    this.host.dirty()
  }

  private startLoading(program: LabPriority, t: number): void {
    const from = program === 'stat' ? this.waitStat : this.waitRoutine
    const n = Math.min(from.length, this.st.capacity)
    this.rotor.length = 0
    for (let i = 0; i < n; i++) this.rotor.push(from[i])
    from.splice(0, n)
    this.st.phase = 'loading'
    this.st.program = program
    this.st.load = 0
    this.phaseStart = t
    this.phaseLength = LID_SECONDS * 2 + n * this.host.cfg.loadSecondsPerTube
    this.st.timeLeft = this.phaseLength
    this.host.dirty()
  }

  step(t: number, _dt: number): void {
    const st = this.st
    const perTube = this.host.cfg.loadSecondsPerTube
    if (st.phase === 'idle') {
      const maxWait = this.host.cfg.routineBatchMaxWaitSeconds
      const routineDue = this.waitRoutine.length > 0 && (this.waitRoutine.length >= st.capacity || t - this.waitRoutine[0].since >= maxWait)
      // STAT first; but a routine batch that has waited twice its limit goes first, so a long run of STAT tubes cannot starve it
      const starved = this.waitRoutine.length > 0 && t - this.waitRoutine[0].since >= 2 * maxWait
      if (this.waitStat.length > 0 && !starved) this.startLoading('stat', t)
      else if (routineDue) this.startLoading('routine', t)
      else {
        if (st.rpm01 !== 0) st.rpm01 = 0
        if (st.lid !== 0) st.lid = 0
        return
      }
    }
    const el = t - this.phaseStart
    const n = this.rotor.length
    if (st.phase === 'loading') {
      if (el >= this.phaseLength) {
        st.phase = 'spinning'
        st.load = n
        st.lid = 0
        this.phaseStart = t
        this.phaseLength = this.spinLength(st.program!)
        this.host.dirty()
        return this.step(t, 0)
      }
      const open = LID_SECONDS + n * perTube
      st.lid = el < LID_SECONDS ? ease(el / LID_SECONDS) : el < open ? 1 : 1 - ease((el - open) / LID_SECONDS)
      const loaded = el < LID_SECONDS ? 0 : Math.min(n, Math.floor((el - LID_SECONDS) / perTube) + 1)
      if (loaded !== st.load) {
        st.load = loaded
        this.host.dirty()
      }
      this.setTimeLeft(this.phaseLength - el)
      return
    }
    if (st.phase === 'spinning') {
      if (el >= this.phaseLength) {
        st.phase = 'unloading'
        st.rpm01 = 0
        st.timeLeft = 0
        this.phaseStart = t
        this.phaseLength = LID_SECONDS * 2 + n * perTube
        this.released = 0
        this.lastLeft = -1
        this.host.dirty()
        // the tubes are a little ahead in their next stage once they leave: 'centrifuge' stays until they re-enter the lane
        return this.step(t, 0)
      }
      st.rpm01 = el < RAMP_UP_SECONDS ? ease(el / RAMP_UP_SECONDS) : el > this.phaseLength - BRAKE_SECONDS ? ease((this.phaseLength - el) / BRAKE_SECONDS) : 1
      this.setTimeLeft(this.phaseLength - el)
      return
    }
    // unloading: lid opens, one tube comes out per `loadSecondsPerTube`, lid closes
    const open = LID_SECONDS + n * perTube
    st.lid = el < LID_SECONDS ? ease(el / LID_SECONDS) : el < open ? 1 : 1 - ease((el - open) / LID_SECONDS)
    while (this.released < n && el >= LID_SECONDS + (this.released + 1) * perTube) {
      const j = this.rotor[this.released++]
      st.load = n - this.released
      this.host.dirty()
      this.events.done(j, this.id, t)
    }
    this.setTimeLeft(this.phaseLength - el)
    if (el >= this.phaseLength) {
      st.phase = 'idle'
      st.program = null
      st.load = 0
      st.lid = 0
      st.timeLeft = 0
      this.rotor.length = 0
      this.host.dirty()
    }
  }

  private setTimeLeft(v: number): void {
    const s = v > 0 ? v : 0
    this.st.timeLeft = s
    const whole = Math.ceil(s)
    if (whole !== this.lastLeft) {
      this.lastLeft = whole
      this.host.dirty()
    }
  }
}

/** Which unit takes a tube: STAT tubes go to a free unit, routine tubes join an open batch, else a free unit, else the one that frees first. */
export function pickUnit(units: readonly CentrifugeUnit[], priority: LabPriority, t: number): CentrifugeUnit {
  let best = units[0]
  let bestScore = Infinity
  for (let i = 0; i < units.length; i++) {
    const u = units[i]
    let score: number
    if (priority === 'stat') {
      // keep unit 0 for the routine batches: a STAT tube prefers the last free unit
      if (u.phase === 'idle') score = u.enRoute === 0 && u.waitStat.length === 0 ? (u.waitRoutine.length === 0 ? 0 : 1) : 2
      else score = 10 + u.remaining(t) / 1000
      score += (units.length - 1 - i) * 0.01
    } else {
      const open = u.waitRoutine.length > 0 && u.waitRoutine.length + u.enRoute < u.st.capacity
      if (open) score = -1 - u.waitRoutine.length / 1000
      else if (u.phase === 'idle') score = u.waiting === 0 && u.enRoute === 0 ? 0 : 5
      else score = 10 + u.remaining(t) / 1000
      score += i * 0.01
    }
    if (score < bestScore - 1e-12) {
      best = u
      bestScore = score
    }
  }
  return best
}
