/**
 * Camera flights for the room focus: `presetFor(area)` says where the camera should stand, `flyTo(pose)` moves it there
 * (about 1.2 s, eased, ending exactly at rest) and `overview()` flies back to the whole-building shot.
 *
 * The flight is driven by our own tween, not by camera-controls' spring: every frame `tickFlight(dt)` writes the pose
 * with `setLookAt(..., false)`, and drei's CameraControls (priority -1) applies it. `RoomPicker` calls `tickFlight` from
 * a `useFrame` at FRAME_PRIORITY.tour, which is ahead of the controls. The frame callback allocates nothing: every
 * scratch object below is made once.
 *
 * Poses use the same convention as `window.__hospitalCam.view(...)`: the camera looks at `target` from `distance` metres,
 * `pitchDeg` above the horizon, `yawDeg` round from the south (0 = camera south of the target, looking north).
 *
 * The maths (fit, shift, tween) is pure and exported so it is tested in node without a renderer.
 *
 * LEVELS (R2, docs/R2-SURGERY.md): level 2 is stacked over the west block, 4.2 m up, and every pose here is DRAWN (what the camera sees), like every
 * other camera pose. An area's rectangle is in SIM coordinates, so a level-2 area is moved by `levelDx` and `LEVEL_Y` before it is framed: its shot
 * looks at y = 4.2 and more, over the drawn footprint (x -62..-40). Which level the overview shows is `useOverviewLevel`, set by the room focus
 * (roomFocus.ts) before it flies, never here: a pose is only a pose.
 *
 * WALK HAND-OVER (W1): while you are walking, or flying in or out of walk mode, the camera belongs to the player system
 * (src/scene/player), not to these flights. The player registers a `WalkBridge`; a `flyTo` made in that time (a room focus from the
 * "Go to..." menu, `G`, Esc) first takes you out to the overview and the flight to the room starts from there: the player's own
 * flight out goes straight to the room's pose, so it is one swoop. `isWalkMode()` is what the room picker asks before it picks.
 */
import { Vector3 } from 'three'
import { LEVEL_Y, levelDx, rectLevel, type LevelId } from '@/sim/levels'
import { areaById, VIEW, type AreaId, type Rect } from '@/sim/places'
import type { Vec3 } from '@/sim/types'

export interface CameraPose {
  target: Vec3
  distance: number
  pitchDeg: number
  yawDeg: number
}

/** What the picture will be drawn into: the lens, the window shape and how much of the right edge the room panel covers. */
export interface ViewSpec {
  fovDeg: number
  /** Window width over height. */
  aspect: number
  /** The room panel's share of the window width, 0 to 0.5 (its width plus the gaps round it). */
  panelFrac: number
}

/** A typical 16:10 laptop window with the room panel open. Used when no camera is registered (and in tests). */
export const DEFAULT_VIEW: ViewSpec = { fovDeg: 35, aspect: 1.6, panelFrac: 0.27 }

/** The overview camera's lens (the rig's, App.tsx `FOV`). While walking the real lens is wider, but every overview shot is framed for this one. */
export const OVERVIEW_FOV_DEG = 35

const DEG = Math.PI / 180

// ---------------------------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------------------------

export interface LookAt {
  px: number
  py: number
  pz: number
  tx: number
  ty: number
  tz: number
}

/** Camera position and look-at point of a pose (the same formula as `__hospitalCam.view`). */
export function poseToLookAt(pose: CameraPose, out: LookAt): LookAt {
  const p = pose.pitchDeg * DEG
  const w = pose.yawDeg * DEG
  const h = pose.distance * Math.cos(p)
  out.px = pose.target.x + h * Math.sin(w)
  out.py = pose.target.y + pose.distance * Math.sin(p)
  out.pz = pose.target.z + h * Math.cos(w)
  out.tx = pose.target.x
  out.ty = pose.target.y
  out.tz = pose.target.z
  return out
}

/** The pose that looks from (px, py, pz) at (tx, ty, tz). */
export function lookAtToPose(l: LookAt, out: CameraPose): CameraPose {
  const dx = l.px - l.tx
  const dy = l.py - l.ty
  const dz = l.pz - l.tz
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  out.target.x = l.tx
  out.target.y = l.ty
  out.target.z = l.tz
  out.distance = dist
  out.pitchDeg = dist > 1e-6 ? Math.asin(Math.max(-1, Math.min(1, dy / dist))) / DEG : 50
  out.yawDeg = Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dx, dz) / DEG : 0
  return out
}

export function easeInOutCubic(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
}

/** Interpolate between two angles in degrees along the shorter way round. */
export function lerpAngleDeg(a: number, b: number, t: number): number {
  let d = (b - a) % 360
  if (d > 180) d -= 360
  else if (d < -180) d += 360
  return a + d * t
}

// ---------------------------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------------------------

export interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
}

/** Share of the half-height of the window the framed box may fill (the event line and order rail sit along the bottom). */
const FIT_HALF_HEIGHT = 0.74

/**
 * The smallest camera distance at which every corner of `box` is inside the free part of the window (the left of the
 * room panel, with `margin` of NDC to spare), when the camera has been shifted sideways by `withPanelShift` so the
 * target sits in the middle of that free part. Exact for a perspective lens; the camera is assumed above the box.
 */
export function fitDistance(target: Vec3, pitchDeg: number, yawDeg: number, box: Box, view: ViewSpec, margin = 0.06): number {
  const p = pitchDeg * DEG
  const w = yawDeg * DEG
  const sp = Math.sin(p)
  const cp = Math.cos(p)
  const sw = Math.sin(w)
  const cw = Math.cos(w)
  // camera basis: right r = (cw, 0, -sw), forward f = (-cp sw, -sp, -cp cw), up u = (-sp sw, cp, -sp cw)
  const tanV = Math.tan((view.fovDeg * DEG) / 2)
  const a = tanV * view.aspect
  const pf = view.panelFrac
  const xr = 1 - 2 * pf - margin
  const xl = -1 + margin
  const hy = FIT_HALF_HEIGHT
  let d = 0
  for (let i = 0; i < 8; i++) {
    const qx = (i & 1 ? box.x1 : box.x0) - target.x
    const qy = (i & 2 ? box.y1 : box.y0) - target.y
    const qz = (i & 4 ? box.z1 : box.z0) - target.z
    const xc = qx * cw - qz * sw
    const yc = -qx * sp * sw + qy * cp - qz * sp * cw
    const zc = -qx * cp * sw - qy * sp - qz * cp * cw
    d = Math.max(
      d,
      (xc - xr * zc * a) / (a * (xr + pf)),
      (xc - xl * zc * a) / (a * (xl + pf)),
      (yc - hy * tanV * zc) / (hy * tanV),
      (-yc - hy * tanV * zc) / (hy * tanV),
    )
  }
  return d
}

/**
 * Slide the camera sideways (target and position together) so the shot's target lands in the middle of the part of the
 * window the room panel leaves free, instead of behind the panel.
 */
export function withPanelShift(pose: CameraPose, view: ViewSpec): CameraPose {
  const a = Math.tan((view.fovDeg * DEG) / 2) * view.aspect
  const s = view.panelFrac * pose.distance * a
  const w = pose.yawDeg * DEG
  return { ...pose, target: { x: pose.target.x + s * Math.cos(w), y: pose.target.y, z: pose.target.z - s * Math.sin(w) } }
}

/** The whole-building shot: the same framing as `CameraRig` in App.tsx works out at mount, for the current window shape. */
export const OVERVIEW_PITCH_DEG = 50
const OVERVIEW_SIDE_MARGIN = 3

export function overviewPose(fovDeg: number, aspect: number): CameraPose {
  const pitch = OVERVIEW_PITCH_DEG * DEG
  const tanV = Math.tan((fovDeg * DEG) / 2)
  const tanH = tanV * aspect
  const fitWidth = (VIEW.halfExtent.x + OVERVIEW_SIDE_MARGIN) / tanH + VIEW.halfExtent.z * Math.cos(pitch)
  const fitHeight = (VIEW.halfExtent.z * Math.sin(pitch) + 4) / tanV + VIEW.halfExtent.z * Math.cos(pitch)
  return { target: { x: VIEW.center.x, y: 0, z: VIEW.center.z }, distance: Math.max(fitWidth, fitHeight), pitchDeg: OVERVIEW_PITCH_DEG, yawDeg: 0 }
}

// ---------------------------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------------------------

/** Closest and farthest a room shot may stand (the controls themselves allow 8 to 190). */
const GENERIC_DISTANCE = { min: 12, max: 55 } as const
const SHOT_DISTANCE = { min: 9, max: 40 } as const
/** Generic shots keep a person's height (and a bit) in frame above the floor rectangle. */
const GENERIC_HEIGHT = 1.9
const GENERIC_PITCH_DEG = 52

interface Shot {
  target: Vec3
  pitchDeg: number
  yawDeg: number
  /** What must stay in frame. */
  box: Box
}

/** The level an area is on (a level-2 area lies in the strip of sim x 88..110). */
export function areaLevel(area: AreaId): LevelId {
  return rectLevel(areaById(area).rect)
}

/** An area's rectangle as drawn: level 2 moves west by `levelDx`; z is unchanged. */
export function drawnRect(r: Rect): Rect {
  const dx = levelDx(rectLevel(r))
  return { x0: r.x0 + dx, x1: r.x1 + dx, z0: r.z0, z1: r.z1 }
}

/** A box over a drawn rectangle: from the floor of `level` to `height` above it. */
function rectBox(r: Rect, height: number, level: LevelId = 1): Box {
  return { x0: r.x0, x1: r.x1, y0: LEVEL_Y[level], y1: LEVEL_Y[level] + height, z0: r.z0, z1: r.z1 }
}

/** The floor of level 2 as drawn, for the shots below (their target heights and boxes sit on it). */
const UP = LEVEL_Y[2]

/**
 * Hand-tuned shots for the imaging suite (anchors in `IMAGING`, places.ts). North is up the screen at yaw 0.
 *   MRI, CT: from the control-room side (south), a little to the west so the bore opening faces the lens; the window,
 *     the radiographer at the console and the magnet or gantry all show.
 *   Control rooms: low, over the radiographer's shoulder, with the scanner through the window beyond.
 *   X-ray: from the booth side (north end of the room, a little east) down the room to the table and the wall detector.
 *   Ultrasound: from the foot of the couch (the patient's feet point north), a little west so the cart and the
 *     sonographer on the east side are not hidden behind the couch.
 */
const SHOTS: Partial<Record<AreaId, Shot>> = {
  mri: { target: { x: -35.5, y: 0.9, z: -7 }, pitchDeg: 42, yawDeg: -14, box: { x0: -40, x1: -31, y0: 0, y1: 2.4, z0: -12, z1: -2 } },
  mriControl: { target: { x: -36.2, y: 0.9, z: -3.4 }, pitchDeg: 34, yawDeg: 0, box: { x0: -40, x1: -31, y0: 0, y1: 2.4, z0: -11, z1: -2 } },
  ct: { target: { x: -26.5, y: 0.9, z: -7 }, pitchDeg: 42, yawDeg: -14, box: { x0: -31, x1: -22, y0: 0, y1: 2.4, z0: -12, z1: -2 } },
  ctControl: { target: { x: -27.4, y: 0.9, z: -3.4 }, pitchDeg: 34, yawDeg: 0, box: { x0: -31, x1: -22, y0: 0, y1: 2.4, z0: -11, z1: -2 } },
  xray: { target: { x: -37, y: 0.8, z: 7.2 }, pitchDeg: 46, yawDeg: 160, box: { x0: -40, x1: -34, y0: 0, y1: 2.8, z0: 2, z1: 12 } },
  ultrasound: { target: { x: -31, y: 0.7, z: 8.4 }, pitchDeg: 44, yawDeg: 188, box: { x0: -34, x1: -28, y0: 0, y1: 2.1, z0: 3.5, z1: 12 } },
  // W4: both look south from the north side, at the machines' fronts
  diagnostics: { target: { x: -25, y: 0.9, z: 9.6 }, pitchDeg: 40, yawDeg: 180, box: { x0: -28, x1: -22, y0: 0, y1: 2.4, z0: 5, z1: 12 } },
  lab: { target: { x: -28, y: 0.9, z: 19.5 }, pitchDeg: 44, yawDeg: 180, box: { x0: -31, x1: -25, y0: 0, y1: 2.0, z0: 16, z1: 22 } },
  // R2, level 2 (DRAWN coordinates, on the floor at y = 4.2; sim x = drawn x + 150)
  //   Robotic OR: from the south, so the table (head north), the cart docked from the west, the vision cart and the two consoles on the east side all show,
  //     with the cart's boom (2.5 m up) in frame.
  //   Pre-op: from the south, down the four curtained bays on the north windows to the admissions desk by the corridor door.
  //   Recovery: from the north (the OR side), at the three bays against the south wall and the nurse island in front of them.
  l2Or: { target: { x: -48.6, y: UP + 0.9, z: 6.2 }, pitchDeg: 48, yawDeg: 0, box: { x0: -53, x1: -44, y0: UP, y1: UP + 2.6, z0: 2, z1: 10 } },
  l2PreOp: { target: { x: -52.5, y: UP + 0.7, z: -16 }, pitchDeg: 50, yawDeg: 0, box: { x0: -62, x1: -44, y0: UP, y1: UP + 2.2, z0: -22, z1: -10 } },
  l2Pacu: { target: { x: -48.5, y: UP + 0.7, z: 16 }, pitchDeg: 50, yawDeg: 180, box: { x0: -53, x1: -44, y0: UP, y1: UP + 2.2, z0: 10, z1: 22 } },
  // R4: the CT cryoablation room from the east (the recovery side), along the table to the gantry, with the robot docked at the near (north) flank
  l2Cryo: { target: { x: -57.5, y: UP + 0.9, z: 17.4 }, pitchDeg: 48, yawDeg: 90, box: { x0: -62, x1: -53, y0: UP, y1: UP + 2.4, z0: 13, z1: 22 } },
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Where the camera stands to look into `area`, before the room panel's sideways shift (so the target is inside the area).
 * Imaging rooms and the level-2 suite have hand-tuned shots; every other area looks at the centre of its rectangle at about 52°,
 * from far enough to fit it (long corridors stop at the maximum distance and show their middle part). The pose is DRAWN: a
 * level-2 area is looked at where it stands, 4.2 m up over the west block.
 */
export function presetFor(area: AreaId, view: ViewSpec = DEFAULT_VIEW): CameraPose {
  const shot = SHOTS[area]
  if (shot) {
    const distance = clamp(fitDistance(shot.target, shot.pitchDeg, shot.yawDeg, shot.box, view), SHOT_DISTANCE.min, SHOT_DISTANCE.max)
    return { target: { ...shot.target }, distance, pitchDeg: shot.pitchDeg, yawDeg: shot.yawDeg }
  }
  const sim = areaById(area).rect
  const level = rectLevel(sim)
  const rect = drawnRect(sim)
  const target: Vec3 = { x: (rect.x0 + rect.x1) / 2, y: LEVEL_Y[level] + 0.6, z: (rect.z0 + rect.z1) / 2 }
  const distance = clamp(fitDistance(target, GENERIC_PITCH_DEG, 0, rectBox(rect, GENERIC_HEIGHT, level), view), GENERIC_DISTANCE.min, GENERIC_DISTANCE.max)
  return { target, distance, pitchDeg: GENERIC_PITCH_DEG, yawDeg: 0 }
}

/** The box (drawn) a preset is meant to keep in frame (for tests and tools). */
export function presetBox(area: AreaId): Box {
  const sim = areaById(area).rect
  return SHOTS[area]?.box ?? rectBox(drawnRect(sim), GENERIC_HEIGHT, rectLevel(sim))
}

// ---------------------------------------------------------------------------------------------
// The flight
// ---------------------------------------------------------------------------------------------

/** The part of CameraControls the flight needs (the real class satisfies it; tests pass a fake). */
export interface FlightControls {
  camera: object
  getPosition(out: Vector3, receiveEndValue?: boolean): Vector3
  getTarget(out: Vector3, receiveEndValue?: boolean): Vector3
  setLookAt(px: number, py: number, pz: number, tx: number, ty: number, tz: number, enableTransition?: boolean): Promise<void> | void
}

export const FLIGHT_SECONDS = 1.2
/** A frame hitch longer than this does not skip the flight forward. */
const MAX_FRAME_DT = 0.05
/** How far the camera pulls back mid-flight for each metre travelled, so long hops swoop instead of slide. */
const BULGE_PER_METRE = 0.16
const BULGE_MAX = 22

let controls: FlightControls | null = null

/** What the player system offers the room focus (the walk hand-over). */
export interface WalkBridge {
  /** You are walking, or flying in or out: the camera is the player system's. */
  walking(): boolean
  /** Fly out of walk mode to `pose` (null: the whole-building overview), ending at rest in the rig. */
  toOverview(pose: CameraPose | null): void
}

/** The rig as the player system drives it: the flight controls plus the suspend switch (`RigControls`). */
export interface RigHandle extends FlightControls {
  suspended: boolean
  enabled: boolean
}

let walkBridge: WalkBridge | null = null
const _pos = new Vector3()
const _tgt = new Vector3()
const _look: LookAt = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 }
const mkPose = (): CameraPose => ({ target: { x: 0, y: 0, z: 0 }, distance: 1, pitchDeg: 50, yawDeg: 0 })
const _from = mkPose()
const _to = mkPose()
const _mix = mkPose()
const flight = { active: false, t: 0, dur: FLIGHT_SECONDS, bulge: 0 }

export function registerControls(c: FlightControls | null): void {
  controls = c
  flight.active = false
}

export function isFlying(): boolean {
  return flight.active
}

/** The player system registers itself here (and clears it on unmount). */
export function registerWalkBridge(b: WalkBridge | null): void {
  walkBridge = b
}

/** Are you walking (or flying in or out)? Room picking and the room flights stand aside while you are. */
export function isWalkMode(): boolean {
  return walkBridge?.walking() ?? false
}

/** The registered rig, if it is a `RigControls` (it has the suspend switch), for the player system. */
export function getRig(): RigHandle | null {
  const c = controls as Partial<RigHandle> | null
  return c && typeof c.suspended === 'boolean' && typeof c.enabled === 'boolean' ? (c as RigHandle) : null
}

/** Stop where the camera is (the presenter grabbed it). */
export function cancelFlight(): void {
  flight.active = false
}

/** The lens and window shape of the registered camera, with the room panel's share of the width set by the caller. */
export function currentView(panelFrac: number): ViewSpec {
  const cam = controls?.camera as { fov?: number; aspect?: number } | undefined
  // while walking the lens is the walk lens, but the shots are framed for the overview's
  const fovDeg = typeof cam?.fov === 'number' && !isWalkMode() ? cam.fov : OVERVIEW_FOV_DEG
  const aspect = typeof cam?.aspect === 'number' && cam.aspect > 0.2 ? cam.aspect : DEFAULT_VIEW.aspect
  return { fovDeg, aspect, panelFrac }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function apply(pose: CameraPose): void {
  if (!controls) return
  poseToLookAt(pose, _look)
  void controls.setLookAt(_look.px, _look.py, _look.pz, _look.tx, _look.ty, _look.tz, false)
}

/** Fly the camera to `pose` (smooth, eased, ending exactly at rest). With reduced motion on, it jumps. */
export function flyTo(pose: CameraPose, opts: { seconds?: number } = {}): void {
  // walking: the player takes you out of walk mode first, flying straight to this pose (see WalkBridge)
  if (walkBridge?.walking()) {
    walkBridge.toOverview(pose)
    return
  }
  if (!controls) return
  controls.getPosition(_pos, false)
  controls.getTarget(_tgt, false)
  lookAtToPose({ px: _pos.x, py: _pos.y, pz: _pos.z, tx: _tgt.x, ty: _tgt.y, tz: _tgt.z }, _from)
  _to.target.x = pose.target.x
  _to.target.y = pose.target.y
  _to.target.z = pose.target.z
  _to.distance = pose.distance
  _to.pitchDeg = pose.pitchDeg
  _to.yawDeg = pose.yawDeg
  const seconds = opts.seconds ?? FLIGHT_SECONDS
  if (seconds <= 0 || prefersReducedMotion()) {
    flight.active = false
    apply(_to)
    return
  }
  flight.t = 0
  flight.dur = seconds
  flight.bulge = Math.min(BULGE_MAX, BULGE_PER_METRE * Math.hypot(_to.target.x - _from.target.x, _to.target.z - _from.target.z))
  flight.active = true
}

/** Fly back to the shot of the whole building. */
export function overview(): void {
  const v = currentView(0)
  flyTo(overviewPose(v.fovDeg, v.aspect))
}

/** Advance the flight by `dt` seconds. Call once per frame, before the camera controls update. Allocates nothing. */
export function tickFlight(dt: number): void {
  if (!flight.active || !controls) return
  flight.t += dt > MAX_FRAME_DT ? MAX_FRAME_DT : dt
  if (flight.t >= flight.dur) {
    flight.active = false
    apply(_to) // the exact pose, at rest
    return
  }
  const e = easeInOutCubic(flight.t / flight.dur)
  _mix.target.x = _from.target.x + (_to.target.x - _from.target.x) * e
  _mix.target.y = _from.target.y + (_to.target.y - _from.target.y) * e
  _mix.target.z = _from.target.z + (_to.target.z - _from.target.z) * e
  _mix.distance = _from.distance + (_to.distance - _from.distance) * e + flight.bulge * Math.sin(Math.PI * e)
  _mix.pitchDeg = _from.pitchDeg + (_to.pitchDeg - _from.pitchDeg) * e
  _mix.yawDeg = lerpAngleDeg(_from.yawDeg, _to.yawDeg, e)
  apply(_mix)
}
