/**
 * R3 "Real screens": the forearm and the elbow's crease, for the blood-draw robot's vein scanner: its near-infrared vein map (veins show dark
 * through the skin) and its needle-guide ultrasound (a vein is a black tube a few millimetres under the skin, the needle a bright line
 * going into it). The patient's LEFT arm in the anatomical position (hanging, palm forward), in the shared patient frame: the elbow's crease
 * at S ~330, the wrist at S ~80, the arm's axis at L ~+230; the palm side (volar, where the veins are drawn from) faces -P.
 *
 * What is in it: skin and fat (the arm's outline), the flexor muscles in front and the extensors behind, the radius (on the thumb side,
 * away from the body: +L) and the ulna, the biceps tendon at the crease, the brachial artery deep beside it and the radial and ulnar
 * arteries, and the superficial veins: the cephalic (thumb side), the basilic (little-finger side), the median cubital joining them across
 * the crease and the median antebrachial vein up the middle, each patient's a little different. Vein parts are named `vein*` (the
 * near-infrared map looks for them).
 */
import { mixSeed, mulberry32 } from '@/sim/rng'
import type { BodyBuilder, V3 } from '../body'
import type { PatientParams } from '../params'
import { tissue } from '../tissues'
import type { Landmarks } from './types'

const T = {
  skin: tissue('skin'),
  fat: tissue('fat'),
  muscle: tissue('muscle'),
  cortical: tissue('cortical'),
  marrow: tissue('marrow'),
  tendon: tissue('tendon'),
  blood: tissue('blood'),
  wall: tissue('vesselWall'),
}

/** The arm's axis, the crease and the wrist (before the build scale), and the half-axes of its section (across L, through P) at both. */
const ARM = { l: 232, p: 8, crease: 330, wrist: 80, elbowA: 40, elbowB: 33, wristA: 29, wristB: 20, skin: 1.6 }

export function buildForearm(b: BodyBuilder, p: PatientParams): Landmarks {
  const W = p.width
  const H = p.height
  const r = mulberry32(mixSeed(p.seed >>> 0, 0xa7a7))
  const u = (lo: number, hi: number): number => lo + (hi - lo) * r()
  const fat = 3 + p.fat * 0.12
  const cl = ARM.l * W
  const cp = ARM.p
  const zc = ARM.crease * H
  const zw = ARM.wrist * H
  const top = zc + 70 * H
  const ea = ARM.elbowA * W
  const eb = ARM.elbowB
  const wa = ARM.wristA * W
  const wb = ARM.wristB
  // the section's half-axes at a height (linear from the wrist to the elbow, constant above the crease)
  const at = (z: number): [number, number] => {
    const t = Math.max(0, Math.min(1, (z - zw) / (zc - zw)))
    return [wa + (ea - wa) * t, wb + (eb - wb) * t]
  }

  // skin and fat: the outline; the muscles inside it
  const outline = b.part('armOutline', T.fat, { layer: 1, smooth: 8, outline: true })
  outline.taper(cl, cp, zw - 20, zc, wa, wb, ea, eb).taper(cl, cp, zc, top, ea, eb, ea * 1.05, eb * 1.1)
  b.part('armSkin', T.skin, { layer: 2 }).taper(cl, cp, zw - 20, zc, wa, wb, ea, eb).taper(cl, cp, zc, top, ea, eb, ea * 1.05, eb * 1.1)
  b.part('armFat', T.fat, { layer: 3 }).taper(cl, cp, zw - 20, zc, wa - ARM.skin, wb - ARM.skin, ea - ARM.skin, eb - ARM.skin).taper(cl, cp, zc, top, ea - ARM.skin, eb - ARM.skin, ea * 1.05 - ARM.skin, eb * 1.1 - ARM.skin)
  const m = ARM.skin + fat
  b.part('flexors', T.muscle, { layer: 4, smooth: 6 }).taper(cl, cp - 4, zw, zc + 10, wa - m, wb - m - 2, ea - m, eb - m - 4)
  b.part('extensors', T.muscle, { layer: 4 }).taper(cl, cp + 8, zw, zc + 10, wa - m - 2, wb - m - 6, ea - m - 2, eb - m - 8)
  b.part('biceps', T.muscle, { layer: 4 }).ellipsoid([cl, cp - 10, zc + 60], [ea * 0.55, eb * 0.55, 60])

  // the bones: the radius on the thumb side (+L in this arm), the ulna on the other, and the humerus's lower end
  const bone = (name: string, a: V3, c: V3, rad: number): void => {
    b.part(`${name}Cortex`, T.cortical, { layer: 20 }).capsule(a, c, rad)
    b.part(`${name}Marrow`, T.marrow, { layer: 21 }).capsule(a, c, rad * 0.55)
  }
  bone('radius', [cl + wa * 0.45, cp + 4, zw + 6], [cl + ea * 0.35, cp + 6, zc - 8], 7)
  bone('ulna', [cl - wa * 0.45, cp + 8, zw + 6], [cl - ea * 0.4, cp + 14, zc + 4], 6.5)
  bone('humerus', [cl - 4, cp + 10, zc + 12], [cl, cp + 8, top], 11)
  b.part('bicepsTendon', T.tendon, { layer: 6 }).capsule([cl + 4, cp - eb * 0.45, zc + 40], [cl + ea * 0.2, cp - eb * 0.2, zc - 20], 3.4)

  // arteries (deep), with walls
  const artery = (name: string, pts: V3[], rad: number): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      b.part(`${name}Wall`, T.wall, { layer: 7 }).capsule(pts[i], pts[i + 1], rad + 0.6)
      b.part(name, T.blood, { layer: 8 }).capsule(pts[i], pts[i + 1], rad)
    }
  }
  const brachial: V3 = [cl - 2, cp - eb * 0.35, zc + 12]
  artery('arteryBrachial', [[cl - 6, cp - eb * 0.3, top], brachial], 2.4)
  artery('arteryRadial', [brachial, [cl + wa * 0.35, cp - wb * 0.55, zw]], 1.4)
  artery('arteryUlnar', [brachial, [cl - wa * 0.35, cp - wb * 0.45, zw]], 1.5)

  // the superficial veins: a few millimetres under the skin of the palm side
  const depthOf = 1.6 + fat * 0.5
  const onVolar = (l: number, z: number, d: number): V3 => {
    const [a, bb] = at(z)
    const x = (l - cl) / a
    const y = Math.sqrt(Math.max(0, 1 - x * x))
    // the point `d` mm under the skin of the palm side (-P) at across-position l
    return [l, cp - y * (bb - d), z]
  }
  const vein = (name: string, path: [number, number][], rad: number): void => {
    // veins meander: each leg is cut in four with a seeded sideways wander (ends stay put, so the veins still join)
    const fine: [number, number][] = [path[0]]
    for (let i = 0; i + 1 < path.length; i++) {
      const [l0, z0] = path[i]
      const [l1, z1] = path[i + 1]
      for (let k = 1; k <= 4; k++) {
        const t = k / 4
        const w = k < 4 ? u(-4, 4) * Math.sin(Math.PI * t) : 0
        fine.push([l0 + (l1 - l0) * t + w, z0 + (z1 - z0) * t])
      }
    }
    const pts = fine.map(([l, z]) => onVolar(l, z, depthOf + rad))
    for (let i = 0; i + 1 < pts.length; i++) {
      b.part(`vein${name}Wall`, T.wall, { layer: 9 }).capsule(pts[i], pts[i + 1], rad + 0.35)
      b.part(`vein${name}`, T.blood, { layer: 10 }).capsule(pts[i], pts[i + 1], rad)
    }
  }
  const ceph = cl + ea * u(0.55, 0.7)
  const basil = cl - ea * u(0.5, 0.68)
  const jitter = (): number => u(-3, 3)
  vein('Cephalic', [[cl + wa * 0.55, zw], [ceph - 2 + jitter(), (zw + zc) / 2], [ceph, zc - 10], [ceph + 2, top]], u(1.6, 2.2))
  vein('Basilic', [[cl - wa * 0.5, zw], [basil + jitter(), (zw + zc) / 2], [basil, zc + 5], [basil - 2, top]], u(1.7, 2.3))
  // the median cubital: from the cephalic below the crease up across it to the basilic: the vein a needle goes into
  const mcA: [number, number] = [ceph - 3, zc - u(22, 32)]
  const mcB: [number, number] = [basil + 3, zc + u(8, 18)]
  const mcR = u(1.9, 2.6)
  vein('MedianCubital', [mcA, [(mcA[0] + mcB[0]) / 2 + jitter(), (mcA[1] + mcB[1]) / 2 + jitter()], mcB], mcR)
  vein('Antebrachial', [[cl + jitter(), zw + 20], [cl + jitter(), (zw + zc) / 2], [(mcA[0] + mcB[0]) / 2, (mcA[1] + mcB[1]) / 2]], u(1.0, 1.5))

  const target = onVolar((mcA[0] + mcB[0]) / 2, (mcA[1] + mcB[1]) / 2, depthOf + mcR)
  const vdir: V3 = [mcB[0] - mcA[0], 0, mcB[1] - mcA[1]]
  const vl = Math.hypot(vdir[0], vdir[2]) || 1
  return {
    fossa: onVolar(cl, zc, 0),
    armAxis: [0, 0, 1],
    volar: [0, -1, 0],
    veinTarget: target,
    veinAxis: [vdir[0] / vl, 0, vdir[2] / vl],
  }
}
