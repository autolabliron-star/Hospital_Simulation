/**
 * R5: test helpers for the watch camera (node only; nothing here runs in the app). A step's procedure view as the engine publishes it, a fake player
 * with the lease hooks, a fake sim, and the director wired to them with a real three.js camera and the building's real wall probe.
 */
import { PerspectiveCamera } from 'three'
import { getLayout } from '@/scene/building/layout'
import { WallBoxProbe } from '@/scene/player/boomProbe'
import { LEVEL_Y, levelDx, levelOf } from '@/sim/levels'
import { PROCEDURE_META } from '@/content/procedures'
import { SURGERY, type AreaId } from '@/sim/places'
import { applyRoleViews, compiledFor, emptyProcedureView, focusPointInto, newRoleViews, newTargetCtx, setTable } from '@/sim/procedure'
import type { CtNeedlePath } from '@/sim/procedure/cryoPlaces'
import type { CryoTarget, PlayerMode, ProcedureId, ProcedureView, Vec3, WatchResult } from '@/sim/types'
import type { CameraPose } from '@/scene/camera/cameraApi'
import type { LevelId } from '@/sim/levels'
import { WatchDirector, type DirectorDeps, type PlayerPort } from './director'
import { roomObstacles, type RoomObstacles, type WatchEntity, type WatchRoomId, type WatchSim } from './rooms'
import type { WatchUiState } from './watch.store'

/**
 * Fill `view` with step `i` of a script as the engine would (roles, the pose after the step, the focus point). For a CT procedure the focus point follows
 * the case's target (its key) and `tablePos` (0 out .. 1 in the bore, default out).
 */
export function fillStepView(view: ProcedureView, id: ProcedureId, i: number, cart: { x: number; z: number }, caseId = 'case', watch = true, tablePos = 0): ProcedureView {
  const cs = compiledFor(id)!
  const step = cs.script.steps[i]
  const changed = view.procedureId !== id || view.stepIndex !== i || view.caseId !== caseId
  view.procedureId = id
  view.caseId = caseId
  view.watch = watch
  view.unit = step.unit
  view.stepIndex = i
  view.stepCount = cs.n
  view.stepId = step.id
  view.focus = step.focus
  view.progress = 0
  if (view.roles.length !== cs.roles.length) view.roles = newRoleViews(cs.machine)
  applyRoleViews(view.roles, cs, i)
  Object.assign(view.patient, cs.poseAfter[i])
  const t = newTargetCtx()
  setTable(t, view.patient.headTiltDeg, view.patient.rollDeg, view.patient.position)
  t.cart = cart
  if (cs.machine === 'cryoCt') {
    t.cryo.target = PROCEDURE_META[id].key as CryoTarget
    t.cryo.tablePos = tablePos
  }
  focusPointInto(step.focus, t, view.focusAt)
  if (changed) view.version++
  return view
}

export function stepIndexOf(id: ProcedureId, stepId: string): number {
  return compiledFor(id)!.script.steps.findIndex((s) => s.id === stepId)
}

export interface FakePlayer {
  phase: PlayerMode
  x: number
  z: number
  heading: number
  facing: number
  pitch: number
  calls: string[]
  lastTarget: Vec3 | null
  lastLook: { yaw: number; pitch: number } | null
  port: PlayerPort
}

export function fakePlayer(phase: PlayerMode, x: number, z: number, heading = 0.4, facing = 0.5): FakePlayer {
  const p: FakePlayer = {
    phase,
    x,
    z,
    heading,
    facing,
    pitch: 0.12,
    calls: [],
    lastTarget: null,
    lastLook: null,
    port: null as unknown as PlayerPort,
  }
  p.port = {
    phase: () => p.phase,
    snapshot: () => ({ x: p.x, z: p.z, heading: p.heading, facing: p.facing }),
    viewPitch: () => p.pitch,
    place: (x2, z2, h) => {
      p.x = x2
      p.z = z2
      if (h !== undefined) p.heading = h
      p.calls.push('place')
    },
    requestWalk: () => {
      p.calls.push('requestWalk')
      p.phase = 'toWalk'
    },
    afterLease: (target, look) => {
      p.lastTarget = target ? { x: target.x, y: target.y, z: target.z } : null
      p.lastLook = look ? { ...look } : null
      p.calls.push('afterLease')
    },
  }
  return p
}

/** The fake CT suite: its published state (the case's view, the table, the target, the needles) and the calls its port answers. */
export interface FakeCryo {
  state: { procedure: ProcedureView; tablePos: number; target: CryoTarget; needle: number; needles: CtNeedlePath[] }
  calls: { target: CryoTarget; fromStart: boolean }[]
  answer: WatchResult
  startsAt: number | null
  why: 'hours' | 'late' | null
}

/** The fake imaging department: the ultrasound room's ProSense view and the calls its port answers. */
export interface FakeImaging {
  view: ProcedureView
  calls: { protocol: string; fromStart: boolean }[]
  answer: WatchResult
  startsAt: number | null
}

export interface Harness {
  director: WatchDirector
  camera: PerspectiveCamera
  player: FakePlayer
  /** The robotic theatre's view (the other rooms': `cryo.state.procedure` and `imaging.view`; `viewOf` picks by room). */
  view: ProcedureView
  cryo: FakeCryo
  imaging: FakeImaging
  viewOf(room: WatchRoomId): ProcedureView
  sim: WatchSim & { t: number; entities: Map<string, WatchEntity> }
  clock: { speed: number }
  cart: { x: number; z: number; heading: number }
  published: Partial<Omit<WatchUiState, 'set'>>[]
  ui: Partial<Omit<WatchUiState, 'set'>>
  lease: { held: boolean }
  flights: (CameraPose | null)[]
  level: { value: LevelId }
  area: { value: AreaId | null }
  gen: { value: number }
  reduced: { value: boolean }
  simCamera: Vec3
  /** Step the director `seconds` in frames of `dt`. */
  run(seconds: number, dt?: number): void
}

/** Put a camera at the player's eye where they stand (drawn), looking along their facing, as the chase camera would. */
export function placeCameraAtPlayer(camera: PerspectiveCamera, p: { x: number; z: number; facing: number }): void {
  const level = levelOf(p.x)
  camera.position.set(p.x + levelDx(level), LEVEL_Y[level] + 1.6, p.z)
  camera.lookAt(p.x + levelDx(level) + Math.sin(p.facing), LEVEL_Y[level] + 1.6, p.z + Math.cos(p.facing))
  camera.fov = 55
  camera.near = 0.1
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
}

/** `sim`: a live simulation to watch instead of the fake one (the harness's own fake sim is still in `h.sim`, unused then). */
export function harness(o: { phase?: PlayerMode; x?: number; z?: number; reduced?: boolean; sim?: WatchSim } = {}): Harness {
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 500)
  const player = fakePlayer(o.phase ?? 'walk', o.x ?? -20, o.z ?? 3)
  if (player.phase === 'overview') {
    camera.position.set(-11, 80, 66)
    camera.lookAt(-11, 0, 0)
  } else placeCameraAtPlayer(camera, player)
  camera.updateMatrixWorld()
  const view = emptyProcedureView()
  const cart = { x: SURGERY.cart.park.at.x, z: SURGERY.cart.park.at.z, heading: Math.PI / 2 }
  const cryo: FakeCryo = { state: { procedure: emptyProcedureView(), tablePos: 0, target: 'kidney', needle: -1, needles: [] }, calls: [], answer: 'started', startsAt: null, why: null }
  const imaging: FakeImaging = { view: emptyProcedureView(), calls: [], answer: 'started', startsAt: null }
  const sim = {
    t: 0,
    player: null,
    entities: new Map<string, WatchEntity>(),
    surgery: { state: { procedure: view, robot: { cart } }, startWatch: (): WatchResult => 'started', watchStartsAt: null },
    cryoSuite: {
      state: cryo.state,
      startWatch: (target: CryoTarget, opts?: { fromStart?: boolean }): WatchResult => {
        cryo.calls.push({ target, fromStart: opts?.fromStart === true })
        return cryo.answer
      },
      get watchStartsAt() {
        return cryo.startsAt
      },
      get whyNoTeam() {
        return cryo.why
      },
    },
    imaging: {
      scanners: { us: { procedure: imaging.view } },
      startWatch: (protocol: string, opts?: { fromStart?: boolean }): WatchResult => {
        imaging.calls.push({ protocol, fromStart: opts?.fromStart === true })
        return imaging.answer
      },
      get watchStartsAt() {
        return imaging.startsAt
      },
    },
  }
  const published: Partial<Omit<WatchUiState, 'set'>>[] = []
  const ui: Partial<Omit<WatchUiState, 'set'>> = {}
  const lease = { held: false }
  const flights: (CameraPose | null)[] = []
  const level = { value: 1 as LevelId }
  const area = { value: null as AreaId | null }
  const gen = { value: 0 }
  const reduced = { value: o.reduced ?? false }
  const simCamera = { x: 0, y: 0, z: 0 }
  const clock = { speed: 1 }
  const obstacles = new Map<WatchRoomId, RoomObstacles>((['or', 'cryo', 'us'] as const).map((r) => [r, roomObstacles(r, getLayout().footprints)]))
  const rigPos = { x: -11, y: 80, z: 66 }
  const rigTgt = { x: -11, y: 0, z: 0 }
  const deps: DirectorDeps = {
    camera,
    sim: () => o.sim ?? sim,
    generation: () => gen.value,
    player: player.port,
    rig: () => ({
      getPosition: (out) => out.set(rigPos.x, rigPos.y, rigPos.z),
      getTarget: (out) => out.set(rigTgt.x, rigTgt.y, rigTgt.z),
    }),
    flyTo: (pose) => {
      flights.push(pose)
      if (player.phase === 'walk' || player.phase === 'toWalk') player.phase = 'toOverview'
    },
    overviewLevel: { get: () => level.value, set: (l) => (level.value = l) },
    focusArea: { get: () => area.value, set: (a) => (area.value = a) },
    lease: {
      take: () => {
        if (lease.held) return false
        lease.held = true
        return true
      },
      release: () => (lease.held = false),
    },
    reducedMotion: () => reduced.value,
    probe: new WallBoxProbe(),
    simCamera,
    publish: (patch) => {
      published.push(patch)
      Object.assign(ui, patch)
    },
    obstacles: (room) => obstacles.get(room) ?? null,
    clock: { speed: () => clock.speed, setSpeed: (n) => (clock.speed = n) },
  }
  // like the app's: closing the panels closes the room panel
  deps.prepare = () => {
    area.value = null
  }
  const director = new WatchDirector(deps)
  return {
    director,
    camera,
    player,
    view,
    cryo,
    imaging,
    viewOf: (room) => (room === 'or' ? view : room === 'cryo' ? cryo.state.procedure : imaging.view),
    sim,
    cart,
    published,
    ui,
    lease,
    flights,
    level,
    area,
    gen,
    reduced,
    simCamera,
    clock,
    run(seconds, dt = 1 / 60) {
      for (let t = 0; t < seconds - 1e-9; t += dt) director.update(dt)
    },
  }
}
