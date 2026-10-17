/**
 * The player system: you, the doctor. A plain TypeScript class (no React state, no allocation per frame) that the `<Player />`
 * component steps once a frame at `FRAME_PRIORITY.player` (-10), after the simulation (-100) and before the camera rig (-1), the
 * label anchors (-0.5) and every <Html> label (0), so the text over the picture sees this frame's camera.
 *
 * What happens each frame (`update`):
 *   1. the keys: Tab flips between walking and the overview, V between third and first person, Q between the two shoulders;
 *   2. walking (`scheme.ts`): by default W and S walk along the way you face and A and D TURN you (the camera follows behind by
 *      itself); with `?controls=classic` W A S D are camera-relative and the mouse steers. Speeds and accel/brake come from
 *      `CONFIG.player`; the body circle slides along walls and furniture on the nav grid (`collision.ts`) and stands off other
 *      people (`motion.pushOutOfPerson`);
 *   3. the camera: the chase camera over your shoulder (the right, until a wall is there; Q chooses: `chaseCamera.ts`), or one of the two flights (`flight.ts`);
 *   4. write-back: `sim.movePlayer(...)` every frame, `sim.player.mode` / `.view`, your avatar's `fade`, `walkCam`, and `useWalk`
 *      when something the UI shows changes.
 *
 * The phases (`PlayerMode`): `walk` (the chase camera owns the lens, the overview rig is suspended), `toOverview` (our flight from
 * the shoulder pose to the overview or to a room's shot), `overview` (the rig owns the camera again; you stand where you left),
 * `toWalk` (our flight down to the shoulder pose). The rig is suspended for everything except `overview`; on the way back the
 * camera's pose is adopted into it (`setLookAt(pos, target, false)`) before it wakes, so nothing jumps.
 *
 * `sim` is a live binding (a Jump swaps it and carries you over): every frame reads it through `deps.getSim()` and never caches.
 */
import { PerspectiveCamera, Vector3 } from 'three'
import { cancelFlight, getRig, overviewPose, poseToLookAt, registerWalkBridge, OVERVIEW_FOV_DEG, type CameraPose, type RigHandle, type WalkBridge } from '@/scene/camera/cameraApi'
import { useFocus } from '@/scene/camera/focus.store'
import { groundHeightAt, PLAYER_SPAWN } from '@/sim/places'
import type { Simulation } from '@/sim/Simulation'
import type { Entity, PlayerViewKind, PlayerMode, Vec2 } from '@/sim/types'
import { WallBoxProbe, type BoomProbe } from './boomProbe'
import { ChaseCamera, type CameraFrame, type CameraSubject } from './chaseCamera'
import { approach, clamp, wrapAngle } from './chaseMath'
import { moveBody, newBodyMove, settle } from './collision'
import { ModeFlight, newFlightState, type FlightState } from './flight'
import { PlayerInput, type InputAxes } from './input'
import { facingFromVelocity, newVelocity, pushOutOfPerson, speedOf, stepVelocity, turnTowards, type Planar } from './motion'
import { DEFAULT_SCHEME, newSteering, newTurn, routeInput, stepTurn, turnedHeading, type ControlScheme } from './scheme'
import { useWalk, walkCam } from './state'
import { BODY, CHASE, CROWD, FLIGHT, MOVE } from './tuning'

export interface PlayerDeps {
  /** The one camera of the scene. */
  camera: PerspectiveCamera
  /** The element that hears the mouse (the canvas' parent). Null in node tests: the keys and the look are then fed by hand. */
  container?: HTMLElement | null
  /** The live hospital. A getter, because a Jump swaps the Simulation. */
  getSim: () => Simulation
  /** The walls and ceilings the camera is kept out of. Default: the building's. */
  probe?: BoomProbe
  /** The overview rig, if any. Default: the one registered in `cameraApi`. */
  getRig?: () => RigHandle | null
  /** Reduced motion: the flights jump. Default: the browser's preference. */
  reducedMotion?: () => boolean
  /** How the keys steer you: `easy` (A and D turn you, the camera follows) or `classic` (camera-relative WASD). Default `easy`; `index.tsx` reads `?controls=`. */
  scheme?: ControlScheme
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface PlayerSnapshot {
  phase: PlayerMode
  view: PlayerViewKind
  x: number
  z: number
  heading: number
  speed: number
  camera: { x: number; y: number; z: number }
  facing: number
  /** The mouse look offset from behind you, radians (easy scheme; 0 in classic). */
  lookOffset: number
  scheme: ControlScheme
}

/** The body counts as turning (so the easy camera swings back behind it) above this rate, radians per second. */
const TURNING_RATE = 0.15

// scratch vectors for reading the rig's pose (the rig wants three.js vectors; made once)
const _pos3 = new Vector3()
const _tgt3 = new Vector3()

export class PlayerSystem {
  readonly input = new PlayerInput()
  readonly chase: ChaseCamera
  /** The control scheme in use (fixed for the life of the system). */
  readonly scheme: ControlScheme
  private readonly flight = new ModeFlight()
  private readonly probe: BoomProbe
  private readonly deps: PlayerDeps

  private phase: PlayerMode = 'walk'
  private viewKind: PlayerViewKind = 'third'
  private x = PLAYER_SPAWN.at.x
  private z = PLAYER_SPAWN.at.z
  private heading = PLAYER_SPAWN.heading
  private speed = 0
  private readonly vel = newVelocity()
  private readonly feet = { x: 0, y: 0, z: 0 }
  private readonly subject: CameraSubject = { feet: this.feet, vx: 0, vz: 0, heading: 0, turning: false }
  private readonly frame: CameraFrame = { dt: 0, dx: 0, dy: 0, wheel: 0, dragging: false, firstPerson: false, floorY: 0 }
  private readonly steer = newSteering()
  /** The easy scheme's turning state (A and D). */
  private readonly turn = newTurn()
  private readonly axes: InputAxes = { forward: 0, right: 0, hurry: false }
  private readonly look = { dx: 0, dy: 0, wheel: 0 }
  private readonly move = newBodyMove()
  private readonly pushOut: Planar = { x: 0, z: 0 }
  private readonly settled: Vec2 = { x: 0, z: 0 }
  /** The sum of the pushes out of the people near you this frame (see `visitPerson`). */
  private pushX = 0
  private pushZ = 0
  private pushStep = 0

  // the camera
  private readonly lookTarget = { x: 0, y: 0, z: 0 }
  private avatarFadeNow = 1
  /** How visible you are at the chase camera's resting pose (the flight down to you lands on it). */
  private restFade = 1
  private readonly scratch = new PerspectiveCamera(CHASE.fov, 16 / 9, FLIGHT.walkNear, 500)
  private readonly flightFrom = newFlightState()
  private readonly flightTo = newFlightState()
  private flightEnd: 'walk' | 'overview' = 'walk'

  // slow state
  private wasBlocked = false
  private lastPublished: { mode: PlayerMode; view: PlayerViewKind; locked: boolean } = { mode: 'walk', view: 'third', locked: false }
  private disposed = false

  constructor(deps: PlayerDeps) {
    this.deps = deps
    this.scheme = deps.scheme ?? DEFAULT_SCHEME
    this.chase = new ChaseCamera(this.scheme)
    this.probe = deps.probe ?? new WallBoxProbe()
    const sim = deps.getSim()
    const existing = sim.player
    if (existing) {
      // a remount (hot reload, strict mode) or a Jump: carry on from where you are
      this.x = existing.x
      this.z = existing.z
      this.heading = existing.heading
      this.viewKind = existing.view
      this.phase = existing.mode === 'overview' || existing.mode === 'toOverview' ? 'overview' : 'walk'
    }
    settle(this.x, this.z, this.settled)
    this.x = this.settled.x
    this.z = this.settled.z
    this.feet.x = this.x
    this.feet.y = groundHeightAt(this.x, this.z)
    this.feet.z = this.z
    this.ensurePlayer(sim)
    this.input.onLockChange = (locked) => {
      walkCam.pointerLocked = locked
      this.publish()
    }
    if (deps.container) this.input.attach(deps.container)
    registerWalkBridge(this.bridge)
    if (this.phase === 'walk') this.enterWalkNow()
    else this.leaveWalkNow()
    this.syncSim(sim)
    this.publish()
  }

  /** What the room focus asks of us (see `cameraApi.WalkBridge`). */
  private readonly bridge: WalkBridge = {
    walking: () => this.phase !== 'overview',
    toOverview: (pose) => this.beginToOverview(pose),
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    registerWalkBridge(null)
    this.input.onLockChange = null
    this.input.dispose()
    this.flight.cancel()
    // leave the overview camera as we found it: awake
    const rig = this.rig()
    if (rig) {
      rig.suspended = false
      rig.enabled = true
    }
    walkCam.pointerLocked = false
  }

  // ------------------------------------------------------------------------------------------
  // The frame
  // ------------------------------------------------------------------------------------------

  /** One frame: input, the body, the camera (or a flight), the write-back. */
  update(rawDt: number): void {
    if (this.disposed) return
    const dt = clamp(rawDt, 0, 1 / 20)
    const sim = this.deps.getSim()
    this.ensurePlayer(sim)
    const input = this.input
    const blocked = walkCam.inputBlocked
    if (blocked !== this.wasBlocked) {
      this.wasBlocked = blocked
      if (blocked) {
        // an overlay owns the keyboard and mouse: let go of the keys and give the pointer back
        input.clear()
        input.releaseLock()
      }
    }
    input.listening = this.phase === 'walk' && !blocked
    if (!input.listening) input.discardPending()

    // Tab, V and Q (the keys are not heard at all while an overlay owns the keyboard); Q is only for walking, never in a flight
    if (!blocked) {
      if (input.take('walk')) this.toggleMode()
      if (input.take('firstPerson') && this.phase === 'walk') this.toggleFirstPerson()
      if (input.take('shoulderSwap') && this.phase === 'walk') this.chase.toggleShoulder()
    }

    switch (this.phase) {
      case 'walk':
        this.stepWalk(dt, !blocked, sim)
        this.cameraStep(dt)
        break
      case 'toWalk':
      case 'toOverview':
        this.standStill(dt)
        this.flightStep(dt)
        break
      default:
        this.standStill(dt)
        break
    }
    this.syncSim(sim)
    this.publish()
  }

  /** The body, one frame of walking. `control` is false while an overlay owns the keyboard: you stand still. */
  private stepWalk(dt: number, control: boolean, sim: Simulation): void {
    this.input.axes(this.axes)
    const forward = control ? this.axes.forward : 0
    const right = control ? this.axes.right : 0
    const easy = this.scheme === 'easy'
    // easy: A and D turn the body, before the direction is read, so a press moves you in this very frame (running only goes forward)
    if (easy) this.heading = turnedHeading(this.heading, stepTurn(this.turn, right, this.axes.hurry && forward > 0, dt))
    const steer = routeInput(this.scheme, forward, right, this.heading, this.chase.facing, this.steer)
    const wanting = steer.dirX !== 0 || steer.dirZ !== 0
    // backing up (S) is slower than walking and never runs
    const wish = wanting ? (this.axes.hurry && !steer.backing ? MOVE.hurrySpeed : MOVE.walkSpeed) * steer.speedFactor : 0
    stepVelocity(this.vel, steer.dirX, steer.dirZ, wish, dt)

    // the body slides along walls and furniture; what it did not move it does not carry
    const ox = this.x
    const oz = this.z
    moveBody(ox, oz, this.vel.x * dt, this.vel.z * dt, this.move)
    this.x = this.move.x
    this.z = this.move.z
    // other people are circles: stand off them (they step aside for you too)
    this.pushX = 0
    this.pushZ = 0
    this.pushStep = 1.5 * dt
    sim.entities.forEach(this.visitPerson)
    if (this.pushX !== 0 || this.pushZ !== 0) {
      moveBody(this.x, this.z, this.pushX, this.pushZ, this.move)
      this.x = this.move.x
      this.z = this.move.z
    }
    if (dt > 0) {
      const gx = this.x - ox
      const gz = this.z - oz
      const got = Math.hypot(gx, gz)
      const want = Math.hypot(this.vel.x * dt, this.vel.z * dt)
      if (want > 1e-6 && got < want * 0.97) {
        this.vel.x = gx / dt
        this.vel.z = gz / dt
      }
      // what the gait sees: the speed you really have (a wall has already taken what it took from the velocity)
      this.speed = speedOf(this.vel)
      if (this.speed < 0.02) this.speed = 0
    }

    // heading. Easy: you steer the body (A and D above; in first person the mouse too, `cameraStep`), so nothing turns it here.
    // Classic: through your own eyes you face where you look; otherwise the body turns to face where it goes
    if (easy) {
      /* the keys and the mouse steer the body */
    } else if (this.viewKind === 'first') {
      this.heading = turnTowards(this.heading, this.chase.facing, dt, MOVE.firstPersonTurnSeconds)
    } else {
      let target: number | null = null
      if (wanting && this.speed < 0.5) target = Math.atan2(steer.dirX, steer.dirZ)
      else target = facingFromVelocity(this.vel)
      if (target !== null) this.heading = turnTowards(this.heading, target, dt)
    }
    this.feet.x = this.x
    this.feet.y = groundHeightAt(this.x, this.z)
    this.feet.z = this.z
  }

  /** `sim.entities.forEach` callback: the push out of one person, added to this frame's. Prebound, so the frame allocates nothing. */
  private readonly visitPerson = (e: Entity): void => {
    if (e.id === 'player' || e.seated || e.anim === 'lie' || e.anim === 'sit') return
    if ((e.fade ?? 1) < 0.4) return
    const dx = e.position.x - this.x
    const dz = e.position.z - this.z
    if (dx > CROWD.scanRadius || dx < -CROWD.scanRadius || dz > CROWD.scanRadius || dz < -CROWD.scanRadius) return
    pushOutOfPerson(this.x, this.z, e.position.x, e.position.z, BODY.radius, this.pushStep, this.pushOut)
    this.pushX += this.pushOut.x
    this.pushZ += this.pushOut.z
  }

  /** Not walking (the overview, or a flight): you stand where you are, braking to a stop. */
  private standStill(dt: number): void {
    this.turn.rate = 0
    stepVelocity(this.vel, 0, 0, 0, dt)
    this.vel.x = 0
    this.vel.z = 0
    this.speed = 0
  }

  // ------------------------------------------------------------------------------------------
  // The camera
  // ------------------------------------------------------------------------------------------

  /** The chase camera for this frame. */
  private cameraStep(dt: number): void {
    const camera = this.deps.camera
    if (camera.near !== FLIGHT.walkNear) {
      camera.near = FLIGHT.walkNear
      camera.updateProjectionMatrix()
    }
    this.primeRig()
    const input = this.input
    input.takeLook(this.look)
    if (!input.listening) this.look.dx = this.look.dy = this.look.wheel = 0
    this.subject.vx = this.vel.x
    this.subject.vz = this.vel.z
    this.subject.heading = this.heading
    this.subject.turning = Math.abs(this.turn.rate) > TURNING_RATE
    const f = this.frame
    f.dt = dt
    f.dx = this.look.dx
    f.dy = this.look.dy
    f.wheel = this.look.wheel
    f.dragging = input.dragging && input.listening
    f.firstPerson = this.viewKind === 'first'
    f.floorY = this.feet.y
    const report = this.chase.update(this.subject, f, this.probe, camera)
    // easy, through your own eyes: the mouse turns the body (the view does not move: the look offset becomes heading)
    if (this.scheme === 'easy' && this.viewKind === 'first') this.heading = turnedHeading(this.heading, this.chase.absorbLook(dt))
    if (report.wantsFirstPerson) this.toggleFirstPerson()
    this.lookTarget.x = report.target.x
    this.lookTarget.y = report.target.y
    this.lookTarget.z = report.target.z
    this.avatarFadeNow = report.avatarFade
    walkCam.yaw = wrapAngle(this.chase.facing - this.heading)
    walkCam.facing = this.chase.facing
    walkCam.pitch = this.chase.drawnPitch
    walkCam.boom = report.boom
    walkCam.firstPerson = this.chase.firstPersonBlend
    walkCam.avatarFade = report.avatarFade
    walkCam.camera.x = camera.position.x
    walkCam.camera.y = camera.position.y
    walkCam.camera.z = camera.position.z
  }

  /** The walk-mode lens is the chase camera's; the rig must not touch the camera while we own it. */
  private primeRig(): void {
    const rig = this.rig()
    if (!rig) return
    if (!rig.suspended) rig.suspended = true
    if (rig.enabled) rig.enabled = false
  }

  private rig(): RigHandle | null {
    return this.deps.getRig ? this.deps.getRig() : getRig()
  }

  private reduced(): boolean {
    return this.deps.reducedMotion ? this.deps.reducedMotion() : prefersReducedMotion()
  }

  /** Where the camera is right now, as a flight's starting state. */
  private cameraState(out: FlightState): FlightState {
    const cam = this.deps.camera
    out.px = cam.position.x
    out.py = cam.position.y
    out.pz = cam.position.z
    out.tx = this.lookTarget.x
    out.ty = this.lookTarget.y
    out.tz = this.lookTarget.z
    out.fov = cam.fov
    return out
  }

  /** Put the chase camera at rest behind you and the lens in walk mode, at once (no flight): the app starts walking. */
  private enterWalkNow(): void {
    this.phase = 'walk'
    this.viewKind = 'third'
    this.primeRig()
    this.restPose(this.deps.camera)
    this.input.discardPending()
  }

  /** Hand the camera back to the rig at once (a remount while in the overview). */
  private leaveWalkNow(): void {
    this.phase = 'overview'
    const rig = this.rig()
    if (rig) {
      rig.suspended = false
      rig.enabled = true
    }
    const cam = this.deps.camera
    cam.fov = FLIGHT.overviewFov
    cam.near = FLIGHT.overviewNear
    cam.updateProjectionMatrix()
  }

  /**
   * Reset the chase camera behind you (facing the way you face) and let it settle: the pose it would rest in is written to
   * `camera` and the look target kept. It is where the flight down to you lands, so the chase camera takes over with no jump.
   */
  private restPose(camera: PerspectiveCamera): void {
    this.feet.x = this.x
    this.feet.y = groundHeightAt(this.x, this.z)
    this.feet.z = this.z
    this.vel.x = this.vel.z = 0
    this.subject.vx = 0
    this.subject.vz = 0
    this.subject.heading = this.heading
    this.subject.turning = false
    this.turn.rate = 0
    camera.near = FLIGHT.walkNear
    this.chase.reset(this.feet, this.heading)
    const report = this.chase.settle(this.subject, { firstPerson: false, floorY: this.feet.y }, this.probe, camera)
    camera.updateProjectionMatrix()
    this.lookTarget.x = report.target.x
    this.lookTarget.y = report.target.y
    this.lookTarget.z = report.target.z
    this.avatarFadeNow = report.avatarFade
    this.restFade = report.avatarFade
  }

  // ------------------------------------------------------------------------------------------
  // Walk <-> overview
  // ------------------------------------------------------------------------------------------

  private toggleMode(): void {
    if (this.phase === 'walk' || this.phase === 'toWalk') this.beginToOverview(null)
    else this.beginToWalk()
  }

  private toggleFirstPerson(): void {
    if (this.phase !== 'walk') return
    if (this.viewKind === 'third') {
      this.viewKind = 'first'
    } else {
      this.viewKind = 'third'
      this.chase.restoreBoom()
    }
  }

  /**
   * Fly out of walk mode: to `pose` (a room's shot) or, with null, the whole-building overview. You stay standing where you are.
   * Called by Tab, and by the room focus (`flyTo` while walking, via the bridge), so a "Go to..." choice is one swoop.
   */
  beginToOverview(pose: CameraPose | null): void {
    if (this.phase === 'overview') return
    const camera = this.deps.camera
    this.cameraState(this.flightFrom)
    if (pose) {
      poseToLookAt(pose, this.flightTo)
    } else {
      const whole = overviewPose(OVERVIEW_FOV_DEG, camera.aspect > 0.2 ? camera.aspect : 1.6)
      poseToLookAt(whole, this.flightTo)
    }
    this.flightTo.fov = FLIGHT.overviewFov
    this.phase = 'toOverview'
    this.flightEnd = 'overview'
    this.primeRig()
    this.input.releaseLock()
    this.input.clear()
    this.viewKind = 'third'
    this.vel.x = this.vel.z = 0
    this.startFlight()
  }

  private beginToWalk(): void {
    const camera = this.deps.camera
    // the room focus belongs to the overview: walking closes it, and stops any flight the rig was making
    cancelFlight()
    if (useFocus.getState().area !== null) useFocus.getState().setArea(null)
    // where the camera is now: the rig's pose, or (reversing a flight out) the flight's
    const rig = this.rig()
    if (this.phase === 'overview' && rig) {
      rig.getPosition(_pos3, false)
      rig.getTarget(_tgt3, false)
      this.flightFrom.px = _pos3.x
      this.flightFrom.py = _pos3.y
      this.flightFrom.pz = _pos3.z
      this.flightFrom.tx = _tgt3.x
      this.flightFrom.ty = _tgt3.y
      this.flightFrom.tz = _tgt3.z
      this.flightFrom.fov = camera.fov
    } else {
      this.cameraState(this.flightFrom)
    }
    this.primeRig()
    // where it lands: the chase camera at rest behind you. Computed on a scratch camera, so the flight's own writes are not disturbed.
    this.viewKind = 'third'
    this.restPose(this.scratch)
    this.avatarFadeNow = 1 // you are seen all the way down
    this.flightTo.px = this.scratch.position.x
    this.flightTo.py = this.scratch.position.y
    this.flightTo.pz = this.scratch.position.z
    this.flightTo.tx = this.lookTarget.x
    this.flightTo.ty = this.lookTarget.y
    this.flightTo.tz = this.lookTarget.z
    this.flightTo.fov = this.scratch.fov
    this.phase = 'toWalk'
    this.flightEnd = 'walk'
    this.input.clear()
    this.startFlight()
  }

  private startFlight(): void {
    const flying = this.flight.start(this.flightFrom, this.flightTo, this.reduced() ? 0 : FLIGHT.seconds)
    if (!flying) this.landFlight()
    else this.writeFlight()
  }

  /** One frame of a flight: advance it, write the camera, and land when it ends. */
  private flightStep(dt: number): void {
    // flying out, you come back into view if you were looking through your own eyes
    if (this.phase === 'toOverview') this.avatarFadeNow = approach(this.avatarFadeNow, 1, dt / 0.25)
    if (this.flight.active) {
      const done = this.flight.tick(dt)
      this.writeFlight()
      if (done) this.landFlight()
    }
  }

  private writeFlight(): void {
    const n = this.flight.now
    const cam = this.deps.camera
    cam.position.set(n.px, n.py, n.pz)
    cam.lookAt(n.tx, n.ty, n.tz)
    this.lookTarget.x = n.tx
    this.lookTarget.y = n.ty
    this.lookTarget.z = n.tz
    // the near plane goes where the lens is going once the camera is well on its way
    const p = this.flight.progress
    const near = this.flightEnd === 'walk' ? (p >= 0.6 ? FLIGHT.walkNear : FLIGHT.overviewNear) : p >= 0.4 ? FLIGHT.overviewNear : FLIGHT.walkNear
    if (near !== cam.near || Math.abs(cam.fov - n.fov) > 1e-9) {
      cam.near = near
      cam.fov = n.fov
      cam.updateProjectionMatrix()
    }
  }

  /** The flight is over: the camera is exactly at its destination. */
  private landFlight(): void {
    const n = this.flight.now
    const cam = this.deps.camera
    cam.position.set(n.px, n.py, n.pz)
    cam.lookAt(n.tx, n.ty, n.tz)
    this.lookTarget.x = n.tx
    this.lookTarget.y = n.ty
    this.lookTarget.z = n.tz
    cam.fov = n.fov
    if (this.flightEnd === 'walk') {
      cam.near = FLIGHT.walkNear
      cam.updateProjectionMatrix()
      this.phase = 'walk'
      this.avatarFadeNow = this.restFade
      this.input.discardPending()
    } else {
      cam.near = FLIGHT.overviewNear
      cam.updateProjectionMatrix()
      // adopt the pose into the rig, then wake it: the next frame it draws exactly this
      const rig = this.rig()
      if (rig) {
        void rig.setLookAt(n.px, n.py, n.pz, n.tx, n.ty, n.tz, false)
        rig.suspended = false
        rig.enabled = true
      }
      this.phase = 'overview'
      this.avatarFadeNow = 1
      walkCam.avatarFade = 1
      walkCam.firstPerson = 0
    }
  }

  // ------------------------------------------------------------------------------------------
  // Write-back and publishing
  // ------------------------------------------------------------------------------------------

  /** Make sure the sim has you (a Jump carries you over; a test or a remount may not have). */
  private ensurePlayer(sim: Simulation): void {
    if (!sim.player) sim.addPlayer({ at: { x: this.x, z: this.z }, heading: this.heading })
  }

  /** Tell the sim where you are, which mode you are in and how visible your avatar is. */
  private syncSim(sim: Simulation): void {
    const p = sim.player
    if (!p) return
    p.mode = this.phase
    p.view = this.viewKind
    const e = sim.playerAvatar
    // `movePlayer` sets walk or idle from the speed; a pose another system gave you (sitting, the tablet) stays while you stand still
    const keep = e && this.speed <= 0.05 && e.anim !== 'idle' && e.anim !== 'walk' ? e.anim : null
    sim.movePlayer(this.x, this.z, this.heading, this.speed)
    if (e && keep) e.anim = keep
    if (e) e.fade = this.avatarFadeNow
  }

  /** The slow copy for the UI: only when something it shows changes. */
  private publish(): void {
    const last = this.lastPublished
    const locked = this.input.locked
    if (last.mode === this.phase && last.view === this.viewKind && last.locked === locked) return
    last.mode = this.phase
    last.view = this.viewKind
    last.locked = locked
    walkCam.pointerLocked = locked
    useWalk.getState().set({ mode: this.phase, view: this.viewKind, pointerLocked: locked })
  }

  // ------------------------------------------------------------------------------------------
  // For other systems and for tests
  // ------------------------------------------------------------------------------------------

  /** Put you down at (x, z), on the nearest walkable spot, facing `heading` (a seat, a bedside, a debug jump). The view is kept. */
  placeAt(x: number, z: number, heading?: number): void {
    settle(x, z, this.settled)
    this.x = this.settled.x
    this.z = this.settled.z
    if (heading !== undefined) this.heading = heading
    this.vel.x = this.vel.z = 0
    this.speed = 0
    this.feet.x = this.x
    this.feet.y = groundHeightAt(this.x, this.z)
    this.feet.z = this.z
    this.chase.snap(this.feet)
  }

  get mode(): PlayerMode {
    return this.phase
  }

  snapshot(): PlayerSnapshot {
    const c = this.deps.camera.position
    return {
      phase: this.phase,
      view: this.viewKind,
      x: this.x,
      z: this.z,
      heading: this.heading,
      speed: this.speed,
      camera: { x: c.x, y: c.y, z: c.z },
      facing: this.chase.facing,
      lookOffset: this.chase.lookOffset,
      scheme: this.scheme,
    }
  }

  /** Where the camera looks right now (read only). */
  get lookingAt(): { readonly x: number; readonly y: number; readonly z: number } {
    return this.lookTarget
  }
}
