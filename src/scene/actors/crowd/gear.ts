/**
 * Geometry of the things people hold and push: written new for the hospital (the Waltz crowd only had a folder and a phone).
 *
 * Two merged meshes, each holding every kind it draws; a vertex carries its kind (`aPart.x`) and a colour slot (`aPart.y`, the
 * same slot table as the bodies: 0..13 the carrier's palette, 14 and up the fixed colours). A draw shows one kind per instance:
 * the vertex stage collapses the vertices of every other kind (gear shader in shaders.ts), so one draw call serves them all.
 *
 *   props     tablet, folder, tray, coffee cup, bag, flowers, and the cleaner's mop. Frame: the part matrix `P.prop` of the carrier's
 *             pose row (the rig puts it at the right hand), geometry authored upright around the grip. W3 wave B: the player's "You" badge
 *             (BADGE_KIND) is built on its own (buildBadgeGeometry); its frame is BADGE_FRAME (on the realistic coat's chest, model.ts). R2: so is
 *             the surgical cap of a realistic person in theatre scrubs (CAP_KIND, buildCapGeometry); its frame is CAP_FRAME (fitted on the skull).
 *   blankets  The cover of a patient in a bed (PROP.blanket, buildBlanketGeometry). A lying patient holds nothing, so the rig puts the blanket in
 *             their prop frame, on the mattress under the hips (rig.ts). It has a mesh of its own, like the badge: with the other props in one
 *             geometry every held item in the crowd (a hundred or more) would also pay for its 270 triangles.
 *   vehicles  wheelchair, stretcher, cleaning cart, linen cart. Frame: the pusher's root (feet on the floor, facing +Z) moved
 *             `VEHICLE_AHEAD[kind]` forward. The origin is where a rider's hips are.
 *
 * Wheels are static (the vehicles roll without turning their wheels) and every vehicle's push handle is at HANDLE (pose.ts) in the
 * pusher's frame, so the pusher's hands meet it.
 */
import { BufferGeometry, InstancedBufferGeometry } from 'three'
import { BADGE_KIND, CAP_KIND, FX, LIE, PROP, PROP_COUNT, VEHICLE, VEHICLE_AHEAD, fixedSlot, SLOT } from './constants'
import { MADE_BLANKET } from '@/scene/rooms/bedParts'
import { capRadius, capRim } from './avatars'
import { Builder } from './geometry'
import { HANDLE } from './pose'

const F = (i: number): number => fixedSlot(i)

/** A cylinder whose axis is X: a wheel. Tyre slot on the tread, hub slot on both faces. */
function wheel(b: Builder, part: number, tyre: number, hub: number, cx: number, cy: number, cz: number, r: number, w: number, seg: number): void {
  const hw = w / 2
  const ring: number[][] = []
  for (let j = 0; j < seg; j++) {
    const th = (j / seg) * Math.PI * 2
    ring.push([cy + r * Math.cos(th), cz + r * Math.sin(th)])
  }
  for (let j = 0; j < seg; j++) {
    const k = (j + 1) % seg
    const a0 = b.vertex(cx - hw, ring[j][0], ring[j][1], part, tyre)
    const a1 = b.vertex(cx + hw, ring[j][0], ring[j][1], part, tyre)
    const b0 = b.vertex(cx - hw, ring[k][0], ring[k][1], part, tyre)
    const b1 = b.vertex(cx + hw, ring[k][0], ring[k][1], part, tyre)
    b.tri(a0, a1, b0, cx, cy, cz)
    b.tri(a1, b1, b0, cx, cy, cz)
    // both sides: a full-radius sidewall fan in the tyre colour and a smaller hub disc just proud of it
    for (const side of [-1, 1]) {
      const x = cx + side * hw
      const c0 = b.vertex(x, cy, cz, part, tyre)
      const p0 = b.vertex(x, ring[j][0], ring[j][1], part, tyre)
      const p1 = b.vertex(x, ring[k][0], ring[k][1], part, tyre)
      // faces away from the wheel's centre, so outwards along its axis
      b.tri(c0, p0, p1, cx, cy, cz)
      const xh = x + side * 0.002
      const h0 = b.vertex(xh, cy, cz, part, hub)
      const h1 = b.vertex(xh, cy + (ring[j][0] - cy) * 0.6, cz + (ring[j][1] - cz) * 0.6, part, hub)
      const h2 = b.vertex(xh, cy + (ring[k][0] - cy) * 0.6, cz + (ring[k][1] - cz) * 0.6, part, hub)
      b.tri(h0, h1, h2, cx, cy, cz)
    }
  }
}

/** A box between two corners (x0 y0 z0) and (x1 y1 z1). */
function boxAB(b: Builder, part: number, slot: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  b.box(part, slot, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2])
}

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

function tablet(b: Builder): void {
  const k = PROP.tablet
  b.box(k, F(FX.tabletBody), [0, 0, 0], [0.12, 0.085, 0.006])
  // the screen faces the holder (-Z)
  const z = -0.0064
  b.quad(k, F(FX.tabletScreen), [[-0.108, -0.073, z], [-0.108, 0.073, z], [0.108, 0.073, z], [0.108, -0.073, z]], [0, 0, 1])
}

function folder(b: Builder): void {
  const k = PROP.folder
  // hangs from the hand: the grip is the top edge, the cover faces sideways
  b.box(k, SLOT.gear, [0, -0.15, 0], [0.007, 0.155, 0.115])
  b.box(k, F(FX.paper), [0.004, 0.0, 0.0], [0.006, 0.04, 0.095])
}

function tray(b: Builder): void {
  const k = PROP.tray
  const g = F(FX.trayGrey)
  b.box(k, g, [0, 0, 0], [0.19, 0.006, 0.13])
  b.box(k, g, [0, 0.014, 0.124], [0.19, 0.014, 0.006])
  b.box(k, g, [0, 0.014, -0.124], [0.19, 0.014, 0.006])
  b.box(k, g, [0.184, 0.014, 0], [0.006, 0.014, 0.124])
  b.box(k, g, [-0.184, 0.014, 0], [0.006, 0.014, 0.124])
  // two cups and a blister pack, so it reads as the medicine round
  for (const x of [-0.09, -0.02]) {
    b.loft(k, 'y', [{ t: 0, rx: 0.026, rz: 0.026 }, { t: 0.05, rx: 0.03, rz: 0.03 }, { t: 0.05, rx: 0, rz: 0 }], 7, F(FX.cupWhite), [x, 0.012, 0.02])
  }
  b.box(k, SLOT.gear, [0.1, 0.017, -0.03], [0.05, 0.008, 0.07])
}

function cup(b: Builder): void {
  const k = PROP.cup
  b.loft(k, 'y', [{ t: -0.05, rx: 0.0, rz: 0.0 }, { t: -0.05, rx: 0.024, rz: 0.024 }, { t: -0.01, rx: 0.029, rz: 0.029, slot: F(FX.coffee) }, { t: 0.02, rx: 0.033, rz: 0.033, slot: F(FX.coffee) }, { t: 0.02, rx: 0.034, rz: 0.034, slot: F(FX.cupWhite) }, { t: 0.045, rx: 0.036, rz: 0.036, slot: F(FX.cupWhite) }, { t: 0.052, rx: 0.037, rz: 0.037, slot: F(FX.coffee) }, { t: 0.058, rx: 0, rz: 0 }], 8, F(FX.cupWhite))
}

function bag(b: Builder): void {
  const k = PROP.bag
  b.box(k, SLOT.gear, [0, -0.2, 0], [0.06, 0.15, 0.17])
  // two handles meeting at the grip
  b.box(k, F(FX.rubber), [0, 0.0, 0.07], [0.006, 0.05, 0.006])
  b.box(k, F(FX.rubber), [0, 0.0, -0.07], [0.006, 0.05, 0.006])
  b.box(k, F(FX.rubber), [0, 0.05, 0.0], [0.006, 0.006, 0.076])
}

function flowers(b: Builder): void {
  const k = PROP.flowers
  // paper cone, stems, and a cluster of blossoms
  b.loft(k, 'y', [{ t: -0.1, rx: 0, rz: 0 }, { t: -0.1, rx: 0.012, rz: 0.012 }, { t: 0.06, rx: 0.07, rz: 0.07 }, { t: 0.06, rx: 0, rz: 0 }], 7, F(FX.paper))
  b.loft(k, 'y', [{ t: 0.06, rx: 0, rz: 0 }, { t: 0.06, rx: 0.028, rz: 0.028 }, { t: 0.15, rx: 0.02, rz: 0.02 }, { t: 0.15, rx: 0, rz: 0 }], 5, F(FX.stem))
  const blossoms: [number, number, number, number][] = [
    [0, 0.19, 0, SLOT.gear],
    [0.045, 0.165, 0.02, F(FX.cartYellow)],
    [-0.045, 0.165, 0.025, SLOT.gear],
    [0.015, 0.16, -0.045, F(FX.cartYellow)],
    [-0.02, 0.17, -0.03, SLOT.gear],
  ]
  for (const [x, y, z, slot] of blossoms) b.ellipsoid(k, slot, [x, y, z], [0.034, 0.03, 0.034], 6, 3)
}

function mop(b: Builder): void {
  const k = PROP.mop
  // origin: the floor point under the mop head; the pole runs up +Y
  b.loft(k, 'y', [{ t: 0.03, rx: 0.011, rz: 0.011 }, { t: 1.56, rx: 0.011, rz: 0.011 }, { t: 1.56, rx: 0, rz: 0 }], 6, F(FX.mopPole))
  b.box(k, F(FX.rubber), [0, 0.045, 0], [0.16, 0.012, 0.035])
  b.box(k, F(FX.mopHead), [0, 0.02, 0], [0.17, 0.02, 0.05])
}

/**
 * W3 wave B: the player's gold "You" badge, pinned on the realistic avatar's coat (the frame BADGE_FRAME: origin on the cloth at the wearer's left
 * chest, +Z out of the chest, +Y up). A gold card (the person's badge colour), a dark band across its top and a dark "Y", in metres.
 */
function badge(b: Builder): void {
  const k = BADGE_KIND
  const ink = F(FX.youInk)
  const out: [number, number, number] = [0, 0, -1]
  b.box(k, SLOT.badge, [0, -0.012, 0.0016], [0.031, 0.044, 0.0016])
  const z = 0.0034
  b.quad(k, ink, [[-0.031, 0.02, z], [0.031, 0.02, z], [0.031, 0.032, z], [-0.031, 0.032, z]], out)
  // the "Y": two arms meeting above a stem
  const t = 0.0045
  b.quad(k, ink, [[-0.017, 0.012, z], [-0.017 + t * 1.6, 0.012, z], [t * 0.5, -0.01, z], [-t * 0.5, -0.01, z]], out)
  b.quad(k, ink, [[0.017 - t * 1.6, 0.012, z], [0.017, 0.012, z], [t * 0.5, -0.01, z], [-t * 0.5, -0.01, z]], out)
  b.quad(k, ink, [[-t * 0.5, -0.01, z], [t * 0.5, -0.01, z], [t * 0.5, -0.04, z], [-t * 0.5, -0.04, z]], out)
}

// ---------------------------------------------------------------------------------------------
// The blanket of a patient in a bed (PROP.blanket)
// ---------------------------------------------------------------------------------------------

/**
 * The blanket over a patient lying in a ward bed, an ER trolley or on a stretcher: from the feet to about the chest, thick enough to hide the shoes and the
 * trousers of the thickest avatar, with a soft top a little above its legs and hips, whatever the mattress under it (the body rests in the mattress, so the
 * blanket is cut to the body, not to the bed). Its frame is the lying body's own: origin on the mattress top under the hips, x across the bed, y up,
 * z from the head towards the feet, scaled with the person (rig.ts puts it in the prop frame of a covered lying patient).
 *
 * `top` is the height of its skin above the mattress along the body, in metres at nominal size: over the hips and thighs, the knees (the highest point), the
 * dip of the shins and the feet. Every value is 2 to 4 cm above the highest leg, foot or hip vertex of any avatar there, flat and with the bed head
 * raised (tools/people-bed.test.ts checks it on the real meshes, at the smallest and the largest size). The cross-section is a superellipse (`halfWidth`,
 * exponent `n`: flatter than an ellipse, so the top is broad over both legs and the sides fall to the mattress). The over-bed table stands above it
 * (bedParts.ts OVERBED).
 */
export const BLANKET = {
  halfWidth: 0.4,
  n: 3,
  /** The base plane lies this far below the mattress top, so the blanket meets the mattress at a clean line rather than a coplanar one. */
  sink: 0.012,
  /** The head end (the chest) and the foot end. The head end is rounded to nothing, the foot end is a flat wall (the toes reach 0.98 m). */
  zHead: -0.3,
  zFoot: 1.0,
  /** Where the white turn-down fold at the top ends and the teal blanket begins. */
  zFold: -0.13,
  /** [z, height] stations from the end of the rounded head end to the feet. */
  top: [
    [-0.06, 0.38],
    [0.02, 0.41],
    [0.1, 0.43],
    [0.22, 0.42],
    [0.3, 0.43],
    [0.42, 0.435],
    [0.5, 0.445],
    [0.54, 0.44],
    [0.58, 0.4],
    [0.62, 0.315],
    [0.7, 0.285],
    [0.78, 0.27],
    [0.82, 0.31],
    [0.86, 0.335],
    [0.9, 0.34],
    [1.0, 0.325],
  ],
} as const

/** Sides of a half cross-section of the blanket (from one side up over the top to the other). */
const BLANKET_SEG = 8
/** Rings of the rounded head end, as the fraction `u` of its length from the first station (1 is the tip). */
const BLANKET_CAP = [1, 0.86, 0.62, 0.32, 0] as const

/** Half width and top height of the blanket's cross-section at z (the rounded head end shrinks to a point), or null outside it. */
export function blanketSection(z: number): { w: number; h: number } | null {
  const t = BLANKET.top
  if (z < BLANKET.zHead || z > BLANKET.zFoot) return null
  if (z < t[0][0]) {
    const u = (t[0][0] - z) / (t[0][0] - BLANKET.zHead)
    const k = Math.sqrt(Math.max(0, 1 - u * u))
    return { w: BLANKET.halfWidth * Math.pow(k, 0.6), h: t[0][1] * k }
  }
  let i = 0
  while (i < t.length - 2 && t[i + 1][0] < z) i++
  const a = t[i]
  const c = t[Math.min(i + 1, t.length - 1)]
  const f = z >= c[0] ? 1 : (z - a[0]) / (c[0] - a[0])
  return { w: BLANKET.halfWidth, h: a[1] + (c[1] - a[1]) * f }
}

/** A point of the half cross-section: x across, y above the base plane, at angle `th` from one side (0) over the top (PI / 2) to the other (PI). */
function sectionPoint(w: number, h: number, th: number): [number, number] {
  const c = Math.cos(th)
  const sn = Math.sin(th)
  const e = 2 / BLANKET.n
  return [w * Math.sign(c) * Math.pow(Math.abs(c), e), h * Math.pow(Math.max(0, sn), e)]
}

function blanket(b: Builder): void {
  const k = PROP.blanket
  const teal = F(FX.fabricTeal)
  const fold = F(FX.linen)
  // the rings: the head end's, then one at each station; the fold ends in a duplicate ring so the colour changes at a crisp line
  const rings: { z: number; w: number; h: number; slot: number; dup?: boolean }[] = []
  const first = BLANKET.top[0][0]
  for (const u of BLANKET_CAP) {
    const z = first - u * (first - BLANKET.zHead)
    const sec = blanketSection(Math.min(Math.max(z, BLANKET.zHead), first))!
    rings.push({ z, w: u === 1 ? 0 : sec.w, h: u === 1 ? 0 : sec.h, slot: z < BLANKET.zFold ? fold : teal })
  }
  for (const [z, h] of BLANKET.top.slice(1)) rings.push({ z, w: BLANKET.halfWidth, h, slot: teal })
  // the fold's colour edge: a duplicate of the ring at zFold in teal, between the two cap rings around it
  const foldEdge = blanketSection(BLANKET.zFold)!
  const at = rings.findIndex((r) => r.z > BLANKET.zFold)
  rings.splice(at, 0, { z: BLANKET.zFold, w: foldEdge.w, h: foldEdge.h, slot: fold }, { z: BLANKET.zFold, w: foldEdge.w, h: foldEdge.h, slot: teal, dup: true })
  const rows: number[][] = []
  for (const r of rings) {
    const row: number[] = []
    if (r.w === 0 && r.h === 0) row.push(b.vertex(0, -BLANKET.sink, r.z, k, r.slot))
    else {
      for (let j = 0; j <= BLANKET_SEG; j++) {
        const [x, y] = sectionPoint(r.w, r.h, (j / BLANKET_SEG) * Math.PI)
        row.push(b.vertex(x, y - BLANKET.sink, r.z, k, r.slot))
      }
    }
    rows.push(row)
  }
  for (let i = 0; i + 1 < rows.length; i++) {
    if (rings[i + 1].dup) continue
    const A = rows[i]
    const B = rows[i + 1]
    const oz = (rings[i].z + rings[i + 1].z) / 2
    for (let j = 0; j < BLANKET_SEG; j++) {
      if (A.length === 1) b.tri(A[0], B[j + 1], B[j], 0, -0.3, oz)
      else if (B.length === 1) b.tri(A[j], A[j + 1], B[0], 0, -0.3, oz)
      else {
        b.tri(A[j], A[j + 1], B[j], 0, -0.3, oz)
        b.tri(A[j + 1], B[j + 1], B[j], 0, -0.3, oz)
      }
    }
  }
  // the foot end: a flat wall, a fan from the middle of the base
  const end = rows[rows.length - 1]
  const centre = b.vertex(0, -BLANKET.sink, BLANKET.zFoot, k, teal)
  for (let j = 0; j < BLANKET_SEG; j++) b.tri(centre, end[j], end[j + 1], 0, 0, BLANKET.zFoot - 1)
}

/** R2: facets round the theatre cap and bands from its rim to its crown. */
export const CAP_SEG = 18
export const CAP_RINGS = 7

/**
 * R2: the surgical cap of a realistic person in theatre scrubs (kind CAP_KIND), in the unit space of their skull: the cap frame (model.ts, CAP_FRAME) maps
 * the unit sphere onto the avatar's fitted skull (avatars.ts measureCapFit, padded so the hair stays inside). A dome from a rim that rides above the brows
 * and down the nape (avatars.ts capRim) to the crown, a little squarer than a sphere as a head is and puffed out at the back (capRadius), its first band
 * tucked in a little like the elastic of a real bouffant cap. The hair colour slot: in theatre it is the cap's pale blue (outfit.ts).
 */
function theatreCap(b: Builder): void {
  const k = CAP_KIND
  const rows: number[][] = []
  for (let i = 0; i < CAP_RINGS; i++) {
    const row: number[] = []
    for (let j = 0; j < CAP_SEG; j++) {
      const th = (j / CAP_SEG) * Math.PI * 2
      // x = cos(th) (the wearer's left), z = sin(th) (forward)
      const fwd = Math.sin(th)
      const rim = capRim(fwd)
      const lat = rim + ((Math.PI / 2 - rim) * i) / CAP_RINGS
      const r = capRadius(fwd, lat) * (i === 0 ? 0.975 : 1)
      const cl = Math.cos(lat) * r
      row.push(b.vertex(cl * Math.cos(th), Math.sin(lat) * r, cl * fwd, k, SLOT.hair))
    }
    rows.push(row)
  }
  const pole = b.vertex(0, capRadius(0, Math.PI / 2), 0, k, SLOT.hair)
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j < CAP_SEG; j++) {
      const n = (j + 1) % CAP_SEG
      b.tri(rows[i][j], rows[i][n], rows[i + 1][j], 0, 0, 0)
      b.tri(rows[i][n], rows[i + 1][n], rows[i + 1][j], 0, 0, 0)
    }
  }
  const top = rows[rows.length - 1]
  for (let j = 0; j < CAP_SEG; j++) b.tri(top[j], top[(j + 1) % CAP_SEG], pole, 0, 0, 0)
}

export interface GearGeometry {
  geometry: InstancedBufferGeometry
  /** Triangles of each kind, indexed by kind (0 unused). */
  triangles: number[]
  total: number
}

function toInstanced(src: BufferGeometry): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry()
  g.index = src.index
  g.setAttribute('position', src.getAttribute('position'))
  g.setAttribute('normal', src.getAttribute('normal'))
  g.setAttribute('aPart', src.getAttribute('aPart'))
  g.instanceCount = 0
  return g
}

/** Count the triangles of each kind by building them one at a time on a scratch builder. */
function perKind(builders: Array<(b: Builder) => void>, kinds: number): number[] {
  const out = new Array<number>(kinds).fill(0)
  for (const fn of builders) {
    const b = new Builder()
    fn(b)
    // the kind is the first vertex's part
    const kind = b.part[0]
    out[kind] += b.triangles
  }
  return out
}

const PROP_BUILDERS = [tablet, folder, tray, cup, bag, flowers, mop]

export function buildPropGeometry(): GearGeometry {
  const b = new Builder()
  for (const fn of PROP_BUILDERS) fn(b)
  return { geometry: toInstanced(b.build()), triangles: perKind(PROP_BUILDERS, PROP_COUNT), total: b.triangles }
}

/** W3 wave B: the blanket of a patient in a bed, on its own (kind PROP.blanket), for the blanket mesh of the crowd (crowdRig.ts), drawn once per covered patient. */
export function buildBlanketGeometry(): GearGeometry {
  const b = new Builder()
  blanket(b)
  return { geometry: toInstanced(b.build()), triangles: perKind([blanket], PROP_COUNT), total: b.triangles }
}

/** W3 wave B: the player's "You" badge on its own (kind BADGE_KIND), for the badge mesh of the realistic people (crowdRig.ts attachPeople). */
export function buildBadgeGeometry(): GearGeometry {
  const b = new Builder()
  badge(b)
  return { geometry: toInstanced(b.build()), triangles: perKind([badge], BADGE_KIND + 1), total: b.triangles }
}

/** R2: the theatre cap on its own (kind CAP_KIND), for the cap mesh of the realistic people (crowdRig.ts attachPeople). */
export function buildCapGeometry(): GearGeometry {
  const b = new Builder()
  theatreCap(b)
  return { geometry: toInstanced(b.build()), triangles: perKind([theatreCap], CAP_KIND + 1), total: b.triangles }
}

// ---------------------------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------------------------

/** z of the push handle in a vehicle's own frame (the pusher's hands are at HANDLE.ahead from the pusher). */
export const handleZ = (kind: number): number => HANDLE.ahead - VEHICLE_AHEAD[kind]

function handleBar(b: Builder, k: number, zH: number, width: number, slot: number): void {
  boxAB(b, k, slot, -width, HANDLE.y - 0.012, zH - 0.012, width, HANDLE.y + 0.012, zH + 0.012)
}

function wheelchair(b: Builder): void {
  const k = VEHICLE.wheelchair
  const rubber = F(FX.rubber)
  const frame = F(FX.metalLight)
  const dark = F(FX.metalDark)
  const zH = handleZ(k)
  // seat, back (dark upholstery reads against the pale floors). The rider's hips are the origin: the back rest is just behind their back.
  b.box(k, rubber, [0, 0.485, 0.05], [0.225, 0.02, 0.2])
  b.box(k, rubber, [0, 0.72, -0.14], [0.225, 0.2, 0.012])
  // frame: side tubes, armrests, legs and footplates
  for (const sx of [-1, 1]) {
    b.box(k, frame, [sx * 0.235, 0.43, 0.04], [0.01, 0.01, 0.26])
    b.box(k, frame, [sx * 0.25, 0.64, 0.02], [0.012, 0.01, 0.17])
    b.box(k, frame, [sx * 0.25, 0.56, 0.1], [0.01, 0.07, 0.01])
    b.box(k, frame, [sx * 0.2, 0.25, 0.3], [0.01, 0.18, 0.01])
    b.box(k, dark, [sx * 0.12, 0.17, 0.42], [0.07, 0.008, 0.07])
    // handle post from the back rest to the grip, then the grip bar going back
    boxAB(b, k, frame, sx * HANDLE.half - 0.012, 0.78, -0.176, sx * HANDLE.half + 0.012, HANDLE.y + 0.012, -0.152)
    boxAB(b, k, frame, sx * HANDLE.half - 0.012, HANDLE.y - 0.012, zH, sx * HANDLE.half + 0.012, HANDLE.y + 0.012, -0.152)
    // wheels: big rear, small front casters
    wheel(b, k, rubber, frame, sx * 0.3, 0.31, -0.05, 0.31, 0.03, 14)
    wheel(b, k, rubber, dark, sx * 0.2, 0.075, 0.33, 0.075, 0.03, 8)
  }
  handleBar(b, k, zH, HANDLE.half + 0.012, rubber)
}

function stretcher(b: Builder): void {
  const k = VEHICLE.stretcher
  const frame = F(FX.metalLight)
  const dark = F(FX.metalDark)
  const zH = handleZ(k)
  // platform, mattress (top at LIE.stretcher = 0.79: a rider lies in it, the back sunk a few cm), pillow, and a made bed's blanket lying flat on the
  // mattress (a patient on the stretcher is covered by the crowd's own blanket, PROP.blanket, which stands well above this one)
  const top = LIE.stretcher
  b.box(k, frame, [0, top - 0.13, 0], [0.34, 0.02, 0.93])
  b.box(k, F(FX.linen), [0, top - 0.045, 0], [0.34, 0.045, 0.92])
  b.box(k, F(FX.linen), [0, top + 0.025, -0.68], [0.22, 0.045, 0.15])
  b.box(k, F(FX.fabricTeal), [0, top + MADE_BLANKET / 2, 0.55], [0.33, MADE_BLANKET / 2, 0.4])
  // column, base, side rails
  b.box(k, dark, [0, 0.35, 0], [0.12, 0.28, 0.45])
  b.box(k, dark, [0, 0.12, 0], [0.3, 0.03, 0.66])
  for (const sx of [-1, 1]) {
    b.box(k, frame, [sx * 0.37, 0.86, -0.15], [0.012, 0.06, 0.42])
    b.box(k, frame, [sx * 0.37, 0.7, 0], [0.012, 0.02, 0.9])
    // head-end handle posts
    boxAB(b, k, frame, sx * HANDLE.half - 0.012, 0.7, zH - 0.012, sx * HANDLE.half + 0.012, HANDLE.y + 0.012, zH + 0.012)
    for (const sz of [-1, 1]) wheel(b, k, F(FX.rubber), dark, sx * 0.26, 0.09, sz * 0.62, 0.09, 0.04, 8)
  }
  handleBar(b, k, zH, HANDLE.half + 0.012, F(FX.rubber))
}

function cleaningCart(b: Builder): void {
  const k = VEHICLE.cleaningCart
  const frame = F(FX.metalLight)
  const zH = handleZ(k)
  b.box(k, F(FX.cartYellow), [0, 0.2, 0], [0.27, 0.03, 0.42])
  b.box(k, F(FX.cartYellow), [0, 0.68, 0], [0.27, 0.025, 0.42])
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(k, frame, [sx * 0.255, 0.45, sz * 0.4], [0.012, 0.25, 0.012])
      wheel(b, k, F(FX.rubber), F(FX.metalDark), sx * 0.22, 0.06, sz * 0.35, 0.06, 0.03, 8)
    }
  }
  // the bucket, a bin bag and bottles on the shelves
  b.loft(k, 'y', [{ t: 0.23, rx: 0.1, rz: 0.1 }, { t: 0.48, rx: 0.125, rz: 0.125 }, { t: 0.48, rx: 0, rz: 0 }], 8, F(FX.bucketBlue), [-0.09, 0, 0.14])
  b.box(k, F(FX.rubber), [0.02, 0.45, -0.24], [0.17, 0.2, 0.1])
  b.box(k, F(FX.bucketBlue), [-0.12, 0.76, 0.1], [0.04, 0.07, 0.04])
  b.box(k, F(FX.linen), [0.0, 0.76, 0.1], [0.04, 0.07, 0.04])
  b.box(k, F(FX.cupWhite), [0.12, 0.76, 0.1], [0.04, 0.07, 0.04])
  // handle
  for (const sx of [-1, 1]) boxAB(b, k, frame, sx * HANDLE.half - 0.012, 0.7, zH - 0.012, sx * HANDLE.half + 0.012, HANDLE.y + 0.012, zH + 0.012)
  handleBar(b, k, zH, HANDLE.half + 0.012, frame)
}

function linenCart(b: Builder): void {
  const k = VEHICLE.linenCart
  const frame = F(FX.metalLight)
  const zH = handleZ(k)
  b.box(k, frame, [0, 0.2, 0], [0.3, 0.02, 0.43])
  // stacked linen, a sage cover strap and a lid
  b.box(k, F(FX.linen), [0, 0.5, 0], [0.28, 0.28, 0.4])
  b.box(k, F(FX.sage), [0, 0.62, 0], [0.288, 0.04, 0.408])
  b.box(k, F(FX.linen), [0, 0.8, 0.0], [0.26, 0.03, 0.38])
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(k, frame, [sx * 0.29, 0.5, sz * 0.41], [0.012, 0.3, 0.012])
      wheel(b, k, F(FX.rubber), F(FX.metalDark), sx * 0.25, 0.07, sz * 0.36, 0.07, 0.03, 8)
    }
  }
  for (const sx of [-1, 1]) boxAB(b, k, frame, sx * HANDLE.half - 0.012, 0.7, zH - 0.012, sx * HANDLE.half + 0.012, HANDLE.y + 0.012, zH + 0.012)
  handleBar(b, k, zH, HANDLE.half + 0.012, frame)
}

const VEHICLE_BUILDERS = [wheelchair, stretcher, cleaningCart, linenCart]

export function buildVehicleGeometry(): GearGeometry {
  const b = new Builder()
  for (const fn of VEHICLE_BUILDERS) fn(b)
  return { geometry: toInstanced(b.build()), triangles: perKind(VEHICLE_BUILDERS, 5), total: b.triangles }
}

/**
 * The footprint of each vehicle on the floor (half width, half length, centred on the vehicle's origin), for the blob shadow and for
 * tests. The stretcher is long: its shadow is a stretched blob.
 */
export const VEHICLE_FOOTPRINT: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.36, 0.5], // wheelchair incl. the footplates and the handles (handles are behind: the blob is centred a little back)
  [0.4, 1.05], // stretcher
  [0.33, 0.5], // cleaning cart
  [0.36, 0.5], // linen cart
]
