/**
 * Geometry of the things people hold and push: written new for the hospital (the Waltz crowd only had a folder and a phone).
 *
 * Two merged meshes, each holding every kind it draws; a vertex carries its kind (`aPart.x`) and a colour slot (`aPart.y`, the
 * same slot table as the bodies: 0..13 the carrier's palette, 14 and up the fixed colours). A draw shows one kind per instance:
 * the vertex stage collapses the vertices of every other kind (gear shader in shaders.ts), so one draw call serves them all.
 *
 *   props     tablet, folder, tray, coffee cup, bag, flowers, and the cleaner's mop. Frame: the part matrix `P.prop` of the carrier's
 *             pose row (the rig puts it at the right hand), geometry authored upright around the grip.
 *   vehicles  wheelchair, stretcher, cleaning cart, linen cart. Frame: the pusher's root (feet on the floor, facing +Z) moved
 *             `VEHICLE_AHEAD[kind]` forward. The origin is where a rider's hips are.
 *
 * Wheels are static (the vehicles roll without turning their wheels) and every vehicle's push handle is at HANDLE (pose.ts) in the
 * pusher's frame, so the pusher's hands meet it.
 */
import { BufferGeometry, InstancedBufferGeometry } from 'three'
import { FX, PROP, VEHICLE, VEHICLE_AHEAD, fixedSlot, SLOT } from './constants'
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
  return { geometry: toInstanced(b.build()), triangles: perKind(PROP_BUILDERS, 8), total: b.triangles }
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
  // platform, mattress (top at 0.79: the back of a patient lying at the default 0.85 rests on it), pillow, blanket over the legs
  b.box(k, frame, [0, 0.66, 0], [0.34, 0.02, 0.93])
  b.box(k, F(FX.linen), [0, 0.745, 0], [0.34, 0.045, 0.92])
  b.box(k, F(FX.linen), [0, 0.815, -0.68], [0.22, 0.045, 0.15])
  b.box(k, F(FX.fabricTeal), [0, 0.885, 0.55], [0.33, 0.065, 0.4])
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
