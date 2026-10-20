/**
 * R3 "Real screens": what the knee, ankle and wrist regions share: a joint's local frame and bones made as a thin cortex round marrow.
 *
 * A limb region is built alone (an X-ray or MR of one joint), so it owns the body's outline. Each joint is authored in its own millimetres:
 * `lat` toward the limb's lateral side (the thumb side for the wrist), `p` posterior, `s` toward the head, from the joint's centre; `at`
 * turns that into the patient frame (LPS) for the side being imaged (`p.side`: -1 the right, whose lateral is -L).
 *
 * Bones: cortex at layer 20, marrow at 21 (trabecular `marrow` in the ends, fatty `yellowMarrow` in the shafts). Only unions: the X-ray's
 * chords ignore subtracted members, so a hollow (the intercondylar notch) is soft tissue at a higher layer instead.
 */
import type { BodyBuilder, PartBuilder, V3 } from '../body'
import { tissue } from '../tissues'

export const LT = {
  fat: tissue('fat'),
  skin: tissue('skin'),
  muscle: tissue('muscle'),
  cortical: tissue('cortical'),
  marrow: tissue('marrow'),
  yellow: tissue('yellowMarrow'),
  /** An adult limb bone's end: trabecular bone round fatty marrow (dense on X-ray and CT, bright on T1 like fat). */
  cancellous: tissue('cancellous'),
  cartilage: tissue('cartilage'),
  tendon: tissue('tendon'),
  ligament: tissue('ligament'),
  meniscus: tissue('meniscus'),
  fluid: tissue('jointFluid'),
  blood: tissue('blood'),
  nerve: tissue('nerve'),
}

/** A joint's frame: its centre in the patient frame and the side. `at(lat, p, s)` is a local point in LPS. */
export interface JointFrame {
  at(lat: number, p: number, s: number): V3
  /** The lateral direction's sign along L. */
  side: -1 | 1
  centre: V3
}

export function jointFrame(centre: V3, side: -1 | 1): JointFrame {
  return { centre, side, at: (lat, p, s) => [centre[0] + side * lat, centre[1] + p, centre[2] + s] }
}

/** A bone end (an ellipsoid): cortex `shell` mm thick round trabecular marrow. Radii in (lat, p, s); rot in degrees about (L, P, S). */
export function boneEllipsoid(b: BodyBuilder, f: JointFrame, name: string, c: [number, number, number], r: V3, rot: V3 = [0, 0, 0], shell = 1.6): void {
  const at = f.at(...c)
  // a mirrored side turns the other way about P and S
  const rr: V3 = [rot[0], rot[1] * f.side, rot[2] * f.side]
  b.part(`${name}Cortex`, LT.cortical, { layer: 20 }).ellipsoid(at, r, rr)
  b.part(`${name}Marrow`, LT.marrow, { layer: 21 }).ellipsoid(at, [r[0] - shell, r[1] - shell, r[2] - shell], rr)
}

/** A long bone's shaft between two local points: a thick cortex round fatty marrow. */
export function boneShaft(b: BodyBuilder, f: JointFrame, name: string, a: [number, number, number], c: [number, number, number], r: number, shell: number, marrow = LT.yellow): void {
  b.part(`${name}Cortex`, LT.cortical, { layer: 20 }).capsule(f.at(...a), f.at(...c), r)
  b.part(`${name}Marrow`, marrow, { layer: 21 }).capsule(f.at(...a), f.at(...c), Math.max(0.8, r - shell))
}

/** A soft-tissue part from local members: `add(part, at)` adds them. */
export function soft(b: BodyBuilder, f: JointFrame, name: string, t: number, layer: number, add: (p: PartBuilder, at: JointFrame['at']) => void, smooth = 0): void {
  add(b.part(name, t, { layer, smooth }), f.at)
}

type Local = [number, number, number]

/**
 * One bone as ONE smooth shape: its members (in the joint's local frame) are unioned with rounding, once as the cortex and once, shrunk by
 * the cortex's thickness, as the marrow, so a flaring metaphysis, two condyles and a shaft read as one bone with a thin bright rim.
 * Members marked `solid` (a shaft, whose marrow is fatty and goes in its own part) are cortex only.
 */
export class Bone {
  private readonly members: { solid: boolean; add: (p: PartBuilder, inset: number) => void }[] = []

  constructor(
    private readonly b: BodyBuilder,
    private readonly f: JointFrame,
    readonly name: string,
    private readonly smooth = 6,
  ) {}

  ellipsoid(c: Local, r: V3, rot: V3 = [0, 0, 0]): this {
    const at = this.f.at(...c)
    const rr: V3 = [rot[0], rot[1] * this.f.side, rot[2] * this.f.side]
    this.members.push({ solid: false, add: (p, d) => p.ellipsoid(at, [Math.max(0.5, r[0] - d), Math.max(0.5, r[1] - d), Math.max(0.5, r[2] - d)], rr) })
    return this
  }

  box(c: Local, half: V3, round: number, rot: V3 = [0, 0, 0]): this {
    const at = this.f.at(...c)
    const rr: V3 = [rot[0], rot[1] * this.f.side, rot[2] * this.f.side]
    this.members.push({ solid: false, add: (p, d) => p.box(at, [half[0] - d, half[1] - d, half[2] - d], Math.max(0.5, round - d), rr) })
    return this
  }

  capsule(a: Local, c: Local, r: number, solid = false): this {
    const A = this.f.at(...a)
    const C = this.f.at(...c)
    this.members.push({ solid, add: (p, d) => p.capsule(A, C, Math.max(0.5, r - d)) })
    return this
  }

  cone(a: Local, c: Local, ra: number, rb: number, solid = false): this {
    const A = this.f.at(...a)
    const C = this.f.at(...c)
    this.members.push({ solid, add: (p, d) => p.cone(A, C, Math.max(0.5, ra - d), Math.max(0.5, rb - d)) })
    return this
  }

  /**
   * A piece of an elliptic tube along the limb (the body's axis) from local s0 to s1, half-axes (across, front-back) going from (a0, b0) to
   * (a1, b1): a flaring metaphysis, a flat plateau. `ends` says which caps are the bone's own surface (the marrow stops short of those).
   */
  taper(lat: number, p: number, s0: number, s1: number, a0: number, b0: number, a1: number, b1: number, ends: 'none' | 'top' | 'bottom' | 'both' = 'none', solid = false): this {
    const c = this.f.at(lat, p, 0)
    const z = this.f.centre[2]
    this.members.push({
      solid,
      add: (pb, d) => {
        const lo = ends === 'bottom' || ends === 'both' ? d : 0
        const hi = ends === 'top' || ends === 'both' ? d : 0
        pb.taper(c[0], c[1], z + s0 + lo, z + s1 - hi, Math.max(0.5, a0 - d), Math.max(0.5, b0 - d), Math.max(0.5, a1 - d), Math.max(0.5, b1 - d))
      },
    })
    return this
  }

  /** The cortex (layer 20) and the cancellous bone (layer 21) `shell` mm inside it. */
  build(shell = 1.5): void {
    const cortex = this.b.part(`${this.name}Cortex`, LT.cortical, { layer: 20, smooth: this.smooth })
    for (const m of this.members) m.add(cortex, 0)
    const inner = this.members.filter((m) => !m.solid)
    if (inner.length === 0) return
    const marrow = this.b.part(`${this.name}Marrow`, LT.cancellous, { layer: 21, smooth: this.smooth })
    for (const m of inner) m.add(marrow, shell)
  }
}

/** A shaft's fatty marrow (its cortex is a solid member of the bone). */
export function shaftMarrow(b: BodyBuilder, f: JointFrame, name: string, a: Local, c: Local, r: number): void {
  b.part(`${name}Yellow`, LT.yellow, { layer: 21 }).capsule(f.at(...a), f.at(...c), r)
}
