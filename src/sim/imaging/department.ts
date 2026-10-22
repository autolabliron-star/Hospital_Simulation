/**
 * The imaging department: four scanners, a booking queue for each, the outpatients booked for the day, the radiographers
 * and the sonographer, and the reports that follow the scans. The Simulation owns one (`sim.imaging`) and steps it every
 * fixed step before the people update.
 *
 *   ER patients     ask for a scan when the doctor orders one (`requestErExam`); a porter brings them to the table
 *   outpatients     arrive from their appointment time minus a few minutes, check in, wait in the imaging hall
 *   the presenter   `startDemoScan(modality)`: a demo patient appears in the hall within `demoArrivalSeconds` and goes to
 *                   the front of that scanner's queue
 *
 * A scanner takes the best waiting booking (demo, then ER by acuity, then outpatients by appointment) as soon as it is
 * free; the exam runs as the script in scanner.ts. `scanners[m]` is the `ScannerState` the scene animates.
 */
import { OUTPATIENTS, outpatientTimeSeconds, protocolById, PROTOCOLS } from '@/content/imaging'
import { CONFIG } from '../config'
import type { World } from '../er/world'
import { clockText } from '../events'
import { ARRIVALS } from '../places'
import type { Rng } from '../rng'
import type { ImagingExam, ImagingModality, ScannerState } from '../types'
import { MODALITIES } from '../types'
import type { Walker } from '../walker'
import { BookingQueue, type Booking } from './booking'
import { buildExam, drawPlan, imageSeedOf, sequenceSeconds, type ExamPlan } from './exam'
import { ImagingOperator } from './operator'
import { Outpatient } from './outpatient'
import { Scanner } from './scanner'
import { buildSites, CubiclePool, type ImagingSites } from './sites'
import type { ErPatient } from '../er/patient'

/** The demo patient's exam per scanner (the presenter's button), cycling through the protocols of that modality. */
const DEMO_PROTOCOLS: Record<ImagingModality, string[]> = {
  mri: ['mri-lumbar', 'mri-brain', 'mri-knee'],
  ct: ['ct-head', 'ct-abdo', 'ct-chest'],
  xray: ['xr-ankle', 'xr-wrist', 'xr-hip', 'xr-knee'],
  us: ['us-abdo', 'us-renal'],
}

/**
 * The exams placed mid-way at an in-flight start, per scanner: [protocol, the sequences it may be in]. Long sequences first
 * (MRI), the ultrasound always on the renal exam's "Right kidney" (the headline image), CT in the contrast phases.
 */
const IN_FLIGHT: Record<ImagingModality, readonly (readonly [string, readonly number[]])[]> = {
  mri: [['mri-brain', [2, 3]], ['mri-lumbar', [1, 2]], ['mri-knee', [1, 2]]],
  ct: [['ct-abdo', [0, 1]], ['ct-chest', [0]]],
  xray: [['xr-ankle', [0]], ['xr-hip', [0]], ['xr-wrist', [0]]],
  us: [['us-renal', [0]]],
}

/** Outpatients already seated in the imaging hall at an in-flight start. */
const IN_FLIGHT_HALL = 2
/** The pause after the first X-ray view of a placed exam (s). */
const IN_FLIGHT_XRAY_GAP = 24

interface Report {
  at: number
  exam: ImagingExam
  booking: Booking
}

interface Due {
  at: number
  booking: Booking
  name: string
  id: string
}

export class ImagingDepartment {
  readonly sites: ImagingSites
  readonly cubicles: CubiclePool
  readonly machines: Record<ImagingModality, Scanner>
  /** The state the scene animates, one per modality (the same objects, updated every step). */
  readonly scanners: Record<ImagingModality, ScannerState>
  readonly queues: Record<ImagingModality, BookingQueue>
  /** Every booking ever made, in order (tests and KPIs read them). */
  readonly bookings: Booking[] = []
  /** Outpatients on site now. */
  readonly outpatients: Outpatient[] = []
  /** Exams finished (the last sequence done) per modality, and every exam started, in order. */
  readonly exams: ImagingExam[] = []
  readonly finished: Record<ImagingModality, number> = { mri: 0, ct: 0, xray: 0, us: 0 }
  /** Visits completed (patient off the table, scanner free again). */
  readonly released: Record<ImagingModality, number> = { mri: 0, ct: 0, xray: 0, us: 0 }
  outpatientsSpawned = 0
  outpatientsHome = 0
  /** Steps the script had to force because somebody did not arrive (a bug if not zero). */
  stuckFixes = 0
  readonly stuckLog: string[] = []
  readonly reportsReady: Report[] = []
  /** Seconds each scanner was busy inside the utilisation window. */
  readonly busyWindow: Record<ImagingModality, number> = { mri: 0, ct: 0, xray: 0, us: 0 }
  private readonly pendingOutpatients: { at: number; index: number }[] = []
  private readonly pendingDemos: Due[] = []
  private readonly reports: Report[] = []
  private readonly standing = new Set<number>()
  private readonly rngs: Record<ImagingModality, Rng>
  private readonly rng: Rng
  private demoCount = 0
  private t = 0
  private readonly window: [number, number]

  constructor(
    private readonly world: World,
    rng: Rng,
    private readonly walkerFor: (id: string) => Walker,
  ) {
    this.rng = rng.fork('imaging')
    this.sites = buildSites(world.seats)
    this.cubicles = new CubiclePool(this.sites.cubicles)
    const ports = {
      say: (type: Parameters<World['say']>[0], text: string, refs?: Parameters<World['say']>[2]) => this.world.say(type, text, refs),
      seats: world.seats,
      cubicles: this.cubicles,
      stuck: (m: ImagingModality, step: string) => {
        this.stuckFixes++
        if (this.stuckLog.length < 40) this.stuckLog.push(`${this.t.toFixed(0)}s ${m} stuck in ${step}`)
      },
      examDone: (exam: ImagingExam, booking: Booking, plan: ExamPlan) => this.examDone(exam, booking, plan),
      released: (b: Booking) => {
        this.released[b.modality]++
      },
    }
    const machines = {} as Record<ImagingModality, Scanner>
    const scanners = {} as Record<ImagingModality, ScannerState>
    const queues = {} as Record<ImagingModality, BookingQueue>
    const rngs = {} as Record<ImagingModality, Rng>
    for (const m of MODALITIES) {
      machines[m] = new Scanner(m, this.sites.scanners[m], ports)
      scanners[m] = machines[m].state
      queues[m] = new BookingQueue(m)
      rngs[m] = this.rng.fork(`scanner:${m}`)
    }
    this.machines = machines
    this.scanners = scanners
    this.queues = queues
    this.rngs = rngs
    const [h0, h1] = CONFIG.imaging.utilisationHours
    this.window = [(h0 - CONFIG.sim.startHour) * 3600, (h1 - CONFIG.sim.startHour) * 3600]
  }

  /** A radiographer or the sonographer comes on shift. */
  attachOperator(op: ImagingOperator): void {
    this.machines[op.modality].setOperator(op)
  }

  /**
   * S1 in-flight warm: a patient mid-exam on every staffed scanner (the ultrasound on the right kidney), placed with
   * `Scanner.warmBegin` and held there through the hidden pre-roll (`CONFIG.opening.preRollSeconds` plus a second, or until
   * `endWarmHold()`), so the reveal finds each sequence `CONFIG.opening.seqProgress` through. Logs nothing. A scanner with
   * no operator on duty at this hour, or one that is busy, is skipped. Drawn from forks of the department rng, so the day's
   * own draws are untouched. Call after `startOutpatients(t)`; the day's own appointments just wait for the scanner as usual.
   */
  warmInFlight(t: number): void {
    const root = this.rng.fork('inFlight')
    const [p0, p1] = CONFIG.opening.seqProgress
    for (const m of MODALITIES) {
      const sc = this.machines[m]
      if (!sc.free) continue
      const r = root.fork(m)
      const [protocolId, seqs] = IN_FLIGHT[m][r.int(0, IN_FLIGHT[m].length - 1)]
      const seq = seqs[r.int(0, seqs.length - 1)]
      const proto = protocolById(protocolId)
      const sites = this.sites.scanners[m]
      const id = `inflight-${m}`
      const name = this.world.uniqueName(r)
      const b: Booking = {
        id: this.world.id('bk'),
        kind: 'outpatient',
        modality: m,
        protocolId: proto.id,
        protocolName: proto.name,
        patientId: id,
        patientName: name,
        acuity: 5,
        requestedAt: t - 600,
        apptAt: t,
        ready: true,
        state: 'waiting',
        subject: null,
      }
      const exam = buildExam(this.world.id('exam'), proto, { patientId: id, patientName: name }, 'outpatient', imageSeedOf(id))
      const plan = drawPlan(r.fork('plan'), exam, { demo: false, transported: false })
      // an X-ray exposure is over in a second and a half: the patient is turned for the second view slowly enough that the
      // exam is still in its scanning phase if the pre-roll is a little longer than planned (a Jump's 60 s)
      if (m === 'xray' && plan.gapS.length > 0) plan.gapS[0] = Math.max(plan.gapS[0], IN_FLIGHT_XRAY_GAP)
      const seat = sites.tableSeat
      const p = new Outpatient(this.services(), b, id, name, { x: seat.x, z: seat.z }, seat.heading, this.walkerFor(id), r.fork(id), false)
      b.subject = p
      if (!sc.warmBegin(b, exam, plan, seq, r.range(p0, p1) * sequenceSeconds(m, exam.sequences[seq]), CONFIG.opening.preRollSeconds + 1)) {
        this.world.releaseName(name)
        p.walker.remove()
        continue
      }
      p.warmOnTable()
      this.bookings.push(b)
      this.exams.push(exam)
      this.outpatients.push(p)
      this.outpatientsSpawned++
      this.world.hooks.add(p)
    }
    this.warmWaiting(t, IN_FLIGHT_HALL)
  }

  /** S1 in-flight warm: the day's next `n` appointments are already here, checked in and seated in the imaging hall. */
  private warmWaiting(t: number, n: number): void {
    for (let k = 0; k < n && this.pendingOutpatients.length > 0; k++) {
      const { index } = this.pendingOutpatients[0]
      const o = OUTPATIENTS[index]
      const proto = PROTOCOLS[o.protocol]
      const hall = this.sites.scanners[proto.modality].hallDoor
      const b: Booking = {
        id: this.world.id('bk'),
        kind: 'outpatient',
        modality: proto.modality,
        protocolId: proto.id,
        protocolName: proto.name,
        patientId: o.id,
        patientName: o.name,
        acuity: 5,
        requestedAt: t,
        apptAt: outpatientTimeSeconds(o),
        ready: false,
        state: 'waiting',
        subject: null,
      }
      const p = new Outpatient(this.services(), b, o.id, o.name, { x: hall.x, z: hall.z }, Math.PI, this.walkerFor(o.id), this.rng.fork(o.id), false, o.age)
      if (!p.warmWaiting()) {
        p.walker.remove()
        break
      }
      this.pendingOutpatients.shift()
      b.subject = p
      this.enqueue(b)
      this.outpatients.push(p)
      this.outpatientsSpawned++
      this.world.hooks.add(p)
    }
  }

  /** The hidden pre-roll is over: the placed exams resume (they do on their own a second after `preRollSeconds`). */
  endWarmHold(): void {
    for (const m of MODALITIES) this.machines[m].endWarmHold()
  }

  /** The day's outpatient appointments: each person arrives a few minutes before theirs. */
  /** `t0` > 0 is a warm start at a later hour (L1 Jump): appointments whose arrival is already past are skipped. */
  startOutpatients(t0 = 0): void {
    const early = this.rng.fork('early')
    OUTPATIENTS.forEach((o, index) => {
      const at = Math.max(1, outpatientTimeSeconds(o) - early.between(CONFIG.imaging.outpatientEarlySeconds))
      if (at >= t0) this.pendingOutpatients.push({ at, index })
    })
    this.pendingOutpatients.sort((a, b) => a.at - b.at || a.index - b.index)
  }

  // --- requests ---------------------------------------------------------------------------------------------

  /** The ER doctor ordered a scan: the patient joins the queue of the scanner for this protocol. */
  requestErExam(patient: ErPatient, protocolId: string): Booking {
    const proto = protocolById(protocolId)
    const b: Booking = {
      id: this.world.id('bk'),
      kind: 'er',
      modality: proto.modality,
      protocolId: proto.id,
      protocolName: proto.name,
      patientId: patient.c.id,
      patientName: patient.c.name,
      acuity: patient.c.acuity,
      requestedAt: this.t,
      apptAt: this.t,
      ready: true,
      state: 'waiting',
      subject: patient,
    }
    this.enqueue(b)
    return b
  }

  /** Is somebody on duty to run this scanner (MRI and ultrasound have nobody after 18:00)? */
  hasOperator(m: ImagingModality): boolean {
    return this.machines[m].operator !== null
  }

  /**
   * The presenter's "start a scan now": a demo patient appears in the hall within a few seconds, at the front of the queue.
   * Returns false, books nobody and spawns nobody when no operator is on duty for the scanner (F-06): the viewer says so.
   */
  startDemoScan(m: ImagingModality): boolean {
    if (!this.hasOperator(m)) return false
    const list = DEMO_PROTOCOLS[m]
    const proto = protocolById(list[this.demoCount++ % list.length])
    const id = this.world.id('demo')
    const name = this.world.uniqueName(this.rng)
    const b: Booking = {
      id: this.world.id('bk'),
      kind: 'demo',
      modality: m,
      protocolId: proto.id,
      protocolName: proto.name,
      patientId: id,
      patientName: name,
      acuity: 5,
      requestedAt: this.t,
      apptAt: this.t,
      ready: true,
      state: 'waiting',
      subject: null,
    }
    this.enqueue(b)
    this.pendingDemos.push({ at: this.t + CONFIG.imaging.demoArrivalSeconds, booking: b, name, id })
    return true
  }

  /** A demo booking whose operator left before the patient appeared: take it out of the queue and the books. */
  private cancelDemo(d: Due): void {
    this.queues[d.booking.modality].remove(d.booking)
    const i = this.bookings.indexOf(d.booking)
    if (i >= 0) this.bookings.splice(i, 1)
  }

  private enqueue(b: Booking): void {
    this.bookings.push(b)
    this.queues[b.modality].add(b)
  }

  // --- the step -------------------------------------------------------------------------------------------------

  step(t: number, dt: number): void {
    this.t = t
    while (this.pendingOutpatients.length > 0 && this.pendingOutpatients[0].at <= t) this.spawnOutpatient(this.pendingOutpatients.shift()!.index)
    while (this.pendingDemos.length > 0 && this.pendingDemos[0].at <= t) {
      const d = this.pendingDemos.shift()!
      if (this.hasOperator(d.booking.modality)) this.spawnDemo(d)
      else this.cancelDemo(d) // the operator went off shift in the few seconds since the press: never park a patient
    }
    for (const m of MODALITIES) {
      const sc = this.machines[m]
      if (sc.free) {
        const b = this.queues[m].next()
        if (b) this.assign(sc, b)
      }
      sc.step(dt)
      if (t >= this.window[0] && t <= this.window[1] && sc.state.phase !== 'idle') this.busyWindow[m] += dt
    }
    while (this.reports.length > 0 && this.reports[0].at <= t) {
      const r = this.reports.shift()!
      this.world.say('reportReady', `${r.exam.patientName}'s ${r.exam.protocol} report is ready.`, { subjectId: r.exam.patientId })
      r.booking.subject?.reportReady()
      this.reportsReady.push(r)
    }
  }

  private assign(sc: Scanner, b: Booking): void {
    this.queues[b.modality].remove(b)
    const proto = protocolById(b.protocolId)
    const exam = buildExam(this.world.id('exam'), proto, { patientId: b.patientId, patientName: b.patientName }, b.kind, imageSeedOf(b.patientId))
    const plan = drawPlan(this.rngs[b.modality], exam, { demo: b.kind === 'demo', transported: b.kind === 'er' })
    this.exams.push(exam)
    sc.begin(b, exam, plan)
  }

  private examDone(exam: ImagingExam, booking: Booking, plan: ExamPlan): void {
    this.finished[exam.modality]++
    const r: Report = { at: this.t + plan.reportS, exam, booking }
    let i = this.reports.length
    while (i > 0 && this.reports[i - 1].at > r.at) i--
    this.reports.splice(i, 0, r)
  }

  // --- people ---------------------------------------------------------------------------------------------------

  private services() {
    return {
      world: this.world,
      sites: this.sites,
      cubicles: this.cubicles,
      standing: this.standing,
      gone: (o: Outpatient) => {
        const i = this.outpatients.indexOf(o)
        if (i >= 0) this.outpatients.splice(i, 1)
        if (o.home) this.outpatientsHome++
      },
    }
  }

  private spawnOutpatient(index: number): void {
    const o = OUTPATIENTS[index]
    const proto = PROTOCOLS[o.protocol]
    const b: Booking = {
      id: this.world.id('bk'),
      kind: 'outpatient',
      modality: proto.modality,
      protocolId: proto.id,
      protocolName: proto.name,
      patientId: o.id,
      patientName: o.name,
      acuity: 5,
      requestedAt: this.t,
      apptAt: outpatientTimeSeconds(o),
      ready: false,
      state: 'waiting',
      subject: null,
    }
    const at = { x: ARRIVALS.entrance.at.x, z: ARRIVALS.entrance.at.z + this.rng.range(-0.8, 0.8) }
    const p = new Outpatient(this.services(), b, o.id, o.name, at, ARRIVALS.entrance.heading, this.walkerFor(o.id), this.rng.fork(o.id), false, o.age)
    b.subject = p
    this.enqueue(b)
    p.fadeIn()
    this.outpatients.push(p)
    this.outpatientsSpawned++
    this.world.hooks.add(p)
  }

  private spawnDemo(d: Due): void {
    const b = d.booking
    const hall = this.sites.scanners[b.modality].hallDoor
    const door = this.sites.scanners[b.modality].anchors.table.out
    const p = new Outpatient(
      this.services(),
      b,
      d.id,
      d.name,
      { x: hall.x, z: hall.z },
      Math.atan2(door.x - hall.x, door.z - hall.z),
      this.walkerFor(d.id),
      this.rng.fork(d.id),
      true,
    )
    b.subject = p
    p.fadeIn()
    this.outpatients.push(p)
    this.outpatientsSpawned++
    this.world.hooks.add(p)
    this.world.say('outpatientArrived', `${d.name} arrived for their ${b.protocolName}.`, { subjectId: d.id })
  }

  // --- numbers ---------------------------------------------------------------------------------------------------

  /** Share of the utilisation window (CONFIG.imaging.utilisationHours, 07:45 to 17:00) the scanner was not idle, 0..1. */
  utilisation(m: ImagingModality): number {
    const len = this.window[1] - this.window[0]
    return len > 0 ? Math.min(1, this.busyWindow[m] / len) : 0
  }

  /** Bookings waiting for a scanner (not yet taken). */
  get waiting(): number {
    let n = 0
    for (const m of MODALITIES) n += this.queues[m].length
    return n
  }

  /** A line for logs: queue lengths and what each scanner is doing. */
  describe(): string {
    return MODALITIES.map((m) => `${m}:${this.machines[m].state.phase}/${this.queues[m].length}`).join(' ')
  }

  /** The clock text of the appointment, for the UI. */
  static apptText(b: Booking): string {
    return clockText(b.apptAt)
  }
}
