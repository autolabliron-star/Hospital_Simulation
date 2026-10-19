/**
 * The lab rig in node, driven by hand-made lab state (the whole lab sim against it is liveLab.test.ts): tubes on the belt, in the pneumatic tube and
 * in the centrifuges, caps and fluid by stage, lids, rotors, probes and grippers, the archive racks, the lights, a Jump, the draw-call and
 * triangle budget, and that a frame allocates nothing.
 */
import inspector from 'node:inspector'
import { Color, Matrix4 } from 'three'
import { describe, expect, it } from 'vitest'
import { LAB_CATALOGUE } from '@/content/lab'
import { newLabState } from '@/sim/lab'
import { labTrackPointInto, LAB_STOPS } from '@/sim/labTrack'
import { pathPointInto, PNEUMATIC_PATHS } from '@/sim/pneumaticPath'
import { SampleBook } from '@/sim/samples'
import type { LabState, Sample, SampleStage, TubeKind } from '@/sim/types'
import { MACHINE_BODY, MACHINE_GLOW } from '@/scene/imaging/machines/machineMaterials'
import { MAT } from '@/scene/materials'
import { ARCHIVE_SHOWN, BENCH, CAP_BASE_Y, CAP, centrifuge, CAMERA_ARCH, PROBE_Y, RECEIVE_HOOD, TUBE, TUBE_BASE_Y, LID_MAX, ROTOR_MAX_REV_PER_S } from './labDims'

const CAP_TOP = CAP_BASE_Y + CAP.h
import { LED_IDS, TRAIL } from './labGlow'
import { lidAngle, quatUpTo, rotorAdvance, bucketSwing, BucketTable } from './motion'
import { createLabRig, drawCallsOf, POOL, SLOTS, trianglesOf, type LabLike, type LabRig } from './rig'
import { CAP_WHITE, FLIGHT_SCALE, FLUID, TUBE_KINDS } from './samples'

// ---------------------------------------------------------------------------------------------
// Hand-made lab
// ---------------------------------------------------------------------------------------------

interface Fake extends LabLike {
  state: LabState
  book: SampleBook
  /** Put a sample in render slot `slot`. */
  put(slot: number, o: { tube?: TubeKind; stage: SampleStage; where: Partial<Sample['where']> & { line: Sample['where']['line'] }; priority?: Sample['priority']; qc?: Sample['qc']; stageAt?: Sample['stageAt']; flying?: boolean }): Sample
}

function fakeLab(): Fake {
  const state = newLabState()
  const book = new SampleBook()
  let n = 0
  return {
    state,
    book,
    samples: book,
    put(slot, o) {
      const tube = o.tube ?? 'serum'
      const s = book.create({ orderId: `L${++n}`, patientId: `p${n}`, tube, cap: LAB_CATALOGUE.tubes[tube].cap, tests: ['bmp'], priority: o.priority ?? 'routine' }, 0)
      s.stage = o.stage
      s.stageAt = { ...s.stageAt, ...(o.stageAt ?? {}) }
      s.where = { s: 0, sDraw: 0, module: null, source: -1, ...o.where }
      s.slot = slot
      if (o.qc) s.qc = o.qc
      state.slots[slot] = s.id
      // on the pneumatic line a tube flies exactly while the sim's `inFlight` is its id (queued and landed tubes are on the line too)
      if (o.where.line === 'pneumatic' && o.flying !== false) state.pneumatic.inFlight = s.id
      return s
    },
  }
}

const step = (rig: LabRig, lab: LabLike | null, over: Partial<{ generation: number; simT: number; dt: number }> = {}): void =>
  rig.step({ lab, generation: over.generation ?? 0, simT: over.simT ?? 100, dt: over.dt ?? 1 / 60 })

const _m = new Matrix4()
const posOf = (mesh: { getMatrixAt(i: number, m: Matrix4): void }, i: number): [number, number, number] => {
  mesh.getMatrixAt(i, _m)
  return [_m.elements[12], _m.elements[13], _m.elements[14]]
}
/** The instance's local y axis (the tube's axis), scaled by the instance scale. */
const axisOf = (mesh: { getMatrixAt(i: number, m: Matrix4): void }, i: number): [number, number, number] => {
  mesh.getMatrixAt(i, _m)
  return [_m.elements[4], _m.elements[5], _m.elements[6]]
}
const hidden = (mesh: { getMatrixAt(i: number, m: Matrix4): void }, i: number): boolean => {
  mesh.getMatrixAt(i, _m)
  return _m.determinant() === 0
}
const colourOf = (mesh: { getColorAt(i: number, c: Color): void }, i: number): string => {
  const c = new Color()
  mesh.getColorAt(i, c)
  return `#${c.getHexString()}`
}
const hex = (h: string): string => `#${new Color(h).getHexString()}`

// ---------------------------------------------------------------------------------------------
// Pure motion
// ---------------------------------------------------------------------------------------------

describe('lab motion maths', () => {
  it('a lid opens from 0 to its hinge limit and never beyond', () => {
    expect(lidAngle(0)).toBe(0)
    expect(lidAngle(1)).toBe(LID_MAX)
    expect(lidAngle(0.5)).toBeCloseTo(LID_MAX / 2, 9)
    expect(lidAngle(2)).toBe(LID_MAX)
    expect(lidAngle(-1)).toBe(0)
  })

  it('a rotor turns at most 4 rev/s, whatever the frame time, and stands still at 0', () => {
    expect(rotorAdvance(1, 0, 1 / 60)).toBeCloseTo(1, 12)
    for (const dt of [1 / 144, 1 / 60, 1 / 30]) {
      const a = rotorAdvance(0, 1, dt)
      expect(a).toBeLessThanOrEqual(2 * Math.PI * ROTOR_MAX_REV_PER_S * dt + 1e-12)
    }
    // a full second at full speed is exactly four turns (the angle wraps)
    let angle = 0
    for (let i = 0; i < 60; i++) angle = rotorAdvance(angle, 1, 1 / 60)
    expect(angle).toBeLessThan(2 * Math.PI)
    // 60 Hz frames at 4 rev/s step 24 degrees: far from the 180 degrees that would alias to a standstill
    expect(rotorAdvance(0, 1, 1 / 60)).toBeLessThan(Math.PI / 4)
    expect(rotorAdvance(0, 2, 1 / 60)).toBe(rotorAdvance(0, 1, 1 / 60))
  })

  it('buckets stay upright at rest and swing out horizontal at speed', () => {
    expect(bucketSwing(0)).toBe(0)
    expect(bucketSwing(1)).toBeCloseTo(Math.PI / 2, 9)
    expect(bucketSwing(0.5)).toBeGreaterThan(0)
    expect(bucketSwing(0.5)).toBeLessThan(Math.PI / 2)
  })

  it('a tube turns its cap end to a direction (and survives the straight-down case)', () => {
    const q = { x: 0, y: 0, z: 0, w: 1 }
    quatUpTo(0, 1, 0, q)
    expect(q.x).toBeCloseTo(0, 12)
    expect(q.y).toBeCloseTo(0, 12)
    expect(q.z).toBeCloseTo(0, 12)
    expect(q.w).toBeCloseTo(1, 12)
    quatUpTo(0, -1, 0, q)
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9)
    quatUpTo(1, 0, 0, q)
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9)
  })

  it('each tube in a centrifuge keeps its bucket, a full rotor refuses a 25th, and a freed bucket is reused', () => {
    const t = new BucketTable(2, 24)
    const ids = Array.from({ length: 24 }, (_, i) => `S${i}`)
    const first = ids.map((id) => t.assign(0, id))
    expect(new Set(first).size).toBe(24)
    expect(t.assign(0, 'extra')).toBe(-1)
    t.sweep()
    // next frame only S3 is still there
    expect(t.assign(0, 'S3')).toBe(first[3])
    t.sweep()
    expect(t.occupied(0)).toBe(1)
    expect(t.assign(0, 'new')).toBe(0)
    // the other centrifuge is independent
    expect(t.assign(1, 'S3')).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------------------------

describe('the lab rig: budget', () => {
  it('is five draw calls (the contract allows nine, plus the one atlas), well under 45 k triangles, with fixed pools', () => {
    const rig = createLabRig()
    expect(drawCallsOf(rig)).toBe(5)
    expect(drawCallsOf(rig)).toBeLessThanOrEqual(9)
    expect(trianglesOf(rig)).toBeLessThanOrEqual(45_000)
    expect(rig.pucks.count).toBe(SLOTS)
    expect(rig.bodies.count).toBe(POOL)
    expect(rig.caps.count).toBe(POOL)
    expect(POOL).toBe(64 + ARCHIVE_SHOWN)
    // nothing visible and nothing drawn before the first frame
    for (let i = 0; i < POOL; i++) expect(hidden(rig.bodies, i)).toBe(true)
    // eslint-disable-next-line no-console
    console.log(`lab rig: ${drawCallsOf(rig)} draw calls, ${trianglesOf(rig)} triangles`)
    rig.dispose()
  })

  it('uses only the shared materials: the palette tinted (the canopies program), MACHINE_BODY and MACHINE_GLOW', () => {
    const rig = createLabRig()
    expect(rig.pucks.material).toBe(MAT.tinted)
    expect(rig.bodies.material).toBe(MAT.tinted)
    expect(rig.caps.material).toBe(MAT.tinted)
    expect(rig.moving.material).toBe(MACHINE_BODY)
    expect(rig.glow.material).toBe(MACHINE_GLOW)
    // every instance has a colour from the start (the instanced-colour shader variant compiles once)
    expect(rig.bodies.instanceColor).not.toBeNull()
    expect(rig.caps.instanceColor).not.toBeNull()
    expect(rig.pucks.instanceColor).not.toBeNull()
    rig.dispose()
  })

  it('the moving parts and the glow are single meshes with the geometry kit layout (position, normal, colour)', () => {
    const rig = createLabRig()
    expect(Object.keys(rig.moving.geometry.attributes).sort()).toEqual(['color', 'normal', 'position'])
    expect(rig.glow.geometry.getAttribute('color').itemSize).toBe(4)
    // 2 lids, 2 rotors, 4 probes, 3 grippers
    expect(rig.parts.parts.length).toBe(11)
    rig.dispose()
  })
})

describe('the lab rig: tubes on the belt', () => {
  it('draws a puck and a tube at the sim\'s track position, upright, on the belt', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    lab.put(5, { stage: 'onTrack', where: { line: 'track', sDraw: 6.3 } })
    step(rig, lab)
    const p = labTrackPointInto(6.3, { x: 0, z: 0 })
    const puck = posOf(rig.pucks, 5)
    expect(puck[0]).toBeCloseTo(p.x, 5)
    expect(puck[1]).toBeCloseTo(BENCH.y, 5)
    expect(puck[2]).toBeCloseTo(p.z, 5)
    const tube = posOf(rig.bodies, 5)
    expect(tube[0]).toBeCloseTo(p.x, 5)
    expect(tube[1]).toBeCloseTo(TUBE_BASE_Y, 5)
    expect(tube[2]).toBeCloseTo(p.z, 5)
    expect(axisOf(rig.bodies, 5)[1]).toBeCloseTo(1, 5)
    // the cap sits on the tube's open end
    expect(posOf(rig.caps, 5)[1]).toBeCloseTo(TUBE_BASE_Y + TUBE.h, 5)
    // every other slot is still empty
    for (let i = 0; i < SLOTS; i++) if (i !== 5) expect(hidden(rig.bodies, i)).toBe(true)
    expect(rig.stats.drawn).toBe(1)
    rig.dispose()
  })

  it('follows the sample as it moves, and frees the slot when the sample leaves it', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    const s = lab.put(2, { stage: 'onTrack', where: { line: 'track', sDraw: 1 } })
    step(rig, lab)
    const a = posOf(rig.bodies, 2)
    s.where.sDraw = 1.5
    step(rig, lab)
    const b = posOf(rig.bodies, 2)
    expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeCloseTo(0.5, 2)
    lab.state.slots[2] = null
    step(rig, lab)
    expect(hidden(rig.bodies, 2)).toBe(true)
    expect(hidden(rig.pucks, 2)).toBe(true)
    expect(hidden(rig.caps, 2)).toBe(true)
    rig.dispose()
  })

  it('a STAT tube rides in an orange puck', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    lab.put(0, { stage: 'onTrack', priority: 'stat', where: { line: 'track', sDraw: 1 } })
    lab.put(1, { stage: 'onTrack', priority: 'routine', where: { line: 'track', sDraw: 2 } })
    step(rig, lab)
    expect(colourOf(rig.pucks, 0)).not.toBe(colourOf(rig.pucks, 1))
    expect(colourOf(rig.pucks, 0)).toBe(hex('#f08a3c'))
    rig.dispose()
  })

  it('a tube sits at its module\'s stop on the track while the module works on it', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    lab.put(0, { stage: 'analysing', where: { line: 'module', module: 'chem' } })
    step(rig, lab)
    const stop = labTrackPointInto(LAB_STOPS.chem, { x: 0, z: 0 })
    const t = posOf(rig.bodies, 0)
    expect(t[0]).toBeCloseTo(stop.x, 5)
    expect(t[2]).toBeCloseTo(stop.z, 5)
    expect(hidden(rig.pucks, 0)).toBe(false)
    rig.dispose()
  })
})

describe('the lab rig: what the tube looks like', () => {
  const body = (rig: LabRig, i: number) => colourOf(rig.bodies, i)
  const cap = (rig: LabRig, i: number) => colourOf(rig.caps, i)

  it('whole blood turns to amber serum after the centrifuge; EDTA tubes never spin, so they stay red', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    lab.put(0, { tube: 'serum', stage: 'onTrack', where: { line: 'track', sDraw: 1 } })
    lab.put(1, { tube: 'serum', stage: 'analysing', where: { line: 'module', module: 'chem' } })
    lab.put(2, { tube: 'EDTA', stage: 'analysing', where: { line: 'module', module: 'haem' } })
    lab.put(3, { tube: 'heparin', stage: 'recap', where: { line: 'module', module: 'recap' } })
    step(rig, lab)
    expect(body(rig, 0)).toBe(hex('#6e1320'))
    expect(body(rig, 1)).toBe(hex('#e9b24a'))
    expect(body(rig, 2)).toBe(hex('#6e1320'))
    expect(body(rig, 3)).toBe(hex('#e9b24a'))
    rig.dispose()
  })

  it('a haemolysed tube is pinker than a good one', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    lab.put(0, { tube: 'serum', stage: 'analysing', where: { line: 'module', module: 'chem' } })
    lab.put(1, { tube: 'serum', stage: 'analysing', qc: 'haemolysed', where: { line: 'module', module: 'chem' } })
    step(rig, lab)
    expect(body(rig, 0)).not.toBe(body(rig, 1))
    rig.dispose()
  })

  it('the cap shows its tube kind\'s colour, lifts off at the decapper, is gone while measuring and comes back white after the recapper', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    const kinds: TubeKind[] = ['citrate', 'serum', 'heparin', 'EDTA', 'fluoride']
    kinds.forEach((k, i) => lab.put(i, { tube: k, stage: 'onTrack', where: { line: 'track', sDraw: 1 + i } }))
    lab.put(5, { stage: 'decap', where: { line: 'module', module: 'decap' } })
    lab.put(6, { stage: 'analysing', where: { line: 'module', module: 'chem' } })
    lab.put(7, { stage: 'recap', where: { line: 'module', module: 'recap' } })
    lab.put(8, { stage: 'archived', where: { line: 'track', sDraw: 20 } })
    step(rig, lab)
    kinds.forEach((k, i) => expect(cap(rig, i), k).toBe(hex(LAB_CATALOGUE.tubes[k].hex)))
    // 5: the cap is lifted off the tube along its axis
    expect(posOf(rig.caps, 5)[1]).toBeGreaterThan(posOf(rig.bodies, 5)[1] + TUBE.h + 0.02)
    // 6: no cap while the analysers sample
    expect(hidden(rig.caps, 6)).toBe(true)
    // 7 and 8: white
    expect(cap(rig, 7)).toBe(hex('#f2f4f4'))
    expect(cap(rig, 8)).toBe(hex('#f2f4f4'))
    expect(CAP_WHITE).toBe(TUBE_KINDS.length)
    expect(FLUID.serum).toBe(1)
    rig.dispose()
  })
})

describe('the lab rig: the pneumatic tube', () => {
  it('draws the flying tube exactly at the sim\'s path point, its axis along the path, cap end leading', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    for (const [source, d] of [
      [0, 1.0],
      [1, 4.2],
      [2, 9.5],
      [3, 2.0],
      [1, PNEUMATIC_PATHS[1].length - 0.5],
    ] as const) {
      lab.state.slots.fill(null)
      lab.put(3, { stage: 'inTube', where: { line: 'pneumatic', source, sDraw: d } })
      step(rig, lab)
      const centre = pathPointInto(source, d, { x: 0, y: 0, z: 0 })
      const ahead = pathPointInto(source, d + 0.05, { x: 0, y: 0, z: 0 })
      const base = posOf(rig.bodies, 3)
      const axis = axisOf(rig.bodies, 3)
      const len = Math.hypot(...axis)
      expect(len).toBeCloseTo(FLIGHT_SCALE, 5)
      // the tube's middle is the path point
      const mid = [base[0] + (axis[0] * TUBE.h) / 2, base[1] + (axis[1] * TUBE.h) / 2, base[2] + (axis[2] * TUBE.h) / 2]
      expect(mid[0]).toBeCloseTo(centre.x, 4)
      expect(mid[1]).toBeCloseTo(centre.y, 4)
      expect(mid[2]).toBeCloseTo(centre.z, 4)
      // and its axis runs the way the path goes there
      const dir = [ahead.x - centre.x, ahead.y - centre.y, ahead.z - centre.z]
      const dl = Math.hypot(...dir)
      const dot = (axis[0] * dir[0] + axis[1] * dir[1] + axis[2] * dir[2]) / (len * dl)
      expect(dot).toBeGreaterThan(0.999)
    }
    rig.dispose()
  })

  it('a flight has a glow trail in its cap colour, and the trail is gone when it lands', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    const s = lab.put(0, { tube: 'EDTA', stage: 'inTube', where: { line: 'pneumatic', source: 0, sDraw: 5 } })
    step(rig, lab)
    const colours = rig.glowGeo.geometry.getAttribute('color').array as Float32Array
    const start = rig.glowGeo.trailStart[0]
    let bright = 0
    for (let v = start; v < start + 100; v++) bright = Math.max(bright, colours[v * 4 + 3])
    expect(bright).toBeGreaterThan(0.3)
    expect(rig.stats.flights).toBe(1)
    // it lands on the track
    s.where = { line: 'track', s: 0, sDraw: 0, module: null, source: 0 }
    s.stage = 'onTrack'
    lab.state.pneumatic.inFlight = null
    step(rig, lab)
    let after = 0
    for (let v = start; v < start + 100; v++) after = Math.max(after, colours[v * 4 + 3])
    expect(after).toBe(0)
    expect(rig.stats.flights).toBe(0)
    rig.dispose()
  })

  it('flashes a ring at the launch point and another at the receive hood when the tube lands, and they fade', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    const s = lab.put(0, { stage: 'inTube', where: { line: 'pneumatic', source: 1, sDraw: 0.2 } })
    const alpha = (name: string): number => {
      const r = rig.glowGeo.regions[name]
      return (rig.glowGeo.geometry.getAttribute('color').array as Float32Array)[r.start * 4 + 3]
    }
    expect(alpha('ring:1')).toBe(0)
    step(rig, lab)
    expect(alpha('ring:1')).toBeGreaterThan(0.5)
    expect(alpha('ring:4')).toBe(0)
    s.where = { line: 'track', s: 0, sDraw: 0.1, module: null, source: 1 }
    lab.state.pneumatic.inFlight = null
    step(rig, lab)
    expect(alpha('ring:4')).toBeGreaterThan(0.5)
    for (let i = 0; i < 120; i++) step(rig, lab)
    expect(alpha('ring:1')).toBe(0)
    expect(alpha('ring:4')).toBe(0)
    rig.dispose()
  })

  it('draws only the tube the sim says is flying: a queued tube is still in its robot, a landed one stands in the receive hood', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    const hood = RECEIVE_HOOD
    lab.put(0, { stage: 'inTube', where: { line: 'pneumatic', source: 0, sDraw: 3 } }) // flying
    lab.put(1, { stage: 'inTube', flying: false, where: { line: 'pneumatic', source: 2, sDraw: 0 } }) // queued behind it
    lab.put(2, { stage: 'inTube', flying: false, where: { line: 'pneumatic', source: 1, sDraw: PNEUMATIC_PATHS[1].length } }) // landed, in the hood
    step(rig, lab)
    expect(rig.stats.flights).toBe(1)
    expect(hidden(rig.bodies, 0)).toBe(false)
    expect(hidden(rig.bodies, 1)).toBe(true)
    expect(hidden(rig.bodies, 2)).toBe(false)
    const p = posOf(rig.bodies, 2)
    expect(Math.hypot(p[0] - hood.x, p[2] - hood.z)).toBeCloseTo(hood.ring, 4)
    expect(p[1]).toBeCloseTo(1.312, 3)
    expect(axisOf(rig.bodies, 2)[1]).toBeCloseTo(1, 5) // upright, life size
    expect(TRAIL.flights).toBeGreaterThanOrEqual(1)
    rig.dispose()
  })

  it('tubes waiting for the sorter (module "receive") stand apart in the hood, up to four, and the sorter\'s gripper works', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    for (let k = 0; k < 5; k++) lab.put(k, { stage: 'received', where: { line: 'module', module: 'receive' } })
    step(rig, lab)
    const drawn = [0, 1, 2, 3, 4].filter((k) => !hidden(rig.bodies, k))
    expect(drawn.length).toBe(4)
    const spots = new Set(drawn.map((k) => posOf(rig.bodies, k).map((v) => v.toFixed(3)).join(',')))
    expect(spots.size).toBe(4)
    for (const k of drawn) expect(hidden(rig.pucks, k)).toBe(true) // not on a puck yet
    // the sorter's gripper comes down while it works
    let lowest = Infinity
    const pos = rig.moving.geometry.getAttribute('position').array as Float32Array
    const g = rig.parts.byId.get('grip:sort')!
    for (let i = 0; i < 60; i++) {
      step(rig, lab)
      for (let v = 0; v < g.count; v++) lowest = Math.min(lowest, pos[(g.start + v) * 3 + 1])
    }
    expect(lowest).toBeLessThan(1.05)
    rig.dispose()
  })
})

describe('the lab rig: centrifuges', () => {
  /** The highest vertex of a part, and its vertex at index `k`. */
  const partTop = (rig: LabRig, id: string): number => {
    const p = rig.parts.byId.get(id)!
    const pos = rig.moving.geometry.getAttribute('position').array as Float32Array
    let top = -Infinity
    for (let i = 0; i < p.count; i++) top = Math.max(top, pos[(p.start + i) * 3 + 1])
    return top
  }
  const partVertex = (rig: LabRig, id: string, i: number): [number, number, number] => {
    const p = rig.parts.byId.get(id)!
    const pos = rig.moving.geometry.getAttribute('position').array as Float32Array
    const o = (p.start + i) * 3
    return [pos[o], pos[o + 1], pos[o + 2]]
  }

  it('the lid follows the sim: shut on the housing at 0, swung up and over at 1', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    step(rig, lab)
    const c = centrifuge(0)
    const shut = partTop(rig, 'lid0')
    expect(shut).toBeLessThan(c.rimTop + 0.1)
    lab.state.centrifuges[0].lid = 1
    step(rig, lab)
    const open = partTop(rig, 'lid0')
    // hinged at the west edge, 0.73 m long, turned 100 degrees: its far edge is well above the housing
    expect(open).toBeGreaterThan(c.rimTop + 0.6)
    // the other centrifuge's lid did not move
    expect(partTop(rig, 'lid1')).toBeLessThan(centrifuge(1).rimTop + 0.1)
    lab.state.centrifuges[0].lid = 0.5
    step(rig, lab)
    expect(partTop(rig, 'lid0')).toBeGreaterThan(shut)
    expect(partTop(rig, 'lid0')).toBeLessThan(open + 0.2)
    rig.dispose()
  })

  it('the rotor turns with its speed (never above 4 rev/s) and stands still at rest', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    step(rig, lab)
    const v0 = partVertex(rig, 'rotor0', 40)
    step(rig, lab)
    expect(partVertex(rig, 'rotor0', 40)).toEqual(v0)
    lab.state.centrifuges[0].rpm01 = 1
    let prev = rig.rotorAngle[0]
    for (let i = 0; i < 100; i++) {
      step(rig, lab)
      let d = rig.rotorAngle[0] - prev
      if (d < 0) d += 2 * Math.PI
      expect(d).toBeLessThanOrEqual(2 * Math.PI * ROTOR_MAX_REV_PER_S * (1 / 60) + 1e-9)
      prev = rig.rotorAngle[0]
    }
    expect(partVertex(rig, 'rotor0', 40)).not.toEqual(v0)
    // the other rotor stayed put
    expect(rig.rotorAngle[1]).toBe(0)
    rig.dispose()
  })

  it('tubes in the rotor sit in their buckets, turn with it and swing out as it speeds up', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    const c = centrifuge(1).rotor
    for (let k = 0; k < 4; k++) lab.put(k, { stage: 'centrifuge', where: { line: 'module', module: 'cfg1' }, stageAt: { centrifuge: 0 } })
    step(rig, lab)
    const pos0 = [0, 1, 2, 3].map((k) => posOf(rig.bodies, k))
    // each on the bucket ring, all different, upright, at the rotor top
    for (const p of pos0) {
      expect(Math.hypot(p[0] - c.x, p[2] - c.z)).toBeCloseTo(c.bucketR, 3)
      expect(p[1]).toBeCloseTo(c.top, 4)
    }
    expect(new Set(pos0.map((p) => `${p[0].toFixed(3)},${p[2].toFixed(3)}`)).size).toBe(4)
    expect(axisOf(rig.bodies, 0)[1]).toBeCloseTo(1, 4)
    expect(rig.stats.inBuckets).toBe(4)
    // spin it up: the rotor turns, the tubes go round with it (same ring, new places) and lean outward
    lab.state.centrifuges[1].rpm01 = 1
    for (let i = 0; i < 25; i++) step(rig, lab) // 25 frames at 4 rev/s: 1.67 turns, so every bucket is somewhere new
    const pos1 = [0, 1, 2, 3].map((k) => posOf(rig.bodies, k))
    for (let k = 0; k < 4; k++) {
      expect(Math.hypot(pos1[k][0] - c.x, pos1[k][2] - c.z)).toBeCloseTo(c.bucketR, 3)
      expect(Math.hypot(pos1[k][0] - pos0[k][0], pos1[k][2] - pos0[k][2])).toBeGreaterThan(0.01)
    }
    expect(axisOf(rig.bodies, 0)[1]).toBeLessThan(0.1) // swung out to horizontal
    rig.dispose()
  })

  it('a tube settles into its bucket from its puck over the first second', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    lab.put(0, { stage: 'centrifuge', where: { line: 'module', module: 'cfg0' }, stageAt: { centrifuge: 100 } })
    step(rig, lab, { simT: 100 })
    const stop = labTrackPointInto(LAB_STOPS.cfg0, { x: 0, z: 0 })
    const start = posOf(rig.bodies, 0)
    expect(start[0]).toBeCloseTo(stop.x, 3)
    expect(start[1]).toBeCloseTo(TUBE_BASE_Y, 3)
    step(rig, lab, { simT: 100.45 })
    const mid = posOf(rig.bodies, 0)
    expect(mid[1]).toBeGreaterThan(TUBE_BASE_Y)
    step(rig, lab, { simT: 102 })
    expect(posOf(rig.bodies, 0)[1]).toBeCloseTo(centrifuge(0).rotor.top, 4)
    rig.dispose()
  })
})

describe('the lab rig: the moving parts stand on the room', () => {
  const bounds = (rig: LabRig, id: string) => {
    const p = rig.parts.byId.get(id)!
    const pos = rig.moving.geometry.getAttribute('position').array as Float32Array
    const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity }
    for (let i = 0; i < p.count; i++) {
      const o = (p.start + i) * 3
      b.x0 = Math.min(b.x0, pos[o])
      b.x1 = Math.max(b.x1, pos[o])
      b.y0 = Math.min(b.y0, pos[o + 1])
      b.y1 = Math.max(b.y1, pos[o + 1])
      b.z0 = Math.min(b.z0, pos[o + 2])
      b.z1 = Math.max(b.z1, pos[o + 2])
    }
    return b
  }

  it('a shut lid lies on its centrifuge\'s rim and covers the housing; the rotor spins inside the opening, its tubes below the lid', () => {
    const rig = createLabRig()
    step(rig, fakeLab())
    for (let i = 0; i < 2; i++) {
      const c = centrifuge(i)
      const lid = bounds(rig, `lid${i}`)
      expect(lid.y0).toBeCloseTo(c.rimTop - 0.012, 3)
      expect(lid.x0).toBeGreaterThanOrEqual(c.h.x0)
      expect(lid.x1).toBeLessThanOrEqual(c.h.x1)
      expect(lid.z0).toBeGreaterThanOrEqual(c.h.z0)
      expect(lid.z1).toBeLessThanOrEqual(c.h.z1)
      const rotor = bounds(rig, `rotor${i}`)
      expect(rotor.x1 - rotor.x0).toBeCloseTo(2 * c.rotor.r, 2)
      expect(rotor.x0).toBeGreaterThan(c.cx - c.openHalf)
      expect(rotor.x1).toBeLessThan(c.cx + c.openHalf)
      expect(rotor.z0).toBeGreaterThan(c.cz - c.openHalf)
      expect(rotor.z1).toBeLessThan(c.cz + c.openHalf)
      expect(rotor.y0).toBeGreaterThan(c.bodyTop)
      // an upright tube in the rotor tops out (cap included) under the lid's top face, so a shut lid hides it
      expect(c.rotor.top + TUBE.h + 0.016).toBeLessThan(lid.y1)
    }
  })

  it('probes and grippers hang over their module\'s stop on the belt, under their arm, and the rod passes through the arm', () => {
    const rig = createLabRig()
    step(rig, fakeLab())
    for (const id of ['haem', 'chem', 'immuno', 'coag'] as const) {
      const b = bounds(rig, `probe:${id}`)
      const stop = LAB_STOPS[id]
      const p = labTrackPointInto(stop, { x: 0, z: 0 })
      expect((b.x0 + b.x1) / 2).toBeCloseTo(p.x, 3)
      expect((b.z0 + b.z1) / 2).toBeCloseTo(p.z, 3)
      expect(b.y0).toBeCloseTo(PROBE_Y.rest, 3)
      expect(b.y1).toBeGreaterThan(1.2) // pokes out of the top of the arm (1.14 to 1.2)
    }
    for (const [id, module] of [
      ['decap', 'decap'],
      ['recap', 'recap'],
    ] as const) {
      const b = bounds(rig, `grip:${id}`)
      const p = labTrackPointInto(LAB_STOPS[module], { x: 0, z: 0 })
      expect((b.x0 + b.x1) / 2).toBeCloseTo(p.x, 3)
      expect((b.z0 + b.z1) / 2).toBeCloseTo(p.z, 3)
      // its head rests above the cap of a tube in the module (cap top 0.963) and goes down onto it
      expect(b.y0).toBeGreaterThan(CAP_TOP)
    }
    const sort = bounds(rig, 'grip:sort')
    expect(sort.y0).toBeGreaterThan(CAP_TOP)
  })
})

describe('the lab rig: analysers, grippers, the archive and the lights', () => {
  it('a probe dips with the analyser\'s probe value and back up', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    const tip = (id: string): number => {
      const p = rig.parts.byId.get(id)!
      const pos = rig.moving.geometry.getAttribute('position').array as Float32Array
      let low = Infinity
      for (let i = 0; i < p.count; i++) low = Math.min(low, pos[(p.start + i) * 3 + 1])
      return low
    }
    step(rig, lab)
    expect(tip('probe:chem')).toBeCloseTo(PROBE_Y.rest, 4)
    lab.state.analysers.chemistry.probe = 1
    step(rig, lab)
    expect(tip('probe:chem')).toBeCloseTo(PROBE_Y.dip, 4)
    expect(tip('probe:haem')).toBeCloseTo(PROBE_Y.rest, 4)
    lab.state.analysers.chemistry.probe = 0
    step(rig, lab)
    expect(tip('probe:chem')).toBeCloseTo(PROBE_Y.rest, 4)
    rig.dispose()
  })

  it('the decapper\'s gripper works while a tube is in the decapper and rests otherwise', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    const low = (): number => {
      const p = rig.parts.byId.get('grip:decap')!
      const pos = rig.moving.geometry.getAttribute('position').array as Float32Array
      let m = Infinity
      for (let i = 0; i < p.count; i++) m = Math.min(m, pos[(p.start + i) * 3 + 1])
      return m
    }
    step(rig, lab)
    const rest = low()
    lab.put(0, { stage: 'decap', where: { line: 'module', module: 'decap' } })
    let lowest = Infinity
    for (let i = 0; i < 60; i++) {
      step(rig, lab)
      lowest = Math.min(lowest, low())
    }
    expect(lowest).toBeLessThan(rest - 0.05)
    lab.state.slots[0] = null
    for (let i = 0; i < 90; i++) step(rig, lab)
    expect(low()).toBeCloseTo(rest, 3)
    rig.dispose()
  })

  it('the archive racks fill with the archived count, up to what they show', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    const visible = (): number => {
      let n = 0
      for (let i = SLOTS; i < POOL; i++) if (!hidden(rig.bodies, i)) n++
      return n
    }
    step(rig, lab)
    expect(visible()).toBe(0)
    lab.state.archived = 5
    step(rig, lab)
    expect(visible()).toBe(5)
    expect(rig.stats.archiveShown).toBe(5)
    lab.state.archived = 400
    step(rig, lab)
    expect(visible()).toBe(ARCHIVE_SHOWN)
    // inside the cabinet: x -25.8..-25.1, z 18.4..19.1, y above 0.9
    for (let i = SLOTS; i < POOL; i++) {
      const p = posOf(rig.bodies, i)
      expect(p[0]).toBeGreaterThan(-25.8)
      expect(p[0]).toBeLessThan(-25.1)
      expect(p[2]).toBeGreaterThan(18.4)
      expect(p[2]).toBeLessThan(19.1)
      expect(p[1]).toBeGreaterThan(0.9)
      expect(p[1]).toBeLessThan(1.65)
    }
    lab.state.archived = 0
    step(rig, lab)
    expect(visible()).toBe(0)
    rig.dispose()
  })

  it('the camera arch flashes when a puck passes it, then fades', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    const s = lab.put(0, { stage: 'onTrack', where: { line: 'track', sDraw: LAB_STOPS.camera - 0.1 } })
    const flash = (): number => (rig.glowGeo.geometry.getAttribute('color').array as Float32Array)[rig.glowGeo.regions.flash.start * 4 + 3]
    step(rig, lab)
    expect(flash()).toBe(0)
    s.where.sDraw = LAB_STOPS.camera + 0.1
    step(rig, lab)
    expect(flash()).toBeGreaterThan(0.8)
    for (let i = 0; i < 40; i++) step(rig, lab)
    expect(flash()).toBe(0)
    // a puck that does not cross the arch does not flash it
    s.where.sDraw = LAB_STOPS.camera + 0.5
    step(rig, lab)
    expect(flash()).toBe(0)
    expect(CAMERA_ARCH.z1).toBeGreaterThan(CAMERA_ARCH.z0)
    rig.dispose()
  })

  it('every module has a light, idle at first, and a busy centrifuge or analyser turns it', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    step(rig, lab)
    const rgb = (id: string): [number, number, number] => {
      const a = rig.glowGeo.geometry.getAttribute('color').array as Float32Array
      const r = rig.glowGeo.regions[`led:${id}`]
      return [a[r.start * 4], a[r.start * 4 + 1], a[r.start * 4 + 2]]
    }
    expect(LED_IDS.length).toBe(11)
    const idle = rgb('cfg0')
    lab.state.centrifuges[0].phase = 'spinning'
    lab.state.analysers.immunoassay.aspirating = 'S1'
    step(rig, lab)
    expect(rgb('cfg0')).not.toEqual(idle)
    expect(rgb('immuno')).not.toEqual(rgb('haem'))
    expect(rgb('cfg1')).toEqual(idle)
    rig.dispose()
  })
})

describe('the lab rig: a Jump and a missing lab', () => {
  it('a new generation clears everything and draws the new hospital\'s tubes from scratch', () => {
    const rig = createLabRig()
    const a = fakeLab()
    a.put(0, { stage: 'onTrack', where: { line: 'track', sDraw: 1 } })
    a.state.archived = 10
    step(rig, a, { generation: 0 })
    expect(rig.stats.drawn).toBe(1)
    const b = fakeLab()
    b.put(7, { stage: 'onTrack', where: { line: 'track', sDraw: 3 } })
    step(rig, b, { generation: 1 })
    expect(hidden(rig.bodies, 0)).toBe(true)
    expect(hidden(rig.bodies, 7)).toBe(false)
    expect(rig.stats.drawn).toBe(1)
    expect(rig.stats.archiveShown).toBe(0)
    rig.dispose()
  })

  it('draws nothing, and does not throw, without a lab', () => {
    const rig = createLabRig()
    expect(() => step(rig, null)).not.toThrow()
    for (let i = 0; i < POOL; i++) expect(hidden(rig.bodies, i)).toBe(true)
    rig.dispose()
  })

  it('ignores samples that are not in the lab yet (on the prep tray, unsent)', () => {
    const rig = createLabRig()
    const lab = fakeLab()
    lab.put(0, { stage: 'labelled', where: { line: 'tray' } })
    lab.put(1, { stage: 'drawn', where: { line: 'none' } })
    step(rig, lab)
    expect(rig.stats.drawn).toBe(0)
    rig.dispose()
  })
})

// ---------------------------------------------------------------------------------------------
// No allocation per frame
// ---------------------------------------------------------------------------------------------

describe('the lab rig: no allocation per frame', () => {
  it('a busy lab (belt, flight, buckets, probes, flashes) steps 60 000 frames and V8\'s sampling heap profiler finds (next to) nothing allocated by the rig', async () => {
    const lab = fakeLab()
    lab.state.archived = 20
    lab.state.centrifuges[0].phase = 'spinning'
    lab.state.centrifuges[0].rpm01 = 1
    lab.state.centrifuges[1].lid = 0.6
    const track: Sample[] = []
    for (let i = 0; i < 12; i++) track.push(lab.put(i, { stage: 'onTrack', priority: i % 3 === 0 ? 'stat' : 'routine', where: { line: 'track', sDraw: i * 1.7 } }))
    const fly = lab.put(12, { stage: 'inTube', where: { line: 'pneumatic', source: 1, sDraw: 3 } })
    for (let k = 0; k < 6; k++) lab.put(13 + k, { stage: 'centrifuge', where: { line: 'module', module: 'cfg0' }, stageAt: { centrifuge: 0 } })
    lab.put(20, { stage: 'decap', where: { line: 'module', module: 'decap' } })
    for (let k = 0; k < 3; k++) lab.put(21 + k, { stage: 'received', where: { line: 'module', module: 'receive' } })
    lab.state.analysers.chemistry.probe = 0.5
    const rig = createLabRig()
    // one input object and one lab, reused: the harness allocates nothing either (a fresh object literal a frame would be the test's own garbage)
    const input = { lab, generation: 0, simT: 100, dt: 1 / 60 }
    for (let f = 0; f < 5000; f++) {
      for (const s of track) s.where.sDraw = (s.where.sDraw + 0.02) % 20
      fly.where.sDraw = (f * 0.17) % PNEUMATIC_PATHS[1].length
      rig.step(input)
    }
    const session = new inspector.Session()
    session.connect()
    const post = (method: string, params?: object) => new Promise<{ profile?: SamplingProfile }>((resolve, reject) => session.post(method, params as never, (e, r) => (e ? reject(e) : resolve(r as never))))
    await post('HeapProfiler.enable')
    await post('HeapProfiler.startSampling', { samplingInterval: 64 })
    // the sim moves its own numbers between frames; the flight and the belt keep changing here too
    for (let f = 5000; f < 65000; f++) {
      for (const s of track) s.where.sDraw = (s.where.sDraw + 0.02) % 20
      fly.where.sDraw = (f * 0.17) % PNEUMATIC_PATHS[1].length
      lab.state.analysers.chemistry.probe = 0.5 + 0.5 * Math.sin(f / 9)
      input.simT = 100 + f / 60
      rig.step(input)
    }
    const { profile } = await post('HeapProfiler.stopSampling')
    session.disconnect()
    // everything the profile saw, by function; the harness itself (this file, the inspector, promises) is not the rig's
    const rows: [string, number][] = []
    const walk = (n: SamplingNode): void => {
      const own = /rig\.test|node:inspector|processTicks|task_queues|Promise/.test(`${n.callFrame.url} ${n.callFrame.functionName}`)
      if (!own && n.selfSize > 0) rows.push([`${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber}`, n.selfSize])
      n.children.forEach(walk)
    }
    walk(profile!.head)
    const total = rows.reduce((a, r) => a + r[1], 0)
    // eslint-disable-next-line no-console
    console.log(`rig allocation over 60 000 frames: ${total} bytes (${rows.map((r) => `${r[0]} ${r[1]}`).join('; ')})`)
    // 60 000 frames: under 400 KB, a few bytes a frame (the odd boxed double while V8 tiers the code up; a single {x, y, z} per slot per frame would be 12 MB)
    expect(total).toBeLessThan(400 * 1024)
    rig.dispose()
  }, 120_000)
})

interface SamplingNode {
  callFrame: { functionName: string; url: string; lineNumber: number }
  selfSize: number
  children: SamplingNode[]
}
interface SamplingProfile {
  head: SamplingNode
}
