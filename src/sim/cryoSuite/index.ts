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
 * `step` advances the porter, the cases, then derives the state the scene reads (mutated in place; `version` bumped on a discrete change:
 * the step, the needle, the robot's phase, the gas, the case list), then re-reads the team's routine 4 times a second. The ward porter
 * exists only during his transfers: he appears from lift B and goes back up in it. Nothing here decides anything clinical.
 */
import { CRYO_STAFF } from '@/content/staff'
import { CONFIG } from '../config'
import type { World } from '../er/world'
import type { LiftBank } from '../lifts'
import { LIFTS, type Spot } from '../places'
import { hourAt } from '../population/schedule'
import type { Rng } from '../rng'
import type { CryoCaseView, CryoSuiteState, OpeningKind, SimEventType } from '../types'
import type { Walker } from '../walker'
import { Staffer } from '../surgery/actors'
import { SurgerySites } from '../surgery/sites'
import { CryoCase, type CryoHost } from './case'
import { applyRoom } from './derive'
import { planCase, planCryoDay, type PlannedCryoCase } from './plan'
import type { CryoDemoResult, CryoSuitePort } from './ports'
import { CryoSites } from './sites'
import { CryoTeam, newCryoContext, type CryoContext } from './team'

export { planCryoDay, planCase, cryoTimeline, iceCoverageGap, coverRadius, ROOM_STEPS, SCAN_STEPS, MARGIN_MM, type PlannedCryoCase, type RoomStep, type CryoTimeline } from './plan'
export { applyRoom, iceAt } from './derive'
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
    version: 0,
  }
}

const PORTER = CRYO_STAFF.find((s) => s.title === 'wardPorter')!
/** The porter carries his empty stretcher back up this long at most before a safety net places him. */
const PORTER_LIMIT = 900

type PorterJob = { kind: 'case' } | { kind: 'return'; sub: number; at: number }

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
  private porter: Staffer | null = null
  private porterFade = false
  private porterJob: PorterJob | null = null
  private demos = 0

  constructor(
    readonly world: World,
    readonly rng: Rng,
    readonly walkerFor: (id: string) => Walker,
  ) {
    this.nameRng = rng.fork('names')
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
    this.plan = planCryoDay(this.rng.fork('plan'))
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
    if (this.assignAcc >= 0.25) {
      this.assignAcc = 0
      this.team.assign(this.ctx)
    }
  }

  sync(_alpha: number): void {}

  // --- the presenter's demo -------------------------------------------------------------------------------------------

  startDemo(): CryoDemoResult {
    if (!this.started) return 'noTeam'
    const hour = hourAt(this.t)
    if (hour < this.teamFrom || hour >= CONFIG.cryoSuite.teamToHour || !this.team.present) return 'noTeam'
    if (this.runs.some((c) => c.plan.demo && (c.stage === 'scheduled' || c.inRoom || c.stage === 'toPacu'))) return 'busy'
    const free = this.roomFreeFor(null, this.t)
    this.demos++
    const index = this.runs.length
    const plan = planCase(this.rng.fork(`demo:${this.demos}`), `cryo-demo-${this.demos}`, index, this.t, true)
    const name = this.world.uniqueName(this.nameRng)
    const c = new CryoCase(plan, this, this.rng.fork(plan.id), name)
    this.runs.push(c)
    // (the panel's list in the order of service: the demo before every case still waiting)
    const firstWaiting = this.state.cases.findIndex((v) => v.step === 'scheduled')
    if (firstWaiting < 0) this.state.cases.push(c.view)
    else this.state.cases.splice(firstWaiting, 0, c.view)
    this.state.demoQueued = !free
    this.touch()
    return free ? 'started' : 'queued'
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
    const p = new Staffer(this.world, PORTER, 'wardPorter', spot.at, spot.heading, this.walkerFor(PORTER.id), 'role')
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
    this.porterJob = { kind: 'return', sub: 0, at: t }
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
    switch (job.sub) {
      case 0:
        if (this.lifts !== null && !this.lifts.claimFade('B', 2, p.staff.id)) return
        p.entity.anim = 'push'
        p.setTask({ key: 'porter:back', at: spot.at, face: spot.heading, anim: 'push', walkAnim: 'push', speed: CONFIG.er.wheelSpeed * 1.2 })
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
    if (teamOn) this.team.settleAll(this.ctx)
    this.quiet = false
    this.touch()
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
    let changed = applyRoom(s, active?.plan ?? null, step, since, until, t)
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
    const ctx = this.ctx
    ctx.now = t
    ctx.step = s.step
    ctx.since = s.stepSince
    ctx.until = s.stepEnds
    if (hourAt(t) < CONFIG.cryoSuite.teamToHour) ctx.dayOver = false
  }
}
