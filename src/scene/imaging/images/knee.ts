/**
 * The knee for MRI: a coronal series from the front (z = 0) to the back (z = 1) and a sagittal series from the lateral side (z = 0)
 * through the middle (z = 0.5) to the medial side (z = 1). Same convention as the other anatomies: one shape list for every slice,
 * shapes that are not at this level shrink or fade, so neighbours differ smoothly.
 * Coronal: the patient's right knee seen from the front (lateral on the left), femur at the top. Sagittal: anterior on the left.
 */
import { addBone, addBone as bone, bump, curve, ell, line, poly, smooth, variation, wobble, type Prim, type SliceModel } from './shapes'

export function kneeCoronal(seed: number, z: number): SliceModel {
  const v = variation(seed)
  const p = v.phase
  const cond = bump(z, 0.08, 0.98) // the condyles are cut through the middle slices, not the front or back
  const notch = bump(z, 0.35, 0.8) // the intercondylar notch: cruciates
  const prims: Prim[] = []

  // soft tissue: skin and fat, then the thigh and calf muscles
  prims.push(poly('fat', [-0.66, -1, 0.66, -1, 0.7, -0.4, 0.74, 0.05, 0.7, 0.55, 0.62, 1, -0.62, 1, -0.7, 0.55, -0.74, 0.05, -0.7, -0.4]))
  prims.push(poly('muscle', [-0.58, -1, 0.58, -1, 0.6, -0.4, 0.62, -0.1, 0.55, 0.05, 0.56, 0.4, 0.52, 1, -0.5, 1, -0.54, 0.4, -0.58, 0.05, -0.62, -0.1, -0.6, -0.4], 0.95))
  prims.push(line('fat', [0, -1, 0, -0.45], 0.012, 0.7)) // septum between the quadriceps and the hamstrings
  prims.push(line('fat', [-0.32, 0.4, -0.2, 1], 0.012, 0.6))

  // femur: shaft flaring into the two condyles (the medial one a little bigger)
  const femur = [-0.2, -1, 0.2, -1, 0.24, -0.62, 0.36, -0.4, 0.5, -0.24, 0.5, -0.04, 0.36, 0.06, 0.14, 0.07, 0.04, -0.1, -0.06, -0.1, -0.14, 0.07, -0.36, 0.06, -0.48, -0.04, -0.48, -0.26, -0.36, -0.42, -0.24, -0.62]
  bone(prims, femur, 1, 0.045)
  // tibia: the plateaus with the tibial spines, narrowing to the shaft
  const tibia = [-0.5, 0.17, -0.3, 0.14, -0.1, 0.14, -0.06, 0.07, -0.02, 0.14, 0.02, 0.14, 0.06, 0.07, 0.1, 0.14, 0.3, 0.14, 0.52, 0.17, 0.5, 0.27, 0.34, 0.36, 0.26, 0.6, 0.22, 1, -0.22, 1, -0.24, 0.6, -0.34, 0.36, -0.48, 0.27]
  bone(prims, tibia, 1)
  // fibula head and shaft, lateral
  bone(prims, [-0.66, 0.3, -0.5, 0.28, -0.46, 0.4, -0.44, 0.7, -0.41, 1, -0.5, 1, -0.54, 0.7, -0.62, 0.46], 1)
  // the patella ghost in front (front slices only) and the fat pad
  prims.push(ell('fat', 0, 0.05, 0.22 * (1 - cond), 0.14 * (1 - cond), 0, 0.9))
  prims.push(ell('bone', 0, -0.2, 0.2 * smooth(0.0, 0.2, 0.2 - z) * 1, 0.2 * smooth(0, 0.2, 0.2 - z), 0, 1))

  // joint cartilage (bright on PD) and the menisci (dark wedges), the joint space
  prims.push(line('cartilage', curve((t) => [-0.46 + 0.4 * t, 0.075 - 0.01 * Math.sin(Math.PI * t)], 6), 0.026, cond))
  prims.push(line('cartilage', curve((t) => [0.06 + 0.4 * t, 0.075 - 0.01 * Math.sin(Math.PI * t)], 6), 0.026, cond))
  prims.push(line('cartilage', [-0.44, 0.16, -0.12, 0.16], 0.02, cond))
  prims.push(line('cartilage', [0.12, 0.16, 0.44, 0.16], 0.02, cond))
  prims.push(poly('meniscus', [-0.56, 0.06, -0.14, 0.095, -0.56, 0.17], cond)) // lateral meniscus
  prims.push(poly('meniscus', [0.56, 0.06, 0.12, 0.095, 0.56, 0.17], cond)) // medial meniscus
  prims.push(ell('csf', 0, 0.11, 0.08, 0.012, 0, 0.8 * cond)) // a little joint fluid
  // cruciate ligaments in the notch, collaterals on the sides
  prims.push(line('ligament', [-0.08, -0.08, 0.03, 0.12], 0.034, notch))
  prims.push(line('ligament', [0.07, -0.08, -0.02, 0.12], 0.034, notch))
  prims.push(line('ligament', [0.6, -0.2, 0.6, 0.35], 0.032, cond)) // medial collateral
  prims.push(line('ligament', [-0.64, -0.2, -0.62, 0.28], 0.026, cond * 0.9)) // lateral collateral
  // vessels and the popliteal region at the back
  prims.push(ell('vessel', 0.04, 0.0, 0.05 * smooth(0.75, 1, z), 0.1 * smooth(0.75, 1, z)))
  // wobble in the muscle bellies
  prims.push(poly('muscle', wobble(0.0, 0.7, 0.4, 0.28, [[0.05, 3, p[0]]], 20), 0.5 * smooth(0.6, 1, z)))
  return { prims, marker: { text: 'L', x: -0.92, y: 0.8 } }
}

export function kneeSagittal(seed: number, z: number): SliceModel {
  const v = variation(seed)
  const p = v.phase
  const L = Math.abs(2 * z - 1) // 0 in the middle of the knee, 1 at the lateral or medial skin
  const c = 1 - smooth(0.45, 0.85, L) // the central structures: cruciates
  const cond = 1 - smooth(0.7, 0.98, L) // the femoral condyle and tibial plateau are cut through the middle
  const pat = 1 - smooth(0.55, 0.9, L) // the patella
  const prims: Prim[] = []

  // soft tissue: skin and fat, thigh and calf muscles, a little fluid above the patella
  prims.push(poly('fat', [-0.56, -1, 0.8, -1, 0.88, -0.4, 0.9, 0.1, 0.82, 0.55, 0.66, 1, -0.34, 1, -0.44, 0.5, -0.5, 0.1, -0.54, -0.4]))
  prims.push(poly('muscle', [-0.42, -1, -0.04, -1, -0.02, -0.6, -0.1, -0.46, -0.32, -0.5, -0.42, -0.7], 0.95)) // quadriceps
  prims.push(poly('muscle', [0.36, -1, 0.74, -1, 0.8, -0.4, 0.78, 0.0, 0.5, 0.0, 0.46, -0.4], 0.95)) // hamstrings, gastrocnemius head
  prims.push(poly('muscle', [0.4, 0.22, 0.72, 0.18, 0.76, 0.5, 0.6, 1, 0.36, 1], 0.95)) // calf
  prims.push(ell('csf', -0.15, -0.46, 0.05, 0.1, 0.2, 0.5 * cond))
  prims.push(ell('vessel', 0.52, 0.06, 0.035 * cond, 0.045 * cond)) // popliteal vessels
  prims.push(ell('fat', 0.52, 0.16, 0.05 * cond, 0.03 * cond, 0, 0.8))

  // femur: shaft, then the rounded condyle
  addBone(prims, [0.02, -1, 0.46, -1, 0.5, -0.7, 0.42, -0.44, 0.44, -0.3, 0.4, -0.12, 0.3, 0.04, 0.14, 0.12, 0.0, 0.1, -0.14, 0.0, -0.2, -0.14, -0.16, -0.3, -0.04, -0.45, 0.0, -0.7], 1 - 0.65 * (1 - cond))
  // tibia: plateau, tuberosity, shaft
  addBone(prims, [-0.22, 0.22, 0.12, 0.2, 0.4, 0.2, 0.42, 0.34, 0.38, 0.6, 0.36, 1, -0.08, 1, -0.1, 0.62, -0.16, 0.5, -0.26, 0.44, -0.24, 0.32], 1 - 0.65 * (1 - cond))
  // patella and its tendons, and Hoffa's fat pad
  addBone(prims, [-0.4, -0.42, -0.3, -0.42, -0.26, -0.26, -0.28, -0.1, -0.36, -0.08, -0.42, -0.24], pat)
  prims.push(line('ligament', [-0.34, -0.42, -0.26, -0.6, -0.2, -1], 0.04, 1)) // quadriceps tendon
  prims.push(line('ligament', [-0.33, -0.08, -0.28, 0.2, -0.24, 0.42], 0.045, 1)) // patellar tendon
  prims.push(poly('fat', [-0.26, -0.06, -0.08, 0.04, -0.06, 0.2, -0.22, 0.22, -0.28, 0.1], 1)) // infrapatellar fat pad

  // cartilage on the condyle and the plateau, menisci, cruciates
  prims.push(line('cartilage', curve((t) => [-0.16 + 0.54 * t, 0.11 + 0.0 * t - 0.09 * Math.sin(Math.PI * t) * 0.0 + (t > 0.6 ? -0.03 * (t - 0.6) : 0)], 8), 0.024, cond))
  prims.push(line('cartilage', [-0.18, 0.19, 0.38, 0.18], 0.018, cond))
  prims.push(poly('meniscus', [-0.12, 0.16, 0.0, 0.16, -0.04, 0.26, -0.14, 0.25], cond * (1 - 0.7 * c))) // anterior horn
  prims.push(poly('meniscus', [0.24, 0.16, 0.4, 0.15, 0.42, 0.27, 0.3, 0.26], cond * (1 - 0.7 * c))) // posterior horn
  prims.push(line('ligament', [0.28, -0.06, 0.14, 0.16], 0.03, c)) // ACL
  prims.push(line('ligament', [0.02, -0.1, 0.32, 0.18], 0.034, c)) // PCL
  prims.push(ell('csf', 0.1, 0.14, 0.18 * cond, 0.012, 0, 0.6 * (0.5 + 0.5 * Math.sin(p[0]))))
  return { prims, marker: { text: 'A', x: -0.92, y: -0.9 } }
}
