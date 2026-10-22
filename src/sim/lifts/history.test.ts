/** F-17: the lift bank keeps only the latest trips (each holds references to its people), and the totals survive the trimming. */
import { describe, expect, it } from 'vitest'
import { HISTORY_CAP } from './index'
import { MiniHospital } from './testkit'

describe('the lift trip history', () => {
  it('is capped, keeps the newest trips, and still counts every served trip and the longest wait', () => {
    const h = new MiniHospital(1, { crowd: false })
    const total = HISTORY_CAP * 2 + 37
    let longest = 0
    for (let i = 0; i < total; i++) {
      const trip = h.lifts.trip({ ownerId: `g${i}`, shaft: 'A', from: 1, to: 2, ghost: false })
      // finish it by hand: this test is about the bookkeeping, not the ride
      const wait = 5 + (i % 17)
      trip.arrivedAt = trip.requestedAt + wait
      longest = Math.max(longest, wait)
      trip.phase = 'released'
    }
    expect(h.lifts.history.length).toBeLessThanOrEqual(HISTORY_CAP)
    expect(h.lifts.history[h.lifts.history.length - 1].ownerId).toBe(`g${total - 1}`)
    expect(h.lifts.history[0].ownerId).toBe(`g${total - h.lifts.history.length}`)
    expect(h.lifts.served).toBe(total)
    expect(h.lifts.longestWait).toBe(longest)
  })

  it('never drops a trip that has not finished', () => {
    const h = new MiniHospital(2, { crowd: false })
    const first = h.lifts.trip({ ownerId: 'open', shaft: 'A', from: 1, to: 2 })
    for (let i = 0; i < HISTORY_CAP + 20; i++) {
      const t = h.lifts.trip({ ownerId: `x${i}`, shaft: 'B', from: 1, to: 2 })
      t.phase = 'released'
      t.arrivedAt = t.requestedAt + 1
    }
    expect(h.lifts.history[0]).toBe(first)
    expect(h.lifts.history.length).toBeLessThanOrEqual(HISTORY_CAP)
  })
})
