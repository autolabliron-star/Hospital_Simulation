import { type BufferGeometry, MeshBasicMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { DRAW_CENTRE } from '@/sim/places'
import type { DrawPhase, DrawStationState, DrawTicket, TubeKind, TubePrepState } from '@/sim/types'
import { triangles } from '@/scene/imaging/machines/geometry'
import { HEAD, NEEDLE_TRAVEL, PREP_STOPS, TUBE_SLOTS, headZ, parkS, robotDims } from './dims'
import { buildGlow, buildMovers, buildScreens } from './geometry'
import { PHASE_LIGHT } from './motion'
import { createDrawRig, disposeDrawRig, updateDrawRig, type BloodLike, type DrawRig } from './rig'

const stub = (): MeshBasicMaterial => new MeshBasicMaterial()

function station(i: number, o: Partial<DrawStationState> = {}): DrawStationState {
  return {
    index: i,
    phase: 'idle',
    phaseTime: 0,
    progress: 0,
    ticket: null,
    patientId: null,
    patientName: null,
    tubes: [],
    tube: 0,
    tubeFill: 0,
    inversions: 0,
    cuff: 0,
    needle: 0,
    scan: 0,
    trayHere: false,
    attendantId: null,
    light: 'white',
    attempts: 0,
    drawsToday: 0,
    robotDrawsToday: 0,
    nurseDrawsToday: 0,
    version: 0,
    ...o,
  }
}

function prepState(o: Partial<TubePrepState> = {}): TubePrepState {
  return { phase: 'idle', progress: 0, ticket: null, queue: 0, bin: -1, held: null, rack: [], traysToday: 0, version: 0, ...o }
}

function blood(stations: DrawStationState[], prep: TubePrepState = prepState(), queue: DrawTicket[] = [], nurseDraws = 0): BloodLike {
  return { stations, prep, queue, stats: { nurseDraws } }
}

const idle = (): BloodLike => blood([station(0), station(1), station(2)])

/** Run the rig `seconds` at 60 Hz on a state that may change through `state(t)`. */
function run(rig: DrawRig, seconds: number, state: (t: number) => BloodLike, t0 = 0): void {
  const n = Math.round(seconds * 60)
  for (let i = 0; i < n; i++) {
    const t = t0 + i / 60
    updateDrawRig(rig, state(t), 1 / 60, t)
  }
}

/** The rest geometry the rig was built from, to measure a part's pose. */
function partBox(rig: DrawRig, name: string): { min: [number, number, number]; max: [number, number, number] } {
  const i = rig.movers.parts.findIndex((p) => p.id === name)
  expect(i, name).toBeGreaterThanOrEqual(0)
  const p = rig.movers.parts[i]
  const pos = rig.movers.geometry.getAttribute('position').array as Float32Array
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let v = p.start; v < p.start + p.count; v++)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[3 * v + k])
      max[k] = Math.max(max[k], pos[3 * v + k])
    }
  return { min, max }
}
const centre = (b: { min: number[]; max: number[] }): number[] => b.min.map((m, k) => (m + b.max[k]) / 2)
const size = (b: { min: number[]; max: number[] }): number[] => b.min.map((m, k) => b.max[k] - m)

function finite(g: BufferGeometry): boolean {
  const a = g.getAttribute('position').array as Float32Array
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false
  return true
}

describe('budget', () => {
  const rig = createDrawRig(stub())

  it('draws at most 7 meshes and 45k triangles, every vertex finite', () => {
    const visible = rig.meshes.filter((m) => m.visible)
    const tris = visible.reduce((n, m) => n + triangles(m.geometry), 0)
    expect(visible.length).toBeLessThanOrEqual(7)
    expect(tris).toBeLessThan(45_000)
    for (const m of rig.meshes) expect(finite(m.geometry), m.name).toBe(true)
    // eslint-disable-next-line no-console
    console.log(`[draw centre rig] ${visible.length} draw calls, ${tris} triangles (${rig.meshes.map((m) => `${m.name} ${triangles(m.geometry)}`).join(', ')})`)
  })

  it('has three meshes: the moving parts, the glow, the screens; none cast and the moving ones are not auto-updated', () => {
    expect(rig.meshes.map((m) => m.name)).toEqual(['draw-movers', 'draw-glow', 'draw-screens'])
    for (const m of rig.meshes) {
      expect(m.castShadow, m.name).toBe(false)
      expect(m.matrixAutoUpdate, m.name).toBe(false)
    }
  })

  it('keeps a bounding sphere that holds the whole room so culling stays valid while parts move', () => {
    const s = rig.movers.geometry.boundingSphere!
    for (const [x, z] of [
      [-28, 2],
      [-22, 12],
      [-28, 12],
      [-22, 2],
    ]) expect(Math.hypot(x - s.center.x, 1 - s.center.y, z - s.center.z)).toBeLessThanOrEqual(s.radius)
  })

  it('disposing frees the geometries', () => {
    const r = createDrawRig(stub())
    let disposed = 0
    for (const m of r.meshes) m.geometry.addEventListener('dispose', () => disposed++)
    disposeDrawRig(r)
    expect(disposed).toBe(3)
  })

  it('every part is baked once with a unique id', () => {
    const ids = rig.movers.parts.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    // 3 robots x (head, needle, cuff, 5 bars) + the prep machine (bridge, carriage, rod, grip head, 2 fingers, 3 held, 3 trays)
    expect(ids.length).toBe(3 * 8 + 12)
  })
})

describe('geometry builders', () => {
  it('the glow has a status bar, a NIR strip and 8 chaser segments per robot, and the label, ticket and inlet regions', () => {
    const g = buildGlow()
    for (let i = 0; i < 3; i++) {
      expect(g.regions[`led${i}`]).toBeDefined()
      expect(g.regions[`nir${i}`]).toBeDefined()
      for (let k = 0; k < 8; k++) expect(g.regions[`chase${i}_${k}`], `chase ${i} ${k}`).toBeDefined()
    }
    for (const k of ['label', 'ticket', 'inlet']) expect(g.regions[k], k).toBeDefined()
    expect(finite(g.geometry)).toBe(true)
  })

  it('the screens are three quads facing the chairs, each showing its own third of the strip', () => {
    const g = buildScreens()
    expect(g.getAttribute('position').count).toBe(12)
    const uv = g.getAttribute('uv')
    for (let i = 0; i < 3; i++) {
      const us: number[] = []
      for (let v = 4 * i; v < 4 * i + 4; v++) us.push(uv.getX(v))
      expect(Math.min(...us)).toBeCloseTo(i / 3, 6)
      expect(Math.max(...us)).toBeCloseTo((i + 1) / 3, 6)
    }
    const n = g.getAttribute('normal')
    for (let v = 0; v < 12; v++) {
      expect(n.getZ(v)).toBeLessThan(-0.9) // facing north, towards the chair
      expect(n.getY(v)).toBeGreaterThan(0) // leaning back: the face looks up a little
    }
  })

  it('the movers start in their rest pose: a robot head at the wrist end, over the arm line', () => {
    const m = buildMovers()
    expect(m.robots.length).toBe(3)
    for (let i = 0; i < 3; i++) {
      const d = robotDims(i)
      const i0 = m.movers.parts.findIndex((p) => p.id === `head${i}`)
      expect(i0).toBeGreaterThanOrEqual(0)
      expect(m.robots[i].rest.headZ).toBeCloseTo(d.arm.z0, 9)
    }
  })
})

describe('animation from the draw state', () => {
  it('an idle centre parks every head deep in the tunnel and hides the bars, the held tube and the trays', () => {
    const rig = createDrawRig(stub())
    run(rig, 1, idle)
    for (let i = 0; i < 3; i++) {
      const d = robotDims(i)
      const head = centre(partBox(rig, `head${i}`))
      expect(head[0]).toBeCloseTo(d.arm.x, 3)
      expect(head[1]).toBeCloseTo(HEAD.y - 0.003, 1)
      expect(head[2]).toBeGreaterThan(d.arm.z0) // towards the cabinet
      expect(head[2]).toBeCloseTo(d.arm.zPark, 2)
      for (let k = 0; k < TUBE_SLOTS.count; k++) expect(size(partBox(rig, `bar${i}_${k}`))[1], `bar ${i} ${k}`).toBeLessThan(1e-6)
    }
    expect(size(partBox(rig, 'heldBody'))[1]).toBeLessThan(1e-6)
    for (let k = 0; k < 3; k++) expect(size(partBox(rig, `tray${k}`))[1]).toBeLessThan(1e-6)
  })

  it('the head follows scan during the vein scan, holds for the needle and returns to park afterwards', () => {
    const rig = createDrawRig(stub())
    const d = robotDims(1)
    const scanning = (scan: number): BloodLike => blood([station(0), station(1, { phase: 'veinScan', scan, ticket: 'P001' }), station(2)])
    run(rig, 1.5, () => scanning(0.5))
    let z = centre(partBox(rig, 'head1'))[2]
    expect(z).toBeCloseTo(headZ(d.arm, 0.5), 2)
    run(rig, 1.5, () => scanning(1))
    z = centre(partBox(rig, 'head1'))[2]
    expect(z).toBeCloseTo(headZ(d.arm, 1), 2)
    // the needle goes in: the head holds where the scan ended even if the sim resets `scan`
    const holding = (needle: number): BloodLike => blood([station(0), station(1, { phase: 'needleIn', scan: 0, needle, ticket: 'P001' }), station(2)])
    run(rig, 1.5, () => holding(1))
    expect(centre(partBox(rig, 'head1'))[2]).toBeCloseTo(headZ(d.arm, 1), 2)
    const needle = partBox(rig, 'needle1')
    expect(needle.min[1]).toBeCloseTo(HEAD.y - HEAD.halfY + 0.005 - NEEDLE_TRAVEL, 2) // the tip in the skin
    run(rig, 3, idle)
    expect(centre(partBox(rig, 'head1'))[2]).toBeCloseTo(d.arm.zPark, 2)
    expect(partBox(rig, 'needle1').min[1]).toBeGreaterThan(HEAD.y - HEAD.halfY) // hidden in the head again
  })

  it('every head position is inside the tunnel and the head never leaves the hood', () => {
    const rig = createDrawRig(stub())
    for (let i = 0; i < 3; i++) {
      const d = robotDims(i)
      for (const s of [parkS(d.arm), 0, 0.5, 1]) {
        const z = headZ(d.arm, s)
        expect(z - HEAD.halfZ).toBeGreaterThanOrEqual(d.arm.zMouth)
        expect(z + HEAD.halfZ).toBeLessThanOrEqual(d.arm.zFront + 0.03)
      }
    }
    expect(rig.meshes.length).toBe(3)
  })

  it('the tourniquet tightens with cuff and the bars fill in cap colours in turn', () => {
    const rig = createDrawRig(stub())
    const open = size(partBox(rig, 'cuff0'))
    run(rig, 1, () => blood([station(0, { phase: 'cuff', cuff: 1 }), station(1), station(2)]))
    const tight = size(partBox(rig, 'cuff0'))
    expect(tight[0]).toBeLessThan(open[0] * 0.85)
    const tubes: TubeKind[] = ['citrate', 'serum', 'EDTA', 'fluoride']
    run(rig, 1, () => blood([station(0, { phase: 'filling', tubes, tube: 1, tubeFill: 0.5 }), station(1), station(2)]))
    const full = TUBE_SLOTS.full
    expect(size(partBox(rig, 'bar0_0'))[1]).toBeCloseTo(full, 3)
    expect(size(partBox(rig, 'bar0_1'))[1]).toBeCloseTo(full * 0.5, 3)
    expect(size(partBox(rig, 'bar0_2'))[1]).toBeLessThan(1e-6)
    // a tube bar grows from its base
    expect(partBox(rig, 'bar0_1').min[1]).toBeCloseTo(TUBE_SLOTS.base, 3)
    // the colour follows the kind: the first bar is the light-blue citrate cap, not the gold it was built with
    const col = rig.movers.geometry.getAttribute('color').array as Float32Array
    const p = rig.movers.parts[rig.movers.parts.findIndex((q) => q.id === 'bar0_0')]
    const gold = rig.movers.parts[rig.movers.parts.findIndex((q) => q.id === 'bar0_1')]
    expect(col[3 * p.start + 2]).toBeGreaterThan(col[3 * p.start]) // blue above red
    expect(col[3 * gold.start]).toBeGreaterThan(col[3 * gold.start + 2]) // gold: red above blue
  })

  it('the prep gripper goes to the bin, to the printer, spins the held tube and shows the trays', () => {
    const rig = createDrawRig(stub())
    const homeX = centre(partBox(rig, 'prepCarriage'))
    run(rig, 2, () => blood([station(0), station(1), station(2)], prepState({ phase: 'picking', bin: 7, held: null, progress: 0.9 })))
    const atBin = centre(partBox(rig, 'prepCarriage'))
    expect(Math.hypot(atBin[0] - homeX[0], atBin[2] - homeX[2])).toBeGreaterThan(0.05)
    run(rig, 2, () => blood([station(0), station(1), station(2)], prepState({ phase: 'labelling', bin: 7, held: 'EDTA', progress: 0.8, rack: ['P001', 'P002'] })))
    expect(size(partBox(rig, 'heldBody'))[1]).toBeGreaterThan(0.05)
    expect(size(partBox(rig, 'tray0'))[1]).toBeGreaterThan(0.01)
    expect(size(partBox(rig, 'tray1'))[1]).toBeGreaterThan(0.01)
    expect(size(partBox(rig, 'tray2'))[1]).toBeLessThan(1e-6)
    // the wrap station: the carriage sits at the wrap stop
    const wrap = centre(partBox(rig, 'prepCarriage'))
    expect(Math.hypot(wrap[0] - atBin[0], wrap[2] - atBin[2])).toBeGreaterThan(0.05)
    // the gripper is inside the machine's deck
    expect(wrap[1]).toBeGreaterThan(PREP_STOPS.yBeam - 0.05)
  })

  it('a paused sim (dt 0) holds every pose', () => {
    const rig = createDrawRig(stub())
    const scanning = blood([station(0, { phase: 'veinScan', scan: 0.7 }), station(1), station(2)])
    run(rig, 1, () => scanning)
    const before = Array.from(rig.movers.geometry.getAttribute('position').array as Float32Array)
    for (let i = 0; i < 30; i++) updateDrawRig(rig, scanning, 0, 5 + i / 60)
    const after = Array.from(rig.movers.geometry.getAttribute('position').array as Float32Array)
    expect(after).toEqual(before)
  })
})

describe('a whole scripted draw', () => {
  const phases: [DrawPhase, number][] = [
    ['calling', 2],
    ['cardScan', 4],
    ['armIn', 8],
    ['cuff', 10],
    ['sanitise', 10],
    ['veinScan', 20],
    ['needleIn', 8],
    ['filling', 60],
    ['needleOut', 5],
    ['bandage', 8],
    ['release', 6],
    ['reset', 8],
  ]

  it('every pose stays continuous (no head jump above 4 cm in a frame) and inside the tunnel', () => {
    const rig = createDrawRig(stub())
    const tubes: TubeKind[] = ['citrate', 'serum', 'heparin', 'EDTA']
    const total = phases.reduce((n, [, d]) => n + d, 0)
    const at = (t: number): DrawStationState => {
      let acc = 0
      for (const [phase, dur] of phases) {
        if (t < acc + dur) {
          const k = (t - acc) / dur
          return station(2, {
            phase,
            progress: k,
            ticket: 'P007',
            tubes,
            scan: phase === 'veinScan' ? Math.min(1, k * 1.4) : 0,
            needle: phase === 'needleIn' ? k : phase === 'filling' ? 1 : phase === 'needleOut' ? 1 - k : 0,
            cuff: phase === 'cuff' ? k : phase === 'sanitise' || phase === 'veinScan' || phase === 'needleIn' || phase === 'filling' ? 1 : phase === 'needleOut' ? 1 : 0,
            tube: phase === 'filling' ? Math.min(3, Math.floor(k * 4)) : 0,
            tubeFill: phase === 'filling' ? (k * 4) % 1 : 0,
            light: PHASE_LIGHT[phase],
          })
        }
        acc += dur
      }
      return station(2)
    }
    const d = robotDims(2)
    let last = Number.NaN
    let worst = 0
    let minZ = Infinity
    let maxZ = -Infinity
    for (let f = 0; f < total * 60; f++) {
      const t = f / 60
      updateDrawRig(rig, blood([station(0), station(1), at(t)]), 1 / 60, t)
      const z = centre(partBox(rig, 'head2'))[2]
      if (!Number.isNaN(last)) worst = Math.max(worst, Math.abs(z - last))
      last = z
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
    expect(worst).toBeLessThan(0.04)
    expect(minZ).toBeGreaterThanOrEqual(d.arm.zMouth + HEAD.halfZ - 1e-6)
    expect(maxZ).toBeLessThanOrEqual(d.arm.zFront + 0.03 - HEAD.halfZ)
    const geo = rig.movers.geometry.getAttribute('position').array as Float32Array
    for (let i = 0; i < geo.length; i++) expect(Number.isFinite(geo[i])).toBe(true)
  })

  it('the status bar, the NIR light and the chaser change with the phase', () => {
    const rig = createDrawRig(stub())
    const col = (name: string): Float32Array => {
      const rg = rig.glow.regions[name]
      const a = rig.glow.geometry.getAttribute('color').array as Float32Array
      return a.slice(rg.start * 4, rg.start * 4 + 4)
    }
    run(rig, 1, idle)
    expect(col('nir0')[3]).toBeLessThan(0.01)
    expect(col('led0')[0]).toBeGreaterThan(0.5) // white
    run(rig, 1, () => blood([station(0, { phase: 'veinScan', light: 'amber' }), station(1), station(2)]))
    expect(col('nir0')[3]).toBeGreaterThan(0.9)
    expect(col('nir0')[0]).toBeGreaterThan(col('nir0')[2]) // deep red
    const led = col('led0')
    expect(led[0]).toBeGreaterThan(led[2] * 2) // amber, not white
    // exactly the head of the chase and its trail are lit while scanning
    let lit = 0
    for (let k = 0; k < 8; k++) if (col(`chase0_${k}`)[3] > 0.2) lit++
    expect(lit).toBeGreaterThanOrEqual(1)
    expect(lit).toBeLessThanOrEqual(4)
  })

  it('the ticket slot and the send inlet flash on a new ticket and a hand draw, then fade', () => {
    const rig = createDrawRig(stub())
    const ticket = (issuedAt: number): DrawTicket => ({ id: 'P001', cls: 'P', patientId: 'x', patientName: 'Synthetic', orderId: 'o', issuedAt, calledAt: null, station: null, state: 'waiting' })
    const alpha = (name: string): number => (rig.glow.geometry.getAttribute('color').array as Float32Array)[rig.glow.regions[name].start * 4 + 3]
    run(rig, 1, () => blood([station(0), station(1), station(2)], prepState(), [ticket(10)], 0))
    expect(alpha('ticket')).toBeLessThan(0.35)
    updateDrawRig(rig, blood([station(0), station(1), station(2)], prepState(), [ticket(10), ticket(20)], 1), 1 / 60, 3)
    expect(alpha('ticket')).toBeGreaterThan(0.9)
    expect(alpha('inlet')).toBeGreaterThan(0.9)
    run(rig, 2, () => blood([station(0), station(1), station(2)], prepState(), [ticket(10), ticket(20)], 1), 3)
    expect(alpha('ticket')).toBeLessThan(0.35)
    expect(alpha('inlet')).toBeLessThan(0.35)
  })

  it('the chair of each robot faces its cabinet and the arm line leaves the cabinet face straight', () => {
    for (let i = 0; i < 3; i++) {
      expect(DRAW_CENTRE.robots[i].chair.heading).toBe(0)
      const d = robotDims(i)
      expect(d.arm.zMouth).toBeLessThan(d.arm.zHand)
      expect(d.arm.zFront).toBeGreaterThan(d.arm.zHand)
    }
  })
})
