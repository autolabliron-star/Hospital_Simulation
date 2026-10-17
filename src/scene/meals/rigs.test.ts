/**
 * The three L1 rigs (MealBots, trays, ward parts) run in node with real three.js objects (no GL): a fake living-day view goes in,
 * the instance matrices, colours and counts come out. These are the very functions the layers call once a frame.
 */
import { Euler, Matrix4, Texture, Vector3, type CanvasTexture } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BED_ANCHORS } from '@/scene/rooms/bedParts'
import { RECLINE_MAX, clearReclineShown, reclineShown } from '@/scene/rooms/bedPose'
import { CONFIG } from '@/sim/config'
import { LivingDay } from '@/sim/life'
import { MEALBOT_SIZE, ROOMS, SERVICE_LIFT } from '@/sim/places'
import type { MealBot } from '@/sim/types'
import { DOOR_OPEN_SCALE, RING_COLORS, createMealBotsRig } from './botsRig'
import { MAX_BOTS } from './life'
import { GROW_SECONDS, SHELF_CAP, TABLES, createTraysRig } from './traysRig'
import { DOOR_COLORS, DOOR_PULSE, bedStateIndex } from './ward/doorStyle'
import { SCREEN_CHECK, SCREEN_UPLOAD, createWardRig } from './ward/wardRig'
import type { BedsideAtlas } from './ward/bedsideAtlas'
import type { BedsideInfo } from '@/scene/building/render/screens'

function newLife(): LivingDay {
  return new LivingDay(7.5, ROOMS.map((r) => ({ roomId: r.id, patientId: `pt-${r.id}`, patientName: `Patient ${r.id}` })))
}

function bot(id: string, over: Partial<MealBot> = {}): MealBot {
  return {
    id,
    ward: 'A',
    position: { x: -14, y: 0, z: -14.65 },
    heading: Math.PI / 2,
    speed: 0,
    state: 'serving',
    light: 'peach',
    meal: 'lunch',
    trays: 0,
    fade: 1,
    door: 0,
    waitingFor: null,
    ...over,
  }
}

const m4 = new Matrix4()
function matrixOf(mesh: { getMatrixAt(i: number, m: Matrix4): void }, i: number): Matrix4 {
  mesh.getMatrixAt(i, m4)
  return m4.clone()
}
const pos = (m: Matrix4): Vector3 => new Vector3().setFromMatrixPosition(m)
const scaleOf = (m: Matrix4): Vector3 => new Vector3().setFromMatrixScale(m)

describe('MealBots rig', () => {
  it('draws nothing without a living-day view or without bots', () => {
    const rig = createMealBotsRig()
    rig.step(null, 1 / 60, 0)
    expect(rig.drawn()).toBe(0)
    // one zero-size keeper instance per mesh keeps the shader program warm (nothing is visible)
    for (const mesh of [rig.statics, rig.door, rig.ring, rig.shadow]) {
      expect(mesh.count).toBe(1)
      expect(scaleOf(matrixOf(mesh, 0)).length()).toBe(0)
    }
    rig.step(newLife(), 1 / 60, 0)
    expect(rig.statics.count).toBe(1)
    expect(rig.drawn()).toBe(0)
    rig.dispose()
  })

  it('draws every bot that is on the ward, not the ones downstairs, at the sim pose', () => {
    const life = newLife()
    life.mealBots.set('b1', bot('b1', { position: { x: -14, y: 0, z: -14.65 }, heading: Math.PI / 2 }))
    life.mealBots.set('b2', bot('b2', { state: 'offsite', fade: 0 }))
    life.mealBots.set('b3', bot('b3', { ward: 'B', position: { x: 12, y: 0, z: 14.65 }, heading: 0, state: 'toWard', fade: 0.4, light: 'white' }))
    const rig = createMealBotsRig()
    rig.step(life, 1 / 60, 0)
    expect(rig.drawn()).toBe(2)
    for (const mesh of [rig.statics, rig.door, rig.ring, rig.shadow]) expect(mesh.count).toBe(2)
    pos(matrixOf(rig.statics, 0)).toArray().forEach((v, k) => expect(v).toBeCloseTo([-14, 0, -14.65][k], 4))
    expect(pos(matrixOf(rig.statics, 1)).x).toBeCloseTo(12)
    // heading pi/2 turns the bot's nose (+z) to +x
    const nose = new Vector3(0, 0, 1).applyMatrix4(matrixOf(rig.statics, 0)).sub(pos(matrixOf(rig.statics, 0)))
    expect(nose.x).toBeCloseTo(1)
    expect(nose.z).toBeCloseTo(0)
    // the dither fade is the sim's fade, per instance
    const fade = rig.statics.geometry.getAttribute('aFade').array
    expect([fade[0], fade[1]].map((v) => Math.round(v * 100) / 100)).toEqual([1, 0.4])
    // the blob shadow shares the attribute (it fades with the bot)
    expect(rig.shadow.geometry.getAttribute('aFade')).toBe(rig.statics.geometry.getAttribute('aFade'))
    rig.dispose()
  })

  it('never draws more than MAX_BOTS', () => {
    const life = newLife()
    for (let i = 0; i < 9; i++) life.mealBots.set(`b${i}`, bot(`b${i}`, { position: { x: -30 + i, y: 0, z: -14.65 } }))
    const rig = createMealBotsRig()
    rig.step(life, 1 / 60, 0)
    expect(rig.drawn()).toBe(MAX_BOTS)
    expect(rig.statics.count).toBe(MAX_BOTS)
    // when they all leave, the keeper is back
    life.mealBots.clear()
    rig.step(life, 1 / 60, 0)
    expect(rig.statics.count).toBe(1)
    expect(scaleOf(matrixOf(rig.statics, 0)).length()).toBe(0)
    rig.dispose()
  })

  it('slides the shutter open and shut with MealBot.door, hinged at its top edge', () => {
    const life = newLife()
    const b = bot('b1', { door: 0 })
    life.mealBots.set('b1', b)
    const rig = createMealBotsRig()
    rig.step(life, 1 / 60, 0)
    expect(scaleOf(matrixOf(rig.door, 0)).y).toBeCloseTo(1, 6)
    const top = pos(matrixOf(rig.door, 0)).y
    b.door = 1
    let prev = 1
    for (let i = 0; i < 90; i++) {
      rig.step(life, 1 / 60, i / 60)
      const sy = scaleOf(matrixOf(rig.door, 0)).y
      expect(sy).toBeLessThanOrEqual(prev + 1e-9) // monotone: no jump back
      expect(prev - sy).toBeLessThan(0.3) // and no pop
      prev = sy
      expect(pos(matrixOf(rig.door, 0)).y).toBeCloseTo(top, 6) // the hinge (top edge) stays put
    }
    expect(prev).toBeCloseTo(DOOR_OPEN_SCALE, 3)
    b.door = 0
    for (let i = 0; i < 120; i++) rig.step(life, 1 / 60, i / 60)
    expect(scaleOf(matrixOf(rig.door, 0)).y).toBeCloseTo(1, 3)
    rig.dispose()
  })

  it('colours the ring by the light: white, peach, and amber that pulses', () => {
    const life = newLife()
    life.mealBots.set('w', bot('w', { light: 'white' }))
    life.mealBots.set('p', bot('p', { light: 'peach' }))
    life.mealBots.set('a', bot('a', { light: 'amber' }))
    const rig = createMealBotsRig()
    const colors = (): number[][] => [0, 1, 2].map((i) => [rig.ring.instanceColor!.getX(i), rig.ring.instanceColor!.getY(i), rig.ring.instanceColor!.getZ(i)])
    rig.step(life, 1 / 60, 0)
    const [white, peach, amber0] = colors()
    expect(white).toEqual([RING_COLORS.white.r, RING_COLORS.white.g, RING_COLORS.white.b].map((v) => expect.closeTo(v, 5)))
    expect(peach[0]).toBeCloseTo(RING_COLORS.peach.r, 5)
    // peach is warm: more red than blue, and nothing like the pods' teal (a teal ring has blue above red)
    expect(peach[0]).toBeGreaterThan(peach[2])
    rig.step(life, 1 / 60, 0.3)
    const [, , amber1] = colors()
    expect(amber1[0]).not.toBeCloseTo(amber0[0], 3) // pulsing
    expect(amber1[0]).toBeGreaterThan(amber1[2])
    // a bot that stops waiting goes back to a steady colour
    life.mealBots.get('a')!.light = 'white'
    rig.step(life, 1 / 60, 0.6)
    expect(colors()[2][0]).toBeCloseTo(RING_COLORS.white.r, 5)
    rig.dispose()
  })

  it('a bot is as big as the contract says, and fades in at the service lift where it deploys', () => {
    const life = newLife()
    const lift = SERVICE_LIFT.A
    life.mealBots.set('b1', bot('b1', { state: 'toWard', fade: 0.02, position: { x: lift.at.x, y: 0, z: lift.at.z }, heading: lift.heading }))
    const rig = createMealBotsRig()
    rig.step(life, 1 / 60, 0)
    expect(rig.drawn()).toBe(1)
    expect(pos(matrixOf(rig.statics, 0)).z).toBeCloseTo(lift.at.z)
    rig.statics.geometry.computeBoundingBox()
    const bb = rig.statics.geometry.boundingBox!
    expect(bb.max.y).toBeLessThanOrEqual(MEALBOT_SIZE.h + 1e-6)
    rig.dispose()
  })
})

describe('trays rig', () => {
  it('shows a tray on the table when a meal is served, with the cloche; the cloche goes when it is eaten; nothing when none', () => {
    const life = newLife()
    life.rooms.get('A1')!.meal = 'served'
    life.rooms.get('A2')!.meal = 'eaten'
    const rig = createTraysRig()
    for (let i = 0; i < 60; i++) rig.step(life, 1 / 60)
    const i1 = ROOMS.findIndex((r) => r.id === 'A1')
    const i2 = ROOMS.findIndex((r) => r.id === 'A2')
    const i3 = ROOMS.findIndex((r) => r.id === 'A3')
    expect(scaleOf(matrixOf(rig.base, i1)).x).toBeCloseTo(1, 3)
    expect(scaleOf(matrixOf(rig.cloche, i1)).x).toBeCloseTo(1, 3)
    expect(scaleOf(matrixOf(rig.base, i2)).x).toBeCloseTo(1, 3)
    expect(scaleOf(matrixOf(rig.cloche, i2)).x).toBe(0)
    expect(scaleOf(matrixOf(rig.base, i3)).x).toBe(0)
    // it stands where the over-bed table is
    const a = BED_ANCHORS[i1].tray
    expect(pos(matrixOf(rig.base, i1)).toArray().map((v) => Math.round(v * 1000) / 1000)).toEqual([a.x, a.y, a.z].map((v) => Math.round(v * 1000) / 1000))
    rig.dispose()
  })

  it('grows in over a third of a second (never a pop) and shrinks away again', () => {
    const life = newLife()
    const rig = createTraysRig()
    rig.step(life, 1 / 60)
    life.rooms.get('A1')!.meal = 'served'
    rig.step(life, 1 / 60)
    const s1 = scaleOf(matrixOf(rig.base, 0)).x
    expect(s1).toBeGreaterThan(0)
    expect(s1).toBeLessThan(0.2)
    for (let i = 0; i < Math.ceil(GROW_SECONDS * 60) + 2; i++) rig.step(life, 1 / 60)
    expect(scaleOf(matrixOf(rig.base, 0)).x).toBeCloseTo(1, 6)
    life.rooms.get('A1')!.meal = 'none'
    for (let i = 0; i < Math.ceil(GROW_SECONDS * 60) + 2; i++) rig.step(life, 1 / 60)
    expect(scaleOf(matrixOf(rig.base, 0)).x).toBe(0)
    rig.dispose()
  })

  it('puts one tray on each loaded shelf of a bot that has fully faded in, and none inside one that is still fading', () => {
    const life = newLife()
    life.mealBots.set('b1', bot('b1', { trays: 3 }))
    life.mealBots.set('b2', bot('b2', { trays: 8, position: { x: -5, y: 0, z: -14.65 } }))
    life.mealBots.set('b3', bot('b3', { trays: 8, fade: 0.5 }))
    life.mealBots.set('b4', bot('b4', { trays: 5, state: 'offsite', fade: 0 }))
    const rig = createTraysRig()
    rig.step(life, 1 / 60)
    expect(rig.shelfTrays()).toBe(11)
    expect(rig.base.count).toBe(TABLES + 11)
    expect(SHELF_CAP).toBe(MAX_BOTS * 8)
    // shelf trays are inside the bot: within its footprint and below its top
    const p = pos(matrixOf(rig.base, TABLES))
    expect(Math.abs(p.x - -14)).toBeLessThan(MEALBOT_SIZE.l / 2)
    expect(Math.abs(p.z - -14.65)).toBeLessThan(MEALBOT_SIZE.l / 2)
    expect(p.y).toBeGreaterThan(0.2)
    expect(p.y).toBeLessThan(MEALBOT_SIZE.h)
    // taking trays out empties the shelves again
    life.mealBots.get('b1')!.trays = 0
    life.mealBots.get('b2')!.trays = 0
    rig.step(life, 1 / 60)
    expect(rig.shelfTrays()).toBe(0)
    expect(rig.base.count).toBe(TABLES)
    rig.dispose()
  })
})

function fakeAtlas() {
  const draw = vi.fn<(i: number, info: BedsideInfo | null) => void>()
  const atlas: BedsideAtlas = { texture: new Texture() as unknown as CanvasTexture, draw }
  return Object.assign(atlas, { draw })
}

describe('ward rig', () => {
  beforeEach(() => clearReclineShown())

  it('shows the default look without a living-day view: flat backrests, white tiles, the static bedside tile', () => {
    const atlas = fakeAtlas()
    const rig = createWardRig(atlas)
    rig.step({ life: null, generation: 0, simDt: 1 / 60, now: 0 })
    for (let i = 0; i < ROOMS.length; i++) {
      expect(rig.shown[i]).toBe(0)
      const c = rig.tiles.instanceColor!
      expect([c.getX(i), c.getY(i), c.getZ(i)].map((v) => Math.round(v * 1e4))).toEqual([DOOR_COLORS[0].r, DOOR_COLORS[0].g, DOOR_COLORS[0].b].map((v) => Math.round(v * 1e4)))
    }
    expect(atlas.draw).toHaveBeenCalledTimes(ROOMS.length)
    for (const call of atlas.draw.mock.calls) expect(call[1]).toBeNull()
    rig.dispose()
  })

  it('tilts a backrest with RoomStatus.recline at the config speed in sim time, and freezes with the pause', () => {
    const life = newLife()
    const rig = createWardRig(fakeAtlas())
    rig.step({ life, generation: 0, simDt: 0, now: 0 })
    const i = ROOMS.findIndex((r) => r.id === 'B4')
    const angle = (): number => new Euler().setFromRotationMatrix(matrixOf(rig.backrests, i), 'YXZ').x
    expect(angle()).toBeCloseTo(0, 9)
    life.rooms.get('B4')!.recline = 1
    // paused: nothing moves
    for (let k = 0; k < 30; k++) rig.step({ life, generation: 0, simDt: 0, now: k / 60 })
    expect(rig.shown[i]).toBe(0)
    // running at 1x: a full raise takes reclineSeconds
    let t = 0
    let last = 0
    while (rig.shown[i] < 1 && t < 20) {
      rig.step({ life, generation: 0, simDt: 1 / 60, now: t })
      expect(rig.shown[i] - last).toBeLessThan(0.01) // smooth: never a jump
      last = rig.shown[i]
      t += 1 / 60
    }
    expect(t).toBeGreaterThan(CONFIG.meals.reclineSeconds - 0.2)
    expect(t).toBeLessThan(CONFIG.meals.reclineSeconds + 0.2)
    expect(rig.shown[i]).toBe(1)
    expect(angle()).toBeCloseTo(RECLINE_MAX, 6)
    // the angle is published for the crowd
    expect(reclineShown('B4')).toBe(1)
    expect(reclineShown('B3')).toBe(0)
    // lowering again, at 4x it is four times quicker
    life.rooms.get('B4')!.recline = 0
    let n = 0
    while (rig.shown[i] > 0 && n < 6000) {
      rig.step({ life, generation: 0, simDt: 4 / 60, now: t })
      n++
    }
    expect(n / 60).toBeGreaterThan(CONFIG.meals.reclineSeconds / 4 - 0.2)
    expect(n / 60).toBeLessThan(CONFIG.meals.reclineSeconds / 4 + 0.2)
    rig.dispose()
  })

  it('the backrest hinges about the waist: the head end rises, the foot end stays on the mattress, ward A and B alike', () => {
    for (const id of ['A5', 'B5']) {
      const life = newLife()
      const rig = createWardRig(fakeAtlas())
      life.rooms.get(id)!.recline = 1
      rig.step({ life, generation: 0, simDt: 0, now: 0 })
      rig.step({ life: newLife(), generation: 1, simDt: 0, now: 0 }) // a Jump: snap to the new hospital's flat beds
      const i = ROOMS.findIndex((r) => r.id === id)
      const room = ROOMS[i]
      expect(rig.shown[i]).toBe(0)
      life.rooms.get(id)!.recline = 1
      rig.step({ life, generation: 2, simDt: 0, now: 0 }) // another Jump: snaps straight to fully raised
      expect(rig.shown[i]).toBe(1)
      const m = matrixOf(rig.backrests, i)
      // the head end of the slab: bed-local z = -(length) from the hinge, the top surface
      const sign = room.ward === 'A' ? -1 : 1
      const head = new Vector3(0, 0.03, -0.86).applyMatrix4(m)
      const foot = new Vector3(0, 0.03, 0).applyMatrix4(m)
      // the head end is well above the mattress top (0.49), the hinge end is on it
      expect(head.y).toBeGreaterThan(0.49 + 0.5)
      expect(Math.abs(foot.y - 0.49)).toBeLessThan(0.015)
      // the head end moved toward the feet (the section tilts up, so it reaches less far toward the head wall)
      const flatHeadZ = room.bed.z + sign * (-0.1 - 0.86)
      expect(Math.abs(head.z - room.bed.z)).toBeLessThan(Math.abs(flatHeadZ - room.bed.z))
      rig.dispose()
    }
  })

  it('lights each door tile by the bed state, pulsing for leaving and cleaning only, and writes a colour only when the state changes', () => {
    const life = newLife()
    const rig = createWardRig(fakeAtlas())
    rig.step({ life, generation: 0, simDt: 0, now: 0 })
    const states = ['dischargeSigned', 'leaving', 'needsCleaning', 'cleaning', 'ready', 'reserved', 'occupied'] as const
    states.forEach((s, k) => (life.rooms.get(ROOMS[k].id)!.bed = s))
    const versionBefore = rig.tiles.instanceColor!.version
    rig.step({ life, generation: 0, simDt: 0, now: 0.1 })
    expect(rig.tiles.instanceColor!.version).toBeGreaterThan(versionBefore)
    const pulse = rig.tiles.geometry.getAttribute('aPulse')
    states.forEach((s, k) => {
      const idx = bedStateIndex(s)
      const c = rig.tiles.instanceColor!
      expect([c.getX(k), c.getY(k), c.getZ(k)].map((v) => Math.round(v * 1e4))).toEqual([DOOR_COLORS[idx].r, DOOR_COLORS[idx].g, DOOR_COLORS[idx].b].map((v) => Math.round(v * 1e4)))
      expect(pulse.getX(k)).toBe(DOOR_PULSE[idx])
    })
    expect(Array.from({ length: 7 }, (_, k) => pulse.getX(k))).toEqual([0, 1, 0, 1, 0, 0, 0])
    // nothing changed: nothing is written, and a pulse is the clock uniform moving, not a rewrite
    const v = rig.tiles.instanceColor!.version
    const pv = (pulse as unknown as { version: number }).version
    rig.step({ life, generation: 0, simDt: 0, now: 5 })
    rig.step({ life, generation: 0, simDt: 0, now: 5.3 })
    expect(rig.tiles.instanceColor!.version).toBe(v)
    expect((pulse as unknown as { version: number }).version).toBe(pv)
    rig.dispose()
  })

  it('repaints a bedside screen only when its room version changes, checks at 4 Hz and uploads at most 2 Hz', () => {
    const atlas = fakeAtlas()
    const life = newLife()
    const rig = createWardRig(atlas)
    rig.step({ life, generation: 0, simDt: 0, now: 0 })
    expect(atlas.draw).toHaveBeenCalledTimes(ROOMS.length)
    expect(atlas.draw.mock.calls[0][1]).toMatchObject({ roomId: 'A1', bed: 'occupied', name: 'Patient A1' })
    expect(atlas.texture.version).toBe(1)
    // 60 frames over a second with nothing changed: no repaint
    for (let k = 1; k <= 60; k++) rig.step({ life, generation: 0, simDt: 0, now: k / 60 })
    expect(atlas.draw).toHaveBeenCalledTimes(ROOMS.length)
    expect(atlas.texture.version).toBe(1)
    // one room changes: exactly that tile is repainted, within a quarter of a second
    const room = life.rooms.get('A3')!
    room.bed = 'ready'
    room.patientName = null
    room.version++
    atlas.draw.mockClear()
    const t0 = 2
    let repainted = -1
    for (let k = 0; k <= 30; k++) {
      rig.step({ life, generation: 0, simDt: 0, now: t0 + k / 60 })
      if (repainted < 0 && atlas.draw.mock.calls.length > 0) repainted = k / 60
    }
    expect(atlas.draw).toHaveBeenCalledTimes(1)
    expect(atlas.draw.mock.calls[0][0]).toBe(2)
    expect(atlas.draw.mock.calls[0][1]).toMatchObject({ roomId: 'A3', bed: 'ready', name: null })
    expect(repainted).toBeLessThanOrEqual(SCREEN_CHECK + 1 / 60)
    // a burst of changes uploads the canvas at most once per SCREEN_UPLOAD
    const v0 = atlas.texture.version
    for (let k = 0; k < 120; k++) {
      life.rooms.get(ROOMS[k % 16].id)!.version++
      rig.step({ life, generation: 0, simDt: 0, now: 10 + k / 60 })
    }
    const uploads = atlas.texture.version - v0
    expect(uploads).toBeGreaterThanOrEqual(3)
    expect(uploads).toBeLessThanOrEqual(Math.ceil(2 / SCREEN_UPLOAD) + 1)
    rig.dispose()
  })

  it("shows a patient's day of stay from the content, and 1 for somebody admitted today", () => {
    const atlas = fakeAtlas()
    const life = newLife()
    const rig = createWardRig(atlas)
    // pt-A1 is in patients.json (day 4); pt-A2 is renamed to an admission that is not
    life.rooms.get('A1')!.patientId = 'pt-A1'
    life.rooms.get('A2')!.patientId = 'er-123'
    rig.step({ life, generation: 0, simDt: 0, now: 0 })
    expect(atlas.draw.mock.calls[0][1]!.day).toBeGreaterThan(1)
    expect(atlas.draw.mock.calls[1][1]!.day).toBe(1)
    rig.dispose()
  })

  it('a Jump (a new generation) repaints everything and snaps the beds', () => {
    const atlas = fakeAtlas()
    const life = newLife()
    const rig = createWardRig(atlas)
    life.rooms.get('A1')!.recline = 1
    rig.step({ life, generation: 0, simDt: 0, now: 0 })
    expect(rig.shown[0]).toBe(1) // the first frame snaps
    atlas.draw.mockClear()
    rig.step({ life: newLife(), generation: 1, simDt: 0, now: 1 })
    expect(rig.shown[0]).toBe(0)
    expect(atlas.draw).toHaveBeenCalledTimes(ROOMS.length)
    rig.dispose()
  })
})
