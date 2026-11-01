/**
 * R5 wave 3 (agent J): a body's mesh as plain numbers, so the drapes of the procedure rooms (src/scene/surgery/stage/proc) can fit themselves to the patient who lies there
 * as the GPU draws them: the near (LOD 0) vertices, their joints and weights, and the triangles. `skinInto` skins them as the avatar vertex shader does (a weighted blend
 * of the part rows the model wrote into the pose texture, binds already applied), into the person's ROOT frame with the height taken from the table top; it allocates
 * nothing. The procedural body is the same with one rigid part per vertex.
 */
import type { BufferAttribute, InstancedBufferGeometry } from 'three'
import { ROW_FLOATS, TEX } from './constants'

export interface SkinSource {
  /** Positions (3 per vertex, dequantised), joints and weights (4 per vertex), and the vertex count. */
  p: Float32Array
  j: Float32Array
  w: Float32Array
  n: number
  /** The triangles (3 indices each). */
  index: ArrayLike<number>
}

const cache = new WeakMap<InstancedBufferGeometry, SkinSource>()

/** A realistic body's near mesh (position, aJoints, aWeights) as plain numbers; made once per geometry. */
export function skinSourceOfBody(g: InstancedBufferGeometry): SkinSource {
  let s = cache.get(g)
  if (s !== undefined) return s
  const pos = g.getAttribute('position') as BufferAttribute
  const joints = g.getAttribute('aJoints') as BufferAttribute
  const weights = g.getAttribute('aWeights') as BufferAttribute
  const n = pos.count
  const p = new Float32Array(n * 3)
  const j = new Float32Array(n * 4)
  const w = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) p[i * 3 + c] = pos.getComponent(i, c)
    for (let c = 0; c < 4; c++) {
      j[i * 4 + c] = joints.getComponent(i, c)
      w[i * 4 + c] = weights.getComponent(i, c)
    }
  }
  s = { p, j, w, n, index: g.index!.array as ArrayLike<number> }
  cache.set(g, s)
  return s
}

/** The procedural body's near mesh: each vertex belongs to one part (`aPart.x`), rigid. */
export function skinSourceOfProcedural(g: InstancedBufferGeometry): SkinSource {
  let s = cache.get(g)
  if (s !== undefined) return s
  const pos = g.getAttribute('position') as BufferAttribute
  const part = g.getAttribute('aPart') as BufferAttribute
  const n = pos.count
  const p = new Float32Array(n * 3)
  const j = new Float32Array(n * 4)
  const w = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) p[i * 3 + c] = pos.getComponent(i, c)
    j[i * 4] = Math.round(part.getComponent(i, 0))
    w[i * 4] = 1
  }
  s = { p, j, w, n, index: g.index!.array as ArrayLike<number> }
  cache.set(g, s)
  return s
}

/**
 * Skin `src` with the part rows of the person at pose-texture row `row` of `data` (the model's `data`, the binds already applied): vertex i goes to out[3i..3i + 3) as
 * (x across, h = y - `surface`, z along the heading), the person's root frame with the pad's top as the zero of the height. Writes at most `cap` vertices; returns how many.
 */
export function skinInto(out: Float32Array, cap: number, src: SkinSource, data: Float32Array, row: number, surface: number): number {
  const base = row * ROW_FLOATS + TEX.parts * 4
  const n = src.n < cap ? src.n : cap
  const p = src.p
  const J = src.j
  const W = src.w
  for (let i = 0; i < n; i++) {
    const x = p[i * 3]
    const y = p[i * 3 + 1]
    const z = p[i * 3 + 2]
    let ox = 0
    let oy = 0
    let oz = 0
    for (let k = 0; k < 4; k++) {
      const w = W[i * 4 + k]
      if (w <= 0) continue
      const o = base + Math.round(J[i * 4 + k]) * 12
      ox += w * (data[o] * x + data[o + 1] * y + data[o + 2] * z + data[o + 3])
      oy += w * (data[o + 4] * x + data[o + 5] * y + data[o + 6] * z + data[o + 7])
      oz += w * (data[o + 8] * x + data[o + 9] * y + data[o + 10] * z + data[o + 11])
    }
    out[i * 3] = ox
    out[i * 3 + 1] = oy - surface
    out[i * 3 + 2] = oz
  }
  return n
}
