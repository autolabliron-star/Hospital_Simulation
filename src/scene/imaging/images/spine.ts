/**
 * Lumbar spine for MRI (and any other lumbar view): a sagittal series from one side (z = 0) through the midline (z = 0.5) to the
 * other, and an axial series from L1 (z = 0) to the L5/S1 level (z = 1). Like the brain, every call emits the same list of shapes (those
 * not at this level shrink to nothing or fade), so neighbouring slices differ smoothly.
 * Convention: x right, y down. Sagittal: anterior on the left, head at the top. Axial: anterior at the top, patient's right on the left.
 */
import { curve, ell, line, lerp, poly, rrect, smooth, variation, type Prim, type SliceModel } from './shapes'

// vertebral levels T12, L1..L5 (index 0..5) and the sacrum (6): centre height, body depth (AP) and the lordotic x of the body centre
const LEVEL_Y = [-0.78, -0.55, -0.32, -0.09, 0.14, 0.37]
const LEVEL_X = [-0.03, -0.075, -0.115, -0.135, -0.125, -0.075, 0.02]
const BODY_H = 0.165
const DISC_H = 0.058
const bodyDepth = (i: number): number => 0.2 + 0.013 * i

/** Sagittal spine: z 0..1 across the body, 0.5 the midline. */
export function lumbarSagittal(seed: number, z: number): SliceModel {
  const v = variation(seed)
  const p = v.phase
  const L = Math.abs(2 * z - 1)
  const mb = 1 - smooth(0.26, 0.42, L) // the vertebral column and canal (midline)
  const lat = 1 - mb // pedicles, foramina, facets
  const prims: Prim[] = []

  // the trunk: skin and fat all round, the back muscles behind the spine, the abdomen in front of it
  const band = (x0: number, x1: number, amp: number, ph: number): number[] => {
    const out: number[] = []
    for (let i = 0; i <= 12; i++) out.push(x0 + amp * Math.sin(i * 0.9 + ph), -1.15 + (2.3 * i) / 12)
    for (let i = 12; i >= 0; i--) out.push(x1 + amp * Math.sin(i * 1.1 + ph + 1), -1.15 + (2.3 * i) / 12)
    return out
  }
  prims.push(poly('fat', rrect(0, 0, 1.64, 2.3, 0.4)))
  prims.push(poly('muscle', band(0.16, 0.7, 0.025, p[0])))
  for (const [x, ph] of [[0.3, 0.2], [0.46, 1.4], [0.6, 2.2]] as const) prims.push(line('fat', curve((t) => [x + 0.02 * Math.sin(t * 5 + ph + p[1]), -1.1 + 2.2 * t], 8), 0.012, 0.55 * (1 - 0.0))) // fascial planes
  prims.push(poly('organ', band(-0.62, -0.12, 0.03, p[2]), 0.95)) // the abdominal contents
  prims.push(poly('muscle', band(-0.7, -0.62, 0.012, p[3]), 1)) // the abdominal wall
  for (let k = 0; k < 7; k++) {
    const y = -0.95 + 0.3 * k + 0.05 * Math.sin(p[k % 8])
    prims.push(ell('fat', -0.4 + 0.07 * Math.sin(p[(k + 2) % 8] + z * 4), y, 0.1 + 0.04 * Math.sin(p[k % 8] * 2), 0.06, 0.4 * Math.sin(p[k % 8])))
  }
  for (let k = 0; k < 4; k++) {
    const y = -0.8 + 0.5 * k + 0.06 * Math.sin(p[k + 3])
    prims.push(ell('bowel', -0.34 + 0.04 * Math.sin(p[k] + z * 3), y, 0.1, 0.13 + 0.03 * Math.sin(p[k + 1])))
    prims.push(ell('csf', -0.34 + 0.04 * Math.sin(p[k] + z * 3), y, 0.05, 0.06, 0, 0.5 * mb))
    prims.push(ell('air', -0.37 + 0.04 * Math.sin(p[k] + z * 3), y - 0.05, 0.03, 0.025, 0, 0.9 * mb))
  }
  // psoas and the abdominal muscles flank the spine on the lateral slices
  prims.push(ell('muscle', 0.0, 0.1, 0.2 * lat, 0.95 * lat))

  // vertebral bodies and discs
  const degenerate = 3 + Math.floor(v.rand() * 2) // the level whose disc is a little dry
  for (let i = 0; i < 6; i++) {
    const y = LEVEL_Y[i]
    const x = LEVEL_X[i]
    const w = bodyDepth(i)
    const tilt = (LEVEL_X[i + 1] - LEVEL_X[i]) * 0.6
    prims.push(poly('bone', rrect(x, y, w + 0.018, BODY_H + 0.018, 0.04, tilt), mb))
    prims.push(poly('marrow', rrect(x, y, w - 0.004, BODY_H - 0.014, 0.034, tilt), mb))
    // the waist of the body: a concave anterior wall
    prims.push(ell('fat', x - w / 2 - 0.005, y, 0.012, 0.045, 0, 0.7 * mb))
    // disc below this level
    const yd = (y + (i < 5 ? LEVEL_Y[i + 1] : y + 0.23)) / 2
    const xd = (x + LEVEL_X[i + 1]) / 2
    const wd = Math.min(w, bodyDepth(Math.min(5, i + 1))) * 0.97
    const dry = i + 1 === degenerate ? 0.55 : 1
    prims.push(ell('annulus', xd, yd, wd / 2, DISC_H / 2, tilt, mb))
    prims.push(ell('disc', xd + 0.012, yd, wd * 0.34, DISC_H * 0.36, tilt, mb * dry))
    // neural foramen (fat in the lateral slices), pedicle and facet
    prims.push(ell('fat', x + w / 2 + 0.045, yd - 0.01, 0.045 * lat, 0.06 * lat, 0, lat))
    prims.push(ell('bone', x + w / 2 + 0.06, y - 0.01, 0.04 * lat, 0.055 * lat, 0, lat))
    prims.push(ell('marrow', x + w / 2 + 0.06, y - 0.01, 0.024 * lat, 0.035 * lat, 0, lat))
  }
  // the sacrum: from L5/S1 sweeping back
  const sx0 = LEVEL_X[6]
  const sacrum = curve((t) => [sx0 + 0.3 * t * t + 0.02 * t, 0.6 + 0.37 * t], 8)
  prims.push(line('bone', sacrum, 0.2, mb))
  prims.push(line('marrow', sacrum, 0.17, mb))
  prims.push(ell('annulus', (LEVEL_X[5] + sx0) / 2, 0.485, 0.12, DISC_H / 2, 0.15, mb))
  prims.push(ell('disc', (LEVEL_X[5] + sx0) / 2 + 0.01, 0.485, 0.075, DISC_H * 0.36, 0.15, mb * 0.6))

  // aorta and bowel loops in front of the column
  prims.push(line('vessel', [-0.27, -0.7, -0.22, -0.1, -0.16, 0.3], 0.03, 0.8 * mb))

  // canal behind the bodies: CSF, the cord ending in the conus, then the roots of the cauda equina
  const canalPts: number[] = []
  for (let i = 0; i < 6; i++) canalPts.push(LEVEL_X[i] + bodyDepth(i) / 2 + 0.1, LEVEL_Y[i] - (i === 0 ? 0.2 : 0))
  canalPts.push(0.12, 0.6, 0.22, 0.82)
  prims.push(line('fat', canalPts, 0.12, mb)) // epidural fat
  prims.push(line('csf', canalPts, 0.088, mb))
  const cordTop = [canalPts[0] - 0.005, -1, canalPts[2], -0.6, canalPts[4] - 0.003, -0.42]
  prims.push(line('cord', cordTop, 0.034, mb))
  prims.push(line('cord', [canalPts[4] - 0.003, -0.42, canalPts[4] + 0.004, -0.36], 0.014, mb))
  for (let k = 0; k < 4; k++) {
    const off = -0.028 + 0.019 * k + 0.004 * Math.sin(p[k])
    const pts: number[] = []
    for (let i = 2; i < canalPts.length / 2; i++) pts.push(canalPts[i * 2] + off, canalPts[i * 2 + 1])
    prims.push(line('cord', [canalPts[4] + off * 0.2, -0.38, ...pts], 0.007, 0.85 * mb))
  }

  // posterior elements: laminae and spinous processes (wedges pointing back and down)
  for (let i = 0; i < 6; i++) {
    const x = LEVEL_X[i] + bodyDepth(i) / 2 + 0.205
    const y = LEVEL_Y[i]
    prims.push(line('bone', [x - 0.075, y - 0.05, x, y], 0.05, mb))
    prims.push(poly('bone', [x - 0.02, y - 0.035, x + 0.15, y + 0.03, x + 0.17, y + 0.075, x + 0.05, y + 0.06, x - 0.02, y + 0.04], mb))
    prims.push(poly('marrow', [x, y - 0.012, x + 0.13, y + 0.035, x + 0.14, y + 0.058, x + 0.05, y + 0.045, x, y + 0.026], mb))
    prims.push(line('ligament', [x + 0.17, y + 0.07, x + 0.12, y + 0.17], 0.014, 0.8 * mb))
  }

  return { prims, marker: { text: 'A', x: -0.92, y: -0.9 } }
}

/** Axial lumbar spine: z 0 at L1 down to 1 at the L5/S1 disc. */
export function lumbarAxial(seed: number, z: number): SliceModel {
  const v = variation(seed)
  const p = v.phase
  const s = z * 4.6
  const u = s - Math.floor(s)
  const wb = smooth(0.0, 0.14, u) * (1 - smooth(0.58, 0.76, u)) // 1 through the body of a vertebra, 0 at the disc
  const wd = 1 - wb
  const kid = 1 - smooth(1.5, 2.6, s) // the kidneys, high up
  const liv = 1 - smooth(0.1, 1.2, s)
  const down = z // the psoas grows going down
  const prims: Prim[] = []

  // the trunk
  prims.push(ell('fat', 0, 0.05, 0.93, 0.68, v.tilt * 0.5))
  prims.push(ell('muscle', 0, 0.05, 0.84, 0.59, v.tilt * 0.5))
  prims.push(ell('fat', 0, -0.07, 0.74, 0.46)) // the abdominal cavity: mesentery fat
  prims.push(line('muscle', [-0.2, -0.62, -0.05, -0.64, 0.05, -0.64, 0.2, -0.62], 0.05)) // rectus

  // bowel and vessels in front of the column
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05 + p[k]
    prims.push(ell('bowel', 0.34 * Math.cos(a) * (0.6 + 0.4 * Math.sin(p[k + 1])), -0.15 + 0.24 * Math.sin(a), 0.11, 0.075 + 0.03 * Math.sin(p[k + 2] + z * 5), a))
    prims.push(ell('air', 0.34 * Math.cos(a) * (0.6 + 0.4 * Math.sin(p[k + 1])), -0.15 + 0.24 * Math.sin(a) - 0.02, 0.035, 0.022, a, 0.75))
  }
  prims.push(ell('bowel', -0.66, 0.08, 0.1, 0.13)) // ascending colon
  prims.push(ell('air', -0.66, 0.05, 0.04, 0.05, 0, 0.8))
  prims.push(ell('bowel', 0.66, 0.08, 0.09, 0.12)) // descending colon
  prims.push(ell('air', 0.66, 0.05, 0.035, 0.045, 0, 0.8))
  prims.push(ell('liver', -0.5, -0.02, 0.3 * liv, 0.28 * liv, 0.2))
  prims.push(ell('kidney', -0.47, 0.17, 0.15 * kid, 0.11 * kid, 0.3))
  prims.push(ell('fat', -0.47, 0.17, 0.045 * kid, 0.04 * kid, 0.3))
  prims.push(ell('kidney', 0.47, 0.17, 0.15 * kid, 0.11 * kid, -0.3))
  prims.push(ell('fat', 0.47, 0.17, 0.045 * kid, 0.04 * kid, -0.3))
  prims.push(ell('vein', -0.11, 0.0, 0.07, 0.04, 0.2)) // IVC
  prims.push(ell('vessel', 0.06 - 0.05 * smooth(3.6, 4.4, s), 0.0, 0.052, 0.052)) // aorta (and the iliac vessels)
  prims.push(ell('vessel', 0.17 * smooth(3.6, 4.4, s), 0.0, 0.04 * smooth(3.6, 4.4, s), 0.04 * smooth(3.6, 4.4, s)))

  // psoas, quadratus lumborum, erector spinae and multifidus
  for (const sg of [-1, 1]) {
    prims.push(ell('muscle', sg * 0.3, 0.1, lerp(0.07, 0.15, down), lerp(0.08, 0.13, down), sg * 0.15))
    prims.push(ell('muscle', sg * 0.4, 0.3, 0.06, 0.13, -sg * 0.3))
    prims.push(ell('muscle', sg * 0.24, 0.46, 0.15, 0.13, sg * 0.2))
    prims.push(ell('muscle', sg * 0.07, 0.49, 0.06, 0.09))
    prims.push(ell('fat', sg * 0.24, 0.46, 0.012, 0.09, 0, 0.7)) // fascial plane
  }

  // the vertebra: body (or disc), pedicles, canal, laminae, spinous and transverse processes, facets
  prims.push(poly('bone', rrect(0, 0.1, 0.4, 0.29, 0.1), wb))
  prims.push(poly('marrow', rrect(0, 0.1, 0.36, 0.25, 0.09), wb))
  prims.push(poly('annulus', rrect(0, 0.1, 0.4, 0.29, 0.1), wd))
  prims.push(ell('disc', 0, 0.1, 0.105, 0.065, 0, wd * (0.9 + 0.1 * Math.sin(p[0]))))
  prims.push(ell('bone', 0, 0.35, 0.145 * (0.6 + 0.4 * wb) + 0.01, 0.125)) // the bony ring round the canal
  prims.push(ell('fat', 0, 0.35, 0.115, 0.1))
  prims.push(ell('csf', 0, 0.355, 0.092, 0.078)) // the thecal sac
  for (let k = 0; k < 8; k++) {
    const a = 0.3 + (k / 7) * (Math.PI - 0.6) + 0.1 * Math.sin(p[k])
    prims.push(ell('cord', 0.055 * Math.cos(a), 0.37 + 0.035 * Math.sin(a), 0.012, 0.012)) // cauda equina roots
  }
  prims.push(ell('csf', 0, 0.33, 0.04 * kid, 0.04 * kid)) // the conus, high up
  for (const sg of [-1, 1]) {
    prims.push(line('bone', [sg * 0.17, 0.2, sg * 0.15, 0.31], 0.05, wb)) // pedicle
    prims.push(line('bone', [sg * 0.15, 0.31, sg * 0.13, 0.42, 0, 0.5], 0.04)) // lamina
    prims.push(line('bone', [sg * 0.17, 0.36, sg * 0.45, 0.3], 0.042, wb)) // transverse process
    prims.push(ell('fat', sg * 0.2, 0.28, 0.03, 0.05, 0, 0.9 * wd)) // neural foramen
    prims.push(ell('bone', sg * 0.2, 0.43, 0.05, 0.04, sg * 0.5)) // facet joint
    prims.push(ell('marrow', sg * 0.2, 0.43, 0.03, 0.022, sg * 0.5))
    prims.push(ell('csf', sg * 0.185, 0.425, 0.007, 0.03, 0.2, 0.9)) // joint fluid
  }
  prims.push(line('bone', [0, 0.46, 0, 0.7], 0.06))
  prims.push(line('marrow', [0, 0.47, 0, 0.67], 0.03))
  prims.push(line('ligament', [0, 0.7, 0, 0.78], 0.02, 0.8))

  return { prims, marker: { text: 'R', x: -0.9, y: 0.1 } }
}
