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
 * Nothing here is random except the durations, drawn once when the exam starts (exam.ts `drawPlan`).
 */
import { staffName } from '@/content/staff'
import { CONFIG } from '../config'
import type { TableRef } from '../er/actor'
import { callSpot } from '../er/spots'
import type { EventRefs } from '../er/world'
import { planRoute, routeLength } from '../nav/graph'
import { IMAGING } from '../places'
import type { SeatRegistry } from '../seats'
import type { ImagingExam, ImagingModality, ScannerPhase, ScannerState, SimEventType, Vec2 } from '../types'
import type { Booking } from './booking'
import { sequenceSeconds, scanningSeconds, type ExamPlan } from './exam'
import type { ImagingOperator } from './operator'
import { CubiclePool, dist, firstWalkable, type ScannerSites } from './sites'

type Step =
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
}

const ease = (k: number): number => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k))
const towards = (v: number, target: number, rate: number, dt: number): number =>
  v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt)

const MODALITY_NAME: Record<ImagingModality, string> = { mri: 'MRI', ct: 'CT', xray: 'X-ray', us: 'ultrasound' }

export class Scanner {
  readonly state: ScannerState
  private sess: Session | null = null
  private readonly ref: TableRef
  /** Seconds the operator needs to walk from the table to her station (plus a little), so she leaves in time. */
  private readonly lead: number
  private op: ImagingOperator | null = null
  /** Total seconds the scanner was not idle, for the utilisation numbers (see ImagingDepartment). */
  busySeconds = 0

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

  begin(booking: Booking, exam: ImagingExam, plan: ExamPlan): void {
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
    this.say(
      'scanStarted',
      booking.kind === 'er'
        ? `${staffName(op.entity.id)} is getting the ${MODALITY_NAME[this.modality]} ready for ${exam.patientName}: ${exam.protocol}.`
        : `${staffName(op.entity.id)} is getting ready for ${exam.patientName}: ${exam.protocol}.`,
      booking,
    )
    const subject = booking.subject
    if (subject) subject.scanAssigned(this.sites, st)
    if (booking.kind === 'er') this.go('awaitPorter')
    else if (!subject) this.go('wait')
    else this.go('meet')
  }

  private end(): void {
    const s = this.sess!
    const op = this.op!
    if (this.sites.tableInRegistry) this.ports.seats.release(this.sites.tableSeat.id)
    if (s.cubicle >= 0) this.ports.cubicles.release(s.booking.patientId)
    s.booking.state = 'done'
    this.sess = null
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
    const exam = s.exam
    switch (step) {
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
        const c = this.ports.cubicles.claim(s.booking.patientId)
        if (!c) {
          s.plan.changeS = 0
          this.go('toControl')
          return
        }
        s.cubicle = this.ports.cubicles.cubicles.indexOf(c)
        p!.moveTo(c.at, { face: c.heading })
        op.goTo(a.screen!.operator.at, { face: a.screen!.operator.heading })
        break
      }
      case 'changing':
        this.say('scanSequence', `${exam.patientName} is changing into a gown for the ${exam.protocol}.`, s.booking)
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
        this.say('scanSequence', `${this.who()} is running the MRI safety check with ${exam.patientName}: metal, implants, pacemaker.`, s.booking)
        break
      case 'toRoom': {
        op.goTo(a.handler.at, { face: a.handler.heading })
        p!.sitOn(a.tableSeat, { leader: op })
        break
      }
      case 'awaitPorter':
        if (this.modality !== 'us') op.goTo(a.handler.at, { face: a.handler.heading })
        break
      case 'explain':
        break
      case 'positioning':
        p!.rideTable(this.ref)
        this.say('scanSequence', `${this.who()} is positioning ${exam.patientName} for the ${exam.protocol}.`, s.booking)
        break
      case 'tableIn':
        this.say('scanSequence', `The ${MODALITY_NAME[this.modality]} table is moving ${exam.patientName} in.`, s.booking)
        break
      case 'gap':
        // X-ray: the radiographer steps out from behind the booth to turn the patient for the next view
        if (this.modality === 'xray') op.goTo(a.handler.at, { face: a.handler.heading })
        break
      case 'tableOut':
        this.say('scanSequence', `The ${MODALITY_NAME[this.modality]} table is bringing ${exam.patientName} out.`, s.booking)
        break
      case 'cleanup':
        this.say('scanSequence', `${this.who()} is helping ${exam.patientName} off the table and wiping down the ${MODALITY_NAME[this.modality]} room.`, s.booking)
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
    this.say(i === 0 ? 'scanStarted' : 'scanSequence', `${this.who()} started the ${s.exam.protocol} for ${s.exam.patientName}: ${seq.name}.`, s.booking)
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
    s.stepT += dt
    const op = this.op!
    const a = this.sites
    const plan = s.plan
    const subject = s.booking.subject
    const p = subject?.actor ?? null
    const m = this.modality

    switch (s.step) {
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
          this.go('toControl')
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
          this.say('scanSequence', `${s.exam.patientName} is cleared for the MRI.`, s.booking)
          this.go('toRoom')
        }
        break
      case 'toRoom': {
        const onTable = p!.seat === a.tableSeat && p!.done
        if (onTable && op.done) this.afterSeated()
        else if (this.waitedTooLong()) {
          this.force('toRoom')
          this.forceTo(op, a.handler.at, a.handler.heading)
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
        if (op.done) {
          op.entity.anim = 'talk'
          op.faceTowards({ x: a.tableSeat.x, z: a.tableSeat.z })
        }
        if (s.stepT >= plan.explainS) this.go('positioning')
        break
      case 'positioning': {
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
        this.workAtStation()
        const seq = s.exam.sequences[s.seq]
        const dur = sequenceSeconds(m, seq)
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
            this.force('gap')
            this.forceTo(op, a.station.at, a.station.heading)
            s.stationSent = false
            this.startSequence(s.seq + 1)
          }
        } else {
          this.workAtStation()
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
        if (op.done) op.entity.anim = 'clean'
        const off = p === null || p.seat === null
        if (s.stepT >= plan.cleanupS && off) this.end()
        break
      }
    }
    if (this.sess) this.publish(dt)
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

  private finishScanning(): void {
    const s = this.sess!
    this.say('scanDone', `${s.exam.protocol} for ${s.exam.patientName} finished: images sent.`, s.booking)
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
        st.activity = inSeq ? 1 : 0
        break
    }
    if (this.modality === 'xray') {
      const chest = s.exam.bodyPart === 'chest'
      const active = s.step === 'positioning' || s.step === 'scan' || s.step === 'gap'
      st.detail = towards(st.detail, chest && active ? 1 : 0, cfg.xrayTubePerSecond, dt)
    } else if (this.modality === 'us') {
      st.detail = inSeq ? ease(st.progress) : towards(st.detail, 0, cfg.usProbeResetPerSecond, dt)
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

  // --- tests ---------------------------------------------------------------------------------------------

  /** Where the patient on the table should be right now. */
  tableSpot(out: Vec2 = { x: 0, z: 0 }): Vec2 {
    const k = this.state.tablePos
    out.x = this.ref.out.x + (this.ref.in.x - this.ref.out.x) * k
    out.z = this.ref.out.z + (this.ref.in.z - this.ref.out.z) * k
    return out
  }
}
