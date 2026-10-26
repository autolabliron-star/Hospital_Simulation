/**
 * R4: the cryoablation suite's live screens: ONE 1024 x 256 atlas canvas of four 256 x 256 tiles (planning, live CT, argon console, robot station) and
 * ONE merged mesh of five quads (the boom's plan and live screens, the CT desk's, the robot station's and the console's), on a basic textured material
 * with the imaging monitors' settings (map, toneMapped off, white vertex colours): the program the hospital already has. One draw call.
 *
 * A tile is painted in a logical box as wide as its screens' aspect (the screens are about 1.6 : 1) and squeezed into its 256 px, so the quads show
 * it undistorted. Repaints are gated (`CryoScreens.update`): only when what is shown changes (the state's version, the step, the robot's phase, the
 * ice in 1 % steps, the timer's second, the scan sweep and the needles going in, in 5 % steps), at most 2 Hz, 4 Hz while somebody looks (the focus or
 * you in the suite); the texture is uploaded only on a repaint. The layer does not call it while level 2 is hidden.
 */
import { CanvasTexture, Euler, Float32BufferAttribute, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Env, Surface } from '@/scene/imaging/images/ctx'
import { CRYO_SUITE } from '@/sim/places'
import { CRYO_STEPS, type CryoSuiteState } from '@/sim/types'
import { baseSliceFor, newBaseSliceCache, paintConsole, paintLive, paintPlanning, paintRobotStation, type BaseSliceCache } from './ctPaint'

export const ATLAS = { w: 1024, h: 256, tile: 256 } as const
export const TILE = { planning: 0, live: 1, console: 2, robot: 3 } as const
export type TileId = (typeof TILE)[keyof typeof TILE]

/** The logical width of each tile's painting (its height is 256): the aspect of the screens that show it. */
export const TILE_LOGICAL_W: readonly number[] = [
  Math.round(256 * (CRYO_SUITE.screens.roomPlan.w / CRYO_SUITE.screens.roomPlan.h)),
  Math.round(256 * (CRYO_SUITE.screens.roomLive.w / CRYO_SUITE.screens.roomLive.h)),
  Math.round(256 * (CRYO_SUITE.console.screen.w / CRYO_SUITE.console.screen.h)),
  Math.round(256 * (CRYO_SUITE.screens.robotStation.w / CRYO_SUITE.screens.robotStation.h)),
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

/** The five live faces: the anchors of CRYO_SUITE (sim x), each with the tile it shows. */
export const SCREEN_FACES: readonly ScreenFace[] = [
  { id: 'roomPlan', ...CRYO_SUITE.screens.roomPlan, tilt: 0, tile: TILE.planning },
  { id: 'roomLive', ...CRYO_SUITE.screens.roomLive, tilt: 0, tile: TILE.live },
  { id: 'ctConsole', ...CRYO_SUITE.screens.ctConsole, tilt: 0, tile: TILE.live },
  { id: 'robotStation', ...CRYO_SUITE.screens.robotStation, tilt: 0, tile: TILE.robot },
  { id: 'console', ...CRYO_SUITE.console.screen, tile: TILE.console },
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
const KEY_LEN = 8

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
  return out
}

export interface RepaintGate {
  key: Float64Array
  next: Float64Array
  /** When the last repaint was (s, any clock); -Infinity before the first. */
  last: number
  repaints: number
}

export const newRepaintGate = (): RepaintGate => ({ key: new Float64Array(KEY_LEN).fill(Number.NaN), next: new Float64Array(KEY_LEN), last: Number.NEGATIVE_INFINITY, repaints: 0 })

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
// The screens
// ---------------------------------------------------------------------------------------------

export interface CryoScreens {
  mesh: Mesh
  material: MeshBasicMaterial
  texture: CanvasTexture
  atlas: Surface
  gate: RepaintGate
  base: BaseSliceCache
  /** Repaint and upload when the gate allows; true when it did. */
  update(s: CryoSuiteState, now: number, hot: boolean): boolean
  /** Paint all four tiles (no gate). */
  paintAll(s: CryoSuiteState): void
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
  const base = newBaseSliceCache()

  const tile = (s: CryoSuiteState, t: number): void => {
    const c = atlas.ctx
    const lw = TILE_LOGICAL_W[t]
    c.save()
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.beginPath()
    c.rect(t * ATLAS.tile, 0, ATLAS.tile, ATLAS.h)
    c.clip()
    c.setTransform(ATLAS.tile / lw, 0, 0, 1, t * ATLAS.tile, 0)
    if (t === TILE.planning) paintPlanning(c, lw, ATLAS.h, s, baseSliceFor(base, env, s.imageSeed))
    else if (t === TILE.live) paintLive(c, lw, ATLAS.h, s, baseSliceFor(base, env, s.imageSeed))
    else if (t === TILE.console) paintConsole(c, lw, ATLAS.h, s)
    else paintRobotStation(c, lw, ATLAS.h, s)
    c.restore()
  }
  const paintAll = (s: CryoSuiteState): void => {
    for (let t = 0; t < 4; t++) tile(s, t)
    texture.needsUpdate = true
  }

  return {
    mesh,
    material,
    texture,
    atlas,
    gate,
    base,
    paintAll,
    update(s: CryoSuiteState, now: number, hot: boolean): boolean {
      if (!shouldRepaint(gate, s, now, hot)) return false
      paintAll(s)
      return true
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
