/**
 * R2 (docs/R2-SURGERY.md): the readability layer across two storeys. The head anchor is a SIM point (level 2 lives in its own strip of the flat sim, sim x = drawn x +
 * 150, y floor-relative); the emote icons and the speech bubbles map it to drawn coordinates once, hide anybody the screen does not show (`shownAt`), and the
 * bubbles test the line of sight in SIM space against the sim's walls from the camera's sim position.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { levelView } from '@/scene/levels/levelView'
import { LEVEL2_DX, LEVEL_Y, l2 } from '@/sim/levels'
import { SURGERY } from '@/sim/places'
import type { Entity, Vec3 } from '@/sim/types'
import { FADE_IN_SECONDS, GAP, SIGHT_FADE_SECONDS, placeBubble, type BubblePlacement, type SightState } from './bubblePlacement'
import { CENTRE_LIFT, emoteWorldSize } from './emoteMath'
import { EmoteTracker } from './emoteState'
import { HEAD_Y, STRETCHER_LIFT, headAnchor } from './headAnchor'
import { sightBlocked } from './sight'
import { LIE } from '@/scene/actors/crowd/constants'

function person(id: string, over: Partial<Entity> = {}): Entity {
  return { id, role: 'patient', name: id, position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'idle', emote: 'none', mood: 'neutral', tier: 'near', variant: 0, ...over }
}

const world = (...people: Entity[]): Map<string, Entity> => new Map(people.map((p) => [p.id, p]))
const FRAME = 1 / 60

const show = (shown: 1 | 2, overview: boolean): void => {
  levelView.shown = shown
  levelView.overview = overview
}

beforeEach(() => show(1, true))
afterEach(() => show(1, true))

describe('the head anchor on level 2 (a sim point, floor-relative)', () => {
  it('is the same height above the floor as on level 1, and rides up on a surgery trolley (0.8 m mattress) and on the OR table (0.88 m) by the difference to a ward bed', () => {
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    headAnchor(person('s', { position: { x: 100, y: 0, z: 3 } }), out)
    expect(out.y).toBeCloseTo(HEAD_Y.stand, 9)
    expect(out.x).toBe(100)
    const lie = (seatId: string): Entity => person('l', { anim: 'lie', seated: { seatId, pose: 'lie' }, position: { x: 100, y: 0, z: 3 }, heading: 0 })
    headAnchor(lie('bed:A1'), out)
    const ward = out.y
    expect(ward).toBeCloseTo(HEAD_Y.lie, 9)
    headAnchor(lie('surgeryBed:preop:0'), out)
    expect(out.y).toBeCloseTo(HEAD_Y.lie + (0.8 - LIE.bed), 9)
    headAnchor(lie('orTable:0'), out)
    expect(out.y).toBeCloseTo(HEAD_Y.lie + (SURGERY.table.height - LIE.bed), 9)
    // a stretcher is as it was
    headAnchor(person('r', { anim: 'lie', riding: true, vehicle: 'stretcher', position: { x: 100, y: 0, z: 3 } }), out)
    expect(out.y).toBeCloseTo(HEAD_Y.lie + STRETCHER_LIFT, 9)
    // the icon over a patient lying on the table is above the head, not inside it (the mattress top is 0.88; the head about 0.1 above it)
    headAnchor(lie('orTable:0'), out)
    expect(out.y).toBeGreaterThan(SURGERY.table.height + 0.4)
  })
})

describe('emote icons across levels', () => {
  const cam = { drawn: [-50, 6.5, 14] as const, ground: [-10, 10, 24] as const }
  const run = (t: EmoteTracker, cx: number, cy: number, cz: number, frames = 40): void => {
    for (let i = 0; i < frames; i++) t.update(FRAME, cx, cy, cz)
  }
  const icon = (t: EmoteTracker, i: number): number[] => Array.from(t.posSize.subarray(i * 4, i * 4 + 4))

  it('shows an icon over a level-2 person at drawn coordinates (x - 150, y + 4.2) and over a level-1 person unchanged', () => {
    const a = person('ground', { emote: 'heart', position: { x: -10, y: 0, z: 3 } })
    const b = person('upstairs', { emote: 'heart', position: { x: 100, y: 0, z: 4 } })
    // walking on level 1: only the ground floor's icon
    show(1, false)
    const t = new EmoteTracker(world(a, b))
    run(t, ...cam.ground)
    expect(t.count).toBe(1)
    const g = icon(t, 0)
    expect(g[0]).toBeCloseTo(-10, 5)
    expect(g[2]).toBeCloseTo(3, 5)
    expect(g[1]).toBeCloseTo(HEAD_Y.stand + CENTRE_LIFT * emoteWorldSize(Math.hypot(0, HEAD_Y.stand + 0.35 - cam.ground[1], 3 - cam.ground[2], -10 - cam.ground[0])), 1)
    // walking on level 2: only the level-2 icon, drawn 150 m west and 4.2 m up
    show(2, false)
    run(t, ...cam.drawn, 3)
    expect(t.count).toBe(1)
    const u = icon(t, 0)
    expect(u[0]).toBeCloseTo(100 - LEVEL2_DX, 5)
    expect(u[2]).toBeCloseTo(4, 5)
    expect(u[1]).toBeGreaterThan(LEVEL_Y[2] + HEAD_Y.stand)
    expect(u[1]).toBeLessThan(LEVEL_Y[2] + HEAD_Y.stand + 1)
  })

  it('draws no icon over somebody the screen does not show: the other level, and under the slab in the overview of Level 2', () => {
    const under = person('under', { emote: 'heart', position: { x: -48, y: 0, z: 0 } }) // ground floor, inside the footprint
    const outside = person('outside', { emote: 'heart', position: { x: 10, y: 0, z: 0 } }) // ground floor, outside it
    const upstairs = person('upstairs', { emote: 'heart', position: { x: l2(-48), y: 0, z: 0 } })
    const t = new EmoteTracker(world(under, outside, upstairs))
    const both = (): number => {
      // the camera high over the west block: everything is in range
      run(t, -20, 60, 40, 20)
      return t.count
    }
    show(1, true)
    expect(both()).toBe(2)
    show(2, true)
    expect(both()).toBe(2) // outside + upstairs
    // which two: the icon over 'upstairs' is up on the slab (y over 4.2), the other one is the ground floor's outside
    const ys = [icon(t, 0)[1], icon(t, 1)[1]].sort((p, q) => p - q)
    expect(ys[0]).toBeLessThan(3)
    expect(ys[1]).toBeGreaterThan(LEVEL_Y[2] + 1.5)
    show(2, false)
    expect(both()).toBe(1)
    show(1, false)
    expect(both()).toBe(2)
  })

  it('an icon keeps its pop and fade while its person is on the other level (the animation state is per person, not per view)', () => {
    const a = person('a', { emote: 'heart', position: { x: 100, y: 0, z: 4 } })
    const t = new EmoteTracker(world(a))
    show(1, false)
    run(t, -50, 6.5, 14, 60) // hidden: the icon has long since popped in
    show(2, false)
    t.update(FRAME, -50, 6.5, 14)
    expect(t.count).toBe(1)
    // full size at once (no second pop from nothing)
    expect(t.alphaOut[0]).toBeGreaterThan(0.95)
  })
})

describe('speech bubbles across levels', () => {
  const out = (): BubblePlacement => ({ x: 0, y: 0, z: 0, opacity: 0, moved: false })
  const fresh = (): SightState => ({ seen: 1 })
  const say = (e: Entity | undefined, cam: Vec3, camSim: Vec3, walking: boolean, o: BubblePlacement, sight = fresh(), dt = 1 / 60, now = 5): void =>
    placeBubble(e, now - 1, now + 5, now, cam, camSim, walking, dt, sight, o)
  const to = (c: Vec3): Vec3 => ({ x: c.x - LEVEL2_DX, y: c.y + LEVEL_Y[2], z: c.z })

  it('moves the card to the DRAWN anchor of a level-2 speaker (x - 150, y + 4.2) with the same lift over the head, and leaves a level-1 speaker where it is', () => {
    show(2, false)
    const anaes = person('anaes', { role: 'doctor', position: { x: l2(-49.2), y: 0, z: 4.3 } })
    const camSim = { x: l2(-47), y: 1.9, z: 8 }
    const o = out()
    say(anaes, to(camSim), camSim, true, o)
    expect(o.moved).toBe(true)
    expect(o.x).toBeCloseTo(l2(-49.2) - LEVEL2_DX, 6)
    expect(o.y).toBeCloseTo(LEVEL_Y[2] + HEAD_Y.stand + GAP, 6)
    expect(o.z).toBeCloseTo(4.3, 6)
    expect(o.opacity).toBeGreaterThan(0.9)
    // level 1: unchanged
    show(1, false)
    const nurse = person('nurse', { role: 'nurse', position: { x: -20, y: 0, z: 2 } })
    const o1 = out()
    say(nurse, { x: -20, y: 1.9, z: 8 }, { x: -20, y: 1.9, z: 8 }, true, o1)
    expect([o1.x, o1.y, o1.z]).toEqual([-20, HEAD_Y.stand + GAP, 2])
  })

  it('is hidden for a speaker the screen does not show: the other level, and under the slab in the overview of Level 2; the card is not even moved', () => {
    const upstairs = person('up', { position: { x: l2(-49.2), y: 0, z: 4.3 } })
    const under = person('under', { position: { x: -48, y: 0, z: 0 } })
    const cam = { x: -50, y: 6, z: 12 }
    for (const [shown, overview, who, visible] of [
      [1, false, upstairs, false],
      [2, false, under, false],
      [2, true, under, false],
      [2, true, upstairs, true],
      [1, true, upstairs, false],
      [1, true, under, true],
    ] as const) {
      show(shown, overview)
      const o = out()
      say(who, cam, cam, !overview, o)
      expect(o.opacity > 0, `${who.id} at level ${shown}${overview ? ' (overview)' : ''}`).toBe(visible)
      expect(o.moved, `${who.id} moved`).toBe(visible)
    }
    // and nobody to anchor to
    const o = out()
    say(undefined, cam, cam, true, o)
    expect(o.opacity).toBe(0)
    expect(o.moved).toBe(false)
  })

  it('tests the line of sight in SIM space: a wall between you and the speaker in the sim hides the card, whatever the drawn camera says', () => {
    show(2, false)
    // the speaker stands at the OR table; the theatre hall is on the other side of the OR's north wall; the corridor sees in through the viewing window (glass)
    const surgeon = person('surgeon', { role: 'doctor', position: { x: SURGERY.table.at.x, y: 0, z: SURGERY.table.at.z - 1.6 } })
    const hall = { x: l2(-50), y: 1.7, z: 0.0 }
    const window = { x: SURGERY.viewing.at.x, y: 1.7, z: SURGERY.viewing.at.z }
    const hide = (camSim: Vec3, drawnCam: Vec3, seconds = 1): number => {
      const sight = fresh()
      const o = out()
      for (let i = 0; i < Math.round(seconds * 60); i++) say(surgeon, drawnCam, camSim, true, o, sight)
      return o.opacity
    }
    // the sim says there is a wall: it fades out to nothing
    expect(sightBlocked(hall.x, hall.y, hall.z, surgeon.position.x, 2.05, surgeon.position.z)).toBe(true)
    expect(hide(hall, to(hall))).toBe(0)
    // through the glazed window the sim sees the speaker: fully there
    expect(sightBlocked(window.x, window.y, window.z, surgeon.position.x, 2.05, surgeon.position.z)).toBe(false)
    expect(hide(window, to(window))).toBe(1)
    // it is the sim camera that decides: the drawn camera is (deliberately) the OTHER one and changes nothing
    expect(hide(hall, to(window))).toBe(0)
    expect(hide(window, to(hall))).toBe(1)
    // the same two points in drawn coordinates, run through the sim's walls, would see no wall at all: the wrong space gives the wrong answer
    expect(sightBlocked(to(hall).x, to(hall).y, to(hall).z, to({ x: surgeon.position.x, y: 2.05, z: surgeon.position.z }).x, to({ x: 0, y: 2.05, z: 0 }).y, surgeon.position.z)).toBe(false)
  })

  it('fades in over 0.18 s and the sight fade takes 0.15 s, as before; in the overview no wall hides a card', () => {
    show(2, false)
    const surgeon = person('surgeon', { position: { x: SURGERY.table.at.x, y: 0, z: SURGERY.table.at.z - 1.6 } })
    const window = { x: SURGERY.viewing.at.x, y: 1.7, z: SURGERY.viewing.at.z }
    const o = out()
    placeBubble(surgeon, 4.9, 10, 5, to(window), window, true, 1 / 60, fresh(), o)
    expect(o.opacity).toBeCloseTo(Math.min(1, 0.1 / FADE_IN_SECONDS), 6)
    // behind a wall, the sight fade runs for SIGHT_FADE_SECONDS
    const hall = { x: l2(-50), y: 1.7, z: 0.0 }
    const sight = fresh()
    placeBubble(surgeon, 0, 100, 5, to(hall), hall, true, SIGHT_FADE_SECONDS / 2, sight, o)
    expect(sight.seen).toBeCloseTo(0.5, 9)
    placeBubble(surgeon, 0, 100, 5, to(hall), hall, true, SIGHT_FADE_SECONDS, sight, o)
    expect(sight.seen).toBe(0)
    // the overview ('walking' false): walls are not tested
    const sight2 = fresh()
    placeBubble(surgeon, 0, 100, 5, to(hall), hall, false, 1, sight2, o)
    expect(sight2.seen).toBe(1)
    expect(o.opacity).toBe(1)
  })
})
