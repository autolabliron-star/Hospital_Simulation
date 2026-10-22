/**
 * R3 "Real screens": the head and neck, the region of the brain MRI, the head CT and the cervical-spine CT. Built ALONE (no other region), so
 * it owns the skin outline (head, face and neck down to S ~640).
 *
 * What is in it (design numbers are an average adult; the whole head scales with `headScale`, the neck's length with the patient's height):
 *   skin, scalp, face, ears, nose, the neck tube with its fat and muscles, the thyroid, larynx, trachea and pharynx
 *   the skull as an onion of layers round the brain (outer table, diploe, inner table), the skull base (clivus, petrous bones with the inner
 *   ear, mastoid air cells), the facial skeleton (maxilla, zygoma, mandible, teeth), orbits (fat, globe, lens, optic nerve, muscles), the
 *   paranasal sinuses, the nasal cavity and the airway
 *   dura, the CSF round the brain (wider with age), the falx, the tentorium
 *   the brain: grey cortex over white matter, with a seeded pattern of sulci (each a thin CSF sheet lined by grey matter) and the major
 *   landmarks (interhemispheric and Sylvian fissures, central sulcus, cingulate, parieto-occipital, calcarine), the deep grey nuclei, the
 *   ventricles, the corpus callosum, the brainstem, the cerebellum with its folia, the cisterns
 *   the arteries (carotids, basilar, circle of Willis) and the dural venous sinuses
 *   the cervical spine C1..T1 with discs, arches, transverse foramina, the canal and the cord, the carotids, jugular veins and vertebral arteries
 *
 * Layers (a higher layer wins): 1 skin  2 soft-tissue fill  3 scalp, neck fat  4 muscles  5-13 glands, cartilage, vessels
 *   38 discs  40 outer cortex  41 marrow, diploe  42 inner table  43 dense bone  44 dura  45 CSF  46 grey envelope  47 white-matter envelope
 *   48 sulcal grey lining  49 sulcal CSF  50-56 deep grey, tracts, brainstem  57-59 ventricles, plexus  60+ the face's air, orbits, vessels
 */
import { mixSeed, mulberry32 } from '@/sim/rng'
import { basisMatrix, type BodyBuilder, type PartBuilder, type V3 } from '../body'
import type { PatientParams } from '../params'
import { tissue } from '../tissues'
import type { Landmarks, RegionId } from './types'

const T = {
  skin: tissue('skin'),
  scalp: tissue('scalp'),
  fat: tissue('fat'),
  muscle: tissue('muscle'),
  cortical: tissue('cortical'),
  marrow: tissue('marrow'),
  disc: tissue('disc'),
  csf: tissue('csf'),
  nerve: tissue('nerve'),
  blood: tissue('blood'),
  vesselWall: tissue('vesselWall'),
  cartilage: tissue('cartilage'),
  thyroid: tissue('thyroid'),
  airway: tissue('airway'),
  sinusAir: tissue('sinusAir'),
  grey: tissue('greyMatter'),
  white: tissue('whiteMatter'),
  deepGrey: tissue('deepGrey'),
  dura: tissue('dura'),
  eye: tissue('eye'),
  lens: tissue('lens'),
  calc: tissue('calcification'),
  tendon: tissue('tendon'),
  jointFluid: tissue('jointFluid'),
  gutWall: tissue('gutWall'),
  yellowMarrow: tissue('yellowMarrow'),
}

/** Layers. */
const L = {
  skin: 1,
  fill: 2,
  scalp: 3,
  fat: 3,
  muscle: 4,
  gland: 6,
  tongue: 7,
  wall: 8,
  cart: 12,
  vWall: 13,
  vessel: 14,
  disc: 38,
  cortex: 40,
  marrow: 41,
  inner: 42,
  dense: 43,
  dura: 44,
  csf: 45,
  gm: 46,
  wm: 47,
  sulGm: 48,
  sulCsf: 49,
  deep: 52,
  tract: 53,
  stem: 54,
  vent: 57,
  plexus: 58,
  face: 60,
  orbitFat: 61,
  orbitMus: 62,
  globe: 63,
  lens: 64,
  air: 66,
  canal: 68,
  cord: 69,
  flow: 70,
}

// --- the frame: design numbers (an average adult) -> the patient's head ---------------------------------------------------

/** Above this S the head scales about its centre by `headScale`; below it the neck's length follows the patient's height. */
const Z_B = 820

class Frame {
  readonly sx: number
  readonly sy: number
  readonly sz: number
  readonly hh: number
  constructor(p: PatientParams) {
    const sw = 1 + (p.width - 1) * 0.25
    const sd = 1 + (p.depth - 1) * 0.25
    this.sx = p.headScale * sw
    this.sy = p.headScale * sd
    this.sz = p.headScale
    this.hh = p.height
  }
  x(v: number): number {
    return v * this.sx
  }
  y(v: number): number {
    return 10 + (v - 10) * this.sy
  }
  z(v: number): number {
    return v >= Z_B ? 900 + (v - 900) * this.sz : 900 + (Z_B - 900) * this.sz + (v - Z_B) * this.hh
  }
  pt(a: V3): V3 {
    return [this.x(a[0]), this.y(a[1]), this.z(a[2])]
  }
  get mean(): number {
    return (this.sx + this.sy + this.sz) / 3
  }
}

const isZero = (r: V3 | number[]): boolean => r.length === 3 && r[0] === 0 && r[1] === 0 && r[2] === 0

/** A part builder that takes design coordinates and puts them in the patient's head. */
class SP {
  constructor(
    readonly pb: PartBuilder,
    readonly f: Frame,
  ) {}
  minus(): this {
    this.pb.minus()
    return this
  }
  plus(): this {
    this.pb.plus()
    return this
  }
  ell(c: V3, r: V3, rot: V3 | number[] = [0, 0, 0]): this {
    const f = this.f
    const rr: V3 = isZero(rot) ? [r[0] * f.sx, r[1] * f.sy, r[2] * f.sz] : [r[0] * f.mean, r[1] * f.mean, r[2] * f.mean]
    this.pb.ellipsoid(f.pt(c), rr, rot)
    return this
  }
  sph(c: V3, r: number): this {
    this.pb.sphere(this.f.pt(c), r * this.f.mean)
    return this
  }
  cap(a: V3, b: V3, r: number): this {
    this.pb.capsule(this.f.pt(a), this.f.pt(b), r * this.f.mean)
    return this
  }
  cone(a: V3, b: V3, ra: number, rb: number): this {
    const m = this.f.mean
    this.pb.cone(this.f.pt(a), this.f.pt(b), ra * m, rb * m)
    return this
  }
  box(c: V3, half: V3, round: number, rot: V3 | number[] = [0, 0, 0]): this {
    const f = this.f
    const h: V3 = isZero(rot) ? [half[0] * f.sx, half[1] * f.sy, half[2] * f.sz] : [half[0] * f.mean, half[1] * f.mean, half[2] * f.mean]
    this.pb.box(f.pt(c), h, round * f.mean, rot)
    return this
  }
  taper(cx: number, cy: number, z0: number, z1: number, a0: number, b0: number, a1: number, b1: number): this {
    const f = this.f
    this.pb.taper(f.x(cx), f.y(cy), f.z(z0), f.z(z1), a0 * f.sx, b0 * f.sy, a1 * f.sx, b1 * f.sy)
    return this
  }
}

// --- small helpers ---------------------------------------------------------------------------------------------------------

const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const addv = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** A smooth 0..1 value noise on a hashed lattice (build time only). */
function vnoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = x - ix
  const fy = y - iy
  const fz = z - iz
  const sm = (t: number): number => t * t * (3 - 2 * t)
  const h = (a: number, b: number, c: number): number => {
    let v = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b1) ^ seed
    v = Math.imul(v ^ (v >>> 15), 0x85ebca6b)
    v = Math.imul(v ^ (v >>> 13), 0xc2b2ae35)
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296
  }
  const u = sm(fx)
  const v = sm(fy)
  const w = sm(fz)
  const l = (a: number, b: number, t: number): number => a + (b - a) * t
  return l(
    l(l(h(ix, iy, iz), h(ix + 1, iy, iz), u), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), u), v),
    l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), u), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), u), v),
    w,
  )
}

// --- context and helpers ----------------------------------------------------------------------------------------------------

interface Ctx {
  b: BodyBuilder
  F: Frame
  p: PatientParams
  /** Brain atrophy 0..1 and how far the brain's surface has pulled in from the skull (mm). */
  at: number
  shrink: number
  rnd: () => number
}

const mk = (c: Ctx, name: string, t: number, layer: number, smooth = 0, outline = false): SP => new SP(c.b.part(name, t, { layer, smooth, outline }), c.F)

/** Radius with an inflation d (negative: shrink), never below 0.6 mm. */
const rd = (v: number, d: number): number => Math.max(0.6, v + d)

/** A bone: cortex (layer) round marrow (layer + 1), the same members shrunk by `shell` mm. */
function bone(c: Ctx, name: string, shell: number, fn: (s: SP, d: number) => void, layer: number = L.cortex, smooth = 0): void {
  fn(mk(c, `${name}Cortex`, T.cortical, layer, smooth), 0)
  fn(mk(c, `${name}Marrow`, T.marrow, layer + 1, smooth), -shell)
}

/** A thin sheet (ellipsoid) whose plane is spanned by unit directions a and b (not parallel), half extents ra, rb and half thickness rn. */
function sheetEll(sp: SP, c: V3, a: V3, b: V3, ra: number, rb: number, rn: number): void {
  sp.ell(c, [ra, rb, rn], basisMatrix(a, b))
}

// --- the brain's envelope ---------------------------------------------------------------------------------------------------

type Group = 'A' | 'T' | 'C' | 'S' | 'X'

interface Ell {
  c: V3
  r: V3
}

/** The cerebrum (the frontal, parietal and occipital lobes as three ellipsoids spanning both hemispheres) and the temporal lobes. */
const CEREBRUM: Ell[] = [
  { c: [0, 8, 914], r: [65, 80, 56] },
  { c: [0, -40, 912], r: [52, 40, 37] },
  { c: [0, 64, 911], r: [48, 28, 36] },
]
const TEMPORAL: Ell[] = [-1, 1].map((s) => ({ c: [s * 44, 8, 868] as V3, r: [21, 40, 22] as V3 }))
const CEREBELLUM: Ell[] = [
  ...[-1, 1].map((s) => ({ c: [s * 34, 68, 851] as V3, r: [30, 27, 21] as V3 })),
  { c: [0, 64, 853], r: [14, 24, 19] },
  ...[-1, 1].map((s) => ({ c: [s * 13, 57, 843] as V3, r: [10, 11, 11] as V3 })),
]
/** Fills the waist between the occipital lobes and the cerebellum (the tentorium's level). */
const CEREBELLUM_FILL: Ell[] = [{ c: [0, 72, 868], r: [44, 25, 20] }]
/** Extra pockets of CSF: the cerebellopontine angles and the cisterna magna. */
const POCKETS: Ell[] = [
  ...[-1, 1].map((s) => ({ c: [s * 28, 31, 853] as V3, r: [7, 7, 10] as V3 })),
  { c: [0, 70, 832], r: [16, 13, 6] },
]

/** Approximate distance (mm, negative inside) from a point to an inflated axis-aligned ellipsoid. */
function ellD(e: Ell, d: number, x: number, y: number, z: number): number {
  const rx = e.r[0] + d
  const ry = e.r[1] + d
  const rz = e.r[2] + d
  const ux = (x - e.c[0]) / rx
  const uy = (y - e.c[1]) / ry
  const uz = (z - e.c[2]) / rz
  const k0 = Math.sqrt(ux * ux + uy * uy + uz * uz)
  const vx = ux / rx
  const vy = uy / ry
  const vz = uz / rz
  const k1 = Math.sqrt(vx * vx + vy * vy + vz * vz)
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1
}

function envD(env: readonly Ell[], d: number, x: number, y: number, z: number): number {
  let m = Infinity
  for (const e of env) m = Math.min(m, ellD(e, d, x, y, z))
  return m
}

/** Where a ray from `o` along unit `dir` leaves the (inflated) envelope; null if o is outside it. */
function envHit(env: readonly Ell[], d: number, o: V3, dir: V3): V3 | null {
  if (envD(env, d, o[0], o[1], o[2]) > 0) return null
  let lo = 0
  let hi = 4
  while (hi < 260 && envD(env, d, o[0] + dir[0] * hi, o[1] + dir[1] * hi, o[2] + dir[2] * hi) <= 0) {
    lo = hi
    hi += 4
  }
  for (let k = 0; k < 28; k++) {
    const m = (lo + hi) / 2
    if (envD(env, d, o[0] + dir[0] * m, o[1] + dir[1] * m, o[2] + dir[2] * m) > 0) hi = m
    else lo = m
  }
  return [o[0] + dir[0] * lo, o[1] + dir[1] * lo, o[2] + dir[2] * lo]
}

function envNormal(env: readonly Ell[], d: number, p: V3): V3 {
  const e = 0.7
  return unit([
    envD(env, d, p[0] + e, p[1], p[2]) - envD(env, d, p[0] - e, p[1], p[2]),
    envD(env, d, p[0], p[1] + e, p[2]) - envD(env, d, p[0], p[1] - e, p[2]),
    envD(env, d, p[0], p[1], p[2] + e) - envD(env, d, p[0], p[1], p[2] - e),
  ])
}

/** Add one group of the brain's envelope, every ellipsoid inflated by d (mm, negative: inset); the temporal lobes by dT. */
function addGroup(sp: SP, g: Group, d: number, dT: number = d): void {
  if (g === 'A') for (const e of CEREBRUM) sp.ell(e.c, [e.r[0] + d, e.r[1] + d, e.r[2] + d])
  else if (g === 'T') for (const e of TEMPORAL) sp.ell(e.c, [e.r[0] + dT, e.r[1] + dT, e.r[2] + dT])
  else if (g === 'C') for (const e of [...CEREBELLUM, ...CEREBELLUM_FILL]) sp.ell(e.c, [e.r[0] + d, e.r[1] + d, e.r[2] + d])
  else if (g === 'X') for (const e of POCKETS) sp.ell(e.c, [e.r[0] + d - 1.9, e.r[1] + d - 1.9, e.r[2] + d - 1.9])
  else {
    sp.cone([0, 8, 886], [0, 14, 872], 12 + d, 14 + d)
    sp.ell([0, 22, 857], [20 + d, 14 + d, 15 + d])
    sp.cone([0, 28, 849], [0, 42, 830], 13 + d, 10 + d)
  }
}

/** The brain's envelope inflated by d as parts of one tissue and layer. */
function shape(c: Ctx, name: string, t: number, layer: number, d: number, groups: Group[], opts: { dT?: number; smooth?: number; outline?: boolean } = {}): void {
  groups.forEach((g, i) => addGroup(mk(c, `${name}${g}`, t, layer, opts.smooth ?? 8, !!opts.outline && i === 0), g, d, opts.dT ?? d))
}

// --- sulci: thin CSF sheets lined by grey matter -----------------------------------------------------------------------------

interface SheetEll {
  c: V3
  r: V3
  R: number[]
}

interface Sheet {
  key: string
  csf: SheetEll[]
  lining: SheetEll[]
}

/**
 * One sulcus: a CSF sheet entering the surface at P and running `depth` mm inward (unit `inward`), `half` mm long along the unit direction
 * t, `w` mm half-thick, in a grey-matter lining `lin` mm thick. `bend` (radians, about the inward direction) turns its far half; `branch`
 * adds a short side branch.
 */
function sheet(P: V3, t: V3, inward: V3, half: number, depth: number, w: number, lin: number, bend = 0, branch = 0): Sheet {
  const key = `${Math.floor(P[0] / 34)},${Math.floor(P[1] / 34)},${Math.floor(P[2] / 34)}`
  const out: Sheet = { key, csf: [], lining: [] }
  const rotT = (a: number): V3 => {
    const k = inward
    const cs = Math.cos(a)
    const sn = Math.sin(a)
    const kt = cross(k, t)
    return unit([t[0] * cs + kt[0] * sn, t[1] * cs + kt[1] * sn, t[2] * cs + kt[2] * sn])
  }
  const seg = (a: V3, b: V3, dep: number): void => {
    const d = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]])
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const mid = lerp3(a, b, 0.5)
    const s = unit(cross(inward, d))
    const t2 = unit(cross(s, inward))
    const R = basisMatrix(s, t2)
    out.csf.push({ c: addv(mid, inward, dep / 2 - 0.8), r: [w, len / 2 + 1.2, dep / 2 + 0.6], R })
    out.lining.push({ c: addv(mid, inward, dep / 2 + 1.0), r: [w + lin, len / 2 + 2.6, dep / 2 + 2.0], R })
  }
  if (Math.abs(bend) < 1e-3) seg(addv(P, t, -half), addv(P, t, half), depth)
  else {
    const ta = rotT(-bend / 2)
    const tb = rotT(bend / 2)
    seg(addv(P, ta, -half), P, depth * 0.9)
    seg(P, addv(P, tb, half), depth)
  }
  if (branch > 0) {
    const tc = rotT(1.2)
    seg(addv(P, tc, -branch * 0.4), addv(P, tc, branch), depth * 0.55)
  }
  return out
}

/** Emit sheets as parts (a cluster of neighbours per part). */
function emitSheets(c: Ctx, name: string, sheets: Sheet[], per = 6): void {
  sheets.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  let n = 0
  let g = mk(c, `${name}Gm${n}`, T.grey, L.sulGm)
  let f = mk(c, `${name}Csf${n}`, T.csf, L.sulCsf)
  let gc = 0
  let fc = 0
  const flush = (): void => {
    n++
    g = mk(c, `${name}Gm${n}`, T.grey, L.sulGm)
    f = mk(c, `${name}Csf${n}`, T.csf, L.sulCsf)
    gc = 0
    fc = 0
  }
  void per
  for (const s of sheets) {
    if (gc + s.lining.length > 12 || fc + s.csf.length > 12) flush()
    for (const e of s.lining) g.ell(e.c, e.r, e.R)
    for (const e of s.csf) f.ell(e.c, e.r, e.R)
    gc += s.lining.length
    fc += s.csf.length
  }
}

interface SulSpec {
  env: Ell[]
  origin: V3
  dirs: number
  spacing: number
  accept: (p: V3, n: V3) => boolean
  tangent: (p: V3, n: V3) => V3
  depth: [number, number]
  half: [number, number]
  w: [number, number]
  lin: number
  inflate: number
  taken: V3[]
}

/** A seeded field of filler sulci over a surface: Poisson-spaced points, a coherent direction field, random depth and length. */
function sulcusField(c: Ctx, spec: SulSpec): Sheet[] {
  const r = c.rnd
  const out: Sheet[] = []
  const N = spec.dirs
  const order = Array.from({ length: N }, (_, i) => i)
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const ga = Math.PI * (3 - Math.sqrt(5))
  for (const k of order) {
    const zz = 1 - (2 * (k + 0.5 + (r() - 0.5) * 0.8)) / N
    const rr2 = Math.sqrt(Math.max(0, 1 - zz * zz))
    const th = ga * k
    const dir: V3 = [rr2 * Math.cos(th), rr2 * Math.sin(th), zz]
    const P = envHit(spec.env, spec.inflate, spec.origin, dir)
    if (!P) continue
    const n = envNormal(spec.env, spec.inflate, P)
    if (!spec.accept(P, n)) continue
    let ok = true
    for (const q of spec.taken) if (Math.hypot(P[0] - q[0], P[1] - q[1], P[2] - q[2]) < spec.spacing) {
      ok = false
      break
    }
    if (!ok) continue
    spec.taken.push(P)
    let t = spec.tangent(P, n)
    t = unit(addv(t, n, -dot(t, n)))
    const depth = spec.depth[0] + (spec.depth[1] - spec.depth[0]) * r()
    const half = spec.half[0] + (spec.half[1] - spec.half[0]) * r()
    const w = spec.w[0] + (spec.w[1] - spec.w[0]) * r() + 1.3 * c.at
    const bend = (r() - 0.5) * 1.5
    const branch = r() < 0.3 ? 4 + 4 * r() : 0
    out.push(sheet(P, t, [-n[0], -n[1], -n[2]], half, depth * (1 - 0.15 * c.at), w, spec.lin, bend, branch))
  }
  return out
}

/** A named sulcus along surface points (snapped to the surface from `origin`), going inward. */
function namedSulcus(env: Ell[], inflate: number, origin: V3, pts: V3[], depth: number, w: number, lin: number, taken: V3[]): Sheet[] {
  const surf: { P: V3; n: V3 }[] = []
  for (const q of pts) {
    const dir = unit([q[0] - origin[0], q[1] - origin[1], q[2] - origin[2]])
    const P = envHit(env, inflate, origin, dir)
    if (P) surf.push({ P, n: envNormal(env, inflate, P) })
  }
  const out: Sheet[] = []
  for (let i = 0; i + 1 < surf.length; i++) {
    const a = surf[i]
    const b = surf[i + 1]
    const mid = lerp3(a.P, b.P, 0.5)
    taken.push(mid)
    const n = unit(lerp3(a.n, b.n, 0.5))
    const t = unit([b.P[0] - a.P[0], b.P[1] - a.P[1], b.P[2] - a.P[2]])
    const len = Math.hypot(b.P[0] - a.P[0], b.P[1] - a.P[1], b.P[2] - a.P[2])
    out.push(sheet(mid, unit(addv(t, n, -dot(t, n))), [-n[0], -n[1], -n[2]], len / 2 + 2.5, depth, w, lin))
  }
  return out
}

const mirror = (p: V3, s: number): V3 => [p[0] * s, p[1], p[2]]

/** The callosum's upper edge (S) at a height y: the genu, the body and the splenium. */
function callosumTop(y: number): number {
  const pts: [number, number][] = [
    [-46, 905],
    [-42, 913],
    [-34, 920],
    [-20, 925],
    [-4, 927],
    [12, 925],
    [24, 918],
    [32, 908],
  ]
  if (y <= pts[0][0]) return pts[0][1]
  for (let i = 0; i + 1 < pts.length; i++) if (y <= pts[i + 1][0]) return pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * (y - pts[i][0])) / (pts[i + 1][0] - pts[i][0])
  return pts[pts.length - 1][1]
}

/** The x of the interhemispheric fissure at (y, z): a little to the patient's left of the midline and gently wavy, so that the midsagittal plane cuts the right hemisphere's medial cortex. */
const fissureX = (y: number, z: number): number => 3.0 + 0.8 * Math.sin(y / 19 + 1) * Math.cos(z / 17)

// --- the brain ---------------------------------------------------------------------------------------------------------------

/** The cerebral hemispheres: cortex and white matter, the fissures, sulci, deep nuclei, ventricles, callosum, brainstem, cerebellum. */
function brain(c: Ctx): void {
  const { at, shrink } = c
  const brainEnv = [...CEREBRUM, ...TEMPORAL]

  // cortex over white matter (the white matter is inset 3 mm: the cortex's thickness)
  shape(c, 'cortex', T.grey, L.gm, -shrink, ['A', 'T'])
  shape(c, 'cortexCb', T.grey, L.gm, -shrink * 0.6, ['C'])
  shape(c, 'white', T.white, L.wm, -3.1 - shrink, ['A', 'T'])
  shape(c, 'whiteCb', T.white, L.wm, -5.5 - shrink * 0.6, ['C'])
  shape(c, 'brainstem', T.white, L.stem, -shrink * 0.3, ['S'], { smooth: 4 })

  // --- the interhemispheric fissure and the falx, and the sulci round the midline ------------------------------------------
  const fw = 0.55 + 0.7 * at
  const fissure: Sheet[] = []
  const falx: V3[] = []
  for (let y = -74; y <= 88; y += 17) {
    const top = envHit(CEREBRUM, -shrink, [0, y, 900], [0, 0, 1])
    if (!top) continue
    const inCal = y > -44 && y < 30
    const bot = inCal ? callosumTop(y) + 1.2 : (envHit(CEREBRUM, -shrink, [0, y, 900], [0, 0, -1])?.[2] ?? 880) + 2
    const zTop = top[2] + 2.5
    if (zTop - bot < 8) continue
    const rows = Math.max(1, Math.ceil((zTop - bot) / 15))
    const step = (zTop - bot) / rows
    for (let k = 0; k < rows; k++) {
      const z = bot + (k + 0.5) * step
      const x = fissureX(y, z)
      const key = `f${Math.floor(y / 34)},${Math.floor(z / 34)}`
      fissure.push({ key, csf: [{ c: [x, y, z], r: [fw, 11.5, step * 0.66 + 2], R: [1, 0, 0, 0, 1, 0, 0, 0, 1] }], lining: [{ c: [x, y, z], r: [fw + 3.0, 11.5, step * 0.66 + 2], R: [1, 0, 0, 0, 1, 0, 0, 0, 1] }] })
      if (z > 934) falx.push([x, y, z])
    }
  }
  emitSheets(c, 'fissure', fissure, 8)
  for (let i = 0; i < falx.length; i += 8) {
    const f = mk(c, `falx${i / 8}`, T.dura, L.tract)
    for (const q of falx.slice(i, i + 8)) f.ell(q, [0.4, 11.5, 12])
  }

  // medial wall sulci: the cingulate, the marginal ramus, the parieto-occipital and the calcarine, going laterally from the fissure
  const medial: [number, number][][] = [
    [[-44, 921], [-30, 933], [-10, 937], [10, 939], [24, 943], [32, 956], [34, 968]],
    [[55, 951], [51, 930], [48, 906]],
    [[48, 906], [65, 901], [82, 897], [91, 896]],
    [[8, 962], [14, 966], [18, 972]],
  ]
  const depths = [16, 20, 15, 9]
  const medSheets: Sheet[] = []
  medial.forEach((path, mi) => {
    for (const s of [-1, 1]) {
      for (let i = 0; i + 1 < path.length; i++) {
        const [y0, z0] = path[i]
        const [y1, z1] = path[i + 1]
        const ym = (y0 + y1) / 2
        const zm = (z0 + z1) / 2
        const P: V3 = [fissureX(ym, zm) + s * fw, ym, zm]
        const t = unit([0, y1 - y0, z1 - z0])
        medSheets.push(sheet(P, t, [s, 0, 0], Math.hypot(y1 - y0, z1 - z0) / 2 + 2.5, depths[mi] * (1 - 0.15 * at), 0.7 + 1.2 * at, 3.0))
      }
    }
  })
  emitSheets(c, 'medial', medSheets, 8)

  // --- the lateral fissures, the named sulci on the convexity, then the filler sulci ----------------------------------------
  const taken: V3[] = []
  const lateral: Sheet[] = []
  const sylW = 1.4 + 1.6 * at
  for (const s of [-1, 1]) {
    const mk3 = (cc: V3, a: V3, b: V3, ra: number, rb: number): Sheet => {
      const R = basisMatrix(a, b)
      taken.push(cc)
      return { key: `s${s},${Math.floor(cc[1] / 34)}`, csf: [{ c: cc, r: [ra, rb, sylW], R }], lining: [{ c: cc, r: [ra + 3, rb + 3, sylW + 3], R }] }
    }
    // the main sheet, rising backwards and medially; the posterior ramus; the anterior branch; the cistern at its stem
    lateral.push(mk3([s * 53, 6, 891], unit([-s * 0.9, 0, 0.42]), unit([0, 1, 0.25]), 13, 26))
    lateral.push(mk3([s * 56, 38, 906], unit([-s * 0.85, 0, 0.5]), unit([0, 1, 0.6]), 9, 14))
    lateral.push(mk3([s * 46, -14, 883], unit([-s * 0.8, 0, 0.5]), unit([0, 1, 0.1]), 9, 10))
    const cist = { c: [s * 41, -16, 880] as V3, r: [7, 8, 5] as V3, R: [1, 0, 0, 0, 1, 0, 0, 0, 1] }
    lateral.push({ key: `s${s},cist`, csf: [cist], lining: [{ c: cist.c, r: [cist.r[0] + 3, cist.r[1] + 3, cist.r[2] + 3], R: cist.R }] })
    const O: V3 = [s * 30, 8, 905]
    const path = (pts: V3[]): V3[] => pts.map((q) => mirror(q, s))
    const named = (pts: V3[], depth: number, w: number): void => {
      lateral.push(...namedSulcus(brainEnv, -shrink, O, path(pts), depth * (1 - 0.15 * at), w + 1.1 * at, 3.0, taken))
    }
    // central and its neighbours, the frontal and parietal sulci, the temporal sulci
    named([[8, 29, 975], [26, 24, 962], [40, 14, 942], [52, 9, 920], [58, 6, 905]], 22, 0.9)
    named([[10, 11, 976], [28, 6, 960], [42, -2, 940], [54, -6, 918]], 15, 0.8)
    named([[10, 44, 974], [28, 40, 958], [42, 30, 938], [52, 24, 922]], 14, 0.8)
    named([[18, -8, 968], [22, -40, 955], [24, -62, 930]], 14, 0.8)
    named([[46, -8, 925], [48, -40, 918], [40, -66, 900]], 14, 0.8)
    named([[26, 24, 966], [30, 48, 962], [27, 70, 950]], 15, 0.8)
    named([[58, -18, 866], [63, 10, 872], [61, 36, 880], [52, 58, 898]], 18, 0.9)
    named([[52, -10, 850], [58, 20, 855], [56, 46, 872]], 14, 0.8)
    named([[16, -10, 868], [18, 20, 862], [20, 44, 866]], 10, 0.7)
  }
  emitSheets(c, 'lateral', lateral, 6)

  const rcrb = mulberry32(mixSeed(c.p.seed >>> 0, 0x5011c1))
  const fill: Sheet[] = []
  for (const s of [-1, 1]) {
    const t: SulSpec = {
      env: brainEnv,
      origin: [s * 30, 8, 905],
      dirs: 2600,
      spacing: 11,
      accept: (P) => s * P[0] > 9 && !(P[2] < 880 && Math.abs(P[0]) < 30 && P[1] > -42 && P[1] < 48) && P[2] > 842,
      tangent: (P, n) => {
        const e1 = Math.abs(n[2]) > 0.97 ? ([1, 0, 0] as V3) : unit(cross([0, 0, 1], n))
        const e2 = cross(n, e1)
        const spread = 1.1 + 0.9 * Math.abs(n[2])
        const ang = (vnoise(P[0] / 24, P[1] / 24, P[2] / 24, 0x77) - 0.5) * 2 * spread
        return addv([e2[0] * Math.cos(ang), e2[1] * Math.cos(ang), e2[2] * Math.cos(ang)], e1, Math.sin(ang))
      },
      depth: [9, 17],
      half: [6.5, 12],
      w: [0.55, 0.95],
      lin: 3.0,
      inflate: -shrink,
      taken,
    }
    fill.push(...sulcusField({ ...c, rnd: rcrb }, t))
  }
  emitSheets(c, 'sulci', fill, 6)

  // --- cerebellar folia ----------------------------------------------------------------------------------------------------
  const folia: Sheet[] = sulcusField(
    { ...c, rnd: rcrb },
    {
      env: CEREBELLUM,
      origin: [0, 64, 851],
      dirs: 900,
      spacing: 11,
      accept: (P) => P[1] > 44 && P[2] > 826,
      tangent: (P, n) => {
        if (Math.abs(P[0]) < 10) return [1, 0, 0]
        const e1 = Math.abs(n[2]) > 0.97 ? ([1, 0, 0] as V3) : unit(cross([0, 0, 1], n))
        const ang = (vnoise(P[0] / 16, P[1] / 16, P[2] / 16, 0x31) - 0.5) * 1.2
        const e2 = cross(n, e1)
        return addv(e1, e2, Math.tan(ang))
      },
      depth: [7, 12],
      half: [6, 11],
      w: [0.4, 0.7],
      lin: 1.9,
      inflate: -shrink * 0.6,
      taken: [],
    },
  )
  emitSheets(c, 'folia', folia, 8)

  // --- tentorium ------------------------------------------------------------------------------------------------------------
  for (const s of [-1, 1]) {
    const t = mk(c, `tentorium${s}`, T.dura, L.tract - 1)
    sheetEll(t, [s * 30, 62, 874], unit([s * 0.9, 0, -0.42]), [0, 1, 0], 33, 33, 0.9)
  }
}

/** The deep grey nuclei, the callosum, the ventricles, the brainstem's detail, the cisterns, the pineal. */
function deepStructures(c: Ctx): void {
  const { at } = c
  const r = c.rnd
  const rot0: V3 = [0, 0, 0]
  const nuclei = mk(c, 'nuclei', T.deepGrey, L.deep)
  void nuclei
  for (const s of [-1, 1]) {
    const grey = mk(c, `deepGrey${s}`, T.deepGrey, L.deep)
    // caudate head and body, putamen, pallidum, thalamus, amygdala, hippocampus, claustrum
    grey.ell([s * 12.4, -22, 902], [4.8, 12, 10])
    grey.cap([s * 12, -9, 913], [s * 14.5, 6, 918], 3.6)
    grey.cap([s * 14.5, 6, 918], [s * 19, 24, 913], 3.2)
    grey.cap([s * 19, 24, 913], [s * 27, 36, 899], 2.6)
    grey.ell([s * 27, -12, 893], [5.8, 19, 12], [0, 0, -s * 10])
    grey.ell([s * 19.5, -11, 892], [3.8, 10, 8], [0, 0, -s * 10])
    grey.ell([s * 9.7, 9, 898], [7.5, 15, 10])
    grey.ell([s * 32, -6, 872], [7, 8, 7])
    grey.ell([s * 36, -2, 896], [1.3, 22, 13])
    // the hippocampus under the temporal horn
    const hip = mk(c, `hippocampus${s}`, T.deepGrey, L.deep)
    hip.cap([s * 31, 28, 884], [s * 35, 18, 873], 5)
    hip.cap([s * 35, 18, 873], [s * 36, 4, 870], 4.6)
    void rot0
  }
  // hypothalamus, the massa intermedia, the tectum, the dentate nuclei
  const mid = mk(c, 'midlineGrey', T.deepGrey, L.deep)
  mid.ell([0, -2, 880], [8, 7, 5.5])
  mid.ell([0, 22, 882], [8, 5, 4])
  for (const s of [-1, 1]) mid.ell([s * 15, 62, 851], [5, 5, 4])
  const mass = mk(c, 'massaIntermedia', T.deepGrey, L.vent + 1)
  mass.ell([0, -1, 893], [3.2, 4, 3.2])

  // --- the corpus callosum: genu, body, splenium and the rostrum -----------------------------------------------------------
  const cal = mk(c, 'callosum', T.white, L.tract)
  const arc: [number, number, number][] = [
    [-40, 902, 8.5],
    [-35, 913, 5.5],
    [-22, 921.5, 4.2],
    [-6, 924.5, 3.9],
    [12, 921.5, 4.2],
    [24, 912, 6.5],
    [28, 903, 8.5],
  ]
  for (let i = 0; i + 1 < arc.length; i++) {
    const [y0, z0, t0] = arc[i]
    const [y1, z1, t1] = arc[i + 1]
    const len = Math.hypot(y1 - y0, z1 - z0)
    cal.ell([0, (y0 + y1) / 2, (z0 + z1) / 2], [11, len / 2 + 2.5, (t0 + t1) / 2], [(Math.atan2(z1 - z0, y1 - y0) * 180) / Math.PI, 0, 0])
  }
  cal.ell([0, -37, 892], [7, 3.5, 6])
  // the fornix: a thin white arch under the callosum
  const fornix = mk(c, 'fornix', T.white, L.tract + 1)
  fornix.cap([0, -10, 903], [0, 4, 909], 2.4)
  fornix.cap([0, 4, 909], [0, 20, 905], 2.4)

  // --- the ventricles (CSF), wider with age -------------------------------------------------------------------------------------
  const vx = 2.9 + 2.4 * at
  const vz = 1 + 0.25 * at
  for (const s of [-1, 1]) {
    const lv = mk(c, `lateralVentricle${s}`, T.csf, L.vent, 2)
    lv.ell([s * (1.6 + vx), -26, 906], [vx, 15, 10.5 * vz])
    lv.ell([s * (4.5 + vx), -7, 915], [vx + 0.2, 10, 6.5 * vz], [-8, 0, 0])
    lv.ell([s * (8 + vx), 8, 919], [vx + 0.4, 10, 6 * vz], [4, 0, 0])
    lv.ell([s * (11 + vx), 20, 915], [vx + 0.6, 9, 6.5 * vz], [24, 0, 0])
    lv.ell([s * 18.5, 28, 905], [6.5 + 2.2 * at, 10, 8.5 * vz])
    lv.ell([s * 21, 48, 902], [3.4 + 1.6 * at, 18, 5.5 * vz + 1])
    const th = mk(c, `temporalHorn${s}`, T.csf, L.vent)
    th.cap([s * 28, 26, 896], [s * 33.5, 21, 882], 2.8 + at * 1.1)
    th.cap([s * 33.5, 21, 882], [s * 36.5, 8, 876], 3 + at * 1.1)
    th.cap([s * 36.5, 8, 876], [s * 35, -3, 872.5], 3.2 + at * 1.2)
    // the foramen of Monro joining the third ventricle
    th.cap([s * 5, -10, 906], [0, -9, 898], 1.5)
    // choroid plexus in the atrium, calcified in older patients
    const plex = mk(c, `plexus${s}`, T.deepGrey, L.plexus)
    plex.ell([s * 18.5, 31, 902], [3.4, 6, 4])
    plex.cap([s * 14, 12, 915], [s * 18, 26, 908], 1.6)
    if (c.p.age > 38 && r() < 0.8) {
      const ca = mk(c, `plexusCalc${s}`, T.calc, L.plexus + 1)
      ca.ell([s * 18.5, 32, 901], [1.4 + 0.8 * ((c.p.age - 38) / 47), 2.6, 1.8])
    }
  }
  const third = mk(c, 'thirdVentricle', T.csf, L.vent, 2)
  third.ell([0, 1, 888], [1.5 + 1.7 * at, 13, 9])
  third.ell([0, -12, 882], [1.5 + 1.2 * at, 3, 3.2])
  third.ell([0, -6, 876], [1.5 + 1.2 * at, 3, 4.2])
  third.ell([0, 13, 899], [1.5 + 1.2 * at, 4, 3])
  third.cap([0, 12, 886], [0, 29, 863], 1.0 + 0.5 * at)
  const fourth = mk(c, 'fourthVentricle', T.csf, L.vent, 2)
  fourth.ell([0, 41, 858], [7.5 + at, 5.5, 7.5])
  for (const s of [-1, 1]) fourth.ell([s * 10, 40, 856], [5, 2.6, 2.6])
  fourth.cap([0, 45, 851], [0, 54, 845], 1.5)

  // --- the cisterns round the base of the brain -------------------------------------------------------------------------------
  const cist = mk(c, 'cisterns', T.csf, L.deep - 1, 3)
  cist.ell([0, -8, 880], [13, 11, 6])
  cist.ell([0, 8, 878], [9, 6, 5])
  cist.ell([0, 27, 893], [12, 7, 6])
  for (const s of [-1, 1]) cist.cap([s * 12, 12, 880], [s * 15, 26, 892], 3)

  // --- the pineal gland and its calcification ----------------------------------------------------------------------------------
  const pineal = mk(c, 'pineal', T.grey, L.vent + 1)
  pineal.ell([0, 17, 897], [3.4, 4.2, 3.2])
  if (c.p.age > 22 && r() < 0.85) mk(c, 'pinealCalc', T.calc, L.vent + 2).ell([0, 17.5, 897], [1.6, 1.8, 1.5])
  // the pituitary and its stalk, the optic chiasm
  mk(c, 'pituitary', T.deepGrey, L.deep).ell([0, -3, 874], [7.5, 5, 3.6])
  mk(c, 'pituitaryStalk', T.deepGrey, L.deep).cap([0, -7, 880], [0, -4, 875], 1.4)
  mk(c, 'chiasm', T.white, L.deep).ell([0, -12, 882], [7, 3.2, 1.8])
}

/** A tube through points (capsules, or tapered where radii are given per point), split into parts of at most 10 members. */
function tube(c: Ctx, name: string, t: number, layer: number, pts: V3[], radii: number | number[], smooth = 0): void {
  for (let i = 0, n = 0; i + 1 < pts.length; i += 10, n++) {
    const sp = mk(c, `${name}${n}`, t, layer, smooth)
    for (let k = i; k < Math.min(i + 10, pts.length - 1); k++) {
      if (Array.isArray(radii)) sp.cone(pts[k], pts[k + 1], radii[k], radii[k + 1])
      else sp.cap(pts[k], pts[k + 1], radii)
    }
  }
}

// --- the skull ---------------------------------------------------------------------------------------------------------------

/** The skull: an onion of layers round the brain (outer table, diploe, inner table, dura, CSF), the base, the temporal bones, the foramen magnum. */
function skull(c: Ctx): void {
  const all: Group[] = ['A', 'T', 'C', 'S']
  shape(c, 'skullOuter', T.cortical, L.cortex, 9.8, all, { dT: 6.6 })
  shape(c, 'diploe', T.marrow, L.marrow, 8.6, all, { dT: 5.4 })
  shape(c, 'innerTable', T.cortical, L.inner, 3.8, [...all, 'X'])
  shape(c, 'dura', T.dura, L.dura, 2.6, [...all, 'X'])
  shape(c, 'csfEnvelope', T.csf, L.csf, 1.9, [...all, 'X'])

  // the sphenoid body (the sella, the clivus), its dorsum, the wings, the occipital condyles
  bone(c, 'sphenoid', 1.6, (s, d) => s.ell([0, 6, 850], [rd(20, d), rd(22, d), rd(22, d)]))
  bone(c, 'dorsum', 1.0, (s, d) => s.ell([0, 5, 879], [rd(8, d), rd(2.2, d), rd(6.5, d)]))
  for (const s of [-1, 1]) {
    bone(c, `wing${s}`, 1.5, (sp, d) => {
      sp.ell([s * 46, -38, 866], [rd(14, d), rd(5, d), rd(17, d)], [0, 0, -s * 20])
      sp.ell([s * 20, -24, 878], [rd(12, d), rd(4, d), rd(4, d)])
    })
    bone(c, `condyle${s}`, 1.4, (sp, d) => sp.ell([s * 13, 28, 831], [rd(6, d), rd(14, d), rd(5, d)]))
    // the petrous bone: a ridge from the clivus out to the mastoid, with the dense otic capsule and the inner ear
    bone(c, `petrous${s}`, 1.8, (sp, d) => sp.cap([s * 12, 6, 853], [s * 50, 38, 847], rd(11.5, d)))
    mk(c, `otic${s}`, T.cortical, L.dense).ell([s * 42, 24, 850], [10, 10, 8])
    const ear = mk(c, `innerEar${s}`, T.csf, L.csf)
    ear.ell([s * 38, 15, 848], [3.6, 3.6, 3])
    ear.ell([s * 45, 26, 851], [3.4, 4.5, 3.4])
    ear.cap([s * 47, 27, 853], [s * 50, 33, 853], 1.1)
    ear.cap([s * 50, 33, 853], [s * 47, 38, 852], 1.1)
    ear.cap([s * 44, 30, 852], [s * 42, 38, 858], 1.1)
    ear.cap([s * 40, 30, 862], [s * 34, 22, 864], 1.1)
    ear.cap([s * 26, 29, 855], [s * 40, 26, 852], 2.4)
    mk(c, `nerve8${s}`, T.nerve, L.csf + 1).cap([s * 27, 29, 855], [s * 38, 26, 852], 1.3)
    // the middle ear, the ear canal and the mastoid with its air cells
    const air = mk(c, `middleEar${s}`, T.sinusAir, L.air)
    air.ell([s * 58, 24, 851], [3.5, 6, 6])
    air.cap([s * 60, 22, 851], [s * 91, 18, 849], 3.2)
    air.cap([s * 58, 28, 850], [s * 57, 38, 846], 2)
    mk(c, `ossicles${s}`, T.cortical, L.air + 1).ell([s * 56, 26, 852], [1.2, 1.8, 1.2])
    mk(c, `eardrum${s}`, T.scalp, L.air + 1).ell([s * 59.5, 22, 851], [0.6, 5, 5])
    bone(c, `mastoid${s}`, 1.6, (sp, d) => sp.ell([s * 56, 44, 836], [rd(8.5, d), rd(11, d), rd(16, d)]))
    const cells = mk(c, `mastoidCells${s}`, T.sinusAir, L.air)
    for (let i = 0; i < 11; i++) {
      const rr = 1.5 + 1.6 * c.rnd()
      cells.sph([s * (54 + 6 * c.rnd()), 36 + 12 * c.rnd(), 826 + 20 * c.rnd()], rr)
    }
    // the styloid process
    bone(c, `styloid${s}`, 0.8, (sp, d) => sp.cap([s * 46, 22, 832], [s * 40, 8, 800], rd(1.9, d)))
  }
  // the foramen magnum: a rim of cortex and the opening (CSF) joining the cranial cavity to the spinal canal
  mk(c, 'fmRim', T.cortical, L.inner).ell([0, 40, 837], [16.5, 22.5, 9.8])
  mk(c, 'fmOpening', T.csf, L.csf).ell([0, 40, 837], [14.5, 20.5, 8.6])
  // the crista galli and the cribriform plate
  bone(c, 'cristaGalli', 0.8, (s, d) => s.cap([0, -62, 891], [0, -56, 900], rd(2.2, d)))
}

// --- the face ----------------------------------------------------------------------------------------------------------------

const ARCH: [number, number][] = [
  [26, -36],
  [25, -52],
  [19, -68],
  [9, -78],
  [0, -80],
]

/** The facial skeleton: brow, orbital rims, nasal bones, zygoma, maxilla and palate, teeth, mandible. */
function facialSkeleton(c: Ctx): void {
  // the glabella and brow
  bone(c, 'glabella', 1.4, (s, d) => s.ell([0, -83, 889], [rd(30, d), rd(9, d), rd(13, d)]))
  for (const s of [-1, 1]) {
    // the orbital rim, a loop of capsules; the zygoma and its arch; the maxillary wall
    const ring: V3[] = []
    for (let k = 0; k < 9; k++) {
      const a = (k / 8) * Math.PI * 2
      ring.push([s * (30 + 19 * Math.cos(a)), -78 + 8 * Math.cos(a), 864 + 17 * Math.sin(a)])
    }
    bone(c, `orbitRim${s}`, 1.5, (sp, d) => {
      for (let k = 0; k < 8; k++) sp.cap(ring[k], ring[k + 1], rd(3.2, d))
    })
    bone(c, `zygoma${s}`, 1.4, (sp, d) => {
      sp.ell([s * 47, -66, 846], [rd(9, d), rd(8, d), rd(12, d)])
      sp.cap([s * 52, -62, 840], [s * 66, -38, 842], rd(3.2, d))
      sp.cap([s * 66, -38, 842], [s * 68, -10, 838], rd(3.2, d))
      sp.cap([s * 68, -10, 838], [s * 62, 10, 842], rd(3.2, d))
    })
    mk(c, `maxillaWall${s}`, T.cortical, L.cortex).ell([s * 32.5, -58, 824], [19.8, 23.8, 22.3])
    bone(c, `pterygoid${s}`, 0.7, (sp, d) => sp.ell([s * 28, -24, 822], [rd(1.8, d), rd(6, d), rd(13, d)]))
  }
  bone(c, 'nasalBones', 0.9, (s, d) => s.ell([0, -95, 870], [rd(7, d), rd(2.6, d), rd(10, d)], [-25, 0, 0]))
  // the hard palate, the upper alveolar ridge and the upper teeth
  bone(c, 'palate', 1.2, (s, d) => s.ell([0, -58, 806], [rd(22, d), rd(28, d), rd(3.4, d)]))
  const arc = (z: number, k = 1): V3[] => [...ARCH.map(([x, y]) => [-x * k, y, z] as V3), ...ARCH.slice(0, -1).reverse().map(([x, y]) => [x * k, y, z] as V3)]
  const up = arc(797)
  bone(c, 'alveolarUpper', 1.6, (s, d) => {
    for (let k = 0; k + 1 < up.length; k++) s.cap(up[k], up[k + 1], rd(5, d))
  })
  const low = arc(772)
  const teeth = (name: string, pts: V3[], z0: number, z1: number): void => {
    const t = mk(c, `${name}`, T.cortical, L.dense)
    for (let k = 0; k < pts.length; k += 1) {
      const q = pts[k]
      const molar = Math.abs(q[0]) > 20 || q[1] > -45
      t.cap([q[0] * 0.96, q[1] * 0.97, z0], [q[0] * 0.96, q[1] * 0.97, z1], molar ? 3.6 : 2.7)
    }
  }
  teeth('teethUpperL', up.slice(0, 5), 786, 799)
  teeth('teethUpperR', up.slice(5), 786, 799)
  teeth('teethLowerL', low.slice(0, 5), 774, 787)
  teeth('teethLowerR', low.slice(5), 774, 787)
  // the mandible: the body (upper and lower border), the ramus, the coronoid process and the condyle; the chin
  for (const s of [-1, 1]) {
    bone(c, `mandibleBody${s}`, 1.8, (sp, d) => {
      const lowB: V3[] = [[s * 50, 24, 764], [s * 44, 2, 758], [s * 34, -30, 757], [s * 20, -56, 758], [s * 4, -70, 760]]
      const upB: V3[] = [[s * 50, 26, 776], [s * 44, 2, 770], [s * 34, -30, 769], [s * 20, -56, 770], [s * 4, -70, 771]]
      for (let k = 0; k < 4; k++) {
        sp.cap(lowB[k], lowB[k + 1], rd(6, d))
        sp.cap(upB[k], upB[k + 1], rd(5.5, d))
      }
    })
    bone(c, `ramus${s}`, 1.6, (sp, d) => {
      sp.ell([s * 50, 22, 812], [rd(3.6, d), rd(15, d), rd(33, d)], [-8, 0, 0])
      sp.cap([s * 49, 12, 846], [s * 50, 16, 834], rd(3.6, d))
      sp.sph([s * 49, 10, 846], rd(6, d))
      sp.ell([s * 51, -4, 836], [rd(2.6, d), rd(6, d), rd(10, d)])
      sp.ell([s * 50, 26, 778], [rd(5, d), rd(10, d), rd(10, d)])
    })
  }
  bone(c, 'chin', 1.6, (s, d) => s.ell([0, -74, 765], [rd(9, d), rd(6, d), rd(12, d)]))
}

// --- the orbits, the sinuses, the nasal cavity -------------------------------------------------------------------------------------

function orbitsAndSinuses(c: Ctx): void {
  const at = c.at
  void at
  for (const s of [-1, 1]) {
    // the orbit: a bony shell round the posterior two thirds, fat, the globe with its lens, the optic nerve, the muscles
    const rot: V3 = [0, 0, s * 12]
    mk(c, `orbitShell${s}`, T.cortical, L.face - 5).ell([s * 28, -47, 864], [18.2, 26.2, 18.2], rot)
    mk(c, `orbitFat${s}`, T.fat, L.orbitFat).ell([s * 28, -52, 864], [16, 28, 16], rot)
    mk(c, `sclera${s}`, T.tendon, L.orbitMus).sph([s * 31, -72, 864], 12.7)
    mk(c, `globe${s}`, T.eye, L.globe).sph([s * 31, -72, 864], 11.9)
    mk(c, `lens${s}`, T.lens, L.lens).ell([s * 31, -80, 864], [4.6, 1.9, 4.6])
    tube(c, `opticNerve${s}`, T.nerve, L.orbitMus + 1, [[s * 28.5, -60.5, 864], [s * 20, -42, 865], [s * 13, -27, 868], [s * 10, -21, 871], [s * 4, -13, 879]], 2.2)
    const mus = mk(c, `eyeMuscles${s}`, T.muscle, L.orbitMus)
    mus.cap([s * 16, -30, 864], [s * 22, -64, 864], 2.5)
    mus.cap([s * 18, -30, 864], [s * 41, -66, 864], 2.5)
    mus.cap([s * 20, -30, 876], [s * 31, -64, 876.5], 2.4)
    mus.cap([s * 20, -30, 852], [s * 31, -64, 851.5], 2.4)
    mus.cap([s * 16, -32, 872], [s * 22, -56, 876], 1.6)
    // the paranasal sinuses: frontal, ethmoid cells, maxillary, sphenoid
    mk(c, `frontalSinus${s}`, T.sinusAir, L.air).ell([s * 13, -83, 897], [10, 4.8, 8])
    mk(c, `maxillaryAir${s}`, T.sinusAir, L.air).ell([s * 32.5, -58, 824], [18, 22, 20.5])
    bone(c, `ethmoid${s}`, 1.0, (sp, d) => sp.ell([s * 13, -50, 876], [rd(7.5, d), rd(22, d), rd(13, d)]))
    const cells = [mk(c, `ethmoidCellsA${s}`, T.sinusAir, L.air), mk(c, `ethmoidCellsB${s}`, T.sinusAir, L.air)]
    for (let iy = 0; iy < 6; iy++) for (let iz = 0; iz < 2; iz++) {
      const ix = (iy + iz) % 2
      const y = -66 + iy * 6 + 2 * (c.rnd() - 0.5)
      const z = 871 + iz * 8.5 + 2 * (c.rnd() - 0.5)
      cells[iz].sph([s * (10 + 3.4 * ix + 1.5 * c.rnd()), y, z], 2.5 + 1.0 * c.rnd())
    }
    // the nasal cavity and its turbinates
    mk(c, `nasalCavity${s}`, T.airway, L.air).ell([s * 7.2, -60, 836], [5.4, 36, 25])
    const tb = mk(c, `turbinates${s}`, T.scalp, L.air + 1)
    tb.ell([s * 10.6, -58, 818], [2.6, 20, 3.6])
    tb.ell([s * 10.4, -54, 836], [2.4, 15, 4.5])
    tb.ell([s * 10, -46, 848], [2, 9, 3])
  }
  mk(c, 'sphenoidSinus', T.sinusAir, L.air).ell([0, -2, 853], [11, 11, 8.5])
  mk(c, 'septumCartilage', T.cartilage, L.air + 1).ell([0, -86, 838], [1.3, 16, 15])
  mk(c, 'vomer', T.cortical, L.air + 1).ell([0, -44, 834], [1.1, 16, 18])
  // the cavernous sinuses beside the sella
}

// --- skin, face and neck soft tissue ---------------------------------------------------------------------------------------------

/** The neck as stacked tapered tubes, inset by `inset` mm. */
function neckTube(sp: SP, inset: number, cap: boolean): void {
  sp.taper(0, 33, 640, 700, 56 - inset, 65 - inset, 55 - inset, 65 - inset)
  sp.taper(0, 28, 700, 740, 55 - inset, 65 - inset, 53 - inset, 62 - inset)
  sp.taper(0, 22, 740, cap ? 800 : 786, 53 - inset, 62 - inset, 52 - inset, 62 - inset)
  if (cap) sp.ell([0, 14, 790], [54 - inset, 56 - inset, 24 - inset])
}

/** The skin outline of the head, face and neck, the soft-tissue fill under it, the scalp, the ears and the nose. */
function skinAndFill(c: Ctx): void {
  const fatT = 2.5 + c.p.fat * 0.12
  const surface = (name: string, t: number, layer: number, inset: number, outline: boolean): void => {
    shape(c, `${name}Cranium`, t, layer, 14.8 - inset, ['A', 'T', 'C'], { outline })
    const face = mk(c, `${name}Face`, t, layer, 10)
    face.ell([0, -58, 830], [62 - inset, 36 - inset, 40 - inset])
    face.ell([0, -62, 874], [58 - inset, 32 - inset, 28 - inset])
    face.ell([0, -70, 806], [44 - inset, 34 - inset, 22 - inset])
    face.ell([0, -56, 772], [40 - inset, 38 - inset, 22 - inset])
    face.ell([0, -40, 755], [40 - inset, 28 - inset, 10 - inset])
    for (const s of [-1, 1]) face.ell([s * 48, 5, 790], [24 - inset, 36 - inset, 40 - inset])
    neckTube(mk(c, `${name}Neck`, t, layer, 12), inset, true)
    const nose = mk(c, `${name}Nose`, t, layer, 5)
    nose.cone([0, -94, 884], [0, -110, 842], 7.5 - inset, 10.5 - inset)
    nose.ell([0, -113, 838], [7.5 - inset, 6.5 - inset, 6.5 - inset])
    for (const s of [-1, 1]) nose.ell([s * 10.5, -104, 832], [6.5 - inset, 6.5 - inset, 7.5 - inset])
    const ears = mk(c, `${name}Ears`, inset === 0 ? t : T.cartilage, layer, 0)
    for (const s of [-1, 1]) ears.ell([s * 84, 14, 858], [4.6 - inset, 15.5 - inset, 25 - inset], [0, 0, -s * 18])
  }
  surface('skin', T.skin, L.skin, 0, true)
  surface('fill', T.muscle, L.fill, 2.2, false)
  shape(c, 'scalp', T.scalp, L.scalp, 12.6, ['A', 'T', 'C'])
  // subcutaneous fat and the muscle block of the neck, the fat spaces between the neck's compartments
  neckTube(mk(c, 'neckFat', T.fat, L.fat, 12), 2.2, false)
  neckTube(mk(c, 'neckMuscle', T.muscle, L.muscle, 12), 2.2 + fatT, false)
  const fat = mk(c, 'neckFatSpaces', T.fat, L.gland, 6)
  fat.ell([0, 4, 712], [30, 20, 46])
  for (const s of [-1, 1]) {
    fat.ell([s * 31, 4, 715], [9, 14, 42])
    fat.ell([s * 28, 4, 800], [8, 14, 16])
    fat.ell([s * 40, -40, 806], [10, 12, 9])
    mk(c, `parotid${s}`, T.scalp, L.gland).ell([s * 54, 14, 810], [11, 13, 18])
    mk(c, `submandibular${s}`, T.scalp, L.gland).ell([s * 38, -20, 770], [11, 12, 8])
  }
  mk(c, 'tongue', T.muscle, L.tongue).ell([0, -36, 782], [24, 38, 14])
}

// --- airway, pharynx, larynx, trachea, thyroid ------------------------------------------------------------------------------------------

/** Airway centre (design) down the neck: larynx at C4-C5, then the trachea moving back with the spine's curve. */
function airway(c: Ctx): void {
  // pharynx wall (3 mm of soft tissue round the lumen), then the lumen
  const wall = mk(c, 'pharynxWall', T.gutWall, L.wall, 3)
  wall.ell([0, -6, 822], [17.5, 17, 16])
  wall.ell([0, 3, 792], [17.5, 12, 20])
  wall.ell([0, 4, 762], [13, 10.5, 19])
  const lum = mk(c, 'pharynx', T.airway, L.air, 3)
  lum.ell([0, -6, 822], [14.5, 14.2, 13])
  lum.ell([0, 3, 792], [14.5, 9, 17])
  lum.ell([0, 4, 764], [10, 7.5, 17])
  // the soft palate and the epiglottis
  mk(c, 'softPalate', T.muscle, L.air + 1).ell([0, -16, 807], [12, 20, 3.4])
  mk(c, 'epiglottis', T.cartilage, L.air + 1).ell([0, 0, 768], [6.5, 1.3, 11], [-12, 0, 0])
  // the larynx: hyoid, thyroid cartilage, cricoid, with the vestibule, the glottis and the subglottis
  bone(c, 'hyoid', 1.0, (s, d) => {
    s.cap([-22, 6, 779], [-12, -12, 779], rd(2.8, d))
    s.cap([-12, -12, 779], [12, -12, 779], rd(2.8, d))
    s.cap([12, -12, 779], [22, 6, 779], rd(2.8, d))
  })
  const cart = mk(c, 'laryngealCartilage', T.cartilage, L.cart)
  for (const s of [-1, 1]) cart.ell([s * 10, -5, 744], [1.7, 12, 14], [0, 0, -s * 45])
  cart.ell([0, 4, 726], [11.5, 11, 6.5])
  const lv = mk(c, 'larynx', T.airway, L.air, 2)
  lv.ell([0, 1, 756], [8, 9.5, 10])
  lv.ell([0, 3, 744], [6, 8, 4])
  lv.ell([0, 4, 738], [2.4, 8, 2.8])
  lv.ell([0, 4, 729], [7, 7.5, 6])
  // the trachea (airway with a wall) and the esophagus behind it
  const trach: V3[] = [[0, 4, 724], [0, 3.8, 705], [0, 9.8, 687], [0, 19.8, 651], [0, 24, 636]]
  tube(c, 'tracheaWall', T.gutWall, L.wall, trach, 10.8)
  tube(c, 'trachea', T.airway, L.air, trach, 8.3)
  mk(c, 'tracheaCartilage', T.cartilage, L.wall + 1).ell([0, -6, 705], [7, 1.4, 20])
  const eso: V3[] = [[0, 13, 735], [0, 15.5, 723], [0, 20.5, 705], [0, 26.5, 687], [0, 36.5, 651], [0, 40, 636]]
  tube(c, 'esophagus', T.gutWall, L.wall, eso, 6.2)
  // the thyroid
  for (const s of [-1, 1]) mk(c, `thyroid${s}`, T.thyroid, L.cart + 1).ell([s * 18, 4, 712], [8.5, 11, 20], [0, 0, s * 4])
  mk(c, 'thyroidIsthmus', T.thyroid, L.cart + 1).ell([0, -8.5, 702], [11, 3.2, 4.5])
}

// --- the cervical spine ----------------------------------------------------------------------------------------------------------------

const VERT: { n: string; z: number; y: number; hx: number; sp: number }[] = [
  { n: 'C2', z: 798, y: 28, hx: 13, sp: 22 },
  { n: 'C3', z: 778, y: 29, hx: 11, sp: 14 },
  { n: 'C4', z: 759, y: 30, hx: 11.5, sp: 15 },
  { n: 'C5', z: 741, y: 31, hx: 12, sp: 17 },
  { n: 'C6', z: 723, y: 33, hx: 13, sp: 22 },
  { n: 'C7', z: 705, y: 38, hx: 14.5, sp: 28 },
  { n: 'T1', z: 687, y: 44, hx: 15, sp: 30 },
  { n: 'T2', z: 669, y: 49, hx: 16, sp: 34 },
  { n: 'T3', z: 651, y: 54, hx: 17, sp: 36 },
]

/** C1 to T3: bodies, discs, arches with transverse foramina and spinous processes, the canal and the cord, the vertebral arteries. */
function spine(c: Ctx): void {
  // the atlas: anterior arch, lateral masses, posterior arch, transverse processes; the dens of C2 inside its ring
  bone(c, 'atlas', 1.4, (sp, d) => {
    sp.cap([-14, 19.5, 819], [0, 17.5, 819], rd(3.2, d))
    sp.cap([0, 17.5, 819], [14, 19.5, 819], rd(3.2, d))
    for (const s of [-1, 1]) {
      sp.ell([s * 19, 33, 820], [rd(8, d), rd(8.5, d), rd(7.5, d)])
      sp.cap([s * 21, 44, 818], [s * 12, 58, 819], rd(2.8, d))
      sp.cap([s * 12, 58, 819], [0, 63, 819], rd(2.8, d))
      sp.ell([s * 30, 38, 820], [rd(8, d), rd(5.5, d), rd(4.5, d)])
    }
  })
  bone(c, 'dens', 1.6, (sp, d) => sp.cap([0, 26.5, 808], [0, 26, 826.5], rd(5.2, d)))
  mk(c, 'transverseLigament', tissue('ligament'), L.csf + 1).ell([0, 33, 821], [13, 1.3, 3.4])
  mk(c, 'atlantodentalJoint', T.jointFluid, L.disc + 1).ell([0, 21, 822], [5, 0.5, 6])
  const canal = mk(c, 'canal', T.csf, L.csf, 6)
  const cord = mk(c, 'cord', T.nerve, L.stem, 6)
  canal.ell([0, 47, 820], [13, 12.5, 14])
  cord.ell([0, 45, 820], [6.4, 4.6, 14])
  VERT.forEach((v, i) => {
    const { n, z, y, hx, sp } = v
    const T1 = n.startsWith('T')
    bone(c, `vert${n}`, 1.7, (s, d) => s.box([0, y, z], [rd(hx, d), rd(8.5, d), rd(T1 ? 8 : 7, d)], rd(3, d)))
    bone(c, `arch${n}`, 1.3, (s, d) => {
      for (const sd of [-1, 1]) {
        s.cap([sd * 8, y + 6, z], [sd * 13, y + 17, z - 1], rd(3.2, d))
        s.ell([sd * 16.5, y + 17, z], [rd(5.5, d), rd(6, d), rd(8.5, d)])
        s.cap([sd * 15, y + 23, z - 0.5], [sd * 2.5, y + 28.5, z - 2], rd(2.4, d))
        s.ell([sd * 21.5, y + 7.5, z], [rd(8, d), rd(5.8, d), rd(6, d)])
        const k = n === 'C7' || T1 ? 0.4 : 2
        s.cap([sd * k, y + 28.5, z - 2], [sd * k, y + 28.5 + 0.95 * sp, z - 2 - 0.3 * sp], rd(2.4, d))
      }
    })
    canal.ell([0, y + 16.5, z], [10.5, 8.8, 12.5])
    cord.ell([0, y + 17, z], [6, 4.3, 12.5])
    const nx = VERT[i + 1]
    if (nx) {
      const mz = (z + nx.z) / 2
      const my = (y + nx.y) / 2
      mk(c, `disc${n}`, T.disc, L.disc).box([0, my, mz], [(hx + nx.hx) / 2 - 1, 7.6, (z - nx.z) / 2 - 7 + 0.8], 2)
      const fj = mk(c, `facet${n}`, T.jointFluid, L.disc + 1)
      for (const s of [-1, 1]) fj.ell([s * 16.5, (y + nx.y) / 2 + 17, mz], [4.2, 4.2, 0.8], [40, 0, 0])
    }
  })
  // the canal and cord continue to the bottom of the neck
  const last = VERT[VERT.length - 1]
  void last
}

// --- vessels ----------------------------------------------------------------------------------------------------------------------------

/** Arteries, veins and the dural sinuses: flowing blood (a flow void on spin echo) with a thin wall. */
function vessels(c: Ctx): void {
  const cavEnv = [...CEREBRUM, ...TEMPORAL, ...CEREBELLUM, ...CEREBELLUM_FILL]
  const vessel = (name: string, pts: V3[], r: number | number[], wall = 0.8): void => {
    const rw = Array.isArray(r) ? r.map((v) => v + wall) : r + wall
    tube(c, `${name}Wall`, T.vesselWall, L.flow - 1, pts, rw)
    tube(c, `${name}`, T.blood, L.flow, pts, r)
  }
  for (const s of [-1, 1]) {
    // common, internal and external carotid, up through the petrous canal and the cavernous sinus to the circle of Willis
    const ica: V3[] = [[s * 28, 1, 640], [s * 28, 1, 680], [s * 26, 2, 720], [s * 25, 4, 756], [s * 24, 8, 780], [s * 23, 13, 800], [s * 22, 17, 822], [s * 21, 17, 840], [s * 20, 15, 850], [s * 18, 11, 853], [s * 14, 5, 859], [s * 13, -1, 866], [s * 12.5, -6, 876], [s * 11, -9, 883], [s * 10, -11, 887]]
    vessel(`carotid${s}`, ica, [3.9, 3.9, 3.9, 3.8, 3.2, 3.1, 3.0, 3.0, 2.9, 2.9, 2.8, 2.7, 2.6, 2.5, 2.4])
    vessel(`eca${s}`, [[s * 25, 4, 756], [s * 31, 1, 780], [s * 40, -4, 800]], [2.1, 1.8, 1.5])
    // the circle of Willis and the cerebral arteries
    vessel(`a1${s}`, [[s * 10, -11, 887], [s * 3, -19, 889]], 1.4)
    vessel(`aca${s}`, [[s * 3, -19, 889], [s * 3, -28, 893], [s * 3, -42, 903], [s * 3, -44, 912], [s * 3.2, -34, 922], [s * 3.2, -12, 929], [s * 3.2, 12, 927], [s * 3.2, 26, 918]], 1.3)
    vessel(`mca${s}`, [[s * 10, -11, 887], [s * 20, -13, 884], [s * 36, -16, 884], [s * 46, -15, 889], [s * 52, 0, 892], [s * 56, 14, 898]], [1.9, 1.9, 1.8, 1.7, 1.4, 1.2])
    vessel(`pcom${s}`, [[s * 11, -9, 881], [s * 9, 6, 873]], 1.0)
    vessel(`pca${s}`, [[0, 6, 872], [s * 7, 7, 872], [s * 14, 8, 872], [s * 17, 22, 885], [s * 16, 40, 896], [s * 10, 60, 900]], 1.5)
    // the vertebral artery: up the transverse foramina, round the atlas and through the foramen magnum
    vessel(`vertebral${s}`, [[s * 21.5, 40.5, 723], [s * 21.5, 38.5, 741], [s * 21.5, 37.5, 759], [s * 21.5, 36.5, 778], [s * 22, 35.5, 798], [s * 28, 38, 820], [s * 22, 46, 826.5], [s * 14, 56, 827], [s * 9, 52, 836], [s * 7, 42, 840], [s * 5, 30, 843], [s * 2, 17, 847]], 2.3, 0.6)
  }
  vessel('basilar', [[0, 15, 848], [0, 9, 852], [0, 6.5, 862], [0, 6, 872]], 1.9, 0.5)
  vessel('acom', [[-3, -19, 889], [3, -19, 889]], 1.0)
  // the superior sagittal sinus along the top of the brain, the straight sinus, the torcula and the transverse and sigmoid sinuses
  const sss: V3[] = []
  for (let y = -66; y <= 88; y += 12) {
    const top = envHit(CEREBRUM, -c.shrink, [0, y, 900], [0, 0, 1])
    if (top) sss.push([0, y, top[2] + 1.6])
  }
  tube(c, 'superiorSagittal', T.blood, L.flow, sss, 3.1)
  vessel('straightSinus', [[0, 12, 903], [0, 34, 905], [0, 60, 892], [0, 92, 878]], [1.6, 2.4, 2.6, 3.4], 0.5)
  for (const s of [-1, 1]) {
    const pts: V3[] = []
    for (let a = 0; a <= 75; a += 15) {
      const ar = (a * Math.PI) / 180
      const P = envHit(cavEnv, 1.5, [0, 66, 868], [s * Math.sin(ar), Math.cos(ar), 0])
      if (P) pts.push(P)
    }
    pts.push([s * 58, 52, 860], [s * 56, 44, 848], [s * 52, 38, 836], [s * 48, 33, 824], [s * 41, 26, 812], [s * 36, 16, 796], [s * 33, 8, 775], [s * 33, 5, 740], [s * 34, 2, 700], [s * 35, 2, 660])
    const n = pts.length
    tube(c, `venous${s}`, T.blood, L.flow, pts, pts.map((_, i) => (i < 6 ? 4.2 : i < n - 8 ? 4.6 : 5.6)))
  }
  mk(c, 'torcula', T.blood, L.flow).sph([0, 92, 877], 5)
}

// --- the build ---------------------------------------------------------------------------------------------------------------------------

export function buildHead(b: BodyBuilder, p: PatientParams, regions: readonly RegionId[]): Landmarks {
  void regions
  const F = new Frame(p)
  const at = p.atrophy
  const c: Ctx = { b, F, p, at, shrink: 2.4 * at, rnd: mulberry32(mixSeed(p.seed >>> 0, 0x4ead)) }
  skinAndFill(c)
  skull(c)
  facialSkeleton(c)
  orbitsAndSinuses(c)
  airway(c)
  brain(c)
  deepStructures(c)
  spine(c)
  vessels(c)

  return {
    vertex: F.pt([0, 6, 985]),
    foramenMagnum: F.pt([0, 40, 837]),
    headCentre: F.pt([0, 8, 900]),
    nasion: F.pt([0, -90, 880]),
    ac: F.pt([0, -13, 893]),
    pc: F.pt([0, 15, 890]),
    axialNormal: unit([0, 0.11, 0.994]),
    vertC1: F.pt([0, 22, 820]),
    vertC2: F.pt([0, 28, 798]),
    vertC3: F.pt([0, 29, 778]),
    vertC4: F.pt([0, 30, 759]),
    vertC5: F.pt([0, 31, 741]),
    vertC6: F.pt([0, 33, 723]),
    vertC7: F.pt([0, 38, 705]),
    vertT1: F.pt([0, 44, 687]),
    dens: F.pt([0, 26, 822]),
  }
}
