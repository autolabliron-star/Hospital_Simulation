/**
 * The lab's track as the contract defines it (src/sim/labTrack.ts), and that the room is built round it: a closed loop, a continuous path,
 * module stops in sample order on the outbound lane, the two lanes 0.12 m apart, the whole loop on the bench, every stop beside its module.
 */
import { describe, expect, it } from 'vitest'
import { LAB } from '@/sim/places'
import { LAB_LOOP_LENGTH, LAB_OUTBOUND_LENGTH, LAB_STOPS, labTrackDirInto, labTrackPointInto } from '@/sim/labTrack'
import { BENCH, BENCH_LEGS, GRIPPER_IDS, gripperAt, HOUSINGS, PROBE_IDS, probeAt, stopPoint, TURNTABLES } from './labDims'

const p = { x: 0, z: 0 }

describe('the lab track (contract geometry)', () => {
  it('is a closed loop: the end meets the start and the position wraps', () => {
    const a = labTrackPointInto(0, { x: 0, z: 0 })
    const b = labTrackPointInto(LAB_LOOP_LENGTH, { x: 0, z: 0 })
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-6)
    const c = labTrackPointInto(LAB_LOOP_LENGTH + 3.2, { x: 0, z: 0 })
    const d = labTrackPointInto(3.2, { x: 0, z: 0 })
    expect(Math.hypot(c.x - d.x, c.z - d.z)).toBeLessThan(1e-6)
    expect(LAB_LOOP_LENGTH).toBeGreaterThan(18)
    expect(LAB_LOOP_LENGTH).toBeLessThan(26)
  })

  it('is continuous: 1 cm of path is never more than 1.1 cm of floor', () => {
    let prev = labTrackPointInto(0, { x: 0, z: 0 })
    let worst = 0
    for (let s = 0.01; s <= LAB_LOOP_LENGTH + 0.5; s += 0.01) {
      const q = labTrackPointInto(s, { x: 0, z: 0 })
      worst = Math.max(worst, Math.hypot(q.x - prev.x, q.z - prev.z))
      prev = q
    }
    expect(worst).toBeLessThan(0.0115)
  })

  it('puts the module stops in the sample order, increasing along the outbound lane', () => {
    const order = ['camera', 'cfg0', 'cfg1', 'decap', 'haem', 'chem', 'immuno', 'coag', 'recap', 'archive']
    expect(LAB.modules.map((m) => m.id)).toEqual(order)
    let last = -1
    for (const id of order) {
      expect(LAB_STOPS[id], id).toBeGreaterThan(last)
      last = LAB_STOPS[id]
    }
    expect(last).toBeLessThan(LAB_OUTBOUND_LENGTH)
    // neighbouring stops are far enough apart for a puck each (a puck is 4.4 cm across)
    for (let i = 1; i < order.length; i++) expect(LAB_STOPS[order[i]] - LAB_STOPS[order[i - 1]]).toBeGreaterThan(0.3)
  })

  it('has the return lane 0.12 m from the outbound lane along the straight legs', () => {
    const ret: { x: number; z: number }[] = []
    for (let s = LAB_OUTBOUND_LENGTH + 0.4; s < LAB_LOOP_LENGTH - 0.4; s += 0.02) ret.push(labTrackPointInto(s, { x: 0, z: 0 }))
    // outbound points on the middle of each leg: 0.5 m in from either end (clear of the arcs and the turntables)
    const samples = [1.2, 2.4, 5.5, 6.4, 7.2, 8.9, 9.6]
    for (const s of samples) {
      const a = labTrackPointInto(s, p)
      let best = Infinity
      for (const q of ret) best = Math.min(best, Math.hypot(q.x - a.x, q.z - a.z))
      expect(best, `s = ${s}`).toBeCloseTo(LAB.laneGap, 2)
    }
  })

  it('moves forward only: the direction at any point is a unit vector along the leg it is on', () => {
    const d = { x: 0, z: 0 }
    for (const [s, ex, ez] of [
      [1.5, 0, 1],
      [6, 1, 0],
      [9.5, 0, -1],
    ] as const) {
      labTrackDirInto(s, d)
      expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 6)
      expect(d.x * ex + d.z * ez).toBeGreaterThan(0.99)
    }
  })

  it('lies on the bench: every point of the loop is on a bench leg or a turntable', () => {
    const on = (x: number, z: number): boolean =>
      BENCH_LEGS.some((l) => x >= l.x0 - 1e-6 && x <= l.x1 + 1e-6 && z >= l.z0 - 1e-6 && z <= l.z1 + 1e-6) || TURNTABLES.some((t) => Math.hypot(x - t.x, z - t.z) <= t.r + 1e-6)
    const off: string[] = []
    for (let s = 0; s < LAB_LOOP_LENGTH; s += 0.02) {
      const q = labTrackPointInto(s, { x: 0, z: 0 })
      if (!on(q.x, q.z)) off.push(`s=${s.toFixed(2)} (${q.x.toFixed(2)}, ${q.z.toFixed(2)})`)
    }
    expect(off).toEqual([])
    expect(BENCH.y).toBe(0.86)
  })

  it('puts every module stop on the bench beside its housing, and each probe and gripper over its stop', () => {
    for (const h of HOUSINGS) {
      const stop = stopPoint(h.id)
      // the stop is within 0.4 m of the housing's face that looks at the track
      const dx = Math.max(h.x0 - stop.x, 0, stop.x - h.x1)
      const dz = Math.max(h.z0 - stop.z, 0, stop.z - h.z1)
      expect(Math.hypot(dx, dz), h.id).toBeLessThan(0.4)
    }
    for (const id of PROBE_IDS) {
      const pr = probeAt(id)
      const stop = stopPoint(id)
      expect(Math.hypot(pr.x - stop.x, pr.z - stop.z)).toBeLessThan(1e-9)
    }
    for (const id of GRIPPER_IDS) {
      if (id === 'sort') continue
      const g = gripperAt(id)
      const stop = stopPoint(id)
      expect(Math.hypot(g.x - stop.x, g.z - stop.z)).toBeLessThan(1e-9)
    }
    // the sorter works at the start of the belt
    const start = labTrackPointInto(0, { x: 0, z: 0 })
    const sort = gripperAt('sort')
    expect(Math.hypot(sort.x - start.x, sort.z - start.z)).toBeLessThan(0.1)
  })

  it('has housings that contain the contract\'s module centres (the housings are the contract\'s modules, drawn)', () => {
    for (const m of LAB.modules) {
      if (m.id === 'camera') continue // an arch over the belt, not a housing
      const h = HOUSINGS.find((q) => q.id === m.id)!
      expect(h, m.id).toBeDefined()
      expect(m.center.x, m.id).toBeGreaterThanOrEqual(h.x0 - 1e-9)
      expect(m.center.x, m.id).toBeLessThanOrEqual(h.x1 + 1e-9)
      expect(m.center.z, m.id).toBeGreaterThanOrEqual(h.z0 - 1e-9)
      expect(m.center.z, m.id).toBeLessThanOrEqual(h.z1 + 1e-9)
      expect(h.kind).toBe(m.kind)
    }
  })
})
