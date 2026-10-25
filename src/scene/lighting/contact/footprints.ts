/**
 * Where a mesh touches the floor, for its contact shadows (./registry.ts): the parts of it within `band` of its lowest point, projected on the
 * plan, rasterised at `cell` and split into connected pieces, each returned as an axis-aligned rectangle (in the frame of `matrix`). A scanner's
 * base comes out as one block, a desk as four legs, a bed as its castors' frame. Built once at mount (or at a zone's load), never per frame.
 * Pure: positions in, rectangles out.
 */

export interface Footprint {
  /** Centre and half extents (metres) in the frame of the matrix given, on the plan (x, z). */
  cx: number
  cz: number
  halfX: number
  halfZ: number
  /** The lowest y of the piece (the floor it stands on), in that frame. */
  y: number
}

export interface FootprintOptions {
  /** Height above the lowest point that still counts as touching (m). Default 0.3. */
  band?: number
  /** Raster cell (m). Default 0.1. */
  cell?: number
  /** Pieces smaller than this (m^2) are dropped. Default 0.004 (a 6 cm leg stays). */
  minArea?: number
  /** At most this many pieces, largest first. Default 24. */
  max?: number
  /** The floor height to measure from (default: the lowest vertex). */
  floorY?: number
}

/**
 * Footprints of a triangle mesh. `positions` xyz triples, `index` optional (triangles), `matrix` an optional column-major 4x4 (three's
 * `Matrix4.elements`) applied to every vertex first.
 */
export function floorFootprints(positions: ArrayLike<number>, index: ArrayLike<number> | null, matrix: ArrayLike<number> | null, opts: FootprintOptions = {}): Footprint[] {
  const band = opts.band ?? 0.3
  const cell = opts.cell ?? 0.1
  const minArea = opts.minArea ?? 0.004
  const max = opts.max ?? 24
  const n = Math.floor(positions.length / 3)
  if (n < 3) return []
  const P = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]
    if (matrix) {
      const e = matrix
      P[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]
      P[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
      P[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
    } else {
      P[i * 3] = x
      P[i * 3 + 1] = y
      P[i * 3 + 2] = z
    }
  }
  let floor = opts.floorY ?? Infinity
  if (opts.floorY === undefined) for (let i = 0; i < n; i++) floor = Math.min(floor, P[i * 3 + 1])
  const top = floor + band
  const tris = index ? Math.floor(index.length / 3) : Math.floor(n / 3)
  const vi = (t: number, k: number): number => (index ? index[t * 3 + k] : t * 3 + k)
  // the plan box of the touching triangles
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  const touching: number[] = []
  for (let t = 0; t < tris; t++) {
    const a = vi(t, 0)
    const b = vi(t, 1)
    const c = vi(t, 2)
    const lo = Math.min(P[a * 3 + 1], P[b * 3 + 1], P[c * 3 + 1])
    if (lo > top) continue
    touching.push(t)
    for (const v of [a, b, c]) {
      x0 = Math.min(x0, P[v * 3])
      x1 = Math.max(x1, P[v * 3])
      z0 = Math.min(z0, P[v * 3 + 2])
      z1 = Math.max(z1, P[v * 3 + 2])
    }
  }
  if (touching.length === 0) return []
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1)
  const nz = Math.max(1, Math.ceil((z1 - z0) / cell) + 1)
  if (nx * nz > 4_000_000) return [{ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, halfX: (x1 - x0) / 2, halfZ: (z1 - z0) / 2, y: floor }]
  const grid = new Uint8Array(nx * nz)
  for (const t of touching) {
    // the part of the triangle under `top`: its plan box (a box bottom fills its rectangle, a wall face draws a thin line)
    let tx0 = Infinity
    let tx1 = -Infinity
    let tz0 = Infinity
    let tz1 = -Infinity
    for (let k = 0; k < 3; k++) {
      const v = vi(t, k)
      tx0 = Math.min(tx0, P[v * 3])
      tx1 = Math.max(tx1, P[v * 3])
      tz0 = Math.min(tz0, P[v * 3 + 2])
      tz1 = Math.max(tz1, P[v * 3 + 2])
    }
    const c0 = Math.floor((tx0 - x0) / cell)
    const c1 = Math.floor((tx1 - x0) / cell)
    const r0 = Math.floor((tz0 - z0) / cell)
    const r1 = Math.floor((tz1 - z0) / cell)
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r * nx + c] = 1
  }
  // connected pieces (8-neighbours), each as a box
  const seen = new Uint8Array(nx * nz)
  const stack: number[] = []
  const out: Footprint[] = []
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] || seen[i]) continue
    let c0 = Infinity
    let c1 = -Infinity
    let r0 = Infinity
    let r1 = -Infinity
    seen[i] = 1
    stack.push(i)
    while (stack.length) {
      const j = stack.pop() as number
      const r = Math.floor(j / nx)
      const c = j - r * nx
      c0 = Math.min(c0, c)
      c1 = Math.max(c1, c)
      r0 = Math.min(r0, r)
      r1 = Math.max(r1, r)
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr
          const cc = c + dc
          if (rr < 0 || cc < 0 || rr >= nz || cc >= nx) continue
          const k = rr * nx + cc
          if (grid[k] && !seen[k]) {
            seen[k] = 1
            stack.push(k)
          }
        }
      }
    }
    // the cells' extent, clipped back to the triangles' own box (a cell overhangs by up to one cell)
    const bx0 = Math.max(x0 + c0 * cell, x0)
    const bx1 = Math.min(x0 + (c1 + 1) * cell, x1)
    const bz0 = Math.max(z0 + r0 * cell, z0)
    const bz1 = Math.min(z0 + (r1 + 1) * cell, z1)
    const hx = Math.max((bx1 - bx0) / 2, cell / 4)
    const hz = Math.max((bz1 - bz0) / 2, cell / 4)
    if (4 * hx * hz < minArea) continue
    out.push({ cx: (bx0 + bx1) / 2, cz: (bz0 + bz1) / 2, halfX: hx, halfZ: hz, y: floor })
  }
  out.sort((a, b) => b.halfX * b.halfZ - a.halfX * a.halfZ)
  return out.slice(0, max)
}
