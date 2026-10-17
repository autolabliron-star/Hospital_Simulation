// W1 "Close-up people": the head, hair, hands and staff details of the high body, and the data that moves them. All in node: no GL.
import { describe, expect, it } from 'vitest'
import type { Entity, Role } from '@/sim/types'
import { FIXED_COLORS, FX, FEATURE_FIRST, P, PALETTE_SLOTS, PART_COUNT, ROW_FLOATS, SLOT, TEX, fixedSlot } from './constants'
import { FACE, blinkAt, expressionOf, faceZ, mouthOpenAt } from './face'
import { buildBodyGeometries } from './geometry'
import { HAIR_BACK, HAIR_CAP, HAIR_FRONT, HAIR_SHAPES } from './hair'
import { EYE, LOOK, createHeadLook, updateHeadLook } from './look'
import { setRotYXZ, transformPoint } from './math'
import { CrowdModel, hexToLinear, type FrameInput } from './model'
import { TONE, lookFor } from './outfit'
import { createRig, makeInput, solveRig } from './rig'
import { BADGE, BADGE_TOP, GEAR_BIT } from './staff'

const ALL_ROLES: Role[] = ['doctor', 'nurse', 'pharmacist', 'porter', 'cleaner', 'receptionist', 'coordinator', 'paramedic', 'radiographer', 'sonographer', 'host', 'patient', 'visitor']
const STAFF_WITH_BADGE: Role[] = ['doctor', 'nurse', 'pharmacist', 'porter', 'receptionist', 'coordinator', 'radiographer', 'sonographer', 'host']

const F = (i: number): number => fixedSlot(i)

/** The high body's vertices of one part, optionally of one colour slot: [x, y, z]. */
function vertices(part: number, slot?: number): number[][] {
  const g = buildBodyGeometries().high
  const pos = g.getAttribute('position')
  const aPart = g.getAttribute('aPart')
  const out: number[][] = []
  for (let i = 0; i < pos.count; i++) {
    if (Math.round(aPart.getX(i)) !== part) continue
    if (slot !== undefined && Math.round(aPart.getY(i)) !== slot) continue
    out.push([pos.getX(i), pos.getY(i), pos.getZ(i)])
  }
  return out
}

function slotCount(geo: ReturnType<typeof buildBodyGeometries>['high'], slot: number): number {
  const a = geo.getAttribute('aPart')
  let n = 0
  for (let i = 0; i < a.count; i++) if (Math.round(a.getY(i)) === slot) n++
  return n
}

describe('hair', () => {
  const looks = Array.from({ length: 600 }, (_, i) => lookFor({ id: `p-${i}`, role: 'visitor', variant: i }))

  it('has six shapes and a handful of natural colours, and every shape is described for every piece', () => {
    expect(HAIR_SHAPES.length).toBe(6)
    expect(new Set(looks.map((l) => l.hairStyle))).toEqual(new Set(HAIR_SHAPES))
    expect(new Set(looks.map((l) => l.hair)).size).toBeGreaterThanOrEqual(8)
    for (const s of HAIR_SHAPES) {
      expect(HAIR_CAP[s]).toHaveLength(8)
      for (const piece of [HAIR_BACK[s], HAIR_FRONT[s]]) if (piece) expect(piece).toHaveLength(8)
      for (const v of HAIR_CAP[s]) expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('is chosen from the id and the variant: the same person always has the same hair, a different variant can have different hair', () => {
    for (let i = 0; i < 40; i++) {
      const a = lookFor({ id: `x-${i}`, role: 'nurse', variant: i * 7 })
      const b = lookFor({ id: `x-${i}`, role: 'nurse', variant: i * 7 })
      expect(b.hairStyle).toBe(a.hairStyle)
      expect(b.hair).toBe(a.hair)
    }
    const byVariant = Array.from({ length: 60 }, (_, v) => lookFor({ id: 'same-person', role: 'doctor', variant: v }))
    expect(new Set(byVariant.map((l) => l.hairStyle)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(byVariant.map((l) => l.hair)).size).toBeGreaterThanOrEqual(3)
  })

  it('does not change when a patient is admitted and changes clothes (hair is the person, not the outfit)', () => {
    for (let i = 0; i < 30; i++) {
      const a = lookFor({ id: `er-${i}`, role: 'patient', outfit: 'everyday', variant: i })
      const b = lookFor({ id: `er-${i}`, role: 'patient', outfit: 'gown', variant: i })
      expect(b.hairStyle).toBe(a.hairStyle)
      expect(b.hair).toBe(a.hair)
    }
  })

  /** Smallest distance along a ray from `o` through `p` at which a triangle of `tris` is hit, in units of |p - o| (Moller-Trumbore); Infinity if none. */
  function hitAlong(o: number[], p: number[], tris: number[][][]): number {
    const d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]]
    let best = Infinity
    for (const [a, b, c] of tris) {
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]]
      const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2]
      if (Math.abs(det) < 1e-12) continue
      const t = [o[0] - a[0], o[1] - a[1], o[2] - a[2]]
      const u = (t[0] * pv[0] + t[1] * pv[1] + t[2] * pv[2]) / det
      if (u < 0 || u > 1) continue
      const q = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]]
      const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det
      if (v < 0 || u + v > 1) continue
      const s = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det
      if (s > 0 && s < best) best = s
    }
    return best
  }

  it('covers the crown of the skull in every shape: no bald patch shows through the cap', () => {
    const g = buildBodyGeometries().high
    const pos = g.getAttribute('position')
    const part = g.getAttribute('aPart')
    const index = g.index!
    const skull: number[][] = []
    const cap: number[][][] = []
    const m = new Float64Array(12)
    const tmp = new Float64Array(12)
    for (let t = 0; t < index.count; t += 3) {
      const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
      const pt = Math.round(part.getX(ids[0]))
      const pts = ids.map((i) => [pos.getX(i), pos.getY(i), pos.getZ(i)])
      if (pt === P.head && Math.round(part.getY(ids[0])) === SLOT.skin) {
        const c = [0, 1, 2].map((k) => (pts[0][k] + pts[1][k] + pts[2][k]) / 3)
        // the crown: well above the brows and the hairline, away from the ears and the nose
        if (c[1] > 0.275) skull.push(c)
      } else if (pt === P.hairCap) cap.push(pts)
    }
    expect(skull.length).toBeGreaterThan(8)
    for (const style of HAIR_SHAPES) {
      const h = HAIR_CAP[style]
      // the rig's matrix of the piece: scale first, then roll and pitch, then move (rig.ts hairPiece)
      setRotYXZ(m, 0, 0, h[6], h[7])
      const placed = cap.map((tri) =>
        tri.map((p) => {
          transformPoint(m, 0, p[0] * h[0], p[1] * h[1], p[2] * h[2], tmp)
          return [tmp[0] + h[3], tmp[1] + h[4], tmp[2] + h[5]]
        }),
      )
      const centre = [0, 0.19, 0.0]
      for (const c of skull) {
        const t = hitAlong(centre, c, placed)
        const len = Math.hypot(c[0] - centre[0], c[1] - centre[1], c[2] - centre[2])
        // the cap is there (the ray from the middle of the head hits it) and it is outside the skin by at least 2 mm
        expect(Number.isFinite(t), `${style} covers ${c.map((x) => x.toFixed(3))}`).toBe(true)
        expect(t * len, `${style} at ${c.map((x) => x.toFixed(3))}`).toBeGreaterThan(len + 0.002)
      }
    }
  })
})

describe('staff details', () => {
  it('every staff role with a lanyard wears a badge in its own colour; the others wear none', () => {
    const bands = new Map<string, string>()
    for (const role of ALL_ROLES) {
      const l = lookFor({ id: `${role}-a`, role, variant: 5 })
      if (STAFF_WITH_BADGE.includes(role)) {
        expect(l.badgeKind, role).toBe(BADGE.staff)
        expect(l.lanyardOn, role).toBe(true)
        bands.set(role, l.badge)
      } else expect(l.badgeKind, role).toBe(BADGE.none)
    }
    // the colour of the band says who it is on: no two staff roles share one, and none is the player's gold
    expect(new Set(bands.values()).size).toBe(STAFF_WITH_BADGE.length)
    for (const c of bands.values()) expect(c.toLowerCase()).not.toBe(TONE.youGold)
  })

  it('badge, stethoscope, dosimeter and apron follow the role, not the variant', () => {
    for (let v = 0; v < 25; v++) {
      const doc = lookFor({ id: `d-${v}`, role: 'doctor', variant: v })
      expect(doc.stethoscope).toBe(true)
      expect(doc.dosimeter).toBe(false)
      expect(doc.apron).toBe(false)
      expect(doc.badge).toBe(TONE.badgeDoctor)
      const rad = lookFor({ id: `r-${v}`, role: 'radiographer', variant: v })
      expect(rad.dosimeter).toBe(true)
      expect(rad.stethoscope).toBe(false)
      expect(rad.badge).toBe(TONE.badgeRadiographer)
      const host = lookFor({ id: `h-${v}`, role: 'host', variant: v })
      expect(host.apron).toBe(true)
      expect(host.stethoscope || host.dosimeter).toBe(false)
      for (const role of ['nurse', 'porter', 'cleaner', 'patient', 'visitor', 'paramedic'] as Role[]) {
        const l = lookFor({ id: `${role}-${v}`, role, variant: v })
        expect(l.stethoscope || l.dosimeter || l.apron, role).toBe(false)
      }
    }
  })

  it('the player (id "player", a doctor) wears the gold "You" badge on top of the doctor kit', () => {
    for (let v = 0; v < 10; v++) {
      const you = lookFor({ id: 'player', role: 'doctor', variant: v })
      expect(you.badgeKind).toBe(BADGE.you)
      expect(you.badge).toBe(TONE.youGold)
      expect(you.stethoscope).toBe(true)
      expect(you.top.toLowerCase()).toBe(TONE.white) // the white coat
    }
    // and nobody else does
    for (let v = 0; v < 40; v++) expect(lookFor({ id: `doc-${v}`, role: 'doctor', variant: v }).badgeKind).toBe(BADGE.staff)
  })

  it('glasses are a flag and a frame colour; everybody without them has the skin colour in that slot', () => {
    let some = 0
    for (let i = 0; i < 300; i++) {
      const l = lookFor({ id: `g-${i}`, role: i % 2 ? 'visitor' : 'coordinator', variant: i })
      expect(l.glassesOn).toBe(l.glasses !== l.skin)
      if (l.glassesOn) some++
    }
    expect(some).toBeGreaterThan(20)
    expect(some).toBeLessThan(150)
    expect(new Set(Array.from({ length: 300 }, (_, i) => lookFor({ id: `g-${i}`, role: 'visitor', variant: i })).filter((l) => l.glassesOn).map((l) => l.glasses)).size).toBeGreaterThan(2)
  })
})

describe('the close-up geometry', () => {
  const g = buildBodyGeometries()

  it('the high body carries every feature; the mid and far bodies carry none and keep their size', () => {
    for (const fx of [FX.eye, FX.sclera, FX.brow, FX.mouth, FX.frame, FX.badgeCard, FX.badgeBand, FX.badgePhoto, FX.badgeMark, FX.stethTube, FX.stethPiece, FX.dosimeter, FX.bib]) {
      expect(slotCount(g.high, F(fx)), `fixed colour ${fx}`).toBeGreaterThan(0)
      expect(slotCount(g.mid, F(fx)), `mid ${fx}`).toBe(0)
      expect(slotCount(g.far, F(fx)), `far ${fx}`).toBe(0)
    }
    // no vertex of the mid and far bodies is a feature slot; the third hair piece exists only in the high body
    for (const geo of [g.mid, g.far]) {
      const a = geo.getAttribute('aPart')
      for (let i = 0; i < a.count; i++) {
        expect(a.getY(i) >= FEATURE_FIRST).toBe(false)
        expect(Math.round(a.getX(i))).not.toBe(P.hairFront)
      }
    }
    expect(vertices(P.hairFront).length).toBeGreaterThan(0)
    expect(g.triangles.mid).toBe(487)
    expect(g.triangles.far).toBe(100)
  })

  it('every feature slot is a fixed colour of the table, and the table has no unused hole before the features', () => {
    expect(FIXED_COLORS.length).toBe(FX.youInk + 1)
    expect(FEATURE_FIRST).toBe(PALETTE_SLOTS + FX.sclera)
    for (let i = 0; i < g.high.getAttribute('aPart').count; i++) expect(g.high.getAttribute('aPart').getY(i)).toBeLessThan(PALETTE_SLOTS + FIXED_COLORS.length)
  })

  it('puts the features of the face where a face has them: brows over eyes over nose over mouth, on the skin, symmetric about the middle', () => {
    const mean = (vs: number[][], k: number) => vs.reduce((s, v) => s + v[k], 0) / vs.length
    const brow = vertices(P.head, F(FX.brow))
    const sclera = vertices(P.head, F(FX.sclera))
    const iris = vertices(P.head, F(FX.eye))
    const mouth = vertices(P.head, F(FX.mouth))
    expect(brow.length).toBeGreaterThanOrEqual(20)
    expect(mean(brow, 1)).toBeGreaterThan(mean(sclera, 1) + 0.015)
    expect(mean(sclera, 1)).toBeGreaterThan(mean(mouth, 1) + 0.05)
    expect(mean(iris, 1)).toBeCloseTo(FACE.eyeY, 3)
    // the brows run from browIn to browOut on each side; the mouth is centred and FACE.mouthHalf wide
    expect(Math.min(...brow.map((v) => Math.abs(v[0])))).toBeCloseTo(FACE.browIn, 3)
    expect(Math.max(...brow.map((v) => Math.abs(v[0])))).toBeCloseTo(FACE.browOut, 3)
    expect(Math.min(...mouth.map((v) => v[0]))).toBeCloseTo(-FACE.mouthHalf, 4)
    expect(Math.max(...mouth.map((v) => v[0]))).toBeCloseTo(FACE.mouthHalf, 4)
    expect(mean(mouth, 1)).toBeCloseTo(FACE.mouthY, 2)
    expect(mean(brow, 0)).toBeCloseTo(0, 6)
    // everything sits on the skin, a little proud of it
    for (const v of [...brow, ...mouth, ...sclera]) expect(v[2]).toBeGreaterThan(faceZ(v[0], v[1]) - 0.002)
    // the iris is in front of the white
    for (const side of [-1, 1]) {
      const white = sclera.filter((v) => Math.sign(v[0]) === side)
      const disc = iris.filter((v) => Math.sign(v[0]) === side)
      expect(Math.max(...disc.map((v) => v[2]))).toBeGreaterThan(Math.max(...white.map((v) => v[2])) - 1e-9)
      // and the eyes are where the gaze maths assumes: the iris sits within the white at rest, with room to travel
      const wx = white.map((v) => v[0])
      const ix = disc.map((v) => v[0])
      expect(Math.min(...ix) - Math.min(...wx)).toBeGreaterThan(FACE.gazeX * 0.9)
      expect(Math.max(...wx) - Math.max(...ix)).toBeGreaterThan(FACE.gazeX * 0.9)
    }
  })

  it('the hands are mittens with a thumb on the front edge, not eggs', () => {
    for (const hand of [P.handL, P.handR]) {
      const vs = vertices(hand)
      expect(vs.length).toBeGreaterThan(40) // the old egg had 19 vertices
      // the hand is about 0.18 m from the wrist to the fingertips, wide in Z and thin in X
      expect(Math.min(...vs.map((v) => v[1]))).toBeLessThan(-0.17)
      expect(Math.max(...vs.map((v) => Math.abs(v[0])))).toBeLessThan(0.03)
      // the thumb: vertices further forward than the palm's edge, in the upper half of the hand
      const palmEdge = Math.max(...vs.filter((v) => v[1] > -0.035 && v[1] < -0.02).map((v) => v[2]))
      expect(vs.some((v) => v[2] > 0.045 && v[1] < -0.04 && v[1] > -0.11), 'a thumb').toBe(true)
      expect(palmEdge).toBeGreaterThan(0.02)
    }
  })

  it('the badge hangs on the chest where the strap ends, and the player\'s mark is on it', () => {
    for (const slot of [F(FX.badgeCard), F(FX.badgeBand), F(FX.badgePhoto), F(FX.badgeMark)]) {
      const vs = vertices(P.chest, slot)
      expect(vs.length).toBeGreaterThan(0)
      for (const v of vs) {
        expect(v[1]).toBeLessThanOrEqual(BADGE_TOP + 1e-6)
        expect(v[1]).toBeGreaterThan(BADGE_TOP - 0.09)
        expect(v[2]).toBeGreaterThan(0.08) // on the front of the chest
        expect(Math.abs(v[0])).toBeLessThan(0.04)
      }
    }
    // the strap runs from the neck down to the top of the badge
    const strap = vertices(P.chest, SLOT.lanyard)
    expect(Math.max(...strap.map((v) => v[1]))).toBeGreaterThan(0.38)
    expect(Math.min(...strap.map((v) => v[1]))).toBeLessThan(BADGE_TOP + 0.01)
  })
})

describe('the face in motion', () => {
  it('blinks every few seconds on its own clock for about a sixth of a second, deterministically', () => {
    let shut = 0
    let blinks = 0
    let was = 0
    const dt = 1 / 120
    for (let t = 0; t < 60; t += dt) {
      const b = blinkAt(t, 12345)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThanOrEqual(1)
      expect(blinkAt(t, 12345)).toBe(b)
      if (b > 0.5) shut += dt
      if (b > 0.5 && was <= 0.5) blinks++
      was = b
    }
    expect(blinks).toBeGreaterThanOrEqual(9) // every 3 to 6 s
    expect(blinks).toBeLessThanOrEqual(20)
    expect(shut / blinks).toBeGreaterThan(0.04)
    expect(shut / blinks).toBeLessThan(0.2)
    // two people do not blink together
    let together = 0
    for (let t = 0; t < 60; t += dt) if (blinkAt(t, 1) > 0.5 && blinkAt(t, 777) > 0.5) together += dt
    expect(together).toBeLessThan(shut * 0.5)
  })

  it('expression: happy smiles, neutral and waiting are neutral, unwell frowns', () => {
    expect(expressionOf(1, 0)).toBe(1)
    expect(expressionOf(0, 1)).toBe(-1)
    expect(expressionOf(0, 0)).toBe(0)
    expect(expressionOf(1, 1)).toBe(0)
    expect(expressionOf(0.5, 0)).toBeCloseTo(0.5, 9)
    const settle = (mood: 'neutral' | 'happy' | 'waiting' | 'unwell'): number => {
      const rig = createRig(lookFor({ id: 'mood', role: 'visitor', variant: 2 }))
      const inp = makeInput()
      inp.mood = mood
      const out = new Float32Array(PART_COUNT * 12)
      for (let i = 0; i < 180; i++) {
        inp.time = i / 60
        solveRig(rig, inp, out, 0)
      }
      return rig.face.expression
    }
    expect(settle('happy')).toBeGreaterThan(0.95)
    expect(settle('unwell')).toBeLessThan(-0.95)
    expect(settle('neutral')).toBe(0)
    expect(settle('waiting')).toBe(0)
  })

  it('the mouth opens only while the person talks', () => {
    const run = (mode: 'talk' | 'relaxed') => {
      const rig = createRig(lookFor({ id: 'chat', role: 'nurse', variant: 6 }))
      const inp = makeInput()
      inp.mode = mode
      const out = new Float32Array(PART_COUNT * 12)
      let max = 0
      for (let i = 0; i < 240; i++) {
        inp.time = i / 60
        solveRig(rig, inp, out, 0)
        max = Math.max(max, rig.face.mouthOpen)
        expect(rig.face.mouthOpen).toBeGreaterThanOrEqual(0)
        expect(rig.face.mouthOpen).toBeLessThanOrEqual(1)
      }
      return max
    }
    expect(run('talk')).toBeGreaterThan(0.2)
    expect(run('relaxed')).toBe(0)
    expect(mouthOpenAt(3, 9, 0, 1)).toBe(0)
  })

  it('the eyes lead the head, settle in it, cover what a neck cannot turn to, and relax when nobody is looked at', () => {
    const s = createHeadLook()
    // a target 30 degrees to the left appears: the eyes get there first (the head has only just started to turn)
    const yaw30 = (30 * Math.PI) / 180
    updateHeadLook(s, 1 / 60, yaw30, 0, true)
    updateHeadLook(s, 1 / 60, yaw30, 0, true)
    expect(s.eyeYaw).toBeGreaterThan(0.1)
    for (let i = 0; i < 180; i++) updateHeadLook(s, 1 / 60, yaw30, 0, true)
    // the head is on target and the eyes sit in it
    expect(s.yaw * s.weight).toBeCloseTo(yaw30, 2)
    expect(Math.abs(s.eyeYaw)).toBeLessThan(0.02)
    // a target 100 degrees round: the head stops at its limit and the eyes take the rest, within their own limit
    const yaw100 = (100 * Math.PI) / 180
    for (let i = 0; i < 240; i++) updateHeadLook(s, 1 / 60, yaw100, 0, true)
    expect(s.yaw).toBeCloseTo(LOOK.maxYaw, 3)
    expect(s.eyeYaw).toBeCloseTo(yaw100 - LOOK.maxYaw, 2)
    expect(s.eyeYaw).toBeLessThanOrEqual(EYE.maxYaw + 1e-9)
    // to the right the same, mirrored; up and down are limited too
    const t = createHeadLook()
    for (let i = 0; i < 240; i++) updateHeadLook(t, 1 / 60, -yaw100, 1.0, true)
    expect(t.eyeYaw).toBeLessThan(-0.3)
    expect(t.eyePitch).toBeLessThanOrEqual(EYE.maxPitch + 1e-9)
    expect(t.eyePitch).toBeGreaterThan(0)
    // the target vanishes: eyes return to the middle of the head and stay there
    for (let i = 0; i < 120; i++) updateHeadLook(s, 1 / 60, 0, 0, false)
    expect(s.eyeYaw).toBe(0)
    expect(s.eyePitch).toBe(0)
    // a target behind the person is not followed
    const u = createHeadLook()
    for (let i = 0; i < 60; i++) updateHeadLook(u, 1 / 60, Math.PI, 0, true)
    expect(u.eyeYaw).toBe(0)
  })

  it('writes the face and the staff details of every person into their row of the pose texture', () => {
    const m = new CrowdModel()
    const es = new Map<string, Entity>()
    const ent = (id: string, role: Role, over: Partial<Entity> = {}): Entity => ({
      id,
      role,
      name: id,
      position: { x: 0, y: 0, z: 0 },
      heading: 0,
      speed: 0,
      anim: 'idle',
      mood: 'neutral',
      emote: 'none',
      tier: 'near',
      variant: 3,
      ...over,
    })
    for (const e of [ent('player', 'doctor'), ent('doc', 'doctor'), ent('rad', 'radiographer'), ent('host', 'host'), ent('vis', 'visitor'), ent('happy', 'visitor', { mood: 'happy' }), ent('sick', 'patient', { mood: 'unwell' })]) es.set(e.id, e)
    // a person looking 40 degrees to their left (a sim look-at), and one looking 100 degrees round, which the neck cannot reach
    es.set('looker', ent('looker', 'nurse', { lookAt: { x: 1, y: 1.6, z: 1.2 } }))
    es.set('turned', ent('turned', 'nurse', { lookAt: { x: 2, y: 1.6, z: -0.35 } }))
    const world: FrameInput = { dt: 1 / 60, time: 0, camX: 0, camY: 1.7, camZ: 6, entities: es, followId: null, selectedId: null, hoverId: null }
    for (let i = 0; i < 180; i++) {
      world.time = i / 60
      m.update(world)
    }
    const at = (id: string, texel: number, c: number): number => m.data[m.get(id)!.row * ROW_FLOATS + texel * 4 + c]
    // the gear texel: badge kind and flag bits
    expect(at('player', TEX.gear, 0)).toBe(BADGE.you)
    expect(at('player', TEX.gear, 1) & GEAR_BIT.stethoscope).toBe(GEAR_BIT.stethoscope)
    expect(at('doc', TEX.gear, 0)).toBe(BADGE.staff)
    expect(at('doc', TEX.gear, 1) & GEAR_BIT.stethoscope).toBe(GEAR_BIT.stethoscope)
    expect(at('rad', TEX.gear, 1) & GEAR_BIT.dosimeter).toBe(GEAR_BIT.dosimeter)
    expect(at('rad', TEX.gear, 1) & GEAR_BIT.stethoscope).toBe(0)
    expect(at('host', TEX.gear, 1) & GEAR_BIT.bib).toBe(GEAR_BIT.bib)
    expect(at('vis', TEX.gear, 0)).toBe(BADGE.none)
    for (const id of ['vis', 'happy', 'sick']) expect(at(id, TEX.gear, 1) & (GEAR_BIT.stethoscope | GEAR_BIT.dosimeter | GEAR_BIT.bib)).toBe(0)
    // the badge colour is in the palette (the player's is gold)
    const gold = hexToLinear(TONE.youGold)
    for (let c = 0; c < 3; c++) expect(at('player', TEX.palette + SLOT.badge, c)).toBeCloseTo(gold[c], 6)
    const teal = hexToLinear(TONE.badgeDoctor)
    for (let c = 0; c < 3; c++) expect(at('doc', TEX.palette + SLOT.badge, c)).toBeCloseTo(teal[c], 6)
    // the face texel: expression from the mood, nothing to look at means eyes about straight ahead
    expect(at('happy', TEX.face, 2)).toBeGreaterThan(0.95)
    expect(at('sick', TEX.face, 2)).toBeLessThan(-0.95)
    expect(at('vis', TEX.face, 2)).toBe(0)
    for (const id of ['vis', 'happy', 'sick', 'host']) {
      expect(Math.abs(at(id, TEX.face, 0))).toBeLessThan(0.23) // they wander a little (up to 0.22 rad) when nobody is looked at
      expect(at(id, TEX.face, 3)).toBeGreaterThanOrEqual(0)
      expect(at(id, TEX.face, 3)).toBeLessThanOrEqual(1)
    }
    // the looker turned the head towards the point: the eyes are centred in it, the head carries the aim
    expect(Math.abs(at('looker', TEX.face, 0))).toBeLessThan(0.05)
    expect(m.get('looker')!.rig.headLook.weight).toBeGreaterThan(0.99)
    expect(m.get('looker')!.rig.headLook.yaw).toBeGreaterThan(0.6)
    // the one who looks past what the neck can turn to has the eyes turned the rest of the way
    expect(at('turned', TEX.face, 0)).toBeGreaterThan(0.3)
    expect(at('turned', TEX.face, 0)).toBeLessThanOrEqual(EYE.maxYaw + 1e-6)
  })

  it('writes the texel layout without overlap: parts, palette, face, gear, and a texture exactly that wide', () => {
    expect(TEX.parts + PART_COUNT * 3).toBe(TEX.palette)
    expect(TEX.palette + PALETTE_SLOTS).toBe(TEX.face)
    expect(TEX.face + 1).toBe(TEX.gear)
    expect(TEX.gear + 1).toBe(TEX.width)
    expect(SLOT.badge + 1).toBe(PALETTE_SLOTS)
    expect(ROW_FLOATS).toBe(TEX.width * 4)
  })
})
