/**
 * R2: the robotic surgery suite on level 2 (agent S, src/sim/surgery/**). The interface is frozen in ports.ts (`SurgeryPort`); everything else
 * here is this service's own. One da Vinci 5 OR runs a seeded list each day (CONFIG.surgery):
 *
 *   plan.ts     the day's list, pure and seeded: procedures, wheels-in times, every phase and visit length, the outcome, the exchanges
 *   case.ts     one case's journey from the entrance to home (or the ward), the theatre phases included
 *   team.ts     the nine theatre staff (THEATRE_STAFF): their routine in the room, and lending them to a case
 *   robot.ts    the robot's FSM and the cart's drive path, as pure functions of (segment, time)
 *   sites.ts    seats and standing spots (the building's, or made from the contract anchors when the layout lacks them)
 *   actors.ts   the patient, the companion and the staff as Actors
 *   script.ts   R5: a case's procedure script (src/sim/procedure): its steps, the bedside exchanges, who wears what
 *   watch.ts    R5: "Watch step by step": a compressed case booked in front of the day's list
 *
 * R5: while a case with a script is in the room, `state.procedure` is its step-by-step view (the step under the clock, who does what, the
 * patient's pose), the team stands and works where each step says, the patient's entity carries the table pose, and the robot's arms hold
 * the script's instruments. A case whose procedure has no script yet runs exactly as in R2.
 *
 * `step` advances the cases, then derives the theatre state, the robot, the bays and the KPIs the scene reads (mutated in place, `version`
 * bumped on change), then re-reads the team's routine a few times a second. The people change level only by riding the lifts (src/sim/lifts).
 * Nothing here decides anything clinical: every duration and outcome is a seeded draw.
 */
import { staffName, THEATRE_STAFF } from '@/content/staff'
import { surgeryLine, SURGERY_COPY } from '@/content/surgery'
import { syntheticNameOf } from '@/content/roster'
import { CONFIG } from '../config'
import type { World } from '../er/world'
import type { LiftBank } from '../lifts'
import { hourAt, timeAtHour } from '../population/schedule'
import { LIFTS, PACU, PREOP, SURGERY, type PortLayout } from '../places'
import type { Rng } from '../rng'
import type {
  CasePhase,
  OpeningKind,
  RobotArmState,
  SimEventType,
  SurgeryBayState,
  SurgeryCaseView,
  SurgeryProcedure,
  SurgeryState,
  TheatreKpis,
  Vec3,
  WatchResult,
} from '../types'
import type { Walker } from '../walker'
import type { Staffer, SurgicalPatient } from './actors'
import { SurgeryCase, type CaseHost } from './case'
import { planDay, ROOM_PHASES, timelineOf, type PlannedCase, type RoomPhase } from './plan'
import type { SurgeryPort } from './ports'
import { applyRobot, EXCHANGE_SECONDS, segmentAt, UNDOCK_SPLIT, type RobotCaseTimes, type RobotSegment } from './robot'
import { caseScriptFor, scriptedArmsInto, WHO_EVENT } from './script'
import { SurgerySites } from './sites'
import { newTablePose, setTablePose, tablePointInto, type TablePose } from './tablePose'
import { newOrContext, SCRUB_NURSE_LEAD, Team, type OrContext } from './team'
import { WatchDesk, type WatchHost } from './watch'
import { clearView, davinciSlots, fillView, focusPointInto, setTable, stepAt, type ViewCtx } from '../procedure'
import { emptyProcedureView } from '../procedure/empty'

export { planDay, timelineOf, ROOM_PHASES, type PlannedCase, type Timeline, type RoomPhase } from './plan'
export { cartPose, cartPath, applyRobot, segmentAt, forceAt, DOCK_SPLIT, UNDOCK_SPLIT, type CartPose, type RobotSegment } from './robot'
export { SurgerySites } from './sites'
export { SurgeryCase, casePhaseOf, type Stage } from './case'

/** The team is on level 2 this long before the scrub nurse's lead ahead of the first case's drape. */
const TEAM_EARLY_SECONDS = 600

/** F-21: the sex a procedure implies for the patient (cholecystectomy: either). */
const SEX_OF_PROCEDURE: Readonly<Record<SurgeryProcedure, 'female' | 'male' | null>> = {
  cholecystectomy: null,
  hysterectomy: 'female',
  prostatectomy: 'male',
}

/** R5: the staff member who fills each scripted role (THEATRE_STAFF by title). */
const ROLE_STAFF = {
  surgeon: THEATRE_STAFF.find((m) => m.title === 'surgeon')?.id ?? null,
  assistant: THEATRE_STAFF.find((m) => m.title === 'assistant')?.id ?? null,
  scrub: THEATRE_STAFF.find((m) => m.title === 'scrub')?.id ?? null,
  circulator: THEATRE_STAFF.find((m) => m.title === 'circulator')?.id ?? null,
  anaesthetist: THEATRE_STAFF.find((m) => m.title === 'anaesthetist')?.id ?? null,
} as const

/** A porter who went up with a ward patient comes back this way. */
interface Away {
  porter: Staffer
  returnAt: number
  state: 'away' | 'back'
}

export class Surgery implements SurgeryPort, CaseHost, WatchHost {
  readonly state: SurgeryState
  readonly sites: SurgerySites
  readonly team: Team
  /** Every case of today's list, in order. */
  runs: SurgeryCase[] = []
  /** Safety nets that fired (a bug if not zero) and what they were. */
  stuckFixes = 0
  readonly stuckLog: string[] = []
  /** True while a warm start places things (nothing is logged). */
  quiet = false
  /** Today's plan (the same as the cases'), once the day has started. */
  plan: PlannedCase[] = []

  private started = false
  /** The clock hour the team starts the day (CONFIG.surgery.teamFromHour, or earlier for an early first case). */
  teamFrom: number = CONFIG.surgery.teamFromHour
  private t = 0
  private settledAt = Number.NaN
  private readonly ctx: OrContext = newOrContext()
  private assignAcc = 0
  private kpiAcc = 0
  private readonly away: Away[] = []
  private readonly nameRng: Rng
  /** Today's names, by plan index (drawn once per day; the cases hold their own). */
  private readonly names: { patient: string; companion: string }[] = []
  private lastPhaseKey = ''
  private kpis: TheatreKpis
  /** R5: "Watch step by step" bookings. */
  readonly watch: WatchDesk = new WatchDesk(this)
  /** R5: the step view's context (one object: the role entity ids are refreshed in it) and the patient wearing the table pose. */
  private readonly viewCtx: ViewCtx
  private posed: SurgicalPatient | null = null
  private assignedVersion = -1
  /**
   * R5 wave 2: the robot's ports on the tilted table. Four preallocated points the arms carry by reference (applyRobot's `ports`), rewritten in place from the
   * published patient pose; the layout and the case they were last placed for.
   */
  private readonly portsNow: Vec3[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0 }))
  private readonly portPose: TablePose = newTablePose()
  private portsLayout: PortLayout = 'oblique'
  private portsCase: string | null = null

  constructor(
    readonly world: World,
    readonly rng: Rng,
    readonly walkerFor: (id: string) => Walker,
  ) {
    this.nameRng = rng.fork('names')
    this.sites = new SurgerySites(world.seats)
    this.team = new Team(world, this.sites, rng.fork('team'))
    const arms: RobotArmState[] = [0, 1, 2, 3].map((i) => ({ index: i as 0 | 1 | 2 | 3, instrument: '', port: null, drape: 0, engage: 0, force: 0, exchanges: 0 }))
    const bays: SurgeryBayState[] = [
      ...PREOP.bays.map((_, i): SurgeryBayState => ({ seatId: `surgeryBed:preop:${i}`, kind: 'preOp', patientId: null, since: 0, curtain: false })),
      ...PACU.bays.map((_, i): SurgeryBayState => ({ seatId: `surgeryBed:pacu:${i}`, kind: 'pacu', patientId: null, since: 0, curtain: false })),
    ]
    const park = SURGERY.cart.park
    this.kpis = { casesToday: 0, firstCaseOnTime: null, dockingMin: null, consoleMin: null, turnoverMin: null, pacuMin: null, utilisation: null }
    this.state = {
      theatre: {
        caseId: null,
        phase: 'idle',
        phaseSince: 0,
        phaseEnds: null,
        lights: false,
        surgeonAtConsole: false,
        teachingInUse: false,
        cases: [],
        kpis: this.kpis,
        version: 0,
      },
      robot: {
        phase: 'stowed',
        cart: { x: park.at.x, z: park.at.z, heading: park.heading },
        boomYaw: 0,
        boomHeight: SURGERY.cart.size.stowedHeight,
        boomExtend: 0,
        laser: false,
        arms,
        motionSeed: 1,
        phaseSince: 0,
        version: 0,
      },
      bays,
      procedure: emptyProcedureView(),
      version: 0,
    }
    this.ctx.view = this.state.procedure
    this.ctx.targets.cart = this.state.robot.cart
    this.ctx.cart = this.state.robot.cart
    this.viewCtx = { caseId: null, watch: false, entityIds: {}, targets: this.ctx.targets }
  }

  // --- the frozen port ------------------------------------------------------------------------------------------------

  /** Today's list (the same objects as `state.theatre.cases`). */
  get cases(): readonly SurgeryCaseView[] {
    return this.state.theatre.cases
  }

  setTeaching(on: boolean): void {
    if (this.state.theatre.teachingInUse === on) return
    this.state.theatre.teachingInUse = on
    this.touch()
  }

  /** R5: "Watch step by step" (ports.ts; src/sim/surgery/watch.ts). */
  startWatch(procedure: SurgeryProcedure, opts?: { fromStart?: boolean }): WatchResult {
    return this.watch.start(procedure, opts?.fromStart === true)
  }

  get watchStartsAt(): number | null {
    return this.watch.startsAt(this.t)
  }

  // --- WatchHost --------------------------------------------------------------------------------------------------------

  get isStarted(): boolean {
    return this.started
  }

  get now(): number {
    return this.t
  }

  robotSegmentAt(t: number): RobotSegment {
    return segmentAt(t, this.robotTimes(t))
  }

  watchNames(procedure: SurgeryProcedure, rng: Rng): { patient: string; companion: string } {
    return { patient: this.patientNameFor(procedure, rng), companion: this.world.uniqueName(rng) }
  }

  insertCase(c: SurgeryCase, index: number): void {
    c.proc = caseScriptFor(c.plan, c.rng)
    this.runs.splice(index, 0, c)
    this.state.theatre.cases.splice(index, 0, c.view)
    this.touch()
  }

  /** A case's wheels-out: realised, or projected from the phases that have begun and the plan's lengths of the rest. */
  projectOut(c: SurgeryCase, t: number): number {
    if (c.leftRoomAt !== null) return c.leftRoomAt
    let from = -1
    for (let i = 0; i < ROOM_PHASES.length; i++) if (c.starts[ROOM_PHASES[i]] !== undefined) from = i
    if (from < 0) return Math.max(c.nominalIn, t) + c.plan.roomSeconds
    let at = c.starts[ROOM_PHASES[from]]!
    for (let i = from; i < ROOM_PHASES.length; i++) at += c.plan.phases[ROOM_PHASES[i]]
    return Math.max(at, t)
  }

  /** Plan today's list from the start time (a fresh day or a warm start) and put everything where the plan has it at `t0`. */
  /** S1: how the day opened (the showcase list stays the plan through every Jump and Skip). */
  opening: OpeningKind = 'quiet'

  startDay(t0: number, opening: OpeningKind = 'quiet'): void {
    this.started = true
    this.opening = opening
    // S1: the showcase list opens on an early case in PACU and a case at the console at the anchor hour; 'quiet' is the plain template
    this.plan = planDay(this.rng.fork('plan'), opening)
    // the team is on level 2 from teamFromHour, or earlier when the first case is draped before that (the showcase's early case)
    const firstDrape = this.plan.reduce((m, p) => Math.min(m, timelineOf(p).drapeStart), Infinity)
    this.teamFrom = Number.isFinite(firstDrape) ? Math.min(CONFIG.surgery.teamFromHour, hourAt(firstDrape - SCRUB_NURSE_LEAD - TEAM_EARLY_SECONDS)) : CONFIG.surgery.teamFromHour
    // names are drawn once for the day and held until their owners leave
    this.names.length = 0
    for (let i = 0; i < this.plan.length; i++) this.names.push({ patient: this.patientNameFor(this.plan[i].procedure, this.nameRng), companion: this.world.uniqueName(this.nameRng) })
    this.settle(t0)
  }

  /**
   * F-21: the patient's name follows the procedure (a hysterectomy is a woman, a prostatectomy a man: the avatar's sex follows the first
   * name). A procedure that is not sex-specific keeps the plain draw. Names already held by today's list are not reused.
   */
  private patientNameFor(procedure: SurgeryProcedure, rng: Rng): string {
    const sex = SEX_OF_PROCEDURE[procedure]
    if (!sex) return this.world.uniqueName(rng)
    const held = (n: string): boolean => this.names.some((x) => x.patient === n || x.companion === n) || this.runs.some((c) => c.patientName === n || c.companionName === n)
    let name = syntheticNameOf(rng, sex)
    for (let i = 0; i < 12 && held(name); i++) name = syntheticNameOf(rng, sex)
    this.world.claimName(name)
    return name
  }

  /** A day that starts at `hour` (a Jump): every case, the robot, the bays and the team are placed from the plan. */
  warmStart(hour: number): void {
    if (!this.started) return
    this.settle(timeAtHour(hour))
  }

  sync(_alpha: number): void {}

  // --- the step -----------------------------------------------------------------------------------------------------------

  step(t: number, dt: number): void {
    if (!this.started) return
    this.t = t
    this.teamLife(t)
    this.stepAway(t)
    // (a case may be inserted while stepping: a pending watch is booked in derive, after the loop)
    for (let i = 0; i < this.runs.length; i++) this.runs[i].step(t, dt)
    this.derive(t, dt)
    this.assignAcc += dt
    // (R5: a new step re-places the team at once, so the pose overlay changes with the caption)
    if (this.assignAcc >= 0.25 || this.state.procedure.version !== this.assignedVersion) {
      this.assignAcc = 0
      this.assignedVersion = this.state.procedure.version
      this.team.assign(this.ctx)
    }
  }

  // --- warm start ---------------------------------------------------------------------------------------------------------

  private clearAll(): void {
    for (const c of this.runs) c.dispose()
    for (const s of this.team.staffers) this.world.hooks.remove(s)
    this.team.clear()
    this.away.length = 0
    this.runs = []
    // (the arms start the day clean: a warm start must not keep a count or an instrument from the run it replaces)
    for (const a of this.state.robot.arms) {
      a.instrument = ''
      a.exchanges = 0
    }
    // (R5: a warm start drops the watch; the step view starts again from the plan)
    this.watch.reset()
    this.posed = null
    clearView(this.state.procedure)
    this.ctx.script = null
    setTable(this.ctx.targets, 0, 0, 'supine')
  }

  private settle(t: number): void {
    if (this.settledAt === t) return
    this.settledAt = t
    this.clearAll()
    this.quiet = true
    this.t = t
    this.kpis.casesToday = 0
    this.kpis.firstCaseOnTime = null
    this.kpis.dockingMin = null
    this.kpis.consoleMin = null
    this.kpis.turnoverMin = null
    this.kpis.pacuMin = null
    this.kpis.utilisation = null
    for (const b of this.state.bays) {
      b.patientId = null
      b.since = 0
      b.curtain = false
      b.guestName = null
    }
    // (removing the people of an earlier settle freed their names: hold them again for the cases still to come)
    for (const n of this.names) {
      this.world.claimName(n.patient)
      this.world.claimName(n.companion)
    }
    this.runs = this.plan.map((p, i) => {
      const c = new SurgeryCase(p, this, this.rng.fork(p.id), this.names[i])
      c.proc = caseScriptFor(p, c.rng)
      return c
    })
    this.state.theatre.cases.length = 0
    for (const c of this.runs) this.state.theatre.cases.push(c.view)
    const hour = hourAt(t)
    const teamOn = hour >= this.teamFrom && hour < CONFIG.surgery.teamToHour
    this.ctx.now = t
    if (teamOn) this.team.spawn(this.ctx, true)
    for (const c of this.runs) c.warm(t)
    // finished cases have nobody left in the building: free their names, and keep their numbers
    for (const c of this.runs) {
      if (c.stage === 'done') {
        this.world.releaseName(c.patientName)
        this.world.releaseName(c.companionName)
        this.recordFinished(c)
      }
    }
    // the robot first (the team's routine reads its phase), then the situation and the step, then everybody to their place
    this.lastPhaseKey = ''
    this.deriveRobot(t, true)
    this.updateContext(t)
    this.deriveProcedure(t, true)
    this.placePorts()
    this.assignedVersion = this.state.procedure.version
    this.ctx.dayOver = hour >= CONFIG.surgery.teamToHour
    if (teamOn) this.team.settleAll(this.ctx)
    this.deriveTheatre(t)
    this.updateKpis(t)
    this.quiet = false
    this.touch()
  }

  /** Numbers of a case that ended before this run (a warm start): they count toward today's KPIs. */
  private recordFinished(c: SurgeryCase): void {
    const p = c.plan
    this.kpis.casesToday++
    this.kpis.dockingMin = p.phases.docking / 60
    this.kpis.consoleMin = p.consoleSeconds / 60
    this.kpis.turnoverMin = p.turnoverSeconds / 60
    this.kpis.pacuMin = p.pacuSeconds / 60
    if (c.plan.index === 0) this.kpis.firstCaseOnTime = c.nominalIn - c.plan.plannedIn <= 300
    c.turnoverReported = true
  }

  // --- the team's day -----------------------------------------------------------------------------------------------------

  private teamLife(t: number): void {
    const hour = hourAt(t)
    const { teamToHour } = CONFIG.surgery
    if (!this.team.present && hour >= this.teamFrom && hour < teamToHour) this.team.spawn(this.ctx, false)
    if (hour >= teamToHour) {
      this.ctx.dayOver = true
      if (this.team.present && this.team.dismiss()) this.team.clear()
    }
  }

  // --- CaseHost -------------------------------------------------------------------------------------------------------------

  get lifts(): LiftBank | null {
    return this.world.lifts
  }

  roomFree(c: SurgeryCase): boolean {
    for (const o of this.runs) {
      if (o === c) continue
      if (o.inRoom || o.stage === 'toTheatre') return false
      if (o.leftRoomAt !== null && this.t < o.leftRoomAt + o.plan.turnoverSeconds) return false
    }
    // the robot has to be draped and ready
    return this.state.robot.phase === 'draped' || this.state.robot.phase === 'deploying'
  }

  roomBusy(c: SurgeryCase): boolean {
    for (const o of this.runs) if (o !== c && (o.inRoom || o.stage === 'toTheatre')) return true
    return false
  }

  surgeonSeated(): boolean {
    const s = this.team.staffers.find((x) => x.title === 'surgeon')
    if (!s) return true
    return s.isAt('surgeon:console')
  }

  bayChanged(seatId: string, patientId: string | null, t: number, curtain: boolean): void {
    const b = this.state.bays.find((x) => x.seatId === seatId)
    if (!b) return
    if (b.patientId !== patientId) b.since = t
    b.patientId = patientId
    b.curtain = curtain
    this.touch()
  }

  /**
   * R4: a patient of another service (the cryoablation suite) takes recovery bay `seatId` (or leaves it: null, null). The boards show `name`;
   * the seat claim itself is the caller's (through `sites`).
   */
  guestBay(seatId: string, patientId: string | null, name: string | null, t: number): void {
    const b = this.state.bays.find((x) => x.seatId === seatId)
    if (!b) return
    b.guestName = patientId === null ? null : name
    this.bayChanged(seatId, patientId, t, false)
  }

  porterAway(porter: Staffer, returnAt: number, _shaft: 'B'): void {
    porter.engagedBy = 'away'
    this.away.push({ porter, returnAt, state: 'away' })
  }

  caseFinished(c: SurgeryCase, _t: number): void {
    this.world.releaseName(c.patientName)
    this.world.releaseName(c.companionName)
  }

  touch(): void {
    this.state.theatre.version++
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

  // --- the porter who went up with a ward patient ------------------------------------------------------------------------------

  private stepAway(t: number): void {
    for (let i = this.away.length - 1; i >= 0; i--) {
      const a = this.away[i]
      if (a.porter.gone) {
        this.away.splice(i, 1)
        continue
      }
      if (a.state === 'away' && t >= a.returnAt) {
        // back from the ward: appears at the lobby's stretcher spot once its slot is free
        if (this.lifts !== null && !this.lifts.claimFade('B', 2, a.porter.staff.id)) continue
        const spot = LIFTS.B[2].stretcher
        a.porter.placeAt(spot.at.x, spot.at.z, spot.heading + Math.PI)
        a.porter.fadeIn()
        a.state = 'back'
      } else if (a.state === 'back' && a.porter.visibleFully) {
        this.lifts?.releaseFade(a.porter.staff.id)
        a.porter.engagedBy = null
        a.porter.task = null
        this.away.splice(i, 1)
      }
    }
  }

  // --- derived state ----------------------------------------------------------------------------------------------------------

  private derive(t: number, dt: number): void {
    this.watch.step(t)
    this.updateContext(t)
    this.deriveRobot(t, false)
    this.deriveProcedure(t, false)
    // (the robot is derived first: its ports follow the step's table pose of THIS tick once the step is known)
    this.placePorts()
    this.deriveTheatre(t)
    this.kpiAcc += dt
    if (this.kpiAcc >= 1) {
      this.kpiAcc = 0
      this.updateKpis(t)
    }
    for (const c of this.runs) {
      if (c.leftRoomAt !== null && !c.turnoverReported && t >= c.leftRoomAt + c.plan.turnoverSeconds) {
        c.turnoverReported = true
        if (!c.isWatch) this.kpis.turnoverMin = c.plan.turnoverSeconds / 60
        this.say('turnoverDone', surgeryLine('turnoverDone', { minutes: Math.round(c.plan.turnoverSeconds / 60) }))
        this.touch()
      }
    }
  }

  private activeCase(): SurgeryCase | null {
    for (const c of this.runs) if (c.inRoom || c.stage === 'toTheatre') return c
    return null
  }

  private updateContext(t: number): void {
    const ctx = this.ctx
    const active = this.activeCase()
    ctx.now = t
    ctx.inRoom = active !== null && active.inRoom
    // turnover: the most recent case out of the room, while its cleaning runs
    ctx.turnoverSince = null
    ctx.turnoverSeconds = 0
    for (const c of this.runs) {
      if (c.leftRoomAt !== null && t < c.leftRoomAt + c.plan.turnoverSeconds) {
        ctx.turnoverSince = c.leftRoomAt
        ctx.turnoverSeconds = c.plan.turnoverSeconds
      }
    }
    ctx.phase = active !== null ? (active.inRoom ? (active.stage as RoomPhase) : 'toTheatre') : ctx.turnoverSince !== null ? 'turnover' : 'idle'
    // the next wheels-in: the first case not yet in the room
    ctx.untilNext = Infinity
    for (const c of this.runs) {
      if (c.stage === 'done' || c.inRoom || c.starts.in !== undefined) continue
      ctx.untilNext = c.stage === 'toTheatre' ? 0 : Math.max(0, c.nominalIn - t)
      break
    }
    // the recovery bed whose patient has been there longest
    ctx.pacuFocus = -1
    let oldest = Infinity
    for (const c of this.runs) {
      if (c.stage !== 'pacu' || c.pacu < 0 || c.pacuInAt === null) continue
      if (c.pacuInAt < oldest) {
        oldest = c.pacuInAt
        ctx.pacuFocus = c.pacu
      }
    }
    ctx.robot = this.state.robot.phase
    ctx.robotSince = this.state.robot.phaseSince
    ctx.exchanging = this.exchangeActive(t)
    ctx.consoleDue = active !== null && active.stage === 'docking' && t >= active.until
  }

  /** The bedside exchanges a case makes at runtime: its script's, or (no script) the plan's. */
  private exchangesOf(c: SurgeryCase): readonly { at: number; arm: 0 | 2 | 3; instrument: string }[] {
    return c.proc !== null ? c.proc.exchanges : c.plan.exchanges
  }

  private exchangeActive(t: number): boolean {
    const c = this.activeCase()
    if (c === null || c.stage !== 'console' || c.view.consoleStart === null) return false
    const since = t - c.view.consoleStart
    for (const e of this.exchangesOf(c)) if (since >= e.at && since < e.at + EXCHANGE_SECONDS) return true
    return false
  }

  // --- R5: the step-by-step view ---------------------------------------------------------------------------------------------

  /**
   * The step under the clock of the scripted case in the room (src/sim/procedure): the published view, the team's step context, the patient's
   * table pose, and the step's event and checklist lines (said once each, as the step begins; a warm start says nothing). No scripted case
   * in the room: the empty view. Allocation-free except at a step change (a log line, the view's first fill).
   */
  private deriveProcedure(t: number, settling: boolean): void {
    const ctx = this.ctx
    const view = this.state.procedure
    const active = this.activeCase()
    const c = active !== null && active.inRoom && active.proc !== null ? active : null
    const sc = c !== null ? c.proc : null
    let on = false
    if (c !== null && sc !== null) {
      const unit = c.stage as RoomPhase
      const since = c.starts[unit] ?? c.stageAt
      const until = since + c.plan.phases[unit]
      on = stepAt(sc.steps, unit, since, until, t, unit === 'docking' || unit === 'undocking' ? davinciSlots : null, ctx.cur)
    }
    if (c === null || sc === null || !on) {
      ctx.script = null
      if (clearView(view)) this.state.version++
      if (this.posed !== null) {
        this.posed.entity.patientPose = null
        this.posed = null
      }
      return
    }
    const vc = this.viewCtx
    vc.caseId = c.id
    vc.watch = c.isWatch
    const ids = vc.entityIds
    const present = this.team.present
    ids.surgeon = present ? ROLE_STAFF.surgeon : null
    ids.assistant = present ? ROLE_STAFF.assistant : null
    ids.scrub = present ? ROLE_STAFF.scrub : null
    ids.circulator = present ? ROLE_STAFF.circulator : null
    ids.anaesthetist = present ? ROLE_STAFF.anaesthetist : null
    ctx.targets.layout = c.plan.layout
    ctx.targets.cart = this.state.robot.cart
    const changed = fillView(view, sc.steps, ctx.cur, vc)
    // (the table's tilt now, then the focus point again with it: the view framed the step with the tilt of the tick before)
    setTable(ctx.targets, view.patient.headTiltDeg, view.patient.rollDeg, view.patient.position)
    focusPointInto(view.focus, ctx.targets, view.focusAt)
    ctx.script = sc
    // the patient carries the table pose (the view's own object)
    const p = c.patient
    if (this.posed !== p) {
      if (this.posed !== null) this.posed.entity.patientPose = null
      this.posed = p
    }
    if (p !== null && p.entity.patientPose !== view.patient) p.entity.patientPose = view.patient
    if (changed) {
      this.state.version++
      this.sayStepLines(c, settling)
    }
    this.team.updatePoints(ctx)
  }

  /** The event and WHO checklist lines of the steps the case has just entered (in order), once each. */
  private sayStepLines(c: SurgeryCase, settling: boolean): void {
    const sc = c.proc!
    const flat = this.ctx.cur.flat
    if (flat <= sc.saidFlat) return
    const from = sc.saidFlat + 1
    sc.saidFlat = flat
    if (settling || this.quiet || c.patient === null) return
    const steps = sc.steps.cs.script.steps
    const subject = { subjectId: c.patient.entity.id }
    for (let f = from; f <= flat; f++) {
      const step = steps[sc.steps.stepOf[f]]
      if (step.checklist !== undefined) this.say(WHO_EVENT[step.checklist], `${c.patientName}: ${SURGERY_COPY.checklist[step.checklist]}`, subject)
      if (step.event !== undefined) this.say('procedureStep', `${c.patientName}: ${step.event}`, subject)
    }
  }

  // --- the theatre -----------------------------------------------------------------------------------------------------------

  private deriveTheatre(t: number): void {
    const th = this.state.theatre
    const ctx = this.ctx
    const active = this.activeCase()
    const phase: CasePhase | 'idle' | 'turnover' = ctx.phase
    const caseId = active?.id ?? null
    let phaseSince = th.phaseSince
    let phaseEnds: number | null = th.phaseEnds
    if (active !== null) {
      phaseSince = active.stageAt
      phaseEnds = active.inRoom ? active.until : null
    } else if (ctx.turnoverSince !== null) {
      phaseSince = ctx.turnoverSince
      phaseEnds = ctx.turnoverSince + ctx.turnoverSeconds
    } else {
      phaseEnds = null
    }
    // the surgical lights are on from induction to emergence
    const lit = active !== null && active.inRoom && phase !== 'in' && phase !== 'out'
    const atConsole = active !== null && active.stage === 'console' && this.surgeonSeated()
    if (th.caseId !== caseId || th.phase !== phase || th.phaseSince !== phaseSince || th.phaseEnds !== phaseEnds || th.lights !== lit || th.surgeonAtConsole !== atConsole) {
      th.caseId = caseId
      th.phase = phase
      th.phaseSince = phaseSince
      th.phaseEnds = phaseEnds
      th.lights = lit
      th.surgeonAtConsole = atConsole
      this.touch()
    }
    void t
  }

  // --- the robot -----------------------------------------------------------------------------------------------------------

  /** The start of theatre phase `p` of case `c`: realised once it began, otherwise projected from what is known. */
  private projectStart(c: SurgeryCase, p: RoomPhase, t: number): number {
    const real = c.starts[p]
    if (real !== undefined) return real
    const idx = ROOM_PHASES.indexOf(p)
    // the latest phase that has begun, and the planned lengths from there on
    let from = -1
    for (let i = 0; i < idx; i++) if (c.starts[ROOM_PHASES[i]] !== undefined) from = i
    if (from < 0) {
      // not wheeled in yet: the schedule, but never in the past
      const base = Math.max(c.nominalIn, t)
      return base + (c.tl.phaseStart[p] - c.nominalIn)
    }
    let at = c.starts[ROOM_PHASES[from]]!
    for (let i = from; i < idx; i++) at += c.plan.phases[ROOM_PHASES[i]]
    return at
  }

  /** The robot's day: every case's drape, docking, undocking and cleaning times (realised once known, projected otherwise). */
  robotTimes(t: number): RobotCaseTimes[] {
    return this.runs.map((c, i) => {
      const dockStart = this.projectStart(c, 'docking', t)
      const dockEnd = dockStart + c.plan.phases.docking
      // console time counts from when it really began; until then it is due once the docking is over
      const consoleStart = c.starts.console ?? Math.max(dockEnd, t)
      const undockStart = c.starts.undocking ?? consoleStart + c.plan.phases.console
      const undockDur = c.plan.phases.undocking
      const undockEnd = undockStart + undockDur
      const outEnd = c.leftRoomAt ?? undockEnd + c.plan.phases.closing + c.plan.phases.emergence + c.plan.phases.out
      return {
        caseIndex: i,
        drapeStart: c.tl.drapeStart,
        drapeEnd: c.tl.drapeEnd,
        dockStart,
        dockEnd,
        undockStart,
        retStart: undockStart + UNDOCK_SPLIT[0] * undockDur,
        undockEnd,
        cleanEnd: outEnd + c.plan.turnoverSeconds,
      }
    })
  }

  /**
   * R5 wave 2: the layout's four ports moved with the table's pose (the published `procedure.patient` of the case in the room: level and supine between
   * cases, so a case without a script keeps the level ports), written into the arms' shared objects in place with the transform the targets and the scene
   * use (tablePose.ts). The table is tipped before docking and level again only after undocking: the script says when, the arms follow.
   */
  private placePorts(): void {
    const v = this.state.procedure
    const on = this.portsCase !== null && v.procedureId !== null && v.caseId === this.portsCase
    setTablePose(this.portPose, on ? v.patient.headTiltDeg : 0, on ? v.patient.rollDeg : 0)
    const level = SURGERY.ports[this.portsLayout]
    for (let i = 0; i < 4; i++) tablePointInto(this.portPose, level[i].x, level[i].y, level[i].z, this.portsNow[i])
  }

  private deriveRobot(t: number, settling: boolean): void {
    if (this.runs.length === 0) return
    const r = this.state.robot
    const seg = segmentAt(t, this.robotTimes(t))
    const c = this.runs[seg.caseIndex]
    // (by case id: a watch case inserted in front of the list moves the indexes, not the phase)
    const key = `${seg.kind}:${c.id}`
    if (key !== this.lastPhaseKey) {
      if (seg.kind === 'draping') for (const a of r.arms) a.exchanges = 0
      this.lastPhaseKey = key
      r.phase = seg.kind
      r.phaseSince = Number.isFinite(seg.since) ? seg.since : 0
      r.version++
      this.state.version++
    }
    const sc = c.proc
    this.portsLayout = c.plan.layout
    this.portsCase = c.id
    this.placePorts()
    applyRobot(r, seg, {
      t,
      layout: c.plan.layout,
      ports: this.portsNow,
      instruments: sc !== null ? sc.arms0 : SURGERY_COPY.procedures[c.plan.procedure].instruments,
      boomYaw: c.plan.boomYaw,
      motionSeed: c.plan.motionSeed,
      consoleStart: c.view.consoleStart,
      exchanges: this.exchangesOf(c),
    })
    // R5: a scripted case's arms hold the script's instruments, and count its exchanges, at every moment (a pure function of the clock, so a
    // warm start is exact; the FSM still decides which arms hold anything)
    if (sc !== null) scriptedArmsInto(r.arms, sc, c.view.consoleStart, c.plan.phases.console, t)
    if (seg.kind === 'docked' || seg.kind === 'undocking') this.stepExchanges(c, t, settling)
  }

  /**
   * The bedside assistant's instrument swaps: at the middle of an arm's withdrawal the instrument changes and the event is logged. (A scripted
   * case's arms are written by `scriptedArmsInto`; here only the count and the log line.)
   */
  private stepExchanges(c: SurgeryCase, t: number, settling: boolean): void {
    const start = c.view.consoleStart
    if (start === null) return
    const arms = this.state.robot.arms
    const ex = this.exchangesOf(c)
    const scripted = c.proc !== null
    // (the replayed ones of a warm start must keep the instruments they swapped in)
    while (c.exDone < ex.length && t >= start + ex[c.exDone].at + EXCHANGE_SECONDS / 2) {
      const e = ex[c.exDone++]
      const arm = arms[e.arm]
      if (!scripted) {
        arm.instrument = e.instrument
        arm.exchanges++
      }
      if (!settling && !this.quiet) {
        this.say('instrumentExchange', surgeryLine('instrumentExchange', { surgeon: staffName('or-surgeon'), arm: e.arm + 1, instrument: e.instrument }), { actorId: 'or-surgeon' })
      }
      this.state.robot.version++
      this.state.version++
    }
  }

  // --- KPIs -----------------------------------------------------------------------------------------------------------------------

  private updateKpis(t: number): void {
    const k = this.kpis
    let done = 0
    let occupied = 0
    let firstIn = Infinity
    let end = -Infinity
    for (const c of this.runs) {
      // (R5: a watch case is not part of the list's numbers)
      if (c.isWatch) continue
      const v = c.view
      if (v.wheelsOut !== null) done++
      if (v.wheelsIn !== null) {
        firstIn = Math.min(firstIn, c.plan.plannedIn)
        occupied += (v.wheelsOut ?? t) - v.wheelsIn
        if (v.wheelsOut !== null) end = Math.max(end, v.wheelsOut + c.plan.turnoverSeconds)
      }
      if (c.plan.index === 0 && v.wheelsIn !== null) k.firstCaseOnTime = v.wheelsIn - c.plan.plannedIn <= 300
      if (v.dockedAt !== null) k.dockingMin = c.plan.phases.docking / 60
      if (v.consoleStart !== null && v.consoleEnd !== null) k.consoleMin = (v.consoleEnd - v.consoleStart) / 60
      if (c.pacuInAt !== null && c.pacuOutAt !== null) k.pacuMin = (c.pacuOutAt - c.pacuInAt) / 60
    }
    k.casesToday = done
    if (Number.isFinite(firstIn) && t > firstIn) {
      const stop = this.runs.every((c) => c.isWatch || c.leftRoomAt !== null) && Number.isFinite(end) ? Math.min(t, end) : t
      k.utilisation = Math.min(1, Math.max(0, occupied / Math.max(1, stop - firstIn)))
    } else k.utilisation = null
  }
}
