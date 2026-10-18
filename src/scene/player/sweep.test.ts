import { describe, expect, it } from 'vitest'
import { newSweepHit, overlapCircleBox, overlapCircleCircle, sweepCircleBox, sweepCircleCircle } from './sweep'

/** A small deterministic generator (test code, not the seeded sim). */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Distance from a point to the oriented box (0 inside it). */
function boxDistance(px: number, pz: number, cx: number, cz: number, ux: number, uz: number, hu: number, hv: number): number {
  const ox = px - cx
  const oz = pz - cz
  const lx = ox * ux + oz * uz
  const lz = -ox * uz + oz * ux
  const qx = Math.max(Math.abs(lx) - hu, 0)
  const qz = Math.max(Math.abs(lz) - hv, 0)
  return Math.hypot(qx, qz)
}

const hit = newSweepHit()

describe('swept circle against an oriented box', () => {
  it('hits a face head on at the exact time, with the face normal, and stops R from it', () => {
    // a box 2 m wide (u = +x, hu 1) and 1 m deep (hv 0.5) at the origin; a circle R 0.3 coming from the west along z = 0 at x = -3, moving 4 m
    const ok = sweepCircleBox(-3, 0, 4, 0, 0.3, 0, 0, 1, 0, 1, 0.5, 1, hit)
    expect(ok).toBe(true)
    expect(hit.overlap).toBe(false)
    expect(hit.t).toBeCloseTo((3 - 1 - 0.3) / 4, 12)
    expect(hit.nx).toBeCloseTo(-1, 12)
    expect(hit.nz).toBeCloseTo(0, 12)
  })

  it('misses what is out of reach, what is behind, and what is only grazed along a face', () => {
    expect(sweepCircleBox(-3, 0, 1, 0, 0.3, 0, 0, 1, 0, 1, 0.5, 1, hit)).toBe(false) // too short
    expect(sweepCircleBox(-3, 0, -4, 0, 0.3, 0, 0, 1, 0, 1, 0.5, 1, hit)).toBe(false) // going away
    expect(sweepCircleBox(-3, 1, 6, 0, 0.3, 0, 0, 1, 0, 1, 0.5, 1, hit)).toBe(false) // passes 0.5 beyond the grown box
    // exactly R off the top face (z = hv + R) and moving along it: touching, sliding, not a hit
    expect(sweepCircleBox(-3, 0.5 + 0.3, 6, 0, 0.3, 0, 0, 1, 0, 1, 0.5, 1, hit)).toBe(false)
  })

  it('a corner is a rounded corner: the circle slides off it at an exact time and a normal pointing from the corner', () => {
    // coming at the (1, 0.5) corner from the south-east diagonal side, aimed at the corner itself
    const from = 1
    const ok = sweepCircleBox(from + 2, 0.5 + 2, -2, -2, 0.3, 0, 0, 1, 0, 1, 0.5, 1, hit)
    expect(ok).toBe(true)
    const px = from + 2 - 2 * hit.t
    const pz = 0.5 + 2 - 2 * hit.t
    expect(Math.hypot(px - 1, pz - 0.5)).toBeCloseTo(0.3, 9)
    expect(hit.nx).toBeCloseTo(Math.SQRT1_2, 9)
    expect(hit.nz).toBeCloseTo(Math.SQRT1_2, 9)
    expect(hit.nx * px + hit.nz * pz).toBeGreaterThan(0)
  })

  it('works for a rotated box (the frame of the box, not the world)', () => {
    const a = (30 * Math.PI) / 180
    const ux = Math.cos(a)
    const uz = Math.sin(a)
    // straight at the middle of the u-face, along the box's own axis
    const ok = sweepCircleBox(-4 * ux, -4 * uz, 6 * ux, 6 * uz, 0.3, 0, 0, ux, uz, 1, 0.5, 1, hit)
    expect(ok).toBe(true)
    expect(hit.t).toBeCloseTo((4 - 1 - 0.3) / 6, 12)
    expect(hit.nx).toBeCloseTo(-ux, 12)
    expect(hit.nz).toBeCloseTo(-uz, 12)
  })

  it('agrees with a fine brute-force march along the motion, for thousands of random boxes and motions (time, and the gap at the impact)', () => {
    const rnd = lcg(7)
    let hits = 0
    for (let n = 0; n < 2500; n++) {
      const a = rnd() * Math.PI * 2
      const ux = Math.cos(a)
      const uz = Math.sin(a)
      const hu = 0.2 + rnd() * 1.5
      const hv = 0.1 + rnd() * 1.0
      const R = 0.31
      const px = (rnd() - 0.5) * 8
      const pz = (rnd() - 0.5) * 8
      const dx = (rnd() - 0.5) * 6
      const dz = (rnd() - 0.5) * 6
      if (boxDistance(px, pz, 0, 0, ux, uz, hu, hv) < R) continue // starts overlapping: a different test
      const steps = 20000
      let first = -1
      for (let k = 0; k <= steps; k++) {
        const t = k / steps
        if (boxDistance(px + dx * t, pz + dz * t, 0, 0, ux, uz, hu, hv) < R - 1e-9) {
          first = t
          break
        }
      }
      const ok = sweepCircleBox(px, pz, dx, dz, R, 0, 0, ux, uz, hu, hv, 1, hit)
      expect(ok, `case ${n}`).toBe(first >= 0)
      if (ok) {
        hits++
        expect(Math.abs(hit.t - first), `case ${n}`).toBeLessThan(2e-4)
        const gap = boxDistance(px + dx * hit.t, pz + dz * hit.t, 0, 0, ux, uz, hu, hv)
        expect(gap, `case ${n}`).toBeCloseTo(R, 9)
        // the motion goes into the surface
        expect(dx * hit.nx + dz * hit.nz).toBeLessThan(0)
        expect(Math.hypot(hit.nx, hit.nz)).toBeCloseTo(1, 12)
      }
    }
    expect(hits).toBeGreaterThan(100)
  })

  it('starting inside the grown box: only the motion into it counts, along the nearest outward normal', () => {
    // 0.2 from the west face of a 2 x 1 box (inside the grown box, outside the box)
    expect(sweepCircleBox(-1.2, 0, 1, 0, 0.3, 0, 0, 1, 0, 1, 0.5, 1, hit)).toBe(true) // deeper in
    expect(hit.overlap).toBe(true)
    expect(hit.t).toBe(0)
    expect(hit.nx).toBeCloseTo(-1, 12)
    expect(hit.depth).toBeCloseTo(0.1, 12)
    expect(sweepCircleBox(-1.2, 0, -1, 0, 0.3, 0, 0, 1, 0, 1, 0.5, 1, hit)).toBe(false) // away from it
    expect(sweepCircleBox(-1.2, 0, 0, 1, 0.3, 0, 0, 1, 0, 1, 0.5, 1, hit)).toBe(false) // along it
  })

  it('a body with its centre INSIDE the box (put down on a seat) walks out the way it faces through any face, when the way out is short; a long way is the nearest face', () => {
    // a bench 3.6 x 0.6 (hu 1.8, hv 0.3): from the dead centre, out through either long side, and along the length
    for (const dz of [1, -1]) expect(sweepCircleBox(0, 0, 0, dz, 0.3, 0, 0, 1, 0, 1.8, 0.3, 1, hit), `out through z ${dz}`).toBe(false)
    expect(sweepCircleBox(0, 0, 1, 0, 0.3, 0, 0, 1, 0, 1.8, 0.3, 1, hit)).toBe(false) // 1.8 m to the end is more than MAX_ESCAPE: the nearest face is a side, and along it is free
    // a bed 1 x 2.1: from the middle, lengthways (1.05 m out), sideways, and 20 degrees off
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0], [0.34, 0.94]]) expect(sweepCircleBox(0, 0, dx, dz, 0.3, 0, 0, 1, 0, 0.5, 1.05, 1, hit), `bed ${dx},${dz}`).toBe(false)
    // inside a long wall (a body pushed in by something else): out through its thickness, either way
    expect(sweepCircleBox(0, 0.02, 0, -1, 0.3, 0, 0, 1, 0, 6, 0.1, 1, hit)).toBe(false)
    expect(sweepCircleBox(0, 0.02, 0, 1, 0.3, 0, 0, 1, 0, 6, 0.1, 1, hit)).toBe(false)
    // inside a very long thing whose ways out are all long: the nearest face holds
    expect(sweepCircleBox(0, 0.5, 0, -1, 0.3, 0, 0, 1, 0, 5, 4, 1, hit)).toBe(true) // 4.5 m out through the -z face, 3.5 m through the +z face: the nearest face holds (n = +z) and the motion goes against it
    expect(hit.overlap).toBe(true)
    expect(hit.nz).toBe(1)
  })

  it('a start that is sliding along a face (R from it, touching) and moving along it is never hit, even at the 1e-16 level', () => {
    const rnd = lcg(11)
    for (let n = 0; n < 500; n++) {
      const a = rnd() * Math.PI * 2
      const ux = Math.cos(a)
      const uz = Math.sin(a)
      const R = 0.31
      // a point exactly R off the +v face, anywhere along it (inside the face's extent), moving along u (either way) or into the face
      const lx = (rnd() - 0.5) * 1.8
      const lz = 0.5 + R
      const px = lx * ux - lz * uz
      const pz = lx * uz + lz * ux
      const s = rnd() < 0.5 ? -1 : 1
      expect(sweepCircleBox(px, pz, s * 0.05 * ux, s * 0.05 * uz, R, 0, 0, ux, uz, 1, 0.5, 1, hit), `along ${n}`).toBe(false)
      // into the face: a hit at 0 with the face normal
      expect(sweepCircleBox(px, pz, 0.05 * uz, -0.05 * ux, R, 0, 0, ux, uz, 1, 0.5, 1, hit), `into ${n}`).toBe(true)
      expect(hit.t).toBeLessThan(1e-9)
      expect(hit.nx * -uz + hit.nz * ux).toBeCloseTo(1, 9)
    }
  })

  it('reports a hit only when it is earlier than the best so far', () => {
    expect(sweepCircleBox(-3, 0, 4, 0, 0.3, 0, 0, 1, 0, 1, 0.5, 0.3, hit)).toBe(false) // it is at (3 - 1.3) / 4 = 0.425
    expect(sweepCircleBox(-3, 0, 4, 0, 0.3, 0, 0, 1, 0, 1, 0.5, 0.5, hit)).toBe(true)
  })
})

describe('swept circle against a circle', () => {
  it('hits at the exact time, from the right direction', () => {
    expect(sweepCircleCircle(-3, 0, 4, 0, 0.3, 0, 0, 0.5, 1, hit)).toBe(true)
    expect(hit.t).toBeCloseTo((3 - 0.8) / 4, 12)
    expect(hit.nx).toBeCloseTo(-1, 12)
    // off-centre: the contact is on the line between the centres
    expect(sweepCircleCircle(-3, 0.4, 4, 0, 0.3, 0, 0, 0.5, 1, hit)).toBe(true)
    const px = -3 + 4 * hit.t
    expect(Math.hypot(px, 0.4)).toBeCloseTo(0.8, 12)
    expect(hit.nx).toBeCloseTo(px / 0.8, 12)
    expect(hit.nz).toBeCloseTo(0.4 / 0.8, 12)
  })

  it('misses a pass beyond the radii, a circle behind, and a grazing pass at exactly the radii', () => {
    expect(sweepCircleCircle(-3, 0.81, 6, 0, 0.3, 0, 0, 0.5, 1, hit)).toBe(false)
    expect(sweepCircleCircle(-3, 0, -4, 0, 0.3, 0, 0, 0.5, 1, hit)).toBe(false)
    expect(sweepCircleCircle(-3, 0.8, 6, 0, 0.3, 0, 0, 0.5, 1, hit)).toBe(false) // tangent: nothing to push against
  })

  it('starting inside: into it counts, away from it does not, and from the dead centre of a small one every way out is free', () => {
    expect(sweepCircleCircle(0.5, 0, -1, 0, 0.3, 0, 0, 0.5, 1, hit)).toBe(true) // ON its edge, going in: the grown zone, a hit
    expect(sweepCircleCircle(0.6, 0, -1, 0, 0.3, 0, 0, 0.5, 1, hit)).toBe(true) // in the grown zone, going deeper
    expect(hit.overlap).toBe(true)
    expect(hit.depth).toBeCloseTo(0.2, 12)
    expect(sweepCircleCircle(0.6, 0, 1, 0, 0.3, 0, 0, 0.5, 1, hit)).toBe(false)
    // centre inside a stool: any direction out
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(sweepCircleCircle(0, 0, dx, dz, 0.3, 0, 0, 0.5, 1, hit)).toBe(false)
    expect(sweepCircleCircle(0.2, 0, -1, 0, 0.3, 0, 0, 0.5, 1, hit)).toBe(false)
  })
})

describe('overlap depths (for placing a body and for the push-out)', () => {
  it('a circle against a box and a circle: 0 when clear, the depth and the outward normal when not', () => {
    expect(overlapCircleBox(-2, 0, 0.3, 0, 0, 1, 0, 1, 0.5, hit)).toBe(0)
    expect(overlapCircleBox(-1.2, 0, 0.3, 0, 0, 1, 0, 1, 0.5, hit)).toBeCloseTo(0.1, 12)
    expect(hit.nx).toBeCloseTo(-1, 12)
    expect(overlapCircleBox(0, 0.4, 0.3, 0, 0, 1, 0, 1, 0.5, hit)).toBeCloseTo(0.4, 12) // 0.1 inside the north face + R
    expect(hit.nz).toBeCloseTo(1, 12)
    // the rounded corner
    expect(overlapCircleBox(1.1, 0.6, 0.3, 0, 0, 1, 0, 1, 0.5, hit)).toBeCloseTo(0.3 - Math.hypot(0.1, 0.1), 12)
    expect(overlapCircleCircle(0.5, 0, 0.3, 0, 0, 0.5, hit)).toBeCloseTo(0.3, 12)
    expect(hit.nx).toBe(1)
    expect(overlapCircleCircle(2, 0, 0.3, 0, 0, 0.5, hit)).toBe(0)
    expect(overlapCircleCircle(0, 0, 0.3, 0, 0, 0.5, hit)).toBeCloseTo(0.8, 12) // dead on top: a direction is chosen
    expect(Math.hypot(hit.nx, hit.nz)).toBe(1)
  })
})
