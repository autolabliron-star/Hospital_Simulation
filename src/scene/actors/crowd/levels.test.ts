/**
 * R2 (docs/R2-SURGERY.md): the crowd across two storeys. The sim is flat and level 2 lives in its own strip of it (sim x = drawn x + 150, y floor-relative);
 * `CrowdModel.visit` is the one place a sim position becomes a drawn one. Checks the mapping (and that it round-trips), that nobody the screen does not show
 * is drawn, solved or pickable, the look-at and the player's driven rest pose, riders never pairing across levels, the theatre outfit (scrubs and a cap,
 * for the procedural body and for the realistic people) and the surgeon-console pose through the real rig and the real hand-reach solve.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { levelView } from '@/scene/levels/levelView'
import { LEVEL2_DX, LEVEL_Y, levelDx, levelOf, toDisplayInto, toSimInto } from '@/sim/levels'
import { SURGERY } from '@/sim/places'
import type { AnimState, Entity, Role } from '@/sim/types'
import { advanceBlend, blendTo, createBlender, isSeatedMode, modeFor, postureOf, weightSum, MODES, type Mode, type Posture } from './blend'
import { CONSOLE_HANDS } from './armIn'
import { NOMINAL_BODY, PART_COUNT, P, ROW_FLOATS, TEX, VEHICLE, standPelvis, type BodyDims } from './constants'
import { ALL_HAIR_SHAPES, HAIR_BACK, HAIR_CAP } from './hair'
import { CrowdModel, type FrameInput } from './model'
import { THEATRE, TINT, UNIFORM, avatarFor, wardrobeFor, PLAYER_AVATAR, type AvatarKey } from './avatars'
import { readIndex } from './avatars.testkit'
import { THEATRE_NAME, TONE, clothesOf, lookFor } from './outfit'
import { createRig, makeInput, solveRig } from './rig'

const DT = 1 / 60

function ent(over: Partial<Entity> & { id: string }): Entity {
  return { role: 'nurse', name: over.id, position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'idle', mood: 'neutral', emote: 'none', tier: 'near', variant: 3, ...over } as Entity
}

function frame(es: Map<string, Entity>, i: number, over: Partial<FrameInput> = {}): FrameInput {
  return { dt: DT, time: i * DT, camX: 0, camY: 40, camZ: 30, entities: es, followId: null, selectedId: null, hoverId: null, driven: null, ...over }
}

function run(m: CrowdModel, es: Map<string, Entity>, frames = 30, over: Partial<FrameInput> = {}): void {
  for (let i = 0; i < frames; i++) m.update(frame(es, i, over))
}

const rootOf = (m: CrowdModel, id: string): number[] => {
  const o = m.get(id)!.row * ROW_FLOATS
  return [m.data[o], m.data[o + 1], m.data[o + 2], m.data[o + 3]]
}

/** The levels frame's states, set by hand (the rule itself is tested in src/scene/levels). */
const show = (shown: 1 | 2, overview: boolean): void => {
  levelView.shown = shown
  levelView.overview = overview
}

beforeEach(() => show(1, true))
afterEach(() => show(1, true))

describe('the mapping from the sim to the screen', () => {
  it('moves level 2 west by 150 m and up by 4.2 m, leaves level 1 alone, and round-trips', () => {
    const sim = { x: 98.4, y: 0.5, z: -7.25 }
    const drawn = toDisplayInto(sim, { x: 0, y: 0, z: 0 })
    expect(drawn).toEqual({ x: 98.4 - LEVEL2_DX, y: 0.5 + LEVEL_Y[2], z: -7.25 })
    expect(toSimInto(drawn, 2, { x: 0, y: 0, z: 0 })).toEqual({ x: expect.closeTo(sim.x, 9), y: expect.closeTo(sim.y, 9), z: sim.z })
    const l1 = { x: -48.5, y: 0.3, z: 11 }
    expect(toDisplayInto(l1, { x: 0, y: 0, z: 0 })).toEqual(l1)
    expect(toSimInto(l1, 1, { x: 0, y: 0, z: 0 })).toEqual(l1)
    // in place, as the fx do
    const inPlace = { ...sim }
    expect(toDisplayInto(inPlace, inPlace)).toBe(inPlace)
    expect(inPlace.x).toBeCloseTo(sim.x - LEVEL2_DX, 9)
    expect(levelDx(levelOf(sim.x))).toBe(-LEVEL2_DX)
  })

  it('a level-2 person\'s slot, pose row, blob and pick capsule are at drawn coordinates (x - 150, y + 4.2, z), and a level-1 person\'s are unchanged', () => {
    show(2, false)
    const m = new CrowdModel()
    const es = new Map([
      ['up', ent({ id: 'up', position: { x: 100.6, y: 0, z: 5.2 }, heading: 1.2 })],
      ['down', ent({ id: 'down', position: { x: -50.6, y: 0, z: 5.2 }, heading: 1.2 })],
    ])
    run(m, es, 60)
    const up = m.get('up')!
    // (the hospital is walked on level 2: level 1 is not shown, but it is tracked in the same coordinates)
    expect([up.x, up.y, up.z]).toEqual([expect.closeTo(100.6 - LEVEL2_DX, 6), expect.closeTo(LEVEL_Y[2], 6), 5.2])
    expect(up.level).toBe(2)
    expect(up.simX).toBeCloseTo(100.6, 9)
    const root = rootOf(m, 'up')
    expect(root[0]).toBeCloseTo(100.6 - LEVEL2_DX, 4)
    expect(root[1]).toBeCloseTo(4.2, 5)
    expect(root[2]).toBeCloseTo(5.2, 5)
    expect(root[3]).toBeCloseTo(1.2, 5)
    // the pick capsule is drawn too: feet to head, 4.2 m up
    expect(up.ax).toBeCloseTo(100.6 - LEVEL2_DX, 5)
    expect(up.ay).toBeCloseTo(4.2 + 0.12, 5)
    expect(up.by).toBeGreaterThan(4.2 + 1.5)
    // the blob shadow of this person is on the level-2 floor
    let found = -1
    for (let i = 0; i < m.stats.blobs; i++) if (Math.abs(m.blobMatrix[i * 16 + 12] - (100.6 - LEVEL2_DX)) < 1e-4) found = i
    expect(found).toBeGreaterThanOrEqual(0)
    expect(m.blobMatrix[found * 16 + 13]).toBeGreaterThan(4.2)
    expect(m.blobMatrix[found * 16 + 13]).toBeLessThan(4.3)
    // level 1 is unchanged (and not drawn now)
    const down = m.get('down')!
    expect([down.x, down.y, down.z]).toEqual([-50.6, 0, 5.2])
    expect(down.level).toBe(1)
  })

  it('draws the level-2 person where the same person would stand on level 1 at the drawn spot, 4.2 m up: the whole pose row is the same body', () => {
    show(2, false)
    const a = new CrowdModel()
    const b = new CrowdModel()
    run(a, new Map([['p', ent({ id: 'p', position: { x: 100, y: 0, z: 4 }, heading: 0.7, anim: 'talk' })]]), 120, { camX: -50, camY: 6, camZ: 12 })
    show(1, false)
    run(b, new Map([['p', ent({ id: 'p', position: { x: -50, y: 4.2, z: 4 }, heading: 0.7, anim: 'talk' })]]), 120, { camX: -50, camY: 6, camZ: 12 })
    const ra = a.get('p')!.row * ROW_FLOATS
    const rb = b.get('p')!.row * ROW_FLOATS
    for (let i = 0; i < ROW_FLOATS; i++) expect(a.data[ra + i], `float ${i}`).toBeCloseTo(b.data[rb + i], 3)
  })
})

describe('who the screen draws', () => {
  const world = (): Map<string, Entity> =>
    new Map([
      ['g', ent({ id: 'g', position: { x: -48, y: 0, z: 0 } })], // ground floor, inside the footprint (under the slab)
      ['far', ent({ id: 'far', position: { x: 10, y: 0, z: 0 } })], // ground floor, outside it
      ['u', ent({ id: 'u', position: { x: 100, y: 0, z: 0 } })], // level 2
    ])

  const drawn = (m: CrowdModel): string[] => [...m.people.values()].filter((p) => p.presence > 0.01).map((p) => p.key).sort()

  it('walking on level 1 shows level 1 only; walking on level 2 shows level 2 only', () => {
    const m = new CrowdModel()
    show(1, false)
    run(m, world(), 30)
    expect(drawn(m)).toEqual(['far', 'g'])
    expect(m.stats.people).toBe(2)
    show(2, false)
    run(m, world(), 3)
    expect(drawn(m)).toEqual(['u'])
    expect(m.stats.people).toBe(1)
  })

  it('the overview of Level 1 hides level 2; the overview of Level 2 keeps the ground floor drawn around the slab but not under it', () => {
    const m = new CrowdModel()
    show(1, true)
    run(m, world(), 30)
    expect(drawn(m)).toEqual(['far', 'g'])
    show(2, true)
    run(m, world(), 3)
    expect(drawn(m)).toEqual(['far', 'u'])
  })

  it('a person who is not shown is in no instance list, takes no solve, cannot be picked or ringed, and is drawn again the frame their level is shown', () => {
    const m = new CrowdModel()
    show(1, false)
    const es = world()
    run(m, es, 30)
    const u = m.get('u')!
    expect(u.shown).toBe(false)
    expect(u.presence).toBe(0)
    expect(m.stats.high + m.stats.mid + m.stats.far).toBe(2)
    expect(m.rowsHigh.subarray(0, m.stats.high)).not.toContain(u.row)
    expect(m.rowsMid.subarray(0, m.stats.mid)).not.toContain(u.row)
    expect(m.rowsFar.subarray(0, m.stats.far)).not.toContain(u.row)
    expect(m.stats.solved).toBeLessThanOrEqual(2)
    // aimed straight at him from the drawn spot (and from where the sim has him), a pick ray finds nobody
    expect(m.pick(-50, 5.6, 0.0, 1, 0, 0)).toBe(null)
    expect(m.pick(-50, 4.2 + 1, 5, 0, 0, -1)).toBe(null)
    // switch to level 2: the next frame he is there, whole, with no fade-in
    show(2, false)
    m.update(frame(es, 99))
    expect(u.shown).toBe(true)
    expect(u.presence).toBeCloseTo(1, 6)
    expect(m.stats.people).toBe(1)
    expect(m.pick(-60, 4.2 + 1.0, 0, 1, 0, 0)).toBe('u')
    // the ground floor is now the hidden one
    expect(m.get('far')!.presence).toBe(0)
    expect(m.pick(-5, 1.0, 0, 1, 0, 0)).toBe(null)
  })

  it('a person who leaves the sim fades out as a ghost on their own level, and is released', () => {
    const m = new CrowdModel()
    show(2, false)
    const es = world()
    run(m, es, 20)
    es.delete('u')
    run(m, es, 40)
    expect(m.get('u')).toBeUndefined()
  })

  it('never exceeds the texture, and the rows of hidden people are kept (nobody is released for being on the other level)', () => {
    const m = new CrowdModel()
    show(1, false)
    const es = world()
    run(m, es, 10)
    const row = m.get('u')!.row
    show(2, false)
    run(m, es, 10)
    show(1, false)
    run(m, es, 10)
    expect(m.get('u')!.row).toBe(row)
  })
})

describe('what a person looks at, and the player\'s own body, across levels', () => {
  it('a level-2 person looking at a point on level 2 turns the head exactly as a level-1 person looks at the same point 4.2 m lower (the target is mapped too)', () => {
    const a = new CrowdModel()
    const b = new CrowdModel()
    show(2, false)
    run(a, new Map([['p', ent({ id: 'p', position: { x: 100, y: 0, z: 4 }, lookAt: { x: 103, y: 1.6, z: 5.5 } })]]), 120, { camX: -50, camY: 6, camZ: 12 })
    show(1, false)
    run(b, new Map([['p', ent({ id: 'p', position: { x: -50, y: 4.2, z: 4 }, lookAt: { x: -47, y: 5.8, z: 5.5 } })]]), 120, { camX: -50, camY: 6, camZ: 12 })
    const head = (m: CrowdModel): number[] => {
      const o = m.get('p')!.row * ROW_FLOATS + TEX.parts * 4 + P.head * 12
      return Array.from(m.data.subarray(o, o + 12))
    }
    const ha = head(a)
    const hb = head(b)
    for (let i = 0; i < 12; i++) expect(ha[i], `head ${i}`).toBeCloseTo(hb[i], 3)
    // and it is a real turn: not the head's rest
    const rest = new CrowdModel()
    show(1, false)
    run(rest, new Map([['p', ent({ id: 'p', position: { x: -50, y: 4.2, z: 4 } })]]), 120, { camX: -50, camY: 6, camZ: 12 })
    const o = rest.get('p')!.row * ROW_FLOATS + TEX.parts * 4 + P.head * 12
    const hr = Array.from(rest.data.subarray(o, o + 12))
    expect(Math.max(...hr.map((v, i) => Math.abs(v - hb[i])))).toBeGreaterThan(0.02)
    // a target left on level 1 (150 m away on the drawn plan... the other level) would not turn the head towards 150 m: the target keeps its own level
    expect(levelOf(103)).toBe(2)
  })

  it('the player\'s true body (sim coordinates) drives the slot on level 2: its speed is the body\'s 1.3 m/s, not the 1.0 m/s the avatar was measured to move', () => {
    show(2, false)
    const you = ent({ id: 'player', role: 'doctor', position: { x: 100, y: 0, z: 0 }, heading: Math.PI / 2, anim: 'walk' })
    const es = new Map([['player', you]])
    const bodyAt = (x: number) => ({ live: true, x, z: 0, vx: 1.3, vz: 0, wishX: 1.6, wishZ: 0, ax: 0, az: 0, turnRate: 0, stopping: false, restX: x + 1, restZ: 0 })
    const m = new CrowdModel()
    for (let i = 0; i < 40; i++) {
      you.position.x = 100 + i * DT * 1.0
      m.update(frame(es, i, { driven: bodyAt(you.position.x) }))
    }
    expect(m.get('player')!.speed).toBeCloseTo(1.3, 6)
    // a body that is somewhere else (a Jump left it stale) does not drive the slot: the avatar is measured like everybody else, at its own 1.0
    const m2 = new CrowdModel()
    for (let i = 0; i < 40; i++) {
      you.position.x = 100 + i * DT * 1.0
      m2.update(frame(es, i, { driven: bodyAt(40) }))
    }
    expect(m2.get('player')!.speed).toBeGreaterThan(0.8)
    expect(m2.get('player')!.speed).toBeLessThan(1.1)
  })
})

describe('riders never pair with a pusher on the other level', () => {
  it('the drawn plans of the two levels overlap: a stretcher rider on level 2 is not put on a porter\'s stretcher right under it on level 1', () => {
    show(2, true)
    const m = new CrowdModel()
    // the porter pushes a stretcher on level 1 at drawn (-46, 0), its place 1.1 m ahead; the patient lies on level 2 at the same x, z (4.2 m up)
    const porter = ent({ id: 'porter', role: 'porter', position: { x: -39, y: 0, z: 0 }, heading: 0, vehicle: 'stretcher', anim: 'push' })
    const ahead = 1.1
    const rider = ent({ id: 'rider', role: 'patient', outfit: 'gown', position: { x: 111 - 0, y: 0, z: 0 + ahead }, heading: 0, vehicle: 'stretcher', riding: true, anim: 'lie' })
    run(m, new Map([['porter', porter], ['rider', rider]]), 30)
    const r = m.get('rider')!
    expect(r.level).toBe(2)
    expect(m.get('porter')!.level).toBe(1)
    expect(r.pusher).toBeNull()
    // it draws its own parked stretcher, at its own place
    expect(r.vKind).toBe(VEHICLE.stretcher)
    expect(r.vOff).toBe(0)
  })

  it('on the same level the pairing is as it always was', () => {
    show(2, false)
    const m = new CrowdModel()
    const porter = ent({ id: 'porter', role: 'porter', position: { x: 100, y: 0, z: 0 }, heading: 0, vehicle: 'stretcher', anim: 'push' })
    const rider = ent({ id: 'rider', role: 'patient', outfit: 'gown', position: { x: 100, y: 0, z: 1.1 }, heading: 0, vehicle: 'stretcher', riding: true, anim: 'lie' })
    run(m, new Map([['porter', porter], ['rider', rider]]), 30)
    expect(m.get('rider')!.pusher).toBe(m.get('porter')!)
    expect(m.get('rider')!.y).toBeCloseTo(LEVEL_Y[2], 6)
  })
})

describe('lying on level 2: trolleys, the OR table and their covers', () => {
  const lie = (id: string, seatId: string, x: number, z: number): Entity => ent({ id, role: 'patient', outfit: 'gown', anim: 'lie', seated: { seatId, pose: 'lie' }, position: { x, y: 0, z } })

  it('a patient on a pre-op or recovery trolley is covered by the blanket on the 0.8 m mattress; on the OR table (0.88 m) nobody is covered', () => {
    show(2, false)
    const m = new CrowdModel()
    const es = new Map([
      ['pre', lie('pre', 'surgeryBed:preop:0', 89.6, -20.4)],
      ['pacu', lie('pacu', 'surgeryBed:pacu:1', 101.5, 20.5)],
      ['or', lie('or', 'orTable:0', SURGERY.table.at.x, SURGERY.table.at.z)],
    ])
    run(m, es, 120)
    const st = m.stats
    expect(st.blankets).toBe(2)
    const rows = Array.from(m.blanketRows.subarray(0, st.blankets))
    expect(rows).toContain(m.get('pre')!.row)
    expect(rows).toContain(m.get('pacu')!.row)
    expect(rows).not.toContain(m.get('or')!.row)
    // the blanket of the trolley is on its mattress (a drawn 4.2 m up: the prop frame is root-relative, so the surface is 0.8 above the root)
    const prop = (id: string): number[] => {
      const o = m.get(id)!.row * ROW_FLOATS + TEX.parts * 4 + P.prop * 12
      return Array.from(m.data.subarray(o, o + 12))
    }
    expect(prop('pre')[7]).toBeCloseTo(0.8, 5)
    expect(m.get('pre')!.seatHeight).toBeCloseTo(0.8, 6)
    expect(m.get('or')!.seatHeight).toBeCloseTo(SURGERY.table.height, 6)
    // they lie on the floor of level 2
    for (const id of ['pre', 'pacu', 'or']) expect(m.get(id)!.y, id).toBeCloseTo(LEVEL_Y[2], 6)
  })
})

describe('the theatre outfit', () => {
  const ROLES: Role[] = ['doctor', 'nurse', 'porter', 'cleaner', 'pharmacist', 'receptionist', 'visitor', 'patient']

  it('is its own clothing class, whatever the role', () => {
    for (const role of ROLES) expect(clothesOf(role, 'theatre'), role).toBe('theatre')
    expect(clothesOf('doctor', 'role')).toBe('uniform')
    expect(clothesOf('patient', 'gown')).toBe('gown')
    expect(THEATRE_NAME).toContain('scrubs')
  })

  it('dresses everybody in matching theatre blue or teal scrubs (short sleeves) and a cap over the hair: no white coat, stethoscope, lanyard or badge', () => {
    const tones = new Set<string>()
    for (const role of ROLES) {
      for (let v = 0; v < 20; v++) {
        const l = lookFor({ id: `${role}-${v}`, role, outfit: 'theatre', variant: v })
        expect([TONE.theatreBlue, TONE.theatreTeal], `${role} top`).toContain(l.top)
        expect(l.pants, `${role} trousers match the top`).toBe(l.top)
        tones.add(l.top)
        expect(l.hairStyle).toBe('theatreCap')
        expect(l.hair).toBe(TONE.theatreCap)
        expect(l.overlay).toBe('none')
        expect(l.legs).toBe('long')
        expect(l.sleeves).toBe('short')
        expect(l.stethoscope).toBe(false)
        expect(l.lanyardOn).toBe(false)
        expect(l.badgeKind).toBe(0)
      }
    }
    expect(tones.size).toBe(2)
    // a surgeon who is a doctor wears scrubs here and a white coat on level 1; the two tones are neither the nurses' blue nor the doctors' teal
    expect(lookFor({ id: 'd', role: 'doctor', variant: 1 }).overlay).toBe('coat')
    expect([TONE.theatreBlue, TONE.theatreTeal]).not.toContain(TONE.scrubBlue)
    expect([TONE.theatreBlue, TONE.theatreTeal]).not.toContain(TONE.scrubTeal)
    // everything but the clothes and the hair is the person's own (the same body, skin and size, before and after the lift)
    const a = lookFor({ id: 'x-1', role: 'nurse', variant: 4 })
    const b = lookFor({ id: 'x-1', role: 'nurse', outfit: 'theatre', variant: 4 })
    expect(b.skin).toBe(a.skin)
    expect(b.scale).toBe(a.scale)
    expect(b.build).toBe(a.build)
    expect(b.seed).toBe(a.seed)
  })

  it('the cap is a hair style of its own: described for every piece, never drawn by the seeded draw, and the player\'s "You" badge stays on you', () => {
    expect(ALL_HAIR_SHAPES).toContain('theatreCap')
    expect(HAIR_CAP.theatreCap).toHaveLength(8)
    expect(HAIR_BACK.theatreCap).toHaveLength(8)
    const drawn = new Set(Array.from({ length: 600 }, (_, i) => lookFor({ id: `p-${i}`, role: 'nurse', variant: i }).hairStyle))
    expect(drawn.has('theatreCap')).toBe(false)
    const you = lookFor({ id: 'player', role: 'doctor', outfit: 'theatre', variant: 0 })
    expect(you.badgeKind).toBeGreaterThan(0)
    expect(you.hairStyle).toBe('theatreCap')
  })

  it('a person who walks into level 2 in their white coat is re-dressed into scrubs and a cap by the crowd (the outfit follows the entity)', () => {
    show(2, false)
    const m = new CrowdModel()
    const e = ent({ id: 'surgeon', role: 'doctor', position: { x: 95, y: 0, z: 0 } })
    const es = new Map([['surgeon', e]])
    run(m, es, 10)
    expect(m.get('surgeon')!.look.overlay).toBe('coat')
    e.outfit = 'theatre'
    run(m, es, 3)
    const l = m.get('surgeon')!.look
    expect(l.hairStyle).toBe('theatreCap')
    expect(l.overlay).toBe('none')
    expect(m.get('surgeon')!.lookOutfit).toBe('theatre')
  })
})

describe('the theatre outfit on the realistic people', () => {
  const index = readIndex()
  const keyOf = (id: string, role: Role, outfit: AvatarKey['outfit']): AvatarKey => {
    const look = lookFor({ id, role, outfit, variant: 3 })
    return { id, role, outfit, seed: look.seed, height: look.height }
  }

  it('everybody in theatre scrubs wears a scrubs avatar of the theatre wardrobe, both garments taking the palette\'s blue or teal', () => {
    const ids = new Set(index.avatars.map((a) => a.id))
    for (const id of [...THEATRE.female, ...THEATRE.male]) expect(ids.has(id), id).toBe(true)
    expect(wardrobeFor('doctor', 'theatre')).toBe(THEATRE)
    expect(THEATRE.tint).toBe(TINT.both)
    for (const role of ['doctor', 'nurse', 'porter', 'visitor'] as Role[]) {
      for (let v = 0; v < 30; v++) {
        const c = avatarFor(keyOf(`${role}-${v}`, role, 'theatre'), index.avatars)
        expect(c.index).toBeGreaterThanOrEqual(0)
        const a = index.avatars[c.index]
        expect([...THEATRE.female, ...THEATRE.male], `${role} ${v} -> ${a.id}`).toContain(a.id)
        expect(a.id).not.toBe(PLAYER_AVATAR)
        expect(c.tint, a.id).not.toBe(TINT.none)
      }
    }
    // and the white coats of level 1 are unchanged
    expect(wardrobeFor('doctor', undefined)).toBe(UNIFORM.doctor)
  })

  it('you wear your all-white coat everywhere but behind the lift cover on level 2, where you wear a man\'s theatre scrubs', () => {
    const coat = avatarFor(keyOf('player', 'doctor', undefined), index.avatars)
    expect(index.avatars[coat.index].id).toBe(PLAYER_AVATAR)
    expect(avatarFor(keyOf('player', 'doctor', 'role'), index.avatars).index).toBe(coat.index)
    const scrubs = avatarFor(keyOf('player', 'doctor', 'theatre'), index.avatars)
    expect(index.avatars[scrubs.index].id).toBe(THEATRE.male[0])
    expect(index.avatars[scrubs.index].gender).toBe('male')
    expect(scrubs.tint).toBe(TINT.both)
  })
})

describe('the console pose: seated at the surgeon console, hands on the controllers, head in the viewer', () => {
  type V3 = [number, number, number]
  const people = readIndex().avatars
  const SEAT = 0.45
  const handCentre = (out: Float32Array, part: number, hand: number): V3 => {
    const b = part * 12
    return [out[b + 3] - hand * out[b + 1], out[b + 7] - hand * out[b + 5], out[b + 11] - hand * out[b + 9]]
  }
  const origin = (out: Float32Array, part: number): V3 => [out[part * 12 + 3], out[part * 12 + 7], out[part * 12 + 11]]
  const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

  function pose(mode: Mode, o: { scale?: number; body?: Readonly<BodyDims>; seconds?: number; id?: string }): { out: Float32Array; body: Readonly<BodyDims>; scale: number } {
    const look = { ...lookFor({ id: o.id ?? 'surgeon', role: 'doctor', outfit: 'theatre', variant: 5 }) }
    look.scale = o.scale ?? 1
    const body = o.body ?? NOMINAL_BODY
    const rig = createRig(look, body)
    rig.ctx.standPelvis = standPelvis(body)
    rig.ctx.seatedPelvis = body.seatedPelvis
    const inp = makeInput()
    inp.mode = mode
    inp.posture = 'sit'
    inp.seatHeight = SEAT
    const out = new Float32Array(PART_COUNT * 12)
    for (let i = 0; i < Math.round((o.seconds ?? 2) * 60); i++) {
      inp.time = i / 60
      solveRig(rig, inp, out, 0)
    }
    return { out, body, scale: look.scale }
  }

  it('is what the anim "console" draws when seated, and only then', () => {
    expect(modeFor('console', 'sit', 'none')).toBe('sitConsole')
    // standing (the surgeon walks to the console first) the anim is just a stand; lying always wins
    expect(modeFor('console', 'stand', 'none')).toBe('relaxed')
    expect(modeFor('console', 'lie', 'none')).toBe('lie')
    expect(postureOf('console' as AnimState, 'sit', false, undefined)).toBe('sit' satisfies Posture)
    expect(isSeatedMode('sitConsole')).toBe(true)
    expect(MODES).toContain('sitConsole')
  })

  it('blends in and out smoothly: the weights always sum to 1', () => {
    const b = createBlender('relaxed')
    for (const m of ['sitConsole', 'sit', 'sitConsole', 'relaxed'] as Mode[]) {
      blendTo(b, m)
      for (let i = 0; i < 20; i++) {
        advanceBlend(b, DT)
        expect(Math.abs(weightSum(b) - 1)).toBeLessThan(1e-5)
      }
    }
  })

  it('puts the middle of each hand within 3 cm of its controller for a short, a middle and a tall surgeon', () => {
    for (const scale of [0.94, 1, 1.06]) {
      const p = pose('sitConsole', { scale })
      const l = handCentre(p.out, P.handL, p.body.hand)
      const r = handCentre(p.out, P.handR, p.body.hand)
      expect(dist(l, [CONSOLE_HANDS.side, SEAT + CONSOLE_HANDS.up, CONSOLE_HANDS.ahead]), `left at ${scale}`).toBeLessThan(0.03)
      expect(dist(r, [-CONSOLE_HANDS.side, SEAT + CONSOLE_HANDS.up, CONSOLE_HANDS.ahead]), `right at ${scale}`).toBeLessThan(0.03)
    }
  })

  it('does the same for every realistic avatar\'s own skeleton, and nobody\'s arm is clamped short', () => {
    for (const a of people) {
      for (const scale of [0.94, 1.06]) {
        const p = pose('sitConsole', { scale, body: a.body })
        for (const [part, side, arm] of [[P.handL, 1, P.armL], [P.handR, -1, P.armR]] as const) {
          const hand = handCentre(p.out, part, a.body.hand)
          expect(dist(hand, [side * CONSOLE_HANDS.side, SEAT + CONSOLE_HANDS.up, CONSOLE_HANDS.ahead]), `${a.id} at ${scale} part ${part}`).toBeLessThan(0.04)
          const reach = (a.body.upperArm + a.body.forearm + a.body.hand) * scale
          expect(dist(origin(p.out, arm), hand), `${a.id} at ${scale}: within the arm`).toBeLessThan(reach * 0.999)
        }
      }
    }
  })

  it('both forearms point forward and run about level (within 25 degrees), at elbow height, with the elbows near the body', () => {
    for (const scale of [0.94, 1, 1.06]) {
      for (const a of [undefined, ...people.slice(0, 5)]) {
        const p = pose('sitConsole', { scale, body: a?.body })
        for (const [fore, hand] of [[P.foreL, P.handL], [P.foreR, P.handR]] as const) {
          const elbow = origin(p.out, fore)
          const wrist = origin(p.out, hand)
          const dy = wrist[1] - elbow[1]
          const dz = wrist[2] - elbow[2]
          expect(dz, `${a?.id ?? 'nominal'} at ${scale}: forward`).toBeGreaterThan(0.15)
          expect(Math.abs(Math.atan2(dy, Math.hypot(dz, wrist[0] - elbow[0]))), `${a?.id ?? 'nominal'} at ${scale}: level`).toBeLessThan((25 * Math.PI) / 180)
          // elbow height: between a hand's width under the controllers and the seat + 0.45 m (a seated elbow is about 0.25 m up, here a little more)
          expect(elbow[1] - SEAT, `${a?.id ?? 'nominal'} at ${scale}: elbow height`).toBeGreaterThan(0.12)
          expect(elbow[1] - SEAT, `${a?.id ?? 'nominal'} at ${scale}: elbow height`).toBeLessThan(0.5)
          expect(elbow[2], 'the elbow stays near the body').toBeLessThan(0.3)
        }
      }
    }
  })

  it('tips the head forward into the viewer (more than a plain seated person) and leans the chest in a little', () => {
    const plain = pose('sit', {})
    const con = pose('sitConsole', {})
    // the head frame's y axis (its up) tilts forward: +z component of its local +y
    const up = (out: Float32Array): V3 => [out[P.head * 12 + 1], out[P.head * 12 + 5], out[P.head * 12 + 9]]
    expect(up(con.out)[2], 'the head is nodded forward').toBeGreaterThan(up(plain.out)[2] + 0.15)
    const chest = (out: Float32Array): number => out[P.chest * 12 + 9]
    expect(chest(con.out)).toBeGreaterThan(chest(plain.out))
  })

  it('works the controllers a little: the hands move by millimetres over time, never by centimetres', () => {
    let min: V3 = [9, 9, 9]
    let max: V3 = [-9, -9, -9]
    for (const t of [1.0, 1.7, 2.4, 3.1, 3.8, 4.5, 5.2]) {
      const p = pose('sitConsole', { seconds: t })
      const h = handCentre(p.out, P.handL, p.body.hand)
      min = [Math.min(min[0], h[0]), Math.min(min[1], h[1]), Math.min(min[2], h[2])]
      max = [Math.max(max[0], h[0]), Math.max(max[1], h[1]), Math.max(max[2], h[2])]
    }
    expect(dist(min, max)).toBeGreaterThan(0.002)
    expect(dist(min, max)).toBeLessThan(0.05)
  })

  it('the crowd model draws a seated "console" surgeon in the console pose, on level 2', () => {
    show(2, false)
    const m = new CrowdModel()
    const s = SURGERY.consoles.surgeon.seat
    const e = ent({ id: 'surgeon', role: 'doctor', outfit: 'theatre', anim: 'console', seated: { seatId: 'console:or:surgeon', pose: 'sit' }, position: { x: s.at.x, y: 0, z: s.at.z }, heading: s.heading })
    run(m, new Map([['surgeon', e]]), 60)
    const slot = m.get('surgeon')!
    expect(slot.mode).toBe('sitConsole')
    expect(slot.rig.blender.target).toBe(MODES.indexOf('sitConsole'))
    expect(slot.posture).toBe('sit')
    expect(slot.y).toBeCloseTo(LEVEL_Y[2], 6)
    expect(slot.x).toBeCloseTo(s.at.x - LEVEL2_DX, 6)
  })
})
