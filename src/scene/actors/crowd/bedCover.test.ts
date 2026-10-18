// A patient in a bed (W3 wave B follow-up): the body lies IN the real mattress (ward bed 0.49, ER trolley 0.44, stretcher 0.79) and is covered by the crowd's
// blanket, which the rig carries as the prop of the lying person. The fit on the real meshes is in tools/people-bed.test.ts; this file tests the plumbing:
// the heights the crowd looks up, who is covered, the blanket's frame and its mesh, and the made beds the covers replace.
import { describe, expect, it } from 'vitest'
import { buildLayout } from '@/scene/building/layout'
import { BACKREST, MADE_BLANKET, MATTRESS, TROLLEY } from '@/scene/rooms/bedParts'
import { IMAGING } from '@/sim/places'
import type { Entity } from '@/sim/types'
import { FX, LIE, LIE_RECLINE_LIFT_MAX, P, PROP, ROW_FLOATS, TEX, VEHICLE, fixedSlot } from './constants'
import { buildVehicleGeometry } from './gear'
import { headPosition, inBlanketBed, levelsOf, type Levels } from './head'
import { CrowdModel, MAX_BLANKETS, type FrameInput } from './model'
import { createCrowdRig, driveCrowd } from './crowdRig'

function ent(o: Partial<Entity> & { id: string }): Entity {
  return { role: 'patient', outfit: 'gown', name: o.id, position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'idle', emote: 'none', mood: 'neutral', tier: 'near', variant: 3, ...o } as Entity
}

const inBed = (id: string, seatId: string, at: { x: number; z: number }, pose: 'lie' | 'recline' = 'lie'): Entity =>
  ent({ id, anim: 'lie', seated: { seatId, pose }, position: { x: at.x, y: 0, z: at.z } })

function frame(entities: Map<string, Entity>, t: number, cam: [number, number, number] = [0, 1.7, 8]): FrameInput {
  return { dt: 1 / 60, time: t, camX: cam[0], camY: cam[1], camZ: cam[2], entities, followId: null, selectedId: null, hoverId: null, driven: null }
}

/** The 12 floats of part `part` of a person's row in the model's pose texture. */
function partMatrix(m: CrowdModel, key: string, part: number): number[] {
  const row = m.get(key)!.row
  const o = row * ROW_FLOATS + TEX.parts * 4 + part * 12
  return Array.from(m.data.subarray(o, o + 12))
}

function run(m: CrowdModel, es: Map<string, Entity>, frames: number, t0 = 0): void {
  for (let i = 0; i < frames; i++) m.update(frame(es, t0 + i / 60))
}

describe('the surface a lying person is looked up at', () => {
  const lv: Levels = { posture: 'stand', floorY: 0, surface: 0 }

  it('is the real mattress top: ward bed 0.49, ER trolley 0.44, stretcher 0.79; the old 0.62 and 0.85 are gone', () => {
    expect(levelsOf(inBed('a', 'bed:A1', { x: 0, z: 0 }), lv)).toMatchObject({ posture: 'lie', floorY: 0, surface: MATTRESS.top })
    expect(levelsOf(inBed('b', 'bed:B8', { x: 0, z: 0 }, 'recline'), lv)).toMatchObject({ posture: 'lie', surface: MATTRESS.top })
    expect(levelsOf(inBed('c', 'erBay:bay:3', { x: 0, z: 0 }), lv)).toMatchObject({ posture: 'lie', surface: TROLLEY.top })
    expect(levelsOf(ent({ id: 'd', anim: 'idle', riding: true, vehicle: 'stretcher' }), lv)).toMatchObject({ posture: 'lie', surface: LIE.stretcher })
    expect(MATTRESS.top).toBeCloseTo(0.49, 9)
    expect(TROLLEY.top).toBeCloseTo(0.44, 9)
    expect(LIE.stretcher).toBeCloseTo(0.79, 9)
    // the imaging tables are looked up at their own heights, somebody lying with no seat to say where keeps the default, and a surface the sim does give still wins
    expect(levelsOf(inBed('e', 'scanTable:mri', { x: 0, z: 0 }), lv).surface).toBe(IMAGING.mri.table.height)
    expect(levelsOf(inBed('e', 'scanTable:ct', { x: 0, z: 0 }), lv).surface).toBe(IMAGING.ct.table.height)
    expect(levelsOf(inBed('e', 'xrayTable:xray', { x: 0, z: 0 }), lv).surface).toBe(IMAGING.xray.table.height)
    expect(levelsOf(inBed('e', 'usCouch:us', { x: 0, z: 0 }), lv).surface).toBe(IMAGING.us.table.height)
    expect(levelsOf(ent({ id: 'g', anim: 'lie' }), lv).surface).toBe(LIE.bed)
    expect(levelsOf(ent({ id: 'f', anim: 'lie', position: { x: 0, y: 0.7, z: 0 } }), lv).surface).toBe(0.7)
  })

  it('agrees with the seats the building layout exports for the beds (the sim\'s own seat heights)', () => {
    const seats = buildLayout().seats
    const wards = seats.filter((s) => s.id.startsWith('bed:'))
    const bays = seats.filter((s) => s.id.startsWith('erBay:'))
    expect(wards).toHaveLength(16)
    expect(bays.length).toBeGreaterThanOrEqual(6)
    for (const s of wards) expect(levelsOf(inBed('x', s.id, s), lv).surface, s.id).toBeCloseTo(s.height, 9)
    for (const s of bays) expect(levelsOf(inBed('x', s.id, s), lv).surface, s.id).toBeCloseTo(s.height, 9)
    // and for every other seat somebody can lie on (the imaging tables)
    for (const s of seats.filter((q) => q.pose === 'lie' && !q.id.startsWith('bed:') && !q.id.startsWith('erBay:'))) {
      expect(levelsOf(inBed('x', s.id, s), lv).surface, s.id).toBeCloseTo(s.height, 9)
    }
  })

  it('puts the head of a patient in a ward bed just over the 0.49 mattress, not 13 cm higher', () => {
    const out = { x: 0, y: 0, z: 0 }
    headPosition(inBed('h', 'bed:A1', { x: 2, z: 3 }), out)
    expect(out.y).toBeGreaterThan(MATTRESS.top)
    expect(out.y).toBeLessThan(MATTRESS.top + 0.25)
  })
})

describe('who is covered', () => {
  it('a patient in a ward bed, on an ER trolley or riding a stretcher; not somebody on a scanner table, a chair or their feet', () => {
    expect(inBlanketBed(inBed('a', 'bed:A1', { x: 0, z: 0 }))).toBe(true)
    expect(inBlanketBed(inBed('b', 'bed:B4', { x: 0, z: 0 }, 'recline'))).toBe(true)
    expect(inBlanketBed(inBed('c', 'erBay:bay:0', { x: 0, z: 0 }))).toBe(true)
    expect(inBlanketBed(ent({ id: 'd', anim: 'idle', riding: true, vehicle: 'stretcher' }))).toBe(true)
    expect(inBlanketBed(inBed('e', 'scanTable:ct', { x: 0, z: 0 }))).toBe(false)
    expect(inBlanketBed(inBed('f', 'xrayTable:xray', { x: 0, z: 0 }))).toBe(false)
    expect(inBlanketBed(inBed('g', 'usCouch:us', { x: 0, z: 0 }))).toBe(false)
    expect(inBlanketBed(ent({ id: 'h', anim: 'sit', seated: { seatId: 'waiting:er:S1:2', pose: 'sit' } }))).toBe(false)
    expect(inBlanketBed(ent({ id: 'i', anim: 'idle', riding: true, vehicle: 'wheelchair' }))).toBe(false)
    expect(inBlanketBed(ent({ id: 'j' }))).toBe(false)
    // a porter pushing the stretcher is not on it
    expect(inBlanketBed(ent({ id: 'k', anim: 'push', vehicle: 'stretcher' }))).toBe(false)
  })
})

describe('the blanket in the crowd model', () => {
  it('is carried by every covered lying patient, in the frame of the lying body: on the mattress under the hips, the size of the person', () => {
    const m = new CrowdModel()
    const es = new Map<string, Entity>([
      ['ward', inBed('ward', 'bed:A1', { x: -3, z: 3 })],
      ['bay', inBed('bay', 'erBay:bay:2', { x: 0, z: 3 })],
      ['scan', inBed('scan', 'scanTable:mri', { x: 3, z: 3 })],
      ['stretcher', ent({ id: 'stretcher', anim: 'idle', riding: true, vehicle: 'stretcher', position: { x: 6, y: 0, z: 3 } })],
      ['walker', ent({ id: 'walker', anim: 'walk', role: 'visitor', outfit: 'everyday', position: { x: -6, y: 0, z: 3 } })],
    ])
    run(m, es, 120)
    const st = m.stats
    expect(st.blankets).toBe(3)
    const rows = Array.from(m.blanketRows.subarray(0, st.blankets))
    for (const id of ['ward', 'bay', 'stretcher']) expect(rows, id).toContain(m.get(id)!.row)
    for (const id of ['scan', 'walker']) expect(rows, id).not.toContain(m.get(id)!.row)
    expect(Array.from(m.blanketKinds.subarray(0, st.blankets))).toEqual([PROP.blanket, PROP.blanket, PROP.blanket])
    // none of them is in the held-items list
    expect(Array.from(m.propKinds.subarray(0, st.props))).not.toContain(PROP.blanket)
    for (const [id, surface] of [['ward', MATTRESS.top], ['bay', TROLLEY.top], ['stretcher', LIE.stretcher]] as const) {
      const mat = partMatrix(m, id, P.prop)
      const s = m.get(id)!.look.scale
      // x across the bed, y up, z head to feet: a diagonal of the person's size, flat bodies untilted, the origin on the mattress under the hips
      expect(mat[0], id).toBeCloseTo(s, 5)
      expect(mat[10], id).toBeCloseTo(s, 5)
      expect(mat[5], id).toBeCloseTo(s, 5)
      for (const k of [1, 2, 4, 6, 8, 9]) expect(Math.abs(mat[k]), `${id} ${k}`).toBeLessThan(1e-6)
      expect(mat[3], id).toBeCloseTo(0, 5)
      expect(mat[7], id).toBeCloseTo(surface, 5)
      expect(mat[11], id).toBeCloseTo(0, 5)
    }
    // the stretcher rider's own stretcher is under them
    expect(m.get('stretcher')!.vKind).toBe(VEHICLE.stretcher)
  })

  it('rises as the patient lies down and goes when they get up, a motion rather than a pop', () => {
    const m = new CrowdModel()
    const e = ent({ id: 'p', anim: 'idle', position: { x: 0, y: 0, z: 3 } })
    const es = new Map([[e.id, e]])
    run(m, es, 20)
    expect(m.stats.blankets).toBe(0)
    // lies down in a ward bed
    e.anim = 'lie'
    e.seated = { seatId: 'bed:A3', pose: 'lie' }
    const sizes: number[] = []
    for (let i = 0; i < 90; i++) {
      m.update(frame(es, 1 + i / 60))
      sizes.push(m.stats.blankets > 0 ? partMatrix(m, 'p', P.prop)[5] : 0)
    }
    expect(sizes[0]).toBeLessThan(0.1)
    expect(sizes.at(-1)!).toBeGreaterThan(0.9 * m.get('p')!.look.scale)
    for (let i = 1; i < sizes.length; i++) expect(sizes[i] - sizes[i - 1], `rise at ${i}`).toBeGreaterThanOrEqual(-1e-6)
    expect(Math.max(...sizes.map((v, i) => (i ? v - sizes[i - 1] : 0)))).toBeLessThan(0.1)
    // gets up
    e.anim = 'idle'
    delete e.seated
    const fall: number[] = []
    for (let i = 0; i < 150; i++) {
      m.update(frame(es, 3 + i / 60))
      fall.push(m.stats.blankets > 0 ? partMatrix(m, 'p', P.prop)[5] : 0)
    }
    expect(fall.at(-1)).toBe(0)
    expect(m.stats.blankets).toBe(0)
    for (let i = 1; i < fall.length; i++) expect(fall[i] - fall[i - 1], `fall at ${i}`).toBeLessThanOrEqual(1e-6)
  })

  it('does not grow for a reclined patient, whose hips ride up with the backrest while the feet stay on the mattress (never more than the limit)', () => {
    const m = new CrowdModel()
    const es = new Map<string, Entity>([
      ['flat', inBed('flat', 'bed:A1', { x: -2, z: 3 })],
      ['up', inBed('up', 'bed:A2', { x: 2, z: 3 }, 'recline')],
    ])
    run(m, es, 240)
    const flat = partMatrix(m, 'flat', P.prop)
    const up = partMatrix(m, 'up', P.prop)
    const k = (id: string) => m.get(id)!.look.scale
    // the same blanket: the legs under it are as low as ever, only the hips are higher (and the blanket was cut for them)
    expect(up[5] / k('up')).toBeCloseTo(1, 5)
    expect(flat[5] / k('flat')).toBeCloseTo(1, 5)
    expect(up[7]).toBeCloseTo(MATTRESS.top, 5)
    expect(m.get('flat')!.rig.lastLift).toBe(0)
    const lift = m.get('up')!.rig.lastLift
    expect(lift).toBeGreaterThan(0.015)
    expect(lift).toBeLessThanOrEqual(LIE_RECLINE_LIFT_MAX + 1e-9)
    // the hinge is a little below the back
    expect(BACKREST.hingeY).toBeLessThan(MATTRESS.top)
  })

  it('keeps its list within capacity however many lie, and nothing grows while the crowd runs', () => {
    const m = new CrowdModel()
    const es = new Map<string, Entity>()
    for (let i = 0; i < 20; i++) es.set(`b${i}`, inBed(`b${i}`, `bed:A${(i % 8) + 1}`, { x: i * 2, z: 3 }))
    run(m, es, 30)
    expect(m.stats.blankets).toBe(20)
    expect(MAX_BLANKETS).toBeGreaterThanOrEqual(22 + 12)
    const caps = [m.blanketRows.length, m.blanketKinds.length, m.data.length]
    run(m, es, 30, 1)
    expect([m.blanketRows.length, m.blanketKinds.length, m.data.length]).toEqual(caps)
  })
})

describe('the blanket mesh of the crowd', () => {
  const entities = (n: number): Map<string, Entity> => {
    const es = new Map<string, Entity>()
    for (let i = 0; i < n; i++) es.set(`b${i}`, inBed(`b${i}`, `bed:A${i + 1}`, { x: i * 2, z: 3 }))
    es.set('walker', ent({ id: 'walker', role: 'visitor', outfit: 'everyday', anim: 'idle', position: { x: 0, y: 0, z: 6 } }))
    return es
  }

  it('is hidden while nobody is covered, one draw while somebody is, with the props material (the same program): at most one draw call more', () => {
    const rig = createCrowdRig()
    driveCrowd(rig, entities(0), 0, 40, 30, 1 / 60, 0)
    expect(rig.blankets.visible).toBe(false)
    expect(rig.blankets.material).toBe(rig.propsMaterial)
    const es = entities(6)
    for (let i = 0; i < 20; i++) driveCrowd(rig, es, 0, 40, 30, 1 / 60, i / 60)
    expect(rig.blankets.visible).toBe(true)
    expect(rig.blanketGeometry.instanceCount).toBe(6)
    expect(rig.objects).toContain(rig.blankets)
    expect(rig.objects.length).toBeLessThanOrEqual(8)
    const visible = rig.objects.filter((o) => o.visible)
    expect(visible.filter((o) => o.name === 'crowd-blankets')).toHaveLength(1)
    // they get up: the mesh is hidden again
    for (const e of es.values()) {
      if (e.id === 'walker') continue
      e.anim = 'idle'
      delete e.seated
    }
    for (let i = 0; i < 200; i++) driveCrowd(rig, es, 0, 40, 30, 1 / 60, 1 + i / 60)
    expect(rig.blankets.visible).toBe(false)
    rig.dispose()
  })
})

describe('the made beds the covers replace', () => {
  const layout = buildLayout()

  it('a ward bed keeps a blanket lying flat on the mattress with a teal fold, 3 cm thick, clear of the backrest part and of a lying body', () => {
    const prims = layout.prims.filter((p) => p.shape === 'roundedBox' && Math.abs(p.position[0] - layout.seats.find((s) => s.id === 'bed:A1')!.x) < 0.01)
    const blanket = prims.find((p) => p.mat === 'linen' && Math.abs(p.size[0] - 0.9) < 1e-9)!
    const fold = prims.find((p) => p.mat === 'fabricTeal' && Math.abs(p.size[0] - 0.91) < 1e-9)!
    expect(blanket).toBeDefined()
    expect(fold).toBeDefined()
    for (const p of [blanket, fold]) {
      expect(p.position[1] - p.size[1] / 2, p.mat).toBeCloseTo(MATTRESS.top, 9)
      expect(p.size[1], p.mat).toBeLessThanOrEqual(MADE_BLANKET + 0.015)
    }
  })

  it('an ER trolley\'s mattress top is the height its patient lies at, with a flat teal blanket on it', () => {
    const seat = layout.seats.find((s) => s.id === 'erBay:bay:0')!
    expect(seat.height).toBeCloseTo(TROLLEY.top, 9)
    const prims = layout.prims.filter((p) => p.shape === 'roundedBox' && Math.abs(p.position[0] - seat.x) < 0.01)
    const linen = prims.find((p) => p.mat === 'linen' && Math.abs(p.size[0] - (TROLLEY.w - 0.06)) < 1e-9)!
    expect(linen.position[1] + linen.size[1] / 2).toBeCloseTo(TROLLEY.top, 9)
    const blanket = prims.find((p) => p.mat === 'fabricTeal' && Math.abs(p.size[0] - (TROLLEY.w - 0.04)) < 1e-9)!
    expect(blanket.position[1] - blanket.size[1] / 2).toBeCloseTo(TROLLEY.top, 9)
    expect(blanket.size[1]).toBeCloseTo(MADE_BLANKET, 9)
  })

  it('the stretcher\'s mattress top is LIE.stretcher, a made blanket flat on it', () => {
    const g = buildVehicleGeometry().geometry
    const pos = g.getAttribute('position')
    const part = g.getAttribute('aPart')
    let mattress = -Infinity
    let blanket = -Infinity
    for (let i = 0; i < pos.count; i++) {
      if (Math.round(part.getX(i)) !== VEHICLE.stretcher) continue
      const slot = Math.round(part.getY(i))
      // the mattress's foot corners (the pillow is at the head end, and higher)
      if (slot === fixedSlot(FX.linen) && pos.getZ(i) > 0.9) mattress = Math.max(mattress, pos.getY(i))
      if (slot === fixedSlot(FX.fabricTeal)) blanket = Math.max(blanket, pos.getY(i))
    }
    expect(mattress).toBeCloseTo(LIE.stretcher, 5)
    expect(blanket).toBeCloseTo(LIE.stretcher + MADE_BLANKET, 5)
  })
})
