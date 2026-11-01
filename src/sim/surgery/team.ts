/**
 * R2: the theatre team (THEATRE_STAFF, nine people). They are on level 2 from CONFIG.surgery.teamFromHour to teamToHour. Between cases they wait
 * in the staff room (a seat, or a place round THEATRE_BASE); each has a routine that is a pure function of the theatre's situation (`OrContext`):
 *
 *   scrub in      the surgeon and the bedside assistant scrub at the sinks in the hall about six minutes before wheels-in; the scrub nurse a
 *                 little earlier, then drapes the robot's arms; the circulator is at her desk, the anaesthetist at the head of the table
 *   in the room   each at their place by the table, the surgeon at the console in the console phase and the anaesthetist on his stool
 *   turnover      the cleaner works the room, the scrub nurse takes the drapes off the cart, the circulator at her desk
 *
 * R5: while a case with a procedure script is in the room, each of the five whose role has a line in the current unit stands where the step
 * says (`ProcRoleView.anchor`), doing the step's action with its tools (the Task's R5 overlay: `act`, `left`, `right`, the work and look points,
 * the step's progress), and wears what the step says (`attire`); a role with no line in the unit keeps its R2 routine. A case without a script
 * keeps the R2 routine throughout.
 *
 * The case (case.ts) borrows a person for a job (`acquire`: the pre-op nurse leading the patient, a porter with the stretcher, a doctor's pre-op
 * visit) and gives them back; while they are lent out their routine is suspended. Everything is deterministic: the same situation gives the same
 * places.
 */
import { THEATRE_STAFF } from '@/content/staff'
import type { World } from '../er/world'
import { SURGERY, type Spot } from '../places'
import { ACTION_ANIM, emptyProcedureView, newCursor, newTargetCtx, resolveTarget, type StepCursor, type TargetCtx } from '../procedure'
import type { Rng } from '../rng'
import type { CasePhase, ProcAction, ProcedureView, RobotPhase, SeatSpec, ToolKind, Vec3 } from '../types'
import { Staffer, type Task, type Title } from './actors'
import { DRAPE_OFF_SECONDS } from './robot'
import { OR_ROLES, placeRoles, roleIndexOf, workPointInto, type CartPoseLike, type CaseScript, type Placement } from './script'
import type { SeatRef, SurgerySites } from './sites'

/** Seconds before wheels-in at which each part of the routine begins. */
export const SCRUB_LEAD = 360
export const SCRUB_NURSE_LEAD = 780
export const CIRCULATOR_LEAD = 720
export const ANAES_LEAD = 600
/** The idle porter stays at one sterile-supply spot this long (seconds) before the next. */
export const STERILE_DWELL = 75

/** The situation the team's routine reads. Written by Surgery; allocation-free to reuse. */
export interface OrContext {
  now: number
  /** The theatre's phase: a room phase of the case in the room, 'toTheatre', 'turnover' or 'idle'. */
  phase: CasePhase | 'idle' | 'turnover'
  /** A case is in the room, wheels-in to wheels-out. */
  inRoom: boolean
  /** Seconds until the next case's wheels-in (Infinity: none left today). */
  untilNext: number
  robot: RobotPhase
  robotSince: number
  /** A bedside instrument exchange is under way. */
  exchanging: boolean
  /** The turnover's start, and its length, while one runs. */
  turnoverSince: number | null
  turnoverSeconds: number
  /** The recovery bed whose nurse is busiest (the longest-held), or -1. */
  pacuFocus: number
  /** The working day is over: everybody goes to the staff room and leaves. */
  dayOver: boolean
  /**
   * R5: the script of the case in the room, when it has one and a step is under the clock (null otherwise: the R2 routine), the step
   * (`cur.index` is the script step), the published view and the table's tilt and the cart for the work and look points.
   */
  script: CaseScript | null
  cur: StepCursor
  view: ProcedureView
  targets: TargetCtx
  /** The robot cart as it stands now (its handle is a work point while it is deployed and driven). */
  cart: CartPoseLike
  /** The docking phase is over and the console phase waits for the surgeon on the console seat. */
  consoleDue: boolean
}

export function newOrContext(): OrContext {
  return {
    now: 0,
    phase: 'idle',
    inRoom: false,
    untilNext: Infinity,
    robot: 'stowed',
    robotSince: 0,
    exchanging: false,
    turnoverSince: null,
    turnoverSeconds: 0,
    pacuFocus: -1,
    dayOver: false,
    script: null,
    cur: newCursor(),
    view: emptyProcedureView(),
    targets: newTargetCtx(),
    cart: { x: SURGERY.cart.park.at.x, z: SURGERY.cart.park.at.z, heading: SURGERY.cart.park.heading },
    consoleDue: false,
  }
}

const OR_TEAM: readonly Title[] = ['surgeon', 'assistant', 'anaesthetist', 'scrub', 'circulator']

interface Want {
  key: string
  spot: Spot
  anim: Task['anim']
  seat?: SeatRef
  /** R5: the step's overlay (absent: none). */
  act?: ProcAction
  left?: ToolKind
  right?: ToolKind
  work?: Vec3 | null
  look?: Vec3 | null
}

export class Team {
  readonly staffers: Staffer[] = []
  private readonly byTitle = new Map<Title, Staffer>()
  private readonly baseSeat = new Map<string, SeatSpec>()
  private readonly baseSpot = new Map<string, Spot>()
  private readonly held = new Map<string, SeatRef>()
  ctx: OrContext = newOrContext()
  /** R5: each scripted role's work and look points (one object each, moved every tick by `updatePoints`) and the step's progress. */
  private readonly work: Vec3[] = OR_ROLES.map(() => ({ x: 0, y: 0, z: 0 }))
  private readonly look: Vec3[] = OR_ROLES.map(() => ({ x: 0, y: 0, z: 0 }))
  private readonly progress = (): number => this.ctx.view.progress
  /** R5: where each role stands at the current step (`placeRoles`), made once per step. */
  private readonly placed: (Placement | null)[] = OR_ROLES.map(() => null)
  private placedFor: CaseScript | null = null
  private placedStep = -1
  private placedLayout = ''

  constructor(
    readonly world: World,
    readonly sites: SurgerySites,
    readonly rng: Rng,
  ) {}

  get(title: Title): Staffer {
    const s = this.byTitle.get(title)
    if (!s) throw new Error(`No theatre staff ${title}`)
    return s
  }

  get present(): boolean {
    return this.staffers.length > 0
  }

  /** Create the nine, at their staff-room places (`fadeIn`) or, for a warm start, where their routine puts them. */
  spawn(ctx: OrContext, warm: boolean): void {
    if (this.staffers.length > 0) return
    THEATRE_STAFF.forEach((member, i) => {
      const spot = this.sites.spots.base[i % this.sites.spots.base.length]
      const outfit = OR_TEAM.includes(member.title) ? 'theatre' : 'role'
      const s = new Staffer(this.world, member, member.title, spot.at, spot.heading, this.world.walkerFor(member.id), outfit)
      this.staffers.push(s)
      this.byTitle.set(member.title, s)
      this.baseSpot.set(member.id, spot)
      // the first six sit in the staff room (the building's `lounge:l2Staff` seats, when it has them)
      const seat = this.sites.claimStaffRoom(member.id, spot.at)
      if (seat !== null) this.baseSeat.set(member.id, seat)
      this.world.hooks.add(s)
      if (!warm) s.fadeIn()
    })
    if (warm) this.settleAll(ctx)
  }

  /** Warm start: everybody not lent out goes to the place their routine gives them now, at once. */
  settleAll(ctx: OrContext): void {
    this.ctx = ctx
    for (const s of this.staffers) {
      this.dress(s, ctx)
      if (s.engagedBy !== null) continue
      const task = this.taskFor(s, this.want(s, ctx))
      s.settleTask(task)
    }
  }

  /** Lend a person out for `owner`'s job; null when they are already lent out, or are an OR-team member while a case is in the room. */
  acquire(title: Title, owner: string): Staffer | null {
    const s = this.byTitle.get(title)
    if (!s || s.gone || s.fadingOut) return null
    if (s.engagedBy !== null && s.engagedBy !== owner) return null
    if (OR_TEAM.includes(title) && (this.ctx.inRoom || this.ctx.phase === 'toTheatre')) return null
    s.engagedBy = owner
    return s
  }

  release(title: Title, owner: string): void {
    const s = this.byTitle.get(title)
    if (s && s.engagedBy === owner) s.engagedBy = null
  }

  /** Let go of everybody `owner` has lent out. */
  releaseAll(owner: string): void {
    for (const s of this.staffers) if (s.engagedBy === owner) s.engagedBy = null
  }

  /** Give everyone not lent out the place their routine says (call a few times a second; setting the same task again is free). */
  assign(ctx: OrContext): void {
    this.ctx = ctx
    for (const s of this.staffers) {
      this.dress(s, ctx)
      if (s.engagedBy !== null || s.gone || s.fadingOut) continue
      const w = this.want(s, ctx)
      s.setTask(this.taskFor(s, w))
      // R5: at the spot already (the same place, the next step): turn to this step's work point
      if (w.act !== undefined && w.work != null && w.seat === undefined && s.isAt(w.key)) {
        const d = w.spot.heading - s.walker.heading
        const turn = Math.atan2(Math.sin(d), Math.cos(d))
        if (turn > 0.03 || turn < -0.03) s.faceTowards(w.work)
      }
    }
  }

  /** R5: what the OR team wears at the step under the clock (the script's table); nothing special outside a scripted case. */
  private dress(s: Staffer, ctx: OrContext): void {
    const r = roleIndexOf(s.title)
    if (r < 0) return
    const sc = ctx.inRoom ? ctx.script : null
    const bits = sc !== null && ctx.cur.index >= 0 ? sc.attire[ctx.cur.index * OR_ROLES.length + r] : 0
    if ((s.entity.attire ?? 0) !== bits) s.entity.attire = bits
  }

  /**
   * R5: move the scripted roles' work and look points to the step's targets (every tick: they follow the table's tilt and the cart). The eyes
   * go to the work point for a hands-on line (the renderer's rule), to the script's look point otherwise. Allocation-free.
   */
  updatePoints(ctx: OrContext): void {
    const sc = ctx.script
    if (sc === null || ctx.cur.index < 0) return
    this.place(ctx)
    const lines = sc.steps.cs.roleAt[ctx.cur.index]
    for (let r = 0; r < OR_ROLES.length; r++) {
      const line = lines[r]
      const p = this.placed[r]
      if (line === null || p === null) continue
      if (line.work !== null) {
        workPointInto(line.work, p.at, p.heading, ctx.targets, ctx.cart, this.work[r])
        const look = this.look[r]
        look.x = this.work[r].x
        look.y = this.work[r].y
        look.z = this.work[r].z
      } else if (line.look !== null) resolveTarget(line.look, ctx.targets, this.look[r])
    }
  }

  /** The places of the roles at the current step (made once per step and case). */
  private place(ctx: OrContext): void {
    const sc = ctx.script!
    const step = ctx.cur.index
    if (this.placedFor === sc && this.placedStep === step && this.placedLayout === ctx.targets.layout) return
    this.placedFor = sc
    this.placedStep = step
    this.placedLayout = ctx.targets.layout
    placeRoles(sc.steps.cs, step, (a) => this.sites.anchor(a), ctx.targets.layout, this.placed)
  }

  /** R5 (tests): where role `r` (`OR_ROLES` order) stands at the current step, or null. */
  placementOf(r: number): Placement | null {
    return this.placedFor === null ? null : this.placed[r]
  }

  /** The working day is over and everyone is at their staff-room place: fade them out. Returns true once all are gone. */
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
    this.baseSeat.clear()
    this.baseSpot.clear()
    this.held.clear()
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
    if (w.key === 'base') {
      const bs = this.baseSeat.get(id)
      if (bs) seat = bs
    }
    const task: Task = {
      key: w.key,
      at: seat ? seat.approach : w.spot.at,
      face: w.spot.heading,
      anim: w.anim,
      seat,
    }
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
   * R5: the place and overlay a role's line at the step under the clock gives (null: no line in this unit, or no scripted case: the routine).
   * Keyed by the position (`title@anchor`), so the person walks only when the anchor changes and the pose follows the step in place; the
   * surgeon's console keeps the R2 key `surgeon:console` (Surgery.surgeonSeated reads it).
   */
  private scriptWant(s: Staffer, c: OrContext): Want | null {
    if (!c.inRoom || c.script === null || c.cur.index < 0) return null
    const r = roleIndexOf(s.title)
    if (r < 0) return null
    const line = c.script.steps.cs.roleAt[c.cur.index][r]
    if (line === null) return null
    // (the docking is over and the console waits for the surgeon: whatever the script has them do, they go and sit at it)
    if (s.title === 'surgeon' && c.consoleDue && line.anchor !== 'surgeonConsole') return this.consoleWant()
    const overlay = { act: line.action, left: line.left, right: line.right, work: line.work !== null ? this.work[r] : null, look: line.work !== null || line.look !== null ? this.look[r] : null }
    if (line.anchor === 'surgeonConsole' && s.title === 'surgeon') return { ...this.consoleWant(), ...overlay }
    if (line.anchor === 'anaesStool') {
      const st = this.sites.anaesStool
      return { key: `${s.title}@anaesStool`, spot: { at: st.seat.approach, heading: st.seat.heading }, anim: 'sit', seat: st, ...overlay }
    }
    this.place(c)
    const p = this.placed[r]
    const at = p !== null ? p.at : this.sites.anchor(line.anchor).at
    // facing the work point (the renderer reaches from the front), else the spot's own way
    const w = this.work[r]
    const heading = line.work !== null ? Math.atan2(w.x - at.x, w.z - at.z) : (p?.heading ?? this.sites.anchor(line.anchor).heading)
    return { key: `${s.title}@${p !== null ? p.where : line.anchor}`, spot: { at, heading }, anim: ACTION_ANIM[line.action], ...overlay }
  }

  /** The surgeon at the console: on its seat, anim 'console'. */
  private consoleWant(): Want {
    const ref = this.sites.surgeonConsole
    return { key: 'surgeon:console', spot: { at: ref.seat.approach, heading: ref.seat.heading }, anim: 'console', seat: ref }
  }

  private base(s: Staffer): Want {
    const spot = this.baseSpot.get(s.staff.id) ?? this.sites.spots.base[0]
    return { key: 'base', spot, anim: 'idle' }
  }

  private want(s: Staffer, c: OrContext): Want {
    const sp = this.sites.spots
    if (c.dayOver) return this.base(s)
    const scripted = this.scriptWant(s, c)
    if (scripted !== null) return scripted
    const m = c.untilNext
    const room = c.inRoom
    switch (s.title) {
      case 'surgeon':
        if (room) {
          switch (c.phase) {
            case 'in':
            case 'induction':
              return { key: 'surgeon:table', spot: sp.tableSurgeon, anim: 'idle' }
            case 'positioning':
            case 'ports':
              return { key: 'surgeon:table-work', spot: sp.tableSurgeon, anim: 'give' }
            case 'docking':
              // the surgeon watches the cart dock, then crosses to the console as the arms target
              if (c.robot === 'targeting') return this.consoleWant()
              return { key: 'surgeon:table-work', spot: sp.tableSurgeon, anim: 'give' }
            case 'console':
              return this.consoleWant()
            case 'undocking':
            case 'closing':
              return { key: 'surgeon:table-work', spot: sp.tableSurgeon, anim: 'give' }
            case 'emergence':
              return { key: 'surgeon:table', spot: sp.tableSurgeon, anim: 'talk' }
            default:
              return this.base(s)
          }
        }
        if (c.phase === 'toTheatre' || m <= SCRUB_LEAD) return { key: 'surgeon:scrub', spot: sp.sink[0], anim: 'give' }
        return this.base(s)
      case 'assistant':
        if (room) {
          switch (c.phase) {
            case 'in':
            case 'induction':
            case 'emergence':
            case 'out':
              return { key: 'assistant:wait', spot: sp.assistantWait, anim: 'idle' }
            case 'positioning':
            case 'ports':
            case 'closing':
              return { key: 'assistant:table-work', spot: sp.assistant, anim: 'give' }
            case 'docking':
              if (c.robot === 'deploying') return { key: 'assistant:drive0', spot: sp.drive, anim: 'push' }
              if (c.robot === 'driving') return { key: 'assistant:drive', spot: sp.driveEnd, anim: 'push' }
              return { key: 'assistant:table', spot: sp.assistant, anim: 'give' }
            case 'console':
              return { key: c.exchanging ? 'assistant:exchange' : 'assistant:table-watch', spot: sp.assistant, anim: c.exchanging ? 'give' : 'tablet' }
            case 'undocking':
              if (c.robot === 'returning') return { key: 'assistant:drive', spot: sp.driveEnd, anim: 'push' }
              return { key: 'assistant:table-work', spot: sp.assistant, anim: 'give' }
            default:
              return this.base(s)
          }
        }
        if (c.phase === 'toTheatre' || m <= SCRUB_LEAD) return { key: 'assistant:scrub', spot: sp.sink[1], anim: 'give' }
        return this.base(s)
      case 'scrub':
        if (room) {
          switch (c.phase) {
            case 'in':
            case 'induction':
              return { key: 'scrub:table', spot: sp.scrub, anim: 'idle' }
            case 'positioning':
            case 'ports':
            case 'docking':
            case 'console':
            case 'undocking':
            case 'closing':
              return { key: 'scrub:table-work', spot: sp.scrub, anim: 'give' }
            case 'emergence':
            case 'out':
              return { key: 'scrub:wait', spot: sp.scrubWait, anim: 'idle' }
            default:
              return this.base(s)
          }
        }
        // the robot's drapes: off in turnover, on again before the next case
        if (c.robot === 'draping') return { key: 'scrub:drape', spot: sp.drape, anim: 'give' }
        if (c.robot === 'cleaning' && c.now - c.robotSince < DRAPE_OFF_SECONDS) return { key: 'scrub:drape', spot: sp.drape, anim: 'give' }
        if (c.robot === 'draped' && m <= SCRUB_LEAD) return { key: 'scrub:ready', spot: sp.scrub, anim: 'idle' }
        if (c.phase === 'toTheatre') return { key: 'scrub:ready', spot: sp.scrub, anim: 'idle' }
        if (m <= SCRUB_NURSE_LEAD && (c.robot === 'cleaning' || c.robot === 'stowed')) return { key: 'scrub:scrub', spot: sp.sink[0], anim: 'give' }
        if (c.robot === 'draped') return { key: 'scrub:ready', spot: sp.scrub, anim: 'idle' }
        return this.base(s)
      case 'circulator':
        if (room || c.phase === 'toTheatre' || c.phase === 'turnover' || m <= CIRCULATOR_LEAD) return { key: 'circulator:desk', spot: sp.circulator, anim: 'tablet' }
        return this.base(s)
      case 'anaesthetist':
        if (room) {
          switch (c.phase) {
            case 'in':
            case 'induction':
            case 'emergence':
              return { key: 'anaes:head-work', spot: sp.anaesHead, anim: 'give' }
            case 'console':
              return { key: 'anaes:stool', spot: { at: this.sites.anaesStool.seat.approach, heading: this.sites.anaesStool.seat.heading }, anim: 'sit', seat: this.sites.anaesStool }
            case 'out':
              return { key: 'anaes:head-talk', spot: sp.anaesHead, anim: 'talk' }
            default:
              return { key: 'anaes:head', spot: sp.anaesHead, anim: 'tablet' }
          }
        }
        if (c.phase === 'toTheatre' || m <= ANAES_LEAD) return { key: 'anaes:head', spot: sp.anaesHead, anim: 'tablet' }
        return this.base(s)
      case 'preOp':
        return { key: 'preop:desk', spot: sp.deskNurse, anim: 'tablet' }
      case 'pacu': {
        if (c.pacuFocus >= 0) {
          const ref = this.sites.pacu[c.pacuFocus]
          return { key: `pacu:bay${c.pacuFocus}`, spot: this.sites.nurseSide(ref), anim: 'tablet' }
        }
        return { key: 'pacu:island', spot: sp.pacuNurse, anim: 'tablet' }
      }
      case 'porter': {
        // S1: between stretcher runs the porter works the sterile supply (trays, drapes), moving on every 75 s; lent out, he follows the case
        const spots = SURGERY.sterile.spots
        const k = (((Math.floor(c.now / STERILE_DWELL) % spots.length) + spots.length) % spots.length)
        return { key: `porter:sterile:${k}`, spot: spots[k], anim: 'give' }
      }
      case 'cleaner': {
        if (c.turnoverSince !== null && c.turnoverSeconds > 0) {
          const n = sp.clean.length
          const k = Math.min(n - 1, Math.floor(((c.now - c.turnoverSince) / c.turnoverSeconds) * n))
          return { key: `cleaner:${k}`, spot: sp.clean[k], anim: 'clean' }
        }
        return this.base(s)
      }
      default:
        // (R4: the cryoablation suite's titles share the Staffer; they are never on this team)
        return this.base(s)
    }
  }
}
