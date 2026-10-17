// Ported from Waltz City (src/scene/actors/crowd/geometry.ts). Same builder and body; new: hi-vis chest bands (the accent slot), the skirt
// piece in its own colour slot (coat, gown, skirt), no folder or phone (held items are the props mesh in gear.ts), and a coat band on the far figure.
// W1 "Close-up people": the high body now has a real head (face.ts), hair with a hairline (hair.ts), mitten hands with a thumb and the staff
// details on the chest (staff.ts); the mid and far bodies are unchanged.
/**
 * Geometry of the instanced bodies. Every person is the same rigid pieces (see P in constants.ts) in one
 * merged buffer; each vertex knows which piece it belongs to (`aPart.x`, picks the piece's matrix from the
 * pose texture) and which colour slot it uses (`aPart.y`, picks a colour of the person's palette).
 *
 * Three variants are built from the same description:
 *   high  about 2,000 triangles (the budget test prints the number; at most 2,200): a jawed head with ears, nose, eyes, brows, a mouth and glasses, hair with a
 *         hairline, mitten hands with thumbs, round limbs, two hi-vis bands and the staff details (lanyard, badge, stethoscope, dosimeter, apron bib)
 *   mid   487 triangles: the same pieces with fewer facets, four-sided forearms and shins and no eyes
 *         (a person is 85 px tall at the 24 m where this body takes over)
 *   far   100 triangles: one rigid figure (legs, torso, head) for the people beyond 120 m
 *
 * Pieces are modelled in the nominal body's units around their joint (see BODY): arms and legs hang along
 * -Y from the joint at the origin, feet extend along +Z from the ankle, the head is built around the neck
 * base. Smooth normals come from computeVertexNormals over indexed rings, so a limb is round, not faceted.
 */
import { BufferAttribute, BufferGeometry, InstancedBufferGeometry, Uint16BufferAttribute } from 'three'
import { FX, P, SLOT, fixedSlot } from './constants'
import { buildGlasses, buildHead } from './face'
import { buildHairCap } from './hair'
import { buildStaffGear } from './staff'

export type Slot = number

export interface Ring {
  /** Position along the axis. */
  t: number
  /** Half extents of the elliptical cross-section. */
  rx: number
  rz: number
  /** Centre of the cross-section off the axis. */
  cx?: number
  cz?: number
  slot?: Slot
  /** Internal: a copy of the ring below it with the next colour; no triangles join the two. */
  dup?: boolean
}

export class Builder {
  pos: number[] = []
  part: number[] = []
  idx: number[] = []

  get triangles(): number {
    return this.idx.length / 3
  }

  vertex(x: number, y: number, z: number, part: number, slot: Slot): number {
    this.pos.push(x, y, z)
    this.part.push(part, slot)
    return this.pos.length / 3 - 1
  }

  /** Push a triangle facing away from `(ox, oy, oz)`. */
  tri(a: number, b: number, c: number, ox: number, oy: number, oz: number): void {
    const p = this.pos
    const ax = p[a * 3]
    const ay = p[a * 3 + 1]
    const az = p[a * 3 + 2]
    const ux = p[b * 3] - ax
    const uy = p[b * 3 + 1] - ay
    const uz = p[b * 3 + 2] - az
    const vx = p[c * 3] - ax
    const vy = p[c * 3 + 1] - ay
    const vz = p[c * 3 + 2] - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const cx = (ax + p[b * 3] + p[c * 3]) / 3 - ox
    const cy = (ay + p[b * 3 + 1] + p[c * 3 + 1]) / 3 - oy
    const cz = (az + p[b * 3 + 2] + p[c * 3 + 2]) / 3 - oz
    if (nx * cx + ny * cy + nz * cz >= 0) this.idx.push(a, b, c)
    else this.idx.push(a, c, b)
  }

  /**
   * A loft through elliptical rings. A ring with both radii zero is a pole (one shared vertex).
   * `offset` moves the whole piece; `slotAt` can override the slot per vertex (soles).
   */
  loft(part: number, axis: 'y' | 'z', rings: Ring[], seg: number, slot: Slot, offset: readonly [number, number, number] = [0, 0, 0], slotAt?: (sinTheta: number, ring: number) => Slot): void {
    // crisp colour changes: where the slot changes between rings, duplicate the lower ring with the new slot
    const rs: Ring[] = []
    for (let i = 0; i < rings.length; i++) {
      rs.push(rings[i])
      const next = rings[i + 1]
      if (next && (next.slot ?? slot) !== (rings[i].slot ?? slot) && rings[i].rx > 0) rs.push({ ...rings[i], slot: next.slot, dup: true })
    }
    const rows: number[][] = []
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i]
      const pole = r.rx <= 1e-9 && r.rz <= 1e-9
      // a pole takes the colour of the ring next to it, so the tip of a sleeve does not blend into another colour
      const s = (pole ? (rs[i + 1] ?? rs[i - 1])?.slot : undefined) ?? r.slot ?? slot
      const cx = (r.cx ?? 0) + offset[0]
      const cz = r.cz ?? 0
      const row: number[] = []
      const n = pole ? 1 : seg
      for (let j = 0; j < n; j++) {
        const th = (j / seg) * Math.PI * 2
        const c = Math.cos(th)
        const sn = Math.sin(th)
        const a = r.rx * c
        const b = r.rz * sn
        const sl = slotAt ? slotAt(sn, i) : s
        if (axis === 'y') row.push(this.vertex(cx + a, r.t + offset[1], cz + b + offset[2], part, sl))
        else row.push(this.vertex(cx + a, cz + b + offset[1], r.t + offset[2], part, sl))
      }
      rows.push(row)
    }
    for (let i = 0; i + 1 < rows.length; i++) {
      const A = rows[i]
      const B = rows[i + 1]
      const ra = rs[i]
      const rb = rs[i + 1]
      if (rb.dup) continue
      // local ring centre as the orientation reference (so a loft that bends still faces outwards)
      const oa = this.ringCentre(axis, ra, offset)
      const ob = this.ringCentre(axis, rb, offset)
      const ox = (oa[0] + ob[0]) / 2
      const oy = (oa[1] + ob[1]) / 2
      const oz = (oa[2] + ob[2]) / 2
      for (let j = 0; j < seg; j++) {
        const j2 = (j + 1) % seg
        const a0 = A.length === 1 ? A[0] : A[j]
        const a1 = A.length === 1 ? A[0] : A[j2]
        const b0 = B.length === 1 ? B[0] : B[j]
        const b1 = B.length === 1 ? B[0] : B[j2]
        if (A.length === 1) this.tri(a0, b1, b0, ox, oy, oz)
        else if (B.length === 1) this.tri(a0, a1, b0, ox, oy, oz)
        else {
          this.tri(a0, a1, b0, ox, oy, oz)
          this.tri(a1, b1, b0, ox, oy, oz)
        }
      }
    }
  }

  private ringCentre(axis: 'y' | 'z', r: Ring, offset: readonly [number, number, number]): [number, number, number] {
    return axis === 'y' ? [(r.cx ?? 0) + offset[0], r.t + offset[1], (r.cz ?? 0) + offset[2]] : [(r.cx ?? 0) + offset[0], (r.cz ?? 0) + offset[1], r.t + offset[2]]
  }

  /** Ellipsoid centred at `c` with radii `r`; latitudes from `lat0` (radians, -PI/2 = south pole) up to the north pole. */
  ellipsoid(part: number, slot: Slot, c: readonly [number, number, number], r: readonly [number, number, number], seg: number, rings: number, lat0 = -Math.PI / 2): void {
    const list: Ring[] = []
    for (let i = 0; i <= rings; i++) {
      const lat = lat0 + ((Math.PI / 2 - lat0) * i) / rings
      const cl = Math.cos(lat)
      const pole = i === rings || (lat0 <= -Math.PI / 2 + 1e-6 && i === 0)
      list.push({ t: r[1] * Math.sin(lat), rx: pole ? 0 : r[0] * cl, rz: pole ? 0 : r[2] * cl })
    }
    this.loft(part, 'y', list, seg, slot, c)
  }

  /** Flat quad (two triangles) from four points, facing away from `o`. */
  quad(part: number, slot: Slot, p: readonly number[][], o: readonly [number, number, number]): void {
    const v = p.map((q) => this.vertex(q[0], q[1], q[2], part, slot))
    this.tri(v[0], v[1], v[2], o[0], o[1], o[2])
    this.tri(v[0], v[2], v[3], o[0], o[1], o[2])
  }

  box(part: number, slot: Slot, c: readonly [number, number, number], h: readonly [number, number, number]): void {
    const [cx, cy, cz] = c
    const [hx, hy, hz] = h
    const corners: number[][] = []
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push([cx + sx * hx, cy + sy * hy, cz + sz * hz])
    const faces = [
      [0, 1, 3, 2],
      [4, 6, 7, 5],
      [0, 4, 5, 1],
      [2, 3, 7, 6],
      [0, 2, 6, 4],
      [1, 5, 7, 3],
    ]
    for (const f of faces) this.quad(part, slot, f.map((i) => corners[i]), c)
  }

  build(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3))
    g.setAttribute('aPart', new BufferAttribute(new Float32Array(this.part), 2))
    g.setIndex(new Uint16BufferAttribute(new Uint16Array(this.idx), 1))
    g.computeVertexNormals()
    return g
  }
}

export interface Detail {
  limbSeg: number
  torsoSeg: number
  headSeg: number
  headRings: number
  footSeg: number
  handSeg: number
  handRings: number
  /** Facets of the thin limbs (forearms, shins). */
  thinSeg: number
  features: boolean
}

export const HIGH: Detail = { limbSeg: 7, torsoSeg: 12, headSeg: 16, headRings: 5, footSeg: 7, handSeg: 6, handRings: 4, thinSeg: 7, features: true }
export const MID: Detail = { limbSeg: 5, torsoSeg: 7, headSeg: 7, headRings: 4, footSeg: 4, handSeg: 4, handRings: 2, thinSeg: 4, features: false }

/** Chest surface at height y and lateral fraction u in [-1, 1] (front half), for decals sitting on it. */
function chestAt(y: number, u: number, lift: number): number[] {
  const rings = CHEST
  let i = 0
  while (i < rings.length - 2 && rings[i + 1].t < y) i++
  const a = rings[i]
  const b = rings[i + 1]
  const k = Math.min(1, Math.max(0, (y - a.t) / (b.t - a.t)))
  const rx = a.rx + (b.rx - a.rx) * k
  const rz = a.rz + (b.rz - a.rz) * k
  const f = Math.sqrt(Math.max(0, 1 - u * u))
  const x = u * rx
  const z = rz * f
  // outward normal of the ellipse at that point
  const nx = x / (rx * rx)
  const nz = z / (rz * rz)
  const nl = Math.sqrt(nx * nx + nz * nz) || 1
  return [x + (nx / nl) * lift, y, z + (nz / nl) * lift]
}

const CHEST: Ring[] = [
  { t: -0.02, rx: 0.128, rz: 0.082 },
  { t: 0.0, rx: 0.14, rz: 0.09 },
  { t: 0.1, rx: 0.15, rz: 0.098 },
  { t: 0.22, rx: 0.168, rz: 0.108 },
  { t: 0.32, rx: 0.185, rz: 0.106 },
  { t: 0.385, rx: 0.14, rz: 0.08 },
  { t: 0.425, rx: 0.06, rz: 0.055 },
]

/** The chest cross-section at height t (waist joint at 0), interpolated between the table's rings. */
function chestRingAt(t: number): { t: number; rx: number; rz: number } {
  let i = 0
  while (i < CHEST.length - 2 && CHEST[i + 1].t < t) i++
  const a = CHEST[i]
  const c = CHEST[i + 1]
  const k = Math.min(1, Math.max(0, (t - a.t) / (c.t - a.t)))
  return { t, rx: a.rx + (c.rx - a.rx) * k, rz: a.rz + (c.rz - a.rz) * k }
}

/** A mitten hand (origin: the wrist, hanging along -Y, thin in X, wide in Z, the thumb on the +Z side) with a thumb that splays forward: it reads at 2 m. */
function mitten(b: Builder, part: number): void {
  const R = (t: number, rx: number, rz: number): Ring => ({ t, rx, rz })
  b.loft(part, 'y', [
    { t: 0.0, rx: 0, rz: 0 },
    R(-0.025, 0.0185, 0.034),
    R(-0.065, 0.0195, 0.0415),
    R(-0.105, 0.0175, 0.04),
    R(-0.145, 0.0135, 0.031),
    R(-0.17, 0.0085, 0.0185),
    { t: -0.18, rx: 0, rz: 0 },
  ], 6, SLOT.skin)
  b.loft(part, 'y', [
    { t: -0.022, rx: 0, rz: 0, cz: 0.03 },
    { t: -0.032, rx: 0.0105, rz: 0.0105, cz: 0.036 },
    { t: -0.062, rx: 0.0105, rz: 0.0102, cz: 0.047 },
    { t: -0.09, rx: 0.0085, rz: 0.0085, cz: 0.056 },
    { t: -0.101, rx: 0, rz: 0, cz: 0.059 },
  ], 5, SLOT.skin)
}

function buildBody(d: Detail): Builder {
  const b = new Builder()
  const hi = d.features
  const R = (t: number, r: number, slot?: Slot, rz = r): Ring => ({ t, rx: r, rz, slot })
  const pole = (t: number): Ring => ({ t, rx: 0, rz: 0 })

  // ---- pelvis (origin: pelvis centre)
  b.loft(P.pelvis, 'y', hi
    ? [pole(-0.115), { t: -0.04, rx: 0.162, rz: 0.105 }, { t: 0.04, rx: 0.158, rz: 0.1 }, { t: 0.115, rx: 0.135, rz: 0.088 }, pole(0.14)]
    : [pole(-0.115), { t: -0.04, rx: 0.162, rz: 0.105 }, { t: 0.115, rx: 0.135, rz: 0.088 }, pole(0.14)], d.torsoSeg, SLOT.pants)

  // ---- chest (origin: waist joint) with shirt front, tie and lanyard decals
  // hi-vis vest bands (SLOT.accent: the same colour as the top for everyone but the paramedic, so they are invisible on others)
  const band = (t: number, slot: Slot): Ring => ({ ...chestRingAt(t), slot })
  const chest: Ring[] = hi
    ? [band(0, SLOT.top), band(0.07, SLOT.top), band(0.12, SLOT.accent), band(0.19, SLOT.top), band(0.24, SLOT.accent), band(0.33, SLOT.top), CHEST[5], CHEST[6]]
    : [band(0, SLOT.top), band(0.07, SLOT.top), band(0.12, SLOT.accent), band(0.19, SLOT.top), band(0.24, SLOT.accent), band(0.33, SLOT.top), CHEST[5]]
  b.loft(P.chest, 'y', [pole(-0.04), ...chest, pole(0.46)], d.torsoSeg, SLOT.top)
  const o: [number, number, number] = [0, 0.2, 0]
  {
    const v = [chestAt(0.405, -0.3, 0.004), chestAt(0.405, 0.3, 0.004), chestAt(0.2, 0, 0.004)]
    const ids = v.map((q) => b.vertex(q[0], q[1], q[2], P.chest, SLOT.front))
    b.tri(ids[0], ids[2], ids[1], o[0], o[1], o[2])
  }
  b.quad(P.chest, SLOT.accent, [chestAt(0.4, -0.1, 0.007), chestAt(0.4, 0.1, 0.007), chestAt(0.12, 0.12, 0.007), chestAt(0.12, -0.12, 0.007)], o)
  if (hi) buildStaffGear(b, chestAt, SLOT.lanyard)
  else {
    // the far-away decals: a strap V and a badge patch in the strap colour
    for (const sgn of [-1, 1]) {
      const a = chestAt(0.405, sgn * 0.32, 0.005)
      const c = chestAt(0.19, sgn * 0.04, 0.005)
      b.quad(P.chest, SLOT.lanyard, [[a[0] - 0.007, a[1], a[2]], [a[0] + 0.007, a[1], a[2]], [c[0] + 0.007, c[1], c[2]], [c[0] - 0.007, c[1], c[2]]], o)
    }
    b.quad(P.chest, SLOT.lanyard, [chestAt(0.2, -0.17, 0.008), chestAt(0.2, 0.17, 0.008), chestAt(0.12, 0.17, 0.008), chestAt(0.12, -0.12 - 0.05, 0.008)], o)
  }

  // ---- head (origin: neck base). The close-up head is its own build (face.ts); the mid body keeps a plain ellipsoid on a neck.
  if (hi) {
    buildHead(b, d.headSeg)
    buildGlasses(b)
  } else {
    b.loft(P.head, 'y', [pole(-0.035), R(-0.03, 0.046), R(0.085, 0.046)], 4, SLOT.skin)
    b.ellipsoid(P.head, SLOT.skin, [0, 0.18, 0.012], [0.093, 0.112, 0.105], d.headSeg, d.headRings)
  }

  // ---- hair: a dome with a hairline (the cap), a whole ellipsoid (back, ponytail, puff) and, in the close-up body, a fringe piece; the rig scales and places them
  buildHairCap(b, P.hairCap, SLOT.hair, hi ? 16 : 7, hi ? 5 : 2)
  b.ellipsoid(P.hairBack, SLOT.hair, [0, 0, 0], [1, 1, 1], hi ? 8 : 5, hi ? 4 : 2)
  if (hi) b.ellipsoid(P.hairFront, SLOT.hair, [0, 0, 0], [1, 1, 1], 8, 3)

  // ---- arms (origin: shoulder / elbow / wrist, hanging along -Y)
  for (const [upper, fore, hand] of [[P.armL, P.foreL, P.handL], [P.armR, P.foreR, P.handR]] as const) {
    b.loft(upper, 'y', hi
      ? [pole(-0.335), R(-0.29, 0.036, SLOT.sleeve), R(-0.165, 0.043, SLOT.sleeve), R(-0.165, 0.043, SLOT.top), R(0.0, 0.046, SLOT.top), pole(0.04)]
      : [pole(-0.31), R(-0.165, 0.043, SLOT.sleeve), R(-0.165, 0.043, SLOT.top), R(0.0, 0.046, SLOT.top), pole(0.04)], d.limbSeg, SLOT.top)
    b.loft(fore, 'y', hi
      ? [pole(-0.27), R(-0.255, 0.026), R(-0.2, 0.029), R(-0.05, 0.036), R(0.0, 0.037), pole(0.03)]
      : [pole(-0.27), R(-0.23, 0.027), R(0.0, 0.037), pole(0.03)], d.thinSeg, SLOT.sleeve)
    if (hi) mitten(b, hand)
    else b.ellipsoid(hand, SLOT.skin, [0, -0.085, 0], [0.022, 0.088, 0.04], d.handSeg, d.handRings)
  }

  // ---- legs (origin: hip / knee, hanging along -Y) and feet (origin: ankle, extending along +Z)
  for (const [thigh, shin, foot] of [[P.thighL, P.shinL, P.footL], [P.thighR, P.shinR, P.footR]] as const) {
    b.loft(thigh, 'y', hi
      ? [pole(-0.47), R(-0.42, 0.052, SLOT.lowerLeg), R(-0.27, 0.064, SLOT.lowerLeg), R(-0.27, 0.064, SLOT.upperLeg), R(-0.15, 0.078, SLOT.upperLeg), R(0.0, 0.085, SLOT.upperLeg), pole(0.085)]
      : [pole(-0.47), R(-0.27, 0.064, SLOT.lowerLeg), R(-0.27, 0.064, SLOT.upperLeg), R(0.0, 0.085, SLOT.upperLeg), pole(0.085)], d.limbSeg, SLOT.upperLeg)
    b.loft(shin, 'y', hi
      ? [pole(-0.42), R(-0.34, 0.034), R(-0.16, 0.047), R(-0.03, 0.05), R(0.0, 0.049), pole(0.04)]
      : [pole(-0.42), R(-0.38, 0.032), R(-0.12, 0.049), pole(0.04)], d.thinSeg, SLOT.lowerLeg)
    b.loft(foot, 'z', hi
      ? [{ t: -0.078, rx: 0, rz: 0, cz: -0.03 }, { t: -0.065, rx: 0.03, rz: 0.04, cz: -0.032 }, { t: -0.01, rx: 0.04, rz: 0.05, cz: -0.026 }, { t: 0.08, rx: 0.046, rz: 0.044, cz: -0.031 }, { t: 0.15, rx: 0.046, rz: 0.032, cz: -0.043 }, { t: 0.2, rx: 0.035, rz: 0.024, cz: -0.051 }, { t: 0.225, rx: 0, rz: 0, cz: -0.052 }]
      : [{ t: -0.078, rx: 0, rz: 0, cz: -0.03 }, { t: 0.0, rx: 0.04, rz: 0.05, cz: -0.026 }, { t: 0.15, rx: 0.046, rz: 0.032, cz: -0.043 }, { t: 0.225, rx: 0, rz: 0, cz: -0.052 }], d.footSeg, SLOT.shoes, [0, 0, 0], (sn) => (sn < -0.7 ? fixedSlot(FX.sole) : SLOT.shoes))
  }

  // ---- skirt (origin: pelvis centre)
  b.loft(P.skirt, 'y', [R(-0.38, 0.24, undefined, 0.23), R(-0.1, 0.19, undefined, 0.14), R(0.07, 0.15, undefined, 0.098), pole(0.09)], d.torsoSeg, SLOT.coat)

  return b
}

/** The far figure: legs, torso, head as stacked prisms, all in part 0. Root frame, feet at y = 0, nominal 1.745 m. */
function buildFar(): Builder {
  const b = new Builder()
  b.loft(0, 'y', [
    { t: 0.0, rx: 0, rz: 0 },
    { t: 0.0, rx: 0.15, rz: 0.1, slot: SLOT.lowerLeg },
    { t: 0.5, rx: 0.15, rz: 0.085, slot: SLOT.lowerLeg },
    { t: 0.5, rx: 0.15, rz: 0.085, slot: SLOT.coat },
    { t: 0.93, rx: 0.18, rz: 0.1, slot: SLOT.coat },
    { t: 0.93, rx: 0.2, rz: 0.1, slot: SLOT.top },
    { t: 1.42, rx: 0.215, rz: 0.11, slot: SLOT.top },
    { t: 1.47, rx: 0.07, rz: 0.06, slot: SLOT.top },
    { t: 1.47, rx: 0.07, rz: 0.06, slot: SLOT.skin },
    { t: 1.6, rx: 0.09, rz: 0.095, slot: SLOT.skin },
    { t: 1.6, rx: 0.09, rz: 0.095, slot: SLOT.hair },
    { t: 1.75, rx: 0, rz: 0, slot: SLOT.hair },
  ], 5, SLOT.top)
  return b
}

export interface BodyGeometries {
  high: InstancedBufferGeometry
  mid: InstancedBufferGeometry
  far: InstancedBufferGeometry
  triangles: { high: number; mid: number; far: number }
}

function instanced(b: Builder): InstancedBufferGeometry {
  const src = b.build()
  const g = new InstancedBufferGeometry()
  g.index = src.index
  g.setAttribute('position', src.getAttribute('position'))
  g.setAttribute('normal', src.getAttribute('normal'))
  g.setAttribute('aPart', src.getAttribute('aPart'))
  g.instanceCount = 0
  return g
}

export function buildBodyGeometries(): BodyGeometries {
  const hi = buildBody(HIGH)
  const mid = buildBody(MID)
  const far = buildFar()
  return { high: instanced(hi), mid: instanced(mid), far: instanced(far), triangles: { high: hi.triangles, mid: mid.triangles, far: far.triangles } }
}
