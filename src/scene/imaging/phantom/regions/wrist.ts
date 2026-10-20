/**
 * R3 "Real screens": the wrist and the hand, for the wrist radiograph (PA and lateral). One arm, the patient's `side`, hanging in the
 * anatomical position (palm forward, -P; the thumb lateral), the radiocarpal joint at S ~80 and L ~+-230, built alone (it owns the outline).
 *
 * What is in it: the forearm, wrist, palm, thenar eminence and the fingers' bases; the flexor and extensor tendons, the median nerve and
 * the radial artery; the distal radius (its flare, the radial styloid, the articular surface tilted toward the ulna) and the distal ulna with
 * its styloid; the eight carpal bones in their two rows (scaphoid, lunate, triquetrum and pisiform; trapezium, trapezoid, capitate and
 * hamate with its hook); the five metacarpals and the proximal phalanges.
 */
import { mixSeed, mulberry32 } from '@/sim/rng'
import type { BodyBuilder } from '../body'
import type { PatientParams } from '../params'
import { Bone, LT, jointFrame, shaftMarrow, soft } from './limb'
import type { Landmarks } from './types'

type L3 = [number, number, number]

export function buildWrist(b: BodyBuilder, p: PatientParams): Landmarks {
  const r = mulberry32(mixSeed(p.seed >>> 0, 0x3f15))
  const u = (lo: number, hi: number): number => lo + (hi - lo) * r()
  const k = u(0.92, 1.06) * (0.75 + 0.25 * p.width)
  const f = jointFrame([p.side * 230 * p.width, 8, 80 * p.height], p.side)
  const c0 = f.centre
  const fat = 2.5 + p.fat * 0.1

  // --- outline: the forearm (wide across, flat front to back) into the wrist and the palm, the thenar eminence, the fingers -------
  const outline = b.part('handOutline', LT.fat, { layer: 1, smooth: 10, outline: true })
  outline.taper(c0[0], c0[1], c0[2] - 30, c0[2] + 170, (27 + fat) * k, (17 + fat) * k, (34 + fat) * k, (25 + fat) * k)
  outline.box(f.at(2, -1, -62), [(40 + fat) * k, (12 + fat) * k, 40], 11)
  outline.ellipsoid(f.at(27 * k, -8, -42), [16 * k, 15 * k, 26], [0, 0, 0])
  const fingers: [number, number][] = [
    [14, -128],
    [1, -134],
    [-12, -130],
    [-24, -120],
  ]
  for (const [lat, end] of fingers) outline.capsule(f.at(lat * k, -1, -96), f.at(lat * k * 1.05, -1, end), 9 * k)
  outline.capsule(f.at(38 * k, -12, -66), f.at(50 * k, -22, -104), 10 * k)
  b.part('forearmMuscles', LT.muscle, { layer: 2 }).taper(c0[0], c0[1], c0[2] + 30, c0[2] + 170, 18 * k, 10 * k, 28 * k, 19 * k)
  soft(b, f, 'thenar', LT.muscle, 2, (q, a) => q.ellipsoid(a(25 * k, -6, -44), [12 * k, 10 * k, 22]))
  soft(b, f, 'hypothenar', LT.muscle, 2, (q, a) => q.ellipsoid(a(-24 * k, -4, -52), [9 * k, 8 * k, 22]))
  soft(b, f, 'interossei', LT.muscle, 2, (q, a) => q.box(a(0, -1, -62), [26 * k, 6, 26], 5))
  // the flexor tendons in the carpal tunnel, the extensors on the back, the median nerve, the radial artery
  for (const lat of [-10, -4, 2, 8]) soft(b, f, `flexor${lat}`, LT.tendon, 6, (q, a) => q.capsule(a(lat * k, -10, 70), a(lat * k * 1.2, -11, -60), 2.2))
  for (const lat of [-12, -2, 8, 18]) soft(b, f, `extensor${lat}`, LT.tendon, 6, (q, a) => q.capsule(a(lat * k, 13, 60), a(lat * k * 1.1, 9, -70), 1.8))
  soft(b, f, 'medianNerve', LT.nerve, 6, (q, a) => q.capsule(a(3, -14, 60), a(4, -13, -20), 2.4))
  soft(b, f, 'radialArtery', LT.blood, 7, (q, a) => q.capsule(a(22 * k, -13, 70), a(25 * k, -10, 8), 1.4))

  // --- the radius: the shaft, the flare to the wide distal end, the styloid on the thumb side -----------------------------------------
  new Bone(b, f, 'radius', 5)
    .taper(10 * k, 2, 48, 170, 9 * k, 7 * k, 9 * k, 7 * k, 'none', true)
    .taper(11 * k, 2, 18, 48, 15 * k, 10 * k, 9 * k, 7 * k)
    .taper(10 * k, 2, 2, 18, 19 * k, 11 * k, 15 * k, 10 * k, 'bottom')
    .ellipsoid([25 * k, 2, 2], [5, 7, 10])
    .build(1.1)
  shaftMarrow(b, f, 'radiusShaft', [10 * k, 2, 170], [10 * k, 2, 52], 5.4 * k)
  // the ulna: the shaft, the head, the styloid
  new Bone(b, f, 'ulna', 4)
    .capsule([-17 * k, 4, 170], [-16 * k, 4, 24], 7 * k, true)
    .ellipsoid([-16 * k, 4, 13], [9 * k, 8.5, 10])
    .ellipsoid([-21 * k, 7, 4], [3, 3, 7])
    .build(1.1)
  shaftMarrow(b, f, 'ulnaShaft', [-17 * k, 4, 170], [-16 * k, 4, 30], 4 * k)
  soft(b, f, 'tfcc', LT.cartilage, 19, (q, a) => q.ellipsoid(a(-15 * k, 4, 1), [8 * k, 8, 2.5]))

  // --- the carpus: the proximal row under the radius and the ulna's cartilage, the distal row, gaps of 1.5-2 mm between ------------
  const carpal = (name: string, c: L3, rr: L3, rot: L3 = [0, 0, 0]): void => {
    new Bone(b, f, name, 2).ellipsoid([c[0] * k, c[1], c[2] * k], [rr[0] * k, rr[1], rr[2] * k], rot).build(1)
  }
  carpal('scaphoid', [15, -2, -12], [6.5, 7, 12], [0, 40, 0])
  carpal('lunate', [1, 1, -9], [7.5, 9, 7.5])
  carpal('triquetrum', [-12, 3, -12], [6, 7, 6.5])
  carpal('pisiform', [-13, -8, -15], [4, 4.5, 5])
  carpal('trapezium', [20, -4, -29], [7, 8, 7.5], [0, 20, 0])
  carpal('trapezoid', [10, 0, -29], [5, 7, 6.5])
  carpal('capitate', [0, 1, -28], [7, 8, 11.5])
  carpal('hamate', [-12, 2, -27], [6.5, 8, 10])
  carpal('hamateHook', [-10, -8, -28], [2.5, 4, 5])

  // --- the metacarpals (the thumb's short and turned) and the proximal phalanges ------------------------------------------------------
  const mc: [L3, L3, number][] = [
    [[24, -6, -40], [38, -14, -74], 5.5],
    [[11, 0, -42], [13, -1, -100], 4.6],
    [[1, 1, -42], [1, -1, -104], 4.6],
    [[-9, 1, -42], [-11, -1, -100], 4.1],
    [[-18, 2, -40], [-23, -1, -92], 4],
  ]
  mc.forEach(([a0, a1, rad], i) => {
    const A: L3 = [a0[0] * k, a0[1], a0[2] * k]
    const B: L3 = [a1[0] * k, a1[1], a1[2] * k]
    new Bone(b, f, `metacarpal${i + 1}`, 3)
      .ellipsoid(A, [rad + 1.5, rad + 2, rad + 1])
      .capsule(A, B, rad * 0.78)
      .ellipsoid(B, [rad + 0.8, rad + 1, rad + 1.4])
      .build(1)
    // the proximal phalanx beyond the joint
    const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]
    const l = Math.hypot(d[0], d[1], d[2]) || 1
    const len = i === 0 ? 30 : i === 4 ? 32 : 40
    const P0: L3 = [B[0] + (d[0] / l) * (rad + 3), B[1] + (d[1] / l) * (rad + 3), B[2] + (d[2] / l) * (rad + 3)]
    const P1: L3 = [P0[0] + (d[0] / l) * len, P0[1] + (d[1] / l) * len, P0[2] + (d[2] / l) * len]
    new Bone(b, f, `phalanx${i + 1}`, 3).ellipsoid(P0, [rad, rad, rad + 0.5]).capsule(P0, P1, rad * 0.7).ellipsoid(P1, [rad * 0.8, rad * 0.8, rad]).build(0.9)
  })

  return {
    wristCentre: f.at(0, 2, 0),
    forearmAxis: [0, 0, 1],
    radial: [p.side, 0, 0],
    palmar: [0, -1, 0],
  }
}
