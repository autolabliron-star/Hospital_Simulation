import { describe, expect, it } from 'vitest'
import { SIM_SPEEDS } from '@/sim/types'
import json from './skip.json'
import { MILESTONE_KINDS, SKIP, SkipCopySchema, fillSkip } from './skip'

describe('skip copy', () => {
  it('parses', () => {
    expect(() => SkipCopySchema.parse(json)).not.toThrow()
  })
  it('has a name and a caption for every milestone kind', () => {
    for (const k of MILESTONE_KINDS) {
      expect(SKIP.milestones[k].name.length).toBeGreaterThan(0)
      expect(SKIP.milestones[k].caption.length).toBeGreaterThan(0)
    }
    expect(Object.keys(SKIP.milestones).sort()).toEqual([...MILESTONE_KINDS].sort())
  })
  it('names a key for every speed', () => {
    for (const n of SIM_SPEEDS) expect(SKIP.speedKeys[String(n)]).toBeTruthy()
  })
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(fillSkip(SKIP.milestoneLabel, { name: SKIP.milestones.undocking.name, time: '10:12' })).toBe('Skip to undocking · 10:12')
    expect(fillSkip(SKIP.speedTitle, { n: 30, key: '3' })).toBe('Speed 30× (key 3)')
    expect(fillSkip('{a} {b}', { a: 1 })).toBe('1 {b}')
  })
  it('rejects a multi-line line or a missing milestone', () => {
    expect(() => SkipCopySchema.parse({ ...json, group: 'a\nb' })).toThrow()
    expect(() => SkipCopySchema.parse({ ...json, milestones: { ...json.milestones, docking: undefined } })).toThrow()
  })
})
