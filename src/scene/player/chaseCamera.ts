/**
 * The walk-mode camera: a GTA-style third-person chase camera on a boom over your shoulder (the RIGHT one, until a wall is there),
 * with mouse look, wheel zoom and a first-person view. It is framework-free: the player system hands it where you are, the look input and a probe of the
 * building, and it writes the camera. Adapted from Waltz City's `chaseCamera.ts`.
 *
 * Two schemes (`ControlScheme`, see scheme.ts):
 *   easy     (the default) the camera's yaw is YOUR HEADING, followed lazily (`EASY.followSeconds`, never more than `EASY.maxYawLag`
 *            behind), plus a LOOK OFFSET the mouse adds. `EASY.recenterDelay` after the last mouse input, while you move or turn, the
 *            offset swings back to 0 (behind you); standing still it stays where you left it, and a drag in progress is never
 *            fought. A and D turn your heading, so they turn the view. In first person the view is glued to the heading and the
 *            mouse turns the body (`absorbLook`).
 *   classic  you steer the camera with the mouse and it never swings by itself; walking is camera-relative.
 *
 *   follow point     trails your head by `CHASE.lagSeconds` (critically damped), so the camera glides, and never by more
 *                    than `CHASE.maxFollowLag`, so you cannot leave the picture
 *   yaw and pitch    smoothed separately; yaw (0.05 s) follows faster than pitch (0.07 s)
 *   shoulder         the pivot sits `CHASE.shoulder` metres to the camera's right of your head. Both sides of your head are swept
 *                    sideways every frame with a small ball. With a wall at the side you ride, and clear room on the other, the
 *                    pivot GLIDES across to the other shoulder (about 0.35 s, held at least 1.2 s, and back to your preferred
 *                    shoulder only after it has been clear for a moment, so a doorway does not flip it; the Q key chooses the
 *                    preferred one). With walls on both sides the pivot slides in over your head instead; it comes in at once
 *                    and grows back slowly, like the boom. It never swaps in first person
 *   boom             a camera-sized ball is swept from the (real) pivot to where the camera wants to be, and a second sweep looks
 *                    0.16 s ahead along the camera's own motion, so the pull-in has started when it reaches a wall. A wall
 *                    shortens the boom at once and it grows back over half a second; the camera is never allowed past the
 *                    swept length. The floor and the ceiling (per area, `ceilingHeight`) are also enforced geometrically.
 *   near wall        when the swept camera is still within `CHASE.nearWall` of a wall (beside it or behind it), it rises and comes in a
 *                    little (more pitch, a shorter boom) instead of hugging the wall; the sweeps are redone along that boom
 *   first person     the boom collapses into your eyes; the pose and the lens blend over 0.3 s; the avatar fades out
 *
 * Every smoother comes to an EXACT rest (`REST` in chaseMath.ts), so text over the picture never trails.
 */
import { PerspectiveCamera, Vector3 } from 'three'
import type { Vec3 } from '@/sim/types'
import type { BoomProbe } from './boomProbe'
import { DEFAULT_SCHEME, type ControlScheme } from './scheme'
import {
  angleDelta,
  approach,
  avatarFade,
  boomAfterHit,
  boomWithinSlab,
  chaseFov,
  clamp,
  dampAngle,
  dampAngleRest,
  dampVec3,
  defaultBoom,
  dragOrbit,
  followYawStep,
  lerp,
  limitFollowLag,
  lookAheadFor,
  lookTargetFor,
  minPitchAboveGround,
  newDamped,
  orbitOffset,
  rightOf,
  smooth01,
  smoothBoom,
  smoothDamp,
  wrapAngle,
  zoomBoom,
  REST,
  type DampedVec3,
} from './chaseMath'
import { BODY, CHASE, EASY } from './tuning'

export interface CameraSubject {
  /** Where your feet are. */
  feet: Vec3
  /** Ground velocity, m/s: the look-ahead, and "are you moving" for the swing back behind you, read it. */
  vx: number
  vz: number
  /** The way your body faces (the easy scheme's camera follows it; the classic scheme ignores it). */
  heading: number
  /** The body is turning on the spot (A or D held): that counts as moving when the easy camera decides to swing back behind you. */
  turning: boolean
}

export interface CameraFrame {
  dt: number
  /** Mouse look pixels and wheel units since last frame. */
  dx: number
  dy: number
  wheel: number
  /** A mouse drag is in progress (even if the mouse is held still): the easy camera does not swing back then. */
  dragging: boolean
  firstPerson: boolean
  /** The floor's height under you (the camera never goes below it). */
  floorY: number
}

export interface CameraReport {
  /** The boom length now, metres (0 in first person). */
  boom: number
  /** 0..1: how visible your avatar should be (0 in first person and when the boom is squeezed shorter than `CHASE.hideAvatarBelow`). */
  avatarFade: number
  /** Wheel pulled in past the limit (or back out of first person): the owner should toggle first person. */
  wantsFirstPerson: boolean
  /** The way the camera faces on the ground (compass radians), and its pitch in degrees (positive looks down). */
  yaw: number
  pitchDeg: number
  /** Distance from the camera to what it looks at. */
  distance: number
  /** What the camera looks at. */
  target: Vec3
}

const _pos = new Vector3()
const _look = new Vector3()
const _dir = { x: 0, y: 0, z: 0 }
const _dirP = { x: 0, y: 0, z: 0 }
const _aim = { x: 0, y: 0, z: 0 }
const _ahead = { x: 0, z: 0 }
const _pivot = { x: 0, y: 0, z: 0 }
const _head = { x: 0, y: 0, z: 0 }
const _right = { x: 0, y: 0, z: 0 }
const _left = { x: 0, y: 0, z: 0 }
const _nd = { x: 0, y: 0, z: 0 }
const _np = { x: 0, y: 0, z: 0 }
const _o = { x: 0, y: 0, z: 0 }
const _po = { x: 0, y: 0, z: 0 }

/** The glide between the shoulders is a critically damped spring; it is within 1 % after 3.32 smoothing times. */
const SWAP_SMOOTH_SECONDS = CHASE.swapGlideSeconds / 3.32

/** The ways the nearest wall to the lens is looked for: (forward, right) shares of the camera's own horizontal frame: both sides, behind, and diagonally behind. */
const NEAR_DIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, -1],
  [-1, 0],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
]

/**
 * How long the boom may be before the camera would be above the ceiling at some point along it (the ceiling is per area, and the
 * boom can run from the atrium's open sky into a room): the boom is sampled every `CHASE.ceilingStep` metres.
 */
export function boomWithinCeilings(probe: BoomProbe, origin: Vec3, dir: Vec3, length: number): number {
  if (dir.y <= 1e-6) return length
  let limit = length
  const steps = Math.ceil(length / CHASE.ceilingStep)
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(length, i * CHASE.ceilingStep)
    const c = probe.ceilingAt(origin.x + dir.x * t, origin.z + dir.z * t)
    if (c === null) continue
    const lim = (c - CHASE.ceilingClearance - origin.y) / dir.y
    if (t > lim && lim < limit) limit = Math.max(lim, 0)
  }
  return limit
}

/** How long the boom may be along `dir` from `pivot`: the ball sweep against the walls, and the floor and the ceilings. */
function sweepBoom(probe: BoomProbe, pivot: Vec3, dir: Vec3, length: number, minY: number): number {
  const hit = boomAfterHit(length, probe.cast(pivot, dir, length, CHASE.probeRadius), CHASE.wallMargin, CHASE.minBoom)
  const slab = boomWithinSlab(pivot.y, dir.y, length, minY, Infinity)
  return boomWithinCeilings(probe, pivot, dir, Math.min(hit, slab))
}

export class ChaseCamera {
  /**
   * Where you are steering the camera to (compass radians the camera faces), and its elevation above the pivot. In the easy scheme
   * the yaw is derived (your heading, lazily followed, plus the look offset): use `setLook` to change the view from outside.
   */
  yaw = 0
  pitch = defaultBoom().pitch
  /** The boom the wheel asks for. */
  dist = defaultBoom().dist
  private yawS = 0
  private pitchS = this.pitch
  private distS = this.dist
  private readonly yawVel = { v: 0 }
  private readonly pitchVel = { v: 0 }
  private readonly distVel = { v: 0 }
  private follow: DampedVec3 = newDamped({ x: 0, y: 0, z: 0 })
  /** Share of the wanted boom that is free (1 = nothing in the way). */
  private fraction = 1
  /**
   * How far the pivot is moved out over your shoulder now, metres, along the camera's right: positive over the right shoulder,
   * negative over the left (it is pulled in by a wall at your side, and glides across when the shoulder swaps).
   */
  private lateral: number = CHASE.shoulder
  /** The shoulder you prefer (the Q key's choice) and the one the camera is on, or gliding to: 1 is the right, -1 the left. */
  private preferred: 1 | -1 = 1
  private side: 1 | -1 = 1
  /** Where the pivot is between the shoulders, -1..1: `side`, smoothed. */
  private bias = 1
  private readonly biasVel = { v: 0 }
  /** The room each side of your head has for the pivot, metres: in at once, out slowly (like the boom). */
  private freeR: number = CHASE.shoulder
  private freeL: number = CHASE.shoulder
  /** Seconds left before the side may change again, and how long the preferred side has been clear while you are on the other. */
  private sideHold = 0
  private backTime = 0
  /** Q was pressed and the camera could not answer yet (first person). */
  private manualPending = false
  private swapCount = 0
  /** 1 = the camera is where it wants to be; lower = softened away from a wall by this much (in at once, out slowly). */
  private comfort = 1
  private firstPerson = 0
  // look-ahead and the motion the second sweep extrapolates
  private readonly aheadS = { x: 0, z: 0 }
  private readonly aheadVelX = { v: 0 }
  private readonly aheadVelZ = { v: 0 }
  private prevYawS = 0
  private readonly prevFollow = { x: 0, y: 0, z: 0 }
  private havePrev = false

  // the easy scheme
  private scheme: ControlScheme
  /** Your heading, lazily followed (radians): the camera's yaw is this plus the look offset. */
  private followYaw = 0
  private readonly followYawVel = { v: 0 }
  /** The look offset the mouse adds to the followed heading, radians (the target, and as drawn), and the swing back's own state. */
  private offset = 0
  private offsetS = 0
  private readonly offsetVel = { v: 0 }
  private readonly recenterVel = { v: 0 }
  private readonly recenterPitchVel = { v: 0 }
  /** Seconds since the last mouse look (or drag). */
  private sinceLook = Infinity

  private readonly report: CameraReport = { boom: 0, avatarFade: 1, wantsFirstPerson: false, yaw: 0, pitchDeg: 0, distance: 0, target: { x: 0, y: 0, z: 0 } }

  constructor(scheme: ControlScheme = DEFAULT_SCHEME) {
    this.scheme = scheme
  }

  /** Put the camera at rest behind you: `yaw` is the way it faces (your heading). The shoulder pose is its resting state. */
  reset(feet: Vec3, yaw: number, pivotHeight: number = CHASE.pivotHeight): void {
    const b = defaultBoom()
    this.yaw = yaw
    this.yawS = yaw
    this.pitch = b.pitch
    this.pitchS = b.pitch
    this.dist = b.dist
    this.distS = b.dist
    this.yawVel.v = this.pitchVel.v = this.distVel.v = 0
    this.followYaw = yaw
    this.followYawVel.v = 0
    this.offset = this.offsetS = 0
    this.offsetVel.v = this.recenterVel.v = this.recenterPitchVel.v = 0
    this.sinceLook = Infinity
    this.aheadS.x = this.aheadS.z = 0
    this.aheadVelX.v = this.aheadVelZ.v = 0
    this.follow = newDamped({ x: feet.x, y: feet.y + pivotHeight, z: feet.z })
    this.havePrev = false
    this.fraction = 1
    this.firstPerson = 0
    // the preferred shoulder is the resting state (a wall beside you swaps it at once: the first frames of the settle)
    this.side = this.preferred
    this.bias = this.preferred
    this.biasVel.v = 0
    this.freeR = CHASE.shoulder
    this.freeL = CHASE.shoulder
    this.lateral = CHASE.shoulder * this.preferred
    this.sideHold = 0
    this.backTime = 0
    this.manualPending = false
    this.swapCount = 0
    this.comfort = 1
  }

  /** Is the camera currently in or heading for first person? */
  get inFirstPerson(): boolean {
    return this.firstPerson > 0.5
  }

  /** How far into first person the blend is, 0..1. */
  get firstPersonBlend(): number {
    return this.firstPerson
  }

  /** The camera's facing yaw (smoothed), for steering relative to what you see. */
  get facing(): number {
    return this.yawS
  }

  /** The pitch (elevation above the pivot, radians; positive looks down) as drawn. */
  get drawnPitch(): number {
    return this.pitchS
  }

  /** The mouse look offset from "behind you" in the easy scheme, radians as drawn (0 when the camera is behind you). Always 0 in classic. */
  get lookOffset(): number {
    return this.offsetS
  }

  /** The scheme in use. */
  get controlScheme(): ControlScheme {
    return this.scheme
  }

  /** The shoulder offset in use now, metres, along the camera's right: positive over the right shoulder, negative over the left. */
  get shoulderOffset(): number {
    return this.lateral
  }

  /** The shoulder the camera is on, or gliding to: 1 the right, -1 the left. */
  get shoulderSide(): 1 | -1 {
    return this.side
  }

  /** The shoulder you prefer (the Q key toggles it): 1 the right, -1 the left. */
  get preferredShoulder(): 1 | -1 {
    return this.preferred
  }

  /** How many times the camera has changed shoulder since the last `reset` (a wall beside you, or Q). */
  get shoulderSwaps(): number {
    return this.swapCount
  }

  /** How much the camera is eased away from a nearby wall now, 0 (not at all) to 1. */
  get softening(): number {
    return 1 - this.comfort
  }

  /**
   * The Q key: prefer the other shoulder. The camera glides there at once, unless that side is walled in (the automatic swap
   * would only send it back) or you are in first person (it follows when you leave).
   */
  toggleShoulder(): void {
    this.preferred = this.preferred === 1 ? -1 : 1
    this.manualPending = true
  }

  /** You were put down somewhere else (a teleport, a seat): the chase point lands on you at once, the view is kept. */
  snap(feet: Vec3, pivotHeight: number = CHASE.pivotHeight): void {
    this.follow = newDamped({ x: feet.x, y: feet.y + pivotHeight, z: feet.z })
    this.havePrev = false
    this.fraction = 1
  }

  /**
   * Look along `yaw` (the camera swings there smoothly), at the default elevation if `pitch` is omitted. In the easy scheme that is a
   * look offset from your heading, held like any mouse look (it swings back once you move on).
   */
  setLook(yaw: number, pitch?: number): void {
    this.yaw = yaw
    if (this.scheme === 'easy') {
      this.offset = angleDelta(this.followYaw, yaw)
      this.sinceLook = 0
    }
    if (pitch !== undefined) this.pitch = pitch
  }

  /**
   * First person, easy scheme: through your own eyes the mouse turns the BODY. Call once a frame after `update`: it moves the look
   * offset into the heading, over `EASY.firstPersonLookSeconds`, and returns the radians to add to the heading. The follow yaw moves
   * by the same amount, so the view itself does not move at all (the offset leaves the picture as the heading arrives in it), and the
   * last of it is taken in one go (`REST`), so the offset ends exactly at 0. Returns 0 in the classic scheme.
   */
  absorbLook(dt: number): number {
    if (this.scheme !== 'easy' || this.offset === 0) return 0
    const tiny = Math.abs(this.offset) < REST.position
    const d = tiny ? this.offset : this.offset * (1 - Math.exp(-Math.max(dt, 0) / EASY.firstPersonLookSeconds))
    this.followYaw = wrapAngle(this.followYaw + d)
    this.offset = tiny ? 0 : this.offset - d
    this.offsetS = wrapAngle(this.offsetS - d)
    return d
  }

  /** Change the scheme (a setting): the view is carried over without a jump, and the easy camera then swings in behind you. */
  setScheme(to: ControlScheme): void {
    if (to === this.scheme) return
    this.scheme = to
    if (to === 'easy') {
      this.followYaw = this.yawS
      this.followYawVel.v = this.yawVel.v
      this.offset = this.offsetS = 0
      this.offsetVel.v = this.recenterVel.v = this.recenterPitchVel.v = 0
      this.sinceLook = Infinity
    } else {
      this.yaw = this.yawS
      this.yawVel.v = 0
      this.offset = this.offsetS = 0
      this.offsetVel.v = this.recenterVel.v = this.recenterPitchVel.v = 0
    }
  }

  /** Leaving first person: the boom the camera comes back to (never closer than the wheel allows). */
  restoreBoom(): void {
    this.dist = Math.max(this.dist, CHASE.minDistance * 1.25)
  }

  /**
   * The shoulder for this frame. Both sides of your head are swept (`_right`, `_left` are set); each side's room is kept in at once and
   * out slowly, the side to ride is chosen (`chooseSide`), the pivot glides to it, and `lateral` is how far out over that shoulder it
   * sits: never more than the room the sweep found on that side, so the pivot is a place the camera ball can stand all the way across.
   */
  private shoulderStep(probe: BoomProbe, dt: number, fpWanted: boolean): void {
    const S = CHASE.shoulder
    const rawR = boomAfterHit(S, probe.cast(_head, _right, S, CHASE.shoulderProbeRadius), CHASE.wallMargin, 0)
    const rawL = boomAfterHit(S, probe.cast(_head, _left, S, CHASE.shoulderProbeRadius), CHASE.wallMargin, 0)
    this.freeR = Math.min(smoothBoom(this.freeR, rawR, dt, CHASE.shortenSeconds, CHASE.lengthenSeconds), rawR)
    this.freeL = Math.min(smoothBoom(this.freeL, rawL, dt, CHASE.shortenSeconds, CHASE.lengthenSeconds), rawL)
    this.chooseSide(rawR, rawL, dt, !fpWanted && this.firstPerson <= 0)
    this.bias = smoothDamp(this.bias, this.side, this.biasVel, SWAP_SMOOTH_SECONDS, dt)
    this.lateral = this.bias * (this.bias >= 0 ? this.freeR : this.freeL)
  }

  /**
   * Which shoulder to ride. `rawR` and `rawL` are the free room (metres, up to `CHASE.shoulder`) on each side of your head now.
   * You change side when the one you ride is nearly walled in and the other is clearly open; you go back to the preferred one only
   * when it has stayed open for `swapBackSeconds`; a side is held for `swapHoldSeconds` (Q is the one thing that skips the hold).
   * `canSwap` is false in first person: nothing changes then.
   */
  private chooseSide(rawR: number, rawL: number, dt: number, canSwap: boolean): void {
    const S = CHASE.shoulder
    if (this.sideHold > 0) this.sideHold = Math.max(0, this.sideHold - dt)
    if (!canSwap) {
      this.backTime = 0
      return
    }
    const here = this.side === 1 ? rawR : rawL
    const other = this.side === 1 ? rawL : rawR
    const wanted = this.preferred === 1 ? rawR : rawL
    if (this.manualPending) {
      this.manualPending = false
      if (this.side !== this.preferred && wanted >= S * CHASE.swapGiveUpBelow) this.setSide(this.preferred)
      return
    }
    if (this.side !== this.preferred && wanted >= S * CHASE.swapBackAtLeast) this.backTime += dt
    else this.backTime = 0
    if (this.sideHold > 0) return
    if (here < S * CHASE.swapGiveUpBelow && other >= S * CHASE.swapOtherAtLeast && other - here >= CHASE.swapGainMin) {
      this.setSide(this.side === 1 ? -1 : 1)
    } else if (this.side !== this.preferred && this.backTime >= CHASE.swapBackSeconds) {
      this.setSide(this.preferred)
    }
  }

  private setSide(side: 1 | -1): void {
    this.side = side
    this.sideHold = CHASE.swapHoldSeconds
    this.backTime = 0
    this.swapCount++
  }

  /**
   * The distance from the lens (`p`, moved `shift` metres along the camera's right) to the nearest wall within `CHASE.nearWall`,
   * looking both sides, behind and diagonally behind; Infinity if none.
   */
  private wallNearLens(probe: BoomProbe, p: Vec3, shift: number): number {
    const fx = Math.sin(this.yawS)
    const fz = Math.cos(this.yawS)
    _np.x = p.x + _right.x * shift
    _np.y = p.y
    _np.z = p.z + _right.z * shift
    let nearest = Infinity
    for (let i = 0; i < NEAR_DIRS.length; i++) {
      const ahead = NEAR_DIRS[i][0]
      const right = NEAR_DIRS[i][1]
      _nd.x = fx * ahead + _right.x * right
      _nd.z = fz * ahead + _right.z * right
      const hit = probe.cast(_np, _nd, CHASE.nearWall, 0)
      if (hit !== null && hit < nearest) nearest = hit
    }
    return nearest
  }

  /**
   * The easy scheme's yaw for this frame: your heading, followed lazily (glued in first person), plus the look offset, which swings back
   * to 0 `EASY.recenterDelay` after the last mouse input while you move or turn (never during a drag, and never while you stand still).
   * Everything ends in an exact rest.
   */
  private easyYawStep(subject: CameraSubject, f: CameraFrame, looking: boolean, dt: number): void {
    const fpWanted = f.firstPerson
    if (looking || f.dragging) this.sinceLook = 0
    else this.sinceLook += dt
    this.followYaw = followYawStep(this.followYaw, subject.heading, this.followYawVel, fpWanted ? EASY.firstPersonFollowSeconds : EASY.followSeconds, EASY.maxYawLag, dt)
    const moving = Math.hypot(subject.vx, subject.vz) > EASY.movingSpeed || subject.turning
    if (!f.dragging && moving && this.sinceLook >= EASY.recenterDelay) {
      this.offset = wrapAngle(dampAngleRest(this.offset, 0, this.recenterVel, EASY.recenterSeconds, dt))
      this.pitch = smoothDamp(this.pitch, fpWanted ? 0 : defaultBoom().pitch, this.recenterPitchVel, EASY.recenterSeconds, dt)
    } else {
      this.recenterVel.v = 0
      this.recenterPitchVel.v = 0
    }
    this.offsetS = wrapAngle(dampAngleRest(this.offsetS, this.offset, this.offsetVel, CHASE.yawSeconds, dt))
    this.yaw = wrapAngle(this.followYaw + this.offset)
    this.yawS = wrapAngle(this.followYaw + this.offsetS)
  }

  update(subject: CameraSubject, f: CameraFrame, probe: BoomProbe, camera: PerspectiveCamera): CameraReport {
    const dt = Math.min(Math.max(f.dt, 0), 0.05)
    const report = this.report
    report.wantsFirstPerson = false
    const fpWanted = f.firstPerson
    const easy = this.scheme === 'easy'

    // ---- your input
    const looking = f.dx !== 0 || f.dy !== 0
    if (looking) {
      const lo = fpWanted ? -CHASE.firstPersonPitch : CHASE.minPitch
      const hi = fpWanted ? CHASE.firstPersonPitch : CHASE.maxPitch
      // easy: the mouse turns the look OFFSET around your heading; classic: the view itself
      const r = dragOrbit(easy ? this.offset : this.yaw, this.pitch, f.dx, f.dy, lo, hi)
      if (easy) this.offset = r.yaw
      else this.yaw = r.yaw
      this.pitch = r.pitch
    }
    if (!fpWanted && this.pitch > CHASE.maxPitch) this.pitch = CHASE.maxPitch
    if (!fpWanted && this.pitch < CHASE.minPitch) this.pitch = CHASE.minPitch
    if (f.wheel !== 0) {
      if (fpWanted) {
        if (f.wheel > 0) report.wantsFirstPerson = true // pulling back leaves first person: the owner toggles it
      } else {
        const next = zoomBoom(this.dist, f.wheel)
        if (next < CHASE.firstPersonBelow) report.wantsFirstPerson = true
        this.dist = clamp(next, CHASE.minDistance, CHASE.maxDistance)
      }
    }

    // ---- smoothing: yaw quicker than pitch
    if (easy) this.easyYawStep(subject, f, looking, dt)
    else this.yawS = dampAngle(this.yawS, this.yaw, this.yawVel, CHASE.yawSeconds, dt)
    this.pitchS = smoothDamp(this.pitchS, this.pitch, this.pitchVel, CHASE.pitchSeconds, dt)
    this.distS = smoothDamp(this.distS, this.dist, this.distVel, CHASE.zoomSeconds, dt)

    // ---- your head, the shoulder pivot, the chase point
    const feet = subject.feet
    _head.x = feet.x
    _head.y = feet.y + CHASE.pivotHeight
    _head.z = feet.z
    rightOf(this.yawS, _right)
    _left.x = -_right.x
    _left.z = -_right.z
    // the shoulder, swept sideways on both sides first: a wall at the side you ride swaps you across (or pulls the pivot in over
    // your head, if the other side is walled too), at once, and it grows back slowly
    this.shoulderStep(probe, dt, fpWanted)
    _pivot.x = _head.x + _right.x * this.lateral
    _pivot.y = _head.y
    _pivot.z = _head.z + _right.z * this.lateral
    dampVec3(this.follow, _head, CHASE.lagSeconds, dt)
    limitFollowLag(this.follow, _head, CHASE.maxFollowLag)
    const fx = this.follow.x + _right.x * this.lateral
    const fy = this.follow.y
    const fz = this.follow.z + _right.z * this.lateral
    const pitchEff = Math.max(this.pitchS, minPitchAboveGround(this.distS, _pivot.y - f.floorY, CHASE.floorClearance))
    const o = orbitOffset(this.yawS, pitchEff, _o)
    const wx = fx + o.x * this.distS - _pivot.x
    const wy = fy + o.y * this.distS - _pivot.y
    const wz = fz + o.z * this.distS - _pivot.z
    const want = Math.max(Math.hypot(wx, wy, wz), 1e-3)
    _dir.x = wx / want
    _dir.y = wy / want
    _dir.z = wz / want

    // ---- the boom: sweep a ball from the real pivot, keep the camera between floor and ceiling
    const minY = f.floorY + CHASE.floorClearance
    const allowed = sweepBoom(probe, _pivot, _dir, want, minY)
    const freeNow = clamp(allowed / want, 0, 1)
    // a second sweep where the camera is about to be (its own yaw and follow-point motion, a few frames ahead): the pull-in
    // starts before the wall is reached, so it is a glide and not a snap
    let freeSoon = freeNow
    if (this.havePrev && dt > 1e-4) {
      const lead = CHASE.anticipateSeconds
      const yawRate = angleDelta(this.prevYawS, this.yawS) / dt
      const fvx = (this.follow.x - this.prevFollow.x) / dt
      const fvy = (this.follow.y - this.prevFollow.y) / dt
      const fvz = (this.follow.z - this.prevFollow.z) / dt
      const po = orbitOffset(this.yawS + yawRate * lead, pitchEff, _po)
      let px = fx + fvx * lead + po.x * this.distS - _pivot.x
      let py = fy + fvy * lead + po.y * this.distS - _pivot.y
      let pz = fz + fvz * lead + po.z * this.distS - _pivot.z
      // how far the camera is about to move; the look-ahead fades in over that motion, so it is continuous: at rest the second
      // sweep is the first one, and a camera creeping at the end of a glide cannot flip the pull-in on and off
      const moved = Math.hypot(px - wx, py - wy, pz - wz)
      if (moved > CHASE.anticipateFloor) {
        const k = smooth01((moved - CHASE.anticipateFloor) / CHASE.anticipateRamp)
        px = wx + (px - wx) * k
        py = wy + (py - wy) * k
        pz = wz + (pz - wz) * k
        const wantP = Math.max(Math.hypot(px, py, pz), 1e-3)
        _dirP.x = px / wantP
        _dirP.y = py / wantP
        _dirP.z = pz / wantP
        freeSoon = Math.min(freeNow, clamp(sweepBoom(probe, _pivot, _dirP, wantP, minY) / wantP, 0, 1))
      }
    }
    this.fraction = smoothBoom(this.fraction, freeSoon, dt, CHASE.pullInSeconds, CHASE.lengthenSeconds)
    // never past the swept length, however the smoothing lags: no clipping into walls
    let boom = Math.min(want * this.fraction, want * freeNow)
    this.prevYawS = this.yawS
    this.prevFollow.x = this.follow.x
    this.prevFollow.y = this.follow.y
    this.prevFollow.z = this.follow.z
    this.havePrev = true
    // the safety net for a boom that runs from open sky into a room: the camera's own spot must be under ITS ceiling
    const ceil = probe.ceilingAt(_pivot.x + _dir.x * boom, _pivot.z + _dir.z * boom)
    if (ceil !== null && _dir.y > 1e-6) {
      const lim = (ceil - CHASE.ceilingClearance - _pivot.y) / _dir.y
      if (boom > lim) boom = Math.max(lim, 0)
    }
    _pos.set(_pivot.x + _dir.x * boom, _pivot.y + _dir.y * boom, _pivot.z + _dir.z * boom)

    // ---- near-wall softening: a wall still within reach of the lens (beside it or behind it) gets the camera lifted off it a little
    // (more pitch, a shorter boom). It is measured at the camera's own swept spot, which does not depend on the softening, so it
    // cannot feed back on itself, and as if the shoulder had already arrived (the pivot glides away from a wall it has just left:
    // that is the swap's work, and the camera does not bob for it); the sweeps are then repeated along the softened boom, so the
    // guarantees hold
    let kTarget = 0
    if (this.firstPerson < 1) {
      const d = this.wallNearLens(probe, _pos, (this.side === 1 ? this.freeR : -this.freeL) - this.lateral)
      if (d < CHASE.nearWall) kTarget = smooth01((CHASE.nearWall - d) / (CHASE.nearWall - CHASE.nearWallFull))
    }
    this.comfort = smoothBoom(this.comfort, 1 - kTarget, dt, CHASE.softenSeconds, CHASE.softenReleaseSeconds)
    const soft = 1 - this.comfort
    if (soft > 0) {
      const vx = _pos.x - _pivot.x
      const vy = _pos.y - _pivot.y
      const vz = _pos.z - _pivot.z
      const len = Math.hypot(vx, vy, vz)
      const horiz = Math.hypot(vx, vz)
      if (len > 1e-3 && horiz > 1e-3) {
        const elev = Math.atan2(vy, horiz)
        const elev2 = Math.min(elev + CHASE.nearWallPitch * soft, Math.max(elev, CHASE.maxPitch))
        const len2 = Math.max(len * (1 - CHASE.nearWallBoomCut * soft), Math.min(len, CHASE.nearWallMinBoom))
        const c = Math.cos(elev2)
        _dir.x = (vx / horiz) * c
        _dir.y = Math.sin(elev2)
        _dir.z = (vz / horiz) * c
        boom = Math.min(len2, sweepBoom(probe, _pivot, _dir, len2, minY))
        const ceil2 = probe.ceilingAt(_pivot.x + _dir.x * boom, _pivot.z + _dir.z * boom)
        if (ceil2 !== null && _dir.y > 1e-6) {
          const lim = (ceil2 - CHASE.ceilingClearance - _pivot.y) / _dir.y
          if (boom > lim) boom = Math.max(lim, 0)
        }
        _pos.set(_pivot.x + _dir.x * boom, _pivot.y + _dir.y * boom, _pivot.z + _dir.z * boom)
      }
    }

    // ---- look-ahead: the aim point leads you along the way you are going, eased in and out
    lookAheadFor(subject.vx, subject.vz, _ahead)
    this.aheadS.x = smoothDamp(this.aheadS.x, _ahead.x, this.aheadVelX, CHASE.lookAheadSmoothSeconds, dt)
    this.aheadS.z = smoothDamp(this.aheadS.z, _ahead.z, this.aheadVelZ, CHASE.lookAheadSmoothSeconds, dt)
    _aim.x = fx
    _aim.y = fy
    _aim.z = fz
    const t = lookTargetFor(_aim, this.yawS, _aim, this.aheadS)
    _look.set(t.x, t.y, t.z)

    // ---- first person
    this.firstPerson = approach(this.firstPerson, fpWanted ? 1 : 0, dt / CHASE.firstPersonBlend)
    if (this.firstPerson > 0) {
      const k = smooth01(this.firstPerson)
      const cp = Math.cos(this.pitchS)
      const ex = feet.x + Math.sin(this.yawS) * 0.1
      const ey = feet.y + BODY.eyeHeight
      const ez = feet.z + Math.cos(this.yawS) * 0.1
      const lx = ex + Math.sin(this.yawS) * cp * 4
      const ly = ey - Math.sin(this.pitchS) * 4
      const lz = ez + Math.cos(this.yawS) * cp * 4
      _pos.set(lerp(_pos.x, ex, k), lerp(_pos.y, ey, k), lerp(_pos.z, ez, k))
      _look.set(lerp(_look.x, lx, k), lerp(_look.y, ly, k), lerp(_look.z, lz, k))
    }

    // ---- write the camera
    const fov = chaseFov(this.firstPerson)
    camera.position.copy(_pos)
    camera.lookAt(_look)
    if (Math.abs(camera.fov - fov) > 1e-9) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }

    const dxl = _look.x - _pos.x
    const dyl = _look.y - _pos.y
    const dzl = _look.z - _pos.z
    const dl = Math.max(Math.hypot(dxl, dyl, dzl), 1e-4)
    report.boom = this.firstPerson > 0.99 ? 0 : boom
    report.avatarFade = avatarFade(boom, this.firstPerson)
    report.yaw = this.yawS
    report.pitchDeg = (Math.asin(clamp(-dyl / dl, -1, 1)) * 180) / Math.PI
    report.distance = dl
    report.target.x = _look.x
    report.target.y = _look.y
    report.target.z = _look.z
    return report
  }

  /**
   * Run the camera with no input until everything has settled (about two seconds), without a real camera in the loop: the pose it
   * would rest in right now. Used for the destination of the overview-to-walk flight, so the chase camera can take over from it
   * with no jump. Returns the report (the look target) and leaves the position and lens in `camera`.
   */
  settle(subject: CameraSubject, f: Omit<CameraFrame, 'dt' | 'dx' | 'dy' | 'wheel' | 'dragging'>, probe: BoomProbe, camera: PerspectiveCamera, frames = 150): CameraReport {
    const frame: CameraFrame = { ...f, dt: 1 / 60, dx: 0, dy: 0, wheel: 0, dragging: false }
    let r = this.report
    for (let i = 0; i < frames; i++) r = this.update(subject, frame, probe, camera)
    return r
  }
}
