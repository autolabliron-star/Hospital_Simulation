/**
 * The real-place exterior as plain data: ONE merged, vertex-coloured static mesh (ground to the horizon, the forecourt paving, kerbs,
 * the lay-by and the ring road with their markings, the car park, the plaza's rail and hedge, benches, planters, bollards, the
 * neighbouring blocks) plus three instance lists (trees, cars, street lights). Pure and deterministic: no three.js, no unseeded randomness;
 * every "random" number is a seeded hash of the thing's index (`rand`).
 *
 * Style: "clean clinical modern": light large-format paving in running bond, slim steel, pale timber, muted greens, a graphite road,
 * cars in quiet colours.
 *
 * What is solid (the keep-clear tests read `solids`): the rail and hedge round the plaza, bollards, benches, planters, bins. The plaza itself
 * (x -74..-62, z -9..9) and the walk from the door stay empty.
 */
import { mixSeed, mulberry32 } from '@/sim/rng'
import { LAYOUT_TREES } from '../layoutTrees'
import { hex, mixRgb, MeshBuilder, scaleRgb, type MeshData, type Rgb, type SolidBox } from './meshBuilder'
import { grow, inside, KEEP_CLEAR, PLAZA, SITE, Y, type Box2 } from './plan'
import type { Inst } from './templates'

const SEED = 0x1de41

/** A deterministic number in [0, 1) for (salt, index). */
export function rand(salt: number, i: number): number {
  return mulberry32(mixSeed(SEED + salt * 7919, i))()
}

const C = {
  base: hex('#8fb17b'), // the same as the lawn, so the mown rectangle has no visible edge in the meadow
  lawn: hex('#8fb17b'),
  lawnStripe: hex('#86a874'),
  asphalt: hex('#4d5154'),
  asphaltCarPark: hex('#585c5f'),
  marking: hex('#ecece6'),
  yellow: hex('#dcc15a'),
  joint: hex('#a7a8a4'),
  paving: hex('#d3d2cd'),
  inlay: hex('#b5b8b8'),
  apron: hex('#c9c8c3'),
  kerb: hex('#c1c1bd'),
  concrete: hex('#c5c4bf'),
  hedge: hex('#52805a'),
  timber: hex('#c3996a'),
  steel: hex('#6d757b'),
  darkSteel: hex('#3a4247'),
  grate: hex('#41484c'),
  bin: hex('#4b5357'),
  shrub: hex('#5f9061'),
}

const CAR_PAINT: readonly Rgb[] = [
  hex('#dcdcd8'), // white
  hex('#dcdcd8'),
  hex('#9aa0a6'), // silver
  hex('#9aa0a6'),
  hex('#3c4247'), // graphite
  hex('#566a7e'), // blue-grey
  hex('#738a78'), // sage
  hex('#a45a52'), // muted red
  hex('#c8b697'), // sand
  hex('#2f3b4d'), // navy
]

const BLOCK_WALL: readonly Rgb[] = [hex('#d9d6ce'), hex('#cdd1d3'), hex('#e0ddd6'), hex('#c8c4bb'), hex('#d3d8d6')]
const BLOCK_GLASS = hex('#7d8d99')
const BLOCK_ROOF = hex('#b7b8b4')

export interface Site {
  ground: MeshData
  trees: Inst[]
  cars: Inst[]
  lamps: Inst[]
  /** Solid static props (axis-aligned bounds), for the tests. */
  solids: SolidBox[]
  /** Neighbouring blocks, for the tests (footprint centre, size, heading). */
  blocks: { x: number; z: number; w: number; d: number; ry: number; h: number }[]
}

interface Ctx {
  b: MeshBuilder
  solids: SolidBox[]
  trees: Inst[]
  cars: Inst[]
  lamps: Inst[]
  blocks: Site['blocks']
}

// ---------------------------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------------------------

type Pt = readonly [number, number]

/** The ring road's centreline: a rounded rectangle, walked west leg first, in steps of about `step` metres. */
export function ringPoints(step = 6, arcSteps = 10): Pt[] {
  const { x0, x1, z0, z1, corner: R } = SITE.ring
  const pts: Pt[] = []
  const line = (ax: number, az: number, bx: number, bz: number): void => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step))
    for (let i = 0; i < n; i++) pts.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n])
  }
  const arc = (cx: number, cz: number, a0: number): void => {
    for (let i = 0; i < arcSteps; i++) {
      const a = a0 + ((i / arcSteps) * Math.PI) / 2
      pts.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R])
    }
  }
  // clockwise on the plan (x east, z south): the west leg runs north, so start at its south end
  line(x0, z1 - R, x0, z0 + R)
  arc(x0 + R, z0 + R, Math.PI) // NW corner: from west (180 deg) round to north (270 deg)
  line(x0 + R, z0, x1 - R, z0)
  arc(x1 - R, z0 + R, -Math.PI / 2) // NE corner
  line(x1, z0 + R, x1, z1 - R)
  arc(x1 - R, z1 - R, 0) // SE corner
  line(x1 - R, z1, x0 + R, z1)
  arc(x0 + R, z1 - R, Math.PI / 2) // SW corner
  return pts
}

function tangentAt(pts: readonly Pt[], i: number): Pt {
  const a = pts[(i - 1 + pts.length) % pts.length]!
  const b = pts[(i + 1) % pts.length]!
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const l = Math.hypot(dx, dz) || 1
  return [dx / l, dz / l]
}

/** The point `off` metres to the left of centreline point i (left = (-tz, tx)). */
function offsetPt(pts: readonly Pt[], i: number, off: number): Pt {
  const p = pts[i % pts.length]!
  const t = tangentAt(pts, i % pts.length)
  return [p[0] - t[1] * off, p[1] + t[0] * off]
}

/** A strip between two offsets from a closed centreline, as flat quads at height y; `skip` drops the segments it returns true for. */
function strip(b: MeshBuilder, pts: readonly Pt[], off0: number, off1: number, y: number, color: Rgb, skip?: (mx: number, mz: number) => boolean): void {
  for (let i = 0; i < pts.length; i++) {
    const a0 = offsetPt(pts, i, off0)
    const a1 = offsetPt(pts, i, off1)
    const b0 = offsetPt(pts, i + 1, off0)
    const b1 = offsetPt(pts, i + 1, off1)
    const mx = (a0[0] + b1[0]) / 2
    const mz = (a0[1] + b1[1]) / 2
    if (skip?.(mx, mz)) continue
    b.quad([a0[0], y, a0[1]], [a1[0], y, a1[1]], [b1[0], y, b1[1]], [b0[0], y, b0[1]], color, [0, 1, 0])
  }
}

/** A low kerb ribbon (boxes along a closed centreline offset): `skip` drops segments. */
function kerbRibbon(b: MeshBuilder, pts: readonly Pt[], off: number, w: number, y0: number, y1: number, color: Rgb, skip: (mx: number, mz: number) => boolean): void {
  for (let i = 0; i < pts.length; i++) {
    const a = offsetPt(pts, i, off)
    const c = offsetPt(pts, i + 1, off)
    const mx = (a[0] + c[0]) / 2
    const mz = (a[1] + c[1]) / 2
    if (skip(mx, mz)) continue
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]) + 0.04
    const ry = Math.atan2(-(c[1] - a[1]), c[0] - a[0])
    b.box(mx - len / 2, y0, mz - w / 2, mx + len / 2, y1, mz + w / 2, color, { ry })
  }
}

/** Dashes of `on` metres every `period` metres along a closed centreline offset by `off`, each `w` wide. */
function dashes(b: MeshBuilder, pts: readonly Pt[], off: number, on: number, period: number, w: number, y: number, color: Rgb): void {
  const n = pts.length
  const seg: { a: Pt; c: Pt; len: number; s0: number }[] = []
  let total = 0
  for (let i = 0; i < n; i++) {
    const a = offsetPt(pts, i, off)
    const c = offsetPt(pts, i + 1, off)
    const len = Math.hypot(c[0] - a[0], c[1] - a[1])
    seg.push({ a, c, len, s0: total })
    total += len
  }
  const at = (s: number): Pt => {
    for (const g of seg) {
      if (s <= g.s0 + g.len) {
        const t = (s - g.s0) / (g.len || 1)
        return [g.a[0] + (g.c[0] - g.a[0]) * t, g.a[1] + (g.c[1] - g.a[1]) * t]
      }
    }
    return seg[seg.length - 1]!.c
  }
  const count = Math.floor(total / period)
  for (let k = 0; k < count; k++) {
    const p0 = at(k * period)
    const p1 = at(k * period + on)
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    const ry = Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0])
    b.flatRot((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, len, w, ry, y, color)
  }
}

/** World centre of a local offset (lx, lz) from a frame at (cx, cz) heading ry. */
const place = (cx: number, cz: number, ry: number, lx: number, lz: number): Pt => [cx + lx * Math.cos(ry) + lz * Math.sin(ry), cz - lx * Math.sin(ry) + lz * Math.cos(ry)]

function solid(ctx: Ctx, id: string, cx: number, cz: number, hx: number, hz: number, ry: number, y1: number): void {
  const ex = Math.abs(Math.cos(ry)) * hx + Math.abs(Math.sin(ry)) * hz
  const ez = Math.abs(Math.sin(ry)) * hx + Math.abs(Math.cos(ry)) * hz
  ctx.solids.push({ id, x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez, y1 })
}

// ---------------------------------------------------------------------------------------------
// the ground
// ---------------------------------------------------------------------------------------------

function groundDisc(ctx: Ctx): void {
  const { cx, cz, r } = SITE.disc
  const n = 56
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = ((i + 1) / n) * Math.PI * 2
    ctx.b.face([cx, Y.base, cz], [cx + Math.cos(a0) * r, Y.base, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, Y.base, cz + Math.sin(a1) * r], C.base, [0, 1, 0])
  }
}

function lawns(ctx: Ctx): void {
  const b = ctx.b
  b.flat(-150, 115, -95, 95, Y.lawn, C.lawn)
  // mown stripes on the two bands between the building and the ring road (north z -39.5..-24.4, south 24.4..39.5)
  for (const side of [-1, 1]) {
    for (let k = 1; k < 6; k += 2) {
      const a = 24.4 + 2.5 * k
      const c = Math.min(24.4 + 2.5 * (k + 1), 39.5)
      if (c - a < 0.1) continue
      b.flat(-80, 42.4, side < 0 ? -c : a, side < 0 ? -a : c, Y.lawnStripe, C.lawnStripe)
    }
  }
}

/** Running-bond slabs over `r`: `len` along x, `wid` along z, joints `joint` wide, tone by hash; `colorFn(cx, cz)` picks the family. */
function slabs(ctx: Ctx, r: Box2, len: number, wid: number, joint: number, salt: number, colorFn: (cx: number, cz: number) => Rgb): void {
  const zRows = Math.ceil((r.z1 - r.z0) / wid) + 1
  const zStart = Math.floor(r.z0 / wid) * wid
  for (let row = 0; row < zRows; row++) {
    const za = zStart + row * wid
    const zb = za + wid
    const z0 = Math.max(za, r.z0)
    const z1 = Math.min(zb, r.z1)
    if (z1 - z0 < 0.05) continue
    const shift = (Math.round(za / wid) % 2 === 0 ? 0 : len / 2) % len
    const xStart = Math.floor((r.x0 - shift) / len) * len + shift
    for (let col = 0; xStart + col * len < r.x1; col++) {
      const xa = xStart + col * len
      const xb = xa + len
      const x0 = Math.max(xa, r.x0)
      const x1 = Math.min(xb, r.x1)
      if (x1 - x0 < 0.05) continue
      const base = colorFn((x0 + x1) / 2, (z0 + z1) / 2)
      const tone = 0.93 + 0.14 * rand(salt, row * 977 + col)
      const jx0 = xa < r.x0 ? x0 : x0 + joint / 2
      const jx1 = xb > r.x1 ? x1 : x1 - joint / 2
      const jz0 = za < r.z0 ? z0 : z0 + joint / 2
      const jz1 = zb > r.z1 ? z1 : z1 - joint / 2
      if (jx1 - jx0 < 0.03 || jz1 - jz0 < 0.03) continue
      ctx.b.flat(jx0, jx1, jz0, jz1, Y.slab, scaleRgb(base, tone))
    }
  }
}

function paving(ctx: Ctx): void {
  const b = ctx.b
  const f = SITE.forecourt
  // the slab bed: a box down to the lawn, in the joint colour, so the paving has a 15 cm edge where it meets grass
  for (const r of [f, SITE.apronNorth, SITE.apronSouth, SITE.apronEast]) b.box(r.x0, Y.base, r.z0, r.x1, Y.pavingBase, r.z1, C.joint)
  // 2.4 x 1.2 m porcelain in running bond; the two rows either side of the door's axis are a darker inlay (a guidance path to the doors)
  slabs(ctx, f, 2.4, 1.2, 0.024, 1, (_cx, cz) => (Math.abs(cz) < 1.2 ? C.inlay : C.paving))
  slabs(ctx, SITE.apronNorth, 2.4, 1.2, 0.024, 2, () => C.apron)
  slabs(ctx, SITE.apronSouth, 2.4, 1.2, 0.024, 3, () => C.apron)
  slabs(ctx, SITE.apronEast, 2.4, 1.2, 0.024, 4, () => C.apron)
}

function kerbs(ctx: Ctx): void {
  const b = ctx.b
  const { kerbX, taperZ, endZ, roadEdgeX } = SITE.layBy
  // the lay-by's kerb along the forecourt, and its two tapers back to the road edge
  b.box(kerbX - 0.15, Y.asphalt, -taperZ, kerbX + 0.15, Y.slab, taperZ, C.kerb)
  for (const s of [-1, 1]) {
    const dx = roadEdgeX - kerbX
    const dz = s * (endZ - taperZ)
    const len = Math.hypot(dx, dz)
    const mx = kerbX + dx / 2
    const mz = s * taperZ + dz / 2
    b.box(mx - len / 2, Y.asphalt, mz - 0.15, mx + len / 2, Y.slab, mz + 0.15, C.kerb, { ry: Math.atan2(-dz, dx) })
  }
  // a narrow concrete kerb along both edges of the ring road: not along the lay-by, not across the car park's two driveways
  const ring = ringPoints()
  const half = SITE.ring.width / 2
  const inLayBy = (mx: number, mz: number): boolean => mx < -79 && Math.abs(mz) < endZ + 1
  const atDriveway = (mx: number, mz: number): boolean => mx < -91 && (Math.abs(mz + 30) < 3.6 || Math.abs(mz - 30) < 3.6)
  kerbRibbon(b, ring, half + 0.1, 0.2, Y.lawn, Y.asphalt + 0.05, C.kerb, inLayBy)
  kerbRibbon(b, ring, -(half + 0.1), 0.2, Y.lawn, Y.asphalt + 0.05, C.kerb, atDriveway)
}

function roads(ctx: Ctx): void {
  const b = ctx.b
  const ring = ringPoints()
  const half = SITE.ring.width / 2
  strip(b, ring, -half, half, Y.asphalt, C.asphalt)
  // the lay-by: a trapezoid widening of the west leg
  const { kerbX, taperZ, endZ, roadEdgeX } = SITE.layBy
  b.flatPoly(
    [
      [roadEdgeX, -endZ],
      [kerbX - 0.15, -taperZ],
      [kerbX - 0.15, taperZ],
      [roadEdgeX, endZ],
    ],
    Y.asphalt,
    C.asphalt,
  )
  // edge lines (continuous), except along the lay-by where the line is broken
  const westInnerInLayBy = (mx: number, mz: number): boolean => mx < -79 && Math.abs(mz) < endZ + 0.5
  strip(b, ring, half - 0.5, half - 0.35, Y.marking, C.marking, westInnerInLayBy)
  strip(b, ring, -(half - 0.35), -(half - 0.5), Y.marking, C.marking)
  // the centre line (dashed)
  dashes(b, ring, 0, 3, 9, 0.15, Y.marking, C.marking)
  // the lay-by: a broken line against the through lane, bay ends, a hatched drop-off box in front of the doors, arrows, double yellow on the kerb
  for (let z = -22; z < 22; z += 3) b.flatRot(roadEdgeX - 0.42, z + 0.75, 1.5, 0.15, Math.PI / 2, Y.marking, C.marking)
  for (const z of [-15, -9, -3, 3, 9, 15]) b.flatRot(LAY_BY_X, z, 2.4, 0.1, 0, Y.marking, C.marking)
  for (let i = -2; i <= 2; i++) b.flatRot(LAY_BY_X, i * 0.9, 2.1, 0.16, 0.9, Y.marking, C.marking)
  for (const z of [-12, 12]) {
    b.flatRot(LAY_BY_X, z - 0.45, 1.6, 0.22, Math.PI / 2, Y.marking, C.marking)
    b.face([LAY_BY_X - 0.5, Y.marking, z + 0.35], [LAY_BY_X + 0.5, Y.marking, z + 0.35], [LAY_BY_X, Y.marking, z + 1.45], C.marking, [0, 1, 0])
  }
  for (const s of [-1, 1]) for (const off of [0.28, 0.5]) b.flat(kerbX - 0.15 - off - 0.08, kerbX - 0.15 - off, Math.min(s * 3.5, s * 17), Math.max(s * 3.5, s * 17), Y.marking, C.yellow)
}

/** The middle of the lay-by lane (x). */
const LAY_BY_X = -81.7

function carPark(ctx: Ctx): void {
  const b = ctx.b
  const cp = SITE.carPark
  b.flat(cp.x0, cp.x1, cp.z0, cp.z1, Y.asphalt, C.asphaltCarPark)
  // two driveways to the ring road (the lawn between them has the hedge row)
  for (const zc of [-30, 30]) b.flat(cp.x1, SITE.ring.x0 - SITE.ring.width / 2 + 0.2, zc - 3, zc + 3, Y.asphalt, C.asphaltCarPark)
  for (const row of CAR_ROWS) {
    for (let k = 0; k <= BAYS_PER_ROW; k++) {
      const z = BAY_Z0 + k * BAY_W
      if (row.cut && inDriveway(z)) continue
      b.flat(row.x0, row.x1, z - 0.05, z + 0.05, Y.marking, C.marking)
    }
  }
  // the long back lines and aisle edges (the two next to row A stop for the driveways)
  const zEnd = BAY_Z0 + BAYS_PER_ROW * BAY_W
  for (const x of [-104.5, -110.5, -115.5, -120.5, -126.5, -131.5, -99.5]) {
    const cut = x === -99.5 || x === -104.5
    const spans: [number, number][] = cut
      ? [
          [BAY_Z0, -33],
          [-27, 27],
          [33, zEnd],
        ]
      : [[BAY_Z0, zEnd]]
    for (const [z0, z1] of spans) b.flat(x - 0.05, x + 0.05, z0, z1, Y.marking, C.marking)
  }
}

const BAY_W = 2.5
const BAYS_PER_ROW = 40
const BAY_Z0 = -50
const inDriveway = (z: number): boolean => (z > -34 && z < -26) || (z > 26 && z < 34)

/** The car park's rows: the bay strip, which way the cars' noses point (the aisle), whether the driveways cut it. */
const CAR_ROWS: readonly { x0: number; x1: number; ry: number; cut: boolean; fill: number }[] = [
  { x0: -104.5, x1: -99.5, ry: Math.PI, cut: true, fill: 0.5 },
  { x0: -115.5, x1: -110.5, ry: 0, cut: false, fill: 0.72 },
  { x0: -120.5, x1: -115.5, ry: Math.PI, cut: false, fill: 0.7 },
  { x0: -131.5, x1: -126.5, ry: 0, cut: false, fill: 0.55 },
]

// ---------------------------------------------------------------------------------------------
// the entrance forecourt: rail, hedge, bollards, benches, planters, bins, tree pits
// ---------------------------------------------------------------------------------------------

function bench(ctx: Ctx, id: string, cx: number, cz: number, ry: number): void {
  const b = ctx.b
  const at = (lx: number, lz: number): Pt => place(cx, cz, ry, lx, lz)
  const part = (lx: number, lz: number, y: number, w: number, h: number, d: number, color: Rgb): void => {
    const [x, z] = at(lx, lz)
    b.boxC(x, y, z, w, h, d, color, { ry })
  }
  part(0, 0, 0.42, 1.8, 0.05, 0.5, C.timber) // seat
  part(0, -0.23, 0.55, 1.8, 0.34, 0.04, C.timber) // back
  for (const lx of [-0.8, 0.8]) {
    part(lx, 0, 0.0, 0.05, 0.42, 0.46, C.steel) // end frames
    part(lx, -0.23, 0.42, 0.05, 0.5, 0.05, C.steel)
  }
  solid(ctx, id, cx, cz, 0.9, 0.26, ry, 0.9)
}

function planterBox(ctx: Ctx, id: string, cx: number, cz: number, len: number, wid: number, ry: number): void {
  const b = ctx.b
  b.boxC(cx, Y.slab, cz, len, 0.6 - Y.slab, wid, C.concrete, { ry })
  b.boxC(cx, 0.6, cz, len - 0.2, 0.4, wid - 0.2, C.shrub, { ry, top: mixRgb(C.shrub, C.hedge, 0.5) })
  solid(ctx, id, cx, cz, len / 2, wid / 2, ry, 1.0)
}

function forecourtProps(ctx: Ctx): void {
  const b = ctx.b
  // the plaza's west edge: a slim steel rail on posts, which is what the collision fence there looks like
  // (it runs from the north hedge to the ambulance bay, which is a vehicle area and has none)
  const rx = PLAZA.x0 - 0.35
  const zr0 = PLAZA.z0 - 0.2
  const zr1 = KEEP_CLEAR.ambulanceBay.z0 - 0.2
  const posts = 11
  for (let i = 0; i < posts; i++) b.boxC(rx, Y.slab, zr0 + (i * (zr1 - zr0)) / (posts - 1), 0.1, 1.0 - Y.slab, 0.1, C.steel)
  b.box(rx - 0.025, 0.86, zr0, rx + 0.025, 0.91, zr1, C.steel)
  b.box(rx - 0.025, 0.45, zr0, rx + 0.025, 0.48, zr1, C.steel)
  ctx.solids.push({ id: 'plaza-rail', x0: rx - 0.05, x1: rx + 0.05, z0: zr0 - 0.05, z1: zr1 + 0.05, y1: 1.0 })

  // the plaza's north edge: a hedge in a concrete planter
  const hz0 = PLAZA.z0 - 1.35
  const hz1 = PLAZA.z0 - 0.15
  b.box(PLAZA.x0, Y.slab, hz0, -62.4, 0.38, hz1, C.concrete)
  b.box(PLAZA.x0 + 0.1, 0.38, hz0 + 0.1, -62.5, 1.1, hz1 - 0.1, C.hedge)
  ctx.solids.push({ id: 'plaza-hedge', x0: PLAZA.x0, x1: -62.4, z0: hz0, z1: hz1, y1: 1.1 })

  // bollards along the kerb of the lay-by (a gap in front of the doors, where people cross)
  const bz: number[] = []
  for (let z = 10.8; z <= 23.4; z += 2.4) bz.push(z, -z)
  bz.forEach((z, i) => {
    b.prism(-79.55, Y.slab, z, 0.09, 0.9 - Y.slab, 8, C.darkSteel)
    b.box(-79.55 - 0.095, 0.7, z - 0.095, -79.55 + 0.095, 0.74, z + 0.095, C.marking)
    solid(ctx, `bollard${i}`, -79.55, z, 0.09, 0.09, 0, 0.9)
  })

  // the north terrace: benches facing the plaza, long planters, bins, three trees in grated pits
  bench(ctx, 'bench0', -65.6, -13.2, 0)
  bench(ctx, 'bench1', -63.6, -13.2, 0)
  bench(ctx, 'bench2', -77.6, -9.5, Math.PI / 2)
  bench(ctx, 'bench3', -77.6, -6.5, Math.PI / 2)
  planterBox(ctx, 'planter0', -76.6, -23.3, 4.2, 1.3, 0)
  planterBox(ctx, 'planter1', -69.4, -23.3, 4.2, 1.3, 0)
  planterBox(ctx, 'planter2', -63.9, -23.3, 2.4, 1.3, 0)
  // a bench west of the ambulance bay, facing the plaza
  bench(ctx, 'bench4', -77.6, 6.5, Math.PI / 2)
  for (const [i, [x, z]] of (
    [
      [-62.8, -11.2],
      [-62.8, -17],
    ] as const
  ).entries()) {
    b.boxC(x - 0.35, Y.slab, z, 0.45, 0.92 - Y.slab, 0.45, C.bin)
    solid(ctx, `bin${i}`, x - 0.35, z, 0.23, 0.23, 0, 0.92)
  }
  for (const [x, z] of FORECOURT_TREES) {
    b.flat(x - 0.6, x + 0.6, z - 0.6, z + 0.6, Y.pavingMark, C.grate)
    ctx.trees.push({ x, z, ry: rand(11, Math.round(z * 10)) * 6.28, s: 1, c: toneOf(rand(12, Math.round(z * 10))) })
    solid(ctx, `treepit:${x}:${z}`, x, z, 0.2, 0.2, 0, 3)
  }
}

const FORECOURT_TREES: readonly Pt[] = [
  [-77, -14.5],
  [-77, -19],
  [-72.2, -19.5],
]

function toneOf(t: number): [number, number, number] {
  const k = 0.86 + 0.28 * t
  return [k * (0.94 + 0.1 * t), k, k * (1.06 - 0.12 * t)]
}

// ---------------------------------------------------------------------------------------------
// instances: trees, cars, lamps
// ---------------------------------------------------------------------------------------------

/** Is (x, z) in the ring road's band (centreline +/- m)? */
function nearRing(x: number, z: number, m: number): boolean {
  const { x0, x1, z0, z1, width } = SITE.ring
  const half = width / 2 + m
  const outer = x > x0 - half && x < x1 + half && z > z0 - half && z < z1 + half
  const innerHalf = width / 2 + m
  const inner = x > x0 + innerHalf && x < x1 - innerHalf && z > z0 + innerHalf && z < z1 - innerHalf
  return outer && !inner
}

/** True where a tree must not stand: roads, the car park (and a margin), the forecourt, the building, the plaza, the layout's own trees. */
export function treeBlocked(x: number, z: number): boolean {
  if (nearRing(x, z, 2.5)) return true
  if (inside(grow(SITE.carPark, 2.5), x, z)) return true
  if (inside(grow(SITE.forecourt, 1.5), x, z)) return true
  if (x > -64 && x < 44.5 && z > -26.5 && z < 26.5) return true // the building and its apron
  if (inside({ x0: -100, x1: -91, z0: -35.5, z1: -24.5 }, x, z) || inside({ x0: -100, x1: -91, z0: 24.5, z1: 35.5 }, x, z)) return true // driveways
  for (const t of LAYOUT_TREES) if (Math.hypot(t.x - x, t.z - z) < 4.2) return true
  return false
}

function addTrees(ctx: Ctx): void {
  const put = (x: number, z: number, scale: number, salt: number): void => {
    if (treeBlocked(x, z)) return
    // not right next to one already placed
    for (const t of ctx.trees) if (Math.hypot(t.x - x, t.z - z) < 3.2) return
    ctx.trees.push({ x, z, ry: rand(21, salt) * Math.PI * 2, s: scale, c: toneOf(rand(22, salt)) })
  }
  let n = 0
  // a row along the west verge, between the ring road and the car park
  // (with a gap on the entrance's axis, so the view out of the door runs through to the car park and the neighbours)
  for (let z = -45; z <= 45; z += 9) {
    if (Math.abs(z) > 3) put(-95.6, z + (rand(23, n) - 0.5) * 1.6, 0.95 + 0.2 * rand(24, n), n)
    n++
  }
  // the campus lawn bands, north and south of the building
  for (const side of [-1, 1]) for (let x = -76; x <= 40; x += 12.5) put(x + (rand(25, n) - 0.5) * 4, side * (31.5 + 3.5 * rand(26, n)), 0.9 + 0.3 * rand(27, n), n++)
  // outside the ring road
  for (let x = -80; x <= 62; x += 11) for (const side of [-1, 1]) put(x + (rand(28, n) - 0.5) * 5, side * (53 + 6 * rand(29, n)), 0.9 + 0.35 * rand(30, n), n++)
  for (let z = -42; z <= 42; z += 11) put(76 + 5 * rand(31, n), z + (rand(32, n) - 0.5) * 4, 0.9 + 0.35 * rand(33, n), n++)
  // lawn trees east of the building, between it and the ring road
  for (let z = -30; z <= 30; z += 12) put(50 + 4 * rand(34, n), z + (rand(35, n) - 0.5) * 4, 0.9 + 0.3 * rand(36, n), n++)
  // copses further out (the first 60 candidates that are free)
  for (let k = 0; k < 160 && n < 400; k++) {
    const a = rand(37, k) * Math.PI * 2
    const r = 70 + 100 * rand(38, k)
    const x = SITE.disc.cx + Math.cos(a) * r
    const z = SITE.disc.cz + Math.sin(a) * r * 0.8
    if (inside(grow({ x0: -140, x1: 80, z0: -60, z1: 60 }, 6), x, z)) continue
    put(x, z, 1.0 + 0.5 * rand(39, k), 1000 + k)
  }
  for (const t of ctx.trees) ctx.solids.push({ id: 'tree', x0: t.x - 0.25, x1: t.x + 0.25, z0: t.z - 0.25, z1: t.z + 0.25, y1: 5 })
}

function addCars(ctx: Ctx): void {
  let n = 0
  for (const row of CAR_ROWS) {
    for (let k = 0; k < BAYS_PER_ROW; k++) {
      const zc = BAY_Z0 + (k + 0.5) * BAY_W
      if (row.cut && inDriveway(zc)) continue
      n++
      if (rand(41, n) > row.fill) continue
      const paint = CAR_PAINT[Math.floor(rand(42, n) * CAR_PAINT.length)]!
      const tone = 0.92 + 0.16 * rand(43, n)
      const cx = (row.x0 + row.x1) / 2 + (rand(44, n) - 0.5) * 0.3
      const cz = zc + (rand(45, n) - 0.5) * 0.3
      ctx.cars.push({ x: cx, z: cz, ry: row.ry + (rand(46, n) - 0.5) * 0.06, s: 0.97 + 0.07 * rand(47, n), c: scaleRgb(paint, tone) as [number, number, number] })
    }
  }
  // two cars stopped in the lay-by, either side of the door's axis, noses to the south
  ctx.cars.push({ x: -81.7, z: -9.6, ry: -Math.PI / 2, s: 1, c: scaleRgb(CAR_PAINT[0]!, 1) as [number, number, number] })
  ctx.cars.push({ x: -81.7, z: 12.2, ry: -Math.PI / 2, s: 1, c: scaleRgb(CAR_PAINT[4]!, 1) as [number, number, number] })
}

function addLamps(ctx: Ctx): void {
  const ring = ringPoints(30, 5)
  const half = SITE.ring.width / 2
  let last: Pt | null = null
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!
    const t = tangentAt(ring, i)
    // the left of the centreline is the inside of the ring: the lamp stands there 0.9 m outside the road edge, its arm over the road
    const lx = -t[1]
    const lz = t[0]
    const x = p[0] + lx * (half + 0.9)
    const z = p[1] + lz * (half + 0.9)
    if (x < -79 && Math.abs(z) < SITE.layBy.endZ + 2) continue // the forecourt's own lamps stand there
    if (last && Math.hypot(last[0] - x, last[1] - z) < 27) continue
    last = [x, z]
    ctx.lamps.push({ x, z, ry: Math.atan2(lz, -lx), s: 1, c: [1, 1, 1] })
  }
  // the forecourt: four lamps on its west edge, arms over the lay-by
  for (const z of [-21.5, -11, 11, 21.5]) ctx.lamps.push({ x: -78.9, z, ry: Math.PI, s: 1, c: [1, 1, 1] })
  // the car park: lamps on the back-to-back line between rows B and C, arms alternating east and west
  ;[-40, -20, 0, 20, 40].forEach((z, i) => ctx.lamps.push({ x: -115.5, z, ry: i % 2 === 0 ? 0 : Math.PI, s: 1, c: [1, 1, 1] }))
  for (const l of ctx.lamps) ctx.solids.push({ id: 'lamp', x0: l.x - 0.1, x1: l.x + 0.1, z0: l.z - 0.1, z1: l.z + 0.1, y1: 8 })
}

// ---------------------------------------------------------------------------------------------
// the neighbours
// ---------------------------------------------------------------------------------------------

function block(ctx: Ctx, i: number, x: number, z: number, w: number, d: number, ry: number, floors: number): void {
  const b = ctx.b
  const h = floors * 3.3
  const wall = BLOCK_WALL[Math.floor(rand(51, i) * BLOCK_WALL.length)]!
  b.boxC(x, Y.base, z, w, h - Y.base, d, wall, { ry, top: BLOCK_ROOF })
  const cs = Math.cos(ry)
  const sn = Math.sin(ry)
  const w2 = (w / 2) * 0.9
  const d2 = (d / 2) * 0.9
  const pt = (lx: number, lz: number): Pt => [x + lx * cs + lz * sn, z - lx * sn + lz * cs]
  for (let f = 0; f < floors; f++) {
    const y0 = f * 3.3 + 1.0
    const y1 = y0 + 1.5
    // four faces, a glazing band on each, pushed 3 cm off the wall
    const faces: [number, number, number, number, number, number][] = [
      [-w2, d / 2 + 0.03, w2, d / 2 + 0.03, 0, 1],
      [w2, -d / 2 - 0.03, -w2, -d / 2 - 0.03, 0, -1],
      [w / 2 + 0.03, d2, w / 2 + 0.03, -d2, 1, 0],
      [-w / 2 - 0.03, -d2, -w / 2 - 0.03, d2, -1, 0],
    ]
    for (const [ax, az, bx, bz, nx, nz] of faces) {
      const a = pt(ax, az)
      const c = pt(bx, bz)
      const nh = place(0, 0, ry, nx, nz)
      b.wall(a[0], a[1], c[0], c[1], y0, y1, BLOCK_GLASS, nh[0], nh[1])
    }
  }
  if (rand(52, i) > 0.45) {
    const [px, pz] = place(x, z, ry, w * 0.12, -d * 0.1)
    b.boxC(px, h, pz, w * 0.25, 2.4, d * 0.3, BLOCK_ROOF, { ry })
  }
  ctx.blocks.push({ x, z, w, d, ry, h })
}

function addBlocks(ctx: Ctx): void {
  // four on the line of sight out of the entrance (west), then ring candidates that are free of the campus
  const fixed: [number, number, number, number, number][] = [
    [-186, -30, 52, 26, 5],
    [-196, 14, 44, 30, 4],
    [-214, 46, 40, 24, 6],
    [-176, 82, 48, 28, 3],
  ]
  let i = 0
  for (const [x, z, w, d, fl] of fixed) block(ctx, i++, x, z, w, d, 0.04 * (i - 2), fl)
  const campus: Box2 = { x0: -140, x1: 82, z0: -62, z1: 62 }
  for (let k = 0; k < 260 && i < 36; k++) {
    const a = rand(53, k) * Math.PI * 2
    const r = 95 + 110 * rand(54, k)
    const w = 26 + 34 * rand(55, k)
    const d = 18 + 16 * rand(56, k)
    const x = SITE.disc.cx + Math.cos(a) * r
    const z = SITE.disc.cz + Math.sin(a) * r * 0.85
    const reach = Math.hypot(w, d) / 2 + 8
    if (inside(grow(campus, reach), x, z)) continue
    if (Math.hypot(x - SITE.disc.cx, z - SITE.disc.cz) + reach > SITE.disc.r - 6) continue
    // keep clear of the ones already standing
    if (ctx.blocks.some((o) => Math.hypot(o.x - x, o.z - z) < (Math.hypot(o.w, o.d) + Math.hypot(w, d)) / 2 + 6)) continue
    const tall = i % 7 === 0
    block(ctx, i++, x, z, w, d, Math.round(a / (Math.PI / 2)) * (Math.PI / 2) + (rand(57, k) - 0.5) * 0.5, tall ? 9 + Math.floor(4 * rand(58, k)) : 3 + Math.floor(4 * rand(59, k)))
  }
}

// ---------------------------------------------------------------------------------------------
// everything
// ---------------------------------------------------------------------------------------------

/** Hedge boxes between the verge trees and the car park (broken at the driveways). */
function hedges(ctx: Ctx): void {
  for (const [z0, z1] of [
    [-51, -34.5],
    [-25.5, 25.5],
    [34.5, 51],
  ] as const) {
    ctx.b.box(-98.7, Y.lawn, z0, -97.7, 1.0, z1, C.hedge)
    ctx.solids.push({ id: 'verge-hedge', x0: -98.7, x1: -97.7, z0, z1, y1: 1.0 })
  }
}

export function buildSite(): Site {
  const ctx: Ctx = { b: new MeshBuilder(), solids: [], trees: [], cars: [], lamps: [], blocks: [] }
  groundDisc(ctx)
  lawns(ctx)
  paving(ctx)
  kerbs(ctx)
  roads(ctx)
  carPark(ctx)
  hedges(ctx)
  forecourtProps(ctx)
  addTrees(ctx)
  addCars(ctx)
  addLamps(ctx)
  addBlocks(ctx)
  return { ground: ctx.b.build(), trees: ctx.trees, cars: ctx.cars, lamps: ctx.lamps, solids: ctx.solids, blocks: ctx.blocks }
}
