/**
 * R5: the surgery suite's adapter to the step-by-step engine (src/sim/procedure). A case whose procedure has a script (`or-<procedure>`,
 * src/content/procedures) gets a `CaseScript` once, when it is made: its steps laid out (real minutes jittered on a NEW fork, `caseRng.fork
 * ('script')`, so no day plan moves; or the watch seconds), the bedside exchanges the script makes in the console phase (replacing the plan's
 * random ones at runtime), and who wears what at each step. A case without a script gets null and keeps the R2 behaviour exactly.
 *
 * Everything here is pure: the arms and their exchange counts at a time are functions of the clock, so a warm start puts them exactly where a
 * live run would have them.
 */
import { SURGERY_COPY } from '@/content/surgery'
import { inDoorway } from '../er/spots'
import { isWalkable } from '../nav/layout'
import type { PortLayout, Spot } from '../places'
import {
  armsAt,
  caseSteps,
  compiledFor,
  newTargetCtx,
  resolveTarget,
  scriptedExchanges,
  tiltPointInto,
  type CaseSteps,
  type CompiledScript,
  type ScriptedExchange,
  type TargetCtx,
} from '../procedure'
import type { Rng } from '../rng'
import { ATTIRE, type ProcAnchor, type ProcRole, type ProcTarget, type RobotArmState, type SimEventType, type Vec2, type Vec3 } from '../types'
import type { Title } from './actors'
import type { PlannedCase } from './plan'
import { EXCHANGE_SECONDS } from './robot'

/** The OR team's titles as the scripts' roles (the order of `ROLES_BY_MACHINE.daVinci` and so of `ProcedureView.roles`). */
export const OR_ROLES: readonly ProcRole[] = ['surgeon', 'assistant', 'scrub', 'circulator', 'anaesthetist']

/** A staff title's role index in `OR_ROLES` (-1: not a scripted role: the pre-op and recovery nurses, the porter, the cleaner). */
export function roleIndexOf(title: Title): number {
  switch (title) {
    case 'surgeon':
      return 0
    case 'assistant':
      return 1
    case 'scrub':
      return 2
    case 'circulator':
      return 3
    case 'anaesthetist':
      return 4
    default:
      return -1
  }
}

/** The WHO checklist pause a step marks, as the event the R2 suite logs for it (with the content's line). */
export const WHO_EVENT: Readonly<Record<'signIn' | 'timeOut' | 'signOut', SimEventType>> = {
  signIn: 'whoSignIn',
  timeOut: 'whoTimeOut',
  signOut: 'whoSignOut',
}

/** One scripted case's runtime data (made once per case). */
export interface CaseScript {
  readonly steps: CaseSteps
  /** The script's bedside exchanges for this case's console phase (seconds into it, where the arm's withdrawal begins), in time order. */
  readonly exchanges: readonly ScriptedExchange[]
  /** The instruments on the arms when they dock (the script's `robotArms`; index 1 is the endoscope). */
  readonly arms0: readonly string[]
  /** `ATTIRE` bits per script step and role: `attire[step * OR_ROLES.length + r]`. */
  readonly attire: Uint8Array
  /** The last flat step whose event and checklist line have been said (-1: none yet). */
  saidFlat: number
}

const TABLE_SIDE: ReadonlySet<ProcAnchor> = new Set<ProcAnchor>(['tableSurgeon', 'tableWest', 'tableWestHead', 'tableFoot', 'assistant', 'scrub', 'scrubBackTable'])
/** Who scrubs and gowns: the surgeon, the bedside assistant and the scrub nurse. The circulator and the anaesthetist stay unsterile. */
const STERILE: readonly boolean[] = [true, true, true, false, false]

/**
 * Who wears what at each step (docs/research/procedures.md, section 3): everybody in the room is masked. The sterile three are gowned and
 * gloved: from their `gownGlove` step; or, without one, as soon as they are back at the table after scrubbing their hands (they gowned on the
 * way, off the script); the scrub nurse, who is already gowned when the patient comes in, from the start unless the script has them scrub. The
 * console surgeon takes gown and gloves off at the console and gowns again on coming back to the table (to close). After the drapes come off
 * (`removeDrapes`) the gowns come off; the masks stay until the patient has gone.
 */
export function attireTable(steps: CaseSteps): Uint8Array {
  const cs = steps.cs
  const n = cs.n
  const R = OR_ROLES.length
  const out = new Uint8Array(n * R)
  // the gowns come off for everybody after the step in which the drapes come off
  let offFrom = n
  for (let i = 0; i < n && offFrom === n; i++) for (let r = 0; r < cs.roles.length; r++) if (cs.roleAt[i][r]?.action === 'removeDrapes') offFrom = i + 1
  for (let r = 0; r < R; r++) {
    const rr = cs.roles.indexOf(OR_ROLES[r])
    let first: string | null = null
    for (let i = 0; i < n && first === null && rr >= 0; i++) first = cs.roleAt[i][rr]?.action ?? null
    // (the scrub nurse is gowned at the back table before the patient comes in, unless the script has them scrub)
    let gowned = STERILE[r] && rr >= 0 && first !== 'scrubHands' && first !== 'gownGlove'
    let scrubbed = false
    let consoled = false
    for (let i = 0; i < n; i++) {
      const line = rr >= 0 ? cs.roleAt[i][rr] : null
      if (line !== null && STERILE[r]) {
        if (line.action === 'scrubHands') {
          gowned = false
          scrubbed = true
        } else if (line.action === 'gownGlove') {
          gowned = true
          scrubbed = false
        } else if (line.anchor === 'surgeonConsole') {
          if (gowned) consoled = true
          gowned = false
        } else if (TABLE_SIDE.has(line.anchor) && (scrubbed || consoled)) {
          // back at the table after scrubbing (gowned on the way), or after the console (gowned again to close)
          gowned = true
          scrubbed = false
          consoled = false
        }
      }
      out[i * R + r] = ATTIRE.mask | (gowned && i < offFrom ? ATTIRE.gown | ATTIRE.gloves : 0)
    }
  }
  return out
}

/**
 * The runtime script of a case, or null when its procedure has none yet (the R2 behaviour). `caseRng` is the case's own stream (Surgery forks
 * it by the case id); only its NEW fork `script` is drawn from, and only in the living day (a watch case takes the watch seconds).
 */
export function caseScriptFor(plan: PlannedCase, caseRng: Rng): CaseScript | null {
  const cs = compiledFor(`or-${plan.procedure}`)
  if (cs === undefined) return null
  const watch = plan.watch === true
  const steps = caseSteps(cs, watch ? 'watch' : 'live', watch ? null : caseRng.fork('script'))
  return {
    steps,
    exchanges: scriptedExchanges(steps, plan.phases.console),
    arms0: cs.baseArms.length === 4 ? cs.baseArms : SURGERY_COPY.procedures[plan.procedure].instruments,
    attire: attireTable(steps),
    saidFlat: -1,
  }
}

const SCRATCH: string[] = ['', '', '', '']

/**
 * Put the script's instruments (and the exchange counts) on the arms at time `t` of a case whose console phase began at `consoleStart` and
 * lasts `consoleSeconds`. Only the arms that hold an instrument now are written (the robot FSM decides which: `applyRobot`). Pure in `t`.
 */
export function scriptedArmsInto(arms: RobotArmState[], sc: CaseScript, consoleStart: number | null, consoleSeconds: number, t: number): void {
  if (consoleStart === null) {
    for (let i = 0; i < 4; i++) if (arms[i].instrument !== '') arms[i].instrument = sc.arms0[i] ?? ''
    return
  }
  armsAt(sc.steps, consoleStart, consoleStart + consoleSeconds, t, SCRATCH)
  for (let i = 0; i < 4; i++) if (arms[i].instrument !== '') arms[i].instrument = SCRATCH[i]
  for (let i = 0; i < 4; i++) arms[i].exchanges = 0
  const ex = sc.exchanges
  for (let k = 0; k < ex.length; k++) if (t >= consoleStart + ex[k].at + EXCHANGE_SECONDS / 2) arms[ex[k].arm].exchanges++
}

// ---------------------------------------------------------------------------------------------------------------------
// Where the hands work and where the person stands (the crowd renderer's placement rules)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The renderer puts the tool's tip on `StaffAct.work`, from a person standing about 0.4-0.6 m from it and facing it (up to about 0.9 m with a
 * chest lean). So the work point is a point ON the surface worked, on the worker's side of it, and the person stands as near it as the room
 * lets them:
 *
 *   the patient's chest, abdomen, pelvis, body (a transfer): the near side of the body, at most `NEAR_SIDE` from the midline toward the worker
 *   the perineum (lithotomy: the catheter, the manipulator, the uterus out): the same near side, and leaning toward the worker along the table by at
 *              most `NEAR_FOOT` (the table's foot is a wall of footprint for the walker: the person at the foot stands 0.97 m from the perineum, and
 *              a work area between the legs reaches toward the foot a few centimetres, never far enough to move the hands visibly)
 *   the sink: the basin in front of the person's own tap (each scrubs at their own)
 *   the robot cart (deploying, driving): the near side of the cart as it stands now, at handle height, within reach (`CART_REACH`) of
 *              the driver (the cart moves; the driver's spot does not)
 *   anything else (the face, a port, the back table, a monitor): the target's own point
 *
 * A role at a table-side spot slides along the table (at most `MAX_SLIDE`) toward the point it works on, keeping clear of the others.
 */
const NEAR_SIDE = 0.15
const NEAR_FOOT = 0.12
const MAX_SLIDE = 0.25
/** People at the table keep this far apart. */
const APART = 0.6
const SINK_REACH = 0.45
const CART_REACH = 0.55
const BODY_TARGETS: ReadonlySet<ProcTarget> = new Set<ProcTarget>(['patientChest', 'abdomen', 'pelvis', 'patient', 'perineum'])
const ON_PATIENT: ReadonlySet<ProcTarget> = new Set<ProcTarget>(['patientChest', 'abdomen', 'pelvis', 'patient', 'patientFace', 'perineum', 'port0', 'port1', 'port2', 'port3', 'assistantPort'])
/** The spots along the table's sides a person may slide along. */
const SLIDES: ReadonlySet<ProcAnchor> = new Set<ProcAnchor>(['tableSurgeon', 'assistant', 'scrub', 'tableWest', 'tableWestHead', 'anaesLeft'])

/** The robot cart as the robot state has it (its base and heading). */
export interface CartPoseLike {
  x: number
  z: number
  heading: number
}

/**
 * The world point a person standing at `from` (facing `heading`) works at for `target`, with the table and the cart as they are now
 * (`ctx`, `cart`). Allocation-free.
 */
export function workPointInto(target: ProcTarget, from: Vec2, heading: number, ctx: TargetCtx, cart: CartPoseLike | null, out: Vec3): Vec3 {
  if (target === 'sink') {
    out.x = from.x + Math.sin(heading) * SINK_REACH
    out.y = 1.0
    out.z = from.z + Math.cos(heading) * SINK_REACH
    return out
  }
  if (target === 'robotCart' && cart !== null) {
    const dx = cart.x - from.x
    const dz = cart.z - from.z
    const d = Math.hypot(dx, dz)
    const k = d > 1e-6 ? Math.min(CART_REACH, d) / d : 0
    out.x = d > 1e-6 ? from.x + dx * k : from.x + Math.sin(heading) * CART_REACH
    out.y = 1.05
    out.z = d > 1e-6 ? from.z + dz * k : from.z + Math.cos(heading) * CART_REACH
    return out
  }
  if (BODY_TARGETS.has(target)) {
    // the point on the level table, moved across the body toward the worker, then tipped with the table
    const level = LEVEL[ctx.layout]
    level.position = ctx.position
    resolveTarget(target, level, out)
    const dx = from.x - out.x
    out.x += dx > NEAR_SIDE ? NEAR_SIDE : dx < -NEAR_SIDE ? -NEAR_SIDE : dx
    if (target === 'perineum') {
      const dz = from.z - out.z
      out.z += dz > NEAR_FOOT ? NEAR_FOOT : dz < -NEAR_FOOT ? -NEAR_FOOT : dz
    }
    return tiltPointInto(ctx, out.x, out.y, out.z, out)
  }
  return resolveTarget(target, ctx, out)
}

const LEVEL: Record<PortLayout, TargetCtx> = { oblique: newTargetCtx('oblique'), transverse: newTargetCtx('transverse') }

/** Where one role stands at a step: the anchor's spot, slid along the table toward its work (`slide` metres along z), and its run key. */
export interface Placement {
  anchor: ProcAnchor
  at: Vec2
  /** The spot's own heading (the person turns to the work point on arrival). */
  heading: number
  slide: number
  /** The Task key's position part: the anchor, plus the slide in centimetres when there is one. */
  where: string
}

/**
 * Where each role (`OR_ROLES` order) stands at script step `step`: written into `out` (null: no line in the unit). Pure: the same step and
 * spots give the same places. A table-side role that works on the patient slides along the table toward the point (on the level table, so the
 * place does not move while the table tips), at most `MAX_SLIDE`, onto walkable floor and at least `APART` from everybody else's place.
 */
export function placeRoles(cs: CompiledScript, step: number, spotOf: (a: ProcAnchor) => Spot, layout: PortLayout, out: (Placement | null)[]): void {
  const lines = cs.roleAt[step]
  const R = OR_ROLES.length
  const level = LEVEL[layout]
  const w: Vec3 = { x: 0, y: 0, z: 0 }
  for (let r = 0; r < R; r++) {
    const rr = cs.roles.indexOf(OR_ROLES[r])
    const line = rr >= 0 ? lines[rr] : null
    if (line === null) {
      out[r] = null
      continue
    }
    const base = spotOf(line.anchor)
    out[r] = { anchor: line.anchor, at: base.at, heading: base.heading, slide: 0, where: line.anchor }
  }
  for (let r = 0; r < R; r++) {
    const p = out[r]
    const rr = cs.roles.indexOf(OR_ROLES[r])
    const line = p !== null && rr >= 0 ? lines[rr] : null
    if (p === null || line === null || line.work === null || !SLIDES.has(p.anchor) || !ON_PATIENT.has(line.work)) continue
    workPointInto(line.work, p.at, p.heading, level, null, w)
    const want = Math.max(-MAX_SLIDE, Math.min(MAX_SLIDE, w.z - p.at.z))
    for (const k of [1, 0.5]) {
      const dz = Math.round(want * k * 100) / 100
      if (dz === 0) break
      const at = { x: p.at.x, z: p.at.z + dz }
      if (!isWalkable(at.x, at.z, 0.3) || inDoorway(at.x, at.z)) continue
      let clear = true
      for (let o = 0; o < R && clear; o++) {
        const q = out[o]
        if (o !== r && q !== null && Math.hypot(q.at.x - at.x, q.at.z - at.z) < APART) clear = false
      }
      if (!clear) continue
      out[r] = { anchor: p.anchor, at, heading: p.heading, slide: dz, where: `${p.anchor}${dz > 0 ? '+' : ''}${Math.round(dz * 100)}` }
      break
    }
  }
}
