/**
 * The imaging department: four scanners, a booking queue for each, the outpatients booked for the day, the radiographers
 * and the sonographer, and the reports that follow the scans. The Simulation owns one (`sim.imaging`) and steps it every
 * fixed step before the people update.
 *
 *   ER patients     ask for a scan when the doctor orders one (`requestErExam`); a porter brings them to the table
 *   outpatients     arrive from their appointment time minus a few minutes, check in, wait in the imaging hall
 *   the presenter   `startDemoScan(modality)`: a demo patient appears in the hall within `demoArrivalSeconds` and goes to
 *                   the front of that scanner's queue; `startDemoScan('us', 'us-cryo-breast')` books the cryoablation instead
 *                   (DEMO_PROCEDURES: the breast cancer and the fibroadenoma, both ProSense cases played by the step engine)
 *   watch           R5 wave 3: `startWatch(protocol, { fromStart? })` is "Watch step by step" for a ProSense case (a whole case compressed to the
 *                   script's watch seconds, 10-15 minutes): started / queued / following / busy / noTeam, `watchStartsAt` says when
 *                   (a projection of when the room is really free: the case in it to the end of its cleanup, the radiologist's walk out, every demo
 *                   booking ahead; null once the watch case has begun, like the theatre's). `startDemoScan('us', protocol, { watch: true })` is the
 *                   same call answering a boolean
 *
 * A scanner takes the best waiting booking (demo, then ER by acuity, then outpatients by appointment) as soon as it is
 * free; the exam runs as the script in scanner.ts. `scanners[m]` is the `ScannerState` the scene animates.
 */
import { OUTPATIENTS, outpatientTimeSeconds, protocolById, PROTOCOLS } from '@/content/imaging'
import { syntheticNameOf } from '@/content/roster'
import { IMAGING_STAFF } from '@/content/staff'
import { CONFIG } from '../config'
import type { World } from '../er/world'
import { clockText } from '../events'
import { ARRIVALS, IMAGING } from '../places'
import { compiledFor, watchUnitSeconds } from '../procedure'
import type { Rng } from '../rng'
import type { ImagingExam, ImagingModality, ScannerState, WatchResult } from '../types'
import { MODALITIES } from '../types'
import type { Walker } from '../walker'
import { BookingQueue, type Booking } from './booking'
import { buildExam, cryoCaseFor, cryoCaseForWatch, cryoSequences, cryoWatchSequences, drawPlan, expectedVisitSeconds, imageSeedOf, sequenceSeconds, type ExamPlan } from './exam'
import { ImagingOperator } from './operator'
import { Outpatient } from './outpatient'
import { ProcedureDoctor } from './procedureDoctor'
import { applyWatchPlan, isScripted, procedureIdOf, type ProcStart } from './prosense'
import { Scanner } from './scanner'
import { buildSites, CubiclePool, firstWalkable, type ImagingSites } from './sites'
import type { ErPatient } from '../er/patient'

/** The demo patient's exam per scanner (the presenter's button), cycling through the protocols of that modality. */
const DEMO_PROTOCOLS: Record<ImagingModality, string[]> = {
  mri: ['mri-lumbar', 'mri-brain', 'mri-knee'],
  ct: ['ct-head', 'ct-abdo', 'ct-chest'],
  xray: ['xr-ankle', 'xr-wrist', 'xr-hip', 'xr-knee'],
  us: ['us-abdo', 'us-renal'],
}

/**
 * Procedures the presenter can start instead of the default demo exam (`startDemoScan(m, protocolId)`): the ultrasound room's
 * ProSense cryoablation of an early breast cancer (docs/research/cryoablation.md). The default demo of every room is unchanged.
 */
export const DEMO_PROCEDURES: Readonly<Partial<Record<ImagingModality, readonly string[]>>> = {
  us: ['us-cryo-breast', 'us-cryo-fibroadenoma'],
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

/** A watch case that begins within this many seconds is 'started' (the room is free for it now). */
const ROOM_FREE_NOW_SECONDS = 0.5

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
  /** The demo patient's age, when the procedure needs one (`CONFIG.imaging.cryoAges`: 70 or more for the cancer, about 20-45 for a fibroadenoma); otherwise a seeded adult age. */
  age?: number
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
  /** R5 wave 3: the breast radiologist while a ProSense case is on (null: not in the building), and where she comes in and goes out (the hall). */
  private doctor: ProcedureDoctor | null = null
  private hallEntry = { x: 0, z: 0 }
  /** The "Watch step by step" booking not yet finished (null: none). */
  private watchBooking: Booking | null = null

  constructor(
    private readonly world: World,
    rng: Rng,
    private readonly walkerFor: (id: string) => Walker,
  ) {
    this.rng = rng.fork('imaging')
    this.sites = buildSites(world.seats)
    // (the last cubicle is the ProSense patient's alone: an MRI patient never needs more than the first two, so a case cannot take hers: R5 fix K19)
    this.cubicles = new CubiclePool(this.sites.cubicles, 1)
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
      doctor: () => this.bringDoctor(),
      doctorDone: (d: ProcedureDoctor) => d.dismiss(this.hallEntry),
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
   * With `{ watch: true }` (the ultrasound's ProSense procedures) it is "Watch step by step": `startWatch`, answering whether a case will be shown.
   */
  startDemoScan(m: ImagingModality, protocolId?: string, opts?: { watch?: boolean }): boolean {
    if (opts?.watch === true) {
      if (m !== 'us' || protocolId === undefined) return false
      const r = this.startWatch(protocolId)
      return r === 'started' || r === 'queued' || r === 'following'
    }
    // a named protocol must be one of this room's demo procedures (a wrong id from the UI books nothing, never throws mid-demo)
    if (protocolId !== undefined && !(DEMO_PROCEDURES[m] ?? []).includes(protocolId)) return false
    if (!this.hasOperator(m)) return false
    const list = DEMO_PROTOCOLS[m]
    const proto = protocolById(protocolId ?? list[this.demoCount++ % list.length])
    const id = this.world.id('demo')
    const b = this.demoBooking(m, proto, id)
    this.enqueue(b)
    this.insertDue({ at: this.t + CONFIG.imaging.demoArrivalSeconds, booking: b, name: b.patientName, id, age: b.age })
    return true
  }

  /** A demo booking for `proto` (the breast procedures' patient is a woman: her first name is from the female pool, so her avatar is a woman). */
  private demoBooking(m: ImagingModality, proto: ReturnType<typeof protocolById>, id: string): Booking {
    const woman = proto.bodyPart === 'breast'
    const name = woman ? this.uniqueWomanName() : this.world.uniqueName(this.rng)
    const span = CONFIG.imaging.cryoAges[proto.id]
    const age = woman ? this.rng.int(span?.[0] ?? 70, span?.[1] ?? 82) : undefined
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
    if (age !== undefined) b.age = age
    // a ProSense demo has its own case (a fibroadenoma's lump and programme are seeded from a NEW fork: nothing else draws from it)
    if (m === 'us' && isScripted(proto.id)) b.cryo = cryoCaseFor(proto.id, this.rng.fork('cryoCase').fork(b.id))
    return b
  }

  private insertDue(d: Due): void {
    let i = this.pendingDemos.length
    while (i > 0 && this.pendingDemos[i - 1].at > d.at) i--
    this.pendingDemos.splice(i, 0, d)
  }

  // --- R5 wave 3: "Watch step by step" for the ultrasound room's ProSense ------------------------------------------

  /**
   * Watch a ProSense case step by step (`protocolId`: 'us-cryo-breast' or 'us-cryo-fibroadenoma'): a whole case compressed to the script's watch
   * seconds. The same words as the theatre's `startWatch` (src/sim/surgery/watch.ts):
   *
   *   started    the room is free: the case begins now (the sonographer checks the console, the radiologist comes in, the patient appears in the hall)
   *   queued     a scan (or, with `fromStart`, a ProSense case) is in the room: the watch case starts as soon as it leaves, ahead of everybody waiting
   *   following  a ProSense case (the day's booking or a demo) is in the room: it is the one to watch, from its current step (nothing is booked)
   *   busy       a watch case is already booked or running
   *   noTeam     nobody is on duty in the ultrasound room (the sonographer works office hours, and the radiologist with her), or the protocol is not
   *              a ProSense procedure
   */
  startWatch(protocolId: string, opts: { fromStart?: boolean } = {}): WatchResult {
    const id = procedureIdOf(protocolId)
    if (id === undefined || compiledFor(id) === undefined || !(DEMO_PROCEDURES.us ?? []).includes(protocolId)) return 'noTeam'
    if (!this.hasOperator('us')) return 'noTeam'
    if (this.watchBooking !== null && this.watchBooking.state !== 'done') return 'busy'
    const sess = this.machines.us.session
    if (sess !== null && isScripted(sess.booking.protocolId) && opts.fromStart !== true) return 'following'
    const b = this.demoBooking('us', protocolById(protocolId), this.world.id('demo'))
    b.watch = true
    b.cryo = cryoCaseForWatch(protocolId)
    this.enqueue(b)
    this.watchBooking = b
    // 'started' only when the room really is free for it now (nobody in it, the last radiologist out of the way, no other demo ahead of it)
    return this.startsIn(b) < ROOM_FREE_NOW_SECONDS ? 'started' : 'queued'
  }

  /**
   * When the booked watch case begins (sim seconds): now when the room is free, else a projection of when it will be (`startsIn`); null when no watch
   * case is booked or it has begun. A readonly property like the theatre's (`SurgeryPort.watchStartsAt`, src/sim/surgery/ports.ts), so the watch panel
   * reads both the same way: it skips to it only while it is ahead.
   */
  get watchStartsAt(): number | null {
    const b = this.watchBooking
    if (b === null || b.state !== 'waiting') return null
    return this.world.t + this.startsIn(b)
  }

  /**
   * Seconds from now until the ultrasound room takes booking `b`: the visit in it to the end of its cleanup (`Scanner.freeIn`), after a ProSense
   * case the radiologist's walk out (the next ProSense case waits for her to be out of the room), and every booking ranked ahead of `b` (the
   * presenter's demos before it) with the mean of its visit (`expectedVisitSeconds`; no rng is drawn). Pure: it changes nothing.
   */
  private startsIn(b: Booking): number {
    const leave = CONFIG.imaging.cryo.doctorLeaveSeconds
    const sc = this.machines.us
    const sess = sc.session
    let t = sc.freeIn()
    // the second the radiologist is out of the way
    let docFree = sess !== null && isScripted(sess.booking.protocolId) ? t + leave : this.doctor !== null ? this.doctor.leavesIn() : 0
    for (const q of this.queues.us.waiting) {
      if (q === b) break
      const scripted = isScripted(q.protocolId)
      if (scripted && docFree > t) t = docFree
      t += this.visitSeconds(q)
      if (scripted) docFree = t + leave
    }
    return isScripted(b.protocolId) && docFree > t ? docFree : t
  }

  /** The planned seconds a waiting booking holds the room (the mean of its plan: nothing is drawn). */
  private visitSeconds(q: Booking): number {
    const proto = protocolById(q.protocolId)
    const scripted = isScripted(q.protocolId)
    const sequences = scripted && q.cryo !== undefined ? cryoSequences(proto, q.cryo) : proto.sequences
    return expectedVisitSeconds(proto.modality, sequences, { demo: q.kind === 'demo', scripted })
  }

  /**
   * The radiologist for a case: she fades in in the imaging hall in front of the ultrasound door (null while she is still leaving the last case).
   * She stays in the simulation between cases, invisible in her corner (`ProcedureDoctor`).
   */
  private bringDoctor(): ProcedureDoctor | null {
    const hall = this.sites.scanners.us.hallDoor
    const at = firstWalkable([{ x: hall.x - 1.2, z: hall.z }, { x: hall.x + 1.2, z: hall.z }, hall])
    this.hallEntry = { x: at.x, z: at.z }
    const d = this.doctor
    if (d !== null) {
      if (d.leaving) return null
      if (d.parked) d.engage(this.hallEntry, 0)
      return d
    }
    const member = IMAGING_STAFF[0]
    const nd = new ProcedureDoctor(this.world, member, at, 0, this.walkerFor(member.id), IMAGING.us.procedure!.park)
    nd.fadeIn()
    this.doctor = nd
    this.world.hooks.add(nd)
    return nd
  }

  /** The breast radiologist now (tests, the scene's roles list). */
  get radiologist(): ProcedureDoctor | null {
    return this.doctor !== null && !this.doctor.parked ? this.doctor : null
  }

  /** A fictional name with a first name from the female pool, not used by any booking today; claimed in the world's name book. */
  private uniqueWomanName(): string {
    let n = syntheticNameOf(this.rng, 'female')
    for (let i = 0; i < 12 && this.bookings.some((b) => b.patientName === n); i++) n = syntheticNameOf(this.rng, 'female')
    this.world.claimName(n)
    return n
  }

  /** A demo booking whose operator left before the patient appeared: take it out of the queue and the books. */
  private cancelDemo(d: Due): void {
    this.queues[d.booking.modality].remove(d.booking)
    const i = this.bookings.indexOf(d.booking)
    if (i >= 0) this.bookings.splice(i, 1)
  }

  private cancelWatch(b: Booking): void {
    this.queues[b.modality].remove(b)
    const i = this.bookings.indexOf(b)
    if (i >= 0) this.bookings.splice(i, 1)
    this.watchBooking = null
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
    // a watch case booked while the sonographer was on duty is not left in the queue after she goes home
    if (this.watchBooking !== null && this.watchBooking.state === 'waiting' && !this.hasOperator('us')) this.cancelWatch(this.watchBooking)
    this.serve(t, dt)
    while (this.reports.length > 0 && this.reports[0].at <= t) {
      const r = this.reports.shift()!
      this.world.say('reportReady', `${r.exam.patientName}'s ${r.exam.protocol} report is ready.`, { subjectId: r.exam.patientId })
      r.booking.subject?.reportReady()
      this.reportsReady.push(r)
    }
  }

  /** Every scanner takes the best waiting booking when it is free, then runs one step. Runs every tick: nothing in it allocates. */
  private serve(t: number, dt: number): void {
    for (const m of MODALITIES) {
      const sc = this.machines[m]
      sc.now = t
      if (sc.free) {
        const b = this.queues[m].next()
        // (a ProSense case waits for the last one's radiologist to be out of the room)
        if (b && !(this.doctor !== null && this.doctor.leaving && isScripted(b.protocolId))) this.assign(sc, b)
      }
      sc.step(dt)
      if (t >= this.window[0] && t <= this.window[1] && sc.state.phase !== 'idle') this.busyWindow[m] += dt
    }
  }

  private assign(sc: Scanner, b: Booking): void {
    this.queues[b.modality].remove(b)
    const proto = protocolById(b.protocolId)
    const watch = b.watch === true
    // a ProSense case (the booked cryoablation or a demo): its case, its sequences and its step engine run
    let proc: ProcStart | undefined
    let sequences: ReturnType<typeof cryoSequences> | undefined
    const id = b.modality === 'us' ? procedureIdOf(b.protocolId) : undefined
    const cs = id !== undefined ? compiledFor(id) : undefined
    if (cs !== undefined) {
      const info = b.cryo ?? cryoCaseFor(b.protocolId, this.rng.fork('cryoCase').fork(b.id))
      b.cryo = info
      sequences = watch ? cryoWatchSequences(proto, info, (u) => watchUnitSeconds(cs, u)) : cryoSequences(proto, info)
      proc = { protocolId: b.protocolId, info, watch, rng: watch ? null : this.rng.fork('script').fork(b.id) }
    }
    const exam = buildExam(this.world.id('exam'), proto, { patientId: b.patientId, patientName: b.patientName }, b.kind, imageSeedOf(b.patientId), sequences, b.cryo?.lumpMm)
    // (a watch case's plan is drawn from its own fork, so the day's stream for the scanner does not shift)
    const plan = drawPlan(watch ? this.rng.fork('watchPlan').fork(b.id) : this.rngs[b.modality], exam, { demo: b.kind === 'demo', transported: b.kind === 'er' })
    if (watch && cs !== undefined) {
      applyWatchPlan(plan, exam, cs)
      b.startedAt = this.t
      // the patient appears in the hall as the console check ends (a demo's patient otherwise comes the moment the button is pressed)
      if (b.subject === null) this.insertDue({ at: this.t + Math.max(CONFIG.imaging.demoArrivalSeconds, (plan.checkS ?? 0) - 6), booking: b, name: b.patientName, id: b.patientId, age: b.age })
    }
    this.exams.push(exam)
    sc.begin(b, exam, plan, proc)
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
      d.age,
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
