/**
 * Axial CT of the chest (z 0 at the lung apex down to 1 at the diaphragm and upper abdomen) and of the abdomen and pelvis (z 0 at the
 * liver dome down to 1 at the bladder). Contrast phases come from the tones: the aorta is bright in the arterial phase, the veins and the
 * liver in the portal venous phase. Anterior at the top, the patient's right on the left, like every CT.
 */
import { mulberry32 } from '@/sim/rng'
import { bump, curve, ell, line, lerp, poly, rrect, smooth, variation, wobble, type Prim, type SliceModel, type Variation } from './shapes'

/** A vertebra seen from above at (cx, cy): body, canal with cord, arch, spinous process and transverse processes. */
function vertebra(prims: Prim[], cx: number, cy: number, k: number, ct = true): void {
  prims.push(poly('bone', rrect(cx, cy, 0.3 * k, 0.23 * k, 0.07 * k)))
  prims.push(poly('marrow', rrect(cx, cy, 0.25 * k, 0.18 * k, 0.06 * k)))
  const ay = cy + 0.2 * k
  prims.push(ell('bone', cx, ay, 0.11 * k, 0.1 * k))
  prims.push(ell('csf', cx, ay, 0.075 * k, 0.065 * k))
  prims.push(ell('cord', cx, ay, 0.04 * k, 0.035 * k))
  for (const sg of [-1, 1]) {
    prims.push(line('bone', [cx + sg * 0.12 * k, cy + 0.08 * k, cx + sg * 0.1 * k, ay], 0.04 * k))
    prims.push(line('bone', [cx + sg * 0.1 * k, ay + 0.04 * k, cx + sg * 0.2 * k, ay + 0.12 * k], 0.04 * k))
    prims.push(line('bone', [cx + sg * 0.14 * k, ay, cx + sg * 0.34 * k, ay - 0.03 * k], 0.04 * k))
  }
  prims.push(line('bone', [cx, ay + 0.08 * k, cx, ay + 0.3 * k], 0.05 * k))
  if (ct) prims.push(line('marrow', [cx, ay + 0.09 * k, cx, ay + 0.27 * k], 0.022 * k))
}

/** Branching pulmonary vessels (bright dots and short lines) in a lung centred at (cx, cy); deterministic and drifting with z. */
function lungVessels(prims: Prim[], side: number, z: number, scale: number, seedBase: number): void {
  const r = mulberry32(seedBase)
  const n = 22
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2
    const rad = 0.15 + 0.55 * Math.sqrt(r())
    const drift = 0.04 * Math.sin(z * 9 + i)
    const x = side * (0.38 + 0.3 * Math.cos(a) * rad) * scale + drift
    const y = -0.02 + 0.45 * Math.sin(a) * rad * scale + 0.03 * Math.cos(z * 7 + i)
    const sz = 0.011 + 0.016 * r() * (1 - rad * 0.5)
    prims.push(ell(i % 3 === 0 ? 'vein' : 'vessel', x, y, sz * 1.4, sz, a, 0.9 * (0.5 + 0.5 * Math.sin(z * 6 + i * 2.1) * 0.5 + 0.25)))
  }
  // the hilar branches fanning out from the mediastinum
  for (let k = 0; k < 3; k++) {
    const a = -0.7 + k * 0.7
    prims.push(line(k % 2 ? 'vein' : 'vessel', [side * 0.19, 0.02, side * (0.26 + 0.05 * k) * scale, 0.02 + 0.14 * Math.sin(a) * scale, side * (0.33 + 0.06 * k) * scale, 0.02 + 0.22 * Math.sin(a) * scale], 0.028, 0.9))
  }
}

export function chestAxial(seed: number, z: number): SliceModel {
  const v = variation(seed)
  const p = v.phase
  const lungS = 0.6 + 0.4 * smooth(0, 0.32, z)
  const heartW = smooth(0.34, 0.5, z) * (1 - smooth(0.9, 1.0, z) * 0.3)
  const dome = smooth(0.8, 0.98, z) // liver and stomach under the diaphragm
  const upper = 1 - smooth(0.22, 0.42, z) // trachea and arch
  const prims: Prim[] = []

  // the chest wall: skin, fat, muscle
  prims.push(ell('fat', 0, 0.0, 0.94, 0.72, v.tilt * 0.4))
  prims.push(ell('muscle', 0, 0.0, 0.88, 0.67, v.tilt * 0.4))
  // pectoral muscles in front, scapular muscles behind
  for (const sg of [-1, 1]) {
    prims.push(ell('muscle', sg * 0.55, -0.45, 0.2, 0.09, sg * 0.5, 1))
    prims.push(ell('fat', sg * 0.55, -0.45, 0.16, 0.025, sg * 0.5, 0.6))
  }
  // axillary fat, shoulder girdle in the upper slices
  for (const sg of [-1, 1]) {
    prims.push(line('bone', curve((t) => [sg * (0.78 - 0.1 * t), 0.12 + 0.34 * t + 0.1 * Math.sin(t * 3)], 6), 0.04, 0.9 * upper)) // scapula
    prims.push(line('bone', [sg * 0.35, -0.55, sg * 0.6, -0.5, sg * 0.78, -0.38], 0.03, 0.9 * upper)) // clavicle
  }

  // lungs, with the heart notch on the left (image right)
  for (const sg of [-1, 1]) {
    const wx = sg * 0.4 * lungS
    const rx = 0.36 * lungS * (sg < 0 ? 1.04 : 0.96)
    const ry = 0.5 * lungS
    prims.push(poly('lung', wobble(wx, -0.02, rx, ry, [[0.03, 4, p[sg < 0 ? 0 : 1]], [0.02, 7, p[2] + z * 3]], 56, sg * 0.12)))
    lungVessels(prims, sg, z, lungS, 0x1000 + (sg < 0 ? 1 : 2) + (v.rand() * 0 | 0))
  }
  // ribs round the chest wall (a tilted ring of small bones)
  for (let k = 0; k < 20; k++) {
    const a = ((k + 0.5) / 20) * Math.PI * 2
    if (Math.abs(Math.sin(a)) < 0.12 && Math.cos(a) < 0) continue // the sternum and spine take these places
    const rx = 0.8
    const ry = 0.6
    const x = rx * Math.cos(a)
    const y = ry * Math.sin(a)
    const rot = Math.atan2(ry * Math.cos(a), -rx * Math.sin(a))
    prims.push(ell('bone', x, y, 0.052, 0.027, rot, 1))
    prims.push(ell('marrow', x, y, 0.036, 0.014, rot, 1))
  }
  // sternum and the spine
  prims.push(poly('bone', rrect(0, -0.64, 0.2, 0.06, 0.02)))
  prims.push(poly('marrow', rrect(0, -0.64, 0.16, 0.036, 0.015)))
  vertebra(prims, 0, 0.37, 0.85)

  // mediastinum: fat, trachea and bronchi, oesophagus, great vessels, heart
  prims.push(ell('fat', 0, -0.03, 0.16 * (1 - 0.5 * heartW), 0.34, 0, 0.9))
  prims.push(ell('air', 0, 0.06, 0.055 * upper, 0.05 * upper, 0))
  const bro = smooth(0.28, 0.4, z) * (1 - smooth(0.46, 0.56, z))
  for (const sg of [-1, 1]) prims.push(ell('air', sg * 0.1, 0.1, 0.04 * bro, 0.036 * bro))
  prims.push(ell('organ', 0.02, 0.21, 0.04, 0.03)) // oesophagus
  prims.push(ell('vessel', 0.0 + 0.1 * upper, -0.16, 0.1 * (1 - upper) * (1 - heartW) + 0.0, 0.1 * (1 - upper) * (1 - heartW))) // ascending aorta
  prims.push(poly('vessel', wobble(0.1, -0.12, 0.2 * upper, 0.06 * upper, [], 18), 1)) // the arch
  prims.push(ell('vessel', 0.17, 0.27, 0.07, 0.065)) // descending aorta
  prims.push(ell('vein', -0.12, -0.14, 0.05 * (1 - heartW), 0.045 * (1 - heartW))) // superior vena cava
  prims.push(ell('vein', 0.06, -0.26 + 0.0, 0.1 * bump(z, 0.3, 0.52), 0.08 * bump(z, 0.3, 0.52))) // pulmonary trunk
  prims.push(ell('heart', 0.12, -0.1, 0.38 * heartW, 0.3 * heartW, -0.35))
  prims.push(ell('vessel', -0.02, -0.22, 0.13 * heartW, 0.085 * heartW, 0.2)) // right ventricle
  prims.push(ell('vessel', 0.2, -0.02, 0.15 * heartW, 0.1 * heartW, -0.55)) // left ventricle cavity
  prims.push(ell('heart', 0.2, -0.02, 0.07 * heartW, 0.05 * heartW, -0.55, 0.9)) // septum / myocardium
  prims.push(ell('vessel', -0.1, 0.0, 0.1 * heartW, 0.08 * heartW)) // right atrium
  prims.push(ell('vessel', 0.04, 0.14, 0.12 * heartW, 0.07 * heartW)) // left atrium

  // under the diaphragm
  prims.push(ell('liver', -0.36, 0.08, 0.5 * dome, 0.42 * dome, 0.1))
  prims.push(ell('organ', 0.4, 0.0, 0.2 * dome, 0.3 * dome, -0.3)) // stomach
  prims.push(ell('air', 0.38, -0.1, 0.08 * dome, 0.07 * dome, 0, 1))
  prims.push(ell('spleen', 0.58, 0.18, 0.12 * dome, 0.2 * dome, -0.2))
  prims.push(ell('vein', -0.1, 0.18, 0.06 * dome, 0.05 * dome)) // IVC

  return { prims, marker: { text: 'R', x: -0.92, y: 0 } }
}

export function abdomenAxial(seed: number, z: number): SliceModel {
  const v: Variation = variation(seed)
  const p = v.phase
  const liverW = 1 - smooth(0.5, 0.7, z)
  const gb = bump(z, 0.28, 0.66)
  const kid = bump(z, 0.14, 0.68)
  const panc = bump(z, 0.18, 0.5)
  const bow = smooth(0.38, 0.66, z)
  const pel = smooth(0.62, 0.92, z) // the pelvis: iliac bones, bladder
  const bif = smooth(0.7, 0.9, z) // the aorta splits into the iliac arteries
  const prims: Prim[] = []

  // the trunk: skin and fat, abdominal wall muscles, then the cavity with mesenteric fat
  prims.push(ell('fat', 0, 0.03, 0.94, 0.66, v.tilt * 0.4))
  prims.push(ell('muscle', 0, 0.03, 0.85, 0.57, v.tilt * 0.4))
  prims.push(ell('fat', 0, -0.06, 0.74, 0.45, v.tilt * 0.4))
  for (const sg of [-1, 1]) prims.push(ell('muscle', sg * 0.09, -0.585, 0.09, 0.04, 0)) // rectus abdominis
  prims.push(ell('fat', 0, -0.585, 0.008, 0.04))

  // liver (right = image left) with its vessels, and the gallbladder
  prims.push(ell('liver', -0.38, -0.12, 0.44 * liverW, 0.3 * liverW, 0.12))
  prims.push(ell('liver', 0.0, -0.3, 0.2 * liverW, 0.1 * liverW, 0.3)) // left lobe
  for (let k = 0; k < 5; k++) {
    const a = k * 0.9 + p[k]
    prims.push(ell('vein', -0.34 + 0.22 * Math.cos(a) * 0.9, -0.1 + 0.15 * Math.sin(a), 0.03 * liverW, 0.026 * liverW, a, 0.95))
  }
  prims.push(line('vein', [-0.12, -0.22, -0.3, -0.16, -0.5, -0.12], 0.026 * liverW, 0.9))
  prims.push(ell('csf', -0.17, -0.34, 0.06 * gb, 0.09 * gb, 0.3)) // gallbladder
  // stomach with gas, spleen, pancreas and the splenic vein
  prims.push(ell('organ', 0.34, -0.2, 0.2 * (1 - smooth(0.3, 0.55, z)), 0.15 * (1 - smooth(0.3, 0.55, z)), 0.3))
  prims.push(ell('air', 0.34, -0.28, 0.07 * (1 - smooth(0.3, 0.5, z)), 0.04 * (1 - smooth(0.3, 0.5, z))))
  prims.push(ell('spleen', 0.58, 0.14, 0.13 * (1 - smooth(0.2, 0.4, z)), 0.22 * (1 - smooth(0.2, 0.4, z)), -0.2))
  prims.push(line('organ', [-0.2, -0.1, 0.0, -0.06, 0.26, -0.02], 0.07 * panc, panc))
  prims.push(line('vein', [-0.02, -0.07, 0.2, -0.02], 0.016 * panc, panc))
  // kidneys: cortex, the fat of the renal sinus and a little urine in the pelvis
  for (const sg of [-1, 1]) {
    prims.push(ell('kidney', sg * 0.45, 0.2, 0.13 * kid, 0.17 * kid, sg * 0.35))
    prims.push(ell('fat', sg * 0.44, 0.2, 0.04 * kid, 0.07 * kid, sg * 0.35))
    prims.push(ell('csf', sg * 0.43, 0.2, 0.014 * kid, 0.03 * kid, sg * 0.35, 0.9))
  }
  // bowel: small-bowel loops (centre), colon (flanks), with gas and stool
  for (let k = 0; k < 9; k++) {
    const a = k * 0.8 + p[k % 8]
    const x = 0.36 * Math.cos(a) * (0.5 + 0.5 * Math.abs(Math.sin(p[(k + 1) % 8])))
    const y = -0.08 + 0.2 * Math.sin(a)
    prims.push(ell('bowel', x, y, 0.1 * bow, (0.07 + 0.02 * Math.sin(a * 2)) * bow, a))
    prims.push(ell('csf', x, y, 0.045 * bow, 0.025 * bow, a, 0.7))
  }
  prims.push(ell('bowel', -0.7, 0.04, 0.1, 0.12))
  prims.push(ell('air', -0.7, 0.0, 0.045, 0.05, 0, 0.85))
  prims.push(ell('bowel', 0.7, 0.04, 0.09, 0.11))
  prims.push(ell('air', 0.7, 0.0, 0.04, 0.045, 0, 0.85))
  prims.push(ell('bowel', -0.2, -0.46, 0.2 * smooth(0.35, 0.5, z), 0.05)) // transverse colon / sigmoid
  prims.push(ell('csf', 0, -0.1, 0.17 * pel, 0.13 * pel, 0, 1)) // bladder

  // muscles beside the spine, vertebra and the iliac bones in the pelvis
  for (const sg of [-1, 1]) {
    prims.push(ell('muscle', sg * 0.27, 0.27, lerp(0.07, 0.13, z), lerp(0.09, 0.13, z), sg * 0.1)) // psoas
    prims.push(ell('muscle', sg * 0.22, 0.46, 0.14, 0.12, sg * 0.2)) // erector spinae
    prims.push(ell('muscle', sg * 0.07, 0.48, 0.055, 0.08))
    prims.push(line('bone', curve((t) => [sg * (0.5 + 0.2 * t), 0.46 - 0.55 * t * t + 0.08 * t], 8), 0.12 * pel, pel))
    prims.push(line('marrow', curve((t) => [sg * (0.5 + 0.2 * t), 0.46 - 0.55 * t * t + 0.08 * t], 8), 0.085 * pel, pel))
  }
  vertebra(prims, 0, 0.3, 0.9 + 0.2 * pel)
  prims.push(ell('vein', -0.11 - 0.06 * bif, 0.14, 0.07 * (1 - 0.3 * bif), 0.045)) // IVC (and the iliac veins)
  prims.push(ell('vessel', 0.05 - 0.07 * bif, 0.14, 0.05 * (1 - 0.3 * bif), 0.05 * (1 - 0.3 * bif))) // aorta (and the iliac arteries)
  prims.push(ell('vessel', 0.05 + 0.14 * bif, 0.14, 0.05 * bif, 0.05 * bif))
  prims.push(ell('vessel', 0.0, 0.04 + 0.0, 0.016 * panc, 0.016 * panc)) // SMA

  return { prims, marker: { text: 'R', x: -0.92, y: 0 } }
}
