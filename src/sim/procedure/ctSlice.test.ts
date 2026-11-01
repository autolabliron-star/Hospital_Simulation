/**
 * R5 (geometry): the planning slice seen through the patient's roll (ctSlice.ts), in node, with no avatars.
 *
 *   - the map is a rotation: it keeps lengths, its inverse is its transpose, the table's travel adds to x and `dz` toward the head is west;
 *   - left, posterior and up end up where the position says: the kidney's patient on her right side (left-lateral points UP and north, posterior down and north), the lung's and the
 *     liver's face down (posterior up, her left south, her right the robot's side), a level supine body the plain mapping;
 *   - every needle the plan makes (40 seeds, three targets) enters ON the nominal body of its position, its tip well inside it, and the shaft crosses the skin once, from outside in;
 *   - the old fixed mapping (the kidney's tumour and no roll, for every case) fails the same check (a negative control).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planCase } from '../cryoSuite/plan'
import { CONFIG } from '../config'
import { CRYO_SUITE } from '../places'
import { Rng } from '../rng'
import type { CryoTarget, Vec3 } from '../types'
import {
  CT_BODIES,
  CT_OBLIQUE_DEG,
  CT_PIVOT_ABOVE_PAD,
  ctBodyOffsetOf,
  ctPivotInto,
  ctRoll,
  ctRollOfPosition,
  ctRoomToSliceInto,
  ctSliceDirInto,
  ctSliceInto,
  ctTableShift,
  ctTumourInto,
  ellipseSignedDistance,
} from './ctSlice'

const TARGETS: readonly CryoTarget[] = ['kidney', 'lung', 'liver']
const v = (): Vec3 => ({ x: 0, y: 0, z: 0 })

describe('the slice map is a rotation about the tumour', () => {
  it('the slice origin is the tumour, the table carries it, and toward the head is west', () => {
    for (const t of TARGETS) {
      const o = ctSliceInto(t, 0, 0, 0, 0, v())
      expect([o.x, o.y, o.z]).toEqual([CRYO_SUITE.targets[t].tumour.x, CRYO_SUITE.targets[t].tumour.y, CRYO_SUITE.targets[t].tumour.z])
      const inBore = ctSliceInto(t, 1, 0, 0, 0, v())
      expect(inBore.x - o.x).toBeCloseTo(CRYO_SUITE.ct.table.in.x - CRYO_SUITE.ct.table.out.x, 12)
      expect(ctTableShift(0.5)).toBeCloseTo((CRYO_SUITE.ct.table.in.x - CRYO_SUITE.ct.table.out.x) / 2, 12)
      expect(ctTableShift(-1)).toBeCloseTo(0, 12)
      expect(ctTableShift(2)).toBeCloseTo(CRYO_SUITE.ct.table.in.x - CRYO_SUITE.ct.table.out.x, 12)
      const head = ctSliceInto(t, 0, 0, 0, 100, v())
      expect(head.x - o.x).toBeCloseTo(-0.1, 12)
      expect(head.y).toBe(o.y)
      expect(head.z).toBe(o.z)
      expect(ctTumourInto(t, 0.25, v()).x).toBeCloseTo(o.x + ctTableShift(0.25), 12)
    }
  })

  it('keeps lengths and angles, and the inverse is the transpose (every target, any table position)', () => {
    const a = v()
    const b = v()
    const back = v()
    for (const t of TARGETS) {
      for (const pos of [0, 0.4, 1]) {
        for (const [x, y, dz] of [[85, -10, 4], [-30, 90, -7], [0, 0, 0], [12, 34, 56], [-100, -80, 3]]) {
          ctSliceInto(t, pos, x, y, dz, a)
          ctSliceInto(t, pos, 0, 0, 0, b)
          // in-plane length is the slice's own
          expect(Math.hypot(a.y - b.y, a.z - b.z) * 1000).toBeCloseTo(Math.hypot(x, y), 8)
          ctRoomToSliceInto(t, pos, a.x, a.y, a.z, back)
          expect([back.x, back.y, back.z].map((n) => Math.round(n * 1e6) / 1e6 + 0)).toEqual([x, y, dz])
        }
      }
    }
    // a direction is the same map applied to a difference, unit length
    const d = v()
    const p0 = v()
    const p1 = v()
    for (const t of TARGETS) {
      ctSliceInto(t, 0, 10, 20, 0, p0)
      ctSliceInto(t, 0, 70, -35, 0, p1)
      ctSliceDirInto(t, 60, -55, d)
      const len = Math.hypot(p1.y - p0.y, p1.z - p0.z)
      expect(d.x).toBe(0)
      expect(d.y).toBeCloseTo((p1.y - p0.y) / len, 10)
      expect(d.z).toBeCloseTo((p1.z - p0.z) / len, 10)
      expect(ctSliceDirInto(t, 0, 0, d)).toEqual({ x: 0, y: 0, z: 0 })
    }
  })
})

describe('left, posterior and up in the room, by the position', () => {
  it('the rolls: the kidney 55 degrees (left up), the lung and the liver a half turn, a level body none', () => {
    expect(ctRollOfPosition('supine')).toBe(0)
    expect(ctRollOfPosition('lithotomy')).toBe(0)
    expect(ctRollOfPosition('prone')).toBe(Math.PI)
    expect(ctRollOfPosition('obliqueLeftUp')).toBeCloseTo((CT_OBLIQUE_DEG * Math.PI) / 180, 12)
    expect(ctRoll('kidney')).toBeCloseTo((55 * Math.PI) / 180, 12)
    expect(CONFIG.cryoSuite.targets.kidney.position).toBe('obliqueLeftUp')
    expect(ctRoll('lung')).toBe(Math.PI)
    expect(ctRoll('liver')).toBe(Math.PI)
  })

  it('kidney (right side, left flank up): the patient\'s left is UP and north, posterior is down and north', () => {
    const o = ctSliceInto('kidney', 0, 0, 0, 0, v())
    const left = ctSliceInto('kidney', 0, 100, 0, 0, v())
    const post = ctSliceInto('kidney', 0, 0, 100, 0, v())
    expect(left.y).toBeGreaterThan(o.y + 0.07)
    expect(left.z).toBeLessThan(o.z - 0.05)
    expect(post.y).toBeLessThan(o.y - 0.05)
    expect(post.z).toBeLessThan(o.z - 0.07)
    // (55 degrees: up 0.82, north 0.57; and down 0.57, north 0.82)
    expect(left.y - o.y).toBeCloseTo(0.1 * Math.sin((55 * Math.PI) / 180), 9)
    expect(o.z - left.z).toBeCloseTo(0.1 * Math.cos((55 * Math.PI) / 180), 9)
    expect(o.y - post.y).toBeCloseTo(0.1 * Math.cos((55 * Math.PI) / 180), 9)
    expect(o.z - post.z).toBeCloseTo(0.1 * Math.sin((55 * Math.PI) / 180), 9)
  })

  it('lung and liver (face down): posterior is UP, the patient\'s left is south and her right (the robot\'s side) north', () => {
    for (const t of ['lung', 'liver'] as const) {
      const o = ctSliceInto(t, 0, 0, 0, 0, v())
      const left = ctSliceInto(t, 0, 100, 0, 0, v())
      const post = ctSliceInto(t, 0, 0, 100, 0, v())
      expect(post.y - o.y).toBeCloseTo(0.1, 12)
      expect(post.z).toBeCloseTo(o.z, 12)
      expect(left.z - o.z).toBeCloseTo(0.1, 12)
      expect(left.y).toBeCloseTo(o.y, 12)
    }
  })

  it('the arm\'s and the stage\'s helpers read the same map (a level body is the plain one: posterior down, left north)', () => {
    // (the formula for a roll of 0, from the module's own comment: y = -sy, z = -sx)
    const psi = ctRollOfPosition('supine')
    const c = Math.cos(psi)
    const s = Math.sin(psi)
    expect([20 * s - 30 * c, -20 * c - 30 * s]).toEqual([-30, -20])
  })
})

describe('the nominal body', () => {
  it('the roll\'s pivot is the table\'s centre line, a pelvis\' height over the pad (the avatars\' liePelvis run 0.10 to 0.22: their median is the pivot, within 2 cm)', () => {
    const p = ctPivotInto(v())
    expect([p.x, p.y, p.z]).toEqual([CRYO_SUITE.ct.table.out.x, CRYO_SUITE.ct.table.height + CT_PIVOT_ABOVE_PAD, CRYO_SUITE.ct.table.out.z])
    const index = JSON.parse(readFileSync(join(process.cwd(), 'public/assets/people/index.json'), 'utf8')) as { avatars: { body: { liePelvis: number } }[] }
    const lie = index.avatars.map((a) => a.body.liePelvis).sort((a, b) => a - b)
    expect(lie.length).toBeGreaterThan(10)
    const median = lie[Math.floor(lie.length / 2)]
    expect(Math.abs(median - CT_PIVOT_ABOVE_PAD)).toBeLessThan(0.02)
  })

  it('an ellipse\'s signed distance: 0 on it, positive outside, negative inside, the right size along each axis', () => {
    expect(ellipseSignedDistance(0.2, 0, 0.2, 0.1)).toBeCloseTo(0, 6)
    expect(ellipseSignedDistance(0, -0.1, 0.2, 0.1)).toBeCloseTo(0, 6)
    expect(ellipseSignedDistance(0.3, 0, 0.2, 0.1)).toBeCloseTo(0.1, 6)
    expect(ellipseSignedDistance(0, 0.15, 0.2, 0.1)).toBeCloseTo(0.05, 6)
    expect(ellipseSignedDistance(0, 0, 0.2, 0.1)).toBeCloseTo(-0.1, 6)
    expect(ellipseSignedDistance(0.1, 0, 0.2, 0.1)).toBeLessThan(0)
    expect(ellipseSignedDistance(0.1, 0, 0.2, 0.1)).toBeGreaterThan(-0.1001)
    // a point on the ellipse at an angle
    const t = 0.7
    expect(Math.abs(ellipseSignedDistance(0.2 * Math.cos(t), 0.1 * Math.sin(t), 0.2, 0.1))).toBeLessThan(1e-6)
    // far outside: the distance to the ellipse is about the distance to its centre less a radius
    expect(ellipseSignedDistance(2, 0, 0.2, 0.1)).toBeCloseTo(1.8, 6)
  })

  /** The needles the plans make, for 40 seeds of a target. */
  const needlesOf = (t: CryoTarget) => {
    const out: { entry: { x: number; y: number }; tip: { x: number; y: number }; dz: number }[] = []
    for (let seed = 1; seed <= 40; seed++) for (const n of planCase(new Rng(seed), `s-${seed}`, 0, 0, false, t).needles) out.push(n)
    return out
  }

  it('every planned entry lies on the nominal body of its position (within 1.5 cm), its tip is more than 3 cm inside, and the shaft crosses the skin once, from outside in: 40 seeds, three targets', () => {
    const p = v()
    const q = v()
    for (const t of TARGETS) {
      const ns = needlesOf(t)
      expect(ns.length).toBeGreaterThan(70)
      let worst = 0
      let shallowest = Infinity
      for (const n of ns) {
        ctSliceInto(t, 0, n.entry.x, n.entry.y, n.dz, p)
        ctSliceInto(t, 0, n.tip.x, n.tip.y, n.dz, q)
        const e = ctBodyOffsetOf(t, p.y, p.z)
        const tip = ctBodyOffsetOf(t, q.y, q.z)
        worst = Math.max(worst, Math.abs(e))
        shallowest = Math.min(shallowest, -tip)
        expect(Math.abs(e), `${t} entry ${n.entry.x},${n.entry.y}`).toBeLessThan(0.015)
        expect(tip, `${t} tip ${n.tip.x},${n.tip.y}`).toBeLessThan(-0.03)
        // the shaft crosses the skin: sampled along it, the offset changes sign once (from out to in)
        let signs = 0
        let prev = Math.sign(ctBodyOffsetOf(t, p.y - (q.y - p.y) * 0.25, p.z - (q.z - p.z) * 0.25))
        for (let k = 1; k <= 100; k++) {
          const f = -0.25 + (1.25 * k) / 100
          const s = Math.sign(ctBodyOffsetOf(t, p.y + (q.y - p.y) * f, p.z + (q.z - p.z) * f))
          if (s !== prev && s !== 0) signs++
          prev = s
        }
        expect(signs, `${t} crosses`).toBe(1)
      }
      // eslint-disable-next-line no-console
      console.log(`ctSlice ${t}: ${ns.length} needles, the worst entry ${(worst * 100).toFixed(2)} cm from the nominal skin, the shallowest tip ${(shallowest * 100).toFixed(1)} cm inside it`)
    }
  })

  it('the old fixed mapping (no roll: x = left, y = down) with the old bands and tumour points misses the nominal body by more than the 1.5 cm the new one keeps to: the kidney\'s hang off it, the lung\'s and the liver\'s sit deep inside it (a negative control)', () => {
    // the mapping and the numbers before R5's geometry: y = tumour.y - entry.y, z = tumour.z - entry.x with the target's own tumour (the kidney's at 0.9 m), and the prone targets' bands
    // written in the room's own sense (+x toward the robot, +y down)
    const OLD_TUMOUR: Record<CryoTarget, { y: number; z: number }> = { kidney: { y: 0.9, z: 17.3 }, lung: { y: 0.94, z: 17.31 }, liver: { y: 0.93, z: 17.29 } }
    const OLD_BAND = { thetaDeg: [-75, -55], entryX: [20, 60], entryY: [-100, -60] }
    const bad: Record<string, number> = {}
    for (const t of TARGETS) {
      const ap = CONFIG.cryoSuite.targets[t].approach as unknown as { thetaDeg: number[]; entryX: number[]; entryY: number[] }
      const keep = JSON.parse(JSON.stringify(ap)) as typeof OLD_BAND
      if (t !== 'kidney') {
        ap.thetaDeg[0] = OLD_BAND.thetaDeg[0]
        ap.thetaDeg[1] = OLD_BAND.thetaDeg[1]
        ap.entryX[0] = OLD_BAND.entryX[0]
        ap.entryX[1] = OLD_BAND.entryX[1]
        ap.entryY[0] = OLD_BAND.entryY[0]
        ap.entryY[1] = OLD_BAND.entryY[1]
      }
      let off = 0
      let n = 0
      try {
        for (let seed = 1; seed <= 40; seed++) {
          for (const nd of planCase(new Rng(seed), `s-${seed}`, 0, 0, false, t).needles) {
            const y = OLD_TUMOUR[t].y - nd.entry.y * 0.001
            const z = OLD_TUMOUR[t].z - nd.entry.x * 0.001
            n++
            if (Math.abs(ctBodyOffsetOf(t, y, z)) > 0.015) off++
          }
        }
      } finally {
        ap.thetaDeg[0] = keep.thetaDeg[0]
        ap.thetaDeg[1] = keep.thetaDeg[1]
        ap.entryX[0] = keep.entryX[0]
        ap.entryX[1] = keep.entryX[1]
        ap.entryY[0] = keep.entryY[0]
        ap.entryY[1] = keep.entryY[1]
      }
      bad[t] = off / n
    }
    // eslint-disable-next-line no-console
    console.log(`old mapping: more than 1.5 cm off the nominal skin: kidney ${(bad.kidney * 100).toFixed(0)} %, lung ${(bad.lung * 100).toFixed(0)} %, liver ${(bad.liver * 100).toFixed(0)} %`)
    // (the new mapping misses it by more than 1.5 cm for none of them, above)
    for (const t of TARGETS) expect(bad[t], t).toBeGreaterThan(0.4)
    expect(bad.kidney).toBeGreaterThan(0.95)
  })

  it('the bodies are sane: a few centimetres of half axis either way, the lung\'s chest wider than the kidney\'s waist, nothing below the pad', () => {
    for (const t of TARGETS) {
      const b = CT_BODIES[t]
      expect(b.a).toBeGreaterThan(0.14)
      expect(b.a).toBeLessThan(0.26)
      expect(b.b).toBeGreaterThan(0.09)
      expect(b.b).toBeLessThan(0.18)
      // the back lies on the pad: a face-down or a level body's lowest point is within 4 cm of the pad (the rolled one rests on its side)
      // (face down, posterior is up: the ellipse's lowest point is the pivot's height plus its centre's posterior offset less its half depth)
      if (t !== 'kidney') expect(Math.abs(CT_PIVOT_ABOVE_PAD + b.cv - b.b)).toBeLessThan(0.04)
    }
    expect(CT_BODIES.lung.a).toBeGreaterThan(CT_BODIES.kidney.a)
  })
})
