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
 *
 * `step` advances the cases, then derives the theatre state, the robot, the bays and the KPIs the scene reads (mutated in place, `version`
 * bumped on change), then re-reads the team's routine a few times a second. The people change level only by riding the lifts (src/sim/lifts).
 * Nothing here decides anything clinical: every duration and outcome is a seeded draw.
 */
import { staffName } from '@/content/staff'
import { surgeryLine, SURGERY_COPY } from '@/content/surgery'
import { CONFIG } from '../config'
import type { World } from '../er/world'
import type { LiftBank } from '../lifts'
import { hourAt, timeAtHour } from '../population/schedule'
import { LIFTS, PACU, PREOP, SURGERY } from '../places'
import type { Rng } from '../rng'
import type {
  CasePhase,
  OpeningKind,
  RobotArmState,
  SimEventType,
  SurgeryBayState,
  SurgeryCaseView,
  SurgeryState,
  TheatreKpis,
} from '../types'
import type { Walker } from '../walker'
import type { Staffer } from './actors'
import { SurgeryCase, type CaseHost } from './case'
import { planDay, ROOM_PHASES, timelineOf, type PlannedCase, type RoomPhase } from './plan'
import type { SurgeryPort } from './ports'
import { applyRobot, EXCHANGE_SECONDS, segmentAt, UNDOCK_SPLIT, type RobotCaseTimes } from './robot'
import { SurgerySites } from './sites'
import { newOrContext, SCRUB_NURSE_LEAD, Team, type OrContext } from './team'

export { planDay, timelineOf, ROOM_PHASES, type PlannedCase, type Timeline, type RoomPhase } from './plan'
export { cartPose, cartPath, applyRobot, segmentAt, forceAt, DOCK_SPLIT, UNDOCK_SPLIT, type CartPose, type RobotSegment } from './robot'
export { SurgerySites } from './sites'
export { SurgeryCase, casePhaseOf, type Stage } from './case'

/** The team is on level 2 this long before the scrub nurse's lead ahead of the first case's drape. */
const TEAM_EARLY_SECONDS = 600

/** A porter who went up with a ward patient comes back this way. */
interface Away {
  porter: Staffer
  returnAt: number
  state: 'away' | 'back'
}

export class Surgery implements SurgeryPort, CaseHost {
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
  private readonly names: { patient: string; companion: string }[] = []
  /** Per case: how many planned exchanges have been done. */
  private exDone: number[] = []
  private lastPhaseKey = ''
  private kpis: TheatreKpis

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
      version: 0,
    }
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
    for (let i = 0; i < this.plan.length; i++) this.names.push({ patient: this.world.uniqueName(this.nameRng), companion: this.world.uniqueName(this.nameRng) })
    this.settle(t0)
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
    for (const c of this.runs) c.step(t, dt)
    this.derive(t, dt)
    this.assignAcc += dt
    if (this.assignAcc >= 0.25) {
      this.assignAcc = 0
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
    }
    // (removing the people of an earlier settle freed their names: hold them again for the cases still to come)
    for (const n of this.names) {
      this.world.claimName(n.patient)
      this.world.claimName(n.companion)
    }
    this.runs = this.plan.map((p, i) => new SurgeryCase(p, this, this.rng.fork(p.id), this.names[i]))
    this.state.theatre.cases.length = 0
    for (const c of this.runs) this.state.theatre.cases.push(c.view)
    this.exDone = this.runs.map(() => 0)
    const hour = hourAt(t)
    const teamOn = hour >= this.teamFrom && hour < CONFIG.surgery.teamToHour
    this.ctx.now = t
    if (teamOn) this.team.spawn(this.ctx, true)
    for (const c of this.runs) c.warm(t)
    // finished cases have nobody left in the building: free their names, and keep their numbers
    this.runs.forEach((c, i) => {
      if (c.stage === 'done') {
        this.world.releaseName(this.names[i].patient)
        this.world.releaseName(this.names[i].companion)
        this.recordFinished(c)
      }
    })
    // the robot first (the team's routine reads its phase), then the situation, then everybody to their place
    this.lastPhaseKey = ''
    this.deriveRobot(t, true)
    this.updateContext(t)
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
    if (c.plan.index === 0) this.kpis.firstCaseOnTime = c.plan.nominalIn - c.plan.plannedIn <= 300
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

  porterAway(porter: Staffer, returnAt: number, _shaft: 'B'): void {
    porter.engagedBy = 'away'
    this.away.push({ porter, returnAt, state: 'away' })
  }

  caseFinished(c: SurgeryCase, _t: number): void {
    const i = this.runs.indexOf(c)
    if (i >= 0) {
      this.world.releaseName(this.names[i].patient)
      this.world.releaseName(this.names[i].companion)
    }
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
    this.updateContext(t)
    this.deriveRobot(t, false)
    this.deriveTheatre(t)
    this.kpiAcc += dt
    if (this.kpiAcc >= 1) {
      this.kpiAcc = 0
      this.updateKpis(t)
    }
    for (const c of this.runs) {
      if (c.leftRoomAt !== null && !c.turnoverReported && t >= c.leftRoomAt + c.plan.turnoverSeconds) {
        c.turnoverReported = true
        this.kpis.turnoverMin = c.plan.turnoverSeconds / 60
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
      ctx.untilNext = c.stage === 'toTheatre' ? 0 : Math.max(0, c.plan.nominalIn - t)
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
  }

  private exchangeActive(t: number): boolean {
    const c = this.activeCase()
    if (c === null || c.stage !== 'console' || c.view.consoleStart === null) return false
    const since = t - c.view.consoleStart
    for (const e of c.plan.exchanges) if (since >= e.at && since < e.at + EXCHANGE_SECONDS) return true
    return false
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
      const base = Math.max(c.plan.nominalIn, t)
      return base + (c.tl.phaseStart[p] - c.plan.nominalIn)
    }
    let at = c.starts[ROOM_PHASES[from]]!
    for (let i = from; i < idx; i++) at += c.plan.phases[ROOM_PHASES[i]]
    return at
  }

  private robotTimes(t: number): RobotCaseTimes[] {
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

  private deriveRobot(t: number, settling: boolean): void {
    if (this.runs.length === 0) return
    const r = this.state.robot
    const seg = segmentAt(t, this.robotTimes(t))
    const c = this.runs[seg.caseIndex]
    const key = `${seg.kind}:${seg.caseIndex}`
    if (key !== this.lastPhaseKey) {
      if (seg.kind === 'draping') for (const a of r.arms) a.exchanges = 0
      this.lastPhaseKey = key
      r.phase = seg.kind
      r.phaseSince = Number.isFinite(seg.since) ? seg.since : 0
      r.version++
      this.state.version++
    }
    const copy = SURGERY_COPY.procedures[c.plan.procedure]
    applyRobot(r, seg, {
      t,
      layout: c.plan.layout,
      instruments: copy.instruments,
      boomYaw: c.plan.boomYaw,
      motionSeed: c.plan.motionSeed,
      consoleStart: c.view.consoleStart,
      exchanges: c.plan.exchanges,
    })
    if (seg.kind === 'docked' || seg.kind === 'undocking') this.stepExchanges(c, seg.caseIndex, t, settling)
  }

  /** The bedside assistant's instrument swaps: at the middle of an arm's withdrawal the instrument changes and the event is logged. */
  private stepExchanges(c: SurgeryCase, index: number, t: number, settling: boolean): void {
    const start = c.view.consoleStart
    if (start === null) return
    const arms = this.state.robot.arms
    const ex = c.plan.exchanges
    // (the replayed ones of a warm start must keep the instruments they swapped in)
    while (this.exDone[index] < ex.length && t >= start + ex[this.exDone[index]].at + EXCHANGE_SECONDS / 2) {
      const e = ex[this.exDone[index]++]
      const arm = arms[e.arm]
      arm.instrument = e.instrument
      arm.exchanges++
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
      const stop = this.runs.every((c) => c.leftRoomAt !== null) && Number.isFinite(end) ? Math.min(t, end) : t
      k.utilisation = Math.min(1, Math.max(0, occupied / Math.max(1, stop - firstIn)))
    } else k.utilisation = null
  }
}
