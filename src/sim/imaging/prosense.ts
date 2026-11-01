/**
 * R5 wave 3: the ProSense cryoablation's adapter to the step-by-step engine (src/sim/procedure). The exam's session (scanner.ts) stays the clock
 * of the case: it walks the patient and the sonographer in, then runs the exam's phases and sequences. This run is laid over it:
 *
 *   units      the session tells the run which unit it is in and for how long (`enter`): the windows are the exam's own, so the script's steps tile
 *              them exactly (the units are in src/content/procedures.ts: check, arrive, survey, drape, place, freeze1, thaw, freeze2, relocate,
 *              freeze3, cleanup). In the living day a step's share of its window is the middle of its real-minute band (jittered on a NEW rng
 *              fork); in a watch case the windows ARE the script's watch seconds. One exception (R5 fix K19, day and watch alike): the unit `arrive`
 *              follows the patient: `patientArrives` lasts until she starts changing, `changeGown` is exactly her time in the cubicle (the session's
 *              `markChange`: the script's own 30 s in a watch case) and `lieDown` runs from there to the end of the unit's window, so the caption never
 *              says she is changing while she is still walking to the cubicle or back (the unit as a whole keeps its length).
 *   the view   `ScannerState.procedure` is filled in place, every tick (`fillView`): the step, its progress, the lines of both people, the patient's
 *              pose, the picture's stage (`scope`) and the point the camera frames.
 *   people     the breast radiologist (./procedureDoctor.ts) and the sonographer follow their role lines: where to stand (the anchors, places.ts
 *              `IMAGING.us.procedure`), what to do and what is in each hand, the point the hands work at and the eyes look at (`Entity.act`,
 *              `Entity.lookAt`, `Entity.attire`: the same fields the theatre writes). The session leads the sonographer through the unit `arrive`
 *              (she fetches the patient from the hall); the script leads her in every other unit.
 *   the patient on the couch carries the view's own pose object as `Entity.patientPose` (the scene poses her from it: the treated side's arm up and
 *              the slight roll), set when she lies on the couch and cleared when she gets off or the case ends.
 *
 * Nothing here is random except the jitter in `caseSteps` (a NEW fork passed in), and nothing allocates per tick.
 */
import { PROCEDURE_META } from '@/content/procedures'
import { IMAGING_STAFF } from '@/content/staff'
import type { Actor } from '../er/actor'
import { CONFIG } from '../config'
import { anchorSpot, animOf, caseSteps, clearView, compiledFor, fillView, newCursor, newTargetCtx, resolveTarget, stepAt, watchUnitSeconds } from '../procedure'
import type { CaseSteps, CompiledScript, StepCursor, TargetCtx, ViewCtx } from '../procedure'
import type { Rng } from '../rng'
import { ATTIRE, type ImagingExam, type ProcRole, type ProcedureId, type ProcedureView, type ProcTarget, type SeatSpec, type SimEventType, type Vec3 } from '../types'
import { SEQUENCE_UNITS, type CryoCase, type ExamPlan } from './exam'
import type { ImagingOperator } from './operator'
import type { ActOverlay } from './overlay'
import type { ProcedureDoctor } from './procedureDoctor'

/** The answer of `procedureIdOf` per protocol, kept after the first look-up (the department asks every tick while a booking waits: no allocation then). */
const SCRIPT_OF = new Map<string, ProcedureId | null>()

/** The script of a protocol of the ultrasound room's ProSense (undefined: the protocol has none: every scan). */
export function procedureIdOf(protocolId: string): ProcedureId | undefined {
  const known = SCRIPT_OF.get(protocolId)
  if (known !== undefined) return known === null ? undefined : known
  let found: ProcedureId | null = null
  for (const [id, m] of Object.entries(PROCEDURE_META)) if (m.machine === 'prosense' && m.key === protocolId) found = id as ProcedureId
  SCRIPT_OF.set(protocolId, found)
  return found === null ? undefined : found
}

/** Does a script exist for this protocol (a ProSense case the step engine plays)? */
export function isScripted(protocolId: string): boolean {
  const id = procedureIdOf(protocolId)
  return id !== undefined && compiledFor(id) !== undefined
}

/** The radiologist's name as the log and the captions use it. */
export const RADIOLOGIST_NAME: string = IMAGING_STAFF[0].name
export const RADIOLOGIST_ID: string = IMAGING_STAFF[0].id

/** How a ProSense session begins (what the department decided about this case). */
export interface ProcStart {
  protocolId: string
  info: CryoCase
  /** A "Watch step by step" case: its windows are the script's watch seconds. */
  watch: boolean
  /** The jitter stream of the living day (a NEW fork per case); null for a watch case. */
  rng: Rng | null
}

/**
 * Make a watch case's plan the script's: the check, the walk in, the survey, the drape, each sequence (no pause between them) and the cleanup last
 * exactly their watch seconds. `plan` is changed in place; the report time stays what was drawn.
 */
export function applyWatchPlan(plan: ExamPlan, exam: ImagingExam, cs: CompiledScript): void {
  plan.checkS = watchUnitSeconds(cs, 'check')
  plan.arriveS = watchUnitSeconds(cs, 'arrive')
  // the gown change in the cubicle lasts its script step (R5 fix K19)
  const gown = cs.script.steps.find((st) => st.id === 'changeGown')
  if (gown !== undefined) plan.changeS = gown.watchSeconds
  plan.explainS = watchUnitSeconds(cs, 'survey')
  plan.positionS = watchUnitSeconds(cs, 'drape')
  plan.cleanupS = watchUnitSeconds(cs, 'cleanup')
  plan.seqS = exam.sequences.map((_, i) => watchUnitSeconds(cs, SEQUENCE_UNITS[i]))
  plan.gapS = plan.gapS.map(() => 0)
  plan.callS = CONFIG.imaging.demoCallSeconds
}

/** The attire bits of each step and role (`table[step * 2 + role]`): masked and gloved from the first sterile step to the cold pack. */
export function attireTable(cs: CompiledScript): Uint8Array {
  const n = cs.n
  const out = new Uint8Array(n * 2)
  let from = n
  let to = -1
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < 2; r++) {
      const a = cs.roleAt[i][r]?.action
      if (a === 'gownGlove' || a === 'skinPrep' || a === 'drapePatient') from = Math.min(from, i)
      if (a === 'applyDressing') to = Math.max(to, i)
    }
  }
  for (let i = from; i <= to; i++) for (let r = 0; r < 2; r++) out[i * 2 + r] = ATTIRE.mask | ATTIRE.gloves
  return out
}

const BR = 0
const SON = 1
/** The hands work this close to the surface, on the worker's side of the breast (m). */
const NEAR_SIDE = 0.07

/** What the run needs from the room. */
export interface RunHost {
  op: ImagingOperator
  doctor: ProcedureDoctor | null
  view: ProcedureView
  tableSeat: SeatSpec
  /** The person on the couch (null until they are there). */
  subject(): Actor | null
  say(type: SimEventType, text: string): void
  /** The line this script step says when it begins (the room log: src/content/scanLines.json `stepLines`), or null when it has none. */
  stepLine(stepId: string): string | null
  caseId: string
}

export class ProsenseRun {
  readonly cs: CompiledScript
  readonly steps: CaseSteps
  readonly info: CryoCase
  readonly watch: boolean
  /** Per exam sequence: the share of its window over which the ice grows (a freeze, then the doctor measures it; `iceSize`'s `grow`). */
  readonly grow: Float64Array
  /** The current unit and its window (sim seconds). */
  unit = ''
  since = 0
  until = 0
  private readonly cur: StepCursor = newCursor()
  private readonly vc: ViewCtx
  private readonly targets: TargetCtx = newTargetCtx()
  private readonly attire: Uint8Array
  private readonly work: Vec3[] = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]
  private readonly look: Vec3[] = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]
  private readonly hasWork: boolean[] = [false, false]
  private readonly hasLook: boolean[] = [false, false]
  private readonly faced: number[] = [-1, -1]
  private saidFlat = -1
  private posed: Actor | null = null
  private started = false
  /** The script step from which the ice ball melts away before the probe is drawn out (the cleanup's `thawFree`, else the probe-out step): -1 for a script with neither. */
  private readonly meltFrom: number
  /** R5 fix K19: the flat step `changeGown` of the unit `arrive` (-1: a script without a step before and after it), and the sim seconds the patient really changes from and to (-1: not yet). */
  private readonly gownFlat: number
  private changeFrom = -1
  private changeTo = -1

  constructor(
    readonly protocolId: string,
    start: ProcStart,
    private readonly host: RunHost,
  ) {
    const id = procedureIdOf(protocolId)
    const cs = id === undefined ? undefined : compiledFor(id)
    if (cs === undefined) throw new Error(`no script for the protocol "${protocolId}"`)
    this.cs = cs
    this.info = start.info
    this.watch = start.watch
    this.steps = caseSteps(cs, start.watch ? 'watch' : 'live', start.watch ? null : start.rng)
    this.attire = attireTable(cs)
    this.grow = new Float64Array(SEQUENCE_UNITS.length).fill(1)
    this.vc = { caseId: host.caseId, watch: start.watch, entityIds: {}, targets: this.targets }
    this.targets.us.side = 'left'
    const steps = cs.script.steps
    let melt = steps.findIndex((st) => st.unit === 'cleanup' && st.scope === 'thawFree')
    if (melt < 0) melt = steps.findIndex((st) => st.unit === 'cleanup' && st.scope === 'probeOut')
    this.meltFrom = melt
    // `changeGown` follows the patient when the unit has a step before it and one after it
    const gown = steps.findIndex((st) => st.id === 'changeGown' && st.unit === 'arrive')
    const au = cs.unitIndex.get('arrive')
    const gf = gown >= 0 ? this.steps.flatOfStep[gown] : -1
    const af = au !== undefined ? this.steps.uFirst[au] : -1
    this.gownFlat = gf > af && au !== undefined && gf < af + this.steps.uLen[au] - 1 ? gf : -1
  }

  /** The name the log gives the person who performs: the radiologist, or (she could not come) the sonographer. */
  get performer(): string {
    return this.host.doctor !== null ? this.host.doctor.entity.name : this.host.op.entity.name
  }

  get doctor(): ProcedureDoctor | null {
    return this.host.doctor
  }

  /** The step the run is at now (script step index; -1 before the first update). */
  get stepIndex(): number {
    return this.started ? this.cur.index : -1
  }

  get stepId(): string {
    return this.host.view.stepId
  }

  /**
   * How much of each freeze's window the ice grows over, from the case's step weights: the freeze step first, the measurement after it (the ice
   * has stopped growing by then). `windows[i]` is the window seconds of sequence i's unit, `run[i]` the seconds the sequence runs inside it.
   */
  setGrow(exam: ImagingExam, windows: readonly number[], run: readonly number[]): void {
    for (let i = 0; i < exam.sequences.length && i < SEQUENCE_UNITS.length; i++) {
      const u = this.cs.unitIndex.get(SEQUENCE_UNITS[i])
      this.grow[i] = 1
      if (u === undefined) continue
      const f0 = this.steps.uFirst[u]
      if (f0 < 0 || this.steps.uLen[u] < 2) continue
      // a freeze: the ice grows over its first step, then holds for the measurement. A moved probe: the old ice melts over the thaw that is the first step of its unit.
      const step = exam.sequences[i].step
      const melts = step === 'place' && i > 0 && this.cs.script.steps[this.steps.stepOf[f0]].scope === 'thawFree'
      if (step !== 'freeze' && !melts) continue
      const share = this.steps.cumU1[f0] / this.steps.totalU[u]
      this.grow[i] = run[i] > 0 ? Math.min(1, (share * windows[i]) / run[i]) : 1
    }
  }

  /**
   * How much of the finished ice ball the thaw before the probe is drawn out has melted, 0..1: none before the cleanup's thaw, its own progress
   * through it, all of it from the probe-out on. The session multiplies the held ice ball by `1 - iceMelt()` (the picture follows the sim: R5 fix K14).
   */
  iceMelt(): number {
    if (!this.started || this.meltFrom < 0) return 0
    const i = this.cur.index
    if (i < this.meltFrom) return 0
    if (i > this.meltFrom) return 1
    const k = this.cur.progress
    return k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k)
  }

  /** The session enters a unit that lasts `seconds`, from `now`. */
  enter(unit: string, seconds: number, now: number): void {
    this.unit = unit
    this.since = now
    this.until = now + Math.max(0.001, seconds)
  }

  /**
   * The patient starts changing into the gown now, for `seconds` (the session's `changing`). The step `changeGown` is exactly that stretch, in the day and in a
   * watch case: `patientArrives` ends as she starts and `lieDown` begins as she is done, wherever the plan had put the boundaries (the walk to the cubicle takes
   * what it takes). `seconds` 0 (no cubicle free: she puts the gown on where she stands) skips the step.
   */
  markChange(from: number, seconds: number): void {
    if (this.gownFlat < 0) return
    this.changeFrom = from
    this.changeTo = from + Math.max(0, seconds)
  }

  /** The current unit's window is over (the session holds a step until it is, so the steps keep their lengths). */
  windowOver(now: number): boolean {
    return now >= this.until
  }

  /** The step is the aftercare walk out (the session lets the patient go from the couch now). */
  get walkingOut(): boolean {
    return this.started && this.host.view.stepId === 'walkOut'
  }

  /** Fill the view for `now`, pose the people. Returns true when the step changed. */
  update(now: number): boolean {
    const h = this.host
    const found = this.gownFlat >= 0 && this.unit === 'arrive' ? this.arriveCursor(now) : stepAt(this.steps, this.unit, this.since, this.until, now, null, this.cur)
    if (!found) return false
    this.started = true
    const ids = this.vc.entityIds
    ids.breastRadiologist = h.doctor !== null ? h.doctor.entity.id : null
    ids.sonographer = h.op.entity.id
    const changed = fillView(h.view, this.steps, this.cur, this.vc)
    if (changed) this.onStep()
    this.pose(changed)
    this.poseTheDoctorAndSonographer(changed)
    return changed
  }

  /** Write step `f` of the unit `arrive`, laid in [from, to), into the cursor (what `stepAt` writes). */
  private place(f: number, from: number, to: number, now: number): void {
    const cs = this.steps
    const out = this.cur
    out.index = cs.stepOf[f]
    out.flat = f
    out.k = cs.kOf[f]
    out.unit = cs.cs.unitOf[out.index]
    out.since = from
    out.until = to
    const span = to - from
    const p = span > 0 ? (now - from) / span : now >= to ? 1 : 0
    out.progress = p < 0 ? 0 : p > 1 ? 1 : p
  }

  /**
   * The step of the unit `arrive` (R5 fix K19): until the patient starts changing, the steps before the gown by their weights over the planned
   * window, the last of them holding (finished) until she does; then `changeGown` for exactly her time in the cubicle; then the steps after it by their weights
   * over what is left of the planned window (it ends where it always did). Same fields as `stepAt`; returns false when the unit has no steps.
   */
  private arriveCursor(now: number): boolean {
    const cs = this.steps
    const g = this.gownFlat
    const u = cs.cs.unitIndex.get('arrive')
    if (u === undefined) return false
    if (this.changeFrom < 0) {
      if (!stepAt(cs, 'arrive', this.since, this.until, now, null, this.cur)) return false
      if (this.cur.flat >= g) {
        // (the plan has reached the gown before she has: the step before it stays, finished, and runs on until she starts: its window ends where the next begins)
        const f = g - 1
        const total = cs.totalU[u]
        const to = this.since + ((this.until - this.since) * cs.cumU1[f]) / total
        this.place(f, this.since + ((this.until - this.since) * cs.cumU0[f]) / total, to > now ? to : now, now)
      }
      return true
    }
    if (now < this.changeTo) {
      this.place(g, this.changeFrom, this.changeTo, now)
      return true
    }
    const last = cs.uFirst[u] + cs.uLen[u] - 1
    const end = Math.max(this.until, this.changeTo + 0.001)
    const base = cs.cumU1[g]
    const total = cs.totalU[u] - base
    for (let f = g + 1; f <= last; f++) {
      const to = f === last ? end : this.changeTo + ((end - this.changeTo) * (cs.cumU1[f] - base)) / total
      if (now < to || f === last) {
        this.place(f, this.changeTo + ((end - this.changeTo) * (cs.cumU0[f] - base)) / total, to, now)
        return true
      }
    }
    return false
  }

  private onStep(): void {
    const flat = this.cur.flat
    if (flat <= this.saidFlat) return
    this.saidFlat = flat
    const step = this.cs.script.steps[this.cur.index]
    if (step.event !== undefined) {
      this.host.say(step.checklist === 'timeOut' ? 'whoTimeOut' : step.checklist === 'signOut' ? 'whoSignOut' : step.checklist === 'signIn' ? 'whoSignIn' : 'procedureStep', step.event)
    }
    // (the room log's line of a step is said when the step begins: the probe is guided in when it goes in, the case is finished when she walks out)
    const line = this.host.stepLine(step.id)
    if (line !== null) this.host.say('scanSequence', line)
  }

  /** The patient on the couch carries the view's pose. */
  private pose(_changed: boolean): void {
    const h = this.host
    const p = h.subject()
    const on = p !== null && p.seat === h.tableSeat
    if (on) {
      if (p.entity.patientPose !== h.view.patient) p.entity.patientPose = h.view.patient
      this.posed = p
    } else if (this.posed !== null) {
      this.unpose()
    }
  }

  private unpose(): void {
    const p = this.posed
    if (p !== null && p.entity.patientPose === this.host.view.patient) p.entity.patientPose = null
    this.posed = null
  }

  private point(target: ProcTarget, fromX: number, out: Vec3): void {
    resolveTarget(target, this.targets, out)
    // on the breast the hands work on the worker's side of it
    if (target === 'breast') {
      const dx = fromX - out.x
      out.x += dx > NEAR_SIDE ? NEAR_SIDE : dx < -NEAR_SIDE ? -NEAR_SIDE : dx
    }
  }

  private poseTheDoctorAndSonographer(changed: boolean): void {
    const h = this.host
    const lines = this.cs.roleAt[this.cur.index]
    const attire = this.attire
    const base = this.cur.index * 2
    const doc = h.doctor
    if (doc !== null && !doc.leaving) {
      const line = lines[BR]
      if (line !== null) {
        const spot = anchorSpot(line.anchor)
        doc.goToSpot(line.anchor, spot)
        this.poseOne(BR, doc, doc.overlay, line, spot, changed, doc.settled)
      }
      doc.entity.attire = attire[base + BR]
    }
    const op = h.op
    const sline = lines[SON]
    if (sline !== null) {
      const spot = anchorSpot(sline.anchor)
      // the session leads her through the walk in: the script takes over once the unit moves on
      if (this.unit !== 'arrive') op.driveTo(sline.anchor, spot)
      this.poseOne(SON, op, op.overlay, sline, spot, changed, op.done && op.mode === 'static' && op.seat === null)
    }
    op.entity.attire = attire[base + SON]
  }

  /** One person: if she is standing at the line's spot, turn to the work, show the action; otherwise nothing of the script on her. */
  private poseOne(
    r: number,
    who: Actor,
    overlay: ActOverlay,
    line: NonNullable<CompiledScript['roleAt'][number][number]>,
    spot: { at: { x: number; z: number } },
    changed: boolean,
    standing: boolean,
  ): void {
    const e = who.entity
    const near = standing && Math.hypot(who.x - spot.at.x, who.z - spot.at.z) < 0.5
    if (!near) {
      overlay.clear(e)
      this.faced[r] = -1
      return
    }
    if (changed || this.faced[r] < 0) {
      this.hasWork[r] = line.work !== null
      this.hasLook[r] = line.look !== null
      if (line.work !== null) this.point(line.work, who.x, this.work[r])
      if (line.look !== null) this.point(line.look, who.x, this.look[r])
    }
    if (this.faced[r] !== this.cur.flat) {
      this.faced[r] = this.cur.flat
      const t = this.hasWork[r] ? this.work[r] : this.hasLook[r] ? this.look[r] : null
      if (t !== null) who.walker.face(Math.atan2(t.x - who.x, t.z - who.z))
    }
    e.anim = animOf(line.action)
    overlay.show(e, line.action, line.left, line.right, this.cur.progress, this.hasWork[r] ? this.work[r] : null, this.hasLook[r] ? this.look[r] : this.hasWork[r] ? this.work[r] : null)
  }

  /** The case is over (or abandoned): nothing of it stays on the view, the people or the patient. */
  finish(): void {
    const h = this.host
    this.unpose()
    clearView(h.view)
    h.op.releaseDrive()
    h.op.entity.attire = 0
    if (h.doctor !== null) {
      h.doctor.overlay.clear(h.doctor.entity)
      h.doctor.entity.attire = 0
    }
    this.started = false
  }
}

/** The roles of the script in the order of `ProcedureView.roles` (for tests). */
export const PROSENSE_ROLES: readonly ProcRole[] = ['breastRadiologist', 'sonographer']
