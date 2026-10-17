import { describe, expect, it } from 'vitest'
import { MAX_PARTIES_PER_ROOM, VisitBook, WINDOW_SLOTS } from './visitBook'

describe('VisitBook', () => {
  it('sends the next party to the least-visited patient and caps parties per room', () => {
    const b = new VisitBook()
    b.addParty('A1')
    expect(b.leastVisited(['A1', 'A2', 'A3'])).toBe('A2')
    for (let i = 0; i < MAX_PARTIES_PER_ROOM; i++) b.addParty('A2')
    b.addParty('A3')
    expect(b.leastVisited(['A1', 'A2', 'A3'])).toBe('A1')
    b.addParty('A1')
    expect(b.leastVisited(['A2'])).toBeNull()
    b.endParty('A2')
    expect(b.leastVisited(['A2'])).toBe('A2')
  })

  it('hands out the window spots once each and takes them back', () => {
    const b = new VisitBook()
    const got = Array.from({ length: WINDOW_SLOTS + 1 }, (_, i) => b.claimWindow('B4', `v${i}`))
    expect(got).toEqual([0, 1, -1])
    b.releaseWindow('B4', 'v0')
    expect(b.claimWindow('B4', 'v9')).toBe(0)
  })
})
