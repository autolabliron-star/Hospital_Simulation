import { describe, expect, it } from 'vitest'
import loadingJson from './loading.json'
import { LOADING, LoadingSchema } from './loading'

describe('loading.json', () => {
  it('parses against LoadingSchema', () => {
    expect(LoadingSchema.safeParse(loadingJson).success).toBe(true)
    expect(LOADING.title).toBe('The Ideal Hospital')
  })

  it('has the calm progress line the plan asks for and an Enter button label', () => {
    expect(LOADING.status.preparing).toBe('Preparing the hospital…')
    expect(LOADING.enter.label).toBe('Enter')
  })

  it('rejects a missing line, an empty line, a two-line string and an unknown key', () => {
    const copy = () => structuredClone(loadingJson) as unknown as Record<string, Record<string, unknown> | string>
    const missing = copy()
    delete (missing.status as Record<string, unknown>).finishing
    expect(LoadingSchema.safeParse(missing).success).toBe(false)
    const empty = copy()
    empty.title = ''
    expect(LoadingSchema.safeParse(empty).success).toBe(false)
    const two = copy()
    two.tagline = 'one\ntwo'
    expect(LoadingSchema.safeParse(two).success).toBe(false)
    const extra = copy()
    ;(extra.enter as Record<string, unknown>).shout = 'NOW'
    expect(LoadingSchema.safeParse(extra).success).toBe(false)
  })

  it('has no placeholders left in it and no countdown or urgency wording', () => {
    const all = JSON.stringify(LOADING)
    expect(all).not.toMatch(/\{[A-Za-z]+\}/)
    expect(all).not.toMatch(/hurry|last chance|only \d|seconds? left|countdown/i)
  })
})
