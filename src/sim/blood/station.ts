/**
 * One robot blood-draw station (MagicNurse / Aletta-like): the script of a draw, played from a plan (plan.ts) drawn once when the draw begins.
 *
 *   idle -> calling (waits for the patient on the chair and the labelled tray) -> cardScan -> armIn -> cuff -> sanitise -> veinScan
 *     -> needleIn -> filling (each tube in order of draw: fill, then its inversions) -> needleOut -> bandage -> release
 *     -> (walk-in) reset | (ER, riding a wheelchair) awaitPorter -> reset -> idle
 *
 *   no suitable vein, or every needle attempt missed -> fallbackToNurse: the cuff opens, the light goes amber, the nurse walks to the
 *     chair and draws the remaining tubes by hand, then the arm is released
 *   a missed first stick -> back to veinScan (up to config.blood.maxRobotAttempts needle attempts, then the nurse)
 *   the arm moves -> armMoved: the needle is out at once, the nurse is alerted and calms the patient, then the robot retries from the cuff
 *     (tubes already filled are kept); a second move -> fallbackToNurse
 *
 * The scene reads `state` in place every frame, so everything here mutates it and allocates nothing in the step except at a phase change.
 * Durations come only from the plan. The station never reads a patient's body: it speaks to the DrawSubject (pose, release).
 */
import { CONFIG } from '../config'
import type { EventRefs } from '../er/world'
import type { LabPort } from '../lab/ports'
import type { DrawPhase, DrawStationState, SeatSpec } from '../types'
import { tubeWord, type BloodEventKey } from '@/content/bloodCopy'
import { manualSecondsFor, planDraw, tubeSeconds, type DrawPlan, type NurseReason, type PlanRng } from './plan'
import type { DrawEntry } from './tickets'
import type { DrawSubject } from './subject'

/** What the station asks of the supervising nurse (nurse.ts implements it). */
export interface NursePort {
  readonly id: string | null
  readonly name: string
  /** She is on the site and able to work (always true in v1: she is there 24/7). */
  readonly onSite: boolean
  /** Bring this ticket's labelled tray from the prep machine to the station (queued after what she is doing). */
  bringTray(station: RobotStation, ticket: string): void
  /** Come to the station: a hand draw (`manual`) or to calm the patient after the arm moved (`reassure`). She calls `nurseArrived` on arrival. */
  assist(station: RobotStation, ticket: string, kind: 'manual' | 'reassure'): void
  /** The station has finished with her (the hand draw or the calming is over). */
  release(station: RobotStation): void
}

export interface StationHost {
  readonly nurse: NursePort
  readonly lab: Pick<LabPort, 'samples' | 'send'> | null
  now(): number
  /** Write an event line from the copy. */
  say(key: BloodEventKey, fields: Record<string, string | number>, refs?: EventRefs): void
  /** The draw is over (arm released): book the stats. `attempt` is the needle attempt the robot made it on (1-based). */
  drawFinished(station: RobotStation, entry: DrawEntry, by: 'robot' | 'nurse', attempt: number): void
  /** The chair is free again: let go of its registry claim. */
  releaseChair(station: RobotStation, occupantId: string): void
  /** A call that nobody answered was dropped. */
  aborted(station: RobotStation, entry: DrawEntry): void
}

function ease(k: number): number {
  const x = k < 0 ? 0 : k > 1 ? 1 : k
  return x * x * (3 - 2 * x)
}

/** The scan head's position along the forearm: two passes out and back, then it settles on the vein. */
export function scanSweep(p: number, veinPos: number): number {
  if (p < 0.75) {
    const k = (p / 0.75) * 2
    return ease(k <= 1 ? k : 2 - k)
  }
  return ease((p - 0.75) / 0.25) * veinPos
}

const LIGHT: Record<DrawPhase, DrawStationState['light']> = {
  idle: 'white',
  calling: 'white',
  cardScan: 'teal',
  armIn: 'teal',
  cuff: 'teal',
  sanitise: 'teal',
  veinScan: 'teal',
  needleIn: 'teal',
  filling: 'teal',
  needleOut: 'teal',
  bandage: 'teal',
  release: 'green',
  awaitPorter: 'green',
  armMoved: 'amber',
  fallbackToNurse: 'amber',
  reset: 'white',
}

/** The cuff opens this fast when the robot gives up (fraction per second). */
const CUFF_RELEASE_RATE = 1 / 1.5

export function newStationState(index: number): DrawStationState {
  return {
    index,
    phase: 'idle',
    phaseTime: 0,
    progress: 0,
    ticket: null,
    patientId: null,
    patientName: null,
    tubes: [],
    tube: 0,
    tubeFill: 0,
    inversions: 0,
    cuff: 0,
    needle: 0,
    scan: 0,
    trayHere: false,
    attendantId: null,
    light: 'white',
    attempts: 0,
    drawsToday: 0,
    robotDrawsToday: 0,
    nurseDrawsToday: 0,
    version: 0,
  }
}

export class RobotStation {
  readonly state: DrawStationState
  entry: DrawEntry | null = null
  subject: DrawSubject | null = null
  plan: DrawPlan | null = null
  /** Sample ids the nurse drew by hand: she walks them to the manual send station (and clears this). */
  readonly handTubes: string[] = []
  /** Why the nurse took over this draw (null: the robot did it all). */
  nurseReason: NurseReason | null = null
  /** Times the arm moved in this draw. */
  armMoves = 0
  /** Total seconds the station spent waiting for the nurse in this draw (tests read it). */
  nurseWait = 0

  private phaseLen = 1
  private attempt = 0
  private tubeIdx = 0
  private tubeT = 0
  private retrying = false
  private resumeIdx = 0
  private robotTubes: string[] = []
  private callWait = 0
  private nurseHere = false
  private nurseStarted = false
  private manualFrom = 0
  private by: 'robot' | 'nurse' = 'robot'
  private bumpQ = -1
  private cuffFloor = 0
  private scanFrom = 0

  constructor(
    readonly index: number,
    /** The stream the plans are drawn from (a test may swap it to force a branch). */
    public planRng: PlanRng,
    /** The chair the patient sits in (a registry seat, or one made from the anchors). */
    readonly seat: SeatSpec,
    private readonly host: StationHost,
  ) {
    this.state = newStationState(index)
  }

  /** Free and clean: a ticket may be called to it. */
  get free(): boolean {
    return this.state.phase === 'idle'
  }

  get phase(): DrawPhase {
    return this.state.phase
  }

  /** The draw is in the robot's hands or the nurse's (not just waiting for the patient). */
  get drawing(): boolean {
    const p = this.state.phase
    return p !== 'idle' && p !== 'calling' && p !== 'reset' && p !== 'awaitPorter'
  }

  // --- the draw centre's side ---------------------------------------------------------------------------------

  /** A ticket was called to this station: the patient is walking (or being wheeled) to the chair and the nurse is bringing the tray. */
  begin(entry: DrawEntry): void {
    this.setUp(entry)
    this.host.nurse.bringTray(this, entry.ticket.id)
  }

  /**
   * S1 in-flight warm: the patient is already in the chair and the tray is already at the robot (the nurse brought it before the
   * reveal), so the draw starts at the card scan and is carried forward to where it will be when the hidden pre-roll (`preRoll`
   * seconds) ends: `frac` (0..1) of the way through the needle-in and the filling. The plan is forced onto the straight path (a vein
   * is found, the first stick holds, the arm stays still) so the reveal shows the robot at work. Quiet when the world is.
   * Returns the seconds the draw was carried forward.
   */
  warmBegin(entry: DrawEntry, preRoll: number, frac: number): number {
    this.setUp(entry)
    const s = this.state
    s.trayHere = true
    this.beginDraw()
    const plan = this.plan!
    plan.noVein = false
    plan.attempts[0].missed = false
    plan.armMove = null
    const a = plan.attempts[0]
    let filling = 0
    for (const t of plan.tubes) filling += tubeSeconds(t)
    const needleStart = plan.cardScan + plan.armIn + plan.cuff + plan.sanitise + a.veinScan
    const ahead = Math.max(0, needleStart + frac * (a.needleIn + filling) - preRoll)
    const dt = CONFIG.sim.step
    for (let i = 0, n = Math.round(ahead / dt); i < n; i++) this.step(dt)
    return ahead
  }

  private setUp(entry: DrawEntry): void {
    const s = this.state
    this.entry = entry
    this.subject = entry.subject
    this.plan = null
    this.attempt = 0
    this.tubeIdx = 0
    this.tubeT = 0
    this.retrying = false
    this.resumeIdx = 0
    this.armMoves = 0
    this.nurseWait = 0
    this.nurseReason = null
    this.robotTubes.length = 0
    this.handTubes.length = 0
    this.callWait = 0
    this.nurseHere = false
    this.nurseStarted = false
    this.by = 'robot'
    this.cuffFloor = 0
    this.scanFrom = 0
    s.ticket = entry.ticket.id
    s.patientId = entry.subject.id
    s.patientName = entry.subject.name
    s.tubes.length = 0
    s.tube = 0
    s.tubeFill = 0
    s.inversions = 0
    s.cuff = 0
    s.needle = 0
    s.scan = 0
    s.trayHere = false
    s.attendantId = null
    s.attempts = 0
    this.go('calling', 1)
  }

  /** The nurse put the tray at the robot. */
  trayDelivered(): void {
    this.state.trayHere = true
    this.state.version++
  }

  /** The nurse is at the chair for the hand draw or the calming. */
  nurseArrived(nurseId: string): void {
    this.nurseHere = true
    this.state.attendantId = nurseId
    this.state.version++
  }

  /** The ticket was dropped (the holder never came): free the station. */
  abort(): void {
    const e = this.entry
    if (!e) return
    this.host.aborted(this, e)
    this.finishOff()
  }

  // --- per step -------------------------------------------------------------------------------------------------

  step(dt: number): void {
    const s = this.state
    if (s.phase === 'idle') return
    s.phaseTime += dt
    const p = this.phaseLen > 0 ? Math.min(1, s.phaseTime / this.phaseLen) : 1
    switch (s.phase) {
      case 'calling':
        this.stepCalling(dt)
        break
      case 'cardScan':
        s.progress = p
        if (p >= 1) this.start('armIn', this.plan!.armIn)
        break
      case 'armIn':
        s.progress = p
        if (p >= 1) this.start('cuff', this.retrying ? this.plan!.retry.cuff : this.plan!.cuff)
        break
      case 'cuff':
        s.progress = p
        s.cuff = ease(p)
        if (p >= 1) this.start('sanitise', this.retrying ? this.plan!.retry.sanitise : this.plan!.sanitise)
        break
      case 'sanitise':
        s.progress = p
        s.cuff = 1
        if (p >= 1) this.startVeinScan()
        break
      case 'veinScan':
        s.progress = p
        // a re-scan (missed stick, arm moved) starts from where the head was, not from a snap back to the start
        s.scan = this.scanFrom + (scanSweep(p, this.plan!.veinPos) - this.scanFrom) * ease(p / 0.1)
        if (p >= 1) this.endVeinScan()
        break
      case 'needleIn':
        this.stepNeedleIn(p)
        break
      case 'filling':
        this.stepFilling(dt)
        break
      case 'needleOut':
        s.progress = p
        s.needle = 1 - ease(p)
        s.cuff = 1 - ease(p)
        if (p >= 1) {
          s.needle = 0
          s.cuff = 0
          this.start('bandage', this.plan!.bandage)
          this.subject?.drawNearlyDone()
        }
        break
      case 'bandage':
        s.progress = p
        if (p >= 1) this.startRelease()
        break
      case 'release':
        s.progress = p
        if (p >= 1) this.endRelease()
        break
      case 'awaitPorter':
        if (this.subject === null || this.subject.offChair(this.seat) || this.subject.actor.gone) this.startReset()
        break
      case 'reset':
        s.progress = p
        if (p >= 1) this.finishOff()
        break
      case 'armMoved':
        this.stepNurse(dt, 'reassure')
        break
      case 'fallbackToNurse':
        this.stepNurse(dt, 'manual')
        break
    }
  }

  private stepCalling(dt: number): void {
    const s = this.state
    const sub = this.subject!
    this.callWait += dt
    if (s.trayHere && sub.seatedOn(this.seat)) {
      this.beginDraw()
      return
    }
    // a holder who never gets to the chair does not hold the robot for ever (an ER patient is always on the way: the porter is with them)
    if (this.entry!.kind !== 'er' && !sub.seatedOn(this.seat) && this.callWait > CONFIG.blood.stuckSeconds) this.abort()
  }

  private beginDraw(): void {
    const e = this.entry!
    const s = this.state
    this.plan = planDraw(this.planRng, e.tubes)
    e.ticket.state = 'drawing'
    s.tubes.length = 0
    for (const t of this.plan.tubes) s.tubes.push(t.kind)
    s.tube = 0
    s.tubeFill = 0
    s.inversions = 0
    this.start('cardScan', this.plan.cardScan)
  }

  private startVeinScan(): void {
    const plan = this.plan!
    // the head holds its last position through needle-in, filling and needle-out; a re-scan starts from it
    this.scanFrom = this.state.scan
    this.start('veinScan', this.retrying ? plan.retry.veinScan : plan.attempts[this.attempt].veinScan)
  }

  private endVeinScan(): void {
    const plan = this.plan!
    // the first scan of a draw can find no suitable vein (about 6 %): the nurse draws
    if (!this.retrying && this.attempt === 0 && plan.noVein) {
      this.toNurse('noVein')
      return
    }
    this.state.scan = plan.veinPos
    this.state.attempts++
    this.start('needleIn', this.retrying ? plan.retry.needleIn : plan.attempts[this.attempt].needleIn)
  }

  private stepNeedleIn(p: number): void {
    const s = this.state
    const plan = this.plan!
    s.progress = p
    const missed = !this.retrying && plan.attempts[this.attempt].missed
    if (!missed) {
      s.needle = ease(p)
      if (p >= 1) {
        s.needle = 1
        this.beginFilling()
      }
      return
    }
    // a missed stick: the needle goes in most of the way, finds nothing, and comes back out
    s.needle = p < 0.7 ? ease(p / 0.7) * 0.8 : 0.8 * (1 - ease((p - 0.7) / 0.3))
    if (p >= 1) {
      s.needle = 0
      this.attempt++
      if (this.attempt >= CONFIG.blood.maxRobotAttempts) this.toNurse('missed')
      else this.startVeinScan()
    }
  }

  private beginFilling(): void {
    const s = this.state
    this.tubeT = 0
    s.tube = this.tubeIdx
    s.tubeFill = 0
    s.inversions = 0
    this.start('filling', 1)
  }

  private stepFilling(dt: number): void {
    const s = this.state
    const plan = this.plan!
    const n = plan.tubes.length
    if (this.tubeIdx >= n) {
      this.start('needleOut', plan.needleOut)
      return
    }
    const tp = plan.tubes[this.tubeIdx]
    this.tubeT += dt
    s.tube = this.tubeIdx
    if (this.tubeT < tp.fill) {
      s.tubeFill = this.tubeT / tp.fill
      s.inversions = 0
    } else {
      s.tubeFill = 1
      const done = Math.floor((this.tubeT - tp.fill) / tp.inversionSeconds)
      s.inversions = done > tp.inversions ? tp.inversions : done
    }
    const total = tubeSeconds(tp)
    this.setProgress((this.tubeIdx + Math.min(1, this.tubeT / total)) / n)
    // the arm moves (once, or again on the retry): the needle is out at once
    const spec = this.armMoves === 0 ? plan.armMove : this.armMoves === 1 ? plan.retry.secondMove : null
    if (spec !== null && this.tubeT < tp.fill) {
      const tube = this.armMoves === 0 ? spec.tube : Math.max(spec.tube, this.resumeIdx)
      if (tube === this.tubeIdx && this.tubeT / tp.fill >= spec.at) {
        this.armMoves++
        if (this.armMoves === 1) this.toArmMoved()
        else this.toNurse('moved')
        return
      }
    }
    if (this.tubeT >= total) {
      this.drawTube(this.tubeIdx, this.robotTubes)
      this.tubeIdx++
      this.tubeT = 0
      s.inversions = 0
      s.tubeFill = 0
      if (this.tubeIdx < n) s.tube = this.tubeIdx
      else {
        // the last tube is full and mixed: the screen keeps it that way until the needle is out
        s.tube = n - 1
        s.tubeFill = 1
        s.inversions = tp.inversions
        s.version++
      }
      this.setProgress(this.tubeIdx / n)
      s.version++
      if (this.tubeIdx >= n) this.start('needleOut', plan.needleOut)
    }
  }

  private drawTube(index: number, into: string[]): void {
    const e = this.entry!
    const id = e.sampleIds[index]
    if (id === undefined) return
    into.push(id)
    this.host.lab?.samples.advance(id, 'drawn', this.host.now())
  }

  // --- the nurse's branches -----------------------------------------------------------------------------------------

  private toNurse(reason: NurseReason): void {
    const s = this.state
    this.nurseReason = reason
    s.needle = 0
    this.cuffFloor = 0
    this.nurseHere = false
    this.nurseStarted = false
    this.start('fallbackToNurse', 1)
    s.progress = 0
    const e = this.entry!
    const key = reason === 'noVein' ? 'drawByNurseNoVein' : reason === 'missed' ? 'drawByNurseMissed' : 'drawByNurseMoved'
    this.host.say(key, { robot: this.index + 1, name: e.subject.name, nurse: this.host.nurse.name }, { subjectId: e.subject.id, actorId: this.host.nurse.id ?? undefined })
    this.host.nurse.assist(this, e.ticket.id, 'manual')
  }

  private toArmMoved(): void {
    const s = this.state
    const e = this.entry!
    s.needle = 0
    s.tubeFill = 0
    s.inversions = 0
    this.resumeIdx = this.tubeIdx
    this.nurseHere = false
    this.nurseStarted = false
    this.start('armMoved', 1)
    s.progress = 0
    this.host.say('armMoved', { name: e.subject.name, robot: this.index + 1, nurse: this.host.nurse.name }, { subjectId: e.subject.id, actorId: this.host.nurse.id ?? undefined })
    this.host.nurse.assist(this, e.ticket.id, 'reassure')
  }

  /** Waiting for the nurse, then her part runs on this phase's clock. */
  private stepNurse(dt: number, kind: 'manual' | 'reassure'): void {
    const s = this.state
    const plan = this.plan!
    const n = plan.tubes.length
    if (s.cuff > this.cuffFloor) s.cuff = Math.max(this.cuffFloor, s.cuff - dt * CUFF_RELEASE_RATE)
    if (!this.nurseHere) {
      this.nurseWait += dt
      return
    }
    if (!this.nurseStarted) {
      this.nurseStarted = true
      s.phaseTime = 0
      const remaining = n - this.tubeIdx
      this.manualFrom = this.tubeIdx
      this.phaseLen = kind === 'manual' ? manualSecondsFor(plan, remaining) : plan.retry.reassure
      s.progress = 0
      s.version++
    }
    const p = Math.min(1, s.phaseTime / this.phaseLen)
    s.progress = p
    if (kind === 'manual') {
      // the remaining tubes fill one after another under her hand
      const remaining = Math.max(1, n - this.manualFrom)
      const x = p * remaining
      const k = Math.min(remaining - 1, Math.floor(x))
      const idx = this.manualFrom + k
      if (s.tube !== idx) {
        s.tube = idx
        s.version++
      }
      s.tubeFill = Math.min(1, x - k)
    }
    if (p < 1) return
    if (kind === 'manual') {
      for (let i = this.tubeIdx; i < n; i++) this.drawTube(i, this.handTubes)
      this.tubeIdx = n
      this.by = 'nurse'
      s.tube = n - 1
      s.tubeFill = 1
      s.cuff = 0
      const e = this.entry!
      this.host.say('bloodDrawnByNurse', { nurse: this.host.nurse.name, tubes: this.handTubes.length, tubeWord: tubeWord(this.handTubes.length), name: e.subject.name }, { subjectId: e.subject.id, actorId: this.host.nurse.id ?? undefined })
      s.attendantId = null
      this.host.nurse.release(this)
      this.startRelease()
    } else {
      // calmed: the robot tries again from the cuff (the tubes already filled stay filled)
      s.attendantId = null
      this.host.nurse.release(this)
      this.retrying = true
      this.start('cuff', plan.retry.cuff)
    }
  }

  // --- the end of the draw --------------------------------------------------------------------------------------------

  private startRelease(): void {
    const s = this.state
    const plan = this.plan!
    const e = this.entry!
    this.subject?.armIn(false)
    s.needle = 0
    s.cuff = 0
    this.start('release', plan.release)
    this.by = this.nurseReason === null ? 'robot' : 'nurse'
    if (this.by === 'robot') {
      const attempt = Math.max(1, s.attempts)
      this.host.say(attempt <= 1 && this.armMoves === 0 ? 'bloodDrawn' : 'bloodDrawnRetry', {
        robot: this.index + 1,
        tubes: plan.tubes.length,
        tubeWord: tubeWord(plan.tubes.length),
        name: e.subject.name,
        attempt,
      }, { subjectId: e.subject.id })
    }
    // the tubes the robot drew go into the pneumatic tube now (the nurse's go from the hand-send station)
    if (this.robotTubes.length > 0) {
      for (const id of this.robotTubes) this.host.lab?.send(id, this.index)
      this.host.say('samplesSent', { robot: this.index + 1, tubes: this.robotTubes.length, tubeWord: tubeWord(this.robotTubes.length), name: e.subject.name }, { subjectId: e.subject.id })
    }
  }

  private endRelease(): void {
    const s = this.state
    const e = this.entry!
    const sub = this.subject!
    e.drawnBy = this.by
    e.ticket.state = 'done'
    s.drawsToday++
    if (this.by === 'robot') s.robotDrawsToday++
    else s.nurseDrawsToday++
    this.host.drawFinished(this, e, this.by, Math.max(1, s.attempts))
    sub.drawReleased()
    // an ER patient rides back by wheelchair: the robot waits until they are off the chair
    if (e.kind === 'er' && !sub.offChair(this.seat)) this.start('awaitPorter', 1)
    else this.startReset()
  }

  private startReset(): void {
    const e = this.entry
    if (e) this.host.releaseChair(this, e.subject.id)
    this.start('reset', this.plan ? this.plan.reset : 10)
  }

  private finishOff(): void {
    const s = this.state
    s.phase = 'idle'
    s.phaseTime = 0
    s.progress = 0
    s.light = 'white'
    s.ticket = null
    s.patientId = null
    s.patientName = null
    s.tubes.length = 0
    s.tube = 0
    s.tubeFill = 0
    s.inversions = 0
    s.cuff = 0
    s.needle = 0
    s.scan = 0
    s.trayHere = false
    s.attendantId = null
    s.attempts = 0
    s.version++
    this.entry = null
    this.subject = null
    this.plan = null
  }

  // --- helpers ---------------------------------------------------------------------------------------------------------

  /** Enter a phase: its clock restarts, its light is set, the screen repaints. */
  private go(phase: DrawPhase, len: number): void {
    const s = this.state
    s.phase = phase
    s.phaseTime = 0
    s.progress = 0
    s.light = LIGHT[phase]
    this.phaseLen = len
    this.bumpQ = -1
    s.version++
    if (phase === 'armIn') this.subject?.armIn(true)
  }

  private start(phase: DrawPhase, len: number): void {
    this.go(phase, len)
  }

  /** Bump the screen version at every tenth of the draw. */
  private setProgress(p: number): void {
    this.state.progress = p
    const q = Math.floor(p * 10)
    if (q !== this.bumpQ) {
      this.bumpQ = q
      this.state.version++
    }
  }
}
