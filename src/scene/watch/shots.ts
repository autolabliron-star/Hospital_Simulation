/**
 * R5: the watch camera's shots (pure data and maths, allocation-free per frame). A shot says where the eye stands and what it looks at, in SIM
 * coordinates of the room (y above the level's floor):
 *
 *   look       an anchor (anchors.ts): the working field, the mouth, the cart, the console's viewer, a member of the team ...
 *   eye        a fixed point of the room, or `over` a role's shoulder: `back` metres behind the person (away from what is looked at), `side` metres to
 *              their right as the camera looks, at `up` metres (the fixed `eye` is then the fallback while nobody fills the role)
 *   kind       'close' (the look point 0.4..3.5 m away) or 'wide' (an establishing shot, up to 6.5 m)
 *   fov        the vertical lens, 38..50 degrees
 *   inset      a picture-in-picture the overlay shows with it (the endoscope at the console); `insetBig` makes it the main picture (60 %)
 *   push       metres the eye creeps toward the look point over a long hold; `orbit` radians it swings round it (both slow, eased in over 14 s)
 *
 * A step picks its shots (`shotPlanFor`): the script's per-step override, else (a console step where the bedside assistant or the scrub nurse does
 * the hands-on work: suction, clips, the bag, an instrument exchange) the 3D view of their hands with the endoscope in a SMALL corner, else the step's FOCUS
 * (the main key: what the script says the camera frames), else the room's default. A plan may change shot part-way through a step (`from`, the step's
 * progress): at the console the camera first shows the surgeon, then the endoscope picture fills the screen (only where the surgeon alone acts).
 *
 * NOBODY IN THE WAY. A shot's designed eye is its first candidate; when someone's body (a capsule, limits.ts) stands between the lens and the look
 * point, or the eye would be in furniture, the cart or a person, `pickAltInto` tries the alternates in a fixed order (the side offset mirrored, the eye
 * raised to 2.1 m looking down more, orbits of 25 and 40 degrees each way round the look point, raised and orbited) and takes the first clear one:
 * deterministic, allocation-free.
 *
 * Every step of every script is checked in node (shots.test.ts) with the team where the script puts them: a clear candidate exists, and it is inside
 * the room, under the ceiling, out of the furniture, the cart and the lights, clear of the team and of their bodies, with the step's focus in frame and
 * no wall between the eye and what it looks at.
 */
import type { BoomProbe } from '@/scene/player/boomProbe'
import type { InsetId } from '@/scene/registries/insetSources'
import type { AreaId, Rect } from '@/sim/places'
import type { FocusId, ProcAction, ProcRole, ProcRoleView, ProcedureId, Vec3 } from '@/sim/types'
import { anchorInto, roleFloorInto, type AnchorCtx, type AnchorId } from './anchors'
import { BODY_RADIUS, BODY_TOP, CEILING_MARGIN, MIN_EYE_Y, PERSON_CLEAR, PERSON_TOP, ROOM_MARGIN, insideObstacle, segmentClearOfPeople, type Obstacles, type PeopleBuf } from './limits'
import type { WatchRoomId } from './rooms'

export type ShotKind = 'close' | 'wide'

export interface ShotSpec {
  readonly id: string
  readonly room: WatchRoomId
  /** The area the eye stands in (usually the room's; the theatre hall for the scrub sinks). */
  readonly area: AreaId
  readonly kind: ShotKind
  readonly look: AnchorId
  /** Raise (or lower) the look point, metres. */
  readonly lookUp?: number
  /** A fixed eye; with `over`, the fallback while nobody fills the role. */
  readonly eye: Readonly<Vec3>
  readonly over?: ProcRole
  readonly back?: number
  readonly side?: number
  readonly up?: number
  readonly fov: number
  readonly inset?: InsetId
  readonly insetBig?: boolean
  readonly push?: number
  readonly orbit?: number
}

/** A shot from a point of the step's progress on. */
export interface ShotCue {
  readonly shot: string
  readonly from: number
}
export type ShotPlan = readonly ShotCue[]

/** The close shots keep the look point this far away (metres); the wide ones up to `WIDE_MAX`. */
export const CLOSE_RANGE = [0.4, 3.5] as const
export const WIDE_MAX = 6.5
export const FOV_RANGE = [38, 50] as const
/** A wide shot needs only its foreground clear of people (this far from the lens): the team round the table is what it shows. */
export const WIDE_FOREGROUND = 2.5

// ---------------------------------------------------------------------------------------------
// The robotic theatre (sim coordinates: the OR is x 97..106, z 2..10; the table's centre (100.8, 5.9), head north; the cart docks from the west;
// the consoles stand on the east side; the scrub sinks are in the theatre hall north of the OR's door)
// ---------------------------------------------------------------------------------------------

const OR_SHOTS: readonly ShotSpec[] = [
  // the whole room from the north-east corner, high: the table, the team, the anaesthetist's end and the robot read across it (the consoles stay out
  // of the foreground, behind the lens to the south)
  { id: 'or.establish', room: 'or', area: 'l2Or', kind: 'wide', look: 'table', eye: { x: 105.5, y: 2.4, z: 2.45 }, fov: 48, push: 0.5 },
  // the face from the head end, high over the anaesthetist's left shoulder (R5 wave 2: the drapes' anaesthetic screen stands at the neck, so the old
  // view from over the chest saw the screen, not the face; this is the anaesthetist's own side of it)
  { id: 'or.head', room: 'or', area: 'l2Or', kind: 'close', look: 'mouth', eye: { x: 101.45, y: 2.05, z: 4.3 }, fov: 42, push: 0.15 },
  // beside the bedside assistant's right shoulder, high, looking down at the ports (their body to one side of the frame, never across it)
  { id: 'or.field', room: 'or', area: 'l2Or', kind: 'close', look: 'field', over: 'assistant', back: 0.2, side: 0.65, up: 2.05, eye: { x: 101.96, y: 2.05, z: 5.56 }, fov: 42, push: 0.15 },
  // the same, at the assistant's own port, with the endoscope picture in a small corner (the bedside work of a console step: clips, the bag)
  { id: 'or.fieldInset', room: 'or', area: 'l2Or', kind: 'close', look: 'assistantPort', over: 'assistant', back: 0.2, side: 0.65, up: 2.05, eye: { x: 101.75, y: 2.05, z: 5.45 }, fov: 44, inset: 'endo' },
  // R5 wave 2: the table's foot in lithotomy (the catheter, the manipulator, the uterus out): high behind the bedside assistant's shoulder, looking past them
  // at the perineal drape between the boots (the fixed eye: behind the foot, toward the scrub nurse's side)
  { id: 'or.foot', room: 'or', area: 'l2Or', kind: 'close', look: 'focus', over: 'assistant', back: 0.55, side: 0.75, up: 2.3, eye: { x: 101.5, y: 2.3, z: 8.0 }, fov: 46, push: 0.1 },
  // the abdomen from the patient's right foot (the cart is parked then: prep, drapes, closing)
  { id: 'or.abdomen', room: 'or', area: 'l2Or', kind: 'close', look: 'focus', eye: { x: 99.6, y: 1.95, z: 7.2 }, fov: 42, push: 0.2 },
  // a wide three-quarter view from the north-west corner, high past the vision cart: the cart (parked, driving in on the laser, docked) and the table
  // together, the team on the table's far (east) side (R5 wave 2: from the south-east they stood between the lens and the table)
  { id: 'or.dockWide', room: 'or', area: 'l2Or', kind: 'wide', look: 'cartTable', eye: { x: 97.7, y: 2.45, z: 2.7 }, fov: 50, orbit: 0.08 },
  // high over the east side, looking down at the arms meeting the ports (docking, targeting, the instruments going in, undocking)
  { id: 'or.armsHigh', room: 'or', area: 'l2Or', kind: 'close', look: 'field', lookUp: 0.3, eye: { x: 102.4, y: 2.55, z: 7.9 }, fov: 48, push: 0.15 },
  // the surgeon at the console, from behind their right shoulder, with the endoscope picture inset
  { id: 'or.console', room: 'or', area: 'l2Or', kind: 'close', look: 'consoleViewer', eye: { x: 105.5, y: 1.75, z: 9.45 }, fov: 44, inset: 'endo', orbit: 0.12 },
  // the same eye, the endoscope picture big (console steps where only the surgeon acts)
  { id: 'or.endoBig', room: 'or', area: 'l2Or', kind: 'close', look: 'consoleViewer', eye: { x: 105.5, y: 1.75, z: 9.45 }, fov: 44, inset: 'endo', insetBig: true },
  // the scrub nurse at the back table (the count)
  { id: 'or.backTable', room: 'or', area: 'l2Or', kind: 'close', look: 'backTable', eye: { x: 103.8, y: 1.8, z: 6.0 }, fov: 44, push: 0.15 },
  // the instrument (Mayo) stand at the table's foot
  { id: 'or.mayo', room: 'or', area: 'l2Or', kind: 'close', look: 'mayo', eye: { x: 99.75, y: 1.8, z: 8.75 }, fov: 44 },
  // the scrub sinks in the theatre hall
  { id: 'or.sink', room: 'or', area: 'l2Hall', kind: 'close', look: 'sink', eye: { x: 101.6, y: 1.65, z: 0.15 }, fov: 44 },
]

export const SHOTS: Readonly<Record<string, ShotSpec>> = Object.fromEntries(OR_SHOTS.map((s) => [s.id, s]))

const one = (shot: string): ShotPlan => [{ shot, from: 0 }]

/** Each room's shots by the step's focus. */
const BY_FOCUS: Readonly<Record<WatchRoomId, Readonly<Partial<Record<FocusId, ShotPlan>>>>> = {
  or: {
    room: one('or.establish'),
    stretcher: one('or.establish'),
    head: one('or.head'),
    abdomen: one('or.abdomen'),
    pelvis: one('or.abdomen'),
    legs: one('or.foot'),
    ports: one('or.field'),
    robotCart: one('or.dockWide'),
    console: [
      { shot: 'or.console', from: 0 },
      { shot: 'or.endoBig', from: 0.55 },
    ],
    endoscope: [
      { shot: 'or.console', from: 0 },
      { shot: 'or.endoBig', from: 0.3 },
    ],
    mayo: one('or.mayo'),
    backTable: one('or.backTable'),
    sink: one('or.sink'),
  },
  cryo: {},
  us: {},
}

/** Per script step, where the focus alone does not frame it best. */
/** The arms swing onto their ports, the instruments go in, the arms come off: high over the east side, down at the arms meeting the ports (every da Vinci script). */
const ARMS_STEPS: Readonly<Record<string, ShotPlan>> = {
  dockCamera: one('or.armsHigh'),
  targetArms: one('or.armsHigh'),
  instrumentsIn: one('or.armsHigh'),
  releaseArms: one('or.armsHigh'),
}

const OVERRIDES: Readonly<Partial<Record<ProcedureId, Readonly<Record<string, ShotPlan>>>>> = {
  'or-cholecystectomy': ARMS_STEPS,
  'or-hysterectomy': ARMS_STEPS,
  'or-prostatectomy': ARMS_STEPS,
}

/** The override plans (a step framed for something other than its focus: the arms while the surgeon walks to the console): no focus to keep in frame. */
const OVERRIDE_PLANS: ReadonlySet<ShotPlan> = new Set(Object.values(OVERRIDES).flatMap((o) => Object.values(o ?? {})))

/** Is this plan a step's override (its own framing, not the step's focus)? Allocation-free. */
export function isOverridePlan(plan: ShotPlan): boolean {
  return OVERRIDE_PLANS.has(plan)
}

/** Each room's shot when nothing else applies (no case in the room yet, or the case is over). The cryo and ultrasound entries are placeholders until their
 * waves bring their shot sets (those rooms are not in `WATCH_ROOMS` yet, so nothing reads them). */
export const ROOM_DEFAULT: Readonly<Record<WatchRoomId, ShotPlan>> = {
  or: one('or.establish'),
  cryo: one('or.establish'),
  us: one('or.establish'),
}

/**
 * Hands-on bedside work during a console step, on the patient or the robot (a clip, the bag, an instrument exchange, the leak test ...): the viewer must see
 * those hands, so the endoscope goes small. Handing instruments over, counting and watching are not, and neither is suction (R5 wave 2): the assistant
 * suctions through most of the console phase, and the endoscope's own stage (the clips, the cleared tissue, the stitches) is then the thing to see.
 */
const BEDSIDE_LEAD: ReadonlySet<ProcAction> = new Set<ProcAction>(['clipLap', 'bagSpecimen', 'exchangeInstrument', 'retractLap', 'removeSpecimen', 'fitInstrument', 'insertTrocar', 'injectSaline'])

/** A console step whose bedside assistant or scrub nurse does the hands-on work: the 3D view of their hands, the endoscope small in a corner. */
const BEDSIDE: Readonly<Record<WatchRoomId, ShotPlan | null>> = { or: one('or.fieldInset'), cryo: null, us: null }

/** Does the assistant or the scrub nurse lead this step with their hands? Allocation-free. */
export function bedsideLead(roles: readonly ProcRoleView[] | null): boolean {
  if (roles === null) return false
  for (let i = 0; i < roles.length; i++) {
    const r = roles[i]
    if ((r.role === 'assistant' || r.role === 'scrub') && BEDSIDE_LEAD.has(r.action)) return true
  }
  return false
}

/** The shots of a step (a static plan: nothing is allocated). `roles` is the step's team (who does what), for the bedside rule of console steps. */
export function shotPlanFor(room: WatchRoomId, procedureId: ProcedureId | null, stepId: string, focus: FocusId, roles: readonly ProcRoleView[] | null = null): ShotPlan {
  if (procedureId !== null) {
    const o = OVERRIDES[procedureId]?.[stepId]
    if (o !== undefined) return o
  }
  if ((focus === 'console' || focus === 'endoscope') && BEDSIDE[room] !== null && bedsideLead(roles)) return BEDSIDE[room]!
  return BY_FOCUS[room][focus] ?? ROOM_DEFAULT[room]
}

/**
 * The shot of a plan at the step's progress (the last cue that has begun), from cue `floor` on: a new step whose plan holds the shot already on screen
 * keeps it from there (`floorOf`), so the endoscope picture stays big from one console step to the next instead of shrinking back at each.
 */
export function cueAt(plan: ShotPlan, progress: number, floor = 0): ShotSpec {
  const f = floor > 0 && floor < plan.length ? floor : 0
  let pick = plan[f]
  for (let i = f + 1; i < plan.length; i++) if (plan[i].from <= progress) pick = plan[i]
  return SHOTS[pick.shot]
}

/** Where a new step's plan starts for a camera now showing `shot`: that shot's cue if the plan has it, else the first. */
export function floorOf(plan: ShotPlan, shot: ShotSpec | null): number {
  if (shot === null) return 0
  for (let i = plan.length - 1; i > 0; i--) if (plan[i].shot === shot.id) return i
  return 0
}

/** Every shot id a room can use (for the tests). */
export function shotsOfRoom(room: WatchRoomId): ShotSpec[] {
  return OR_SHOTS.filter((s) => s.room === room)
}

// ---------------------------------------------------------------------------------------------
// The pose of a shot
// ---------------------------------------------------------------------------------------------

const _role: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * The eye and the look point of `spec` now (sim coordinates), from the anchors. Allocation-free. Over a role's shoulder: behind the person (on the far side
 * from the look point) by `back`, to the camera's right by `side` (mirrored with `mirror`), at `up`; while nobody fills the role, the shot's fixed eye.
 */
export function shotPoseInto(spec: ShotSpec, ctx: AnchorCtx, eye: Vec3, target: Vec3, mirror = false): void {
  anchorInto(spec.look, ctx, target)
  if (spec.lookUp !== undefined) target.y += spec.lookUp
  if (spec.over !== undefined && roleFloorInto(spec.over, ctx, _role)) {
    let dx = _role.x - target.x
    let dz = _role.z - target.z
    const l = Math.sqrt(dx * dx + dz * dz)
    if (l > 1e-6) {
      dx /= l
      dz /= l
    } else {
      dx = 1
      dz = 0
    }
    // the camera faces (-dx, -dz); its right is (dz, -dx) in this frame (x east, z south)
    const back = spec.back ?? 0.4
    const side = mirror ? -(spec.side ?? 0) : (spec.side ?? 0)
    eye.x = _role.x + dx * back + dz * side
    eye.z = _role.z + dz * back - dx * side
    eye.y = spec.up ?? 1.8
    return
  }
  eye.x = spec.eye.x
  eye.y = spec.eye.y
  eye.z = spec.eye.z
}

/**
 * The slow move of a long hold: the eye creeps `push` metres toward the look point and swings `orbit` radians round it, eased in over `HOLD_EASE_SECONDS`.
 * `held` is the seconds the shot has been held. Writes the eye in place. Allocation-free.
 */
export const HOLD_EASE_SECONDS = 14

export function holdDriftInto(spec: ShotSpec, held: number, target: Readonly<Vec3>, eye: Vec3): void {
  const push = spec.push ?? 0
  const orbit = spec.orbit ?? 0
  if (push === 0 && orbit === 0) return
  const u = held <= 0 ? 0 : held >= HOLD_EASE_SECONDS ? 1 : held / HOLD_EASE_SECONDS
  const k = u * u * (3 - 2 * u)
  let dx = eye.x - target.x
  let dy = eye.y - target.y
  let dz = eye.z - target.z
  if (orbit !== 0) {
    const a = orbit * k
    const c = Math.cos(a)
    const s = Math.sin(a)
    const nx = dx * c + dz * s
    dz = dz * c - dx * s
    dx = nx
  }
  if (push !== 0) {
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (d > 1e-6) {
      // never closer than 0.6 m (nor pushed out when it already is)
      const want = d - push * k
      const f = (want < 0.6 ? (d < 0.6 ? d : 0.6) : want) / d
      dx *= f
      dy *= f
      dz *= f
    }
  }
  eye.x = target.x + dx
  eye.y = target.y + dy
  eye.z = target.z + dz
}

// ---------------------------------------------------------------------------------------------
// Nobody in the way: the alternates
// ---------------------------------------------------------------------------------------------

/** The eye of a raised alternate (m): higher, looking down more over the people in the way. */
export const RAISED_Y = 2.1
/** The alternates, in the order they are tried: 0 the designed eye, 1 the side mirrored (over-the-shoulder shots), 2 raised, 3..6 orbited round the
 * look point (+25, -25, +40, -40 degrees), 7..10 raised and orbited. */
export const ALT_COUNT = 11
const DEG = Math.PI / 180
const ALT_ORBIT = [0, 0, 0, 25 * DEG, -25 * DEG, 40 * DEG, -40 * DEG, 25 * DEG, -25 * DEG, 40 * DEG, -40 * DEG] as const
const ALT_RAISED = [false, false, true, false, false, false, false, true, true, true, true] as const

/** The picture's shape the step's focus is kept inside (16:9 with a margin: the narrowest window the demo runs in is wider). */
export const FRAME_ASPECT = 16 / 9
const FRAME_MARGIN = 0.92

/** Is `p` in the view of a camera at `eye` looking at `target` with vertical lens `fov` (degrees)? Allocation-free. */
export function inFrustum(eye: Readonly<Vec3>, target: Readonly<Vec3>, fov: number, p: Readonly<Vec3>, aspect = FRAME_ASPECT, margin = FRAME_MARGIN): boolean {
  let fx = target.x - eye.x
  let fy = target.y - eye.y
  let fz = target.z - eye.z
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz)
  if (fl < 1e-9) return false
  fx /= fl
  fy /= fl
  fz /= fl
  // right = forward x up (horizontal), up' = right x forward
  let rx = -fz
  let rz = fx
  const rl = Math.sqrt(rx * rx + rz * rz)
  if (rl < 1e-9) return false
  rx /= rl
  rz /= rl
  const ux = -rz * fy
  const uy = rz * fx - rx * fz
  const uz = rx * fy
  const vx = p.x - eye.x
  const vy = p.y - eye.y
  const vz = p.z - eye.z
  const depth = vx * fx + vy * fy + vz * fz
  if (depth <= 0.05) return false
  const sx = (vx * rx + vz * rz) / depth
  const sy = (vx * ux + vy * uy + vz * uz) / depth
  const tv = Math.tan((fov * DEG) / 2) * margin
  return (sy < 0 ? -sy : sy) <= tv && (sx < 0 ? -sx : sx) <= tv * aspect
}

/** What a candidate eye must keep clear of: the room, its walls and ceiling, the furniture, the cart and the lights, the people; and the step's focus. */
export interface ShotScene {
  area: Rect
  probe: BoomProbe
  people: PeopleBuf
  obstacles: Obstacles
  /** The step's focus point, kept in frame by a shot without an inset (null: not checked). */
  focus: Vec3 | null
}

/**
 * Write alternate `alt` of `spec` (see `ALT_COUNT`) into `eye` and `target`. False when that alternate does not exist for the shot (a mirror without a
 * side offset) or does not move the eye (a raise of an eye already that high). Allocation-free.
 */
export function candidateInto(spec: ShotSpec, ctx: AnchorCtx, alt: number, eye: Vec3, target: Vec3): boolean {
  if (alt === 1) {
    if (spec.over === undefined || (spec.side ?? 0) === 0) return false
    shotPoseInto(spec, ctx, eye, target, true)
    return true
  }
  shotPoseInto(spec, ctx, eye, target)
  if (alt <= 0 || alt >= ALT_COUNT) return alt === 0
  if (ALT_RAISED[alt]) {
    if (eye.y >= RAISED_Y) return false
    eye.y = RAISED_Y
  }
  const a = ALT_ORBIT[alt]
  if (a !== 0) {
    const dx = eye.x - target.x
    const dz = eye.z - target.z
    const c = Math.cos(a)
    const s = Math.sin(a)
    eye.x = target.x + dx * c + dz * s
    eye.z = target.z + dz * c - dx * s
  }
  return true
}

const _dir: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * Is the pose clear for `spec`: inside the room less its margin, under the ceiling, out of the obstacles, `PERSON_CLEAR` from everyone, the look point in
 * the shot's range, no wall and nobody's body between, and the step's focus in frame? Allocation-free.
 */
export function poseClear(spec: ShotSpec, eye: Readonly<Vec3>, target: Readonly<Vec3>, scene: Readonly<ShotScene>): boolean {
  const r = scene.area
  if (eye.x < r.x0 + ROOM_MARGIN || eye.x > r.x1 - ROOM_MARGIN || eye.z < r.z0 + ROOM_MARGIN || eye.z > r.z1 - ROOM_MARGIN) return false
  const ceiling = scene.probe.ceilingAt(eye.x, eye.z) ?? 3
  if (eye.y > ceiling - CEILING_MARGIN || eye.y < MIN_EYE_Y) return false
  if (insideObstacle(scene.obstacles, eye.x, eye.y, eye.z) >= 0) return false
  const people = scene.people
  if (eye.y < PERSON_TOP) {
    for (let i = 0; i < people.count; i++) {
      const dx = eye.x - people.x[i]
      const dz = eye.z - people.z[i]
      if (dx * dx + dz * dz < PERSON_CLEAR * PERSON_CLEAR) return false
    }
  }
  const dx = eye.x - target.x
  const dy = eye.y - target.y
  const dz = eye.z - target.z
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (d < CLOSE_RANGE[0] || d > (spec.kind === 'wide' ? WIDE_MAX : CLOSE_RANGE[1])) return false
  _dir.x = dx / d
  _dir.y = dy / d
  _dir.z = dz / d
  if (scene.probe.cast(target, _dir, d, 0.1) !== null) return false
  if (!segmentClearOfPeople(eye, target, people, BODY_RADIUS, BODY_TOP, 0.3, spec.kind === 'wide' ? WIDE_FOREGROUND : Number.POSITIVE_INFINITY)) return false
  if (spec.inset === undefined && scene.focus !== null && !inFrustum(eye, target, spec.fov, scene.focus)) return false
  return true
}

/**
 * The first clear alternate of `spec` (its pose written into `eye` and `target`), or -1 when none is clear (the designed pose is written then, and the
 * limits make the best of it). Deterministic and allocation-free.
 */
export function pickAltInto(spec: ShotSpec, ctx: AnchorCtx, scene: Readonly<ShotScene>, eye: Vec3, target: Vec3): number {
  for (let alt = 0; alt < ALT_COUNT; alt++) {
    if (!candidateInto(spec, ctx, alt, eye, target)) continue
    if (poseClear(spec, eye, target, scene)) return alt
  }
  candidateInto(spec, ctx, 0, eye, target)
  return -1
}
