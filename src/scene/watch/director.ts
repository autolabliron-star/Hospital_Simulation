/**
 * R5 "Watch step by step": the watch camera's director. A plain class (no React, nothing allocated per frame) that <WatchCamera /> steps once a frame at
 * `FRAME_PRIORITY.watchCamera` (-9.4): after you (-10, stood still under the lease) and the shown level (-9.5), before the tour, the rig and every label.
 *
 * THE LEASE. A watch is hosted INSIDE walk mode, so every renderer that decides the interior look from walk mode (the walls, lights, grade, AO, bubbles,
 * audio) stays right. `begin` saves what you were doing (where you stand, the way you look, your mode, the overview's shot and level and the room panel),
 * takes the camera lease (cameraApi), puts you at the room's watch spot (the theatre corridor's viewing window) and, from the overview, asks for your own
 * flight down into walk mode. While the lease is held the player stands you still and unseen and skips its chase camera; this class writes the lens.
 * `end` (Esc, the Exit button, the case leaving the room, a Jump) hands it back: in walk mode with a move back to the camera you had (a dolly in the same
 * room, else a cut behind a dip to black), from the overview with the player's own flight out to the shot you were on, after which you are put back where
 * you stood and the room panel reopens.
 *
 * EVERY FRAME (live): read the room's procedure view -> which case is ours (waiting / in the room / over) -> the step's shot (shots.ts: per-step override,
 * the step's focus, the room's default; sub-shots by the step's progress) -> the shot's pose from the anchors, with a slow push or orbit while it holds ->
 * the first of the shot's alternates with nobody's body between the lens and the look point (shots.ts `pickAltInto`; re-chosen when someone has stood
 * in the way for `REPICK_SECONDS`) -> the move (dolly.ts: a 2.2-3.5 s Hermite dolly, or a cut behind a 0.25 s dip to black for long or cross-room moves; with reduced motion every move is a
 * plain cut) or the hold (tracking the anchors with a 3/s damping) or your free look (drag to orbit the look point, wheel 0.6-3 m; the director takes
 * over again after 8 s without a drag, or at the next step) -> the eye kept inside the room, under the ceiling, out of people and on this side of every
 * wall (limits.ts) -> the camera written where it is DRAWN (`toDisplayInto`: level 2 is shifted by (-150, +4.2, 0)), and `walkCam.camera` set to the sim
 * eye, so the bubbles' and emotes' sight tests use the watch eye. The UI hears of a new shot, inset, status or dip only when it changes. The sim's speed
 * you had when the watch began is put back when it ends, however it ends.
 */
import { Vector3 } from 'three'
import { lookAtToPose, type CameraPose } from '@/scene/camera/cameraApi'
import type { BoomProbe } from '@/scene/player/boomProbe'
import type { InsetId } from '@/scene/registries/insetSources'
import { levelOf, toDisplayInto, toSimInto, type LevelId } from '@/sim/levels'
import { areaById, type AreaId, type Rect } from '@/sim/places'
import type { PlayerMode, ProcedureId, ProcedureView, Vec3 } from '@/sim/types'
import { newAnchorCtx, syncAnchorCtx, type AnchorCtx } from './anchors'
import { CUT_CHORD, DIP_SECONDS, Dolly } from './dolly'
import { addPerson, clampEyeInto, insideRect, moveObstacle, newObstacles, newPeople, type PeopleBuf } from './limits'
import { WATCH_ROOMS, roomCart, roomView, type RoomObstacles, type WatchEntity, type WatchRoomId, type WatchSim } from './rooms'
import { ROOM_DEFAULT, candidateInto, cueAt, floorOf, holdDriftInto, isOverridePlan, pickAltInto, poseClear, shotPlanFor, type ShotPlan, type ShotScene, type ShotSpec } from './shots'
import type { FreeLook, WatchMode, WatchPhase, WatchRequest, WatchSession, WatchStatus, WatchUiState } from './watch.store'

/** The near plane while the watch holds the lens (the walk lens' is 0.1: close-ups of hands and screens need less). */
export const WATCH_NEAR = 0.05
/** How fast a held shot follows its anchors (1/s). */
export const TRACK_RATE = 3
/** Free look: the director takes over again after this long without a drag. */
export const FREE_IDLE_SECONDS = 8
/** Free look: how near and far the wheel takes the eye from the look point (m). */
export const FREE_DIST = [0.6, 3] as const
/** After our case leaves the room the camera stays this long (the "operation is over" caption), then hands back. */
export const ENDED_HOLD_SECONDS = 6
/** Someone has stood between the lens and the look point this long: the shot's alternates are tried again. */
export const REPICK_SECONDS = 0.6
/** People this far outside the shot's area still count (a body in the doorway). */
const PEOPLE_MARGIN = 0.5
/** Waiting for the flight out to the overview to land, at most this long. */
const LEAVE_WAIT_SECONDS = 6
const MAX_DT = 0.1
const LOOK_RAD_PER_PX = 0.005
const PITCH_RAD_PER_PX = 0.004
const WHEEL_PER_UNIT = 0.0015
/** Where the camera looks when the move starts from an unknown look point: this far ahead (m). */
const AHEAD = 3

/** The camera as the director uses it (a three.js PerspectiveCamera; tests pass the real class). */
export interface CameraLike {
  readonly position: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }
  fov: number
  near: number
  lookAt(x: number, y: number, z: number): void
  updateProjectionMatrix(): void
  getWorldDirection(out: Vector3): Vector3
}

/** What the director needs of the player system (src/scene/player/api.ts; tests pass a fake). */
export interface PlayerPort {
  phase(): PlayerMode | null
  snapshot(): { x: number; z: number; heading: number; facing: number } | null
  viewPitch(): number | null
  place(x: number, z: number, heading?: number): void
  requestWalk(): void
  afterLease(target: Readonly<Vec3> | null, look: { yaw: number; pitch: number } | null): void
}

/** The overview rig's pose readers (camera-controls). */
export interface RigPort {
  getPosition(out: Vector3, receiveEndValue?: boolean): Vector3
  getTarget(out: Vector3, receiveEndValue?: boolean): Vector3
}

export interface DirectorDeps {
  camera: CameraLike
  sim(): WatchSim
  /** The running hospital's generation: a Jump (or a rebuilding skip) changes it. */
  generation(): number
  player: PlayerPort
  rig(): RigPort | null
  /** Fly out of walk mode to an overview shot (null: the whole building): cameraApi's flyTo, which hands over to the player's own flight. */
  flyTo(pose: CameraPose | null): void
  overviewLevel: { get(): LevelId; set(level: LevelId): void }
  focusArea: { get(): AreaId | null; set(area: AreaId | null): void }
  lease: { take(): boolean; release(): void }
  reducedMotion(): boolean
  /** The building's walls and ceilings (the chase camera's probe, SIM coordinates). */
  probe: BoomProbe
  /** Where the camera is in SIM coordinates (`walkCam.camera`): written every live frame. */
  simCamera: Vec3
  /** The slow UI state: called only on change. */
  publish(patch: Partial<Omit<WatchUiState, 'set'>>): void
  /** Before taking the camera: close the panels and cards, end the walkthrough, stand up. */
  prepare?(): void
  /** The plain per-frame mirror (`watchLive`). */
  live?: { room: WatchRoomId | null }
  /** A room's furniture, cart and lights (rooms.ts `roomObstacles`, built once per room); null: none known. */
  obstacles?(room: WatchRoomId): RoomObstacles | null
  /** The sim's speed: read when a watch begins, put back when it ends. */
  clock?: { speed(): number; setSpeed(n: number): void }
}

interface Pose {
  eye: Vec3
  target: Vec3
  fov: number
}

const v3 = (): Vec3 => ({ x: 0, y: 0, z: 0 })

/** Area rectangles by id, looked up once (a frame never searches the area list). */
const RECTS = new Map<AreaId, Rect>()
function areaRect(id: AreaId): Rect {
  let r = RECTS.get(id)
  if (r === undefined) {
    r = areaById(id).rect
    RECTS.set(id, r)
  }
  return r
}

export class WatchDirector implements WatchSession {
  private readonly deps: DirectorDeps
  private phaseNow: WatchPhase = 'off'
  private room: WatchRoomId = 'or'
  private mode: WatchMode = 'watch'
  private procedureId: ProcedureId | null = null
  private gen = 0
  private ownSkip = false
  /** The level the watched room is on (its sim frame is that level's). */
  private level: LevelId = 2

  // what you were doing (restored on the way out)
  private readonly saved = {
    mode: 'walk' as PlayerMode,
    x: 0,
    z: 0,
    heading: 0,
    yaw: 0,
    pitch: 0,
    level: 1 as LevelId,
    area: null as AreaId | null,
    hasOverview: false,
    overview: { target: v3(), distance: 1, pitchDeg: 50, yawDeg: 0 } as CameraPose,
    /** The camera, DRAWN, and its lens. */
    eye: v3(),
    target: v3(),
    fov: 55,
    near: 0.1,
  }

  // the live watch
  private status: WatchStatus = 'waiting'
  private caseId: string | null = null
  private endedFor = 0
  private shot: ShotSpec | null = null
  private plan: ShotPlan = ROOM_DEFAULT.or
  private planVersion = Number.NaN
  /** The plan's first cue for this step (a shot already on screen carries over: `floorOf`). */
  private planFloor = 0
  private stepChanged = false
  private heldFor = 0
  /** Seconds until a pending cut lands (the screen is black then); negative: none. */
  private cutLeft = -1
  private dipSeq = 0
  private shotArea: Rect = areaRect('l2Or')
  private free: FreeLook = 'off'
  private freeIdle = 0
  private freeYaw = 0
  private freePitch = 0
  private freeDist = 1.5
  private lookDx = 0
  private lookDy = 0
  private wheel = 0
  // the hand-back
  private leaveOverview = false
  private leavingFor = 0
  /** The sim's speed when the watch began (-1: unknown). */
  private savedSpeed = -1
  // nobody in the way: the shot's alternate in use, and how long someone has blocked it
  private alt = 0
  private blockedFor = 0
  private roomObs: RoomObstacles = { obstacles: newObstacles(1), cartSlot: -1 }
  private readonly scene: ShotScene

  private readonly cur: Pose = { eye: v3(), target: v3(), fov: 45 }
  private readonly liveEye = v3()
  private readonly liveTarget = v3()
  private readonly backEye = v3()
  private readonly backTarget = v3()
  private readonly dEye = v3()
  private readonly dTarget = v3()
  private readonly dir = new Vector3()
  private readonly rigPos = new Vector3()
  private readonly rigTgt = new Vector3()
  private readonly dolly = new Dolly()
  readonly ctx: AnchorCtx = newAnchorCtx()
  private readonly people: PeopleBuf = newPeople()

  constructor(deps: DirectorDeps) {
    this.deps = deps
    this.scene = { area: this.shotArea, probe: deps.probe, people: this.people, obstacles: this.roomObs.obstacles, focus: null }
  }

  get phase(): WatchPhase {
    return this.phaseNow
  }

  /** The shot being shown (for the probe and tests). */
  get shotId(): string | null {
    return this.shot?.id ?? null
  }

  /** Where the camera is (sim) and what it looks at, this frame (read only). */
  get pose(): Readonly<Pose> {
    return this.cur
  }

  get watchStatus(): WatchStatus {
    return this.status
  }

  get freeLook(): FreeLook {
    return this.free
  }

  /** A move or a cut is under way. */
  get moving(): boolean {
    return this.dolly.active || this.cutLeft >= 0
  }

  // ------------------------------------------------------------------------------------------
  // The session (called from the UI, never per frame)
  // ------------------------------------------------------------------------------------------

  begin(req: WatchRequest): boolean {
    const def = WATCH_ROOMS[req.room]
    if (def === undefined) return false
    if (this.phaseNow === 'entering' || this.phaseNow === 'live') {
      // already watching: switch what is watched (the following case, the booked one)
      this.room = req.room
      this.useRoomObstacles(req.room)
      this.mode = req.mode
      this.procedureId = req.procedureId
      this.forgetCase()
      this.deps.publish({ room: req.room, mode: req.mode, procedureId: req.procedureId, status: 'waiting' })
      return true
    }
    if (this.phaseNow === 'leaving') this.finish()
    const d = this.deps
    const phase = d.player.phase()
    const snap = d.player.snapshot()
    if (phase === null || snap === null) return false
    if (!d.lease.take()) return false
    // what you were doing, before the panels close (the room panel reopens on the way out)
    this.save(phase, snap)
    d.prepare?.()
    this.gen = d.generation()
    this.ownSkip = false
    this.room = req.room
    this.level = levelOf(areaRect(def.area).x0)
    this.useRoomObstacles(req.room)
    this.savedSpeed = d.clock ? d.clock.speed() : -1
    this.mode = req.mode
    this.procedureId = req.procedureId
    this.forgetCase()
    this.shot = null
    this.free = 'off'
    this.dolly.cancel()
    this.cutLeft = -1
    // you stand at the room's watch spot (the audio, the shown level and the culling follow you there); the picture stays the one you had until the cut
    d.player.place(def.spot.at.x, def.spot.at.z, def.spot.heading)
    if (phase === 'walk' || phase === 'toWalk') this.writeDrawn(this.saved.eye, this.saved.target, this.saved.fov)
    else d.player.requestWalk()
    this.phaseNow = 'entering'
    if (d.live) d.live.room = req.room
    d.publish({ phase: 'entering', room: req.room, mode: req.mode, procedureId: req.procedureId, status: 'waiting', shotId: null, inset: null, insetBig: false, free: 'off', skipping: false })
    return true
  }

  end(): void {
    if (this.phaseNow === 'off' || this.phaseNow === 'leaving') return
    this.handBack(this.phaseNow === 'entering')
  }

  expectGeneration(): void {
    this.ownSkip = true
  }

  holdFreeLook(on: boolean): void {
    if (this.phaseNow !== 'live') return
    if (on) {
      this.enterFree('held')
    } else if (this.free !== 'off') {
      this.free = 'off'
      this.deps.publish({ free: 'off' })
      if (this.shot !== null) this.startMove(this.shot)
    }
  }

  debug(): ReturnType<WatchSession['debug']> {
    const c = this.cur
    return { phase: this.phaseNow, status: this.status, shotId: this.shotId, free: this.free, moving: this.moving, eye: { ...c.eye }, target: { ...c.target }, fov: c.fov }
  }

  /** Free look input from the pointer (pixels of drag). */
  look(dx: number, dy: number): void {
    if (this.phaseNow !== 'live') return
    this.lookDx += dx
    this.lookDy += dy
  }

  /** Free look input from the wheel (its deltaY). */
  zoom(delta: number): void {
    if (this.phaseNow !== 'live') return
    this.wheel += delta
  }

  private save(phase: PlayerMode, snap: { x: number; z: number; heading: number; facing: number }): void {
    const d = this.deps
    const s = this.saved
    s.mode = phase
    s.x = snap.x
    s.z = snap.z
    s.heading = snap.heading
    s.yaw = snap.facing
    s.pitch = d.player.viewPitch() ?? 0
    s.level = d.overviewLevel.get()
    s.area = d.focusArea.get()
    const cam = d.camera
    s.eye.x = cam.position.x
    s.eye.y = cam.position.y
    s.eye.z = cam.position.z
    cam.getWorldDirection(this.dir)
    s.target.x = s.eye.x + this.dir.x * AHEAD
    s.target.y = s.eye.y + this.dir.y * AHEAD
    s.target.z = s.eye.z + this.dir.z * AHEAD
    s.fov = cam.fov
    s.near = cam.near
    s.hasOverview = false
    const rig = d.rig()
    if ((phase === 'overview' || phase === 'toOverview') && rig !== null) {
      rig.getPosition(this.rigPos, true)
      rig.getTarget(this.rigTgt, true)
      lookAtToPose({ px: this.rigPos.x, py: this.rigPos.y, pz: this.rigPos.z, tx: this.rigTgt.x, ty: this.rigTgt.y, tz: this.rigTgt.z }, s.overview)
      s.hasOverview = true
    }
  }

  private useRoomObstacles(room: WatchRoomId): void {
    const o = this.deps.obstacles?.(room) ?? null
    this.roomObs = o ?? { obstacles: newObstacles(1), cartSlot: -1 }
    this.scene.obstacles = this.roomObs.obstacles
  }

  private fromOverview(): boolean {
    return this.saved.mode === 'overview' || this.saved.mode === 'toOverview'
  }

  private forgetCase(): void {
    this.caseId = null
    this.status = 'waiting'
    this.endedFor = 0
    this.planVersion = Number.NaN
  }

  // ------------------------------------------------------------------------------------------
  // The frame
  // ------------------------------------------------------------------------------------------

  update(rawDt: number): void {
    if (this.phaseNow === 'off') return
    const dt = rawDt < 0 ? 0 : rawDt > MAX_DT ? MAX_DT : rawDt
    const sim = this.deps.sim()
    const gen = this.deps.generation()
    if (gen !== this.gen) {
      this.gen = gen
      if (this.ownSkip) {
        // our own skip rebuilt the hospital: the case ids are new (the flow books the watch case again)
        this.ownSkip = false
        this.forgetCase()
      } else if (this.phaseNow !== 'leaving') {
        // a Jump: hand the camera back at once, behind the Jump's own veil
        this.handBack(true)
        if ((this.phaseNow as WatchPhase) === 'off') return
      }
    }
    switch (this.phaseNow) {
      case 'entering':
        if (this.deps.player.phase() === 'walk') this.goLive(sim)
        break
      case 'live':
        this.stepLive(dt, sim)
        break
      case 'leaving':
        this.stepLeaving(dt)
        break
      default:
        break
    }
  }

  /** You have landed in walk mode: the camera is ours from here. It starts where it is now (the cut into the first shot leaves from it). */
  private goLive(sim: WatchSim): void {
    const cam = this.deps.camera
    const c = this.cur
    // the drawn camera back in the room level's sim frame (a round trip through `toDisplayInto` gives the same drawn point again)
    this.dEye.x = cam.position.x
    this.dEye.y = cam.position.y
    this.dEye.z = cam.position.z
    toSimInto(this.dEye, this.level, c.eye)
    cam.getWorldDirection(this.dir)
    c.target.x = c.eye.x + this.dir.x * AHEAD
    c.target.y = c.eye.y + this.dir.y * AHEAD
    c.target.z = c.eye.z + this.dir.z * AHEAD
    c.fov = cam.fov
    this.phaseNow = 'live'
    this.shot = null
    this.planVersion = Number.NaN
    this.deps.publish({ phase: 'live' })
    this.stepLive(0, sim)
  }

  private stepLive(dt: number, sim: WatchSim): void {
    const view = roomView(sim, this.room)
    const cart = roomCart(sim, this.room)
    syncAnchorCtx(this.ctx, view, sim.entities, cart)
    if (cart !== null && this.roomObs.cartSlot >= 0) moveObstacle(this.roomObs.obstacles, this.roomObs.cartSlot, cart.x, cart.z, cart.heading)
    this.trackCase(view, dt)
    if (this.phaseNow !== 'live') return
    const spec = this.pickShot(view)
    // the step's focus is kept in frame (not by a step's own override, which frames something else on purpose)
    this.scene.focus = this.status === 'case' && view !== null && view.procedureId !== null && !isOverridePlan(this.plan) ? view.focusAt : null
    // the people of the shot's area (the patient on the table is not in the way)
    this.collectPeople(sim, this.shot === spec ? this.shotArea : areaRect(spec.area))
    const stepChanged = this.stepChanged
    if (spec !== this.shot) this.cue(spec)
    else if (stepChanged && this.free === 'drag') this.resume()
    this.stepChanged = false
    this.heldFor += dt
    // the shot's pose now (its alternate in use: somebody standing in the way for long enough, or at the start of a step, makes it choose again)
    const eye = this.liveEye
    const target = this.liveTarget
    candidateInto(spec, this.ctx, this.alt, eye, target)
    if (this.cutLeft < 0 && !this.dolly.active && this.free === 'off') {
      if (poseClear(spec, eye, target, this.scene)) this.blockedFor = 0
      else {
        this.blockedFor = stepChanged ? REPICK_SECONDS : this.blockedFor + dt
        if (this.blockedFor >= REPICK_SECONDS) this.repick(spec)
      }
    }
    if (!this.deps.reducedMotion()) holdDriftInto(spec, this.heldFor, target, eye)
    clampEyeInto(eye, target, this.shotArea, this.deps.probe, this.people, eye)
    // the camera this frame
    const c = this.cur
    if (this.cutLeft >= 0) {
      this.cutLeft -= dt
      if (this.cutLeft < 0) this.snapTo(eye, target, spec.fov)
    } else if (this.lookDx !== 0 || this.lookDy !== 0 || this.wheel !== 0 || this.free !== 'off') {
      this.stepFree(dt)
    } else if (this.dolly.active) {
      this.dolly.tick(dt)
      c.fov = this.dolly.poseInto(eye, target, spec.fov, c.eye, c.target)
      clampEyeInto(c.eye, c.target, this.shotArea, this.deps.probe, this.people, c.eye)
    } else {
      const k = 1 - Math.exp(-TRACK_RATE * dt)
      c.eye.x += (eye.x - c.eye.x) * k
      c.eye.y += (eye.y - c.eye.y) * k
      c.eye.z += (eye.z - c.eye.z) * k
      c.target.x += (target.x - c.target.x) * k
      c.target.y += (target.y - c.target.y) * k
      c.target.z += (target.z - c.target.z) * k
      c.fov += (spec.fov - c.fov) * k
      if (Math.abs(c.fov - spec.fov) < 1e-3) c.fov = spec.fov
    }
    this.write(c.eye, c.target, c.fov)
  }

  /** The people in (and just round) `area` this frame, for the camera's clearance and its line of sight: everyone but you and the patient. */
  private collectPeople(sim: WatchSim, area: Rect): void {
    this.people.count = 0
    this.peopleArea = area
    sim.entities.forEach(this.visitPerson)
  }

  private peopleArea: Rect = this.shotArea

  /** `sim.entities.forEach` callback, prebound once (a frame allocates nothing). */
  private readonly visitPerson = (e: WatchEntity, id: string): void => this.visit(e, id)

  private visit(e: WatchEntity, id: string): void {
    if (id === 'player' || e.anim === 'lie' || e.riding === true || (e.fade ?? 1) < 0.4) return
    const p = e.position
    const r = this.peopleArea
    if (p.x < r.x0 - PEOPLE_MARGIN || p.x > r.x1 + PEOPLE_MARGIN || p.z < r.z0 - PEOPLE_MARGIN || p.z > r.z1 + PEOPLE_MARGIN) return
    addPerson(this.people, p.x, p.z)
  }

  /** Someone has stood in the way: the first clear alternate now, moved to like any new shot (nothing clear: stay). Runs only then. */
  private repick(spec: ShotSpec): void {
    this.blockedFor = 0
    const alt = pickAltInto(spec, this.ctx, this.scene, this.liveEye, this.liveTarget)
    if (alt < 0 || alt === this.alt) {
      candidateInto(spec, this.ctx, this.alt, this.liveEye, this.liveTarget)
      return
    }
    this.alt = alt
    this.startMove(spec, false)
  }

  /** Which case is ours, and is it waiting, in the room or over? Hands back a while after it has left. */
  private trackCase(view: ProcedureView | null, dt: number): void {
    let ours = false
    if (view !== null && view.procedureId !== null) {
      if (this.caseId !== null) ours = view.caseId === this.caseId
      else if (this.mode === 'follow') ours = true
      else ours = view.watch && (this.procedureId === null || view.procedureId === this.procedureId)
      if (ours && this.caseId === null) this.caseId = view.caseId
    }
    const status: WatchStatus = this.caseId === null ? 'waiting' : ours ? 'case' : 'ended'
    if (status === 'ended') {
      this.endedFor += dt
      if (this.endedFor >= ENDED_HOLD_SECONDS) {
        this.handBack(false)
        return
      }
    } else this.endedFor = 0
    if (status !== this.status) this.setStatus(status)
  }

  private setStatus(status: WatchStatus): void {
    this.status = status
    this.deps.publish({ status })
  }

  /** The shot for this frame: the step's plan (recomputed when the step changes) at its progress; the room's default with no case of ours. */
  private pickShot(view: ProcedureView | null): ShotSpec {
    if (this.status !== 'case' || view === null || view.procedureId === null) {
      if (this.plan !== ROOM_DEFAULT[this.room]) {
        this.plan = ROOM_DEFAULT[this.room]
        this.planVersion = Number.NaN
        this.planFloor = 0
      }
      return cueAt(this.plan, 0)
    }
    if (view.version !== this.planVersion) {
      this.plan = shotPlanFor(this.room, view.procedureId, view.stepId, view.focus, view.roles)
      this.planVersion = view.version
      this.planFloor = floorOf(this.plan, this.shot)
      this.stepChanged = true
    }
    return cueAt(this.plan, view.progress, this.planFloor)
  }

  /** A new shot: tell the UI (its inset), then move to it (unless your free look is held). Runs on a shot change only. */
  private cue(spec: ShotSpec): void {
    this.shot = spec
    this.heldFor = 0
    this.shotArea = areaRect(spec.area)
    this.scene.area = this.shotArea
    const inset: InsetId | null = spec.inset ?? null
    if (this.free === 'drag') {
      this.free = 'off'
      this.deps.publish({ shotId: spec.id, inset, insetBig: spec.insetBig === true, free: 'off' })
    } else this.deps.publish({ shotId: spec.id, inset, insetBig: spec.insetBig === true })
    if (this.free === 'off') this.startMove(spec)
  }

  /**
   * Move from where the camera is to `spec`: a dolly, a cut behind a dip to black (long or cross-room), or a plain cut (reduced motion). With `pick`, the
   * shot's first clear alternate is chosen first (a new shot, or the director taking over again); without, the one in `alt` is kept.
   */
  private startMove(spec: ShotSpec, pick = true): void {
    const eye = this.liveEye
    const target = this.liveTarget
    if (pick) {
      const alt = pickAltInto(spec, this.ctx, this.scene, eye, target)
      this.alt = alt < 0 ? 0 : alt
      this.blockedFor = 0
      if (alt < 0) candidateInto(spec, this.ctx, 0, eye, target)
    } else candidateInto(spec, this.ctx, this.alt, eye, target)
    clampEyeInto(eye, target, this.shotArea, this.deps.probe, this.people, eye)
    const c = this.cur
    this.dolly.cancel()
    this.cutLeft = -1
    if (this.deps.reducedMotion()) {
      this.snapTo(eye, target, spec.fov)
      return
    }
    const dx = eye.x - c.eye.x
    const dy = eye.y - c.eye.y
    const dz = eye.z - c.eye.z
    const chord = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const tx = target.x - c.target.x
    const ty = target.y - c.target.y
    const tz = target.z - c.target.z
    if (chord < 0.05 && tx * tx + ty * ty + tz * tz < 0.0025) return
    if (chord > CUT_CHORD || !insideRect(this.shotArea, c.eye.x, c.eye.z, -0.05)) {
      this.cutLeft = DIP_SECONDS
      this.dipSeq++
      this.deps.publish({ dip: this.dipSeq })
      return
    }
    this.dolly.start(c.eye, c.target, c.fov, eye)
  }

  private snapTo(eye: Readonly<Vec3>, target: Readonly<Vec3>, fov: number): void {
    const c = this.cur
    c.eye.x = eye.x
    c.eye.y = eye.y
    c.eye.z = eye.z
    c.target.x = target.x
    c.target.y = target.y
    c.target.z = target.z
    c.fov = fov
  }

  // ------------------------------------------------------------------------------------------
  // Free look
  // ------------------------------------------------------------------------------------------

  private enterFree(kind: 'drag' | 'held'): void {
    if (this.free === 'off') {
      const c = this.cur
      const dx = c.eye.x - c.target.x
      const dy = c.eye.y - c.target.y
      const dz = c.eye.z - c.target.z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      this.freeDist = d < FREE_DIST[0] ? FREE_DIST[0] : d > FREE_DIST[1] ? FREE_DIST[1] : d
      this.freeYaw = Math.atan2(dx, dz)
      this.freePitch = d > 1e-6 ? Math.asin(dy / d) : 0.3
      this.dolly.cancel()
    }
    if (this.free !== kind) {
      this.free = kind
      this.deps.publish({ free: kind })
    }
    this.freeIdle = 0
  }

  /** The director takes over again: a move from where you left the camera to the shot. */
  private resume(): void {
    this.free = 'off'
    this.deps.publish({ free: 'off' })
    if (this.shot !== null) this.startMove(this.shot)
  }

  private stepFree(dt: number): void {
    const moved = this.lookDx !== 0 || this.lookDy !== 0 || this.wheel !== 0
    if (moved && this.free === 'off') this.enterFree('drag')
    this.freeYaw -= this.lookDx * LOOK_RAD_PER_PX
    const p = this.freePitch + this.lookDy * PITCH_RAD_PER_PX
    this.freePitch = p < -0.35 ? -0.35 : p > 1.25 ? 1.25 : p
    const dist = this.freeDist * Math.exp(this.wheel * WHEEL_PER_UNIT)
    this.freeDist = dist < FREE_DIST[0] ? FREE_DIST[0] : dist > FREE_DIST[1] ? FREE_DIST[1] : dist
    this.lookDx = 0
    this.lookDy = 0
    this.wheel = 0
    this.freeIdle = moved ? 0 : this.freeIdle + dt
    const c = this.cur
    const h = this.freeDist * Math.cos(this.freePitch)
    c.eye.x = c.target.x + h * Math.sin(this.freeYaw)
    c.eye.y = c.target.y + this.freeDist * Math.sin(this.freePitch)
    c.eye.z = c.target.z + h * Math.cos(this.freeYaw)
    clampEyeInto(c.eye, c.target, this.shotArea, this.deps.probe, this.people, c.eye)
    if (this.free === 'drag' && this.freeIdle >= FREE_IDLE_SECONDS) this.resume()
  }

  // ------------------------------------------------------------------------------------------
  // The hand-back
  // ------------------------------------------------------------------------------------------

  /** Give the camera back: `instant` skips the move (nothing is on screen yet, or a Jump's veil covers it). */
  private handBack(instant: boolean): void {
    const d = this.deps
    this.dolly.cancel()
    this.cutLeft = -1
    if (this.free !== 'off') this.free = 'off'
    if (this.fromOverview()) {
      // the player's own flight out, from where the camera is now to the shot you were on; you are put back where you stood once it lands
      d.lease.release()
      if (this.phaseNow === 'live') {
        toDisplayInto(this.cur.target, this.dTarget)
        d.player.afterLease(this.dTarget, null)
      }
      d.overviewLevel.set(this.saved.level)
      d.flyTo(this.saved.hasOverview ? this.saved.overview : null)
      this.leaveOverview = true
      this.leavingFor = 0
      this.phaseNow = 'leaving'
      d.publish({ phase: 'leaving', inset: null, insetBig: false, free: 'off' })
      return
    }
    this.leaveOverview = false
    // walking: back to the camera you had, in the room's sim frame (a level-1 camera survives the round trip: see goLive)
    toSimInto(this.saved.eye, this.level, this.backEye)
    toSimInto(this.saved.target, this.level, this.backTarget)
    if (instant || this.phaseNow !== 'live' || this.deps.reducedMotion()) {
      this.finishWalk()
      return
    }
    this.phaseNow = 'leaving'
    d.publish({ phase: 'leaving', inset: null, insetBig: false, free: 'off' })
    const c = this.cur
    const dx = this.backEye.x - c.eye.x
    const dy = this.backEye.y - c.eye.y
    const dz = this.backEye.z - c.eye.z
    const sameRoom = insideRect(this.shotArea, this.backEye.x, this.backEye.z, -0.05)
    if (!sameRoom || Math.sqrt(dx * dx + dy * dy + dz * dz) > CUT_CHORD) {
      this.cutLeft = DIP_SECONDS
      this.dipSeq++
      d.publish({ dip: this.dipSeq })
    } else this.dolly.start(c.eye, c.target, c.fov, this.backEye)
  }

  private stepLeaving(dt: number): void {
    if (this.leaveOverview) {
      // the flight out is the player's; once it lands you are put back where you stood (a Tab back down means you chose to walk on from here)
      this.leavingFor += dt
      const ph = this.deps.player.phase()
      if (ph === 'overview') {
        this.deps.player.place(this.saved.x, this.saved.z, this.saved.heading)
        if (this.saved.area !== null) this.deps.focusArea.set(this.saved.area)
        this.finish()
      } else if (ph === null || ph === 'walk' || ph === 'toWalk' || this.leavingFor > LEAVE_WAIT_SECONDS) this.finish()
      return
    }
    const c = this.cur
    if (this.cutLeft >= 0) {
      this.cutLeft -= dt
      if (this.cutLeft < 0) this.finishWalk()
      else this.write(c.eye, c.target, c.fov)
      return
    }
    if (this.dolly.active) {
      const done = this.dolly.tick(dt)
      c.fov = this.dolly.poseInto(this.backEye, this.backTarget, this.saved.fov, c.eye, c.target)
      if (done) this.finishWalk()
      else this.write(c.eye, c.target, c.fov)
      return
    }
    this.finishWalk()
  }

  /** Walking: release the lens, put you back exactly where you stood, looking the way you looked, with the lens you had. */
  private finishWalk(): void {
    const d = this.deps
    const s = this.saved
    d.lease.release()
    d.player.place(s.x, s.z, s.heading)
    d.player.afterLease(s.target, { yaw: s.yaw, pitch: s.pitch })
    this.writeDrawn(s.eye, s.target, s.fov)
    const cam = d.camera
    if (cam.near !== s.near) {
      cam.near = s.near
      cam.updateProjectionMatrix()
    }
    this.finish()
  }

  private finish(): void {
    const d = this.deps
    d.lease.release()
    // the sim's speed you had before the watch (2x or 4x for the watch is not yours to keep)
    if (d.clock && this.savedSpeed > 0 && d.clock.speed() !== this.savedSpeed) d.clock.setSpeed(this.savedSpeed)
    this.savedSpeed = -1
    this.phaseNow = 'off'
    this.leaveOverview = false
    this.dolly.cancel()
    this.cutLeft = -1
    this.free = 'off'
    this.shot = null
    this.lookDx = this.lookDy = this.wheel = 0
    if (d.live) d.live.room = null
    d.publish({ phase: 'off', room: null, mode: null, procedureId: null, status: 'waiting', shotId: null, inset: null, insetBig: false, free: 'off', skipping: false })
  }

  // ------------------------------------------------------------------------------------------
  // The lens
  // ------------------------------------------------------------------------------------------

  /** Write the camera from a SIM eye and look point (drawn by `toDisplayInto`), and `walkCam.camera`. Allocation-free. */
  private write(eye: Readonly<Vec3>, target: Readonly<Vec3>, fov: number): void {
    toDisplayInto(eye, this.dEye)
    toDisplayInto(target, this.dTarget)
    const cam = this.deps.camera
    cam.position.set(this.dEye.x, this.dEye.y, this.dEye.z)
    cam.lookAt(this.dTarget.x, this.dTarget.y, this.dTarget.z)
    if (cam.fov !== fov || cam.near !== WATCH_NEAR) {
      cam.fov = fov
      cam.near = WATCH_NEAR
      cam.updateProjectionMatrix()
    }
    const sc = this.deps.simCamera
    sc.x = eye.x
    sc.y = eye.y
    sc.z = eye.z
  }

  /** Write the camera at a DRAWN pose (the one you had). */
  private writeDrawn(eye: Readonly<Vec3>, target: Readonly<Vec3>, fov: number): void {
    const cam = this.deps.camera
    cam.position.set(eye.x, eye.y, eye.z)
    cam.lookAt(target.x, target.y, target.z)
    if (cam.fov !== fov) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }
    const level = levelOf(this.saved.x)
    toSimInto(eye, level, this.deps.simCamera)
  }
}
