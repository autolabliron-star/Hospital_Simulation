/**
 * R3 "Real screens": the ankle and the back of the foot, for the ankle radiograph (AP and lateral). One leg, the patient's `side`, the
 * talar dome at S ~-860 and L ~+-95, built alone (it owns the outline). The foot points forward (-P), the sole is flat on the detector's
 * edge of the picture.
 *
 * What is in it: the lower leg, ankle and foot outline with the heel pad; the leg's muscles, the Achilles tendon and Kager's fat in front
 * of it; the tibia's shaft, metaphysis, plafond and medial malleolus; the fibula with the lateral malleolus (lower than the medial); the
 * talus (dome, neck and head) with its cartilage; the calcaneus with its tuberosity and the sustentaculum; the navicular, the cuboid, the
 * three cuneiforms and the bases and shafts of the five metatarsals.
 */
import { mixSeed, mulberry32 } from '@/sim/rng'
import type { BodyBuilder } from '../body'
import type { PatientParams } from '../params'
import { Bone, LT, jointFrame, shaftMarrow, soft } from './limb'
import type { Landmarks } from './types'

export function buildAnkle(b: BodyBuilder, p: PatientParams): Landmarks {
  const r = mulberry32(mixSeed(p.seed >>> 0, 0xa4c1e))
  const u = (lo: number, hi: number): number => lo + (hi - lo) * r()
  const k = u(0.94, 1.06) * (0.7 + 0.3 * p.width)
  const f = jointFrame([p.side * 95 * p.width, 0, -860 * p.height], p.side)
  const c0 = f.centre
  const fat = 4 + p.fat * 0.2

  // --- outline: the leg narrowing to the ankle, the hindfoot and the forefoot --------------------------------------------------
  const outline = b.part('footOutline', LT.fat, { layer: 1, smooth: 16, outline: true })
  // the leg's tube runs down into the hindfoot, so its end is inside the foot (an end showing would be a step on the radiograph)
  outline.taper(c0[0], c0[1] + 8, c0[2] - 20, c0[2] + 220, (28 + fat) * k, (30 + fat) * k, (38 + fat) * k, (38 + fat) * k)
  outline.ellipsoid(f.at(0, 22, -36), [(34 + fat) * k, (58 + fat) * k, 44 + fat])
  outline.ellipsoid(f.at(-2, -70, -52), [(40 + fat) * k, (78 + fat) * k, 24 + fat], [8, 0, 0])
  // the leg's muscles thinning to tendons, the sole's muscles, Kager's fat, the tendons round the ankle
  b.part('legMuscles', LT.muscle, { layer: 2 }).taper(c0[0], c0[1] + 10, c0[2] + 60, c0[2] + 220, 16 * k, 14 * k, 30 * k, 26 * k)
  soft(b, f, 'soleMuscles', LT.muscle, 2, (q, a) => q.ellipsoid(a(-4, -56, -70), [24 * k, 60 * k, 8], [8, 0, 0]))
  soft(b, f, 'kager', LT.fat, 3, (q, a) => q.ellipsoid(a(0, 34, 26), [12 * k, 10, 40]))
  soft(b, f, 'achilles', LT.tendon, 6, (q, a) => q.capsule(a(0, 44, 200), a(0, 46, 40), 5.5).capsule(a(0, 46, 40), a(1, 52, -34), 5.5))
  soft(b, f, 'tibialisPosterior', LT.tendon, 6, (q, a) => q.capsule(a(-24, 14, 60), a(-28, 10, -14), 2.6).capsule(a(-28, 10, -14), a(-16, -40, -40), 2.4))
  soft(b, f, 'peronei', LT.tendon, 6, (q, a) => q.capsule(a(30, 22, 60), a(32, 20, -24), 3).capsule(a(32, 20, -24), a(24, -30, -54), 2.6))

  // --- the tibia and the fibula ------------------------------------------------------------------------------------------------
  new Bone(b, f, 'tibia', 5)
    .taper(0, 4, 70, 220, 12 * k, 12 * k, 12 * k, 12 * k, 'none', true)
    .taper(0, 4, 26, 70, 22 * k, 19 * k, 12 * k, 12 * k)
    .taper(0, 4, 4, 26, 23 * k, 19 * k, 22 * k, 19 * k, 'bottom')
    .ellipsoid([-23 * k, 6, -2], [6.5, 10, 13])
    .build(1.4)
  shaftMarrow(b, f, 'tibiaShaft', [0, 4, 220], [0, 4, 74], 8 * k)
  new Bone(b, f, 'fibula', 4)
    .capsule([27 * k, 13, 220], [27 * k, 12, 30], 6, true)
    .ellipsoid([27 * k, 12, 14], [8, 10, 18])
    .ellipsoid([28 * k, 13, -8], [7.5, 11, 17])
    .build(1.3)
  shaftMarrow(b, f, 'fibulaShaft', [27 * k, 13, 220], [27 * k, 12, 40], 3)
  // the tibiofibular syndesmosis (the ligament between them above the joint)
  soft(b, f, 'syndesmosis', LT.ligament, 6, (q, a) => q.capsule(a(18 * k, 10, 22), a(23 * k, 12, 10), 3))

  // --- the talus: the dome under the plafond, the neck and head going forward and down ----------------------------------------------
  new Bone(b, f, 'talus', 6)
    .ellipsoid([0, 4, -14], [19 * k, 22 * k, 15])
    .ellipsoid([-5, -20, -26], [13 * k, 15 * k, 11])
    .ellipsoid([-8, -36, -30], [13 * k, 11, 12])
    .build(1.2)
  soft(b, f, 'talarCartilage', LT.cartilage, 19, (q, a) => q.ellipsoid(a(0, 4, -14), [19 * k + 1.6, 22 * k + 1.6, 16.6]))

  // --- the calcaneus: the body under the talus, the tuberosity at the back of the heel, the sustentaculum on the inside ----------
  new Bone(b, f, 'calcaneus', 7)
    .ellipsoid([4, 30, -44], [17 * k, 34 * k, 17], [-12, 0, 0])
    .ellipsoid([3, 58, -52], [15 * k, 13, 17])
    .ellipsoid([-14, 12, -34], [8, 11, 6])
    .ellipsoid([10, 0, -46], [12, 14, 12])
    .build(1.3)

  // --- the midfoot and the metatarsals ---------------------------------------------------------------------------------------------
  new Bone(b, f, 'navicular', 3).ellipsoid([-12, -52, -32], [16 * k, 7, 13], [0, 0, -15]).build(1.1)
  new Bone(b, f, 'cuboid', 3).ellipsoid([16 * k, -42, -48], [12 * k, 17, 12]).build(1.1)
  new Bone(b, f, 'cuneiformMedial', 2).ellipsoid([-18 * k, -68, -38], [9, 10, 14]).build(1)
  new Bone(b, f, 'cuneiformMiddle', 2).ellipsoid([-5 * k, -66, -34], [7, 9, 11]).build(1)
  new Bone(b, f, 'cuneiformLateral', 2).ellipsoid([7 * k, -64, -40], [8, 10, 11]).build(1)
  const base = [-18, -6, 4, 13, 22]
  const head = [-26, -9, 6, 19, 30]
  const rad = [7, 5, 4.8, 4.8, 5.2]
  for (let i = 0; i < 5; i++) {
    const b0: [number, number, number] = [base[i] * k, i === 4 ? -58 : -80, i === 4 ? -52 : -44]
    const b1: [number, number, number] = [head[i] * k, -150 - (i === 0 ? 0 : 6 - i), -66]
    new Bone(b, f, `metatarsal${i + 1}`, 3)
      .ellipsoid(b0, [rad[i] + 2, rad[i] + 4, rad[i] + 3])
      .capsule(b0, b1, rad[i] * 0.8, false)
      .ellipsoid(b1, [rad[i] + 1, rad[i] + 2, rad[i] + 2])
      .build(1.2)
  }

  return {
    ankleCentre: f.at(0, 4, 0),
    tibiaAxis: [0, 0, 1],
    lateral: [p.side, 0, 0],
    anterior: [0, -1, 0],
    footAxis: [0, -1, 0],
  }
}
