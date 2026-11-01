/**
 * R4: the cryoablation suite's live screens: ONE 1280 x 256 atlas canvas of five 256 x 256 tiles (planning, live CT, argon console, robot station and,
 * R5 wave 3, the anaesthesia machine's monitor) and ONE merged mesh of six quads (the boom's plan and live screens, the CT desk's, the robot station's,
 * the console's and the anaesthesia monitor's), on a basic textured material with the imaging monitors' settings (map, toneMapped off, white vertex
 * colours): the program the hospital already has. One draw call.
 *
 * A tile is painted in a logical box as wide as its screens' aspect (the screens are about 1.6 : 1) and squeezed into its 256 px, so the quads show
 * it undistorted. Repaints are gated (`CryoScreens.update`): only when what is shown changes (the state's version, the step, the robot's phase, the
 * ice in 1 % steps, the timer's second, the scan sweep and the needles going in, in 5 % steps), at most 2 Hz, 4 Hz while somebody looks (the focus,
 * you in the suite or the watch camera on the room); the texture is uploaded only on a repaint. The layer does not call it while level 2 is hidden.
 *
 * The anaesthesia monitor's tile has a gate of its own (`MonitorGate`): while the machine is in use its traces scroll, so it changes four times a
 * (display) second and is repainted at the same 2 Hz / 4 Hz; in standby, or with the clock stopped (the sim paused), it never changes and is never
 * repainted. When the main gate repaints, the monitor's tile goes with it; when only the monitor changes, only its tile is painted (one upload).
 */
import { CanvasTexture, Euler, Float32BufferAttribute, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Env, Surface } from '@/scene/imaging/images/ctx'
import { CRYO_SUITE } from '@/sim/places'
import { CRYO_STEPS, type CryoSuiteState } from '@/sim/types'
import { ANAES_SCREEN } from './anaesMachine'
import { anaesInUse } from './anaesInUse'
import { newMonitorMemory, observeMonitor, paintAnaesMonitor, type MonitorMemory } from './anaesMonitor'
import { baseSliceFor, newBaseSliceCache, paintConsole, paintLive, paintPlanning, paintRobotStation, type BaseSliceCache } from './ctPaint'

export const ATLAS = { w: 1280, h: 256, tile: 256 } as const
export const TILE = { planning: 0, live: 1, console: 2, robot: 3, anaes: 4 } as const
/** How many tiles the atlas has. */
export const TILE_COUNT = 5
export type TileId = (typeof TILE)[keyof typeof TILE]

/** The logical width of each tile's painting (its height is 256): the aspect of the screens that show it. */
export const TILE_LOGICAL_W: readonly number[] = [
  Math.round(256 * (CRYO_SUITE.screens.roomPlan.w / CRYO_SUITE.screens.roomPlan.h)),
  Math.round(256 * (CRYO_SUITE.screens.roomLive.w / CRYO_SUITE.screens.roomLive.h)),
  Math.round(256 * (CRYO_SUITE.console.screen.w / CRYO_SUITE.console.screen.h)),
  Math.round(256 * (CRYO_SUITE.screens.robotStation.w / CRYO_SUITE.screens.robotStation.h)),
  Math.round(256 * (ANAES_SCREEN.w / ANAES_SCREEN.h)),
]

export interface ScreenFace {
  id: string
  x: number
  y: number
  z: number
  w: number
  h: number
  heading: number
  tilt: number
  tile: TileId
}

/** The six live faces: the anchors of CRYO_SUITE (sim x), each with the tile it shows (the last: the anaesthesia machine's monitor, anaesMachine.ts). */
export const SCREEN_FACES: readonly ScreenFace[] = [
  { id: 'roomPlan', ...CRYO_SUITE.screens.roomPlan, tilt: 0, tile: TILE.planning },
  { id: 'roomLive', ...CRYO_SUITE.screens.roomLive, tilt: 0, tile: TILE.live },
  { id: 'ctConsole', ...CRYO_SUITE.screens.ctConsole, tilt: 0, tile: TILE.live },
  { id: 'robotStation', ...CRYO_SUITE.screens.robotStation, tilt: 0, tile: TILE.robot },
  { id: 'console', ...CRYO_SUITE.console.screen, tile: TILE.console },
  { id: 'anaesMonitor', ...ANAES_SCREEN, tile: TILE.anaes },
]

/** The u range of a tile in the atlas. */
export function tileU(tile: number): [number, number] {
  return [(tile * ATLAS.tile) / ATLAS.w, ((tile + 1) * ATLAS.tile) / ATLAS.w]
}

/** One face: a quad at the anchor (facing its heading, leaning back by its tilt), its u mapped onto its tile, white vertex colours. */
export function faceQuad(f: ScreenFace): BufferGeometry {
  const g = new PlaneGeometry(f.w, f.h)
  const q = new Quaternion().setFromEuler(new Euler(-f.tilt, f.heading, 0, 'YXZ'))
  g.applyMatrix4(new Matrix4().compose(new Vector3(f.x, f.y, f.z), q, new Vector3(1, 1, 1)))
  const uv = g.getAttribute('uv')
  const [u0, u1] = tileU(f.tile)
  for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * (u1 - u0))
  uv.needsUpdate = true
  g.setAttribute('color', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3))
  return g
}

export function screensGeometry(faces: readonly ScreenFace[] = SCREEN_FACES): BufferGeometry {
  const parts = faces.map(faceQuad)
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error('cryo suite: could not merge the screens')
  merged.computeBoundingSphere()
  return merged
}

// ---------------------------------------------------------------------------------------------
// The repaint gate
// ---------------------------------------------------------------------------------------------

/** Repaint periods (s): somebody looking, and nobody. */
export const HOT_PERIOD = 0.25
export const COOL_PERIOD = 0.5

const PHASES = ['stowed', 'deploying', 'aiming', 'aligned', 'retracting'] as const
const TARGETS = ['kidney', 'lung', 'liver'] as const
/** The length of the main gate's key (and of an inset's: `screenKeyInto` fills this many numbers). */
export const KEY_LEN = 9

/** The numbers that decide whether the screens show something new, written into `out`. */
export function screenKeyInto(s: CryoSuiteState, out: Float64Array): Float64Array {
  let ins = 0
  for (const n of s.needles) ins += Math.round((n.inserted < 0 ? 0 : n.inserted > 1 ? 1 : n.inserted) * 20)
  out[0] = s.version
  out[1] = CRYO_STEPS.indexOf(s.step)
  out[2] = PHASES.indexOf(s.robot.phase as (typeof PHASES)[number]) * 100 + s.robot.needle
  out[3] = Math.floor(s.ice * 100)
  out[4] = Math.floor(s.timer)
  out[5] = Math.floor(s.scan * 20)
  out[6] = ins
  out[7] = s.imageSeed
  // (R5 wave 3: the lung's and the liver's pictures are not the kidney's)
  out[8] = TARGETS.indexOf(s.target)
  return out
}

export interface RepaintGate {
  key: Float64Array
  next: Float64Array
  /** When the last repaint was (s, any clock); -Infinity before the first. */
  last: number
  repaints: number
}

export const newRepaintGate = (len = KEY_LEN): RepaintGate => ({ key: new Float64Array(len).fill(Number.NaN), next: new Float64Array(len), last: Number.NEGATIVE_INFINITY, repaints: 0 })

/** Should the screens repaint now? (Something changed, and the period since the last repaint is over.) Commits the key when it says yes. */
export function shouldRepaint(g: RepaintGate, s: CryoSuiteState, now: number, hot: boolean): boolean {
  if (now - g.last < (hot ? HOT_PERIOD : COOL_PERIOD)) return false
  screenKeyInto(s, g.next)
  let same = true
  for (let i = 0; i < KEY_LEN; i++) {
    if (g.next[i] !== g.key[i]) {
      same = false
      break
    }
  }
  if (same) return false
  g.key.set(g.next)
  g.last = now
  g.repaints++
  return true
}

// ---------------------------------------------------------------------------------------------
// The anaesthesia monitor's gate
// ---------------------------------------------------------------------------------------------

const MON_KEY_LEN = 5

/**
 * The numbers that decide whether the monitor shows something new, written into `out`: in use or not, the held breath, the case's picture seed and
 * target, and (in use only) the display clock in quarter seconds, so the scrolling traces repaint 4 times a display second and a standby screen, or a
 * stopped clock, never.
 */
export function monitorKeyInto(s: CryoSuiteState, tm: number, out: Float64Array): Float64Array {
  const use = anaesInUse(s)
  out[0] = use ? 1 : 0
  out[1] = s.apnoea ? 1 : 0
  out[2] = s.imageSeed
  out[3] = TARGETS.indexOf(s.target)
  out[4] = use ? Math.floor(tm * 4) : 0
  return out
}

/**
 * Should the monitor's tile repaint now? Something it shows changed, and the period since the last repaint of ANY tile (`since`, the main gate's) and of
 * this one is over. Commits the key when it says yes.
 */
export function shouldRepaintMonitor(g: RepaintGate, s: CryoSuiteState, now: number, hot: boolean, tm: number, since: number): boolean {
  const period = hot ? HOT_PERIOD : COOL_PERIOD
  if (now - g.last < period || now - since < period) return false
  monitorKeyInto(s, tm, g.next)
  let same = true
  for (let i = 0; i < MON_KEY_LEN; i++) {
    if (g.next[i] !== g.key[i]) {
      same = false
      break
    }
  }
  if (same) return false
  g.key.set(g.next)
  g.last = now
  g.repaints++
  return true
}

/** The monitor's tile was painted along with the others at `now`: remember what it shows now and when (the monitor's gate does not count it as its own repaint). */
export function commitMonitor(g: RepaintGate, s: CryoSuiteState, now: number, tm: number): void {
  monitorKeyInto(s, tm, g.next)
  g.key.set(g.next)
  g.last = now
}

// ---------------------------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------------------------

export interface CryoScreens {
  mesh: Mesh
  material: MeshBasicMaterial
  texture: CanvasTexture
  atlas: Surface
  gate: RepaintGate
  /** The anaesthesia monitor's own gate and its held-breath memory. */
  monitorGate: RepaintGate
  monitor: MonitorMemory
  base: BaseSliceCache
  /**
   * Repaint and upload when a gate allows; true when it did. `now` is the real clock (the gates' periods); `tm` is the monitor's display clock (real
   * seconds that stop while the sim is paused; `now` when omitted).
   */
  update(s: CryoSuiteState, now: number, hot: boolean, tm?: number): boolean
  /** Paint all five tiles (no gate) at display time `tm`. */
  paintAll(s: CryoSuiteState, tm?: number): void
  dispose(): void
}

export function createCryoScreens(env: Env): CryoScreens {
  const atlas = env.createSurface(ATLAS.w, ATLAS.h)
  const texture = new CanvasTexture(atlas.canvas as unknown as HTMLCanvasElement)
  texture.colorSpace = SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  const material = new MeshBasicMaterial({ map: texture, toneMapped: false, vertexColors: true })
  const geometry = screensGeometry()
  const mesh = new Mesh(geometry, material)
  mesh.name = 'cryo-screens'
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  const gate = newRepaintGate()
  const monitorGate = newRepaintGate(MON_KEY_LEN)
  const monitor = newMonitorMemory()
  const base = newBaseSliceCache()

  const tile = (s: CryoSuiteState, t: number, tm: number): void => {
    const c = atlas.ctx
    const lw = TILE_LOGICAL_W[t]
    c.save()
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.beginPath()
    c.rect(t * ATLAS.tile, 0, ATLAS.tile, ATLAS.h)
    c.clip()
    c.setTransform(ATLAS.tile / lw, 0, 0, 1, t * ATLAS.tile, 0)
    if (t === TILE.planning) paintPlanning(c, lw, ATLAS.h, s, baseSliceFor(base, env, s.imageSeed, s.target))
    else if (t === TILE.live) paintLive(c, lw, ATLAS.h, s, baseSliceFor(base, env, s.imageSeed, s.target))
    else if (t === TILE.console) paintConsole(c, lw, ATLAS.h, s)
    else if (t === TILE.robot) paintRobotStation(c, lw, ATLAS.h, s)
    else paintAnaesMonitor(c, lw, ATLAS.h, s, monitor, tm)
    c.restore()
  }
  const paintAll = (s: CryoSuiteState, tm = 0): void => {
    for (let t = 0; t < TILE_COUNT; t++) tile(s, t, tm)
    texture.needsUpdate = true
  }

  return {
    mesh,
    material,
    texture,
    atlas,
    gate,
    monitorGate,
    monitor,
    base,
    paintAll,
    update(s: CryoSuiteState, now: number, hot: boolean, tm: number = now): boolean {
      observeMonitor(monitor, s, tm)
      if (shouldRepaint(gate, s, now, hot)) {
        // every tile, the monitor's with them (its own gate learns what it shows now, and when)
        commitMonitor(monitorGate, s, now, tm)
        paintAll(s, tm)
        return true
      }
      if (shouldRepaintMonitor(monitorGate, s, now, hot, tm, gate.last)) {
        tile(s, TILE.anaes, tm)
        texture.needsUpdate = true
        return true
      }
      return false
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
