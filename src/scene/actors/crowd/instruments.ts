/**
 * R5: the instruments the theatre team holds, one merged instanced mesh drawn with the crowd's SHARED props material (no program of its own): every kind of
 * instrumentTable.ts INSTRUMENT_NAMES in one vertex buffer, an instance shows one kind (the props shader collapses the others), and it rides the frame of the
 * hand that holds it (aKind = kind + INSTRUMENT_HAND x hand: 1 the right hand's P.prop, 2 the left's P.propL, shaders.ts GEAR_VERT).
 *
 * Every shape is modelled at real size around its GRIP POINT (the origin), its tip along -Y (instrumentTable.ts: the rig points -Y along the tip axis), the
 * thumb side +Z. Moving parts carry a tag in `aPart.x` (kind + MOVING_TAG) and follow the instance's 0..1 parameter (`aOff`): a syringe's plunger slides
 * home along -Y, a grasper's or a clip applier's jaws and the bag of a bag-valve mask squeeze towards the axis, scissors spread. Clean colours only: steel,
 * clear and blue plastics, white, a pale green bag; nothing red (no blood anywhere in the hospital).
 */
import { BufferGeometry, InstancedBufferGeometry } from 'three'
import { FX, INSTRUMENT_FIRST, fixedSlot } from './constants'
import { Builder, type Ring } from './geometry'
import { INSTRUMENT, INSTRUMENT_COUNT, INSTRUMENT_NAMES, MOVING_TAG, SLIDE_TRAVEL, type InstrumentName } from './instrumentTable'

const F = (i: number): number => fixedSlot(i)
const STEEL = F(FX.steel)
const DARK = F(FX.steelDark)
const BLUE = F(FX.plasticBlue)
const CLEAR = F(FX.clear)
const WHITE = F(FX.cupWhite)
const BLACK = F(FX.rubber)
const GREEN = F(FX.bagGreen)
const PAPER = F(FX.paper)

type V3 = readonly [number, number, number]

const pole = (t: number, cx = 0, cz = 0): Ring => ({ t, rx: 0, rz: 0, cx, cz })
const R = (t: number, rx: number, rz = rx, cx = 0, cz = 0): Ring => ({ t, rx, rz, cx, cz })

/**
 * A tube of `sides` facets along a polyline (each point with its own radius), open or capped at the ends. The ring frames are carried along the line
 * (parallel transport) so it does not twist.
 */
function tube(b: Builder, part: number, slot: number, pts: readonly V3[], radius: number | readonly number[], sides: number, caps = false): void {
  const rows: number[][] = []
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const c = pts[Math.min(pts.length - 1, i + 1)]
    let tx = c[0] - a[0]
    let ty = c[1] - a[1]
    let tz = c[2] - a[2]
    const tl = Math.hypot(tx, ty, tz) || 1
    tx /= tl
    ty /= tl
    tz /= tl
    if (i === 0) {
      // any vector across the first tangent
      const ax = Math.abs(tx) < 0.9 ? 1 : 0
      const ay = ax ? 0 : 1
      nx = ay * tz - 0 * ty
      ny = 0 * tx - ax * tz
      nz = ax * ty - ay * tx
    }
    // carry the normal: remove its tangent part
    const d = nx * tx + ny * ty + nz * tz
    nx -= d * tx
    ny -= d * ty
    nz -= d * tz
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl
    ny /= nl
    nz /= nl
    const bx = ty * nz - tz * ny
    const by = tz * nx - tx * nz
    const bz = tx * ny - ty * nx
    const r = typeof radius === 'number' ? radius : radius[i]
    const row: number[] = []
    for (let j = 0; j < sides; j++) {
      const th = (j / sides) * Math.PI * 2
      const cs = Math.cos(th) * r
      const sn = Math.sin(th) * r
      row.push(b.vertex(pts[i][0] + nx * cs + bx * sn, pts[i][1] + ny * cs + by * sn, pts[i][2] + nz * cs + bz * sn, part, slot))
    }
    rows.push(row)
  }
  for (let i = 0; i + 1 < rows.length; i++) {
    const p = pts[i]
    const q = pts[i + 1]
    const ox = (p[0] + q[0]) / 2
    const oy = (p[1] + q[1]) / 2
    const oz = (p[2] + q[2]) / 2
    for (let j = 0; j < sides; j++) {
      const k = (j + 1) % sides
      b.tri(rows[i][j], rows[i][k], rows[i + 1][j], ox, oy, oz)
      b.tri(rows[i][k], rows[i + 1][k], rows[i + 1][j], ox, oy, oz)
    }
  }
  if (caps) {
    for (const [ri, inward] of [
      [0, 1],
      [rows.length - 1, -1],
    ] as const) {
      const p = pts[ri]
      const q = pts[ri + inward]
      // the reference point is a little inside the tube, so the cap faces out of it
      const ox = p[0] + (q[0] - p[0]) * 0.5
      const oy = p[1] + (q[1] - p[1]) * 0.5
      const oz = p[2] + (q[2] - p[2]) * 0.5
      const row = rows[ri]
      for (let j = 1; j + 1 < sides; j++) b.tri(row[0], row[j], row[j + 1], ox, oy, oz)
    }
  }
}

/** A ring (torus) round the `axis` through `c`: a finger loop. */
function torus(b: Builder, part: number, slot: number, c: V3, major: number, minor: number, majorSeg: number, minorSeg: number, axis: 'x' | 'z'): void {
  const rows: number[][] = []
  const centres: V3[] = []
  for (let i = 0; i < majorSeg; i++) {
    const a = (i / majorSeg) * Math.PI * 2
    // the major circle in the plane across `axis`
    const ux = axis === 'x' ? 0 : Math.cos(a)
    const uy = Math.sin(a)
    const uz = axis === 'x' ? Math.cos(a) : 0
    const mc: V3 = [c[0] + ux * major, c[1] + uy * major, c[2] + uz * major]
    centres.push(mc)
    const ax = axis === 'x' ? 1 : 0
    const az = axis === 'z' ? 1 : 0
    const row: number[] = []
    for (let j = 0; j < minorSeg; j++) {
      const t = (j / minorSeg) * Math.PI * 2
      const cs = Math.cos(t) * minor
      const sn = Math.sin(t) * minor
      row.push(b.vertex(mc[0] + ux * cs + ax * sn, mc[1] + uy * cs, mc[2] + uz * cs + az * sn, part, slot))
    }
    rows.push(row)
  }
  for (let i = 0; i < majorSeg; i++) {
    const n = (i + 1) % majorSeg
    const ox = (centres[i][0] + centres[n][0]) / 2
    const oy = (centres[i][1] + centres[n][1]) / 2
    const oz = (centres[i][2] + centres[n][2]) / 2
    for (let j = 0; j < minorSeg; j++) {
      const k = (j + 1) % minorSeg
      b.tri(rows[i][j], rows[i][k], rows[n][j], ox, oy, oz)
      b.tri(rows[i][k], rows[n][k], rows[n][j], ox, oy, oz)
    }
  }
}

/** A box between two corners. */
function boxAB(b: Builder, part: number, slot: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  b.box(part, slot, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2])
}

const k = (n: InstrumentName): number => INSTRUMENT[n]
const moving = (n: InstrumentName, m: keyof typeof MOVING_TAG): number => INSTRUMENT[n] + MOVING_TAG[m]

// ---------------------------------------------------------------------------------------------
// The shapes (origin: the grip point; tip along -Y; thumb side +Z)
// ---------------------------------------------------------------------------------------------

function scalpel(b: Builder): void {
  const p = k('scalpel')
  b.loft(p, 'y', [pole(0.085), R(0.082, 0.0045, 0.003), R(-0.028, 0.004, 0.0028), pole(-0.031)], 4, STEEL)
  // the blade: thin, pointed, its edge on the -Z side
  b.loft(p, 'y', [R(-0.029, 0.0006, 0.0045, 0, -0.001), R(-0.055, 0.0006, 0.0042, 0, -0.0015), pole(-0.07, 0, 0.001)], 4, STEEL)
}

function forceps(b: Builder): void {
  for (const sx of [-1, 1]) {
    const p = moving('forceps', 'squeeze')
    b.loft(p, 'y', [pole(0.062, sx * 0.001), R(0.06, 0.0012, 0.0035, sx * 0.0012), R(-0.015, 0.0012, 0.0038, sx * 0.0045), R(-0.065, 0.001, 0.0015, sx * 0.0012), pole(-0.07, sx * 0.0008)], 4, STEEL)
  }
}

function needleHolder(b: Builder): void {
  const p = k('needleHolder')
  // finger loops behind the grip, shanks to a short jaw, the curved needle in it
  torus(b, p, STEEL, [0.013, 0.045, 0], 0.01, 0.0018, 6, 3, 'z')
  torus(b, p, STEEL, [-0.013, 0.045, 0], 0.01, 0.0018, 6, 3, 'z')
  tube(b, p, STEEL, [[0.009, 0.036, 0], [0.002, -0.02, 0], [0, -0.12, 0]], [0.0025, 0.0022, 0.0015], 4)
  tube(b, p, STEEL, [[-0.009, 0.036, 0], [-0.002, -0.02, 0], [0, -0.12, 0.001]], [0.0025, 0.0022, 0.0015], 4)
  const pts: V3[] = []
  for (let i = 0; i <= 5; i++) {
    const a = -0.3 + (i / 5) * Math.PI * 0.85
    pts.push([0.011 * Math.cos(a) - 0.002, -0.122 - 0.002 * i, 0.011 * Math.sin(a)])
  }
  tube(b, p, DARK, pts, 0.0007, 3)
}

function scissors(b: Builder): void {
  const p = k('scissors')
  torus(b, p, STEEL, [0.013, 0.04, 0], 0.01, 0.0018, 6, 3, 'z')
  torus(b, p, STEEL, [-0.013, 0.04, 0], 0.01, 0.0018, 6, 3, 'z')
  for (const sx of [-1, 1]) {
    const m = moving('scissors', 'spread')
    b.loft(m, 'y', [R(0.03, 0.0025, 0.002, sx * 0.008), R(0.0, 0.003, 0.002, sx * 0.001), R(-0.08, 0.0022, 0.0012, sx * 0.0012), pole(-0.11, sx * 0.0005)], 4, STEEL)
  }
}

function prepStick(b: Builder): void {
  const p = k('prepStick')
  torus(b, p, STEEL, [0, 0.03, 0.012], 0.01, 0.0018, 6, 2, 'x')
  torus(b, p, STEEL, [0, 0.03, -0.012], 0.01, 0.0018, 6, 2, 'x')
  tube(b, p, STEEL, [[0, 0.02, 0], [0, -0.185, 0]], 0.0025, 4)
  b.ellipsoid(p, PAPER, [0, -0.2, 0], [0.012, 0.016, 0.012], 8, 4)
}

function marker(b: Builder): void {
  b.loft(k('marker'), 'y', [pole(0.08), R(0.078, 0.0055, 0.0055, 0, 0), R(-0.045, 0.0055, 0.0055, 0, 0), R(-0.055, 0.002, 0.002, 0, 0), pole(-0.06)], 6, WHITE)
}

function veressNeedle(b: Builder): void {
  const p = k('veressNeedle')
  b.loft(p, 'y', [pole(0.035), R(0.03, 0.009, 0.009), R(-0.01, 0.009, 0.009), pole(-0.012)], 6, BLUE)
  tube(b, p, STEEL, [[0, -0.012, 0], [0, -0.14, 0]], 0.0011, 3)
}

function trocar(b: Builder, name: 'trocar8' | 'trocar12', r: number, cap: number, seg: number): void {
  const p = k(name)
  // the cap under the palm, the valve, the cannula
  b.loft(p, 'y', [pole(0.022), R(0.02, cap, cap * 0.85), R(-0.008, cap, cap * 0.85), pole(-0.01)], seg, BLUE)
  b.loft(p, 'y', [R(-0.01, r * 1.25, r * 1.25), R(-0.025, r, r), R(-0.11, r, r), R(-0.125, r * 0.5, r * 0.5), pole(name === 'trocar8' ? -0.13 : -0.15)], seg, name === 'trocar8' ? CLEAR : STEEL)
  boxAB(b, p, BLUE, -0.004, -0.004, cap * 0.8, 0.004, 0.004, cap * 0.8 + 0.014)
}

function laparoscope(b: Builder): void {
  const p = k('laparoscope')
  // the camera head in the hand, its cable out of the back, the light post, the long telescope
  b.loft(p, 'y', [pole(0.045), R(0.042, 0.017, 0.017), R(-0.018, 0.016, 0.016), pole(-0.02)], 8, BLACK)
  boxAB(b, p, DARK, -0.004, -0.032, 0.004, 0.004, -0.022, 0.026)
  b.loft(p, 'y', [R(-0.02, 0.0052, 0.0052), R(-0.355, 0.005, 0.005), pole(-0.36)], 8, STEEL)
  tube(b, p, BLACK, [[0, 0.045, 0], [0, 0.07, -0.01], [0, 0.085, -0.04]], 0.004, 4)
}

/** A laparoscopic hand instrument: a pistol handle with a finger loop, a rotation knob, the shaft and its tip. */
function lapHandle(b: Builder, p: number, slot: number): void {
  boxAB(b, p, slot, -0.008, -0.01, -0.03, 0.008, 0.03, 0.012)
  torus(b, p, slot, [0, -0.005, -0.045], 0.012, 0.002, 6, 2, 'x')
  b.loft(p, 'y', [R(0.0, 0.008, 0.008, 0, 0.02), R(-0.012, 0.008, 0.008, 0, 0.02)], 6, slot)
}

function lapGrasper(b: Builder): void {
  const p = k('lapGrasper')
  lapHandle(b, p, BLUE)
  tube(b, p, DARK, [[0, -0.012, 0.02], [0, -0.31, 0.02]], 0.0027, 6)
  for (const sx of [-1, 1]) b.loft(moving('lapGrasper', 'squeeze'), 'y', [R(-0.31, 0.0016, 0.0022, sx * 0.0018, 0.02), R(-0.33, 0.0012, 0.0016, sx * 0.0016, 0.02), pole(-0.335, sx * 0.001, 0.02)], 4, STEEL)
}

function lapSuction(b: Builder): void {
  const p = k('lapSuction')
  boxAB(b, p, WHITE, -0.008, -0.012, -0.025, 0.008, 0.035, 0.012)
  for (const z of [-0.005, 0.01]) b.loft(p, 'y', [pole(0.048, 0, z), R(0.045, 0.005, 0.005, 0, z), R(0.035, 0.005, 0.005, 0, z)], 6, BLUE)
  tube(b, p, STEEL, [[0, -0.012, 0.02], [0, -0.33, 0.02]], 0.0028, 6)
  tube(b, p, CLEAR, [[0, 0.03, -0.022], [0, 0.06, -0.04], [0, 0.09, -0.05]], 0.003, 4)
}

function lapClipApplier(b: Builder): void {
  const p = k('lapClipApplier')
  lapHandle(b, p, DARK)
  boxAB(b, moving('lapClipApplier', 'squeeze'), BLUE, -0.005, -0.02, -0.05, 0.005, 0.012, -0.03)
  tube(b, p, STEEL, [[0, -0.012, 0.02], [0, -0.31, 0.02]], 0.0028, 6)
  for (const sx of [-1, 1]) b.loft(moving('lapClipApplier', 'squeeze'), 'y', [R(-0.31, 0.0018, 0.0025, sx * 0.002, 0.02), R(-0.33, 0.0012, 0.002, sx * 0.002, 0.02), pole(-0.334, sx * 0.0015, 0.02)], 4, STEEL)
}

function syringe(b: Builder): void {
  const p = k('syringe')
  // the barrel (clear), its flange, the nozzle and needle; the plunger (white) slides home along -Y by SLIDE_TRAVEL x the parameter
  b.loft(p, 'y', [R(0.042, 0.0085, 0.0085), R(-0.03, 0.0085, 0.0085), R(-0.036, 0.003, 0.003), R(-0.044, 0.002, 0.002), pole(-0.046)], 6, CLEAR)
  boxAB(b, p, CLEAR, -0.016, 0.04, -0.004, 0.016, 0.044, 0.004)
  const m = moving('syringe', 'slide')
  const top = 0.042 + SLIDE_TRAVEL
  boxAB(b, m, WHITE, -0.0012, -0.028, -0.006, 0.0012, top, 0.006)
  boxAB(b, m, WHITE, -0.006, -0.028, -0.0012, 0.006, top, 0.0012)
  b.loft(m, 'y', [pole(top + 0.004), R(top + 0.0035, 0.01, 0.01), R(top, 0.01, 0.01), pole(top - 0.0005)], 6, WHITE)
  tube(b, p, STEEL, [[0, -0.046, 0], [0, -0.08, 0]], 0.0005, 3)
}

function laryngoscope(b: Builder): void {
  const p = k('laryngoscope')
  // the knurled handle in the fist along the axis, the blade from its lower end curving forward to the tip, its light
  b.loft(p, 'y', [pole(0.08), R(0.078, 0.014, 0.014), R(-0.028, 0.014, 0.014), pole(-0.03)], 8, STEEL)
  const pts: V3[] = []
  for (let i = 0; i <= 4; i++) {
    const t = i / 4
    pts.push([0, -0.03 - 0.09 * t, 0.012 + 0.03 * Math.sin(t * Math.PI * 0.6)])
  }
  tube(b, p, STEEL, pts, [0.009, 0.008, 0.007, 0.006, 0.004], 4)
  b.ellipsoid(p, WHITE, [0, -0.1, 0.02], [0.003, 0.003, 0.003], 4, 2)
}

function breathingTube(b: Builder): void {
  const p = k('breathingTube')
  // the curved tube (its tip down the trachea at -Y), the 15 mm connector at the top, a pilot line
  const pts: V3[] = []
  for (let i = 0; i <= 6; i++) {
    const t = i / 6
    pts.push([0, 0.06 - 0.2 * t, -0.03 * Math.sin(t * Math.PI)])
  }
  tube(b, p, CLEAR, pts, 0.0045, 6)
  b.loft(p, 'y', [R(0.06, 0.0075, 0.0075), R(0.085, 0.0075, 0.0075), pole(0.086)], 6, BLUE)
}

function bagValveMask(b: Builder): void {
  const p = k('bagValveMask')
  // the mask's cup (its opening at -Y, over the face), the valve, the bag towards the holder (+Z), squeezed by the parameter
  b.loft(p, 'y', [R(0, 0.05, 0.042), R(0.022, 0.04, 0.034), R(0.035, 0.016, 0.016), pole(0.038)], 10, CLEAR)
  b.loft(p, 'y', [R(0.035, 0.009, 0.009), R(0.07, 0.009, 0.009)], 8, BLUE)
  b.loft(p, 'z', [R(0.0, 0.012, 0.012, 0, 0.07), R(0.06, 0.012, 0.012, 0, 0.07)], 8, BLUE)
  b.ellipsoid(moving('bagValveMask', 'squeeze'), GREEN, [0, 0.07, 0.17], [0.055, 0.055, 0.11], 10, 5)
}

function oxygenMask(b: Builder): void {
  const p = k('oxygenMask')
  b.loft(p, 'y', [R(0, 0.05, 0.04), R(0.022, 0.04, 0.032), R(0.035, 0.014, 0.014), pole(0.038)], 10, CLEAR)
  tube(b, p, CLEAR, [[0, 0.03, 0.01], [0, 0.05, 0.05], [0, 0.06, 0.12]], 0.004, 4)
}

function cryoNeedle(b: Builder): void {
  const p = k('cryoNeedle')
  b.loft(p, 'y', [pole(0.045), R(0.042, 0.007, 0.007), R(-0.018, 0.007, 0.007), pole(-0.02)], 6, WHITE)
  tube(b, p, STEEL, [[0, -0.02, 0], [0, -0.165, 0]], 0.0009, 4)
  b.loft(p, 'y', [R(-0.165, 0.0009, 0.0009), pole(-0.17)], 4, STEEL)
  tube(b, p, CLEAR, [[0, 0.045, 0], [0, 0.07, -0.02], [0, 0.08, -0.06]], 0.0025, 4)
}

function retrievalBag(b: Builder): void {
  const p = k('retrievalBag')
  b.loft(p, 'y', [pole(0.04), R(0.037, 0.01, 0.01), R(0.02, 0.01, 0.01), pole(0.018)], 6, BLUE)
  tube(b, p, CLEAR, [[0, 0.02, 0], [0, -0.24, 0]], 0.005, 6)
  b.ellipsoid(p, GREEN, [0, -0.25, 0], [0.012, 0.02, 0.008], 6, 3)
}

function gauze(b: Builder): void {
  boxAB(b, k('gauze'), PAPER, -0.04, -0.008, -0.04, 0.04, -0.002, 0.04)
}

function dressing(b: Builder): void {
  boxAB(b, k('dressing'), WHITE, -0.035, -0.006, -0.05, 0.035, -0.002, 0.05)
}

function skinGlue(b: Builder): void {
  b.loft(k('skinGlue'), 'y', [pole(0.07), R(0.068, 0.005, 0.005), R(-0.04, 0.005, 0.005), R(-0.055, 0.002, 0.002), pole(-0.06)], 6, BLUE)
}

function scrubBrush(b: Builder): void {
  const p = k('scrubBrush')
  boxAB(b, p, BLUE, -0.004, -0.012, -0.04, 0.012, 0.012, 0.04)
  boxAB(b, p, WHITE, -0.016, -0.011, -0.037, -0.004, 0.011, 0.037)
}

function tableRemote(b: Builder): void {
  const p = k('tableRemote')
  boxAB(b, p, WHITE, -0.012, -0.03, -0.075, 0.004, 0.03, 0.075)
  boxAB(b, p, BLUE, -0.0145, -0.02, -0.05, -0.012, 0.02, 0.04)
}

function robotInstrument(b: Builder): void {
  const p = k('robotInstrument')
  boxAB(b, p, WHITE, -0.02, -0.02, -0.03, 0.02, 0.06, 0.03)
  tube(b, p, DARK, [[0, -0.02, 0], [0, -0.39, 0]], 0.004, 6)
  boxAB(b, p, STEEL, -0.003, -0.41, -0.003, 0.003, -0.39, 0.003)
}

function specimenPot(b: Builder): void {
  b.loft(k('specimenPot'), 'y', [pole(-0.03), R(-0.03, 0.03, 0.03), R(0.045, 0.031, 0.031), pole(0.045)], 6, WHITE)
}

function iceBag(b: Builder): void {
  b.ellipsoid(k('iceBag'), CLEAR, [0, -0.02, 0], [0.05, 0.02, 0.07], 6, 3)
}

const BUILDERS: Readonly<Record<InstrumentName, (b: Builder) => void>> = {
  scalpel,
  forceps,
  needleHolder,
  scissors,
  prepStick,
  marker,
  veressNeedle,
  trocar8: (b) => trocar(b, 'trocar8', 0.0045, 0.022, 8),
  trocar12: (b) => trocar(b, 'trocar12', 0.0068, 0.026, 10),
  laparoscope,
  lapGrasper,
  lapSuction,
  lapClipApplier,
  syringe,
  laryngoscope,
  breathingTube,
  bagValveMask,
  oxygenMask,
  cryoNeedle,
  retrievalBag,
  gauze,
  dressing,
  skinGlue,
  scrubBrush,
  tableRemote,
  robotInstrument,
  specimenPot,
  iceBag,
}

export interface InstrumentGeometry {
  geometry: InstancedBufferGeometry
  /** Triangles of each instrument, by name. */
  triangles: Record<InstrumentName, number>
  total: number
}

/** Triangles of each instrument shape (each built on a scratch builder). */
export function instrumentTriangles(): Record<InstrumentName, number> {
  const out = {} as Record<InstrumentName, number>
  for (const n of INSTRUMENT_NAMES) {
    const b = new Builder()
    BUILDERS[n](b)
    out[n] = b.triangles
  }
  return out
}

/** Build one shape on its own (tests): its builder. */
export function buildInstrument(name: InstrumentName): Builder {
  const b = new Builder()
  BUILDERS[name](b)
  return b
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

/** Every instrument in one merged geometry (the instruments mesh of crowdRig.ts). */
export function buildInstrumentGeometry(): InstrumentGeometry {
  const b = new Builder()
  for (const n of INSTRUMENT_NAMES) BUILDERS[n](b)
  return { geometry: toInstanced(b.build()), triangles: instrumentTriangles(), total: b.triangles }
}

/** The kinds this file builds, first to last (a check for the shader's kind range). */
export const INSTRUMENT_RANGE = { first: INSTRUMENT_FIRST, count: INSTRUMENT_COUNT } as const
