/**
 * Turns the plain-data layout into three.js geometry: ONE merged mesh per (material, shadow flags) and a few instanced
 * meshes (coloured decals, coloured props, tree trunks and canopies). Pure three.js (no DOM, no React), so the draw-call
 * and triangle budget is measured in node by the tests.
 *
 * Shapes are built from cached unit geometries and baked with their transform before merging, so a wall, a bed and a
 * pot plant are all just triangles in a material's merged buffer.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32 } from '@/sim/rng'
import { ATLAS_COLS, ATLAS_ROWS } from '../layout/screenTiles'
import type { BuildingLayout, CommandWallPanel, MatKey, Prim, TreeSpec } from '../layout/types'

export interface MergedMesh {
  key: string
  mat: MatKey
  geometry: BufferGeometry
  castShadow: boolean
  receiveShadow: boolean
  /** Hidden while walking (the walk-mode building replaces it). */
  overviewOnly?: boolean
}

export interface InstancedSpec {
  key: string
  mat: MatKey
  geometry: BufferGeometry
  count: number
  /** 16 floats per instance (column-major Matrix4). */
  matrices: Float32Array
  /** 3 floats per instance (linear RGB), or null when every instance keeps the material's colour. */
  colors: Float32Array | null
  castShadow: boolean
  receiveShadow: boolean
}

export interface CompiledBuilding {
  merged: MergedMesh[]
  instanced: InstancedSpec[]
  /** All `quad` screens in one geometry, UVs pointing into the screen atlas (null if there are none). */
  screens: BufferGeometry | null
  /** The command center's curved video wall, UVs 0..1 across the whole wall. */
  commandWall: BufferGeometry | null
  /** Quad count of the floor labels (the label atlas itself is built in the browser). */
  labelQuads: number
}

// ---------------------------------------------------------------------------------------------
// Unit geometries
// ---------------------------------------------------------------------------------------------

const unitBox = new BoxGeometry(1, 1, 1)
const unitPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
const unitSphereCoarse = new SphereGeometry(0.5, 8, 6)
const unitSphereFine = new SphereGeometry(0.5, 12, 8)
const unitCylCoarse = new CylinderGeometry(0.5, 0.5, 1, 10, 1)
const unitCylFine = new CylinderGeometry(0.5, 0.5, 1, 18, 1)
/** RoundedBoxGeometry is non-indexed; weld it so it merges with the indexed shapes (and stores fewer vertices). */
const indexed = (g: BufferGeometry): BufferGeometry => {
  const welded = mergeVertices(g)
  g.dispose()
  return welded
}
const unitRounded = indexed(new RoundedBoxGeometry(1, 1, 1, 1, 0.12))

const roundedCache = new Map<string, BufferGeometry>()
const capsuleCache = new Map<string, BufferGeometry>()
const torusCache = new Map<string, BufferGeometry>()

const k = (n: number): string => n.toFixed(3)

function roundedBox(w: number, h: number, d: number, r: number): BufferGeometry {
  const key = `${k(w)}|${k(h)}|${k(d)}|${k(r)}`
  let g = roundedCache.get(key)
  if (!g) {
    g = indexed(new RoundedBoxGeometry(w, h, d, 1, Math.max(0.002, r)))
    roundedCache.set(key, g)
  }
  return g
}

function capsule(dia: number, h: number): BufferGeometry {
  const key = `${k(dia)}|${k(h)}`
  let g = capsuleCache.get(key)
  if (!g) {
    g = new CapsuleGeometry(dia / 2, Math.max(0.001, h - dia), 3, 10)
    capsuleCache.set(key, g)
  }
  return g
}

/** A torus lying flat (axis y), outer diameter `outer`, tube diameter `tube`. */
function torus(outer: number, tube: number): BufferGeometry {
  const key = `${k(outer)}|${k(tube)}`
  let g = torusCache.get(key)
  if (!g) {
    g = new TorusGeometry((outer - tube) / 2, tube / 2, 10, 28).rotateX(Math.PI / 2)
    torusCache.set(key, g)
  }
  return g
}

const _m = new Matrix4()
const _q = new Quaternion()
const _e = new Euler()
const _p = new Vector3()
const _s = new Vector3()
const ONE = new Vector3(1, 1, 1)

function matrixOf(p: Prim, scale: Vector3): Matrix4 {
  _e.set(p.rotationX ?? 0, p.rotationY, p.rotationZ ?? 0, 'YXZ')
  _q.setFromEuler(_e)
  _p.set(p.position[0], p.position[1], p.position[2])
  return _m.compose(_p, _q, scale)
}

/** The unit (or sized) base geometry of a prim and the scale to apply to it. */
function baseOf(p: Prim, instanced: boolean): { geometry: BufferGeometry; scale: Vector3 } {
  const [sx, sy, sz] = p.size
  switch (p.shape) {
    case 'box':
      return { geometry: unitBox, scale: _s.set(sx, sy, sz) }
    case 'roundedBox':
      if (instanced) return { geometry: unitRounded, scale: _s.set(sx, sy, sz) }
      return { geometry: roundedBox(sx, sy, sz, p.radius ?? 0.03), scale: ONE }
    case 'cylinder':
      return { geometry: Math.max(sx, sz) > 0.35 ? unitCylFine : unitCylCoarse, scale: _s.set(sx, sy, sz) }
    case 'sphere':
      return { geometry: Math.max(sx, sy, sz) > 0.35 ? unitSphereFine : unitSphereCoarse, scale: _s.set(sx, sy, sz) }
    case 'capsule':
      return { geometry: capsule(sx, sy), scale: ONE }
    case 'torus':
      return { geometry: torus(sx, sy), scale: ONE }
    case 'plane':
      return { geometry: unitPlane, scale: _s.set(sx, 1, sz) }
    case 'quad':
      throw new Error('quads are screens: they are compiled separately')
  }
}

function bake(p: Prim): BufferGeometry {
  const { geometry, scale } = baseOf(p, false)
  return geometry.clone().applyMatrix4(matrixOf(p, scale))
}

const triangles = (g: BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3

// ---------------------------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------------------------

/** Coloured props and decals are instanced (the palette has no per-vertex colour): these tint through `setColorAt`. */
const isTinted = (p: Prim): boolean => p.color !== undefined && (p.mat === 'tinted' || p.mat === 'tintedGlow')

function stripUv(g: BufferGeometry): BufferGeometry {
  // merged buffers must share attributes: keep position, normal, uv
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
  return g
}

function mergeAll(parts: BufferGeometry[], what: string): BufferGeometry {
  const merged = mergeGeometries(parts.map(stripUv), false)
  for (const g of parts) g.dispose()
  if (!merged) throw new Error(`building: could not merge ${what}`)
  return merged
}

function screenGeometry(prims: Prim[]): BufferGeometry | null {
  if (prims.length === 0) return null
  const parts = prims.map((p) => {
    const g = new PlaneGeometry(p.size[0], p.size[1])
    const tile = p.tile ?? 0
    const col = tile % ATLAS_COLS
    const row = Math.floor(tile / ATLAS_COLS)
    const u0 = col / ATLAS_COLS
    const u1 = (col + 1) / ATLAS_COLS
    const v1 = 1 - row / ATLAS_ROWS
    const v0 = 1 - (row + 1) / ATLAS_ROWS
    const uv = g.getAttribute('uv')
    // inset by a texel-ish margin so neighbouring tiles never bleed in
    const pad = 0.002
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + pad + uv.getX(i) * (u1 - u0 - 2 * pad), v0 + pad + uv.getY(i) * (v1 - v0 - 2 * pad))
    return g.applyMatrix4(matrixOf(p, ONE))
  })
  return mergeAll(parts, 'screens')
}

function commandWallGeometry(panels: CommandWallPanel[]): BufferGeometry | null {
  if (panels.length === 0) return null
  const parts = panels.map((c) => {
    const g = new PlaneGeometry(c.width, c.height)
    const uv = g.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setX(i, c.u0 + uv.getX(i) * (c.u1 - c.u0))
    _e.set(0, c.heading, 0, 'YXZ')
    _q.setFromEuler(_e)
    _p.set(c.x, c.y0 + c.height / 2, c.z)
    return g.applyMatrix4(_m.compose(_p, _q, ONE))
  })
  return mergeAll(parts, 'command wall')
}

// --- trees ---------------------------------------------------------------------------------------

const unitBlob = new IcosahedronGeometry(0.5, 1)
const unitTrunk = new CylinderGeometry(0.34, 0.5, 1, 8, 1)

interface TreeInstances {
  trunks: InstancedSpec | null
  canopies: InstancedSpec | null
}

function treeInstances(trees: TreeSpec[]): TreeInstances {
  if (trees.length === 0) return { trunks: null, canopies: null }
  const blobsPerTree = 5
  const trunkM = new Float32Array(trees.length * 16)
  const canM = new Float32Array(trees.length * blobsPerTree * 16)
  const canC = new Float32Array(trees.length * blobsPerTree * 3)
  const col = new Color()
  const base = new Color()
  trees.forEach((t, i) => {
    const rnd = mulberry32(Math.floor(t.seed * 1e6) + i * 7919)
    const trunkH = t.height * 0.5
    _q.identity()
    _p.set(t.x, trunkH / 2, t.z)
    _s.set(0.34, trunkH, 0.34)
    _m.compose(_p, _q, _s).toArray(trunkM, i * 16)
    base.set(t.tint)
    // a loose cluster: one big crown blob and four smaller ones round it, light on top
    const crownR = t.height * 0.3
    for (let b = 0; b < blobsPerTree; b++) {
      const idx = i * blobsPerTree + b
      const ang = (b / (blobsPerTree - 1)) * Math.PI * 2 + rnd() * 0.8
      const crown = b === 0
      const r = crown ? crownR * 2.2 : crownR * (1.2 + rnd() * 0.5)
      const off = crown ? 0 : crownR * (0.75 + rnd() * 0.3)
      _p.set(t.x + Math.cos(ang) * off, trunkH * 0.85 + (crown ? crownR * 1.15 : crownR * (0.55 + rnd() * 0.5)), t.z + Math.sin(ang) * off)
      _e.set(0, rnd() * Math.PI, 0)
      _q.setFromEuler(_e)
      _s.set(r, r * 0.82, r)
      _m.compose(_p, _q, _s).toArray(canM, idx * 16)
      col.copy(base).offsetHSL(0, 0, (rnd() - 0.5) * 0.07 + (crown ? 0.02 : 0))
      canC[idx * 3] = col.r
      canC[idx * 3 + 1] = col.g
      canC[idx * 3 + 2] = col.b
    }
  })
  return {
    trunks: { key: 'tree-trunks', mat: 'trunk', geometry: unitTrunk, count: trees.length, matrices: trunkM, colors: null, castShadow: true, receiveShadow: false },
    canopies: { key: 'tree-canopies', mat: 'tinted', geometry: unitBlob, count: trees.length * blobsPerTree, matrices: canM, colors: canC, castShadow: true, receiveShadow: true },
  }
}

/** Compile the layout. Deterministic: same layout, same geometry. */
export function compileLayout(layout: BuildingLayout): CompiledBuilding {
  const groups = new Map<string, { mat: MatKey; cast: boolean; recv: boolean; overview: boolean; parts: BufferGeometry[] }>()
  const inst = new Map<string, { mat: MatKey; geometry: BufferGeometry; cast: boolean; recv: boolean; prims: Prim[] }>()
  const quads: Prim[] = []

  for (const p of layout.prims) {
    if (p.shape === 'quad') {
      quads.push(p)
      continue
    }
    if (isTinted(p)) {
      const { geometry } = baseOf(p, true)
      const key = `${p.mat}|${p.shape}|${geometry.uuid}|${p.castShadow ? 1 : 0}${p.receiveShadow ? 1 : 0}`
      const g = inst.get(key) ?? { mat: p.mat, geometry, cast: p.castShadow, recv: p.receiveShadow, prims: [] }
      g.prims.push(p)
      inst.set(key, g)
      continue
    }
    const key = `${p.mat}|${p.castShadow ? 1 : 0}${p.receiveShadow ? 1 : 0}${p.overviewOnly ? '|overview' : ''}`
    const g = groups.get(key) ?? { mat: p.mat, cast: p.castShadow, recv: p.receiveShadow, overview: p.overviewOnly === true, parts: [] }
    g.parts.push(bake(p))
    groups.set(key, g)
  }

  const merged: MergedMesh[] = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, g]) => ({ key, mat: g.mat, geometry: mergeAll(g.parts, key), castShadow: g.cast, receiveShadow: g.recv, ...(g.overview ? { overviewOnly: true } : {}) }))

  const instanced: InstancedSpec[] = [...inst.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, g]) => {
      const matrices = new Float32Array(g.prims.length * 16)
      const colors = new Float32Array(g.prims.length * 3)
      const col = new Color()
      g.prims.forEach((p, i) => {
        const { scale } = baseOf(p, true)
        matrixOf(p, scale).toArray(matrices, i * 16)
        col.set(p.color ?? '#ffffff')
        colors[i * 3] = col.r
        colors[i * 3 + 1] = col.g
        colors[i * 3 + 2] = col.b
      })
      return { key, mat: g.mat, geometry: g.geometry, count: g.prims.length, matrices, colors, castShadow: g.cast, receiveShadow: g.recv }
    })

  const trees = treeInstances(layout.trees)
  if (trees.trunks) instanced.push(trees.trunks)
  if (trees.canopies) instanced.push(trees.canopies)

  return {
    merged,
    instanced,
    screens: screenGeometry(quads),
    commandWall: commandWallGeometry(layout.commandWall),
    labelQuads: layout.labels.length,
  }
}

export interface BudgetEstimate {
  mergedMeshes: number
  instancedMeshes: number
  extraMeshes: number
  drawCalls: number
  triangles: number
}

/** Draw calls (merged + instanced + screens + command wall + labels) and triangles of a compiled building. */
export function estimateBudget(c: CompiledBuilding): BudgetEstimate {
  let tris = 0
  for (const m of c.merged) tris += triangles(m.geometry)
  for (const i of c.instanced) tris += triangles(i.geometry) * i.count
  const extra = (c.screens ? 1 : 0) + (c.commandWall ? 1 : 0) + (c.labelQuads > 0 ? 1 : 0)
  if (c.screens) tris += triangles(c.screens)
  if (c.commandWall) tris += triangles(c.commandWall)
  tris += c.labelQuads * 2
  return {
    mergedMeshes: c.merged.length,
    instancedMeshes: c.instanced.length,
    extraMeshes: extra,
    drawCalls: c.merged.length + c.instanced.length + extra,
    triangles: tris,
  }
}

export function disposeCompiled(c: CompiledBuilding): void {
  for (const m of c.merged) m.geometry.dispose()
  c.screens?.dispose()
  c.commandWall?.dispose()
  // instanced base geometries are shared module-level units: keep them
}
