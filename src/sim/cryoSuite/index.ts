/**
 * R4: the CT-guided, robot-assisted cryoablation suite on level 2 (docs/R4-CRYO-SUITE.md). The port is frozen in ports.ts (`CryoSuitePort`);
 * everything else here is this service's own:
 *
 *   plan.ts    the day's list, pure and seeded: tumour, needle paths, every step length, recovery time, the scene's seeds
 *   case.ts    one case from lift B to lift B: the ward porter's stretcher, the CT table, the steps, the nurse's stretcher to a recovery bay
 *   derive.ts  the room's look (CT table and rotor, robot, needles, ice, temperatures) as a pure function of (plan, step, since, t)
 *   team.ts    the radiologist, the radiographer and the sedation nurse: their place for every step
 *   sites.ts   the seats (the building's or synthetic), the recovery bays (the surgery suite's) and the standing spots
 *
 *   script.ts  R5 wave 3: a case's procedure script (src/content/procedures/cryo-*.json): its steps, who wears what (the adapter to src/sim/procedure)
 *   targets.ts R5 wave 3: what differs between the kidney, lung and liver cases (CONFIG.cryoSuite.targets)
 *
 * `step` advances the porter, the cases, then derives the state the scene reads (mutated in place; `version` bumped on a discrete change:
 * the step, the needle, the robot's phase, the gas, the case list), then re-reads the team's routine 4 times a second. The ward porter
 * exists only during his transfers: he appears from lift B and goes back up in it. Nothing here decides anything clinical.
 *
 * R5 wave 3: while a scripted case is in the room, `state.procedure` is its step-by-step view (the step under the clock, who does what, the patient's
 * table pose, the point the camera frames), `state.target` its target and `state.apnoea` the held breath (the anaesthetist's `holdBreath` line: only a
 * window of a few seconds inside a needle push and inside each scan's sweep, `derive.ts` `pushHoldInto` and `scanHoldInto`, and a lung or liver needle
 * moves only inside that window: `needleClockInto`); the patient's `Entity.patientPose` is that same patient object while they are in the room.
 * `startWatch(target)` books a watch case of a target. The view shows the transfer onto the CT table only once the patient is moved across (the stretcher
 * parked beside it): until then it stays on the arrival's step before it (`deriveProcedure`, `CryoCase.transferHeld`). The ward porter also brings the
 * empty stretcher back for the patient's way to recovery (case.ts): he comes in from lift B in good time for the dressing's end, takes the patient out on it and
 * goes. A stretcher goes into and out of the scan room along a fixed lane (lane.ts), backwards on the way out: the porter who has parked one backs it out
 * (`porterLeave`) before he walks it to lift B.
 */
import { CRYO_STAFF } from '@/content/staff'
import { CONFIG } from '../config'
import type { World } from '../er/world'
import type { LiftBank } from '../lifts'
import { LIFTS, type Spot } from '../places'
import { hourAt, timeAtHour } from '../population/schedule'
import { clearView, fillView, stepAt, type ViewCtx } from '../procedure'
import { emptyProcedureView } from '../procedure/empty'
import type { Rng } from '../rng'
import type { CryoCaseView, CryoSuiteState, CryoTarget, OpeningKind, SimEventType, WatchResult } from '../types'
import type { Walker } from '../walker'
import { SurgicalPatient, Staffer } from '../surgery/actors'
import { SurgerySites } from '../surgery/sites'
import { CRYO_SUITE_COPY } from '@/content/cryoSuite'
import { CryoCase, type CryoHost } from './case'
import { HopWalker } from './hop'
import type { LanePose } from './lane'
import { apnoeaCap, applyRoom, holdsBreathAt, newHoldWindow, pushHoldInto, scanHoldInto } from './derive'
import { planCase, planCryoDay, roomStepsFor, secondsOf, targetOf, type PlannedCryoCase, type RoomStep } from './plan'
import type { CryoDemoResult, CryoNoTeamWhy, CryoSuitePort } from './ports'
import { ROLE_STAFF, transferStepOf, watchTimesFor } from './script'
import { BACK_SPEED, CryoSites, TURN_RATE } from './sites'
import { CryoTeam, newCryoContext, type CryoContext } from './team'

export { planCryoDay, planCase, cryoTimeline, iceCoverageGap, coverRadius, ROOM_STEPS, ALL_ROOM_STEPS, roomStepsFor, secondsOf, targetOf, SCAN_STEPS, MARGIN_MM, type PlannedCryoCase, type RoomStep, type CryoTimeline } from './plan'
export { applyRoom, iceAt, needleClockInto } from './derive'
export { CryoCase, type CryoStage } from './case'
export { CryoSites, CRYO_SEAT_IDS } from './sites'

export function emptyCryoState(): CryoSuiteState {
  return {
    caseId: null,
    patientId: null,
    imageSeed: 0,
    step: 'idle',
    stepSince: 0,
    stepEnds: null,
    needle: -1,
    tablePos: 0,
    rotor: 0,
    lasers: false,
    scan: 0,
    robot: { phase: 'stowed', needle: -1, since: 0, motionSeed: 0 },
    needles: [],
    tumourMm: 0,
    ice: 0,
    iceMm: { short: 0, long: 0 },
    marginC: 37,
    argon: false,
    heater: false,
    timer: 0,
    demo: false,
    demoQueued: false,
    cases: [],
    target: 'kidney',
    apnoea: false,
    procedure: emptyProcedureView(),
    version: 0,
  }
}

/** The WHO checklist pause a step marks, as the event the R2 suite logs for it (with the content's line). */
const WHO_EVENT: Readonly<Record<'signIn' | 'timeOut' | 'signOut', SimEventType>> = { signIn: 'whoSignIn', timeOut: 'whoTimeOut', signOut: 'whoSignOut' }
/** A watch case (and the day cases it pushes back) must be out of the room this long before the team goes home (seconds). */
const HOME_MARGIN = 300

/** The held breath's window, reused (`deriveProcedure` allocates nothing). */
const HOLD = newHoldWindow()
/** The step before the transfer is held by asking `stepAt` for this long (s) before the transfer step begins. */
const TRANSFER_HOLD_EPS = 1e-6

const PORTER = CRYO_STAFF.find((s) => s.title === 'wardPorter')!
/** The porter carries his empty stretcher back up this long at most before a safety net places him. */
const PORTER_LIMIT = 900

/**
 * The return trip's `sub`: -3 backing the stretcher out of the scan room, -2 waiting for it to be out, -1 turning it, then (0 and on) his way to lift B: backed
 * down the corridor (`lane`: he came out of the scan room along the lane) or the crowd's walk (he comes from a recovery bay).
 */
type PorterJob = { kind: 'case' } | { kind: 'return'; sub: number; at: number; lane: boolean }
/** The ward porter's own task keys for backing out of the scan room. */
const BACK_KEY = 'porter:out'
const TURN_KEY = 'porter:turn'
/** Another case's porter job waits when a case in its dressing is this far (s) from calling for him: the empty stretcher's trip is then not made late. */
const PORTER_RESERVE = 150

export class CryoSuite implements CryoSuitePort, CryoHost {
  readonly state: CryoSuiteState = emptyCryoState()
  stuckFixes = 0
  readonly stuckLog: string[] = []
  /** True while a warm start places things (nothing is logged). */
  quiet = false
  /** Today's plan, once the day has started (demos are added to `runs` only). */
  plan: PlannedCryoCase[] = []
  /** Every case of today, in the order they were booked (the plan's, then the demos). */
  runs: CryoCase[] = []
  private started = false
  /** The clock hour the team is on site from: CONFIG.cryoSuite.teamFromHour, or (S1 showcase) from the opening's first second. */
  teamFrom: number = CONFIG.cryoSuite.teamFromHour
  private t = 0
  private settledAt = Number.NaN
  private _sites: CryoSites | null = null
  private _team: CryoTeam | null = null
  private readonly ctx: CryoContext = newCryoContext()
  private readonly nameRng: Rng
  private names: string[] = []
  private assignAcc = 0
  private readonly pose: LanePose = { x: 0, z: 0, heading: 0 }
  private porter: Staffer | null = null
  private porterFade = false
  private porterJob: PorterJob | null = null
  private demos = 0
  /** Why the last `startWatch` answered 'noTeam' (null: it has not). */
  private noTeamBecause: CryoNoTeamWhy | null = null
  /** R5: the patient who carries the published table pose, the view's context, and the procedure version the team was last placed at. */
  private posed: SurgicalPatient | null = null
  private readonly viewCtx: ViewCtx
  private assignedVersion = -1

  constructor(
    readonly world: World,
    readonly rng: Rng,
    readonly walkerFor: (id: string) => Walker,
  ) {
    this.nameRng = rng.fork('names')
    this.ctx.view = this.state.procedure
    this.viewCtx = { caseId: null, watch: false, entityIds: {}, targets: this.ctx.targets }
  }

  get cases(): readonly CryoCaseView[] {
    return this.state.cases
  }

  /** The seats and spots (resolved on first use: the surgery suite, whose recovery bays they share, is set up by then). */
  get sites(): CryoSites {
    if (this._sites === null) this._sites = new CryoSites(this.world.seats, this.world.surgery?.sites ?? new SurgerySites(this.world.seats), this.state)
    return this._sites
  }

  get team(): CryoTeam {
    if (this._team === null) this._team = new CryoTeam(this.world, this.sites)
    return this._team
  }

  get lifts(): LiftBank | null {
    return this.world.lifts
  }

  // --- the day --------------------------------------------------------------------------------------------------------

  startDay(t0: number, opening: OpeningKind = 'quiet'): void {
    this.started = true
    // S1: the showcase has every room at work from the first second (the radiographer warming the CT up, the radiologist at the robot station)
    this.teamFrom = opening === 'showcase' ? Math.min(CONFIG.cryoSuite.teamFromHour, hourAt(t0)) : CONFIG.cryoSuite.teamFromHour
    this.plan = planCryoDay(this.rng.fork('plan'), { mixed: true })
    this.names = this.plan.map(() => this.world.uniqueName(this.nameRng))
    this.settle(t0)
  }

  warmStart(hour: number): void {
    if (!this.started) return
    this.settle((hour - CONFIG.sim.startHour) * 3600)
  }

  step(t: number, dt: number): void {
    if (!this.started) return
    this.t = t
    this.teamLife(t)
    this.stepPorter(t)
    for (const c of this.runs) c.step(t, dt)
    this.derive(t)
    this.assignAcc += dt
    // (R5: a new step re-places the team at once, so the pose overlay changes with the caption)
    if (this.assignAcc >= 0.25 || this.state.procedure.version !== this.assignedVersion || this.team.laneDirty) {
      this.assignAcc = 0
      this.assignedVersion = this.state.procedure.version
      this.team.laneDirty = false
      this.team.assign(this.ctx)
    }
  }

  sync(_alpha: number): void {}

  // --- the presenter's watch case -----------------------------------------------------------------------------------------

  /** "Start a cryoablation now" (R4's button): a kidney watch case booked after whatever is in the room (never 'following'). */
  startDemo(): CryoDemoResult {
    const r = this.startWatch('kidney', { fromStart: true })
    return r === 'following' ? 'queued' : r
  }

  /**
   * Why the last `startWatch` (or `startDemo`) answered 'noTeam': 'hours' (the team is not on site: before it comes in or after it has gone home) or
   * 'late' (the team is in, but a whole case could not be out of the room before it goes home). Null until a start was refused.
   */
  get whyNoTeam(): CryoNoTeamWhy | null {
    return this.noTeamBecause
  }

  private refuse(why: CryoNoTeamWhy): WatchResult {
    this.noTeamBecause = why
    return 'noTeam'
  }

  startWatch(target: CryoTarget, opts?: { fromStart?: boolean }): WatchResult {
    if (!this.started) return this.refuse('hours')
    const hour = hourAt(this.t)
    if (hour < this.teamFrom || hour >= CONFIG.cryoSuite.teamToHour || !this.team.present) return this.refuse('hours')
    const times = watchTimesFor(target)
    if (times === null) return this.refuse('hours')
    if (this.runs.some((c) => c.plan.demo && (c.stage === 'scheduled' || c.inRoom || c.stage === 'toPacu'))) return 'busy'
    if (this.runs.some((c) => c.inRoom) && opts?.fromStart !== true) return 'following'
    const free = this.roomFreeFor(null, this.t)
    const index = this.runs.length
    const n = this.demos + 1
    const plan = planCase(this.rng.fork(`demo:${n}`), `cryo-demo-${n}`, index, this.t, true, target, times)
    if (this.watchTooLate(plan, Math.max(this.t, this.projectedFree(null, this.t)))) return this.refuse('late')
    this.noTeamBecause = null
    this.demos = n
    const name = this.world.uniqueName(this.nameRng)
    const c = new CryoCase(plan, this, this.rng.fork(plan.id), name)
    this.runs.push(c)
    // (the panel's list in the order of service: the watch case before every case still waiting)
    const firstWaiting = this.state.cases.findIndex((v) => v.step === 'scheduled')
    if (firstWaiting < 0) this.state.cases.push(c.view)
    else this.state.cases.splice(firstWaiting, 0, c.view)
    this.state.demoQueued = !free
    this.touch()
    return free ? 'started' : 'queued'
  }

  get watchStartsAt(): number | null {
    const c = this.runs.find((r) => r.plan.demo && r.stage === 'scheduled')
    return c === undefined ? null : Math.max(this.t, this.projectedFree(c, this.t))
  }

  /** The seconds a case is in the room from its first step to the end of 'out' (its planned lengths). */
  private roomSeconds(plan: PlannedCryoCase): number {
    let sum = 0
    for (const s of roomStepsFor(targetOf(plan))) sum += secondsOf(plan, s)
    return sum
  }

  /** When case `o` leaves the room (realised, or projected from the step it is in). */
  private projectOut(o: CryoCase, t: number): number {
    if (o.roomEnd !== null) return o.roomEnd
    if (o.outSince !== null) return o.outSince + secondsOf(o.plan, 'out')
    const order = roomStepsFor(targetOf(o.plan))
    let at = Math.max(t, o.until)
    for (let k = order.indexOf(o.roomStep ?? 'arrive') + 1; k < order.length; k++) at += secondsOf(o.plan, order[k])
    return at
  }

  /** When the room is next free (the cases in it, or in their turnover, out of the way), not counting `except`. */
  private projectedFree(except: CryoCase | null, t: number): number {
    let free = t
    for (const o of this.runs) {
      if (o === except) continue
      if (o.inRoom || o.outSince !== null) free = Math.max(free, this.projectOut(o, t) + o.plan.turnoverSeconds)
    }
    return free
  }

  /**
   * Would `plan` (a watch case coming into the room at `freeAt`), or a day case that it pushes back, still be in the room when the team goes home? The
   * day cases not started yet follow it, each no earlier than the one before it is out plus its turnover (as `mayStart` makes them wait).
   */
  private watchTooLate(plan: PlannedCryoCase, freeAt: number): boolean {
    const home = timeAtHour(CONFIG.cryoSuite.teamToHour) - HOME_MARGIN
    let free = freeAt + this.roomSeconds(plan)
    if (free > home) return true
    free += plan.turnoverSeconds
    for (const c of this.runs) {
      if (c.stage !== 'scheduled' || c.plan.demo) continue
      const wheelsIn = Math.max(c.plan.nominalIn, free)
      free = wheelsIn + this.roomSeconds(c.plan)
      // (only a case this watch pushes back: one already planned to finish late is the day's own business)
      if (wheelsIn > c.plan.nominalIn + 1 && free > home) return true
      free += c.plan.turnoverSeconds
    }
    return false
  }

  // --- CryoHost -------------------------------------------------------------------------------------------------------

  /** No case in the rooms (other than `c`), none on its way out, and the last turnover over. */
  private roomFreeFor(c: CryoCase | null, t: number): boolean {
    for (const o of this.runs) {
      if (o === c) continue
      if (o.inRoom) return false
      if (o.outSince !== null && (o.roomEnd === null || t < o.roomEnd + o.plan.turnoverSeconds)) return false
    }
    return true
  }

  mayStart(c: CryoCase, t: number): boolean {
    if (t < c.plan.plannedIn || !this.team.present) return false
    if (!this.roomFreeFor(c, t)) return false
    // its turn: a demo before the list, then the list in order
    for (const o of this.runs) {
      if (o === c || o.stage !== 'scheduled' || t < o.plan.plannedIn) continue
      if (o.plan.demo !== c.plan.demo ? o.plan.demo : o.plan.plannedIn < c.plan.plannedIn || (o.plan.plannedIn === c.plan.plannedIn && o.plan.index < c.plan.index)) return false
    }
    return true
  }

  acquirePorter(owner: string): Staffer | null {
    if (this.porter !== null) return this.porter.engagedBy === owner ? this.porter : null
    // (a case in its dressing is about to want the porter for the empty stretcher: nobody else's job begins now, so he is free for it)
    for (const c of this.runs) if (c.id !== owner && c.wantsPorter(this.t, PORTER_RESERVE)) return null
    if (this.lifts !== null && !this.lifts.claimFade('B', 2, PORTER.id)) return null
    const spot = LIFTS.B[2].stretcher
    const p = this.makePorter(owner, { at: spot.at, heading: spot.heading + Math.PI })
    p.fadeIn()
    this.porterFade = this.lifts !== null
    return p
  }

  placePorter(owner: string, spot: Spot): Staffer {
    return this.makePorter(owner, spot)
  }

  private makePorter(owner: string, spot: Spot): Staffer {
    // (a hop walker: the stretcher's drive along the lane, and the slow turn on the spot, are its; everything else is the crowd walker's)
    const p = new Staffer(this.world, PORTER, 'wardPorter', spot.at, spot.heading, new HopWalker(this.walkerFor(PORTER.id), () => false), 'role')
    p.placeAt(spot.at.x, spot.at.z, spot.heading)
    this.world.hooks.add(p)
    p.setVehicle('stretcher')
    p.walkAnim = 'push'
    p.idleAnim = 'push'
    p.entity.anim = 'push'
    p.engagedBy = owner
    this.porter = p
    this.porterJob = { kind: 'case' }
    return p
  }

  porterLeave(porter: Staffer, t: number): void {
    porter.engagedBy = 'return'
    // (standing at the park beside the CT table: the empty stretcher is backed out along the lane first, it cannot be turned round in the room)
    const park = this.sites.lane.park
    const inRoom = Math.hypot(porter.x - park.x, porter.z - park.z) < 0.5 && porter.walker instanceof HopWalker
    this.porterJob = { kind: 'return', sub: inRoom ? -3 : 0, at: t, lane: inRoom }
  }

  porterDone(porter: Staffer): void {
    this.lifts?.releaseFade(porter.staff.id)
    if (this.porter === porter) {
      this.porter = null
      this.porterJob = null
      this.porterFade = false
    }
  }

  guestBay(seatId: string, patientId: string | null, name: string | null, t: number): void {
    this.world.surgery?.guestBay(seatId, patientId, name, t)
  }

  caseFinished(c: CryoCase): void {
    this.world.releaseName(c.name)
  }

  touch(): void {
    this.state.version++
  }

  stuck(msg: string): void {
    this.stuckFixes++
    if (this.stuckLog.length < 40) this.stuckLog.push(`${this.t.toFixed(0)}s ${msg}`)
  }

  say(type: SimEventType, text: string, refs: { subjectId?: string; actorId?: string } = {}): void {
    if (this.quiet) return
    this.world.say(type, text, refs)
  }

  // --- the porter ------------------------------------------------------------------------------------------------------

  private stepPorter(t: number): void {
    const p = this.porter
    if (p === null) return
    // appearing out of lift B: the lobby's stretcher slot is his until he is fully in view
    if (this.porterFade && p.visibleFully) {
      this.lifts?.releaseFade(p.staff.id)
      this.porterFade = false
    }
    const job = this.porterJob
    if (job === null || job.kind !== 'return') return
    const spot = LIFTS.B[2].stretcher
    const lane = this.sites.lane
    switch (job.sub) {
      case -3: {
        // backing the stretcher out of the scan room, back along the whole lane to the corridor (the radiographer steps back from the lane while it is the way)
        ;(p.walker as HopWalker).armLane(lane, lane.length, 0)
        this.team.holdLane(BACK_KEY, true)
        p.entity.anim = 'push'
        p.setTask({ key: BACK_KEY, at: { x: lane.stage.x, z: lane.stage.z }, face: lane.stage.heading, anim: 'push', walkAnim: 'push', speed: BACK_SPEED })
        job.sub = -2
        job.at = t
        break
      }
      case -2:
        // (past the scan room's door she may come back to her place)
        if (this.team.laneHeld && (p.walker as HopWalker).laneProgress < lane.sDoor - 1) this.team.holdLane(BACK_KEY, false)
        if (p.isAt(BACK_KEY)) {
          // (the stretcher is turned on the spot, slowly, to the corridor's line: it trails him down to lift B)
          const h = lane.lift.poseAt(lane.lift.length, this.pose).heading
          ;(p.walker as HopWalker).armTurn(h, TURN_RATE, -1)
          p.setTask({ key: TURN_KEY, at: { x: lane.stage.x, z: lane.stage.z }, face: h, anim: 'push', walkAnim: 'push' })
          job.sub = -1
          job.at = t
        } else if (t - job.at > PORTER_LIMIT) this.stuckAt(p, job, lane.stage)
        break
      case -1:
        if (p.isAt(TURN_KEY)) {
          this.team.holdLane(BACK_KEY, false)
          job.sub = 0
          job.at = t
        } else if (t - job.at > PORTER_LIMIT) this.stuckAt(p, job, lane.stage)
        break
      case 0:
        if (this.lifts !== null && !this.lifts.claimFade('B', 2, p.staff.id)) return
        p.entity.anim = 'push'
        if (job.lane) {
          // (backed down the corridor to lift B, the stretcher trailing him)
          ;(p.walker as HopWalker).armLane(lane.lift, lane.lift.length, 0)
          p.setTask({ key: 'porter:back', at: { x: spot.at.x, z: spot.at.z }, face: lane.lift.poseAt(0, this.pose).heading, anim: 'push', walkAnim: 'push', speed: BACK_SPEED })
        } else p.setTask({ key: 'porter:back', at: spot.at, face: spot.heading, anim: 'push', walkAnim: 'push', speed: CONFIG.er.wheelSpeed * 1.2 })
        job.sub = 1
        job.at = t
        break
      case 1:
        if (p.isAt('porter:back')) {
          p.fadeOut()
          job.sub = 2
        } else if (t - job.at > PORTER_LIMIT) {
          this.stuck('the ward porter did not get back to lift B in time')
          p.placeAt(spot.at.x, spot.at.z, spot.heading)
          job.at = t
        }
        break
      case 2:
        if (p.gone) this.porterDone(p)
        break
    }
  }

  /** A leg of the porter's way out of the scan room took too long: a safety net puts him at the out point. */
  private stuckAt(p: Staffer, job: { sub: number; at: number }, at: { x: number; z: number; heading: number }): void {
    this.stuck('the ward porter did not back out of the scan room in time')
    p.placeAt(at.x, at.z, at.heading)
    this.team.holdLane(BACK_KEY, false)
    job.sub = 0
    job.at = this.t
  }

  // --- the team's day ----------------------------------------------------------------------------------------------------

  private teamLife(t: number): void {
    const hour = hourAt(t)
    const { teamToHour } = CONFIG.cryoSuite
    if (!this.team.present && hour >= this.teamFrom && hour < teamToHour) this.team.spawn(this.ctx, false)
    if (hour >= teamToHour && this.team.present && this.state.step === 'idle' && !this.runs.some((c) => c.inRoom || c.stage === 'toPacu')) {
      this.ctx.dayOver = true
      if (this.team.dismiss()) this.team.clear()
    }
  }

  // --- warm start ----------------------------------------------------------------------------------------------------------

  private clearAll(): void {
    // (R5: nobody carries the view's table pose any more; the view starts again from the plan)
    this.unpose()
    clearView(this.state.procedure)
    this.ctx.script = null
    this.state.apnoea = false
    this.state.target = 'kidney'
    for (const c of this.runs) c.dispose()
    if (this.porter !== null) {
      this.lifts?.releaseFade(this.porter.staff.id)
      this.world.detach(this.porter)
      this.world.hooks.remove(this.porter)
    }
    this.porter = null
    this.porterJob = null
    this.porterFade = false
    for (const s of this.team.staffers) this.world.hooks.remove(s)
    this.team.clear()
    this.runs = []
  }

  private settle(t: number): void {
    if (this.settledAt === t) return
    this.settledAt = t
    this.clearAll()
    this.quiet = true
    this.t = t
    this.demos = 0
    for (const n of this.names) this.world.claimName(n)
    this.runs = this.plan.map((p, i) => new CryoCase(p, this, this.rng.fork(p.id), this.names[i]))
    this.state.cases.length = 0
    for (const c of this.runs) this.state.cases.push(c.view)
    const hour = hourAt(t)
    const teamOn = hour >= this.teamFrom && hour < CONFIG.cryoSuite.teamToHour
    this.ctx.dayOver = false
    if (teamOn) this.team.spawn(this.ctx, true)
    for (const c of this.runs) c.warm(t)
    for (const c of this.runs) if (c.stage === 'done') this.world.releaseName(c.name)
    this.derive(t)
    this.assignedVersion = this.state.procedure.version
    if (teamOn) this.team.settleAll(this.ctx)
    this.quiet = false
    this.touch()
  }

  // --- R5: the step-by-step view ---------------------------------------------------------------------------------------------

  /** Nobody carries the published table pose any more. */
  private unpose(): void {
    if (this.posed !== null) {
      this.posed.entity.patientPose = null
      this.posed = null
    }
  }

  /**
   * The step under the clock of the scripted case in the room (src/sim/procedure): the published view, the team's step context, the held breath, the
   * patient's table pose and the step's event and checklist lines (said once each, as the step begins; a warm start says nothing). No scripted case in
   * the room: the empty view. The patient carries the view's own `patient` object (`Entity.patientPose`) from the moment they are in the room until they
   * leave the CT table. Allocation-free except at a step change (a log line, the view's first fill).
   */
  private deriveProcedure(t: number, active: CryoCase | null, win: { step: CryoSuiteState['step']; since: number; until: number | null } | null): void {
    const ctx = this.ctx
    const s = this.state
    const view = s.procedure
    const sc = active !== null ? active.proc : null
    let on = false
    let until = 0
    if (active !== null && sc !== null && win !== null && win.step !== 'turnover' && win.step !== 'idle') {
      until = win.until ?? win.since + secondsOf(active.plan, win.step as RoomStep)
      on = stepAt(sc.steps, win.step, win.since, until, t, null, ctx.cur)
      // the transfer onto the CT table is not published before the patient is moved across: while they are still on the porter's stretcher (it is not
      // parked beside the table yet) the view stays on the step before it, with that step's window, whatever the clock says
      if (on && win.step === 'arrive' && active.transferHeld() && ctx.cur.index >= transferStepOf(sc.steps.cs) && ctx.cur.flat > sc.steps.uFirst[ctx.cur.unit]) {
        on = stepAt(sc.steps, 'arrive', win.since, until, ctx.cur.since - TRANSFER_HOLD_EPS, null, ctx.cur)
      }
    }
    if (active === null || sc === null || win === null || !on) {
      ctx.script = null
      if (clearView(view)) s.version++
      if (s.target !== 'kidney') {
        s.target = 'kidney'
        s.version++
      }
      if (s.apnoea) {
        s.apnoea = false
        s.version++
      }
      this.unpose()
      return
    }
    const vc = this.viewCtx
    vc.caseId = active.id
    vc.watch = active.plan.demo
    const ids = vc.entityIds
    const present = this.team.present
    ids.ir = present ? ROLE_STAFF.ir : null
    ids.ctRadiographer = present ? ROLE_STAFF.ctRadiographer : null
    ids.sedation = present ? ROLE_STAFF.sedation : null
    ids.cryoAnaes = present ? ROLE_STAFF.cryoAnaes : null
    const target = targetOf(active.plan)
    const cx = ctx.targets.cryo
    cx.tablePos = s.tablePos
    cx.target = target
    cx.needle = s.needle
    cx.needles = s.needles
    const changed = fillView(view, sc.steps, ctx.cur, vc)
    ctx.script = sc
    if (s.target !== target) {
      s.target = target
      s.version++
    }
    // the held breath: the anaesthetist's line is `holdBreath` (each scan, each needle push of the lung and the liver), but breathing is only paused for
    // a window of it: the push step's part up to the needle being in, the scan's sweep, at most CONFIG.cryoSuite.apnoeaSeconds in the living day
    let apnoea = false
    if (holdsBreathAt(sc.steps.cs, ctx.cur.index)) {
      const cap = apnoeaCap(active.plan)
      if (win.step === 'aim') {
        pushHoldInto(ctx.cur.until - ctx.cur.since, cap, HOLD)
        const el = t - ctx.cur.since
        apnoea = el >= HOLD.from && el < HOLD.to
      } else {
        scanHoldInto(until - win.since, cap, HOLD)
        const el = t - win.since
        apnoea = el > HOLD.from && el < HOLD.to
      }
    }
    if (s.apnoea !== apnoea) {
      s.apnoea = apnoea
      s.version++
    }
    // the patient carries the table pose (the view's own object) while in the room
    const p = active.stage === 'arriving' || active.stage === 'room' ? active.patient : null
    if (this.posed !== p) {
      this.unpose()
      this.posed = p
    }
    if (p !== null && p.entity.patientPose !== view.patient) p.entity.patientPose = view.patient
    if (changed) {
      s.version++
      this.sayStepLines(active, sc.steps.cs.script.steps, sc.steps.stepOf, ctx.cur.flat)
    }
    this.team.updatePoints(ctx)
  }

  /** The event and WHO checklist lines of the steps the case has just entered (in order), once each. */
  private sayStepLines(c: CryoCase, steps: readonly { event?: string; checklist?: 'signIn' | 'timeOut' | 'signOut' }[], stepOf: Int16Array, flat: number): void {
    const sc = c.proc!
    if (flat <= sc.saidFlat) return
    const from = sc.saidFlat + 1
    sc.saidFlat = flat
    if (this.quiet || c.patient === null) return
    const subject = { subjectId: c.patient.entity.id }
    for (let f = from; f <= flat; f++) {
      const step = steps[stepOf[f]]
      if (step.checklist !== undefined) this.say(WHO_EVENT[step.checklist], `${c.name}: ${CRYO_SUITE_COPY.checklist[step.checklist]}`, subject)
      if (step.event !== undefined) this.say('procedureStep', `${c.name}: ${step.event}`, subject)
    }
  }

  // --- derived state ----------------------------------------------------------------------------------------------------------

  private derive(t: number): void {
    const s = this.state
    let active: CryoCase | null = null
    let win: { step: CryoSuiteState['step']; since: number; until: number | null } | null = null
    for (const c of this.runs) {
      const w = c.roomWindow(t)
      if (w !== null) {
        active = c
        win = w
        break
      }
    }
    if (win === null) {
      // the turnover after the last case out, or an idle room
      for (const c of this.runs) {
        if (c.roomEnd !== null && t < c.roomEnd + c.plan.turnoverSeconds) win = { step: 'turnover', since: c.roomEnd, until: c.roomEnd + c.plan.turnoverSeconds }
      }
    }
    const step = win?.step ?? 'idle'
    const since = win?.since ?? (s.step === 'idle' ? s.stepSince : t)
    const until = win?.until ?? null
    let changed = applyRoom(s, active?.plan ?? null, step, since, until, t, active?.proc?.steps ?? null)
    const caseId = active?.id ?? null
    const patientId = active !== null && active.patient !== null ? active.patient.entity.id : null
    const demo = active?.plan.demo ?? false
    const demoQueued = this.runs.some((c) => c.plan.demo && c.stage === 'scheduled')
    if (s.caseId !== caseId || s.patientId !== patientId || s.demo !== demo || s.demoQueued !== demoQueued) {
      s.caseId = caseId
      s.patientId = patientId
      s.demo = demo
      s.demoQueued = demoQueued
      changed = true
    }
    if (changed) this.touch()
    this.deriveProcedure(t, active, win)
    const ctx = this.ctx
    ctx.now = t
    ctx.step = s.step
    ctx.since = s.stepSince
    ctx.until = s.stepEnds
    if (hourAt(t) < CONFIG.cryoSuite.teamToHour) ctx.dayOver = false
  }
}
