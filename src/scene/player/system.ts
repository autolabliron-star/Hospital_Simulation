/**
 * The player system: you, the doctor. A plain TypeScript class (no React state, no allocation per frame) that the `<Player />`
 * component steps once a frame at `FRAME_PRIORITY.player` (-10), after the simulation (-100) and before the camera rig (-1), the
 * label anchors (-0.5) and every <Html> label (0), so the text over the picture sees this frame's camera.
 *
 * Step 3 (a real place, not a game): you walk through your own eyes by default (`WALK_VIEW`: the start of the day, Tab back from the overview, leaving the
 * walkthrough from the overview), at the walkthrough's eye height and lens (1.6 m, 55 degrees), with a light look damping (`CHASE.eyeLookSeconds`), no
 * head bob and no avatar (your body fades out at the end of a flight down). V gives you the chase camera over your shoulder, and back.
 *
 * What happens each frame (`update`):
 *   1. the keys: Tab flips between walking and the overview, V between first and third person, Q between the two shoulders;
 *   2. walking (`scheme.ts`): by default W and S walk along the way you face and A and D TURN you (the camera follows behind by
 *      itself); with `?controls=classic` W A S D are camera-relative and the mouse steers. The body is a `BodyMover` (`body.ts`): a
 *      critically damped speed spring (`CONFIG.player` start / stop / shift seconds) and a collide-and-slide circle that cannot enter any
 *      wall, piece of furniture, closed door leaf, person, vehicle or MealBot (`collision.ts`, `solids.ts`, `sweep.ts`);
 *   3. the camera: the chase camera over your shoulder (the right, until a wall is there; Q chooses: `chaseCamera.ts`), or one of the two flights (`flight.ts`);
 *   4. write-back: `sim.movePlayer(...)` every frame, `sim.player.mode` / `.view`, your avatar's `fade`, `walkCam`, `walkBody` (the
 *      body's velocity, intent, acceleration and stop point, for the legs, the doors, the camera and the quality ladder) and `useWalk`
 *      when something the UI shows changes.
 *
 * The phases (`PlayerMode`): `walk` (the chase camera owns the lens, the overview rig is suspended), `toOverview` (our flight from
 * the shoulder pose to the overview or to a room's shot), `overview` (the rig owns the camera again; you stand where you left),
 * `toWalk` (our flight down to the shoulder pose). The rig is suspended for everything except `overview`; on the way back the
 * camera's pose is adopted into it (`setLookAt(pos, target, false)`) before it wakes, so nothing jumps.
 *
 * R2 LEVELS (docs/R2-SURGERY.md). The sim is flat and level 2 lives in its own strip of it (sim x = drawn x + 150, y floor-relative), so EVERYTHING here works in
 * SIM coordinates: the body, the collision, the boom probe, `chase`, `walkCam.camera` (the camera's sim position, for the sight tests of the bubbles and
 * emotes). The three.js camera is DRAWN: `present()` adds the level's offset (`levelDx`, `LEVEL_Y`: level 2 is shifted by (-150, +4.2, 0), the rotation is
 * untouched) to its position once, right after `chase.update` writes it (and after the settle of the resting pose). So the flights (`flight.ts`),
 * `cameraState()`, `lookingAt` and the rest pose all agree in drawn coordinates, and `placeAt` to the other level snaps the chase camera behind you there (no
 * flight across the map).
 *
 * `sim` is a live binding (a Jump swaps it and carries you over): every frame reads it through `deps.getSim()` and never caches.
 */
import { PerspectiveCamera, Vector3 } from 'three'
import { cancelFlight, getRig, overviewPose, poseToLookAt, registerWalkBridge, OVERVIEW_FOV_DEG, type CameraPose, type RigHandle, type WalkBridge } from '@/scene/camera/cameraApi'
import { useFocus } from '@/scene/camera/focus.store'
import { useOverviewLevel } from '@/scene/levels/levelView'
import { LEVEL_Y, levelDx, levelOf } from '@/sim/levels'
import { BOT_RADIUS } from '@/sim/meals/bot'
import { groundHeightAt, PLAYER_SPAWN, VEHICLE_AHEAD, VEHICLE_HALF } from '@/sim/places'
import type { Simulation } from '@/sim/Simulation'
import type { Entity, MealBot, PlayerViewKind, PlayerMode, Vec2 } from '@/sim/types'
import { Glide, type GlidePose } from '@/ui/present/glide'
import { PRESENT_VIEW_URL, presentActive, usePresentation } from '@/ui/present/presentation.store'
import { SHOTS, nextShot, prevShot, shotYaw, type Shot } from '@/ui/present/shots'
import { WallBoxProbe, type BoomProbe } from './boomProbe'
import { ChaseCamera, type CameraFrame, type CameraSubject } from './chaseCamera'
import { angleDelta, approach, clamp, smooth01, wrapAngle } from './chaseMath'
import { BodyMover, copyBodyState, BODY_FEEL } from './body'
import { settle, type DynamicShapes } from './collision'
import { ModeFlight, newFlightState, type FlightState } from './flight'
import { PlayerInput, type InputAxes } from './input'
import { facingFromVelocity, turnTowards } from './motion'
import { DEFAULT_SCHEME, turnedHeading, type ControlScheme } from './scheme'
import { useWalk, walkBody, walkCam } from './state'
import { BODY, CHASE, FLIGHT, MOVE, PRESENT, WALK_VIEW } from './tuning'

export { BodyMover } from './body'

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
  /**
   * The view walk mode starts in: at the start of the day, Tab back from the overview, leaving the walkthrough from the overview. Default
   * `WALK_VIEW.initial` (first person); V toggles it while walking. The chase camera's own tests ask for 'third'.
   */
  walkView?: PlayerViewKind
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
  /** The view every entry into walk mode starts in: through your own eyes by default (`WALK_VIEW`, step 3: a real place, not a game). */
  private readonly walkView: PlayerViewKind
  /** The view now; V toggles the chase camera over your shoulder and back. */
  private viewKind: PlayerViewKind
  /** The walking body: position, heading, the speed spring and the collision. Pure (`body.ts`). */
  readonly body: BodyMover
  private readonly feet = { x: 0, y: 0, z: 0 }
  private readonly subject: CameraSubject = { feet: this.feet, vx: 0, vz: 0, heading: 0, turning: false, eyeDrop: 0 }
  private readonly frame: CameraFrame = { dt: 0, dx: 0, dy: 0, wheel: 0, dragging: false, firstPerson: false, floorY: 0 }
  private readonly axes: InputAxes = { forward: 0, right: 0, hurry: false }
  private readonly look = { dx: 0, dy: 0, wheel: 0 }
  private readonly settled: Vec2 = { x: 0, z: 0 }
  /** The simulation of this frame, for the callback that collects the moving shapes (set in `stepWalk`). */
  private simNow: Simulation | null = null
  /** The heading of the last frame, for the turn rate that `walkBody` publishes. */
  private lastHeading = 0
  /** Scratch: the body's velocity, for the classic scheme's facing. */
  private readonly vel = { x: 0, z: 0 }

  // the camera. `lookTarget` is DRAWN (the flights are in drawn coordinates); `offX`/`offY` are the offset of your level (see `present`)
  private readonly lookTarget = { x: 0, y: 0, z: 0 }
  private offX = 0
  private offY = 0
  private avatarFadeNow = 1
  /** 0 standing .. 1 seated: your eyes come down as you sit (first person), eased (`BODY.seatedEye*`). */
  private sitBlend = 0
  /** How visible you are at the chase camera's resting pose (the flight down to you lands on it). */
  private restFade = 1
  private readonly scratch = new PerspectiveCamera(CHASE.fov, 16 / 9, FLIGHT.walkNear, 500)
  private readonly flightFrom = newFlightState()
  private readonly flightTo = newFlightState()
  private flightEnd: 'walk' | 'overview' = 'walk'

  // presentation mode (src/ui/present): the walkthrough. `presenting` follows the store at the top of every frame.
  private presenting = false
  /** The view you had before presentation forced first person, restored on leaving. */
  private presentPrevView: PlayerViewKind
  private readonly glide = new Glide()
  /** The shot you last stood at (or glided to); -1 before the first. The glide goes to the one after it, looping. */
  private shotIdx = -1
  private glideTarget = 0
  /** A cut (the shot index) or a glide asked for while not walking yet, run on the first walking frame of presentation. `?view=present` starts at shot 1. */
  private pendingShot = PRESENT_VIEW_URL ? 0 : -1
  /** C pressed during the flight out to the overview (F-08): the flight wins, and the walkthrough starts once it has landed. */
  private presentQueued = false
  private glideWanted = false
  /** This frame the glide (not the keys) moved the body: the mouse look is ignored. */
  private glidedNow = false
  private readonly poseFrom: GlidePose = { x: 0, z: 0, yaw: 0, pitch: 0 }
  private readonly poseTo: GlidePose = { x: 0, z: 0, yaw: 0, pitch: 0 }
  private readonly poseBefore: GlidePose = { x: 0, z: 0, yaw: 0, pitch: 0 }
  private readonly poseAfter: GlidePose = { x: 0, z: 0, yaw: 0, pitch: 0 }

  // slow state
  private wasBlocked = false
  private lastPublished: { mode: PlayerMode; view: PlayerViewKind; locked: boolean } = { mode: 'walk', view: 'third', locked: false }
  private disposed = false

  private get x(): number {
    return this.body.x
  }
  private get z(): number {
    return this.body.z
  }
  private get heading(): number {
    return this.body.heading
  }
  private set heading(v: number) {
    this.body.heading = v
  }

  constructor(deps: PlayerDeps) {
    this.deps = deps
    this.scheme = deps.scheme ?? DEFAULT_SCHEME
    this.walkView = deps.walkView ?? WALK_VIEW.initial
    this.viewKind = this.walkView
    this.presentPrevView = this.walkView
    this.chase = new ChaseCamera(this.scheme)
    this.probe = deps.probe ?? new WallBoxProbe()
    this.body = new BodyMover(this.scheme)
    this.body.collect = this.collectShapes
    this.body.place(PLAYER_SPAWN.at.x, PLAYER_SPAWN.at.z, PLAYER_SPAWN.heading)
    const sim = deps.getSim()
    const existing = sim.player
    if (existing) {
      // a remount (hot reload, strict mode) or a Jump: carry on from where you are
      this.body.x = existing.x
      this.body.z = existing.z
      this.body.heading = existing.heading
      this.viewKind = existing.view
      this.phase = existing.mode === 'overview' || existing.mode === 'toOverview' ? 'overview' : 'walk'
    }
    settle(this.x, this.z, this.settled)
    this.body.place(this.settled.x, this.settled.z)
    this.lastHeading = this.heading
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
    this.syncPresentation()
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
      // (Tab is not heard while presenting: C leaves the walkthrough first)
      if (input.take('walk') && !this.presenting) this.toggleMode()
      if (input.take('firstPerson') && this.phase === 'walk') this.toggleFirstPerson()
      if (input.take('shoulderSwap') && this.phase === 'walk') this.chase.toggleShoulder()
    }

    switch (this.phase) {
      case 'walk':
        this.glidedNow = false
        if (this.glide.active) this.stepGlide(dt, !blocked, sim)
        else this.stepWalk(dt, !blocked, sim)
        // the body is published BEFORE the camera moves, so the camera (and everything after it this frame) reads this frame's body
        this.publishBody(dt)
        this.cameraStep(dt)
        this.finishBody(dt)
        break
      case 'toWalk':
      case 'toOverview':
        this.standStill(dt)
        this.publishBody(dt)
        this.flightStep(dt)
        this.finishBody(dt)
        this.publishSimCamera()
        break
      default:
        this.standStill(dt)
        this.publishBody(dt)
        this.finishBody(dt)
        this.publishSimCamera()
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
    const body = this.body
    this.simNow = sim
    body.step(dt, forward, right, this.axes.hurry, this.chase.facing)
    this.simNow = null

    // heading. Easy: you steer the body (A and D, in `BodyMover.step`; in first person the mouse too, `cameraStep`), so nothing turns it here.
    // Classic: through your own eyes you face where you look; otherwise the body turns to face where it goes
    if (this.scheme === 'easy') {
      /* the keys and the mouse steer the body */
    } else if (this.viewKind === 'first') {
      this.heading = turnTowards(this.heading, this.chase.facing, dt, MOVE.firstPersonTurnSeconds)
    } else {
      let target: number | null = null
      if (body.wanting && body.speed < 0.5) target = Math.atan2(body.steer.dirX, body.steer.dirZ)
      else {
        this.vel.x = body.state.vx
        this.vel.z = body.state.vz
        target = facingFromVelocity(this.vel)
      }
      if (target !== null) this.heading = turnTowards(this.heading, target, dt)
    }
    this.feet.x = this.x
    this.feet.y = groundHeightAt(this.x, this.z)
    this.feet.z = this.z
  }

  /**
   * Presentation: one frame of the glide between two shots. The pose comes from the glide's eased spline; the body is walked there (`BodyMover.glide`:
   * collision, doors and people still count) and the camera is put exactly on its yaw and pitch. Any walk key (or an overlay) ends it at once and you walk on.
   */
  private stepGlide(dt: number, control: boolean, sim: Simulation): void {
    this.input.axes(this.axes)
    if (!control || this.axes.forward !== 0 || this.axes.right !== 0) {
      this.glide.cancel()
      this.stepWalk(dt, control, sim)
      return
    }
    const g = this.glide
    const done = g.tick(dt)
    this.simNow = sim
    this.body.glide(dt, g.x, g.z, g.yaw)
    this.simNow = null
    this.chase.snapView(g.yaw, g.pitch)
    this.glidedNow = true
    this.feet.x = this.x
    this.feet.y = groundHeightAt(this.x, this.z)
    this.feet.z = this.z
    if (done) this.shotIdx = this.glideTarget
  }

  /**
   * The moving shapes of this frame, added to the body's buffer (door leaves are collected by the mover itself): standing people, the
   * pushed wheelchairs and stretchers, their riders and the MealBots. Prebound, so the frame allocates nothing.
   */
  private readonly collectShapes = (shapes: DynamicShapes): void => {
    const sim = this.simNow
    if (!sim) return
    this.shapes = shapes
    sim.entities.forEach(this.visitPerson)
    sim.life.mealBots.forEach(this.visitBot)
    this.shapes = null
  }
  private shapes: DynamicShapes | null = null

  /** `sim.entities.forEach` callback: one person's circle (and a pushed vehicle's box) into this frame's shapes. */
  private readonly visitPerson = (e: Entity): void => {
    const shapes = this.shapes
    if (shapes === null || e.id === 'player') return
    if ((e.fade ?? 1) < 0.4) return
    const dx = e.position.x - this.x
    const dz = e.position.z - this.z
    const scan = BODY_FEEL.scanRadius
    if (dx > scan || dx < -scan || dz > scan || dz < -scan) return
    const kind = e.vehicle
    if (kind !== undefined && kind !== 'none') {
      if (e.riding) {
        // a rider sits on the vehicle, which the pusher's box already covers; the rider's own circle is for the edges
        shapes.addCircle(e.position.x, e.position.z, BODY_FEEL.riderRadius)
        return
      }
      // the pusher is a person, and the vehicle is a box centred ahead of them along their heading
      const hw = VEHICLE_HALF[kind][0]
      const hl = VEHICLE_HALF[kind][1]
      const sinH = Math.sin(e.heading)
      const cosH = Math.cos(e.heading)
      const ahead = VEHICLE_AHEAD[kind]
      shapes.addBox(e.position.x + sinH * ahead, e.position.z + cosH * ahead, cosH, -sinH, hw, hl)
    }
    if (e.seated || e.anim === 'lie' || e.anim === 'sit') return
    shapes.addCircle(e.position.x, e.position.z, BODY_FEEL.npcRadius)
  }

  /** `sim.life.mealBots.forEach` callback: a bot, unless it is still fading in or out at the service lift. */
  private readonly visitBot = (b: MealBot): void => {
    const shapes = this.shapes
    if (shapes === null || b.fade < 0.4) return
    const dx = b.position.x - this.x
    const dz = b.position.z - this.z
    const scan = BODY_FEEL.scanRadius
    if (dx > scan || dx < -scan || dz > scan || dz < -scan) return
    shapes.addCircle(b.position.x, b.position.z, BOT_RADIUS)
  }

  /** Not walking (the overview, or a flight): you stand where you are, at rest. */
  private standStill(dt: number): void {
    this.body.stand(dt)
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
    if (!input.listening || this.glidedNow) this.look.dx = this.look.dy = this.look.wheel = 0
    this.subject.vx = this.body.state.vx
    this.subject.vz = this.body.state.vz
    this.subject.heading = this.heading
    this.subject.turning = Math.abs(this.body.turn.rate) > TURNING_RATE
    // through your eyes, sitting down (the seats put your avatar in its 'sit' pose) brings the eyes down to a seated height
    const avatar = this.deps.getSim().playerAvatar
    this.sitBlend = approach(this.sitBlend, avatar !== null && avatar.anim === 'sit' ? 1 : 0, dt / BODY.seatedEyeSeconds)
    this.subject.eyeDrop = BODY.seatedEyeDrop * smooth01(this.sitBlend)
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
    this.avatarFadeNow = report.avatarFade
    walkCam.yaw = wrapAngle(this.chase.facing - this.heading)
    walkCam.facing = this.chase.facing
    walkCam.pitch = this.chase.drawnPitch
    walkCam.boom = report.boom
    walkCam.firstPerson = this.chase.firstPersonBlend
    walkCam.avatarFade = this.presenting ? 0 : report.avatarFade
    // the camera in SIM coordinates (the sight tests of the bubbles and emotes read it), then the one translation to where it is drawn
    walkCam.camera.x = camera.position.x
    walkCam.camera.y = camera.position.y
    walkCam.camera.z = camera.position.z
    this.present(camera, report.target)
  }

  /**
   * R2: the chase camera has just written `camera` in SIM coordinates; move it to where it is DRAWN, by the offset of the level you stand on (zero on level 1,
   * (-150, +4.2, 0) on level 2). One rigid translation: the rotation is unchanged, and the look target (`lookTarget`, drawn, for the flights) moves with it.
   * Call it exactly once per write of the camera: it adds, it does not set.
   */
  private present(camera: PerspectiveCamera, simTarget: { x: number; y: number; z: number }): void {
    this.syncLevel()
    camera.position.x += this.offX
    camera.position.y += this.offY
    this.lookTarget.x = simTarget.x + this.offX
    this.lookTarget.y = simTarget.y + this.offY
    this.lookTarget.z = simTarget.z
  }

  /** The offset that draws your level: what to add to a sim position on it. */
  private syncLevel(): void {
    const level = levelOf(this.x)
    this.offX = levelDx(level)
    this.offY = LEVEL_Y[level]
  }

  /** Not walking (a flight, the overview): the camera is drawn already, so its sim position is the drawn one taken back by your level's offset. */
  private publishSimCamera(): void {
    this.syncLevel()
    const c = this.deps.camera.position
    walkCam.camera.x = c.x - this.offX
    walkCam.camera.y = c.y - this.offY
    walkCam.camera.z = c.z
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

  /** Put the camera at rest (through your eyes, or behind you) and the lens in walk mode, at once (no flight): the app starts walking. */
  private enterWalkNow(): void {
    this.phase = 'walk'
    this.viewKind = this.presenting ? 'first' : this.walkView
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
   * In first person (the default walk view) it settles at your eyes, looking level, with your body faded out.
   */
  private restPose(camera: PerspectiveCamera): void {
    this.feet.x = this.x
    this.feet.y = groundHeightAt(this.x, this.z)
    this.feet.z = this.z
    this.body.halt()
    this.subject.vx = 0
    this.subject.vz = 0
    this.subject.heading = this.heading
    this.subject.turning = false
    camera.near = FLIGHT.walkNear
    this.chase.reset(this.feet, this.heading)
    const eyes = this.viewKind === 'first'
    // through your eyes you arrive looking level (the chase camera's resting pose looks down on you a little)
    if (eyes) this.chase.snapView(this.heading, 0)
    const report = this.chase.settle(this.subject, { firstPerson: eyes, floorY: this.feet.y }, this.probe, camera)
    camera.updateProjectionMatrix()
    // (drawn, like every other camera pose: the flight down to you lands on it)
    this.present(camera, report.target)
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
    // the walkthrough is first person, always
    if (this.phase !== 'walk' || this.presenting) return
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
    // the walkthrough ends where the flight to the overview begins (the camera, the speed and the avatar are the game's again)
    if (this.presenting) {
      usePresentation.getState().setOn(false)
      this.setPresenting(false)
    }
    const camera = this.deps.camera
    this.cameraState(this.flightFrom)
    if (pose) {
      poseToLookAt(pose, this.flightTo)
    } else {
      const whole = overviewPose(OVERVIEW_FOV_DEG, camera.aspect > 0.2 ? camera.aspect : 1.6)
      poseToLookAt(whole, this.flightTo)
    }
    this.flightTo.fov = FLIGHT.overviewFov
    // R2: Tab opens the overview on the level you stand on (a room's shot, `pose`, has its own: the room focus sets the level it needs before it flies)
    if (!pose) {
      const level = levelOf(this.x)
      if (useOverviewLevel.getState().level !== level) useOverviewLevel.getState().set(level)
    }
    this.phase = 'toOverview'
    this.flightEnd = 'overview'
    this.primeRig()
    this.input.releaseLock()
    this.input.clear()
    this.viewKind = 'third'
    this.body.halt()
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
    // where it lands: at rest in the walk view (through your eyes by default, and always in the walkthrough; behind you in third person). Computed on a
    // scratch camera, so the flight's own writes are not disturbed.
    this.viewKind = this.presenting ? 'first' : this.walkView
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
      // flying down into your own eyes, your body fades out over the end of the flight (seen all the way down until then)
      if (this.phase === 'toWalk' && this.restFade < 1) {
        const k = smooth01((this.flight.progress - FLIGHT.eyesFadeFrom) / (1 - FLIGHT.eyesFadeFrom))
        this.avatarFadeNow = 1 + (this.restFade - 1) * k
      }
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
    const speed = this.body.speed
    const keep = e && speed <= 0.05 && e.anim !== 'idle' && e.anim !== 'walk' ? e.anim : null
    sim.movePlayer(this.x, this.z, this.heading, speed)
    if (e && keep) e.anim = keep
    // the walkthrough has no avatar (not in a flight either: nobody sees a body, nor its blob shadow)
    if (e) e.fade = this.presenting ? 0 : this.avatarFadeNow
  }

  /** The body's numbers for the legs, the doors, the camera and the quality ladder: the shared `walkBody`, every frame, never reallocated. */
  private publishBody(dt: number): void {
    const b = this.body.state
    // the heading turns for other reasons than the keys (the classic scheme's facing, the mouse in first person), so measure it
    b.turnRate = dt > 0 ? angleDelta(this.lastHeading, this.heading) / dt : 0
    this.lastHeading = this.heading
    b.live = true
    copyBodyState(b, walkBody)
  }

  /** The end of the frame: the camera may have turned the body (the mouse in first person): that turn is part of this frame's rate too. */
  private finishBody(dt: number): void {
    if (dt > 0) walkBody.turnRate += angleDelta(this.lastHeading, this.heading) / dt
    this.lastHeading = this.heading
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
  // Presentation mode (src/ui/present)
  // ------------------------------------------------------------------------------------------

  /** Follow the presentation store (once a frame), then run any cut or glide that was waiting for a walking frame. */
  private syncPresentation(): void {
    if (this.presentQueued) {
      // the flight landed: start the walkthrough now (it flies down again). Any other phase means you moved on: forget it.
      if (this.phase === 'overview') {
        this.presentQueued = false
        usePresentation.getState().setOn(true)
      } else if (this.phase !== 'toOverview') this.presentQueued = false
    }
    const want = presentActive()
    if (want !== this.presenting) {
      // C pressed in the middle of the flight out to the overview: the flight wins, the walkthrough waits for it to land
      if (want && this.phase === 'toOverview') {
        usePresentation.getState().setOn(false)
        this.presentQueued = true
      } else this.setPresenting(want)
    }
    if (!this.presenting || this.phase !== 'walk') return
    if (this.pendingShot >= 0) {
      const i = this.pendingShot
      this.pendingShot = -1
      this.cutToShot(i)
    }
    if (this.glideWanted) {
      this.glideWanted = false
      if (!this.glide.active) this.startGlide()
    }
  }

  /**
   * Presentation on or off. On: first person (the previous view is remembered), the lens, eye and look of the walkthrough (the chase camera blends them),
   * a slow walk with no run, no avatar. From the overview it flies down first. Off: every one of those goes back to the game's, and the view you had returns.
   */
  private setPresenting(on: boolean): void {
    this.presenting = on
    this.glide.cancel()
    this.chase.setPresenting(on)
    this.body.speedScale = on ? PRESENT.speedScale : 1
    this.body.noRun = false // the owner wants to run while presenting too
    const flying = this.phase === 'walk' || this.phase === 'toWalk'
    if (on) {
      if (flying) {
        this.presentPrevView = this.viewKind
        this.viewKind = 'first'
      } else if (this.phase === 'overview') {
        this.presentPrevView = this.walkView
        this.beginToWalk()
      }
    } else {
      this.glideWanted = false
      this.pendingShot = -1
      if (flying && this.viewKind === 'first' && this.presentPrevView === 'third') {
        this.viewKind = 'third'
        this.chase.restoreBoom()
      }
    }
  }

  /** Stand at shot `i` (looping index), looking at its target, at rest and fully in the walkthrough's view: an instant cut, settled. */
  private cutToShot(i: number): void {
    const n = SHOTS.length
    const k = ((i % n) + n) % n
    const s = SHOTS[k]
    const yaw = shotYaw(s)
    this.glide.cancel()
    settle(s.x, s.z, this.settled)
    this.placeAt(this.settled.x, this.settled.z, yaw)
    this.chase.snapView(yaw, s.pitch)
    this.chase.completeBlends()
    this.shotIdx = k
  }

  /** A shot as a glide pose. */
  private poseOf(s: Shot, out: GlidePose): GlidePose {
    out.x = s.x
    out.z = s.z
    out.yaw = shotYaw(s)
    out.pitch = s.pitch
    return out
  }

  /** Glide from where you stand to the shot after the last one (looping): a Catmull-Rom dolly through the neighbouring shots, 6 to 8 seconds. */
  private startGlide(): void {
    const to = nextShot(this.shotIdx)
    const from = this.poseFrom
    from.x = this.x
    from.z = this.z
    from.yaw = this.chase.facing
    from.pitch = this.chase.viewPitch
    this.poseOf(SHOTS[to], this.poseTo)
    this.poseOf(SHOTS[nextShot(to)], this.poseAfter)
    // standing at a shot, the path bends into the one before it; anywhere else it starts straight
    let before: GlidePose | null = null
    if (this.shotIdx >= 0 && Math.hypot(this.x - SHOTS[this.shotIdx].x, this.z - SHOTS[this.shotIdx].z) < 0.75) before = this.poseOf(SHOTS[prevShot(this.shotIdx)], this.poseBefore)
    this.glideTarget = to
    this.glide.start(from, this.poseTo, before, this.poseAfter)
  }

  /** `N` and the probe: turn presentation on if it is off and glide to the next shot (once you are walking; a glide already under way is left alone). */
  presentGlide(): void {
    if (!this.presenting) usePresentation.getState().setOn(true)
    this.glideWanted = true
  }

  /** The probe: turn presentation on if it is off and cut to shot `i` (on the next frame you walk). */
  presentCut(i: number): void {
    if (!this.presenting) usePresentation.getState().setOn(true)
    this.pendingShot = i
    this.glideWanted = false
    this.glide.cancel()
  }

  /** Is presentation in effect in this system, and is a glide under way (for the probe and tests). */
  get presentState(): { presenting: boolean; gliding: boolean; shot: number } {
    return { presenting: this.presenting, gliding: this.glide.active, shot: this.shotIdx }
  }

  // ------------------------------------------------------------------------------------------
  // For other systems and for tests
  // ------------------------------------------------------------------------------------------

  /**
   * Put you down at (x, z), on the nearest walkable spot, facing `heading` (a seat, a bedside, a debug jump, a lift). The view is kept; but when the spot is on
   * the OTHER LEVEL (R2: a lift ride) the chase camera is put at rest behind you there at once, in the same call: it follows the body in sim coordinates and
   * `present()` draws it, so there is no flight across the map, and nothing of the old level's camera state (yaw lag, shoulder room, boom) is carried over.
   */
  placeAt(x: number, z: number, heading?: number): void {
    const was = levelOf(this.x)
    // only the walls and the region count: a seat is INSIDE its chair, and from there you can only walk out of it
    settle(x, z, this.settled, BODY.radius, false)
    this.body.place(this.settled.x, this.settled.z, heading)
    this.lastHeading = this.heading
    this.feet.x = this.x
    this.feet.y = groundHeightAt(this.x, this.z)
    this.feet.z = this.z
    if (levelOf(this.x) === was) {
      this.chase.snap(this.feet)
      return
    }
    if (this.phase === 'walk') {
      // the settle writes the resting pose into the camera (drawn on the new level), exactly where the chase camera will be next frame
      this.restPose(this.deps.camera)
      this.publishSimCamera()
    } else this.chase.snap(this.feet)
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
      speed: this.body.speed,
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
