/**
 * Axial neck (cervical spine) for CT: z 0 at the skull base / C1 down to 1 at C7-T1, anterior at the top.
 * The vertebra (body, canal with cord, arch, foramina with the vertebral arteries), the airway, the thyroid, the neck muscles and
 * the great vessels. Near the top the mandible and the odontoid peg appear, near the bottom the lung apices and the shoulder girdle.
 */
import { curve, ell, line, lerp, poly, rrect, smooth, variation, type Prim, type SliceModel } from './shapes'

export function neckAxial(seed: number, z: number): SliceModel {
  const v = variation(seed)
  const p = v.phase
  const top = 1 - smooth(0.0, 0.28, z) // C1/C2: mandible, odontoid peg
  const low = smooth(0.7, 1.0, z) // shoulders, lung apices
  const prims: Prim[] = []

  const rx = lerp(0.62, 0.74, z) * v.size
  const ry = lerp(0.6, 0.58, z) * v.size
  prims.push(ell('fat', 0, 0, rx, ry, v.tilt * 0.4))
  prims.push(ell('muscle', 0, 0.02, rx - 0.07, ry - 0.07, v.tilt * 0.4))
  prims.push(ell('fat', 0, -0.1, rx - 0.17, ry - 0.3, 0, 0.9)) // the fascial spaces round the airway

  // the shoulder girdle and the lung apices at the bottom
  for (const sg of [-1, 1]) {
    prims.push(ell('muscle', sg * 0.8, 0.1, 0.22 * low, 0.32 * low, sg * 0.3))
    prims.push(ell('lung', sg * 0.4, -0.1, 0.17 * low, 0.2 * low))
    prims.push(line('bone', curve((t) => [sg * (0.28 + 0.4 * t), -0.34 + 0.1 * t], 5), 0.04 * low, low)) // clavicle
  }
  // the mandible (a U in front of the spine at the top) and the tongue base
  prims.push(line('bone', [-0.4, 0.06, -0.38, -0.34, -0.2, -0.5, 0, -0.52, 0.2, -0.5, 0.38, -0.34, 0.4, 0.06], 0.06 * top, top))
  prims.push(line('marrow', [-0.38, 0.0, -0.36, -0.32, -0.19, -0.47, 0, -0.49, 0.19, -0.47, 0.36, -0.32, 0.38, 0.0], 0.03 * top, top))
  prims.push(ell('muscle', 0, -0.18, 0.28 * top, 0.2 * top))

  // the airway and the thyroid
  const air = 1 - top
  prims.push(ell('air', 0, -0.12, 0.085 * air, 0.1 * air, 0)) // trachea / larynx
  prims.push(ell('muscle', 0, -0.12, 0.11 * air, 0.13 * air, 0, 0.6)) // its wall
  prims.push(ell('air', 0, -0.12, 0.085 * air, 0.1 * air, 0))
  prims.push(ell('air', 0, -0.06, 0.14 * top, 0.05 * top)) // the oropharynx at the top
  for (const sg of [-1, 1]) {
    prims.push(ell('organ', sg * 0.16, -0.1, 0.075 * smooth(0.4, 0.6, z) * air, 0.11 * smooth(0.4, 0.6, z) * air, sg * 0.2)) // thyroid lobes
    prims.push(ell('muscle', sg * 0.5, -0.12, 0.13, 0.09, sg * 0.5)) // sternocleidomastoid
    prims.push(ell('vessel', sg * 0.3, 0.0, 0.032, 0.032)) // carotid
    prims.push(ell('vein', sg * 0.37, -0.02, 0.05, 0.04)) // internal jugular
    prims.push(ell('muscle', sg * 0.2, 0.38, 0.15, 0.14, -sg * 0.3)) // paraspinal muscles
    prims.push(ell('muscle', sg * 0.4, 0.22, 0.1, 0.08, sg * 0.3))
    prims.push(ell('fat', sg * 0.16, 0.43, 0.01, 0.1, 0, 0.7))
  }
  prims.push(ell('organ', 0.0, 0.12, 0.09, 0.04, 0, air)) // oesophagus / prevertebral muscles

  // the cervical vertebra: body (the odontoid peg in front of the canal at the top), canal and cord, arch, transverse foramina
  const cy = 0.2
  prims.push(poly('bone', rrect(0, cy, 0.26 * (1 - 0.6 * top), 0.2 * (1 - 0.6 * top), 0.06)))
  prims.push(poly('marrow', rrect(0, cy, 0.22 * (1 - 0.6 * top), 0.16 * (1 - 0.6 * top), 0.05)))
  prims.push(ell('bone', 0, cy + 0.0, 0.05 * top, 0.075 * top)) // odontoid peg
  prims.push(ell('bone', 0, cy + 0.2, 0.125, 0.115))
  prims.push(ell('csf', 0, cy + 0.2, 0.09, 0.08))
  prims.push(ell('cord', 0, cy + 0.2, 0.052, 0.045))
  for (const sg of [-1, 1]) {
    prims.push(line('bone', [sg * 0.12, cy + 0.12, sg * 0.15, cy + 0.2], 0.04))
    prims.push(line('bone', [sg * 0.12, cy + 0.27, sg * 0.14, cy + 0.34, 0, cy + 0.4], 0.04)) // laminae
    prims.push(line('bone', [sg * 0.14, cy + 0.15, sg * 0.3, cy + 0.12], 0.05)) // transverse process
    prims.push(ell('bone', sg * 0.24, cy + 0.12, 0.065, 0.06))
    prims.push(ell('vessel', sg * 0.24, cy + 0.12, 0.025, 0.025)) // vertebral artery in its foramen
    prims.push(ell('marrow', sg * 0.1 + sg * 0.0, cy + 0.3, 0.03, 0.025, 0, 0.8 * (0.7 + 0.3 * Math.sin(p[0])))) // facet
  }
  prims.push(line('bone', [0, cy + 0.38, 0, cy + 0.6], 0.045))
  prims.push(line('marrow', [0, cy + 0.4, 0, cy + 0.57], 0.02))

  return { prims, marker: { text: 'R', x: -0.92, y: 0 } }
}
