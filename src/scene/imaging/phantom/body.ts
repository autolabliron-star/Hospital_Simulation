/**
 * R3 "Real screens": the synthetic body as signed-distance shapes. A body is a list of PARTS (one tissue each: the liver, a kidney's cortex,
 * a vertebral body), each the smooth union of a few convex MEMBERS (ellipsoids, capsules, tapered tubes, rounded boxes, elliptic
 * cylinders along the body axis) minus optional members (the renal hilum notch, a cavity). Where parts overlap, the higher LAYER wins
 * (a pyramid inside the cortex, the sinus fat inside both), so every point of the body has exactly one tissue.
 *
 * Coordinates are the patient's (DICOM LPS, millimetres): +x to the patient's LEFT, +y POSTERIOR, +z SUPERIOR, origin midway between the
 * hip-joint centres. Breathing moves the abdominal organs head-to-foot: each part has a `mobility` (0 for the wall, the spine and the
 * pelvis; about 1 for the liver and the spleen) and `labelAt` takes the current cranio-caudal shift, so an organ and its speckle slide
 * together under a still abdominal wall.
 *
 * `compile` packs everything into typed arrays and a uniform grid of candidate parts per 16 mm cell (sorted by layer), so a query costs a
 * handful of distance evaluations. Pure and allocation-free in the queries: the worker renders from it, and node tests read it directly.
 */

export type V3 = readonly [number, number, number]

export const M_ELLIPSOID = 0
export const M_CAPSULE = 1
export const M_BOX = 2
export const M_TAPER = 3
export const M_CONE = 4

/** Floats per member. */
const MS = 20
/** Grid cell size (mm). */
export const CELL = 16
/** The largest breathing shift (mm) a mobile part's box is padded by. */
export const MAX_BREATH = 16

interface MemberSpec {
  kind: number
  data: number[]
  box: [number, number, number, number, number, number]
}

interface PartSpec {
  name: string
  tissue: number
  layer: number
  mobility: number
  smooth: number
  outline: boolean
  members: MemberSpec[]
  minus: MemberSpec[]
}

export interface PartOptions {
  layer: number
  /** Breathing weight 0..1 (default 0: does not move). */
  mobility?: number
  /** Smooth-union radius between the members (mm, default 0: plain union). */
  smooth?: number
  /** This part is the body's outline (its surface is the skin): at most one per body. */
  outline?: boolean
}

// --- small vector helpers (build time only: they allocate) ---------------------------------------------------------

const sub = (a: V3, b: V3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: V3): [number, number, number] => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Rotation matrix (row-major 3x3, local -> world) from Euler degrees about x, then y, then z: R = Rz Ry Rx. */
export function eulerMatrix(rot: V3): number[] {
  const [ax, ay, az] = rot.map((d) => (d * Math.PI) / 180)
  const cx = Math.cos(ax)
  const sx = Math.sin(ax)
  const cy = Math.cos(ay)
  const sy = Math.sin(ay)
  const cz = Math.cos(az)
  const sz = Math.sin(az)
  // Rz * Ry * Rx
  return [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx]
}

/** A rotation (local -> world, row-major) whose local x and y axes point along `ex` and (the part of) `ey` perpendicular to it. */
export function basisMatrix(ex: V3, ey: V3): number[] {
  const x = norm(ex)
  const y = norm(sub(ey, x.map((v) => v * dot(ey, x)) as unknown as V3))
  const z = cross(x, y)
  // columns are the local axes in world coordinates
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]
}

/** The inverse rigid transform (world -> local) as a row-major 3x4 from a rotation R (local -> world) and a centre. */
function inverse34(R: number[], c: V3): number[] {
  // R^T and -R^T c
  const r = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]
  return [r[0], r[1], r[2], -(r[0] * c[0] + r[1] * c[1] + r[2] * c[2]), r[3], r[4], r[5], -(r[3] * c[0] + r[4] * c[1] + r[5] * c[2]), r[6], r[7], r[8], -(r[6] * c[0] + r[7] * c[1] + r[8] * c[2])]
}

/** The box of a centred shape with local half-extents `h` rotated by R. */
function rotatedBox(R: number[], c: V3, h: V3): [number, number, number, number, number, number] {
  const ex = Math.abs(R[0]) * h[0] + Math.abs(R[1]) * h[1] + Math.abs(R[2]) * h[2]
  const ey = Math.abs(R[3]) * h[0] + Math.abs(R[4]) * h[1] + Math.abs(R[5]) * h[2]
  const ez = Math.abs(R[6]) * h[0] + Math.abs(R[7]) * h[1] + Math.abs(R[8]) * h[2]
  return [c[0] - ex, c[1] - ey, c[2] - ez, c[0] + ex, c[1] + ey, c[2] + ez]
}

function segmentBox(a: V3, b: V3, r: number): [number, number, number, number, number, number] {
  return [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r]
}

// --- building -------------------------------------------------------------------------------------------------------

export class PartBuilder {
  private into: MemberSpec[]
  constructor(private readonly spec: PartSpec) {
    this.into = spec.members
  }

  private add(kind: number, data: number[], box: MemberSpec['box']): this {
    this.into.push({ kind, data, box })
    return this
  }

  /** The following members are SUBTRACTED from the part (until `plus()`). */
  minus(): this {
    this.into = this.spec.minus
    return this
  }

  plus(): this {
    this.into = this.spec.members
    return this
  }

  /** An ellipsoid: centre, radii along its local axes, rotation (Euler degrees about L, P, S) or an explicit basis matrix. */
  ellipsoid(c: V3, r: V3, rot: V3 | number[] = [0, 0, 0]): this {
    const R = rot.length === 9 ? (rot as number[]) : eulerMatrix(rot as V3)
    return this.add(M_ELLIPSOID, [...inverse34(R, c), r[0], r[1], r[2]], rotatedBox(R, c, r))
  }

  /** A sphere. */
  sphere(c: V3, r: number): this {
    return this.ellipsoid(c, [r, r, r])
  }

  /** A capsule between two points. */
  capsule(a: V3, b: V3, r: number): this {
    return this.add(M_CAPSULE, [a[0], a[1], a[2], b[0], b[1], b[2], r], segmentBox(a, b, r))
  }

  /** A tapered tube between two points (radius ra at a, rb at b). */
  cone(a: V3, b: V3, ra: number, rb: number): this {
    return this.add(M_CONE, [a[0], a[1], a[2], b[0], b[1], b[2], ra, rb], segmentBox(a, b, Math.max(ra, rb)))
  }

  /** A rounded box: centre, half extents, rounding radius, rotation. */
  box(c: V3, half: V3, round: number, rot: V3 | number[] = [0, 0, 0]): this {
    const R = rot.length === 9 ? (rot as number[]) : eulerMatrix(rot as V3)
    return this.add(M_BOX, [...inverse34(R, c), half[0], half[1], half[2], round], rotatedBox(R, c, half))
  }

  /**
   * An elliptic cylinder along the body axis from z0 to z1 (S), centred on (cx, cy) in L and P, its half-axes (along L, along P) going from
   * (a0, b0) at z0 to (a1, b1) at z1: the trunk, a limb, the abdominal wall.
   */
  taper(cx: number, cy: number, z0: number, z1: number, a0: number, b0: number, a1: number, b1: number): this {
    const zc = (z0 + z1) / 2
    const data = [1, 0, 0, -cx, 0, 1, 0, -cy, 0, 0, 1, -zc, z0 - zc, z1 - zc, a0, b0, a1, b1]
    const a = Math.max(a0, a1)
    const b = Math.max(b0, b1)
    return this.add(M_TAPER, data, [cx - a, cy - b, z0, cx + a, cy + b, z1])
  }
}

export class BodyBuilder {
  private readonly parts: PartSpec[] = []

  /** A new part of `tissue` (an index from tissues.ts). Members are added on the returned builder. */
  part(name: string, tissue: number, opts: PartOptions): PartBuilder {
    const spec: PartSpec = { name, tissue, layer: opts.layer, mobility: opts.mobility ?? 0, smooth: opts.smooth ?? 0, outline: opts.outline ?? false, members: [], minus: [] }
    this.parts.push(spec)
    return new PartBuilder(spec)
  }

  get size(): number {
    return this.parts.length
  }

  compile(): Phantom {
    return compileParts(this.parts.filter((p) => p.members.length > 0))
  }
}

// --- the compiled body ----------------------------------------------------------------------------------------------

export interface Phantom {
  readonly nParts: number
  readonly names: readonly string[]
  readonly partTissue: Uint8Array
  readonly partLayer: Int16Array
  readonly partMob: Float32Array
  readonly partSmooth: Float32Array
  /** First member and count of the union, first member and count of the subtraction. */
  readonly partM0: Int32Array
  readonly partMN: Int32Array
  readonly partX0: Int32Array
  readonly partXN: Int32Array
  /** Box per part (6 floats), padded by the smoothing radius and (z only) the breathing shift. */
  readonly partBox: Float64Array
  readonly memKind: Uint8Array
  readonly memData: Float64Array
  /** The part whose surface is the skin (-1: none). */
  readonly outline: number
  readonly grid: Grid
  /** The whole body's box. */
  readonly box: readonly [number, number, number, number, number, number]
}

export interface Grid {
  x0: number
  y0: number
  z0: number
  nx: number
  ny: number
  nz: number
  start: Int32Array
  items: Uint16Array
}

function compileParts(specs: PartSpec[]): Phantom {
  const n = specs.length
  if (n > 65535) throw new Error('phantom: too many parts')
  let nm = 0
  for (const s of specs) nm += s.members.length + s.minus.length
  const partTissue = new Uint8Array(n)
  const partLayer = new Int16Array(n)
  const partMob = new Float32Array(n)
  const partSmooth = new Float32Array(n)
  const partM0 = new Int32Array(n)
  const partMN = new Int32Array(n)
  const partX0 = new Int32Array(n)
  const partXN = new Int32Array(n)
  const partBox = new Float64Array(n * 6)
  const memKind = new Uint8Array(nm)
  const memData = new Float64Array(nm * MS)
  let m = 0
  let outline = -1
  const box: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  specs.forEach((s, i) => {
    partTissue[i] = s.tissue
    partLayer[i] = s.layer
    partMob[i] = s.mobility
    partSmooth[i] = s.smooth
    if (s.outline) outline = i
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
    const put = (list: MemberSpec[], grow: boolean): void => {
      for (const mem of list) {
        memKind[m] = mem.kind
        for (let k = 0; k < mem.data.length; k++) memData[m * MS + k] = mem.data[k]
        if (grow) for (let k = 0; k < 3; k++) {
          b[k] = Math.min(b[k], mem.box[k])
          b[k + 3] = Math.max(b[k + 3], mem.box[k + 3])
        }
        m++
      }
    }
    partM0[i] = m
    partMN[i] = s.members.length
    put(s.members, true)
    partX0[i] = m
    partXN[i] = s.minus.length
    put(s.minus, false)
    const pad = s.smooth
    const zpad = s.mobility * MAX_BREATH
    partBox.set([b[0] - pad, b[1] - pad, b[2] - pad - zpad, b[3] + pad, b[4] + pad, b[5] + pad + zpad], i * 6)
    for (let k = 0; k < 3; k++) {
      box[k] = Math.min(box[k], partBox[i * 6 + k])
      box[k + 3] = Math.max(box[k + 3], partBox[i * 6 + k + 3])
    }
  })
  const ph = {
    nParts: n,
    names: specs.map((s) => s.name),
    partTissue,
    partLayer,
    partMob,
    partSmooth,
    partM0,
    partMN,
    partX0,
    partXN,
    partBox,
    memKind,
    memData,
    outline,
    box,
    grid: null as unknown as Grid,
  }
  ph.grid = buildGrid(ph, box)
  return ph
}

function buildGrid(ph: Omit<Phantom, 'grid'>, box: Phantom['box']): Grid {
  const x0 = Math.floor(box[0] / CELL) * CELL
  const y0 = Math.floor(box[1] / CELL) * CELL
  const z0 = Math.floor(box[2] / CELL) * CELL
  const nx = Math.max(1, Math.ceil((box[3] - x0) / CELL))
  const ny = Math.max(1, Math.ceil((box[4] - y0) / CELL))
  const nz = Math.max(1, Math.ceil((box[5] - z0) / CELL))
  const cells: number[][] = Array.from({ length: nx * ny * nz }, () => [])
  const order = Array.from({ length: ph.nParts }, (_, i) => i).sort((a, b) => ph.partLayer[b] - ph.partLayer[a] || b - a)
  for (const i of order) {
    const pb = ph.partBox
    const i0 = Math.max(0, Math.floor((pb[i * 6] - x0) / CELL))
    const j0 = Math.max(0, Math.floor((pb[i * 6 + 1] - y0) / CELL))
    const k0 = Math.max(0, Math.floor((pb[i * 6 + 2] - z0) / CELL))
    const i1 = Math.min(nx - 1, Math.floor((pb[i * 6 + 3] - x0) / CELL))
    const j1 = Math.min(ny - 1, Math.floor((pb[i * 6 + 4] - y0) / CELL))
    const k1 = Math.min(nz - 1, Math.floor((pb[i * 6 + 5] - z0) / CELL))
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) cells[(k * ny + j) * nx + ii].push(i)
  }
  const start = new Int32Array(cells.length + 1)
  let total = 0
  cells.forEach((c, i) => {
    start[i] = total
    total += c.length
  })
  start[cells.length] = total
  const items = new Uint16Array(total)
  let w = 0
  for (const c of cells) for (const i of c) items[w++] = i
  return { x0, y0, z0, nx, ny, nz, start, items }
}

// --- queries (allocation-free) --------------------------------------------------------------------------------------

/** Distance from a point to one member (negative inside). */
export function memberSdf(ph: Phantom, m: number, x: number, y: number, z: number): number {
  const d = ph.memData
  const o = m * MS
  switch (ph.memKind[m]) {
    case M_CAPSULE:
    case M_CONE: {
      const ax = d[o]
      const ay = d[o + 1]
      const az = d[o + 2]
      const bx = d[o + 3] - ax
      const by = d[o + 4] - ay
      const bz = d[o + 5] - az
      const px = x - ax
      const py = y - ay
      const pz = z - az
      const bb = bx * bx + by * by + bz * bz
      let h = bb > 0 ? (px * bx + py * by + pz * bz) / bb : 0
      h = h < 0 ? 0 : h > 1 ? 1 : h
      const qx = px - bx * h
      const qy = py - by * h
      const qz = pz - bz * h
      const r = ph.memKind[m] === M_CAPSULE ? d[o + 6] : d[o + 6] + (d[o + 7] - d[o + 6]) * h
      return Math.sqrt(qx * qx + qy * qy + qz * qz) - r
    }
    default: {
      const lx = d[o] * x + d[o + 1] * y + d[o + 2] * z + d[o + 3]
      const ly = d[o + 4] * x + d[o + 5] * y + d[o + 6] * z + d[o + 7]
      const lz = d[o + 8] * x + d[o + 9] * y + d[o + 10] * z + d[o + 11]
      const kind = ph.memKind[m]
      if (kind === M_ELLIPSOID) {
        const rx = d[o + 12]
        const ry = d[o + 13]
        const rz = d[o + 14]
        const ux = lx / rx
        const uy = ly / ry
        const uz = lz / rz
        const k0 = Math.sqrt(ux * ux + uy * uy + uz * uz)
        const vx = ux / rx
        const vy = uy / ry
        const vz = uz / rz
        const k1 = Math.sqrt(vx * vx + vy * vy + vz * vz)
        if (k1 < 1e-12) return -Math.min(rx, ry, rz)
        return (k0 * (k0 - 1)) / k1
      }
      if (kind === M_BOX) {
        const rr = d[o + 15]
        const qx = Math.abs(lx) - d[o + 12] + rr
        const qy = Math.abs(ly) - d[o + 13] + rr
        const qz = Math.abs(lz) - d[o + 14] + rr
        const mx = qx > 0 ? qx : 0
        const my = qy > 0 ? qy : 0
        const mz = qz > 0 ? qz : 0
        const inner = Math.max(qx, qy, qz)
        return Math.sqrt(mx * mx + my * my + mz * mz) + (inner < 0 ? inner : 0) - rr
      }
      // M_TAPER: an elliptic cylinder along local z, half-axes interpolated between its ends, flat caps
      const z0 = d[o + 12]
      const z1 = d[o + 13]
      let t = (lz - z0) / (z1 - z0)
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const a = d[o + 14] + (d[o + 16] - d[o + 14]) * t
      const b = d[o + 15] + (d[o + 17] - d[o + 15]) * t
      const ux = lx / a
      const uy = ly / b
      const k0 = Math.sqrt(ux * ux + uy * uy)
      const vx = ux / a
      const vy = uy / b
      const k1 = Math.sqrt(vx * vx + vy * vy)
      const d2 = k1 < 1e-12 ? -Math.min(a, b) : (k0 * (k0 - 1)) / k1
      const dz = Math.max(z0 - lz, lz - z1)
      return d2 > dz ? d2 : dz
    }
  }
}

/** Distance from a point to a part (negative inside): the smooth union of its members minus its subtracted members. */
export function partSdf(ph: Phantom, i: number, x: number, y: number, z: number): number {
  const m0 = ph.partM0[i]
  const mn = ph.partMN[i]
  const k = ph.partSmooth[i]
  let d = memberSdf(ph, m0, x, y, z)
  for (let m = m0 + 1; m < m0 + mn; m++) {
    const e = memberSdf(ph, m, x, y, z)
    if (k > 0) {
      const h = Math.max(k - Math.abs(d - e), 0) / k
      d = Math.min(d, e) - h * h * k * 0.25
    } else if (e < d) d = e
  }
  const x0 = ph.partX0[i]
  for (let m = x0; m < x0 + ph.partXN[i]; m++) {
    const e = -memberSdf(ph, m, x, y, z)
    if (e > d) d = e
  }
  return d
}

/** The grid cell of a point, or -1 outside the grid. */
function cellOf(g: Grid, x: number, y: number, z: number): number {
  const i = Math.floor((x - g.x0) / CELL)
  const j = Math.floor((y - g.y0) / CELL)
  const k = Math.floor((z - g.z0) / CELL)
  if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) return -1
  return (k * g.ny + j) * g.nx + i
}

/**
 * The part a point is in (the top layer), or -1 (outside the body: air). `breath` is the cranio-caudal shift (mm) of the mobile organs
 * now: a part with mobility m is looked up at z - m * breath.
 */
export function labelAt(ph: Phantom, x: number, y: number, z: number, breath = 0): number {
  const g = ph.grid
  const c = cellOf(g, x, y, z)
  if (c < 0) return -1
  const pb = ph.partBox
  for (let n = g.start[c]; n < g.start[c + 1]; n++) {
    const i = g.items[n]
    const zz = z - ph.partMob[i] * breath
    const o = i * 6
    if (x < pb[o] || x > pb[o + 3] || y < pb[o + 1] || y > pb[o + 4] || zz < pb[o + 2] || zz > pb[o + 5]) continue
    if (partSdf(ph, i, x, y, zz) <= 0) return i
  }
  return -1
}

/** The tissue at a point (air outside the body). */
export function tissueAt(ph: Phantom, x: number, y: number, z: number, breath = 0): number {
  const i = labelAt(ph, x, y, z, breath)
  return i < 0 ? 0 : ph.partTissue[i]
}

/** The outward unit normal of a part's surface near a point (central differences), written into `out`. */
export function partNormal(ph: Phantom, i: number, x: number, y: number, z: number, out: number[]): number[] {
  const e = 0.5
  const nx = partSdf(ph, i, x + e, y, z) - partSdf(ph, i, x - e, y, z)
  const ny = partSdf(ph, i, x, y + e, z) - partSdf(ph, i, x, y - e, z)
  const nz = partSdf(ph, i, x, y, z + e) - partSdf(ph, i, x, y, z - e)
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  out[0] = nx / l
  out[1] = ny / l
  out[2] = nz / l
  return out
}

/**
 * Where a ray from inside the body (at `p`, going along unit `dir`) leaves the skin: the distance along the ray to the outline's surface
 * (bisection on the outline's distance; `maxT` mm at most). Returns NaN with no outline.
 */
export function skinExit(ph: Phantom, px: number, py: number, pz: number, dx: number, dy: number, dz: number, maxT = 400): number {
  const o = ph.outline
  if (o < 0) return NaN
  let lo = 0
  let hi = maxT
  if (partSdf(ph, o, px, py, pz) > 0) return 0
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    if (partSdf(ph, o, px + dx * mid, py + dy * mid, pz + dz * mid) > 0) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}
