/**
 * W3 wave B, the realistic people at run time: who wears which avatar, the tint rules, the bind maths, the crowd model's per-avatar lists and the
 * glbs as the game loads them. Node only: the converted index and glbs are read from public/assets/people.
 */
import { describe, expect, it } from 'vitest'
import type { Entity, Outfit, Role } from '@/sim/types'
import { BADGE_FRAME, P, PART_COUNT, ROW_FLOATS, SLOT, TEX } from './constants'
import {
  EVERYDAY,
  GOWN,
  GOWN_BARE_PARTS,
  GOWN_KEEP_PARTS,
  GOWN_SOCK_PARTS,
  PLAYER_AVATAR,
  TINT,
  TINT_MIN_REF,
  UNIFORM,
  applyBinds,
  avatarFor,
  femaleShare,
  gownZone,
  invertRigid,
  perceptual,
  skinLike,
  tintFor,
  wardrobeFor,
  type AvatarKey,
} from './avatars'
import { bindsMatch, avatarGltfLoader } from './avatarLoader'
import { cpuMesh, loadBody, readIndex, rowParts, skinAll } from './avatars.testkit'
import { CrowdModel, hexToLinear, type FrameInput } from './model'
import { OUTFIT_NAMES, clothesOf, heightFor, lookFor } from './outfit'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PEOPLE_PATH } from './avatars.testkit'
import type { SkinnedMesh } from 'three'
import { PATIENTS } from '@/content/catalogue'
import { OUTPATIENTS } from '@/content/imaging'
import { givenNameOf, presentationOf } from '@/content/roster'
import { HOSTS, NIGHT_STAFF, STAFF } from '@/content/staff'

const INDEX = readIndex()
const ROLES = Object.keys(OUTFIT_NAMES) as Role[]
const CLASSES: (Outfit | undefined)[] = [undefined, 'role', 'gown', 'everyday']

const keyOf = (id: string, role: Role, outfit: Outfit | undefined, variant: number): AvatarKey => {
  const look = lookFor({ id, role, outfit, variant })
  return { id, role, outfit, seed: look.seed, height: look.height }
}

describe('who wears what', () => {
  it('every role in every clothing class maps to an avatar of the index from its wardrobe; the player always wears medical_male_01', () => {
    const ids = new Set(INDEX.avatars.map((a) => a.id))
    for (const w of [...Object.values(UNIFORM), GOWN, EVERYDAY]) for (const id of [...w.female, ...w.male]) expect(ids.has(id), id).toBe(true)
    for (const role of ROLES) {
      for (const outfit of CLASSES) {
        const w = wardrobeFor(role, outfit)
        for (let v = 0; v < 40; v++) {
          const c = avatarFor(keyOf(`${role}-${v}`, role, outfit, v), INDEX.avatars)
          expect(c.index, `${role} ${outfit}`).toBeGreaterThanOrEqual(0)
          const id = INDEX.avatars[c.index].id
          expect([...w.female, ...w.male], `${role} ${outfit} -> ${id}`).toContain(id)
          expect(id).not.toBe(PLAYER_AVATAR)
        }
      }
      const player = avatarFor(keyOf('player', role, undefined, 0), INDEX.avatars)
      expect(INDEX.avatars[player.index].id).toBe(PLAYER_AVATAR)
      expect(player.tint).toBe(TINT.none)
    }
    expect(avatarFor(keyOf('x', 'nurse', undefined, 0), []).index).toBe(-1)
  })

  it('dresses by clothing class: patients in gowns, visitors and everyday patients in their own clothes, staff in uniform', () => {
    expect(wardrobeFor('patient', undefined)).toBe(GOWN)
    expect(wardrobeFor('patient', 'everyday')).toBe(EVERYDAY)
    expect(wardrobeFor('visitor', undefined)).toBe(EVERYDAY)
    expect(wardrobeFor('nurse', 'gown')).toBe(GOWN)
    expect(wardrobeFor('doctor', 'role')).toBe(UNIFORM.doctor)
    for (const role of ROLES) if (clothesOf(role, undefined) === 'uniform') expect(wardrobeFor(role, undefined)).toBe(UNIFORM[role])
    expect(UNIFORM.doctor.female).toEqual(['medical_female_02'])
    expect(UNIFORM.doctor.male).toEqual(['medical_male_03'])
    expect(UNIFORM.paramedic.female).toEqual(['medical_female_03'])
    expect(UNIFORM.radiographer.male).toEqual(['medical_male_05'])
  })

  it('is deterministic, uses every avatar of the cast, and draws women more often among shorter people', () => {
    const used = new Set<string>()
    let shortF = 0
    let tallF = 0
    for (let i = 0; i < 600; i++) {
      const role = ROLES[i % ROLES.length]
      const k = keyOf(`p-${i}`, role, undefined, i % 9)
      const a = avatarFor(k, INDEX.avatars)
      expect(avatarFor({ ...k }, INDEX.avatars)).toEqual(a)
      used.add(INDEX.avatars[a.index].id)
      const female = INDEX.avatars[a.index].gender === 'female'
      if (k.height < 1.72 && female) shortF++
      if (k.height > 1.78 && female) tallF++
    }
    used.add(INDEX.avatars[avatarFor(keyOf('player', 'doctor', undefined, 0), INDEX.avatars).index].id)
    expect(used.size).toBe(INDEX.avatars.length)
    expect(shortF).toBeGreaterThan(tallF)
    expect(femaleShare(1.62)).toBeGreaterThan(femaleShare(1.88))
    expect(heightFor('p-1', 1)).toBeGreaterThan(1.6)
  })

  it('tints only what the wardrobe asks for, and only garments whose reference is not near black', () => {
    const by = (id: string) => INDEX.avatars.find((a) => a.id === id)!
    for (const a of INDEX.avatars) {
      for (const want of [TINT.top, TINT.bottom, TINT.both]) {
        const t = tintFor(want, a)
        expect(t & ~want).toBe(0)
        if (t & TINT.top) expect(perceptual(a.tintRef.top)).toBeGreaterThanOrEqual(TINT_MIN_REF)
        if (t & TINT.bottom) expect(perceptual(a.tintRef.bottom)).toBeGreaterThanOrEqual(TINT_MIN_REF)
      }
    }
    // the roles that read by colour from the overview get it
    expect(tintFor(UNIFORM.nurse.tint, by('medical_female_01'))).toBe(TINT.both)
    expect(tintFor(UNIFORM.nurse.tint, by('medical_male_04'))).toBe(TINT.both)
    expect(tintFor(UNIFORM.paramedic.tint, by('medical_male_02'))).toBe(TINT.both)
    expect(tintFor(UNIFORM.radiographer.tint, by('medical_male_05'))).toBe(TINT.both)
    expect(tintFor(UNIFORM.pharmacist.tint, by('medical_female_01'))).toBe(TINT.bottom)
    // a black skirt stays black
    expect(tintFor(TINT.both, by('business_female_02')) & TINT.bottom).toBe(0)
    // every choice's bits follow the same rules
    for (let i = 0; i < 300; i++) {
      const role = ROLES[i % ROLES.length]
      const c = avatarFor(keyOf(`t-${i}`, role, undefined, i), INDEX.avatars)
      expect(c.tint).toBe(tintFor(wardrobeFor(role, undefined).tint, INDEX.avatars[c.index]))
    }
  })
})

describe('the hospital gown', () => {
  const by = (id: string) => INDEX.avatars.find((a) => a.id === id)!
  const gownIds = [...GOWN.female, ...GOWN.male]

  it('repaints every gowned person by body part (TINT.gown), whatever their garments; nobody else ever gets the gown bit', () => {
    expect(GOWN.tint).toBe(TINT.gown)
    for (const id of gownIds) expect(tintFor(GOWN.tint, by(id)), id).toBe(TINT.gown)
    for (let i = 0; i < 400; i++) {
      const role = ROLES[i % ROLES.length]
      const outfit = CLASSES[i % CLASSES.length]
      const c = avatarFor(keyOf(`g-${i}`, role, outfit, i), INDEX.avatars)
      const gowned = clothesOf(role, outfit) === 'gown'
      expect(c.tint === TINT.gown, `${role} ${outfit}`).toBe(gowned)
      if (!gowned) expect(c.tint & TINT.gown).toBe(0)
    }
  })

  it('on every gown avatar: socks on the feet, bare shins up to the knee, the gown from the knee up, bare forearms, the head and hands kept', async () => {
    for (const id of gownIds) {
      const a = by(id)
      const m = cpuMesh(await loadBody(a, 0))
      const knee = a.body.ankle + a.body.shin
      let socksTop = -Infinity
      let gownLow = Infinity
      let bareLegLow = Infinity
      let bareLegTop = -Infinity
      let bareArms = 0
      for (let v = 0; v < m.count; v++) {
        const j = m.joints.subarray(v * 4, v * 4 + 4)
        const w = m.weights.subarray(v * 4, v * 4 + 4)
        const y = m.pos[v * 3 + 1]
        const z = gownZone(j, w)
        const main = Math.round(j[w.indexOf(Math.max(...w))])
        if (z === 'socks') socksTop = Math.max(socksTop, y)
        else if (z === 'gown') gownLow = Math.min(gownLow, y)
        else if (z === 'bare' && (main === P.shinL || main === P.shinR)) {
          bareLegLow = Math.min(bareLegLow, y)
          bareLegTop = Math.max(bareLegTop, y)
        } else if (z === 'bare') bareArms++
        if (main === P.head || main === P.handL || main === P.handR) expect(z).toBe('keep')
      }
      // the socks stop a little above the ankle; the bare shin runs from there to the knee; nothing below the knee is gown
      expect(socksTop, id).toBeLessThan(a.body.ankle + 0.4 * a.body.shin)
      expect(bareLegLow, id).toBeLessThan(a.body.ankle + 0.25 * a.body.shin)
      expect(bareLegTop, id).toBeGreaterThan(knee - 0.1)
      expect(bareLegTop, id).toBeLessThan(knee + 0.12)
      expect(gownLow, id).toBeGreaterThan(knee - 0.1)
      expect(bareArms, id).toBeGreaterThan(20)
    }
    expect(GOWN_BARE_PARTS).toEqual([P.foreL, P.foreR, P.shinL, P.shinR])
    expect(GOWN_SOCK_PARTS).toEqual([P.footL, P.footR])
    expect(GOWN_KEEP_PARTS).toEqual([P.head, P.handL, P.handR])
  })

  it('only flat-footed bodies wear the gown: their socks would show a heel as a white high-heeled shoe', async () => {
    /** Tenths of the left foot's length (heel to toe) whose lowest point stands over 2.5 cm off the floor: a sneaker's arch is one, a heel two or more. */
    const raised = async (id: string): Promise<number> => {
      const m = cpuMesh(await loadBody(by(id), 0))
      const feet: number[] = []
      let z0 = Infinity
      let z1 = -Infinity
      for (let v = 0; v < m.count; v++) {
        let w = 0
        for (let k = 0; k < 4; k++) if (Math.round(m.joints[v * 4 + k]) === P.footL) w += m.weights[v * 4 + k]
        if (w < 0.45) continue
        feet.push(v)
        z0 = Math.min(z0, m.pos[v * 3 + 2])
        z1 = Math.max(z1, m.pos[v * 3 + 2])
      }
      const low = new Array<number>(10).fill(Infinity)
      for (const v of feet) {
        const b = Math.min(9, Math.floor(((m.pos[v * 3 + 2] - z0) / (z1 - z0)) * 10))
        low[b] = Math.min(low[b], m.pos[v * 3 + 1])
      }
      return low.filter((y) => y > 0.025).length
    }
    for (const id of gownIds) expect(await raised(id), id).toBeLessThanOrEqual(1)
    // the heeled boots this rule keeps out
    expect(await raised('business_female_02')).toBeGreaterThanOrEqual(2)
    expect(await raised('female_adult_15')).toBeGreaterThanOrEqual(2)
  })

  it("keeps real skin and paints the clothes: each avatar's skin is skin-like, the gown avatars' garments are not", () => {
    for (const a of INDEX.avatars) expect(skinLike(hexToLinear(a.palette.skin), hexToLinear(a.palette.skin)), a.id).toBeCloseTo(1, 6)
    for (const id of gownIds) {
      const a = by(id)
      const skin = hexToLinear(a.palette.skin)
      for (const k of ['top', 'sleeve', 'pants', 'upperLeg', 'lowerLeg'] as const) expect(skinLike(hexToLinear(a.palette[k]), skin), `${id} ${k} ${a.palette[k]}`).toBeLessThan(0.5)
    }
  })
})

describe('bind maths at run time', () => {
  it('inverts rigid frames and applies M * B^-1 to the skinned parts only (the badge frame and the prop frame keep theirs)', () => {
    const B = new Float64Array(12)
    const c = Math.cos(0.7)
    const s = Math.sin(0.7)
    B.set([c, 0, s, 0.1, 0, 1, 0, 1.2, -s, 0, c, -0.05])
    const inv = new Float64Array(12)
    invertRigid(B, 0, inv, 0)
    const binds = new Float64Array(PART_COUNT * 12)
    for (let p = 0; p < PART_COUNT; p++) binds.set(p === P.chest ? inv : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], p * 12)
    const rows = new Float32Array(PART_COUNT * 12)
    rows.set(B, P.chest * 12)
    rows.set([1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7], P.prop * 12)
    rows.set([1, 0, 0, 2, 0, 1, 0, 3, 0, 0, 1, 4], BADGE_FRAME * 12)
    applyBinds(rows, 0, binds)
    expect(Array.from(rows.subarray(P.chest * 12, P.chest * 12 + 12)).map((x) => Math.round(x * 1e5) / 1e5 + 0)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0])
    expect(Array.from(rows.subarray(P.prop * 12, P.prop * 12 + 12))).toEqual([1, 0, 0, 5, 0, 1, 0, 6, 0, 0, 1, 7])
    expect(Array.from(rows.subarray(BADGE_FRAME * 12, BADGE_FRAME * 12 + 12))).toEqual([1, 0, 0, 2, 0, 1, 0, 3, 0, 0, 1, 4])
  })
})

// ---------------------------------------------------------------------------------------------
// The crowd model with avatars
// ---------------------------------------------------------------------------------------------

function ent(o: Partial<Entity> & { id: string }): Entity {
  return { role: 'nurse', name: o.id, position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'idle', emote: 'none', mood: 'neutral', tier: 'near', variant: 1, ...o } as Entity
}

function frame(entities: Map<string, Entity>, cam: [number, number, number], t: number): FrameInput {
  return { dt: 1 / 60, time: t, camX: cam[0], camY: cam[1], camZ: cam[2], entities, followId: null, selectedId: null, hoverId: null, driven: null }
}

describe('crowd model with avatars', () => {
  const es = new Map<string, Entity>()
  // a line of people from 2 m to 150 m from the camera, the player near, a gown patient in bed, a nurse with a tablet, a doctor walking
  for (let i = 0; i < 40; i++) es.set(`p-${i}`, ent({ id: `p-${i}`, role: ROLES[i % ROLES.length], position: { x: 0, y: 0, z: 2 + i * 3.8 }, variant: i }))
  es.set('player', ent({ id: 'player', role: 'doctor', position: { x: 1, y: 0, z: 3 } }))
  es.set('nurse-tab', ent({ id: 'nurse-tab', role: 'nurse', anim: 'tablet', prop: 'tablet', position: { x: -1, y: 0, z: 4 } }))
  es.set('bed-1', ent({ id: 'bed-1', role: 'patient', outfit: 'gown', anim: 'lie', position: { x: 2, y: 0, z: 6 } }))
  const cam: [number, number, number] = [0, 1.7, 0]

  it('lists everyone per avatar and LOD, leaves the procedural lists empty, keeps the props, writes the tint and the gown colour', () => {
    const m = new CrowdModel()
    for (let f = 0; f < 3; f++) m.update(frame(es, cam, f / 60)) // procedural first (the assets still loading)
    expect(m.stats.high + m.stats.mid + m.stats.far).toBeGreaterThan(0)
    m.setAvatars(INDEX.avatars)
    for (let f = 0; f < 3; f++) m.update(frame(es, cam, (3 + f) / 60))
    const st = m.stats
    expect(st.avatars).toBe(es.size)
    expect(st.high + st.mid + st.far).toBe(0) // no procedural body left
    expect(st.solved).toBe(es.size) // the far body of an avatar is skinned: everyone is solved
    const L = m.avatarLists
    const sum = (lod: number) => Array.from(L.counts[lod]).reduce((s, n) => s + n, 0)
    expect(sum(0)).toBe(st.avatarHigh)
    expect(sum(1)).toBe(st.avatarMid)
    expect(sum(2)).toBe(st.avatarFar)
    expect(st.avatarHigh).toBeGreaterThan(0)
    expect(st.avatarFar).toBeGreaterThan(0) // beyond 68 m: the 350 triangle body
    expect(sum(0) + sum(1) + sum(2)).toBeGreaterThanOrEqual(es.size)
    // every listed row belongs to a person wearing that avatar
    for (let lod = 0; lod < 3; lod++) {
      for (let a = 0; a < INDEX.avatars.length; a++) {
        for (let i = 0; i < L.counts[lod][a]; i++) {
          const row = L.rows[lod][a][i]
          const p = [...m.people.values()].find((x) => x.row === row)!
          expect(p.avatar).toBe(a)
        }
      }
    }
    // the tablet is still drawn by the props mesh; the player's badge by the badge mesh
    expect(st.props).toBeGreaterThanOrEqual(1)
    expect(Array.from(m.propKinds.subarray(0, st.props))).toContain(1)
    const player = m.get('player')!
    expect(INDEX.avatars[player.avatar].id).toBe(PLAYER_AVATAR)
    expect(st.badges).toBe(1)
    expect(m.badgeRows[0]).toBe(player.row)
    // the tint bits and colours
    const nurse = m.get('nurse-tab')!
    expect(m.data[nurse.row * ROW_FLOATS + TEX.size * 4 + 2]).toBe(nurse.tint)
    expect(nurse.tint).toBe(tintFor(TINT.both, INDEX.avatars[nurse.avatar]))
    const bed = m.get('bed-1')!
    expect(GOWN.female.concat(GOWN.male)).toContain(INDEX.avatars[bed.avatar].id)
    expect(bed.tint).toBe(TINT.gown)
    expect(m.data[bed.row * ROW_FLOATS + TEX.size * 4 + 2]).toBe(TINT.gown)
    const gown = hexToLinear(bed.look.coat)
    expect(m.data[bed.row * ROW_FLOATS + (TEX.palette + SLOT.pants) * 4]).toBeCloseTo(gown[0], 6)
    expect(m.data[bed.row * ROW_FLOATS + (TEX.palette + SLOT.top) * 4]).toBeCloseTo(hexToLinear(bed.look.top)[0], 6)
    for (let i = 0; i < m.people.size * ROW_FLOATS; i++) expect(Number.isFinite(m.data[i])).toBe(true)
    // and back to the procedural bodies
    m.setAvatars([])
    m.update(frame(es, cam, 1))
    expect(m.stats.avatars).toBe(0)
    expect(m.stats.badges).toBe(0)
    expect(m.stats.high + m.stats.mid + m.stats.far).toBeGreaterThan(0)
    expect(m.get('nurse-tab')!.rig.dims.b.thigh).toBe(0.42)
  })

  it('pins the badge frame on the coat: it moves with the chest and sits on the avatar anchor', () => {
    const m = new CrowdModel()
    m.setAvatars(INDEX.avatars)
    for (let f = 0; f < 30; f++) m.update(frame(es, cam, f / 60))
    const p = m.get('player')!
    const parts = rowParts(m.data, p.row)
    const anchor = INDEX.avatars[p.avatar].badge
    const c = P.chest * 12
    const b = BADGE_FRAME * 12
    for (let r = 0; r < 3; r++) {
      const want = parts[c + r * 4] * anchor[0] + parts[c + r * 4 + 1] * anchor[1] + parts[c + r * 4 + 2] * anchor[2] + parts[c + r * 4 + 3]
      expect(parts[b + r * 4 + 3]).toBeCloseTo(want, 5)
    }
    // about 1.3 m up, in front of the chest
    expect(parts[b + 7]).toBeGreaterThan(1.1)
    expect(parts[b + 7]).toBeLessThan(1.5)
    expect(parts[b + 11]).toBeGreaterThan(0.05)
  })
})

describe('the avatar glbs, as the game loads them', () => {
  it('give an instanced body with joints and weights, and bind matrices equal to the index', async () => {
    const loader = avatarGltfLoader()
    for (const a of INDEX.avatars) {
      for (const lod of a.lods) {
        const buf = readFileSync(path.join(PEOPLE_PATH, lod.file))
        const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '')
        let mesh: SkinnedMesh | null = null
        gltf.scene.traverse((o) => {
          if ((o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh
        })
        expect(mesh, lod.file).not.toBeNull()
        expect(bindsMatch(mesh!, a), lod.file).toBe(true)
        expect(bindsMatch(mesh!, { ...a, bindInverse: a.bindInverse.map((x, i) => (i === 3 ? x + 0.01 : x)) }), lod.file).toBe(false)
        const g = await loadBody(a, a.lods.indexOf(lod))
        expect(g.index!.count / 3).toBe(lod.triangles)
        expect(g.getAttribute('aJoints').itemSize).toBe(4)
        expect(g.getAttribute('aWeights').itemSize).toBe(4)
        expect(g.getAttribute('position').count).toBe(lod.vertices)
      }
    }
  }, 60_000)

  it("skinned with the model's pose rows (the vertex shader on the CPU), a person stands where and as tall as the crowd says", async () => {
    const m = new CrowdModel()
    m.setAvatars(INDEX.avatars)
    const e = ent({ id: 'walker', role: 'porter', position: { x: 10, y: 0, z: 5 }, heading: 0.8, variant: 2 })
    const one = new Map([[e.id, e]])
    for (let f = 0; f < 180; f++) {
      if (f < 90) {
        e.position.x += (Math.sin(0.8) * 1.3) / 60
        e.position.z += (Math.cos(0.8) * 1.3) / 60
      }
      m.update(frame(one, [10, 2, 12], f / 60))
    }
    const p = m.get('walker')!
    const mesh = cpuMesh(await loadBody(INDEX.avatars[p.avatar], 0))
    const pos = skinAll(mesh, rowParts(m.data, p.row))
    let minY = Infinity
    let maxY = -Infinity
    let sx = 0
    let sz = 0
    for (let v = 0; v < mesh.count; v++) {
      minY = Math.min(minY, pos[v * 3 + 1])
      maxY = Math.max(maxY, pos[v * 3 + 1])
      sx += pos[v * 3]
      sz += pos[v * 3 + 2]
    }
    expect(minY).toBeGreaterThan(-0.03) // nothing under the floor
    expect(minY).toBeLessThan(0.03) // and the soles on it
    expect(Math.abs(maxY - p.look.height)).toBeLessThan(0.04) // as tall as heightFor says
    expect(Math.hypot(sx / mesh.count, sz / mesh.count)).toBeLessThan(0.25) // centred on the person's root
  }, 60_000)
})

// ---------------------------------------------------------------------------------------------
// The name decides the body (people.json `presentation`)
// ---------------------------------------------------------------------------------------------

describe('the given name decides whether a person is drawn as a woman or a man', () => {
  const byId = (id: string) => INDEX.avatars.find((a) => a.id === id)!

  /** The avatar a person with this id, role, outfit and name ends up wearing in the crowd model, as the game dresses them. */
  function wearer(entityId: string, name: string, role: Role, outfit: Outfit | undefined, variant: number, m = new CrowdModel()) {
    m.setAvatars(INDEX.avatars)
    const e = ent({ id: entityId, name, role, outfit, variant })
    m.update(frame(new Map([[e.id, e]]), [0, 1.7, 5], 0))
    return INDEX.avatars[m.get(entityId)!.avatar]
  }

  it('draws Grace Adeyemi (pt-A1) and every ward patient and outpatient in the body their name says, from their own wardrobe', () => {
    const gown = new Set([...GOWN.female, ...GOWN.male])
    for (const p of PATIENTS) {
      const want = presentationOf(p.name)
      expect(want, p.name).not.toBe('either')
      for (let v = 0; v < 6; v++) {
        const a = wearer(p.id, p.name, 'patient', 'gown', v * 137)
        expect(a.gender, `${p.name} variant ${v}`).toBe(want)
        expect(gown.has(a.id), a.id).toBe(true)
      }
    }
    expect(wearer('pt-A1', 'Grace Adeyemi', 'patient', 'gown', 4).gender).toBe('female')
    for (const o of OUTPATIENTS) {
      const want = presentationOf(o.name)
      if (want === 'either') continue
      const a = wearer(`out-${givenNameOf(o.name)}`, o.name, 'patient', 'everyday', 3)
      expect(a.gender, o.name).toBe(want)
      expect([...EVERYDAY.female, ...EVERYDAY.male]).toContain(a.id)
    }
  })

  it('draws the staff by name: Nurse Maya a woman, Porter Callum a man, Receptionist Yara a woman, from their role wardrobe; Pharmacist Noa by the seeded draw', () => {
    for (const [name, role, gender] of [
      ['Nurse Maya', 'nurse', 'female'],
      ['Porter Callum', 'porter', 'male'],
      ['Receptionist Yara', 'receptionist', 'female'],
      ['Dr. Halima', 'doctor', 'female'],
      ['Dr. Levi', 'doctor', 'male'],
      ['Nurse Tomás', 'nurse', 'male'],
      ['Radiographer Rohan', 'radiographer', 'male'],
      ['Paramedic Sana', 'paramedic', 'female'],
      ['Cleaner Rosa', 'cleaner', 'female'],
      ['Host Caspian', 'host', 'male'],
    ] as [string, Role, 'female' | 'male'][]) {
      for (let v = 0; v < 8; v++) {
        const a = wearer(`staff-${name}`, name, role, undefined, v * 71)
        expect(a.gender, `${name} variant ${v}`).toBe(gender)
        const w = wardrobeFor(role, undefined)
        expect(gender === 'female' ? w.female : w.male, name).toContain(a.id)
      }
    }
    // every member of the staff content gets the body their name reads as; an either name takes both genders over many looks
    for (const s of [...STAFF, ...NIGHT_STAFF, ...HOSTS]) {
      const want = presentationOf(s.name)
      const genders = new Set<string>()
      for (let v = 0; v < 40; v++) genders.add(wearer(s.id, s.name, s.role, undefined, v * 53).gender)
      if (want === 'either') expect(genders.size, s.name).toBe(2)
      else expect([...genders], s.name).toEqual([want])
    }
    expect(presentationOf('Pharmacist Noa')).toBe('either')
  })

  it('never changes the player: you always wear medical_male_01, whatever the name says, and nobody else does', () => {
    for (const name of ['You', 'Grace', 'Maya Adeyemi', 'Callum']) {
      const a = wearer('player', name, 'doctor', 'role', 0)
      expect(a.id).toBe(PLAYER_AVATAR)
    }
    for (const p of PATIENTS) expect(wearer(p.id, p.name, 'patient', 'gown', 9).id).not.toBe(PLAYER_AVATAR)
  })

  it('is deterministic: the same people in the same order wear the same avatars, in a second model too', () => {
    const run = (): string[] => {
      const m = new CrowdModel()
      return PATIENTS.map((p, i) => wearer(p.id, p.name, 'patient', 'gown', i * 31, m).id)
    }
    expect(run()).toEqual(run())
    // a person's other picks do not move when only the name changes: the same seed picks the same candidate slot of the wardrobe
    const key = keyOf('someone', 'nurse', undefined, 5)
    expect(avatarFor({ ...key }, INDEX.avatars)).toEqual(avatarFor({ ...key, presentation: 'either' }, INDEX.avatars))
  })

  it('an either name keeps the seeded draw exactly: no presentation and presentation either choose alike', () => {
    for (let i = 0; i < 300; i++) {
      const role = ROLES[i % ROLES.length]
      const k = keyOf(`e-${i}`, role, undefined, i)
      expect(avatarFor({ ...k, presentation: 'either' }, INDEX.avatars)).toEqual(avatarFor(k, INDEX.avatars))
    }
  })

  it('keeps the gender of a named person when the wardrobe has none loaded: any loaded avatar of that gender before the other wardrobe', () => {
    // only the males of the doctor wardrobe and one female adult are loaded
    const some = INDEX.avatars.filter((a) => a.id === 'medical_male_03' || a.id === 'female_adult_17')
    for (let i = 0; i < 30; i++) {
      const k = keyOf(`d-${i}`, 'doctor', undefined, i)
      expect(some[avatarFor({ ...k, presentation: 'female' }, some).index].id).toBe('female_adult_17')
      expect(some[avatarFor({ ...k, presentation: 'male' }, some).index].id).toBe('medical_male_03')
    }
    // and with nothing of the gender loaded, the other one is better than nothing
    const males = INDEX.avatars.filter((a) => a.gender === 'male' && a.id !== PLAYER_AVATAR)
    expect(avatarFor({ ...keyOf('x', 'nurse', undefined, 1), presentation: 'female' }, males).index).toBeGreaterThanOrEqual(0)
  })

  it('dresses the procedural people the same way (?people=0): a woman or a man by the name, hair and skirts included; an either name is unchanged', () => {
    const women = new Set<string>()
    const men = new Set<string>()
    for (let i = 0; i < 400; i++) {
      const id = `proc-${i}`
      const role: Role = i % 3 === 0 ? 'visitor' : i % 3 === 1 ? 'receptionist' : 'patient'
      const outfit: Outfit | undefined = i % 3 === 2 ? 'everyday' : undefined
      const base = lookFor({ id, role, outfit, variant: i })
      expect(lookFor({ id, role, outfit, variant: i, presentation: 'either' })).toEqual(base)
      const f = lookFor({ id, role, outfit, variant: i, presentation: 'female' })
      const m = lookFor({ id, role, outfit, variant: i, presentation: 'male' })
      expect(['bob', 'long', 'ponytail', 'curly']).toContain(f.hairStyle)
      expect(['crop', 'swept', 'curly']).toContain(m.hairStyle)
      expect(m.overlay === 'skirt', `man ${id} in a skirt`).toBe(false)
      // everything but the hair, the legs and the skirt is the same person
      expect({ ...f, hairStyle: 0, legs: 0, overlay: 0, coat: 0, pants: 0, upperLeg: 0, lowerLeg: 0 }).toEqual({ ...base, hairStyle: 0, legs: 0, overlay: 0, coat: 0, pants: 0, upperLeg: 0, lowerLeg: 0 })
      expect(lookFor({ id, role, outfit, variant: i, presentation: 'female' })).toEqual(f)
      women.add(f.hairStyle)
      men.add(m.hairStyle)
    }
    expect(women.size).toBeGreaterThanOrEqual(3)
    expect(men.size).toBe(3)
  })

  it('knows the 8 medical and 6 adult avatars by gender, so the lists above point at real bodies', () => {
    expect(byId('female_adult_15').gender).toBe('female')
    expect(byId('male_adult_13').gender).toBe('male')
    expect(INDEX.avatars.filter((a) => a.gender === 'female').length).toBeGreaterThanOrEqual(6)
  })
})
