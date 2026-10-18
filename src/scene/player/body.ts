/**
 * The walking body as one pure object: no camera, no React, no DOM, no three.js. `BodyMover` turns the keys of one frame into a
 * position: the turn (easy scheme), the steering, the speed spring (`motion.ts`), the collide-and-slide against the static solids,
 * door leaves and anything that moves (`collision.ts`), and the numbers the rest of the app wants to know about the body
 * (`BodyState`, which the player system copies into the shared `walkBody` every frame: the legs, the doors, the camera and the quality
 * ladder read it). The player system drives one of these; the tests drive their own, frame by frame, with whatever dynamic shapes
 * they register.
 *
 * Easy scheme: ONE signed speed along the way the body faces (W forward, S backing up), the heading turned by A and D. Classic scheme:
 * a unit direction and a speed magnitude; the direction turns towards the wished one at most `CLASSIC_TURN_RATE` and a reversal beyond
 * `REVERSAL_ANGLE` slows to `REVERSAL_SPEED` first. In both the spring only ever sees the speed.
 *
 * Collision results are never written back into the spring, except head-on: when the body gets under `HEAD_ON` of the distance it wanted
 * (pushed against a wall or a person), its speed drops to what it achieved, so letting go of the key does not coast into the wall.
 *
 * Allocation free per frame: every vector is a field.
 */
import { CONFIG } from '@/sim/config'
import { angleDelta } from './chaseMath'
import { DynamicShapes, moveBody, newBodyMove, sweepToStop } from './collision'
import { SMOOTH_TIME, angleBetween, newSpring, restDistance, retarget, stepSpring, turnDirection } from './motion'
import { newSteering, newTurn, routeInput, stepTurn, turnedHeading, type ControlScheme, type Steering, type TurnState } from './scheme'

const P = CONFIG.player

/** The body's own feel numbers (the camera's are `tuning.ts`). */
export const BODY_FEEL = {
  /** Classic scheme: the fastest the direction of travel turns (rad/s), and the angle beyond which a reversal slows down first. */
  classicTurnRate: 10,
  reversalAngle: (100 * Math.PI) / 180,
  /** The speed a reversal slows to before it turns round (m/s). */
  reversalSpeed: 0.3,
  /** Below this speed (m/s) the body counts as standing (the spring's direction is free to snap to the wish). */
  restSpeed: 0.05,
  /** Head-on: under this share of the wanted distance, the speed drops to what was achieved. */
  headOn: 0.1,
  /** How fast a moving shape may push the body (m/s): a little more than a run. */
  pushSpeed: 4.5,
  /** Only shapes this near (metres) are collected. */
  scanRadius: 3,
  /** Door leaves this near (metres) are collected. */
  doorScanRadius: 6,
  /** A standing person's circle, a rider's, and the MealBot's (`BOT_RADIUS`, sim/meals/bot.ts). */
  npcRadius: 0.28,
  riderRadius: 0.4,
} as const

/** The numbers about the body that others read (the shape of `walkBody` in `state.ts`). */
export interface BodyState {
  live: boolean
  x: number
  z: number
  vx: number
  vz: number
  wishX: number
  wishZ: number
  ax: number
  az: number
  turnRate: number
  stopping: boolean
  restX: number
  restZ: number
  stillFor: number
}

export function newBodyState(): BodyState {
  return { live: false, x: 0, z: 0, vx: 0, vz: 0, wishX: 0, wishZ: 0, ax: 0, az: 0, turnRate: 0, stopping: false, restX: 0, restZ: 0, stillFor: 0 }
}

/** Copy every field of one body state into another (no allocation). */
export function copyBodyState(from: BodyState, to: BodyState): void {
  to.live = from.live
  to.x = from.x
  to.z = from.z
  to.vx = from.vx
  to.vz = from.vz
  to.wishX = from.wishX
  to.wishZ = from.wishZ
  to.ax = from.ax
  to.az = from.az
  to.turnRate = from.turnRate
  to.stopping = from.stopping
  to.restX = from.restX
  to.restZ = from.restZ
  to.stillFor = from.stillFor
}

/** The owner fills the dynamic shapes each frame (people, vehicles, bots...) through this; door leaves are collected by the mover itself. */
export type ShapeCollector = (shapes: DynamicShapes) => void

const _dir = { x: 0, z: 0 }
const _rest = { x: 0, z: 0 }

export class BodyMover {
  readonly scheme: ControlScheme
  x = 0
  z = 0
  /** Compass radians, atan2(dx, dz): 0 faces +z. */
  heading = 0
  readonly state: BodyState = newBodyState()
  readonly spring = newSpring()
  readonly turn: TurnState = newTurn()
  readonly steer: Steering = newSteering()
  readonly shapes = new DynamicShapes()
  /** Called each frame after the door leaves are collected: add people, vehicles, bots. */
  collect: ShapeCollector | null = null
  /** The speed actually achieved this frame (m/s), 0 below 0.02: what the avatar's gait gets. */
  speed = 0
  /** A move key is held this frame (the keys ask for a velocity). */
  wanting = false
  /** The last frame's move: how much of the wanted distance it got (for tests). */
  readonly move = newBodyMove()
  /** The unit direction of travel (classic scheme; the easy scheme's is its heading). */
  private dirX = 0
  private dirZ = 1
  private readonly turned = { x: 0, z: 1 }

  constructor(scheme: ControlScheme) {
    this.scheme = scheme
  }

  /** Stand at (x, z) facing `heading`, at rest (a spawn, a Jump, a seat). */
  place(x: number, z: number, heading?: number): void {
    this.x = x
    this.z = z
    if (heading !== undefined) this.heading = heading
    this.halt()
    this.state.x = x
    this.state.z = z
    this.state.restX = x
    this.state.restZ = z
  }

  /** Come to rest at once (the overview, a flight): no speed, no turn, no coast. */
  halt(): void {
    const s = this.spring
    s.v = 0
    s.a = 0
    s.target = 0
    s.T = SMOOTH_TIME.stop
    this.turn.rate = 0
    this.speed = 0
    this.wanting = false
    const b = this.state
    b.vx = 0
    b.vz = 0
    b.wishX = 0
    b.wishZ = 0
    b.ax = 0
    b.az = 0
    b.turnRate = 0
    b.stopping = false
    b.restX = this.x
    b.restZ = this.z
  }

  /** Already travelling at `speed` m/s along `facing` (compass radians), as if the key had long been held (a seamless hand-over, and the tests). */
  cruise(speed: number, facing: number): void {
    const s = this.spring
    s.v = speed
    s.a = 0
    s.target = speed
    s.T = SMOOTH_TIME.shift
    if (this.scheme === 'easy') {
      this.heading = facing
    } else {
      this.dirX = Math.sin(facing)
      this.dirZ = Math.cos(facing)
    }
  }

  /** Not walking (the overview, a flight, an overlay): at rest, and the seconds of standing still keep counting. */
  stand(dt: number): void {
    this.halt()
    this.state.live = true
    this.state.stillFor += dt
  }

  /** The unit direction the body moves in at positive speed. */
  private motionDir(out: { x: number; z: number }, heading: number): void {
    if (this.scheme === 'easy') {
      out.x = Math.sin(heading)
      out.z = Math.cos(heading)
    } else {
      out.x = this.dirX
      out.z = this.dirZ
    }
  }

  /**
   * One frame. `forward` is W (+1) minus S (-1), `right` is D (+1) minus A (-1), `hurry` is Shift, `cameraFacing` the way the camera faces
   * (compass radians; only the classic scheme reads it). `dt` is seconds, as the owner clamped it.
   */
  step(dt: number, forward: number, right: number, hurry: boolean, cameraFacing: number): void {
    const b = this.state
    b.live = true
    if (dt <= 0) return
    const easy = this.scheme === 'easy'
    const spring = this.spring
    const heading0 = this.heading
    // easy: A and D turn the body first, so a press moves you in this very frame (running only goes forward)
    if (easy) this.heading = turnedHeading(heading0, stepTurn(this.turn, right, hurry && forward > 0, dt))
    const steer = routeInput(this.scheme, forward, right, this.heading, cameraFacing, this.steer)
    const wanting = steer.dirX !== 0 || steer.dirZ !== 0
    this.wanting = wanting
    const wishSpeed = wanting ? (hurry && !steer.backing ? P.hurrySpeed : P.walkSpeed) * steer.speedFactor : 0

    // the target speed, and for classic the direction of travel
    let target = 0
    let reversal = false
    let dirAngle0 = 0
    let dirAngle1 = 0
    if (easy) {
      target = steer.backing ? -wishSpeed : wishSpeed
    } else if (wanting) {
      dirAngle0 = Math.atan2(this.dirX, this.dirZ)
      if (Math.abs(spring.v) < BODY_FEEL.restSpeed) {
        // from rest the body sets off straight the way it is asked to
        this.dirX = steer.dirX
        this.dirZ = steer.dirZ
        dirAngle0 = Math.atan2(this.dirX, this.dirZ)
        dirAngle1 = dirAngle0
      } else {
        turnDirection(this.dirX, this.dirZ, steer.dirX, steer.dirZ, BODY_FEEL.classicTurnRate * dt, this.turned)
        this.dirX = this.turned.x
        this.dirZ = this.turned.z
        dirAngle1 = dirAngle0 + angleDelta(dirAngle0, Math.atan2(this.dirX, this.dirZ))
      }
      const apart = angleBetween(this.dirX, this.dirZ, steer.dirX, steer.dirZ)
      reversal = apart > BODY_FEEL.reversalAngle
      target = reversal ? Math.min(wishSpeed, BODY_FEEL.reversalSpeed) : wishSpeed
    }
    if (reversal) retarget(spring, target, 'stop')
    else retarget(spring, target)

    // the distance of this frame, exactly, along the mid direction of the frame
    const dist = stepSpring(spring, dt)
    let ux: number
    let uz: number
    if (easy) {
      const mid = heading0 + angleDelta(heading0, this.heading) / 2
      ux = Math.sin(mid)
      uz = Math.cos(mid)
    } else {
      const mid = wanting ? (dirAngle0 + dirAngle1) / 2 : Math.atan2(this.dirX, this.dirZ)
      ux = Math.sin(mid)
      uz = Math.cos(mid)
    }

    // the moving shapes of this frame
    const shapes = this.shapes
    shapes.clear()
    shapes.maxPush = BODY_FEEL.pushSpeed * dt
    shapes.addBlockers(this.x, this.z, BODY_FEEL.doorScanRadius)
    if (this.collect) this.collect(shapes)

    const ox = this.x
    const oz = this.z
    const move = moveBody(ox, oz, ux * dist, uz * dist, this.move, shapes)
    this.x = move.x
    this.z = move.z

    // what the body really did
    const vx = (this.x - ox) / dt
    const vz = (this.z - oz) / dt
    const achieved = Math.hypot(vx, vz)
    const wanted = Math.abs(dist)
    // head-on: pressed against something, the speed is only what it got (never carried into the wall)
    if (wanted > 1e-9 && move.progress < BODY_FEEL.headOn) {
      const got = (wanted * move.progress) / dt
      spring.v = got < 1e-6 ? 0 : spring.v < 0 ? -got : got
      spring.a = 0
    }
    this.speed = achieved < 0.02 ? 0 : achieved

    // the numbers others read
    b.x = this.x
    b.z = this.z
    b.vx = vx
    b.vz = vz
    // the signed unit direction of the velocity at the end of the frame
    this.motionDir(_dir, this.heading)
    if (wanting) {
      if (easy) {
        const k = steer.backing ? -wishSpeed : wishSpeed
        b.wishX = _dir.x * k
        b.wishZ = _dir.z * k
      } else {
        b.wishX = steer.dirX * wishSpeed
        b.wishZ = steer.dirZ * wishSpeed
      }
    } else {
      b.wishX = 0
      b.wishZ = 0
    }
    b.ax = _dir.x * spring.a
    b.az = _dir.z * spring.a
    b.turnRate = easy ? angleDelta(heading0, this.heading) / dt : 0
    b.stopping = !wanting && achieved > BODY_FEEL.restSpeed
    if (achieved > BODY_FEEL.restSpeed) b.stillFor = 0
    else b.stillFor += dt
    // where it would come to rest if you let go now: the closed form of the spring's remaining travel, swept through the solids
    const rest = restDistance(spring)
    if (rest !== 0 && achieved > BODY_FEEL.restSpeed) {
      sweepToStop(this.x, this.z, _dir.x * rest, _dir.z * rest, _rest)
      b.restX = _rest.x
      b.restZ = _rest.z
    } else {
      b.restX = this.x
      b.restZ = this.z
    }
  }
}
