/**
 * R5: "Watch step by step" in the robotic theatre (SurgeryPort.startWatch; docs/R5-PROCEDURES.md). A watch case is a whole case of a scripted
 * procedure compressed to the script's watch seconds (10-15 min in the room), booked in front of the day's list:
 *
 *   started    the room is free and no turnover runs: the porter brings the gowned patient in now (they appear on his stretcher in the
 *              theatre hall, SURGERY.watch.stretcherAt; their family member in the lounge), wheels-in after the lead or the robot's drape
 *   queued     a turnover runs: the case starts at its exact end; or (`fromStart`) a case is in the room: the case starts one turnover after
 *              it leaves (booked then, at the realised time)
 *   following  a case is in the room (or on its way in): the view of that case is the one to watch, from its current step
 *   busy       a watch case is already booked or in the room
 *   noTeam     the day has not started, the team is not in, the case (or a day case it pushes back) would still need the team (the
 *              porter's ride to recovery, or a ward patient's to the lift) when it goes home, or the procedure has no script yet
 *
 * The day's cases that have not started yet move later, so each is wheeled in no earlier than the watch case's wheels-out plus its turnover
 * (and the ones after them follow by the plan's own chain); patients already in pre-op simply wait longer. The robot drapes for
 * CONFIG.surgery.watch.drapeSeconds unless it is already draped (a drape under way is taken over and finished at that pace, so it never jumps).
 * After the room the watch case is an ordinary case: recovery and the lounge (scaled), home or the ward. A warm start (a Jump, a long Skip)
 * re-plans the day from the seed and so drops the watch, as the cryo suite's demos are dropped.
 */
import { CONFIG } from '../config'
import { SURGERY } from '../places'
import { hourAt, timeAtHour } from '../population/schedule'
import { compiledFor, watchUnitSeconds } from '../procedure'
import type { Rng } from '../rng'
import type { SurgeryProcedure, WatchResult } from '../types'
import { SurgeryCase, type CaseHost } from './case'
import { planWatchCase, ROOM_PHASES, timelineOf, type PhaseSeconds, type PlannedCase, type Timeline } from './plan'
import type { RobotSegment } from './robot'

/** The porter sets off for the hall this long before the patient is due there. */
const MOVER_LEAD = 60
/** Past this the porter is put at the hall spot (a safety net: `stuck` is told). */
const FETCH_LIMIT = 300
/** Watch cases' plan indexes start here (never 0: the first-case KPI reads index 0). */
const WATCH_INDEX = 1000
/** A case's last job for the team must be done this long before the team goes home (walking makes the real times a little later). */
const HOME_MARGIN = 300

/** When a case last needs the team: a ward patient's porter ride to the lift after recovery, or a day case's ride to recovery. */
function lastTeamJob(plan: PlannedCase, tl: Timeline): number {
  return plan.outcome === 'ward' ? tl.leftAt : tl.pacuIn
}

/** The room phases of a watch case of `procedure`: the script's watch seconds of each unit, or null when it has no script yet. */
export function watchPhasesOf(procedure: SurgeryProcedure): PhaseSeconds | null {
  const cs = compiledFor(`or-${procedure}`)
  if (cs === undefined) return null
  const out = {} as PhaseSeconds
  for (const p of ROOM_PHASES) {
    out[p] = watchUnitSeconds(cs, p)
    if (!(out[p] > 0)) return null
  }
  return out
}

/**
 * The robot's drape window for a watch case booked at `tb` that comes in from `t0`, given the robot's segment at `tb` and the run index
 * `next` the watch case takes (the day case it goes in front of had that index). A drape already done for that case is kept as it is; one
 * under way is finished at the watch pace from where it is (the arms' drape fraction is continuous); otherwise the drape starts at `t0`.
 */
export function watchDrapeWindow(seg: RobotSegment, next: number, tb: number, t0: number): { at: number; seconds: number } {
  const D = CONFIG.surgery.watch.drapeSeconds
  if (seg.caseIndex === next && seg.kind === 'draped' && Number.isFinite(seg.since)) return { at: seg.since - D, seconds: D }
  if (seg.caseIndex === next && seg.kind === 'draping' && seg.until > seg.since) {
    const u0 = Math.min(1, Math.max(0, (tb - seg.since) / (seg.until - seg.since)))
    const end = tb + (1 - u0) * D
    return { at: end - D, seconds: D }
  }
  return { at: t0, seconds: D }
}

/** A case in the room, or on its way in (the porter fetching the patient, the stretcher rolling in). */
export function caseInTheatre(runs: readonly SurgeryCase[]): SurgeryCase | null {
  for (const c of runs) if (c.inRoom || c.stage === 'fetch' || c.stage === 'toTheatre') return c
  return null
}

/** A day case that has not begun its theatre part yet (it may move later). */
export function notStarted(c: SurgeryCase): boolean {
  return c.leftRoomAt === null && !c.inRoom && c.stage !== 'fetch' && c.stage !== 'toTheatre' && c.stage !== 'done'
}

// ---------------------------------------------------------------------------------------------------------------------
// The watch case
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A watch case: no arrival, no lift, no pre-op. At `arriveAt` (t0) the gowned patient fades in on the porter's stretcher in the theatre hall
 * (the porter sets off a minute before; with the porter away, the pre-op or the recovery nurse pushes; with nobody free at all, the patient is
 * put straight on the table when the room is ready), their family member fades in in the lounge, and the case goes on as any other.
 */
export class WatchCase extends SurgeryCase {
  private fetchAt = 0

  constructor(plan: PlannedCase, host: CaseHost, rng: Rng, names: { patient: string; companion: string }) {
    super(plan, host, rng, names)
    this.view.watch = true
  }

  override step(t: number, dt: number): void {
    if (this.stage === 'scheduled') this.stepArrive(t)
    else super.step(t, dt)
  }

  /** (Never warmed: a warm start re-plans the day and drops the watch case.) */
  override warm(_t: number): void {}

  private fetchKey(): string {
    return `${this.id}:watchFetch`
  }

  private stepArrive(t: number): void {
    const h = this.host
    const hall = SURGERY.watch.stretcherAt
    const t0 = this.arriveAt
    if (this.porter === null) {
      if (t < t0 - MOVER_LEAD) return
      const m = this.acquireMover()
      if (m === null) {
        if (t >= this.nominalIn - 1 && h.roomFree(this)) this.straightOntoTable(t)
        return
      }
      this.porter = m
      this.fetchAt = t
      m.setVehicle('stretcher')
      m.setTask({ key: this.fetchKey(), at: hall.at, face: hall.heading, anim: 'push', walkAnim: 'push', speed: CONFIG.er.wheelSpeed * 1.2 })
      return
    }
    const m = this.porter
    if (!m.isAt(this.fetchKey())) {
      if (t - this.fetchAt > FETCH_LIMIT) {
        h.stuck(`${this.id}: the stretcher did not reach the theatre hall in ${FETCH_LIMIT} s`)
        m.placeAt(hall.at.x, hall.at.z, hall.heading)
        this.fetchAt = t
      }
      return
    }
    if (t < t0) return
    // the patient appears on the stretcher, gowned; their family member in the lounge
    const { patient, companion } = this.newPeople(hall.at, hall.heading, false)
    patient.entity.outfit = 'gown'
    patient.placeAt(m.x, m.z, m.walker.heading)
    patient.startRiding(m, 'stretcher')
    h.world.attach(m, patient)
    patient.fadeIn()
    this.placeInLounge(companion)
    companion.fadeIn()
    const a = this.tableApproach()
    m.entity.anim = 'push'
    m.setTask({ key: `${this.id}:toOr`, at: a.at, face: a.face, anim: 'push', walkAnim: 'push', speed: CONFIG.er.wheelSpeed })
    this.enter('toTheatre', t)
  }

  /** Nobody to push a stretcher: the patient is on the table when the room is ready (fading in there). */
  private straightOntoTable(t: number): void {
    const h = this.host
    const table = h.sites.table
    const { patient, companion } = this.newPeople(table.seat.approach, 0, false)
    patient.entity.outfit = 'gown'
    h.sites.claim(table, patient.entity.id)
    patient.placeOnSeat(table.seat)
    patient.fadeIn()
    this.placeInLounge(companion)
    companion.fadeIn()
    this.starts.in = t
    this.view.wheelsIn = t
    this.enterRoom('in', t)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The booking desk
// ---------------------------------------------------------------------------------------------------------------------

/** What the desk needs from the suite. */
export interface WatchHost extends CaseHost {
  readonly rng: Rng
  readonly runs: readonly SurgeryCase[]
  readonly teamFrom: number
  readonly isStarted: boolean
  readonly now: number
  /** The robot's segment at `t` with today's cases as they stand. */
  robotSegmentAt(t: number): RobotSegment
  /** A case's wheels-out: realised, or projected from what is known at `t`. */
  projectOut(c: SurgeryCase, t: number): number
  /** Names for a watch case's patient and family member (drawn from `rng`, never one held today). */
  watchNames(procedure: SurgeryProcedure, rng: Rng): { patient: string; companion: string }
  /** Put a new case into today's runs (and the panel's list) at `index`, ready to step. */
  insertCase(c: SurgeryCase, index: number): void
}

export class WatchDesk {
  /** Watch cases booked so far today (their ids and forks are numbered by it; a warm start keeps counting). */
  private n = 0
  /** The latest watch case (booked, in the room, or after it). */
  current: WatchCase | null = null
  /** A watch booked to follow the case in the room (`fromStart`): it is planned when that case leaves the room. */
  pending: { procedure: SurgeryProcedure; after: SurgeryCase } | null = null

  constructor(private readonly host: WatchHost) {}

  /** A warm start: the day is re-planned from the seed, without the watch. */
  reset(): void {
    this.current = null
    this.pending = null
  }

  /** A watch case is booked and not started, or in the room. */
  get booked(): boolean {
    if (this.pending !== null) return true
    const c = this.current
    return c !== null && (c.stage === 'scheduled' || c.stage === 'toTheatre' || c.inRoom)
  }

  /** When the booked watch case's patient appears in the hall (sim seconds), or null. */
  startsAt(t: number): number | null {
    const p = this.pending
    if (p !== null) return this.host.projectOut(p.after, t) + p.after.plan.turnoverSeconds
    const c = this.current
    return c !== null && c.stage === 'scheduled' ? c.arriveAt : null
  }

  start(procedure: SurgeryProcedure, fromStart: boolean): WatchResult {
    const h = this.host
    const t = h.now
    if (!h.isStarted) return 'noTeam'
    const hour = hourAt(t)
    if (hour < h.teamFrom || hour >= CONFIG.surgery.teamToHour || !h.team.present) return 'noTeam'
    const phases = watchPhasesOf(procedure)
    if (phases === null) return 'noTeam'
    if (this.booked) return 'busy'
    const busy = caseInTheatre(h.runs)
    if (busy !== null) {
      if (!fromStart) return 'following'
      const t0 = h.projectOut(busy, t) + busy.plan.turnoverSeconds
      if (this.plan(procedure, phases, t0, t, this.n + 1) === null) return 'noTeam'
      this.pending = { procedure, after: busy }
      h.touch()
      return 'queued'
    }
    // a turnover running: at its exact end
    let turnoverEnd: number | null = null
    for (const c of h.runs) if (c.leftRoomAt !== null && t < c.leftRoomAt + c.plan.turnoverSeconds) turnoverEnd = c.leftRoomAt + c.plan.turnoverSeconds
    const booked = this.book(procedure, phases, turnoverEnd ?? t, t)
    if (booked === null) return 'noTeam'
    return turnoverEnd !== null ? 'queued' : 'started'
  }

  /** Each tick: a pending watch is booked once the case it follows has left the room; the day cases after the watch keep their distance. */
  step(t: number): void {
    const p = this.pending
    if (p !== null && p.after.leftRoomAt !== null) {
      this.pending = null
      const phases = watchPhasesOf(p.procedure)
      if (phases !== null) this.book(p.procedure, phases, p.after.leftRoomAt + p.after.plan.turnoverSeconds, t)
      this.host.touch()
    }
    this.reflow(t)
  }

  /** The run index a new case goes in at: in front of the first day case not started yet. */
  private slot(): number {
    const runs = this.host.runs
    for (let i = 0; i < runs.length; i++) if (notStarted(runs[i])) return i
    return runs.length
  }

  /**
   * The watch plan for a case from `t0` booked at `tb`; null when it, or a day case it pushes back, would not be out of the room before the
   * team goes home (the watch case with its turnover).
   */
  private plan(procedure: SurgeryProcedure, phases: PhaseSeconds, t0: number, tb: number, n: number): PlannedCase | null {
    const h = this.host
    const slot = this.slot()
    const drape = watchDrapeWindow(h.robotSegmentAt(tb), slot, tb, t0)
    const plan = planWatchCase(h.rng.fork(`watch:${n}`), { id: `sx-w${n}`, index: WATCH_INDEX + n, procedure, t0, phases, drapeAt: drape.at, drapeSeconds: drape.seconds })
    const home = timeAtHour(CONFIG.surgery.teamToHour) - HOME_MARGIN
    let freeAt = plan.nominalIn + plan.roomSeconds + plan.turnoverSeconds
    if (freeAt > home || lastTeamJob(plan, timelineOf(plan)) > home) return null
    const runs = h.runs
    for (let j = slot; j < runs.length; j++) {
      const c = runs[j]
      if (!notStarted(c)) continue
      const wheelsIn = Math.max(c.nominalIn, freeAt)
      // (only a case this watch pushes back: one already planned to finish late is the day's own business)
      if (wheelsIn > c.nominalIn + 1 && lastTeamJob(c.plan, timelineOf(c.plan, c.shift + wheelsIn - c.nominalIn)) > home) return null
      freeAt = wheelsIn + c.plan.roomSeconds + c.plan.turnoverSeconds
    }
    return plan
  }

  private book(procedure: SurgeryProcedure, phases: PhaseSeconds, t0: number, tb: number): WatchCase | null {
    const h = this.host
    const n = this.n + 1
    const plan = this.plan(procedure, phases, t0, tb, n)
    if (plan === null) return null
    this.n = n
    const c = new WatchCase(plan, h, h.rng.fork(plan.id), h.watchNames(procedure, h.rng.fork(`watch:${n}:names`)))
    h.insertCase(c, this.slot())
    this.current = c
    this.reflow(tb)
    return c
  }

  /**
   * The day cases after the watch case that have not started move later, each no earlier than the one before it is out plus its turnover
   * (the watch case's wheels-out projected from what is known now). Never earlier; moves under a second are left (the stretcher waits for the
   * room anyway).
   */
  private reflow(t: number): void {
    const w = this.current
    if (w === null || w.stage === 'done') return
    const h = this.host
    const runs = h.runs
    const i = runs.indexOf(w)
    if (i < 0) return
    let freeAt = h.projectOut(w, t) + w.plan.turnoverSeconds
    for (let j = i + 1; j < runs.length; j++) {
      const c = runs[j]
      if (!notStarted(c)) continue
      const need = freeAt - c.nominalIn
      if (need > 1) c.shiftBy(need)
      freeAt = c.nominalIn + c.plan.roomSeconds + c.plan.turnoverSeconds
    }
  }
}
