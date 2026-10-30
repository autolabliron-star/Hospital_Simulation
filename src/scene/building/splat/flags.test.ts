import { describe, expect, it } from 'vitest'
import { parseSplatFlag, splatSwap } from './flags'

describe('the splat pilot flag', () => {
  it('is off unless ?splat names a zone with a splat', () => {
    expect(parseSplatFlag('')).toBeNull()
    expect(parseSplatFlag('?probe=1')).toBeNull()
    expect(parseSplatFlag('?splat=lobby')).toBe('lobby')
    expect(parseSplatFlag('?probe=1&splat=lobby')).toBe('lobby')
    expect(parseSplatFlag('?splat=er')).toBeNull()
    expect(parseSplatFlag('?splat=')).toBeNull()
  })

  it('starts with no zone swapped', () => {
    expect(splatSwap).toEqual({ zone: null, shown: false })
  })
})
