// L1 additions to the crowd: the ward host's outfit, and the recline pose (a patient in a ward bed with the head raised).
import { beforeEach, describe, expect, it } from 'vitest'
import type { Entity } from '@/sim/types'
import { clearReclineShown, roomIndex, setReclineShown } from '@/scene/rooms/bedPose'
import { modeFor, postureOf } from './blend'
import { BODY, P, PART_COUNT } from './constants'
import { headPosition } from './head'
import { CrowdModel, type FrameInput } from './model'
import { OUTFIT_NAMES, TONE, clothesOf, lookFor } from './outfit'
import { createRig, makeInput, solveRig } from './rig'

describe('ward host outfit', () => {
  const hosts = Array.from({ length: 24 }, (_, i) => lookFor({ id: `host-${i}`, role: 'host', variant: i % 8 }))

  it('is a soft green polo with a cream apron over dark trousers and a peach lanyard', () => {
    expect(OUTFIT_NAMES.host).toContain('polo')
    expect(OUTFIT_NAMES.host).toContain('apron')
    expect(clothesOf('host', undefined)).toBe('uniform')
    for (const l of hosts) {
      expect(l.top).toBe(TONE.hostPolo)
      expect(l.sleeves).toBe('short')
      expect(l.sleeve).toBe(l.skin) // short sleeves are bare arms
      expect(l.overlay).toBe('skirt') // the apron hangs from the pelvis
      expect(l.coat).toBe(TONE.hostApron)
      expect(l.pants).toBe(TONE.hostPants)
      expect(l.legs).toBe('long')
      expect(l.lowerLeg).toBe(l.pants)
      expect(l.lanyard).toBe(TONE.peach)
      expect(l.accent).toBe(l.top) // no hi-vis or scarf bands
    }
  })

  it('is green, and apart from every other uniform at a glance', () => {
    const n = parseInt(TONE.hostPolo.slice(1), 16)
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    expect(g).toBeGreaterThan(r + 30)
    expect(g).toBeGreaterThan(b + 30)
    const others = new Set<string>()
    for (const role of ['nurse', 'pharmacist', 'doctor', 'porter', 'cleaner', 'paramedic', 'coordinator', 'radiographer', 'sonographer', 'receptionist'] as const) {
      for (let i = 0; i < 10; i++) {
        const l = lookFor({ id: `${role}-${i}`, role, variant: i })
        others.add(l.top)
        others.add(l.front)
      }
    }
    expect(others.has(TONE.hostPolo)).toBe(false)
    expect(others.has(TONE.hostApron)).toBe(false)
  })

  it('people still vary: skin, hair and size come from the id, not the role', () => {
    expect(new Set(hosts.map((l) => l.skin)).size).toBeGreaterThan(3)
    expect(new Set(hosts.map((l) => l.hairStyle)).size).toBeGreaterThan(2)
    expect(new Set(hosts.map((l) => Math.round(l.scale * 100))).size).toBeGreaterThan(3)
  })

  it('is deterministic', () => {
    expect(lookFor({ id: 'host-1', role: 'host', variant: 2 })).toEqual(lookFor({ id: 'host-1', role: 'host', variant: 2 }))
  })
})

// ---------------------------------------------------------------------------------------------
// The recline pose
// ---------------------------------------------------------------------------------------------

/** The mattress top of a ward bed (the seat height the layout gives). */
const MATTRESS = 0.49

/** Solve a patient lying in a ward bed with the head raised by `recline` (0..1), heading 0, and return the part origins. */
function lying(recline: number, id = 'recliner') {
  const look = { ...lookFor({ id, role: 'patient', variant: 1 }) }
  look.scale = 1
  const rig = createRig(look)
  rig.ctx.recline = recline
  const inp = makeInput()
  inp.mode = 'lie'
  inp.posture = 'lie'
  inp.seatHeight = 0.49
  const out = new Float32Array(PART_COUNT * 12)
  for (let i = 0; i < 240; i++) {
    inp.time = i / 60
    solveRig(rig, inp, out, 0)
  }
  const at = (part: number): [number, number, number] => [out[part * 12 + 3], out[part * 12 + 7], out[part * 12 + 11]]
  const axisY = (part: number): [number, number, number] => [out[part * 12 + 1], out[part * 12 + 5], out[part * 12 + 9]]
  return { rig, out, at, axisY, k: look.scale }
}

describe('recline pose', () => {
  beforeEach(() => clearReclineShown())

  it("a seat pose of 'recline' is a lying body (never a seated one), and the mode is the lie mode", () => {
    expect(postureOf('lie', 'recline', false, undefined)).toBe('lie')
    expect(postureOf('idle', 'recline', false, undefined)).toBe('lie')
    expect(postureOf('sit', 'recline', false, undefined)).toBe('lie') // an ER seat on a bed says 'sit' when it does not know the pose
    expect(postureOf('lie', 'lie', false, undefined)).toBe('lie')
    expect(postureOf('idle', 'sit', false, undefined)).toBe('sit')
    expect(modeFor('lie', 'lie', 'none')).toBe('lie')
  })

  it('flat (recline 0) is exactly the old lying pose: head level with the hips', () => {
    const r = lying(0)
    expect(Math.abs(r.at(P.head)[1] - r.at(P.pelvis)[1])).toBeLessThan(0.1)
    expect(r.at(P.head)[2]).toBeLessThan(-0.4)
  })

  it('raises the torso about the waist by 45 degrees at full recline, and keeps the legs flat', () => {
    const flat = lying(0)
    const up = lying(1)
    // the chest rises and the head rises well above the flat lying head
    expect(up.at(P.head)[1] - flat.at(P.head)[1]).toBeGreaterThan(0.25)
    // the line from the waist (chest origin) to the neck base (head origin) is at about 45 degrees above horizontal
    const chest = up.at(P.chest)
    const head = up.at(P.head)
    const rise = head[1] - chest[1]
    const run = Math.hypot(head[2] - chest[2], head[0] - chest[0])
    expect((Math.atan2(rise, run) * 180) / Math.PI).toBeGreaterThan(40)
    expect((Math.atan2(rise, run) * 180) / Math.PI).toBeLessThan(50)
    // the head moved toward the feet (the torso folds up over the hips) and stays on the bed's centre line
    expect(up.at(P.head)[2]).toBeGreaterThan(flat.at(P.head)[2] + 0.1)
    expect(Math.abs(up.at(P.head)[0])).toBeLessThan(0.1)
    // pelvis and feet are where they were: only the body above the waist moved
    for (const part of [P.pelvis, P.footL, P.footR, P.shinL, P.thighR]) {
      const a = flat.at(part)
      const b = up.at(part)
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), `part ${part}`).toBeLessThan(0.03)
    }
  })

  it('the hands rest on the blanket, not in the air and not in the mattress', () => {
    const up = lying(1)
    for (const hand of [P.handL, P.handR]) {
      const y = up.at(hand)[1]
      expect(y).toBeGreaterThan(MATTRESS + 0.02)
      expect(y).toBeLessThan(MATTRESS + 0.16)
      expect(Math.abs(up.at(hand)[0])).toBeLessThan(0.45) // within the bed's width
      expect(up.at(hand)[2]).toBeGreaterThan(-0.2) // at the waist or the lap, not up by the head
    }
  })

  it('stays a smooth, finite body at every recline, and the head follows the angle without a jump', () => {
    let prev = lying(0).at(P.head)
    for (let r = 0.05; r <= 1.0001; r += 0.05) {
      const s = lying(r)
      for (const f of s.out) expect(Number.isFinite(f)).toBe(true)
      const h = s.at(P.head)
      expect(Math.hypot(h[0] - prev[0], h[1] - prev[1], h[2] - prev[2])).toBeLessThan(0.1)
      expect(h[1]).toBeGreaterThanOrEqual(prev[1] - 1e-3) // rising monotonically
      prev = h
    }
  })

  it('the head helper agrees with the rig to a few centimetres, for any recline', () => {
    const idx = roomIndex('A1')
    const e = (): Entity => ({
      id: 'recliner',
      role: 'patient',
      name: 'Test',
      position: { x: 0, y: 0.49, z: 0 },
      heading: 0,
      speed: 0,
      anim: 'lie',
      mood: 'neutral',
      emote: 'none',
      tier: 'near',
      variant: 1,
      seated: { seatId: 'bed:A1', pose: 'recline' },
    })
    const out = { x: 0, y: 0, z: 0 }
    setReclineShown(idx, 0)
    headPosition(e(), out)
    const flatHelper = { ...out }
    const flatRig = lying(0)
    const centre = (s: ReturnType<typeof lying>): [number, number, number] => {
      const h = s.at(P.head)
      const a = s.axisY(P.head)
      return [h[0] + a[0] * BODY.headCentre, h[1] + a[1] * BODY.headCentre, h[2] + a[2] * BODY.headCentre]
    }
    for (const r of [0.25, 0.5, 1]) {
      setReclineShown(idx, r)
      headPosition(e(), out)
      const s = lying(r)
      const dRig = [centre(s)[1] - centre(flatRig)[1], centre(s)[2] - centre(flatRig)[2]]
      const dHelper = [out.y - flatHelper.y, out.z - flatHelper.z]
      expect(Math.abs(dRig[0] - dHelper[0]), `rise at ${r}`).toBeLessThan(0.04)
      expect(Math.abs(dRig[1] - dHelper[1]), `shift at ${r}`).toBeLessThan(0.04)
    }
  })
})

describe('crowd model: a patient in a ward bed', () => {
  beforeEach(() => clearReclineShown())

  function patient(over: Partial<Entity> = {}): Entity {
    return {
      id: 'pt-A1',
      role: 'patient',
      name: 'Grace',
      position: { x: -21.8, y: 0.49, z: -17.35 },
      heading: Math.PI,
      speed: 0,
      anim: 'lie',
      mood: 'neutral',
      emote: 'none',
      tier: 'near',
      variant: 2,
      outfit: 'gown',
      seated: { seatId: 'bed:A1', pose: 'lie' },
      ...over,
    }
  }
  const frame = (es: Map<string, Entity>): FrameInput => ({ dt: 1 / 60, time: 0, camX: -20, camY: 6, camZ: -10, entities: es, followId: null, selectedId: null, hoverId: null })

  it("raises the torso when the sim poses 'recline' (no bed layer needed), lowers it again with 'lie'", () => {
    const m = new CrowdModel()
    const e = patient({ seated: { seatId: 'bed:A1', pose: 'recline' } })
    const es = new Map([[e.id, e]])
    for (let i = 0; i < 120; i++) m.update(frame(es))
    const slot = m.get(e.id)!
    expect(slot.posture).toBe('lie')
    expect(slot.recline).toBeCloseTo(1, 2)
    expect(slot.rig.ctx.recline).toBeCloseTo(1, 2)
    e.seated = { seatId: 'bed:A1', pose: 'lie' }
    for (let i = 0; i < 120; i++) m.update(frame(es))
    expect(slot.recline).toBe(0)
  })

  it('follows the backrest that is drawn, and a step in the pose cannot snap the torso', () => {
    const m = new CrowdModel()
    const e = patient()
    const es = new Map([[e.id, e]])
    const idx = roomIndex('A1')
    setReclineShown(idx, 0)
    for (let i = 0; i < 30; i++) m.update(frame(es))
    const slot = m.get(e.id)!
    // the bed layer is raising the bed head: the torso goes with it, even though the pose still says 'lie'
    setReclineShown(idx, 0.5)
    for (let i = 0; i < 120; i++) m.update(frame(es))
    expect(slot.recline).toBeCloseTo(0.5, 2)
    // and a jump in the drawn value is caught up smoothly, not in one frame
    setReclineShown(idx, 1)
    m.update(frame(es))
    expect(slot.recline).toBeLessThan(0.6)
    expect(slot.recline).toBeGreaterThan(0.5)
  })

  it('a person who is not in a bed is never reclined', () => {
    const m = new CrowdModel()
    const e = patient({ id: 'er-1', seated: { seatId: 'bay:er-1', pose: 'lie' }, position: { x: -50, y: 0.62, z: 10 } })
    const es = new Map([[e.id, e]])
    setReclineShown(roomIndex('A1'), 1)
    for (let i = 0; i < 60; i++) m.update(frame(es))
    expect(m.get(e.id)!.recline).toBe(0)
    const s = patient({ id: 'sitter', anim: 'sit', seated: { seatId: 'waiting:lobby:1', pose: 'sit' }, position: { x: -50, y: 0.45, z: 0 } })
    es.set(s.id, s)
    for (let i = 0; i < 60; i++) m.update(frame(es))
    expect(m.get(s.id)!.recline).toBe(0)
    expect(m.get(s.id)!.posture).toBe('sit')
  })
})
