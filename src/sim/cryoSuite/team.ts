/**
 * R4: the cryoablation team (CRYO_STAFF without the porter): the interventional radiologist, the CT radiographer and the sedation nurse (R5 wave 3:
 * and the anaesthetist, for the lung and liver cases). They are on level 2 from CONFIG.cryoSuite.teamFromHour to teamToHour, appearing and leaving in
 * the control room (`staff.base`). Each one's place is a pure function of the room's situation (`CryoContext`), so a warm start and a live run agree:
 *
 *   radiologist   talks to the patient at the robot's side in sedation; at the robot station (control room) to plan; pushes each needle through
 *                 the guide; at the cryo console for the freezes and thaws; takes the needles out and dresses the sites; at the control seats
 *                 for every scan
 *   radiographer  helps the patient across at the table's foot, runs the CT from its console seat, wipes the room down in the turnover,
 *                 and does the CT's checks at the table between cases
 *   nurse         gives the sedation at the head end and watches from there (the case borrows her to push the stretcher to recovery)
 *   anaesthetist  R5: idle in the control room unless the case's script has a line for them (the lung and the liver: the head end by the machine)
 *
 * R5 wave 3: while a case with a procedure script is in the room and a step is under the clock, each of the four whose role has a line in the current
 * unit stands where the step says (`ProcRoleView.anchor`, several people at one anchor take its slots in turn), doing the step's action with its tools
 * (the Task's overlay: `act`, `left`, `right`, the work and look points, the step's progress), and wears what the step says (`attire`: mask, gloves,
 * lead apron); a role with no line in the unit keeps the routine above. A case without a script keeps the R4 routine throughout.
 *
 * The case borrows a person (`acquire`) and gives them back; meanwhile their routine is suspended. The ward porter is not here: he exists only
 * during his transfers (index.ts).
 *
 * R5 wave 3: a scripted person's body faces their work point, or, with only a look point, the way the spot faces while the look is within `MAX_LOOK`
 * of it and otherwise just far enough round that it is (`scriptHeading`); a short hop inside the scan room is walked directly (`HopWalker`, hop.ts).
 */
import { CRYO_STAFF } from '@/content/staff'
import type { World } from '../er/world'
import type { Spot } from '../places'
import { ACTION_ANIM, newCursor, newTargetCtx, resolveTarget, type StepCursor, type TargetCtx } from '../procedure'
import { emptyProcedureView } from '../procedure/empty'
import type { CryoStep, ProcAction, ProcAnchor, ProcTarget, ProcedureView, SeatSpec, ToolKind, Vec2, Vec3 } from '../types'
import { Staffer, type Task, type Title } from '../surgery/actors'
import type { SeatRef } from '../surgery/sites'
import { HopWalker, distToSegment, HOP_PEOPLE } from './hop'
import { CRYO_ROLES, roleIndexOf, type CryoCaseScript } from './script'
import type { CryoSites } from './sites'

/** The situation the routine reads, written by the suite (reused, allocation-free). */
export interface CryoContext {
  now: number
  /** The room's step ('idle' when nobody is in the room and no turnover runs). */
  step: CryoStep
  since: number
  until: number | null
  /** The working day is over and nobody is in the room: everybody goes to the control room and leaves. */
  dayOver: boolean
  /**
   * R5 wave 3: the script of the case in the room, when it has one and a step is under the clock (null otherwise: the R4 routine), the step
   * (`cur.index` is the script step), the published view and the targets' context (the table's position, the needle: the work and look points).
   */
  script: CryoCaseScript | null
  cur: StepCursor
  view: ProcedureView
  targets: TargetCtx
}

export function newCryoContext(): CryoContext {
  return { now: 0, step: 'idle', since: 0, until: null, dayOver: false, script: null, cur: newCursor(), view: emptyProcedureView(), targets: newTargetCtx() }
}

type TeamTitle = Extract<Title, 'ir' | 'ctRadiographer' | 'sedation' | 'cryoAnaes'>
const TEAM_TITLES: readonly TeamTitle[] = ['ir', 'ctRadiographer', 'sedation', 'cryoAnaes']
/** Which control-room base spot each one uses. */
// (the nurse and the anaesthetist wait nearest the door: a case may begin at once, and they are the first at the head end)
const BASE_INDEX: Record<TeamTitle, number> = { ir: 2, ctRadiographer: 0, sedation: 1, cryoAnaes: 3 }

interface Want {
  key: string
  spot: Spot
  anim: Task['anim']
  seat?: SeatRef
  /** Fix round 3: a short move that may be walked directly (a hop) though the want has no script action (the radiographer stepping back from the lane). */
  hop?: boolean
  /** R5: the step's overlay (absent: none). */
  act?: ProcAction
  left?: ToolKind
  right?: ToolKind
  work?: Vec3 | null
  look?: Vec3 | null
}

/** Somebody within this distance (m) of the table's foot is where a stretcher on the lane passes: the radiographer there steps back. */
const LANE_REACH = 3

/** How far (m) a person's hands reach from their spot (the crowd renderer's arm with a chest lean). */
export const REACH = 0.95

/** The furthest round (rad) from the body's facing a scripted look may lie: inside the head's 70 degrees (the crowd's `LOOK.maxYaw`), with a little to spare. */
export const MAX_LOOK = (60 * Math.PI) / 180

function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/**
 * The heading a scripted person stands at `at` with: facing the work point when the line has one (the renderer reaches from the front); with only a look
 * point, the spot's own heading (toward the patient) while the look is within `MAX_LOOK` of it, else turned just far enough that it is, so the body
 * ends between the patient and what is looked at and the head reaches the rest (a look 130-170 degrees behind makes the crowd's head-look give up).
 * Neither: the spot's heading. Allocation-free.
 */
export function scriptHeading(spotHeading: number, at: Vec2, work: Vec3 | null, look: Vec3 | null): number {
  if (work !== null) return Math.atan2(work.x - at.x, work.z - at.z)
  if (look === null) return spotHeading
  const want = Math.atan2(look.x - at.x, look.z - at.z)
  const d = wrapPi(want - spotHeading)
  if (d > MAX_LOOK) return want - MAX_LOOK
  if (d < -MAX_LOOK) return want + MAX_LOOK
  return spotHeading
}

/** The world point a person at `from` works at for `target`: the target's point, drawn in to the reach when it lies further. Allocation-free. */
export function workPointInto(target: ProcTarget, from: Vec2, ctx: TargetCtx, out: Vec3): Vec3 {
  resolveTarget(target, ctx, out)
  const dx = out.x - from.x
  const dz = out.z - from.z
  const d = Math.sqrt(dx * dx + dz * dz)
  if (d > REACH) {
    const k = REACH / d
    out.x = from.x + dx * k
    out.z = from.z + dz * k
  }
  return out
}

/** Where one role stands at a step: the anchor's slot (the first person at an anchor takes the first), and the run key's position part. */
export interface Placement {
  anchor: ProcAnchor
  spot: Spot
  slot: number
  /** The control seat the person sits on, or null. */
  seat: SeatRef | null
  where: string
}

export class CryoTeam {
  readonly staffers: Staffer[] = []
  private readonly byTitle = new Map<Title, Staffer>()
  private readonly held = new Map<string, SeatRef>()
  ctx: CryoContext = newCryoContext()
  /** R5: each scripted role's work and look points (one object each, moved every tick by `updatePoints`), the step's progress and where each stands now. */
  private readonly work: Vec3[] = CRYO_ROLES.map(() => ({ x: 0, y: 0, z: 0 }))
  private readonly look: Vec3[] = CRYO_ROLES.map(() => ({ x: 0, y: 0, z: 0 }))
  private readonly progress = (): number => this.ctx.view.progress
  private readonly placed: (Placement | null)[] = CRYO_ROLES.map(() => null)
  private placedFor: CryoCaseScript | null = null
  private placedStep = -1
  /** The walkers that take short hops, by staff id (made with the staffer). */
  private readonly hops = new Map<string, HopWalker>()
  /** Fix round 3: the stretchers that are on the lane now (by owner): while any is, the radiographer stands at `makeWay`, clear of it. */
  private readonly lanes = new Set<string>()
  /** True when `holdLane` changed since the suite last re-placed the team (it then does so at once). */
  laneDirty = false

  constructor(
    readonly world: World,
    readonly sites: CryoSites,
  ) {}

  get present(): boolean {
    return this.staffers.length > 0
  }

  get(title: Title): Staffer | null {
    return this.byTitle.get(title) ?? null
  }

  /** Create the three in the control room (`fadeIn`) or, for a warm start, where their routine puts them. */
  spawn(ctx: CryoContext, warm: boolean): void {
    if (this.staffers.length > 0) return
    for (const member of CRYO_STAFF) {
      if (!TEAM_TITLES.includes(member.title as TeamTitle)) continue
      const title = member.title as TeamTitle
      const spot = this.sites.spots.base[BASE_INDEX[title] % this.sites.spots.base.length]
      const outfit = title === 'ctRadiographer' ? 'role' : 'theatre'
      const hop = new HopWalker(this.world.walkerFor(member.id), (route) => this.hopBlocked(route, member.id))
      this.hops.set(member.id, hop)
      const s = new Staffer(this.world, member, title, spot.at, spot.heading, hop, outfit)
      this.staffers.push(s)
      this.byTitle.set(title, s)
      this.world.hooks.add(s)
      if (!warm) s.fadeIn()
    }
    if (warm) this.settleAll(ctx)
  }

  /** Warm start: everybody not lent out to their place now, at once. */
  settleAll(ctx: CryoContext): void {
    this.ctx = ctx
    for (const s of this.staffers) {
      this.dress(s, ctx)
      if (s.engagedBy !== null) continue
      s.settleTask(this.taskFor(s, this.want(s, ctx)))
    }
  }

  /** Lend a person out for `owner`'s job; null when lent to somebody else or leaving. */
  acquire(title: Title, owner: string): Staffer | null {
    const s = this.byTitle.get(title)
    if (!s || s.gone || s.fadingOut) return null
    if (s.engagedBy !== null && s.engagedBy !== owner) return null
    s.engagedBy = owner
    // (a borrowed person gives up the seat the routine gave them)
    const old = this.held.get(s.staff.id)
    if (old !== undefined) {
      this.sites.release(old, s.staff.id)
      this.held.delete(s.staff.id)
    }
    return s
  }

  /**
   * Fix round 3: a stretcher of `owner` is on the lane through the scan room (or has left it). The radiographer, who stands at the table's foot, which the
   * lane passes, steps back to `spots.makeWay` while any is, and returns to her place after.
   */
  holdLane(owner: string, on: boolean): void {
    if (on === this.lanes.has(owner)) return
    if (on) this.lanes.add(owner)
    else this.lanes.delete(owner)
    this.laneDirty = true
  }

  get laneHeld(): boolean {
    return this.lanes.size > 0
  }

  /** Is `s` where the lane passes (within `LANE_REACH` m of the table's foot, where the radiographer stands)? Somebody at the console or on the other side of the room need not move. */
  private nearLane(s: Staffer): boolean {
    const foot = this.sites.spots.assist.at
    return Math.hypot(s.x - foot.x, s.z - foot.z) < LANE_REACH
  }

  release(title: Title, owner: string): void {
    const s = this.byTitle.get(title)
    if (s && s.engagedBy === owner) s.engagedBy = null
  }

  releaseAll(owner: string): void {
    for (const s of this.staffers) if (s.engagedBy === owner) s.engagedBy = null
  }

  /** Give everyone not lent out the place their routine says (setting the same task again is free). */
  assign(ctx: CryoContext): void {
    this.ctx = ctx
    for (const s of this.staffers) {
      this.dress(s, ctx)
      if (s.engagedBy !== null || s.gone || s.fadingOut) continue
      const w = this.want(s, ctx)
      // (a script task may take a short hop directly; the case's own tasks, the stretcher's pushes, are planned as ever)
      const hop = this.hops.get(s.staff.id)
      if (hop !== undefined) hop.allow = w.act !== undefined || w.hop === true
      s.setTask(this.taskFor(s, w))
      if (hop !== undefined) hop.allow = false
      // R5: at the spot already (the same place, the next step): turn to this step's work point, or the way its look wants the body
      if (w.act !== undefined && w.seat === undefined && s.isAt(w.key)) {
        const d = w.spot.heading - s.walker.heading
        const turn = Math.atan2(Math.sin(d), Math.cos(d))
        if (turn > 0.03 || turn < -0.03) {
          if (w.work != null) s.faceTowards(w.work)
          else s.walker.face(w.spot.heading)
        }
      }
    }
  }

  /** R5: what the team wears at the step under the clock (the script's table); nothing special outside a scripted case. */
  private dress(s: Staffer, ctx: CryoContext): void {
    const r = roleIndexOf(s.title)
    if (r < 0) return
    const sc = ctx.script
    const bits = sc !== null && ctx.cur.index >= 0 ? sc.attire[ctx.cur.index * CRYO_ROLES.length + r] : 0
    if ((s.entity.attire ?? 0) !== bits) s.entity.attire = bits
  }

  /**
   * R5: move the scripted roles' work and look points to the step's targets (every tick: they follow the table and the needle). The eyes go to the
   * work point for a hands-on line (the renderer's rule), to the script's look point otherwise. Allocation-free.
   */
  updatePoints(ctx: CryoContext): void {
    const sc = ctx.script
    if (sc === null || ctx.cur.index < 0) return
    this.place(ctx)
    const lines = sc.steps.cs.roleAt[ctx.cur.index]
    for (let r = 0; r < CRYO_ROLES.length; r++) {
      const line = lines[r]
      const p = this.placed[r]
      if (line === null || p === null) continue
      if (line.work !== null) {
        const at = p.seat !== null ? p.seat.seat : p.spot.at
        workPointInto(line.work, at, ctx.targets, this.work[r])
        const look = this.look[r]
        look.x = this.work[r].x
        look.y = this.work[r].y
        look.z = this.work[r].z
      } else if (line.look !== null) resolveTarget(line.look, ctx.targets, this.look[r])
    }
  }

  /** The places of the roles at the current step (made once per step and case): several people at one anchor take its slots in the roles' order. */
  private place(ctx: CryoContext): void {
    const sc = ctx.script!
    const step = ctx.cur.index
    if (this.placedFor === sc && this.placedStep === step) return
    this.placedFor = sc
    this.placedStep = step
    const lines = sc.steps.cs.roleAt[step]
    for (let r = 0; r < CRYO_ROLES.length; r++) {
      const line = lines[r]
      if (line === null) {
        this.placed[r] = null
        continue
      }
      let slot = 0
      for (let o = 0; o < r; o++) if (lines[o] !== null && lines[o]!.anchor === line.anchor) slot++
      const seat = slot === 0 && line.anchor === 'ctControlScan' ? this.sites.ctConsole : slot === 0 && line.anchor === 'ctControlPlan' ? this.sites.robotStation : null
      this.placed[r] = { anchor: line.anchor, spot: this.sites.anchor(line.anchor as Parameters<CryoSites['anchor']>[0], slot), slot, seat, where: slot > 0 ? `${line.anchor}#${slot}` : line.anchor }
    }
  }

  /** R5 (tests): where role `r` (`CRYO_ROLES` order) stands at the current step, or null. */
  placementOf(r: number): Placement | null {
    return this.placedFor === null ? null : this.placed[r]
  }

  /** R5 (tests): the work point of role `r` now. */
  workOf(r: number): Vec3 {
    return this.work[r]
  }

  /** The day is over and everyone is at their base spot: fade them out. True once all are gone. */
  dismiss(): boolean {
    let allGone = true
    for (const s of this.staffers) {
      if (s.gone) continue
      allGone = false
      if (s.engagedBy === null && s.isAt('base') && !s.fadingOut) s.fadeOut()
    }
    return allGone
  }

  /** Forget everyone (the people were removed by the caller). */
  clear(): void {
    for (const s of this.staffers) this.sites.releaseAll(s.staff.id)
    this.staffers.length = 0
    this.byTitle.clear()
    this.held.clear()
    this.hops.clear()
    this.lanes.clear()
  }

  /** Is anybody else of the team in the way of a hop's route (within two bodies' width)? */
  private hopBlocked(route: readonly Vec2[], selfId: string): boolean {
    for (const o of this.staffers) {
      if (o.staff.id === selfId || o.gone) continue
      for (let i = 1; i < route.length; i++) {
        if (distToSegment(o.x, o.z, route[i - 1].x, route[i - 1].z, route[i].x, route[i].z) < HOP_PEOPLE) return true
      }
    }
    return false
  }

  // --- the routine ----------------------------------------------------------------------------------------------------

  private taskFor(s: Staffer, w: Want): Task {
    const id = s.staff.id
    let seat: SeatSpec | null = null
    const old = this.held.get(id)
    if (w.seat !== undefined) {
      if (this.sites.claim(w.seat, id)) {
        seat = w.seat.seat
        if (old !== undefined && old !== w.seat) this.sites.release(old, id)
        this.held.set(id, w.seat)
      }
    } else if (old !== undefined) {
      this.sites.release(old, id)
      this.held.delete(id)
    }
    const task: Task = { key: w.key, at: seat ? seat.approach : w.spot.at, face: w.spot.heading, anim: w.anim, seat }
    if (w.act !== undefined) {
      task.act = w.act
      task.left = w.left ?? 'none'
      task.right = w.right ?? 'none'
      task.work = w.work ?? null
      task.look = w.look ?? null
      task.progress = this.progress
    } else if (s.task !== null && s.task.key === w.key && s.task.act != null) {
      // (the same place, the step's overlay gone: clear it in place)
      task.act = null
      task.work = null
      task.look = null
    }
    return task
  }

  /**
   * R5: the place and overlay a role's line at the step under the clock gives (null: no line in this unit, or no scripted case: the routine). Keyed by
   * the position (`title@anchor`), so the person walks only when the anchor changes and the pose follows the step in place.
   */
  private scriptWant(s: Staffer, c: CryoContext): Want | null {
    if (c.script === null || c.cur.index < 0) return null
    const r = roleIndexOf(s.title)
    if (r < 0) return null
    const line = c.script.steps.cs.roleAt[c.cur.index][r]
    if (line === null) return null
    this.place(c)
    const p = this.placed[r]
    if (p === null) return null
    const overlay = { act: line.action, left: line.left, right: line.right, work: line.work !== null ? this.work[r] : null, look: line.work !== null || line.look !== null ? this.look[r] : null }
    if (p.seat !== null) return { key: `${s.title}@${p.where}`, spot: { at: p.seat.seat.approach, heading: p.seat.seat.heading }, anim: 'console', seat: p.seat, ...overlay }
    // facing the work point (the renderer reaches from the front); with only a look point, the spot's own way unless the look lies too far round
    const heading = scriptHeading(p.spot.heading, p.spot.at, line.work !== null ? this.work[r] : null, line.work === null && line.look !== null ? this.look[r] : null)
    return { key: `${s.title}@${p.where}`, spot: { at: p.spot.at, heading }, anim: ACTION_ANIM[line.action], ...overlay }
  }

  private seatWant(key: string, ref: SeatRef): Want {
    return { key, spot: { at: ref.seat.approach, heading: ref.seat.heading }, anim: 'console', seat: ref }
  }

  private base(s: Staffer): Want {
    const title = s.title as TeamTitle
    return { key: 'base', spot: this.sites.spots.base[BASE_INDEX[title] % this.sites.spots.base.length], anim: 'idle' }
  }

  private want(s: Staffer, c: CryoContext): Want {
    const sp = this.sites.spots
    if (c.dayOver) return this.base(s)
    // (a stretcher is on the lane, which passes the table's foot where she stands: she steps back)
    if (this.lanes.size > 0 && s.title === 'ctRadiographer' && this.nearLane(s)) return { key: 'rad:way', spot: sp.makeWay, anim: 'idle', hop: true }
    const scripted = this.scriptWant(s, c)
    if (scripted !== null) return scripted
    const step = c.step
    const scan = step === 'planningCt' || step === 'checkCt' || step === 'finalCt'
    switch (s.title) {
      case 'ir':
        switch (step) {
          case 'arrive':
          case 'planning':
            return this.seatWant('ir:station', this.sites.robotStation)
          case 'sedation':
            return { key: 'ir:talk', spot: sp.insert, anim: 'talk' }
          case 'aim':
          case 'needlesOut':
          case 'dressing':
            return { key: 'ir:insert', spot: sp.insert, anim: 'give' }
          case 'freeze1':
          case 'thaw':
          case 'freeze2':
          case 'activeThaw':
            return { key: 'ir:console', spot: sp.atConsole, anim: 'give' }
          case 'idle':
            // between cases: at the robot station, reviewing the next plan
            return this.seatWant('ir:station', this.sites.robotStation)
          default:
            if (scan) return this.seatWant('ir:station', this.sites.robotStation)
            return this.base(s)
        }
      case 'ctRadiographer':
        switch (step) {
          case 'arrive':
          case 'dressing':
            return { key: 'rad:assist', spot: sp.assist, anim: 'give' }
          case 'turnover': {
            const n = sp.clean.length
            const d = c.until !== null ? Math.max(1, c.until - c.since) : 1
            const k = Math.max(0, Math.min(n - 1, Math.floor(((c.now - c.since) / d) * n)))
            return { key: `rad:clean${k}`, spot: sp.clean[k], anim: 'clean' }
          }
          case 'idle':
            // between cases: the CT's daily checks at the table (the scan room is never left empty while the team is on site)
            return { key: 'rad:qa', spot: sp.assist, anim: 'tablet' }
          case 'out':
            return this.base(s)
          default:
            return this.seatWant('rad:ct', this.sites.ctConsole)
        }
      case 'sedation':
        switch (step) {
          case 'arrive':
            return { key: 'nurse:head', spot: sp.sedation, anim: 'idle' }
          case 'sedation':
            return { key: 'nurse:give', spot: sp.sedation, anim: 'give' }
          case 'idle':
          case 'turnover':
          case 'out':
          case 'dressing':
            return this.base(s)
          default:
            return { key: 'nurse:watch', spot: sp.sedation, anim: 'tablet' }
        }
      default:
        return this.base(s)
    }
  }
}
