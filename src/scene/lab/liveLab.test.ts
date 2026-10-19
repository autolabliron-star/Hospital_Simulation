/**
 * The rig against the REAL lab simulation (agent L's `Lab`, run on its own stub world by its test bench): a morning's patients flow through the pneumatic
 * tube, the sorter, the camera, the centrifuges, the decapper, the analysers, the recapper and the fridge, and the rig must draw every stage sanely
 * and in agreement with the sim: tubes in flight at the path, on the belt at the track, in buckets, lids and rotors moving, probes dipping, the
 * archive filling. The hand-made cases are in rig.test.ts; this one proves the two agents' contracts meet.
 */
import { Matrix4 } from 'three'
import { describe, expect, it } from 'vitest'
import { makeBench } from '@/sim/lab/testkit'
import { labTrackPointInto } from '@/sim/labTrack'
import { pathPointInto } from '@/sim/pneumaticPath'
import { areaById } from '@/sim/places'
import { RECEIVE_HOOD, TUBE } from './labDims'
import { createLabRig, POOL, SLOTS } from './rig'
import { STOP_OF } from './samples'

const lab = areaById('lab').rect
const _m = new Matrix4()

describe('the rig against the real lab simulation', () => {
  it('draws a morning\'s tubes through every stage, in agreement with the sim, with nothing NaN, off the room or overlapping', () => {
    const bench = makeBench(11, 7)
    const rig = createLabRig()
    const seen = { flight: 0, landed: 0, hopper: 0, track: 0, bucket: 0, module: 0, hiddenModule: 0, lidOpen: 0, rpm: 0, probe: 0, archive: 0, stat: 0, maxFlights: 0, maxBuckets: 0 }
    const modules = new Set<string>()
    const startAngle = [rig.rotorAngle[0], rig.rotorAngle[1]]
    let spun = 0
    let probeMoved = false
    const probePart = rig.parts.byId.get('probe:chem')!
    const posArr = rig.moving.geometry.getAttribute('position').array as Float32Array
    const rest = posArr[probePart.start * 3 + 1]
    const bad: string[] = []

    const inject = (panel: string, priority: 'stat' | 'routine', source: number) => bench.inject({ panel, priority, source })
    inject('er-chest', 'stat', 0)
    inject('er-fever', 'stat', 1)
    inject('op-annual', 'routine', 2)
    inject('op-diabetes', 'routine', 0)
    inject('ward-routine', 'routine', 1)

    let frame = 0
    bench.run(16 * 60, (t) => {
      // a frame every 0.1 s of sim time: the sim publishes, the rig reads
      if (Math.round(t * 60) % 6 !== 0) return
      bench.lab.sync(1)
      frame++
      const st = bench.lab.state
      rig.step({ lab: bench.lab, generation: 0, simT: t, dt: 0.1 })
      seen.maxFlights = Math.max(seen.maxFlights, rig.stats.flights)
      seen.maxBuckets = Math.max(seen.maxBuckets, rig.stats.inBuckets)
      if (rig.stats.flights > 0) seen.flight++
      if (st.centrifuges.some((c) => c.lid > 0.5)) seen.lidOpen++
      if (st.centrifuges.some((c) => c.rpm01 > 0.9)) seen.rpm++
      if (st.analysers.chemistry.probe > 0.5) seen.probe++
      if (rig.stats.archiveShown > 0) seen.archive++
      if (st.pneumatic.inFlight) {
        const s = bench.lab.samples.get(st.pneumatic.inFlight)!
        if (s.where.line !== 'pneumatic') bad.push(`inFlight ${s.id} is on ${s.where.line}`)
      }
      if (!(Math.abs(posArr[probePart.start * 3 + 1] - rest) < 1e-6)) probeMoved = true
      const flat: number[] = []
      for (let i = 0; i < SLOTS; i++) {
        const id = st.slots[i]
        const s = id ? bench.lab.samples.get(id) : undefined
        rig.bodies.getMatrixAt(i, _m)
        const hidden = _m.determinant() === 0
        for (const v of _m.elements) if (!Number.isFinite(v)) bad.push(`frame ${frame} slot ${i}: non-finite matrix`)
        if (!s) {
          if (!hidden) bad.push(`frame ${frame} slot ${i}: drawn with no sample`)
          continue
        }
        const line = s.where.line
        if (s.priority === 'stat') seen.stat++
        if (line === 'track') {
          seen.track++
          if (hidden) bad.push(`frame ${frame}: tube ${s.id} on the track is not drawn`)
          const p = labTrackPointInto(s.where.sDraw, { x: 0, z: 0 })
          if (Math.hypot(_m.elements[12] - p.x, _m.elements[14] - p.z) > 1e-4) bad.push(`frame ${frame}: tube ${s.id} is off its place on the track`)
        } else if (line === 'pneumatic') {
          if (st.pneumatic.inFlight === s.id) {
            // flying: drawn at the sim's path point, its axis along the path
            if (hidden) bad.push(`frame ${frame}: flying tube ${s.id} is not drawn`)
            const c = pathPointInto(s.where.source, s.where.sDraw, { x: 0, y: 0, z: 0 })
            const mid = [_m.elements[12] + (_m.elements[4] * TUBE.h) / 2, _m.elements[13] + (_m.elements[5] * TUBE.h) / 2, _m.elements[14] + (_m.elements[6] * TUBE.h) / 2]
            if (Math.hypot(mid[0] - c.x, mid[1] - c.y, mid[2] - c.z) > 1e-3) bad.push(`frame ${frame}: flying tube ${s.id} is off the pipe`)
          } else if (s.where.sDraw < 0.5) {
            // queued at its riser: still in the robot
            if (!hidden) bad.push(`frame ${frame}: queued tube ${s.id} is drawn`)
          } else {
            // landed: standing in the receive hood
            seen.landed++
            if (hidden) bad.push(`frame ${frame}: landed tube ${s.id} is not drawn`)
            if (Math.hypot(_m.elements[12] - RECEIVE_HOOD.x, _m.elements[14] - RECEIVE_HOOD.z) > RECEIVE_HOOD.ring + 1e-6) bad.push(`frame ${frame}: landed tube ${s.id} is not in the hood`)
          }
        } else if (line === 'module') {
          const id = s.where.module!
          modules.add(id)
          seen.module++
          if (id === 'receive') {
            seen.hopper++
            if (!hidden) {
              if (Math.hypot(_m.elements[12] - RECEIVE_HOOD.x, _m.elements[14] - RECEIVE_HOOD.z) > RECEIVE_HOOD.ring + 1e-6) bad.push(`frame ${frame}: tube ${s.id} waiting for the sorter is not in the hood`)
            }
          } else if (id.startsWith('cfg')) {
            seen.bucket++
            if (hidden) bad.push(`frame ${frame}: tube ${s.id} in ${id} is not drawn`)
          } else if (STOP_OF(id)) {
            if (hidden) bad.push(`frame ${frame}: tube ${s.id} in ${id} is not drawn`)
          } else seen.hiddenModule++
        }
        if (!hidden && line !== 'pneumatic') {
          const x = _m.elements[12]
          const z = _m.elements[14]
          if (x < lab.x0 || x > lab.x1 || z < lab.z0 || z > lab.z1) bad.push(`frame ${frame}: tube ${s.id} (${line}) is outside the lab at (${x.toFixed(2)}, ${z.toFixed(2)})`)
          flat.push(x, z)
        }
      }
      void flat
      for (const c of st.centrifuges) if (c.rpm01 > 0.5) spun++
    })

    // eslint-disable-next-line no-console
    console.log(`live lab: ${frame} frames, ${JSON.stringify(seen)}, modules visited ${[...modules].sort().join(',')}, archived ${bench.lab.state.archived}`)
    expect(bad.slice(0, 5), `${bad.length} problems`).toEqual([])
    expect(seen.flight, 'a tube flew through the pipe').toBeGreaterThan(0)
    expect(seen.landed + seen.hopper, 'tubes stood in the receive hood').toBeGreaterThan(0)
    expect(seen.hiddenModule, 'only an overfull hopper hides a tube in a module').toBe(0)
    expect(seen.maxFlights, 'the sim sends one at a time').toBeLessThanOrEqual(1)
    expect(seen.track, 'tubes rode the belt').toBeGreaterThan(20)
    expect(seen.bucket, 'tubes sat in a centrifuge').toBeGreaterThan(0)
    expect(seen.maxBuckets).toBeLessThanOrEqual(48)
    expect(seen.lidOpen, 'a lid opened').toBeGreaterThan(0)
    expect(seen.rpm, 'a rotor ran at speed').toBeGreaterThan(0)
    expect(spun).toBeGreaterThan(0)
    expect(rig.rotorAngle[0] !== startAngle[0] || rig.rotorAngle[1] !== startAngle[1]).toBe(true)
    expect(seen.probe, 'the chemistry probe dipped').toBeGreaterThan(0)
    expect(probeMoved).toBe(true)
    expect(seen.archive, 'the fridge filled').toBeGreaterThan(0)
    expect(modules.has('decap')).toBe(true)
    expect(modules.has('chem')).toBe(true)
    expect(POOL).toBe(112)
    rig.dispose()
  })
})
