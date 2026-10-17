/**
 * Brain anatomy for MRI and CT, as pure shape models: axial slices from the skull base (z = 0) to the vertex (z = 1) and
 * sagittal slices from one side (z = 0) through the midline (z = 0.5) to the other. Every call emits the same list of
 * shapes (the ones that are not at this level shrink to nothing), so neighbouring slices differ smoothly.
 * Image convention: x right, y down, anterior at the top (axial) or left (sagittal).
 */
import { bump, curve, ell, line, poly, rrect, smooth, variation, wobble, type Prim, type SliceModel } from './shapes'

const SULCI = 32

export function brainAxial(seed: number, z: number, ct = false): SliceModel {
  const v = variation(seed)
  const p = v.phase
  const dome = z < 0.45 ? 0.86 + 0.14 * smooth(0, 1, z / 0.45) : Math.sqrt(Math.max(0, 1 - ((z - 0.45) / 0.58) ** 2))
  const s = dome * v.size
  const low = 1 - smooth(0.16, 0.34, z) // the skull base: brainstem, cerebellum, orbits
  const face = 1 - smooth(0.08, 0.26, z)
  const hy = 0.93 * s * (1 + 0.08 * face)
  const hcy = -0.07 * face * s
  const skullT = ct ? 0.075 : 0.05
  const prims: Prim[] = []

  // head: scalp, skull, the CSF space around the brain
  prims.push(ell('scalp', 0, hcy, 0.8 * s, hy, v.tilt))
  const bx = 0.745 * s
  const by = hy - 0.055
  prims.push(ell('bone', 0, hcy, bx, by, v.tilt))
  prims.push(ell('csf', 0, hcy, bx - skullT, by - skullT, v.tilt))

  // anterior skull base: facial bones with the orbits and the air cells (only near the base)
  prims.push(ell('bone', 0, hcy - 0.58 * s, 0.34 * face, 0.2 * face))
  prims.push(ell('csf', -0.32 * s, hcy - 0.78 * s, 0.11 * face, 0.11 * face))
  prims.push(ell('csf', 0.32 * s, hcy - 0.78 * s, 0.11 * face, 0.11 * face))
  prims.push(ell('air', 0, hcy - 0.56 * s, 0.11 * low, 0.08 * low))

  // the brain: cortex outline with gyri wiggles
  const rx = bx - skullT - 0.015
  const ry = by - skullT - 0.015
  const zz = z * 0.8
  const cortex = wobble(0, hcy, rx, ry, [[0.022, 13, p[0] + zz], [0.014, 21, p[1] + zz], [0.008, 34, p[2] + zz]], 96, v.tilt)
  prims.push(poly('gm', cortex))

  // sulci: short CSF-filled cracks running in from the surface
  const sul: number[][] = []
  for (let k = 0; k < SULCI; k++) {
    const a = ((k + 0.45 * Math.sin(k * 12.9898 + p[3])) / SULCI) * Math.PI * 2 + 0.05 * Math.sin(z * 9 + k)
    const len = (0.07 + 0.07 * (0.5 + 0.5 * Math.sin(k * 7.13 + p[4]))) * (0.85 + 0.15 * Math.sin(z * 5 + k * 2))
    const bend = 0.025 * Math.sin(k * 3.7 + p[5])
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const pts = [rx * 1.0 * ca, hcy + ry * 1.0 * sa, rx * (1 - len * 0.5) * ca + bend, hcy + ry * (1 - len * 0.5) * sa - bend, rx * (1 - len) * ca, hcy + ry * (1 - len) * sa]
    sul.push(pts)
  }
  for (const pts of sul) prims.push(line('csf', pts, 0.011, 0.9))

  // white matter
  const wmScale = 0.78 - 0.08 * low
  prims.push(poly('wm', wobble(0, hcy, rx * wmScale, ry * wmScale, [[0.06, 5, p[6] + zz], [0.04, 9, p[7] + zz], [0.025, 15, p[0]]], 80, v.tilt)))

  // deep grey matter and the ventricles
  const wd = bump(z, 0.28, 0.68)
  prims.push(ell('gm', -0.13, 0.04, 0.075 * wd, 0.12 * wd, 0.1))
  prims.push(ell('gm', 0.13, 0.04, 0.075 * wd, 0.12 * wd, -0.1))
  prims.push(ell('gm', -0.29, -0.02, 0.06 * wd, 0.11 * wd, 0.3))
  prims.push(ell('gm', 0.29, -0.02, 0.06 * wd, 0.11 * wd, -0.3))
  const wv = bump(z, 0.3, 0.84) * v.organ
  for (const sgn of [-1, 1]) {
    prims.push(ell('csf', sgn * 0.085, -0.25, 0.05 * wv, 0.13 * wv, -sgn * 0.25)) // frontal horn
    prims.push(ell('csf', sgn * 0.11, 0.0, 0.035 * wv, 0.15 * wv, 0)) // body
    prims.push(ell('csf', sgn * 0.17, 0.24, 0.06 * wv, 0.12 * wv, sgn * 0.35)) // atrium and occipital horn
  }
  prims.push(ell('csf', 0, 0.0, 0.012 * bump(z, 0.26, 0.52), 0.08 * bump(z, 0.26, 0.52)))
  // the falx and the corpus callosum that crosses it
  prims.push(line('csf', [0, hcy - ry * 0.98, 0, hcy + ry * 0.98], 0.011, 0.85 * smooth(0.08, 0.3, z)))
  prims.push(ell('wm', 0, -0.34, 0.1 * wv, 0.045 * wv))
  prims.push(ell('wm', 0, 0.34, 0.11 * wv, 0.06 * wv))

  // posterior fossa
  prims.push(ell('wm', 0, 0.1, 0.1 * low, 0.13 * low))
  prims.push(ell('csf', 0, 0.26, 0.04 * low, 0.025 * low))
  for (const sgn of [-1, 1]) {
    prims.push(ell('gm', sgn * 0.28, 0.46 * s, 0.27 * low, 0.2 * low, sgn * 0.3))
    prims.push(ell('wm', sgn * 0.28, 0.46 * s, 0.15 * low, 0.11 * low, sgn * 0.3))
    prims.push(ell('bone', sgn * 0.34, 0.17, 0.065 * low, 0.2 * low, -sgn * 0.5))
  }
  for (let k = 0; k < 6; k++) {
    const a = -0.9 + k * 0.36
    prims.push(line('csf', [0.28 * Math.sin(a * 0.4) + 0.1 * Math.cos(a), 0.55 * low + 0.1 * Math.sin(a), 0.28 * Math.sin(a * 0.4) + 0.2 * Math.cos(a), 0.55 * low + 0.12 * Math.sin(a) + 0.06 * low], 0.008 * low, 0.8))
  }
  return { prims, marker: { text: 'R', x: -0.9, y: 0 } }
}

export function brainSagittal(seed: number, z: number, ct = false): SliceModel {
  const v = variation(seed)
  const p = v.phase
  const L = Math.abs(2 * z - 1) // how far from the midline
  const m = 1 - smooth(0.12, 0.45, L) // midline structures
  const sh = Math.sqrt(1 - 0.78 * L * L) * v.size
  const skullT = ct ? 0.075 : 0.05
  const cx = 0.05
  const cy = -0.12
  const prims: Prim[] = []

  prims.push(ell('scalp', cx, cy, 0.8 * sh, 0.74 * sh, v.tilt))
  prims.push(ell('bone', cx, cy, 0.745 * sh, 0.685 * sh, v.tilt))
  prims.push(ell('csf', cx, cy, 0.745 * sh - skullT, 0.685 * sh - skullT, v.tilt))

  // face and neck (midline only)
  prims.push(poly('scalp', [-0.72, -0.05, -0.8, 0.22, -0.7, 0.5, -0.46, 0.64, -0.12, 0.7, 0.18, 0.62, 0.1, 0.3, -0.4, 0.1].map((q, i) => (i % 2 === 0 ? cx + (q - cx) * (0.55 + 0.45 * m) : q)), m))
  prims.push(ell('air', -0.52, 0.3, 0.13 * m, 0.05 * m, 0.45))
  prims.push(ell('air', -0.12, 0.22, 0.075 * m, 0.05 * m))
  prims.push(ell('muscle', -0.38, 0.53, 0.2 * m, 0.07 * m, 0.1))
  prims.push(line('bone', [-0.68, 0.38, -0.45, 0.62, -0.1, 0.66], 0.03 * m, m))

  // the brain
  const rx = 0.745 * sh - skullT - 0.015
  const ry = 0.685 * sh - skullT - 0.015
  const zz = z * 0.6
  prims.push(poly('gm', wobble(cx, cy, rx, ry, [[0.022, 13, p[0] + zz], [0.014, 21, p[1] + zz], [0.008, 34, p[2] + zz]], 96, v.tilt)))
  for (let k = 0; k < 26; k++) {
    const a = ((k + 0.4 * Math.sin(k * 12.9898 + p[3])) / 26) * Math.PI * 2
    const len = 0.07 + 0.06 * (0.5 + 0.5 * Math.sin(k * 7.13 + p[4]))
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    prims.push(line('csf', [cx + rx * ca, cy + ry * sa, cx + rx * (1 - len * 0.5) * ca + 0.02, cy + ry * (1 - len * 0.5) * sa, cx + rx * (1 - len) * ca, cy + ry * (1 - len) * sa], 0.011, 0.85))
  }
  prims.push(poly('wm', wobble(cx, cy, rx * 0.8, ry * 0.78, [[0.06, 5, p[6]], [0.04, 9, p[7]], [0.025, 15, p[0]]], 72, v.tilt)))

  // midline: corpus callosum, ventricle, thalamus, brainstem, cerebellum
  prims.push(line('wm', curve((t) => [cx - 0.36 + 0.74 * t, cy - 0.13 - 0.14 * Math.sin(Math.PI * t) + 0.04 * t], 14), 0.06 * m, m))
  prims.push(ell('csf', cx + 0.02, cy - 0.04, 0.3 * m, 0.04 * m, -0.05))
  prims.push(ell('gm', cx + 0.03, cy + 0.12, 0.1 * m, 0.085 * m))
  prims.push(line('wm', [-0.04, 0.0, 0.02, 0.28, 0.08, 0.5], 0.13 * m, m))
  prims.push(ell('csf', 0.22, 0.26, 0.03 * m, 0.05 * m, 0.4))
  const cb = 1 - 0.35 * smooth(0.5, 1, L)
  prims.push(ell('gm', 0.4, 0.27, 0.27 * sh * cb, 0.2 * sh * cb, -0.2))
  prims.push(ell('wm', 0.4, 0.27, 0.15 * sh * cb, 0.11 * sh * cb, -0.2))
  for (let k = 0; k < 5; k++) prims.push(line('csf', [0.25 + 0.05 * k, 0.15 + 0.03 * k, 0.4 + 0.05 * k, 0.28 + 0.03 * k], 0.008 * cb, 0.75))

  // cervical spine behind the brainstem
  for (let k = 0; k < 4; k++) {
    const y = 0.58 + 0.105 * k
    const x = 0.27 + 0.045 * k
    prims.push(poly('marrow', rrect(x, y, 0.1, 0.085, 0.02), m))
    prims.push(ell('disc', x, y + 0.055, 0.045 * m, 0.012 * m))
  }
  prims.push(line('csf', [0.35, 0.55, 0.42, 0.78, 0.46, 0.98], 0.05 * m, m))
  prims.push(line('cord', [0.35, 0.55, 0.42, 0.78, 0.46, 0.98], 0.022 * m, m))
  prims.push(line('bone', [0.4, 0.6, 0.5, 0.8, 0.55, 0.98], 0.014 * m, m))
  return { prims, marker: { text: 'A', x: -0.92, y: 0 } }
}
