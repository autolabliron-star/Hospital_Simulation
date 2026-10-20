/**
 * R3 "Real screens": the knee, for the knee MRI (PD fat-sat and T1, coronal and sagittal) and the knee radiograph (AP and lateral). One leg,
 * the patient's `side`, its joint line at S ~-440 and L ~+-95, built alone (it owns the outline).
 *
 * What is in it: the thigh, knee and calf outline; the quadriceps, hamstrings, gastrocnemius heads, tibialis anterior and the popliteal
 * fossa's fat; the femur (shaft with fatty marrow, flaring metaphysis, the trochlea and the two condyles with the intercondylar notch); the
 * patella with its cartilage; the tibia (plateau with its cartilage and spines, tuberosity, shaft); the fibula's head and shaft; the medial
 * C-shaped and lateral O-shaped menisci (dark wedges at the joint's edges on MR); the cruciate and collateral ligaments, the quadriceps and
 * patellar tendons, Hoffa's fat pad, the suprapatellar recess with a little fluid, and the popliteal artery and vein. Seeded per patient:
 * small changes of size, and in older patients thinner cartilage and narrower medial joint space.
 */
import { mixSeed, mulberry32 } from '@/sim/rng'
import type { BodyBuilder, V3 } from '../body'
import type { PatientParams } from '../params'
import { Bone, LT, jointFrame, shaftMarrow, soft } from './limb'
import type { Landmarks } from './types'

export function buildKnee(b: BodyBuilder, p: PatientParams): Landmarks {
  const r = mulberry32(mixSeed(p.seed >>> 0, 0x6b6e))
  const u = (lo: number, hi: number): number => lo + (hi - lo) * r()
  const k = u(0.94, 1.06) * (0.6 + 0.4 * p.width)
  const H = p.height
  const f = jointFrame([p.side * 95 * p.width, 0, -440 * H], p.side)
  const at = f.at
  const c0 = f.centre
  const fat = 6 + p.fat * 0.35
  // older knees: thinner cartilage, the medial compartment narrower
  const cart = 2.6 - 1.1 * p.atrophy
  const medialGap = 1 - 0.45 * p.atrophy

  // --- outline and soft tissue -------------------------------------------------------------------------------------------
  const outline = b.part('legOutline', LT.fat, { layer: 1, smooth: 14, outline: true })
  const cx = c0[0]
  // three pieces that meet with the same section (a step in the outline would show as a band across the radiograph)
  const cy = c0[1] + 6
  outline.taper(cx, cy, c0[2] + 50, c0[2] + 260, (50 + fat) * k, (46 + fat) * k, (58 + fat) * k, (54 + fat) * k)
  outline.taper(cx, cy, c0[2] - 60, c0[2] + 50, (44 + fat) * k, (42 + fat) * k, (50 + fat) * k, (46 + fat) * k)
  outline.taper(cx, cy, c0[2] - 260, c0[2] - 60, (32 + fat) * k, (34 + fat) * k, (44 + fat) * k, (42 + fat) * k)
  // the thigh's muscle: the quadriceps in front (thinning to the tendon above the patella), the hamstrings behind
  soft(b, f, 'quadriceps', LT.muscle, 2, (q, a) => q.ellipsoid(a(0, -10, 175), [46 * k, 30 * k, 110]).ellipsoid(a(-24, -6, 95), [20 * k, 24 * k, 50]), 10)
  soft(b, f, 'hamstrings', LT.muscle, 2, (q, a) => q.ellipsoid(a(-14, 30, 170), [26 * k, 22 * k, 110]).ellipsoid(a(24, 26, 160), [20 * k, 20 * k, 110]), 8)
  // the calf: the two heads of the gastrocnemius, the soleus under them, tibialis anterior in front
  soft(b, f, 'gastrocMedial', LT.muscle, 2, (q, a) => q.ellipsoid(a(-18, 34, -120), [19 * k, 22 * k, 95]))
  soft(b, f, 'gastrocLateral', LT.muscle, 2, (q, a) => q.ellipsoid(a(18, 32, -110), [16 * k, 19 * k, 85]))
  soft(b, f, 'soleus', LT.muscle, 2, (q, a) => q.ellipsoid(a(0, 18, -180), [28 * k, 18 * k, 90]))
  soft(b, f, 'tibialisAnterior', LT.muscle, 2, (q, a) => q.ellipsoid(a(22, -10, -150), [12 * k, 14 * k, 100]))
  soft(b, f, 'popliteus', LT.muscle, 3, (q, a) => q.capsule(a(26, 22, -14), a(-14, 26, -52), 7))
  // the popliteal fossa's fat and its vessels
  soft(b, f, 'poplitealFat', LT.fat, 3, (q, a) => q.ellipsoid(a(0, 32, 30), [24 * k, 18 * k, 70]))
  soft(b, f, 'poplitealArtery', LT.blood, 7, (q, a) => q.capsule(a(-4, 36, 140), a(-2, 32, 10), 3.6).capsule(a(-2, 32, 10), a(2, 30, -90), 3.4))
  soft(b, f, 'poplitealVein', LT.blood, 7, (q, a) => q.capsule(a(5, 42, 140), a(6, 38, 10), 4.6).capsule(a(6, 38, 10), a(6, 34, -90), 4.2))
  // Hoffa's fat pad behind the patellar tendon, the suprapatellar recess (a thin film of fluid behind the quadriceps tendon)
  soft(b, f, 'hoffa', LT.fat, 6, (q, a) => q.ellipsoid(a(0, -27, -8), [22 * k, 11, 15]))
  soft(b, f, 'suprapatellar', LT.fluid, 6, (q, a) => q.ellipsoid(a(0, -26, 58), [24 * k, 2 + 2 * r(), 24]))

  // --- the femur: shaft, the metaphysis flaring to the epicondyles, the trochlea in front and the two condyles below ------------
  new Bone(b, f, 'femur', 7)
    .taper(-2, 6, 96, 260, 14 * k, 14 * k, 14 * k, 14 * k, 'none', true)
    .taper(-1, 7, 58, 100, 24 * k, 20 * k, 14 * k, 14 * k)
    .taper(0, 8, 26, 58, 37 * k, 25 * k, 24 * k, 20 * k)
    .ellipsoid([0, -4, 33], [26 * k, 10 * k, 16])
    .ellipsoid([21 * k, 9, 22], [15 * k, 29 * k, 21])
    .ellipsoid([-21 * k, 9, 22 + (1 - medialGap)], [16.5 * k, 30 * k, 21])
    .build(1.4)
  shaftMarrow(b, f, 'femurShaft', [-3, 6, 260], [-1, 6, 96], 9.4 * k)
  // the cartilage over the condyles and the trochlea (the bone wins inside: a rim shows)
  const fc = b.part('femurCartilage', LT.cartilage, { layer: 19 })
  fc.ellipsoid(at(21 * k, 9, 22), [15 * k + cart, 30 * k + cart, 22 + cart])
  fc.ellipsoid(at(-21 * k, 9, 22 + (1 - medialGap)), [16.5 * k + cart, 31 * k + cart, 22 + cart])
  fc.ellipsoid(at(0, -12, 34), [31 * k + cart, 14 * k + cart, 21 + cart])
  // the intercondylar notch (fat round the cruciates), above the bone
  soft(b, f, 'notch', LT.fat, 22, (q, a) => q.box(a(0, 22, 12), [6.5 * k, 22 * k, 13], 4))
  soft(b, f, 'acl', LT.ligament, 23, (q, a) => q.capsule(a(8 * k, 24, 20), a(2, -6, -6), 3.6))
  soft(b, f, 'pcl', LT.ligament, 23, (q, a) => q.capsule(a(-7 * k, -2, 22), a(0, 26, -10), 4.6).capsule(a(0, 26, -10), a(0, 30, -20), 4.4))

  // --- the patella and its tendons -----------------------------------------------------------------------------------------
  new Bone(b, f, 'patella', 4).ellipsoid([0, -38 * k, 36], [21 * k, 9 * k, 23], [-8, 0, 0]).build(1.3)
  soft(b, f, 'patellaCartilage', LT.cartilage, 19, (q, a) => q.ellipsoid(a(0, -31 * k, 36), [18 * k, 5, 19], [-8, 0, 0]))
  soft(b, f, 'quadricepsTendon', LT.tendon, 6, (q, a) => q.ellipsoid(a(0, -38 * k, 92), [18 * k, 4.5, 34]))
  soft(b, f, 'patellarTendon', LT.tendon, 6, (q, a) => q.capsule(a(-5, -40 * k, 12), a(-1, -24 * k, -50), 3.6).capsule(a(5, -40 * k, 12), a(7, -24 * k, -50), 3.6))

  // --- the tibia (a flat plateau over a flaring metaphysis, the spines, the tuberosity, the shaft), the fibula ------------------
  const tilt = (1 - medialGap) / 2
  new Bone(b, f, 'tibia', 6)
    .taper(0, 6, -22, -4 - tilt, 35 * k, 26 * k, 36 * k, 26 * k, 'top')
    .taper(0, 7, -50, -22, 22 * k, 18 * k, 35 * k, 26 * k)
    .taper(1, 8, -88, -50, 14 * k, 14 * k, 22 * k, 18 * k)
    .ellipsoid([-5, 6, -4], [3.5, 7, 5])
    .ellipsoid([5, 4, -5], [3.5, 7, 4.5])
    .ellipsoid([4, -9 * k, -58], [6, 5, 10])
    .taper(2, 8, -260, -88, 13 * k, 13 * k, 13 * k, 13 * k, 'none', true)
    .build(1.4)
  shaftMarrow(b, f, 'tibiaShaft', [1, 8, -88], [2, 8, -260], 8.4 * k)
  new Bone(b, f, 'fibula', 4).ellipsoid([33 * k, 19, -27], [9.5, 10, 11]).capsule([33 * k, 18, -34], [29 * k, 15, -260], 6.5, true).build(1.3)
  shaftMarrow(b, f, 'fibulaShaft', [33 * k, 18, -44], [29 * k, 15, -260], 3.6)
  const tc = b.part('tibiaCartilage', LT.cartilage, { layer: 19 })
  tc.box(at(18 * k, 6, -4 - cart / 2), [16 * k, 22 * k, cart / 2 + 0.5], 0.5)
  tc.box(at(-18 * k, 6, -4 - cart / 2 - (1 - medialGap)), [17 * k, 24 * k, cart / 2 + 0.5], 0.5)

  // --- the menisci: wedges round the edge of each compartment (the medial a C open to the middle, the lateral nearly a ring) ------
  const ring = (name: string, lat: number, ra: number, rp: number, from: number, to: number, s: number): void => {
    const n = 9
    for (let i = 0; i < n; i++) {
      const a0 = from + ((to - from) * i) / n
      const a1 = from + ((to - from) * (i + 1)) / n
      const pt = (a: number): V3 => at(lat + Math.cos(a) * ra, 6 + Math.sin(a) * rp, s)
      // the posterior horn is the thickest
      const rad = 2.6 + 1.0 * Math.max(0, Math.sin((a0 + a1) / 2))
      b.part(`${name}${i}`, LT.meniscus, { layer: 19 }).capsule(pt(a0), pt(a1), rad)
    }
  }
  // angles: 0 lateral, +pi/2 posterior; the medial meniscus opens toward the notch (angle 0 for it is toward the middle)
  ring('meniscusMedial', -19 * k, 15 * k, 24 * k, Math.PI * 0.32, Math.PI * 1.68, -3.2 - (1 - medialGap))
  ring('meniscusLateral', 19 * k, 13 * k, 19 * k, Math.PI * 1.12, Math.PI * 2.88, -3.2)

  // --- the collateral ligaments ------------------------------------------------------------------------------------------------
  soft(b, f, 'mcl', LT.ligament, 6, (q, a) => q.capsule(a(-40 * k, 4, 34), a(-37 * k, 2, -66), 2.2))
  soft(b, f, 'lcl', LT.ligament, 6, (q, a) => q.capsule(a(38 * k, 10, 30), a(36 * k, 18, -22), 2.2))

  return {
    kneeCentre: at(0, 6, -2),
    femurAxis: [0, 0, 1],
    lateral: [p.side, 0, 0],
    anterior: [0, -1, 0],
    patella: at(0, -38 * k, 36),
  }
}
