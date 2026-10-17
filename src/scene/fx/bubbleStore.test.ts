import { describe, expect, it } from 'vitest'
import { MAX_BUBBLES, MAX_TEXT_LENGTH, REPEAT_WINDOW_SECONDS, createBubbleStore } from './bubbleStore'

/** A fresh store with its own memory and a clock the test controls. */
function setup(start = 1000) {
  const clock = { t: start }
  const store = createBubbleStore(() => clock.t)
  return { clock, store, bubbles: () => store.getState().bubbles, say: (...a: [string, string, number]) => store.getState().say(...a) }
}

describe('speech bubble store', () => {
  it('shows a line over a person until its time is up', () => {
    const { clock, say, bubbles, store } = setup()
    expect(say('p1', 'Good morning', 4)).toBe(true)
    expect(bubbles()).toHaveLength(1)
    expect(bubbles()[0]).toMatchObject({ entityId: 'p1', text: 'Good morning', born: 1000, until: 1004 })

    clock.t = 1003.9
    expect(store.getState().prune()).toBe(false)
    expect(bubbles()).toHaveLength(1)

    clock.t = 1004
    expect(store.getState().prune()).toBe(true)
    expect(bubbles()).toHaveLength(0)
  })

  it('expires each bubble at its own time and keeps the rest', () => {
    const { clock, say, bubbles, store } = setup()
    say('a', 'one', 2)
    say('b', 'two', 5)
    say('c', 'three', 9)
    clock.t = 1006
    store.getState().prune()
    expect(bubbles().map((b) => b.entityId)).toEqual(['c'])
  })

  it('caps the screen at 12 bubbles and keeps the newest', () => {
    const { say, bubbles } = setup()
    expect(MAX_BUBBLES).toBe(12)
    for (let i = 0; i < 20; i++) say(`p${i}`, `line ${i}`, 10)
    expect(bubbles()).toHaveLength(12)
    expect(bubbles().map((b) => b.entityId)).toEqual(Array.from({ length: 12 }, (_, i) => `p${i + 8}`))
  })

  it('makes room by dropping the bubble that would expire first, and never the one just said', () => {
    const { say, bubbles } = setup()
    for (let i = 0; i < 12; i++) say(`p${i}`, 'hello', 10 + i) // p0 expires first, p11 last
    expect(say('late', 'new line', 1)).toBe(true) // the shortest of all, but it is the newest
    const ids = bubbles().map((b) => b.entityId)
    expect(ids).toHaveLength(12)
    expect(ids).toContain('late')
    expect(ids).not.toContain('p0')
    expect(ids).toContain('p11')
  })

  it('never lets expired bubbles take a place from a live one', () => {
    const { clock, say, bubbles } = setup()
    for (let i = 0; i < 12; i++) say(`p${i}`, 'hi', 1)
    clock.t += 5 // all twelve have run out, though nobody has pruned yet
    say('fresh', 'still here', 3)
    expect(bubbles().map((b) => b.entityId)).toEqual(['fresh'])
  })

  it('keeps one bubble per person: a new line replaces the old one', () => {
    const { say, bubbles } = setup()
    say('p1', 'First thing', 6)
    say('p1', 'Second thing', 6)
    expect(bubbles()).toHaveLength(1)
    expect(bubbles()[0].text).toBe('Second thing')
  })

  it('does not repeat the same text for the same person within 60 s', () => {
    const { clock, say, bubbles, store } = setup()
    expect(REPEAT_WINDOW_SECONDS).toBe(60)
    expect(say('p1', 'Your medicine is on its way', 4)).toBe(true)

    clock.t += 10
    store.getState().prune()
    expect(bubbles()).toHaveLength(0)
    expect(say('p1', 'Your medicine is on its way', 4)).toBe(false) // 10 s later: dropped
    expect(bubbles()).toHaveLength(0)

    clock.t += 49.9 // 59.9 s after the first
    expect(say('p1', 'Your medicine is on its way', 4)).toBe(false)

    clock.t += 0.1 // 60 s after the first
    expect(say('p1', 'Your medicine is on its way', 4)).toBe(true)
  })

  it('applies the no-repeat rule to the same person only, and to the same text only', () => {
    const { say, bubbles } = setup()
    expect(say('p1', 'Hello', 4)).toBe(true)
    expect(say('p2', 'Hello', 4)).toBe(true) // someone else may say it
    expect(say('p1', 'Hello again', 4)).toBe(true) // a different line is fine
    expect(bubbles().map((b) => b.entityId).sort()).toEqual(['p1', 'p2'])
  })

  it('counts a repeat even after an intervening line replaced it', () => {
    const { clock, say } = setup()
    say('p1', 'Where is the kiosk?', 4)
    clock.t += 5
    say('p1', 'Thank you', 4)
    clock.t += 5
    expect(say('p1', 'Where is the kiosk?', 4)).toBe(false)
  })

  it('ignores blank text and non-positive or non-finite durations', () => {
    const { say, bubbles } = setup()
    expect(say('p1', '   ', 4)).toBe(false)
    expect(say('p1', 'ok', 0)).toBe(false)
    expect(say('p1', 'ok', -3)).toBe(false)
    expect(say('p1', 'ok', Number.NaN)).toBe(false)
    expect(say('p1', 'ok', Infinity)).toBe(false)
    expect(bubbles()).toHaveLength(0)
  })

  it('tidies whitespace and cuts very long lines', () => {
    const { say, bubbles } = setup()
    say('p1', '  two\n  lines   here ', 4)
    expect(bubbles()[0].text).toBe('two lines here')
    say('p2', 'x'.repeat(500), 4)
    const long = bubbles().find((b) => b.entityId === 'p2')!
    expect(long.text.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH)
    expect(long.text.endsWith('…')).toBe(true)
  })

  it('gives every accepted line a new, increasing id', () => {
    const { say, bubbles } = setup()
    say('a', 'one', 5)
    say('b', 'two', 5)
    say('c', 'three', 5)
    const ids = bubbles().map((b) => b.id)
    expect(ids).toEqual([...ids].sort((x, y) => x - y))
    expect(new Set(ids).size).toBe(3)
  })

  it('clears one person or everyone', () => {
    const { say, bubbles, store } = setup()
    say('a', 'one', 5)
    say('b', 'two', 5)
    store.getState().clear('a')
    expect(bubbles().map((b) => b.entityId)).toEqual(['b'])
    store.getState().clear()
    expect(bubbles()).toEqual([])
  })

  it('takes the time from the call when given, otherwise from the store clock', () => {
    const { clock, store } = setup(50)
    store.getState().say('a', 'from the clock', 2)
    expect(store.getState().bubbles[0].born).toBe(50)
    clock.t = 70
    store.getState().say('b', 'explicit time', 2, 500)
    expect(store.getState().bubbles.find((b) => b.entityId === 'b')?.until).toBe(502)
  })

  it('keeps its repeat memory bounded', () => {
    const { clock, say, bubbles } = setup()
    for (let i = 0; i < 2000; i++) {
      clock.t += 1
      say(`p${i}`, `line ${i}`, 1)
    }
    expect(bubbles().length).toBeLessThanOrEqual(MAX_BUBBLES)
  })
})
