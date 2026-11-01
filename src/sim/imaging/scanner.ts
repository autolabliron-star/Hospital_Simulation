/**
 * One scanner and the exam that runs on it: the `ScannerState` the scene animates and the sound reads, and the script that
 * walks the patient and the operator through the visit.
 *
 *   idle -> prep -> positioning -> tableIn -> scanning (per sequence, with pauses) -> tableOut -> cleanup -> idle
 *
 * The script ("session") is a list of steps; each step issues commands to the two people (Actor.moveTo / sitOn / standUp)
 * and waits for them to finish, or for a timer. The public `phase` is derived from the step:
 *
 *   prep         wait (demo) / meet / call / standUp / toCubicle / changing / toControl / screening / toRoom / awaitPorter / explain
 *   positioning  positioning (the operator leaves for the console a little early, so she is there when it ends)
 *   tableIn      tableIn   (MRI, CT)
 *   scanning     scan / gap
 *   tableOut     tableOut  (MRI, CT)
 *   cleanup      cleanup
 *
 * Walk-ins (outpatients, the demo patient) are called, walk in with the operator, and climb on the table themselves. ER
 * patients are brought on the table by a porter (see er/patient.ts); the session waits for them there, and asks for the
 * ride back when the last sequence is done.
 *
 * R5 wave 3: a ProSense cryoablation (a protocol with a script, src/content/procedures/us-*.json) is a scripted session. It starts with the
 * step `check` (the sonographer at the console, the radiologist coming in), and a `ProsenseRun` (./prosense.ts) is laid over it: the session keeps
 * the phases and the sequences, the run fills `ScannerState.procedure` and poses the two people from the script's role lines. The log lines come
 * from src/content/scanLines.json (every English line of this file lives there).
 *
 * Nothing here is random except the durations, drawn once when the exam starts (exam.ts `drawPlan`).
 */
import { MODALITY_NAME, scanLine, stepLine, type ScanLineKey } from '@/content/scanLines'
import { staffName } from '@/content/staff'
import { CONFIG } from '../config'
import type { TableRef } from '../er/actor'
import { callSpot } from '../er/spots'
import type { EventRefs } from '../er/world'
import { planRoute, routeLength } from '../nav/graph'
import { IMAGING } from '../places'
import { anchorSpot } from '../procedure'
import { emptyProcedureView } from '../procedure/empty'
import type { SeatRegistry } from '../seats'
import type { ImagingExam, ImagingModality, ScannerPhase, ScannerState, SimEventType, Vec2 } from '../types'
import type { Booking } from './booking'
import { iceSize, isProcedure, runSeconds, scanningSeconds, SEQUENCE_UNITS, stepOf, type ExamPlan } from './exam'
import type { ImagingOperator } from './operator'
import type { ProcedureDoctor } from './procedureDoctor'
import { isScripted, ProsenseRun, type ProcStart } from './prosense'
import { CubiclePool, dist, firstWalkable, type ScannerSites } from './sites'

type Step =
  | 'check'
  | 'wait'
  | 'meet'
  | 'call'
  | 'standUp'
  | 'toCubicle'
  | 'changing'
  | 'toControl'
  | 'screening'
  | 'toRoom'
  | 'awaitPorter'
  | 'explain'
  | 'positioning'
  | 'tableIn'
  | 'scan'
  | 'gap'
  | 'tableOut'
  | 'cleanup'

const PHASE: Record<Step, ScannerPhase> = {
  check: 'prep',
  wait: 'prep',
  meet: 'prep',
  call: 'prep',
  standUp: 'prep',
  toCubicle: 'prep',
  changing: 'prep',
  toControl: 'prep',
  screening: 'prep',
  toRoom: 'prep',
  awaitPorter: 'prep',
  explain: 'prep',
  positioning: 'positioning',
  tableIn: 'tableIn',
  scan: 'scanning',
  gap: 'scanning',
  tableOut: 'tableOut',
  cleanup: 'cleanup',
}

export interface ScannerPorts {
  say(type: SimEventType, text: string, refs?: EventRefs): void
  seats: SeatRegistry
  cubicles: CubiclePool
  /** A step was forced because somebody did not arrive (tests expect none). */
  stuck(modality: ImagingModality, step: string): void
  /** The last sequence is done: images sent, the report clock starts. */
  examDone(exam: ImagingExam, booking: Booking, plan: ExamPlan): void
  /** The visit is over (the scanner is free again). */
  released(booking: Booking): void
  /** R5 wave 3: the breast radiologist for a ProSense case (the department brings her to the room); null when she cannot come. */
  doctor(): ProcedureDoctor | null
  /** R5 wave 3: the case is over: she walks out. */
  doctorDone(d: ProcedureDoctor): void
}

interface Session {
  booking: Booking
  exam: ImagingExam
  plan: ExamPlan
  step: Step
  stepT: number
  seq: number
  seqT: number
  scanElapsed: number
  stationSent: boolean
  /** The cubicle the MRI patient changes in, or -1. */
  cubicle: number
  /** The exam is the ultrasound-guided cryoablation (steps place, freeze, thaw), not a scan. */
  cryo: boolean
  /** R5 wave 3: the step engine's run of a ProSense case with a script (null: every scan, and a cryoablation without one). */
  run: ProsenseRun | null
  /** The patient was told to get off the couch (a scripted case lets her go at the aftercare walk out). */
  released: boolean
}

/** `freeIn()` while the cleanup's time is over but the patient is still on the couch (the session ends only when she is off it): the moment that takes (s), more than the department's "free now" tolerance. */
export const OFF_THE_COUCH_SECONDS = 1

const ease = (k: number): number => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k))
const towards = (v: number, target: number, rate: number, dt: number): number =>
  v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt)

export class Scanner {
  readonly state: ScannerState
  private sess: Session | null = null
  private readonly ref: TableRef
  /** Seconds the operator needs to walk from the table to her station (plus a little), so she leaves in time. */
  private readonly lead: number
  private op: ImagingOperator | null = null
  private readonly warmSpot: Vec2 = { x: 0, z: 0 }
  /** Total seconds the scanner was not idle, for the utilisation numbers (see ImagingDepartment). */
  busySeconds = 0
  /** S1 in-flight warm: seconds the placed exam stays frozen (the hidden pre-roll), so it is `seqProgress` through at the reveal. */
  private holdS = 0
  /** Sim time now (the department sets it before each step): the step engine's windows are in sim seconds. */
  now = 0

  constructor(
    readonly modality: ImagingModality,
    readonly sites: ScannerSites,
    private readonly ports: ScannerPorts,
  ) {
    this.state = {
      modality,
      phase: 'idle',
      exam: null,
      sequence: -1,
      progress: 0,
      remaining: 0,
      phaseTime: 0,
      tablePos: 0,
      activity: modality === 'mri' ? CONFIG.imaging.mriIdleActivity : 0,
      detail: 0,
      operatorId: null,
      procedure: emptyProcedureView(),
    }
    const a = IMAGING[modality]
    this.ref = { out: a.table.out, in: a.table.in, heading: a.table.heading, state: this.state }
    const walk = routeLength(planRoute(sites.handler.at, sites.station.at))
    this.lead = walk / CONFIG.imaging.operatorWalkEstimate + (sites.station.seat ? 1.5 : 0.5)
  }

  setOperator(op: ImagingOperator | null): void {
    this.op = op
  }

  get operator(): ImagingOperator | null {
    return this.op
  }

  /** Free to take a booking: nobody on the table, an operator at work. */
  get free(): boolean {
    return this.sess === null && this.op !== null
  }

  get session(): { booking: Booking; step: string } | null {
    return this.sess ? { booking: this.sess.booking, step: this.sess.step } : null
  }

  // --- starting and ending --------------------------------------------------------------------------

  begin(booking: Booking, exam: ImagingExam, plan: ExamPlan, proc?: ProcStart): void {
    const op = this.op
    if (!op) return
    booking.state = 'active'
    const s: Session = {
      booking,
      exam,
      plan,
      step: 'wait',
      stepT: 0,
      seq: -1,
      seqT: 0,
      scanElapsed: 0,
      stationSent: false,
      cubicle: -1,
      cryo: isProcedure(exam),
      run: null,
      released: false,
    }
    this.sess = s
    const st = this.state
    st.exam = exam
    st.operatorId = op.entity.id
    st.sequence = -1
    st.progress = 0
    st.tablePos = 0
    st.phaseTime = 0
    st.phase = 'prep'
    op.working = true
    op.hurry(booking.kind === 'demo')
    if (this.sites.tableInRegistry) this.ports.seats.claimId(this.sites.tableSeat.id, booking.patientId)
    if (proc !== undefined && s.cryo && isScripted(proc.protocolId)) s.run = this.makeRun(booking, exam, plan, proc)
    this.say('scanStarted', this.text(booking.kind === 'er' ? 'gettingReadyEr' : 'gettingReady'), booking)
    const subject = booking.subject
    if (subject) subject.scanAssigned(this.sites, st)
    if (s.run !== null) this.go('check')
    else if (booking.kind === 'er') this.go('awaitPorter')
    else if (!subject) this.go('wait')
    else this.go('meet')
  }

  /**
   * S1 in-flight warm: the same bookkeeping as `begin()`, but the exam is already under way. The patient lies on the table
   * (MRI and CT: inside the bore, in a gown for the MRI), the operator works at her station, sequence `seq` is running
   * `seqT` seconds in. Logs nothing. For `holdS` seconds the session's clocks stand still (the machine and the people carry
   * on), so the hidden pre-roll ends with the sequence exactly where it was placed; `endWarmHold()` stops it early.
   * Returns false (and places nobody) if the scanner has no operator, is busy, or the booking's person is not an outpatient.
   */
  warmBegin(booking: Booking, exam: ImagingExam, plan: ExamPlan, seq: number, seqT: number, holdS = 0): boolean {
    const op = this.op
    const subject = booking.subject
    if (!op || this.sess || !subject) return false
    const a = this.sites
    const p = subject.actor
    booking.state = 'active'
    // the operator at her station (she is there already unless a shift change left her elsewhere)
    if (!op.isAtStation()) {
      const st = a.station
      if (st.seat) {
        if (op.seat !== st.seat) {
          this.ports.seats.claimId(st.seat.id, op.entity.id)
          op.placeOnSeat(st.seat)
        }
      } else op.placeAt(st.at.x, st.at.z, st.heading)
    }
    let scanElapsed = seqT
    for (let i = 0; i < seq; i++) scanElapsed += runSeconds(exam, plan, i) + (plan.gapS[i] ?? 0)
    const s: Session = {
      booking,
      exam,
      plan,
      step: 'scan',
      stepT: 0,
      seq,
      seqT,
      scanElapsed,
      stationSent: this.modality === 'xray' && seq === 0,
      cubicle: -1,
      cryo: isProcedure(exam),
      run: null,
      released: false,
    }
    this.sess = s
    const st = this.state
    st.exam = exam
    st.operatorId = op.entity.id
    st.sequence = seq
    st.progress = Math.min(1, seqT / runSeconds(exam, plan, seq))
    st.tablePos = this.modality === 'mri' || this.modality === 'ct' ? 1 : 0
    st.phaseTime = 0
    this.setPhase(PHASE.scan)
    op.working = true
    op.hurry(false)
    op.entity.anim = 'tablet'
    // the patient on the table
    if (this.sites.tableInRegistry) this.ports.seats.claimId(a.tableSeat.id, booking.patientId)
    if (this.modality === 'mri') p.entity.outfit = 'gown'
    p.placeOnSeat(a.tableSeat)
    p.rideTable(this.ref)
    this.tableSpot(this.warmSpot)
    p.placeAt(this.warmSpot.x, this.warmSpot.z, a.tableSeat.heading)
    this.holdS = holdS
    this.publish(60)
    return true
  }

  /** The placed exam resumes (the hidden pre-roll is over). */
  endWarmHold(): void {
    this.holdS = 0
  }

  private end(): void {
    const s = this.sess!
    const op = this.op!
    if (this.sites.tableInRegistry) this.ports.seats.release(this.sites.tableSeat.id)
    if (s.cubicle >= 0) this.ports.cubicles.release(s.booking.patientId)
    s.booking.state = 'done'
    this.sess = null
    if (s.run !== null) {
      // the radiologist walks out, nothing of the script stays on the view, the people or the patient
      const doctor = s.run.doctor
      s.run.finish()
      if (doctor !== null) this.ports.doctorDone(doctor)
    }
    const st = this.state
    st.phase = 'idle'
    st.phaseTime = 0
    st.exam = null
    st.sequence = -1
    st.progress = 0
    st.remaining = 0
    st.tablePos = 0
    st.operatorId = null
    op.working = false
    op.hurry(false)
    op.goToStation()
    this.ports.released(s.booking)
  }

  // --- the script ---------------------------------------------------------------------------------------

  private say(type: SimEventType, text: string, b: Booking): void {
    this.ports.say(type, text, { subjectId: b.patientId, actorId: this.op?.entity.id })
  }

  /** A log line of the session's exam (src/content/scanLines.json), filled with the people, the patient, the protocol and the scanner. */
  private text(key: ScanLineKey, extra: Readonly<Record<string, string>> = {}): string {
    const s = this.sess!
    return scanLine(key, { who: this.who(), patient: s.exam.patientName, protocol: s.exam.protocol, modality: MODALITY_NAME[this.modality], doctor: s.run !== null ? s.run.performer : this.who(), ...extra })
  }

  /** The step engine's run of this session's case, made at the start: its people, its view, its stage windows. */
  private makeRun(booking: Booking, exam: ImagingExam, plan: ExamPlan, proc: ProcStart): ProsenseRun {
    const op = this.op!
    const run = new ProsenseRun(proc.protocolId, proc, {
      op,
      doctor: this.ports.doctor(),
      view: this.state.procedure,
      tableSeat: this.sites.tableSeat,
      subject: () => booking.subject?.actor ?? null,
      say: (type, text) => this.ports.say(type, text, { subjectId: booking.patientId, actorId: op.entity.id }),
      stepLine: (id) => stepLine(id, { who: this.sess?.run?.performer ?? this.who(), patient: exam.patientName, lump: exam.protocol.includes('fibroadenoma') ? 'lump' : 'tumour' }),
      caseId: booking.id,
    })
    const runs: number[] = []
    const windows: number[] = []
    for (let i = 0; i < exam.sequences.length; i++) {
      const r = runSeconds(exam, plan, i)
      runs.push(r)
      windows.push(r + (plan.gapS[i] ?? 0))
    }
    run.setGrow(exam, windows, runs)
    return run
  }

  private setPhase(p: ScannerPhase): void {
    if (this.state.phase === p) return
    this.state.phase = p
    this.state.phaseTime = 0
  }

  private who(): string {
    return staffName(this.op!.entity.id)
  }

  private go(step: Step): void {
    const s = this.sess!
    const op = this.op!
    const a = this.sites
    const subject = s.booking.subject
    const p = subject?.actor ?? null
    s.step = step
    s.stepT = 0
    this.setPhase(PHASE[step])
    switch (step) {
      case 'check':
        // a ProSense case begins with the console check: the sonographer at the console, the radiologist on her way in (the run poses them)
        s.run!.enter('check', s.plan.checkS ?? CONFIG.imaging.cryo.checkSeconds, this.now)
        this.say('scanSequence', this.text('cryoChecking'), s.booking)
        break
      case 'wait': {
        const at = firstWalkable([{ x: a.hallDoor.x + 1.0, z: a.hallDoor.z }, { x: a.hallDoor.x - 1.0, z: a.hallDoor.z }, a.hallDoor])
        op.goTo(at)
        break
      }
      case 'meet': {
        const seat = p!.seat
        const spot = seat ? callSpot(seat, 0.9) : { x: p!.x + 0.9, z: p!.z }
        const at = firstWalkable([spot, { x: p!.x - 0.9, z: p!.z }, { x: p!.x, z: p!.z + 0.9 }, { x: p!.x, z: p!.z - 0.9 }])
        if (op.done && !op.seat && dist(op.pos, at) < 0.6) {
          // already beside the patient (the demo radiographer walked out ahead of them)
          this.go('call')
          return
        }
        op.goTo(at)
        break
      }
      case 'call':
        subject!.scanCalled()
        if (s.booking.kind === 'demo' && p) p.cruise = Math.max(p.cruise, 1.65)
        break
      case 'standUp':
        if (p!.seat) p!.standUp()
        break
      case 'toCubicle': {
        // (a ProSense patient has the cubicle reserved for her: an MRI patient never needs it, and she never takes an MRI patient's)
        const c = this.ports.cubicles.claim(s.booking.patientId, s.run !== null)
        if (!c) {
          // no cubicle for her: no change (an MRI patient goes on in her clothes; a ProSense patient puts the gown on where she stands, when the case before hers is still changing back)
          s.plan.changeS = 0
          if (s.run !== null) {
            p!.entity.outfit = 'gown'
            s.run.markChange(this.now, 0)
            this.go('toRoom')
          } else this.go('toControl')
          return
        }
        s.cubicle = this.ports.cubicles.cubicles.indexOf(c)
        p!.moveTo(c.at, { face: c.heading })
        if (s.run !== null) {
          // a ProSense case: she goes ahead to the couch and gets it ready while the patient changes
          const head = anchorSpot('usHead')
          op.goTo(head.at, { face: head.heading })
        } else op.goTo(a.screen!.operator.at, { face: a.screen!.operator.heading })
        break
      }
      case 'changing':
        // (a scripted case: the script's step `changeGown` is exactly this stretch, whatever the day's weights say: the caption follows her)
        s.run?.markChange(this.now, s.plan.changeS)
        this.say('scanSequence', this.text('changing'), s.booking)
        break
      case 'toControl': {
        const scr = a.screen!
        const demo = s.booking.kind === 'demo'
        p!.entity.outfit = 'gown'
        op.goTo(scr.operator.at, { face: scr.operator.heading })
        p!.moveTo(scr.patient, { face: Math.atan2(scr.operator.at.x - scr.patient.x, scr.operator.at.z - scr.patient.z), leader: demo ? op : null })
        break
      }
      case 'screening':
        this.say('scanSequence', this.text('screening'), s.booking)
        break
      case 'toRoom': {
        // a scripted case: she goes with the patient to the head of the couch (her place for the next steps), not to her stool
        if (s.run !== null) {
          const head = anchorSpot('usHead')
          op.goTo(head.at, { face: head.heading })
        } else op.goTo(a.handler.at, { face: a.handler.heading })
        p!.sitOn(a.tableSeat, { leader: op })
        break
      }
      case 'awaitPorter':
        if (this.modality !== 'us') op.goTo(a.handler.at, { face: a.handler.heading })
        break
      case 'explain':
        // (a scripted case's unit `survey`: the ultrasound survey and the skin marks; the local anaesthetic is a step of the first sequence)
        if (s.run !== null) s.run.enter('survey', s.plan.explainS, this.now)
        else if (s.cryo) this.say('scanSequence', this.text(s.booking.kind === 'demo' ? 'explainCryoDemo' : 'explainCryo'), s.booking)
        break
      case 'positioning':
        p!.rideTable(this.ref)
        if (s.run !== null) s.run.enter('drape', s.plan.positionS, this.now)
        this.say('scanSequence', this.text(s.cryo ? 'positioningCryo' : 'positioning', s.run !== null ? { who: s.run.performer } : {}), s.booking)
        break
      case 'tableIn':
        this.say('scanSequence', this.text('tableIn'), s.booking)
        break
      case 'gap':
        // X-ray: the radiographer steps out from behind the booth to turn the patient for the next view (and goes back in time)
        if (this.modality === 'xray') {
          s.stationSent = false
          op.goTo(a.handler.at, { face: a.handler.heading })
        }
        break
      case 'tableOut':
        this.say('scanSequence', this.text('tableOut'), s.booking)
        break
      case 'cleanup':
        if (s.run !== null) {
          // (the dressing, the aftercare talk and the walk out are steps of the script; she is let go from the couch at the walk out)
          s.run.enter('cleanup', s.plan.cleanupS, this.now)
          break
        }
        this.say('scanSequence', this.text(s.cryo ? 'cleanupCryo' : 'cleanup'), s.booking)
        if (subject) {
          if (s.booking.kind === 'er') subject.scanFinished()
          else subject.scanReleased()
        }
        if (this.modality === 'mri' || this.modality === 'ct' || this.modality === 'xray') op.goTo(a.handler.at, { face: a.handler.heading })
        break
      case 'scan':
        break
    }
  }

  private startSequence(i: number): void {
    const s = this.sess!
    const seq = s.exam.sequences[i]
    s.seq = i
    s.seqT = 0
    this.state.sequence = i
    this.state.progress = 0
    this.go('scan')
    // a scripted case: the sequence's unit lasts its run and the pause after it, so the script's steps tile both
    if (s.run !== null) s.run.enter(SEQUENCE_UNITS[i], runSeconds(s.exam, s.plan, i) + (s.plan.gapS[i] ?? 0), this.now)
    if (s.run !== null && stepOf(seq) === 'place') {
      // (R5 fix K7: a placement's unit opens with the numbing, or with the thaw before the probe is moved: the line of the probe going in or moving is the script's step line / event, said when that step begins)
      if (i === 0) this.say('scanStarted', this.text('sequence', { name: seq.name }), s.booking)
      return
    }
    this.say(i === 0 ? 'scanStarted' : 'scanSequence', s.cryo ? this.cryoLine(seq.name, stepOf(seq), i) : this.text('sequence', { name: seq.name }), s.booking)
  }

  /** The log line of a cryoablation step. */
  private cryoLine(name: string, step: string, i: number): string {
    const s = this.sess!
    const who = s.run !== null ? s.run.performer : this.who()
    switch (step) {
      case 'place':
        // (the second placement of a fibroadenoma is the probe moved to a second spot)
        return this.text(i > 0 ? 'cryoMove' : s.exam.protocol.includes('fibroadenoma') ? 'cryoPlaceLump' : 'cryoPlace', { who, name })
      case 'freeze':
        return this.text('cryoFreeze', { who, name })
      case 'thaw':
        return this.text('cryoThaw', { who })
      default:
        return this.text('sequence', { who, name })
    }
  }

  private force(what: string): void {
    this.ports.stuck(this.modality, what)
  }

  /** A person who did not arrive in time is put where they were going. */
  private forceTo(a: { placeAt(x: number, z: number, h: number): void }, at: Vec2, heading: number): void {
    a.placeAt(at.x, at.z, heading)
  }

  private waitedTooLong(): boolean {
    return this.sess!.stepT > CONFIG.imaging.stuckSeconds
  }

  /** Advance the scanner one step. Call once per sim step, before the people update. */
  step(dt: number): void {
    const st = this.state
    st.phaseTime += dt
    const s = this.sess
    if (!s) {
      this.idle(dt)
      return
    }
    this.busySeconds += dt
    if (this.holdS > 0) {
      // S1 in-flight warm: the clocks of the exam stand still, the machine and the people go on
      this.holdS -= dt
      this.workAtStation()
      this.publish(dt)
      return
    }
    s.stepT += dt
    const op = this.op!
    const a = this.sites
    const plan = s.plan
    const subject = s.booking.subject
    const p = subject?.actor ?? null
    const m = this.modality

    switch (s.step) {
      case 'check': {
        // the console check: the sonographer is at the console and the step's time has gone (the radiologist is walking in meanwhile)
        const ready = s.stepT >= (plan.checkS ?? 0) && op.done && op.mode === 'static'
        if (ready) this.afterCheck()
        else if (this.waitedTooLong()) {
          this.force('check')
          this.afterCheck()
        }
        break
      }
      case 'wait':
        if (subject) {
          subject.scanAssigned(a, st)
          this.go('meet')
        }
        break
      case 'meet':
        if (op.done) this.go('call')
        else if (this.waitedTooLong() && p) {
          this.force('meet')
          this.forceTo(op, { x: p.x + 0.9, z: p.z }, 0)
        }
        break
      case 'call': {
        if (op.done) {
          op.entity.anim = 'talk'
          if (p) op.faceTowards(p.pos)
        }
        if (s.stepT >= plan.callS) this.go('standUp')
        break
      }
      case 'standUp':
        if (p!.done) {
          if (m === 'mri' && s.booking.kind !== 'demo' && plan.changeS > 0) this.go('toCubicle')
          else if (m === 'mri') this.go('toControl')
          else if (s.run !== null && plan.changeS > 0) this.go('toCubicle') // a ProSense patient changes into a gown, the demo's too (the others lie in their clothes)
          else this.go('toRoom')
        } else if (this.waitedTooLong()) {
          this.force('standUp')
          p!.stand()
        }
        break
      case 'toCubicle':
        if (p!.done) this.go('changing')
        else if (this.waitedTooLong()) {
          this.force('toCubicle')
          const c = this.ports.cubicles.cubicles[s.cubicle]
          this.forceTo(p!, c.at, c.heading)
        }
        break
      case 'changing':
        if (s.stepT >= plan.changeS) {
          p!.entity.outfit = 'gown'
          this.ports.cubicles.release(s.booking.patientId)
          s.cubicle = -1
          this.go(s.run !== null ? 'toRoom' : 'toControl')
        }
        break
      case 'toControl': {
        const scr = a.screen!
        if (p!.done && op.done) {
          p!.walker.face(Math.atan2(scr.operator.at.x - p!.x, scr.operator.at.z - p!.z))
          this.go('screening')
        } else if (this.waitedTooLong()) {
          this.force('toControl')
          this.forceTo(p!, scr.patient, 0)
          this.forceTo(op, scr.operator.at, scr.operator.heading)
        }
        break
      }
      case 'screening':
        if (op.done) {
          op.entity.anim = 'talk'
          op.faceTowards(p!.pos)
        }
        if (p!.done) p!.entity.anim = 'talk'
        if (s.stepT >= plan.screenS) {
          p!.entity.anim = 'idle'
          this.say('scanSequence', this.text('screeningCleared'), s.booking)
          this.go('toRoom')
        }
        break
      case 'toRoom': {
        const onTable = p!.seat === a.tableSeat && p!.done
        // a scripted case holds here until the unit `arrive` has run its time, so its steps keep their lengths
        if (onTable && op.done && (s.run === null || s.run.windowOver(this.now))) this.afterSeated()
        else if (this.waitedTooLong()) {
          this.force('toRoom')
          const at = s.run !== null ? anchorSpot('usHead') : a.handler
          this.forceTo(op, at.at, at.heading)
          p!.placeOnSeat(a.tableSeat)
        }
        break
      }
      case 'awaitPorter':
        if (p && p.seat === a.tableSeat && p.done && p.mode === 'static') this.afterSeated()
        else if (op.done && m !== 'us') {
          op.entity.anim = 'tablet'
        }
        break
      case 'explain':
        if (op.done && s.run === null) {
          op.entity.anim = 'talk'
          op.faceTowards({ x: a.tableSeat.x, z: a.tableSeat.z })
        }
        if (s.stepT >= plan.explainS) this.go('positioning')
        break
      case 'positioning': {
        if (s.run !== null) {
          // the script leads both people; the sequences start when the unit `drape` has run its time
          if (s.stepT >= plan.positionS) this.startSequence(0)
          break
        }
        if (op.done && !s.stationSent) {
          op.entity.anim = s.stepT < plan.positionS * 0.75 ? 'give' : 'talk'
          op.faceTowards({ x: a.tableSeat.x, z: a.tableSeat.z })
        }
        if (!s.stationSent && s.stepT >= plan.positionS - this.lead) {
          s.stationSent = true
          op.goToStation()
        }
        if (s.stepT >= plan.positionS && s.stationSent && op.isAtStation()) {
          if (m === 'mri' || m === 'ct') this.go('tableIn')
          else this.startSequence(0)
        } else if (s.stepT > plan.positionS + CONFIG.imaging.stuckSeconds) {
          this.force('positioning')
          this.forceTo(op, a.station.at, a.station.heading)
          if (a.station.seat) op.placeOnSeat(a.station.seat)
        }
        break
      }
      case 'tableIn': {
        this.workAtStation()
        const k = plan.tableS > 0 ? s.stepT / plan.tableS : 1
        st.tablePos = ease(k)
        if (k >= 1) {
          st.tablePos = 1
          this.startSequence(0)
        }
        break
      }
      case 'scan': {
        if (s.run === null) this.workAtStation()
        const dur = runSeconds(s.exam, plan, s.seq)
        s.seqT += dt
        s.scanElapsed += dt
        st.progress = Math.min(1, s.seqT / dur)
        if (s.seqT >= dur) {
          st.progress = 1
          if (s.seq + 1 < s.exam.sequences.length) this.go('gap')
          else this.finishScanning()
        }
        break
      }
      case 'gap': {
        s.scanElapsed += dt
        const gap = plan.gapS[s.seq] ?? 0
        if (m === 'xray') {
          if (op.done && !s.stationSent) {
            op.entity.anim = 'give'
            op.faceTowards({ x: a.tableSeat.x, z: a.tableSeat.z })
          }
          if (!s.stationSent && s.stepT >= gap - this.lead) {
            s.stationSent = true
            op.goToStation()
          }
          if (s.stepT >= gap && s.stationSent && op.isAtStation()) {
            s.stationSent = false
            this.startSequence(s.seq + 1)
          } else if (s.stepT > gap + CONFIG.imaging.stuckSeconds) {
            // F-14: say where the radiographer was, so a repeat is diagnosed from the log (the line still starts "xray stuck in gap")
            this.force(`gap (radiographer ${op.mode}, done ${op.done}, ${dist(op.pos, a.station.at).toFixed(1)} m from the booth, sent ${s.stationSent}, patient ${p ? p.mode : 'none'})`)
            this.forceTo(op, a.station.at, a.station.heading)
            s.stationSent = false
            this.startSequence(s.seq + 1)
          }
        } else {
          if (s.run === null) this.workAtStation()
          if (s.stepT >= gap) this.startSequence(s.seq + 1)
        }
        break
      }
      case 'tableOut': {
        this.workAtStation()
        const k = plan.tableS > 0 ? s.stepT / plan.tableS : 1
        st.tablePos = 1 - ease(k)
        if (k >= 1) {
          st.tablePos = 0
          this.go('cleanup')
        }
        break
      }
      case 'cleanup': {
        if (s.run === null) {
          if (op.done) op.entity.anim = 'clean'
        } else if (!s.released && (s.run.walkingOut || s.stepT >= plan.cleanupS)) {
          // the aftercare talk is over: she gets off the couch and walks out (the walk out is the script's last step)
          s.released = true
          if (s.booking.subject) s.booking.subject.scanReleased()
        }
        const off = p === null || p.seat === null
        if (s.stepT >= plan.cleanupS && off && (s.run === null || s.released)) this.end()
        break
      }
    }
    if (this.sess) {
      this.sess.run?.update(this.now)
      this.publish(dt)
    }
  }

  /** The operator at her station keeps her eyes on the screen. */
  private workAtStation(): void {
    const op = this.op!
    if (op.done) op.entity.anim = 'tablet'
  }

  private afterSeated(): void {
    const s = this.sess!
    if (s.plan.explainS > 0) this.go('explain')
    else this.go('positioning')
  }

  /** A scripted case: the console is checked, the patient is fetched (the unit `arrive` starts). */
  private afterCheck(): void {
    const s = this.sess!
    s.run!.enter('arrive', s.plan.arriveS ?? CONFIG.imaging.cryo.arriveSeconds, this.now)
    this.go(s.booking.subject ? 'meet' : 'wait')
  }

  private finishScanning(): void {
    const s = this.sess!
    // (a scripted case is still thawing, drawing the probe out and dressing: the line that says the probe is out comes with its walk out step)
    this.say('scanDone', this.text(s.run !== null ? 'finishedFreezing' : s.cryo ? 'finishedCryo' : 'finished'), s.booking)
    this.ports.examDone(s.exam, s.booking, s.plan)
    s.booking.subject?.scanRequestReturn()
    if (this.modality === 'mri' || this.modality === 'ct') this.go('tableOut')
    else this.go('cleanup')
  }

  // --- what the scene reads ------------------------------------------------------------------------------

  private idle(dt: number): void {
    const st = this.state
    st.activity = this.modality === 'mri' ? towards(st.activity, CONFIG.imaging.mriIdleActivity, 3, dt) : this.modality === 'ct' ? towards(st.activity, 0, CONFIG.imaging.ctSpinDownPerSecond, dt) : 0
    st.detail = this.modality === 'xray' ? towards(st.detail, 0, CONFIG.imaging.xrayTubePerSecond, dt) : this.modality === 'us' ? towards(st.detail, 0, CONFIG.imaging.usProbeResetPerSecond, dt) : 0
  }

  private publish(dt: number): void {
    const s = this.sess!
    const st = this.state
    const cfg = CONFIG.imaging
    const inSeq = s.step === 'scan'
    switch (this.modality) {
      case 'mri':
        st.activity = towards(st.activity, inSeq ? 1 : cfg.mriIdleActivity, 5, dt)
        break
      case 'ct':
        st.activity = towards(st.activity, inSeq ? 1 : 0, inSeq ? cfg.ctSpinUpPerSecond : cfg.ctSpinDownPerSecond, dt)
        break
      case 'xray':
        st.activity = inSeq && s.seqT < cfg.xrayFlashSeconds ? 1 : 0
        break
      case 'us':
        if (s.cryo) {
          // the cryogen flow: full while freezing (it ramps), off while thawing; probe contact only while the probe is placed
          const step = inSeq ? stepOf(s.exam.sequences[s.seq]) : 'sweep'
          const cryo = cfg.cryo
          const target = step === 'freeze' ? 1 : step === 'place' ? cryo.placeActivity : 0
          st.activity = towards(st.activity, target, target > st.activity ? cryo.flowUpPerSecond : cryo.flowDownPerSecond, dt)
        } else st.activity = inSeq ? 1 : 0
        break
    }
    if (this.modality === 'xray') {
      const chest = s.exam.bodyPart === 'chest'
      const active = s.step === 'positioning' || s.step === 'scan' || s.step === 'gap'
      st.detail = towards(st.detail, chest && active ? 1 : 0, cfg.xrayTubePerSecond, dt)
    } else if (this.modality === 'us') {
      // a cryoablation: the ice ball's size, carried across the steps (and held through the pauses and the dressing)
      if (s.cryo) {
        const ice = iceSize(s.exam.sequences, s.seq, inSeq ? st.progress : 1, s.run?.grow)
        // (the thaw before the probe comes out melts the finished ice ball: the picture follows this number, R5 fix K14)
        st.detail = s.run !== null ? ice * (1 - s.run.iceMelt()) : ice
      }
      else st.detail = inSeq ? ease(st.progress) : towards(st.detail, 0, cfg.usProbeResetPerSecond, dt)
    }
    st.remaining = this.remaining()
  }

  /** Seconds left in the exam (an estimate that counts down smoothly). */
  private remaining(): number {
    const s = this.sess!
    const plan = s.plan
    const tbl = this.modality === 'mri' || this.modality === 'ct' ? plan.tableS : 0
    const scanTotal = scanningSeconds(s.exam, plan)
    switch (s.step) {
      case 'positioning':
        return Math.max(0, plan.positionS - s.stepT) + 2 * tbl + scanTotal
      case 'tableIn':
        return Math.max(0, tbl - s.stepT) + scanTotal + tbl
      case 'scan':
      case 'gap':
        return Math.max(0, scanTotal - s.scanElapsed) + tbl
      case 'tableOut':
        return Math.max(0, tbl - s.stepT)
      case 'cleanup':
        return 0
      default:
        return plan.explainS + plan.positionS + 2 * tbl + scanTotal
    }
  }

  /**
   * Seconds until this scanner can take its next booking, from now (0 when it is free): the rest of the step it is in and every step after it,
   * the cleanup included (`remaining()` stops at the end of the scan, and is 0 for the whole cleanup). A ProSense case still on its console check or
   * its walk in counts those windows too. An estimate from the visit's plan, for the department's projection of the watch case's start.
   */
  freeIn(): number {
    const s = this.sess
    if (s === null) return 0
    const plan = s.plan
    const tbl = this.modality === 'mri' || this.modality === 'ct' ? plan.tableS : 0
    const scanTotal = scanningSeconds(s.exam, plan)
    const cleanup = plan.cleanupS
    switch (s.step) {
      case 'cleanup':
        // (past its time the visit ends only when the patient is off the couch, and the session is still open: never 0 until it is over)
        return s.stepT < cleanup ? cleanup - s.stepT : OFF_THE_COUCH_SECONDS
      case 'tableOut':
        return Math.max(0, tbl - s.stepT) + cleanup
      case 'scan':
      case 'gap':
        return Math.max(0, scanTotal - s.scanElapsed) + tbl + cleanup
      case 'tableIn':
        return Math.max(0, tbl - s.stepT) + scanTotal + tbl + cleanup
      case 'positioning':
        return Math.max(0, plan.positionS - s.stepT) + 2 * tbl + scanTotal + cleanup
      case 'explain':
        return Math.max(0, plan.explainS - s.stepT) + plan.positionS + 2 * tbl + scanTotal + cleanup
      case 'check':
        return Math.max(0, (plan.checkS ?? 0) - s.stepT) + (plan.arriveS ?? 0) + plan.explainS + plan.positionS + 2 * tbl + scanTotal + cleanup
      default: {
        // the patient is still on the way to the couch: a scripted case holds until its unit `arrive` is over, a scan allows the call and the walk in
        const onTheWay = s.run !== null ? Math.max(0, s.run.until - this.now) : CONFIG.imaging.prepWalkSeconds
        return onTheWay + plan.explainS + plan.positionS + 2 * tbl + scanTotal + cleanup
      }
    }
  }

  // --- tests ---------------------------------------------------------------------------------------------

  /** Where the patient on the table should be right now. */
  tableSpot(out: Vec2 = { x: 0, z: 0 }): Vec2 {
    const k = this.state.tablePos
    out.x = this.ref.out.x + (this.ref.in.x - this.ref.out.x) * k
    out.z = this.ref.out.z + (this.ref.in.z - this.ref.out.z) * k
    return out
  }
}
