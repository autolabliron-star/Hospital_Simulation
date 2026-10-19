import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import { CIRCUITS, pointAt, type PathPoint } from '../meds/circuit'
import { PNEUMATIC } from '../places'
import { PNEUMATIC_PATHS, flightDuration, pathPointInto } from '../pneumaticPath'
import type { Vec3 } from '../types'
import { DT, makeBench } from './testkit'

describe('the pneumatic route (the contract geometry)', () => {
  it('every point of every path stays at least 0.45 m (in plan) from both wards\' pod rails', () => {
    const rail: PathPoint = { x: 0, z: 0, heading: 0 }
    const railPts: { x: number; z: number }[] = []
    for (const c of Object.values(CIRCUITS)) for (let s = 0; s < c.length; s += 0.04) railPts.push({ ...pointAt(c, s, rail) })
    const at: Vec3 = { x: 0, y: 0, z: 0 }
    let worst = Infinity
    let where = ''
    for (let src = 0; src < PNEUMATIC_PATHS.length; src++) {
      const len = PNEUMATIC_PATHS[src].length
      for (let d = 0; d <= len; d += 0.02) {
        pathPointInto(src, d, at)
        for (const r of railPts) {
          const dist = Math.hypot(at.x - r.x, at.z - r.z)
          if (dist < worst) {
            worst = dist
            where = `source ${src} at ${d.toFixed(2)} m (${at.x.toFixed(2)}, ${at.z.toFixed(2)})`
          }
        }
      }
    }
    expect(worst, `closest approach ${worst.toFixed(3)} m: ${where}`).toBeGreaterThanOrEqual(0.45)
  })

  it('the paths join the trunk and end at the lab\'s receive station', () => {
    const end = PNEUMATIC.trunk[PNEUMATIC.trunk.length - 1]
    const at: Vec3 = { x: 0, y: 0, z: 0 }
    for (let src = 0; src < PNEUMATIC_PATHS.length; src++) {
      pathPointInto(src, PNEUMATIC_PATHS[src].length, at)
      expect(Math.hypot(at.x - end.x, at.y - end.y, at.z - end.z)).toBeLessThan(1e-9)
      expect(PNEUMATIC_PATHS[src].length).toBeGreaterThan(8)
    }
  })
})

describe('the pneumatic line', () => {
  it('flies one tube at a time, first in first out, and a flight lasts flightDuration(length)', () => {
    const b = makeBench()
    const flights: { id: string; src: number; t0: number; t1: number; len: number; dur: number }[] = []
    let flying = 0
    let maxFlying = 0
    b.lab.pneumatic.onLaunch = (job, t, len, dur) => {
      flying++
      maxFlying = Math.max(maxFlying, flying)
      flights.push({ id: job.sample.id, src: job.sample.where.source, t0: t, t1: NaN, len, dur })
    }
    b.lab.pneumatic.onLand = (job, t) => {
      flying--
      flights.find((f) => f.id === job.sample.id)!.t1 = t
    }
    // three patients at once, from different robots: 4 + 4 + 2 tubes
    const orders = [
      b.inject({ panel: 'er-chest', priority: 'stat', source: 0 }),
      b.inject({ panel: 'er-fever', priority: 'stat', source: 2 }),
      b.inject({ panel: 'op-diabetes', priority: 'routine', source: 1 }),
    ]
    const expected = orders.flatMap((o) => o.sampleIds)
    const seenInFlight = new Set<string>()
    let multi = 0
    b.run(120, () => {
      const id = b.lab.state.pneumatic.inFlight
      if (id) seenInFlight.add(id)
      let n = 0
      for (const s of b.lab.samples.samples.values()) if (s.where.line === 'pneumatic' && s.where.s > 0 && b.lab.state.pneumatic.inFlight === s.id) n++
      if (n > 1) multi++
    })
    expect(maxFlying).toBe(1)
    expect(multi).toBe(0)
    // FIFO: launched in the order they were sent
    expect(flights.map((f) => f.id)).toEqual(expected)
    expect(flights.length).toBe(expected.length)
    for (const f of flights) {
      expect(f.len).toBeCloseTo(PNEUMATIC_PATHS[f.src].length, 9)
      expect(f.dur).toBeCloseTo(flightDuration(PNEUMATIC_PATHS[f.src].length), 9)
      // launched and landed on a step boundary: the flight lasts its duration to within one step
      expect(f.t1 - f.t0).toBeGreaterThanOrEqual(f.dur - 1e-9)
      expect(f.t1 - f.t0).toBeLessThan(f.dur + DT + 1e-9)
    }
    // sendGapSeconds between one landing and the next launch
    for (let i = 1; i < flights.length; i++) expect(flights[i].t0 - flights[i - 1].t1).toBeGreaterThanOrEqual(CONFIG.lab.sendGapSeconds - 1e-9)
    expect(b.lab.state.pneumatic.sentToday).toBe(expected.length)
    expect(b.lab.state.pneumatic.inFlight).toBeNull()
    expect(b.lab.state.pneumatic.queued).toBe(0)
  })

  it('moves the sample along its path while it flies (where.s follows flightDistance) and keeps it in the line until received', () => {
    const b = makeBench()
    const order = b.inject({ panel: 'op-precontrast', priority: 'routine', source: 3 })
    const s = b.lab.samples.get(order.sampleIds[0])!
    expect(s.stage).toBe('inTube')
    expect(s.where.line).toBe('pneumatic')
    expect(s.where.source).toBe(3)
    const len = PNEUMATIC_PATHS[3].length
    const seen: number[] = []
    let receivedAt = NaN
    b.run(8, (t) => {
      if (s.where.line === 'pneumatic') seen.push(s.where.s)
      if (Number.isNaN(receivedAt) && s.stage === 'received') receivedAt = t
    })
    // monotone, reaches the end of the path, then waits there for the receive time
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] - 1e-12)
    expect(Math.max(...seen)).toBeCloseTo(len, 9)
    expect(s.stageAt.inTube).toBeDefined()
    expect(s.stageAt.received! - s.stageAt.inTube!).toBeGreaterThanOrEqual(flightDuration(len) + CONFIG.lab.receiveSeconds - 1e-9)
    expect(s.stageAt.received! - s.stageAt.inTube!).toBeLessThan(flightDuration(len) + CONFIG.lab.receiveSeconds + 3 * DT)
  })

  it('logs one "samplesReceived" per order, when its last tube arrives', () => {
    const b = makeBench()
    const a = b.inject({ panel: 'er-chest', priority: 'stat', source: 0, ticket: 'V004', kind: 'er' })
    b.inject({ panel: 'op-precontrast', priority: 'routine', source: 1, kind: 'outpatient', patientId: 'x7' })
    b.run(60)
    const ev = b.world.log.events.filter((e) => e.type === 'samplesReceived')
    expect(ev.map((e) => e.text)).toEqual(["Lab received V004's samples.", "Lab received Bench x7's samples."])
    // logged after the 4th tube of the first order was received, not after the first
    expect(ev[0].t).toBeCloseTo(b.lab.orderById(a.id)!.receivedAt!, 9)
    expect(ev[0].t).toBeGreaterThanOrEqual(Math.max(...a.sampleIds.map((id) => b.lab.samples.get(id)!.stageAt.received!)) - 1e-9)
  })

  it('rejects unknown samples and risers, and ignores a second send', () => {
    const b = makeBench()
    expect(() => b.lab.send('nope', 0)).toThrow()
    const o = b.lab.order({ patientId: 'p', patientName: 'P', source: 'outpatient', panel: 'op-precontrast', priority: 'routine' })
    expect(() => b.lab.send(o.sampleIds[0], 4)).toThrow()
    b.lab.send(o.sampleIds[0], 0)
    b.lab.send(o.sampleIds[0], 1)
    b.run(30)
    expect(b.lab.state.pneumatic.sentToday).toBe(1)
  })
})
