import { describe, expect, it } from 'vitest'
import type { Emote, Entity } from '@/sim/types'
import { EMOTE_CODE } from './emoteAtlas'
import { MAX_RANGE, POP_PEAK, POP_SECONDS } from './emoteMath'
import { EmoteTracker, MAX_STEP, SYNC_SECONDS } from './emoteState'

function person(id: string, over: Partial<Entity> = {}): Entity {
  return {
    id,
    role: 'patient',
    name: id,
    position: { x: 0, y: 0, z: 0 },
    heading: 0,
    speed: 0,
    anim: 'idle',
    emote: 'none',
    mood: 'neutral',
    tier: 'near',
    variant: 0,
    ...over,
  }
}

function world(...people: Entity[]) {
  const map = new Map<string, Entity>()
  for (const p of people) map.set(p.id, p)
  return map
}

/** Camera 20 m in front of the origin, at head height: every test person is in range. */
const CAM: [number, number, number] = [0, 10, 20]
const FRAME = 1 / 60

/** Run `seconds` of frames. */
function run(t: EmoteTracker, seconds: number, cam: [number, number, number] = CAM): number {
  let n = 0
  const frames = Math.round(seconds / FRAME)
  for (let i = 0; i < frames; i++) n = t.update(FRAME, cam[0], cam[1], cam[2])
  return n
}

describe('EmoteTracker', () => {
  it('draws nothing while nobody has an emote', () => {
    const t = new EmoteTracker(world(person('a'), person('b')))
    expect(run(t, 1)).toBe(0)
    expect(t.count).toBe(0)
  })

  it('pops an icon in over 0.25 s: from nothing, overshooting to about 1.1, settling at 1', () => {
    const a = person('a', { emote: 'pill' })
    const t = new EmoteTracker(world(a))
    t.update(FRAME, ...CAM)
    const first = t.posSize[3]
    let peak = 0
    let size = 0
    const frames = Math.ceil(POP_SECONDS / FRAME) + 4
    const sizes: number[] = []
    for (let i = 0; i < frames; i++) {
      t.update(FRAME, ...CAM)
      size = t.posSize[3]
      sizes.push(size)
      peak = Math.max(peak, size)
    }
    // the first frame is a sliver of the final size, not a pop-in at full size
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(0.1 * size)
    // settled: size is the full size, and the overshoot reached about 10 % above it
    expect(peak / size).toBeGreaterThan(POP_PEAK - 0.03)
    expect(peak / size).toBeLessThanOrEqual(POP_PEAK + 0.001)
    // no frame-to-frame jump bigger than a fifth of the final size
    for (let i = 1; i < sizes.length; i++) expect(Math.abs(sizes[i] - sizes[i - 1])).toBeLessThan(0.2 * size)
  })

  it('fills the instance buffers with the right icon, over the right head', () => {
    const a = person('a', { emote: 'pill', position: { x: 4, y: 0, z: -3 } })
    const t = new EmoteTracker(world(a))
    const n = run(t, 0.5)
    expect(n).toBe(1)
    expect(t.posSize[0]).toBeCloseTo(4)
    expect(t.posSize[2]).toBeCloseTo(-3)
    expect(t.posSize[1]).toBeGreaterThan(2.05) // above the standing anchor
    expect(t.alphaOut[0]).toBeCloseTo(1)
    expect(t.shownCode('a')).toBe(EMOTE_CODE.pill)
    expect(t.uvRect[2]).toBeGreaterThan(0)
  })

  it('anchors by pose: a seated person has the icon lower than a standing one, a lying one lower still', () => {
    const t = new EmoteTracker(
      world(
        person('stand', { emote: 'check' }),
        person('sit', { emote: 'check', anim: 'sit' }),
        person('lie', { emote: 'check', anim: 'lie' }),
      ),
    )
    run(t, 0.6)
    expect(t.count).toBe(3)
    // slots are in insertion order
    expect(t.posSize[1]).toBeGreaterThan(t.posSize[5])
    expect(t.posSize[5]).toBeGreaterThan(t.posSize[9])
  })

  it('fades an icon out when the emote clears, at constant size, then stops drawing it', () => {
    const a = person('a', { emote: 'heart' })
    const t = new EmoteTracker(world(a))
    run(t, 0.6)
    const full = t.posSize[3]
    expect(t.alphaOut[0]).toBeCloseTo(1)

    a.emote = 'none'
    let prev = 1
    let frames = 0
    while (t.update(FRAME, ...CAM) > 0 && frames < 120) {
      frames++
      expect(t.alphaOut[0]).toBeLessThanOrEqual(prev)
      expect(t.posSize[3]).toBeCloseTo(full, 5)
      prev = t.alphaOut[0]
    }
    expect(frames).toBeGreaterThan(5) // a fade, not a cut
    expect(frames).toBeLessThan(30)
    expect(t.count).toBe(0)
    expect(t.shownCode('a')).toBe(0)
  })

  it('pops the new icon in when one emote replaces another', () => {
    const a = person('a', { emote: 'pill' })
    const t = new EmoteTracker(world(a))
    run(t, 0.6)
    a.emote = 'check'
    t.update(FRAME, ...CAM)
    expect(t.shownCode('a')).toBe(EMOTE_CODE.check)
    expect(t.posSize[3]).toBeLessThan(0.3) // small again: popping in
    run(t, 0.4)
    expect(t.posSize[3]).toBeGreaterThan(0.4)
  })

  it('multiplies by the person\'s fade, and draws nothing for someone who has all but faded out', () => {
    const a = person('a', { emote: 'tablet', fade: 0.5 })
    const t = new EmoteTracker(world(a))
    run(t, 0.6)
    expect(t.alphaOut[0]).toBeCloseTo(0.5)
    a.fade = 0.01
    t.update(FRAME, ...CAM)
    expect(t.count).toBe(0)
  })

  it('hides icons beyond 160 m, fades them from 140 m, and shows them again on return', () => {
    const a = person('a', { emote: 'bed' })
    const t = new EmoteTracker(world(a))
    run(t, 0.6)
    expect(t.count).toBe(1)
    // camera directly above at 150 m: the fade is partial
    run(t, 0.1, [0, 150, 0])
    expect(t.count).toBe(1)
    expect(t.alphaOut[0]).toBeLessThan(1)
    expect(t.alphaOut[0]).toBeGreaterThan(0)
    run(t, 0.1, [0, MAX_RANGE + 10, 0])
    expect(t.count).toBe(0)
    run(t, 0.1, CAM)
    expect(t.count).toBe(1)
    expect(t.alphaOut[0]).toBeCloseTo(1)
  })

  it('grows the icon with distance so it stays readable from the overview', () => {
    const a = person('a', { emote: 'pill' })
    const t = new EmoteTracker(world(a))
    run(t, 0.6, [0, 10, 12])
    const near = t.posSize[3]
    run(t, 0.1, [0, 110, 30])
    const far = t.posSize[3]
    expect(far).toBeGreaterThan(near * 2)
  })

  it('follows people coming and going without losing anyone else\'s animation', () => {
    const a = person('a', { emote: 'pill' })
    const b = person('b', { emote: 'check', position: { x: 2, y: 0, z: 0 } })
    const map = world(a, b)
    const t = new EmoteTracker(map)
    run(t, 0.6)
    const slotA = t.slotFor('a')
    const slotB = t.slotFor('b')
    expect(t.count).toBe(2)

    // a leaves, c arrives (same head count: only the periodic rebuild can see this)
    map.delete('a')
    const c = person('c', { emote: 'coffee', position: { x: -2, y: 0, z: 0 } })
    map.set('c', c)
    run(t, SYNC_SECONDS + 0.1)
    expect(t.slotFor('a')).toBeUndefined()
    expect(t.slotFor('b')).toBe(slotB) // b kept its slot, so its animation carried on
    expect(t.slotFor('c')).toBe(slotA) // c took a's freed slot
    expect(t.tracked).toBe(2)
    expect(t.count).toBe(2)
    expect(t.shownCode('b')).toBe(EMOTE_CODE.check)
    expect(t.shownCode('c')).toBe(EMOTE_CODE.coffee)
  })

  it('rebuilds at once when the head count changes, and not on frames where nothing changed', () => {
    const map = world(person('a'))
    const t = new EmoteTracker(map)
    t.update(FRAME, ...CAM)
    expect(t.tracked).toBe(1)
    map.set('b', person('b', { emote: 'scan' }))
    t.update(FRAME, ...CAM) // one frame later, well inside the 4 Hz window
    expect(t.tracked).toBe(2)
    expect(t.shownCode('b')).toBe(EMOTE_CODE.scan)
  })

  it('has a new arrival who is already emoting pop in, rather than appear', () => {
    const map = world()
    const t = new EmoteTracker(map)
    run(t, 0.3)
    map.set('a', person('a', { emote: 'question' }))
    t.update(FRAME, ...CAM)
    expect(t.count).toBe(1)
    expect(t.alphaOut[0]).toBeLessThan(0.5)
  })

  it('ignores people past its capacity instead of failing', () => {
    const map = world(person('a', { emote: 'pill' }), person('b', { emote: 'pill' }), person('c', { emote: 'pill' }))
    const t = new EmoteTracker(map, 2)
    run(t, 0.6)
    expect(t.tracked).toBe(2)
    expect(t.count).toBe(2)
    expect(t.slotFor('c')).toBeUndefined()
    // when one leaves, the next gets the slot
    map.delete('a')
    run(t, SYNC_SECONDS + 0.1)
    expect(t.slotFor('c')).toBeDefined()
    expect(t.count).toBe(2)
  })

  it('clamps a long frame so a stalled tab does not skip the pop', () => {
    const a = person('a', { emote: 'pill' })
    const t = new EmoteTracker(world(a))
    expect(MAX_STEP).toBeLessThan(POP_SECONDS)
    t.update(5, ...CAM) // five seconds in one step counts as MAX_STEP
    const afterStall = t.posSize[3]
    run(t, 1)
    const settled = t.posSize[3]
    expect(afterStall).toBeGreaterThan(0)
    expect(afterStall).toBeLessThan(settled) // still mid-pop, not jumped to the end
    t.update(-1, ...CAM) // a negative step changes nothing and does not throw
    expect(t.posSize[3]).toBeCloseTo(settled, 6)
  })

  it('knows a code for every emote the sim can set', () => {
    const emotes: Emote[] = ['tablet', 'pill', 'hourglass', 'bed', 'check', 'scan', 'heart', 'question', 'coffee']
    const people = emotes.map((e, i) => person(`p${i}`, { emote: e, position: { x: i, y: 0, z: 0 } }))
    const t = new EmoteTracker(world(...people))
    expect(run(t, 0.6)).toBe(emotes.length)
    for (let i = 0; i < emotes.length; i++) expect(t.shownCode(`p${i}`)).toBe(EMOTE_CODE[emotes[i]])
  })
})
