import { describe, expect, it } from 'vitest'
import { DAY_MOMENTS } from '@/content/day'
import { CONFIG } from '@/sim/config'
import { buildJumpItems, clockHourOf, dayHour, startIndex } from './jumpModel'

describe('jump menu model', () => {
  it('lists every moment of the day, with its time, label and caption from content', () => {
    const items = buildJumpItems(7.5)
    expect(items.map((i) => i.hour)).toEqual([...CONFIG.day.moments])
    expect(items.map((i) => i.label)).toEqual(DAY_MOMENTS.map((m) => m.label))
    expect(items.map((i) => i.caption)).toEqual(DAY_MOMENTS.map((m) => m.caption))
    expect(items[0].time).toBe('07:00')
    expect(items[1].time).toBe('07:45')
    expect(items.at(-1)?.time).toBe('22:30')
  })

  it('marks the moment the clock is in, and the ones already over', () => {
    const at = (h: number) => buildJumpItems(h)
    // the default start, 07:30, is inside the 07:00 handover
    expect(at(7.5).findIndex((i) => i.isNow)).toBe(0)
    expect(at(7.75).findIndex((i) => i.isNow)).toBe(1)
    const noon = at(12)
    expect(noon.find((i) => i.isNow)?.label).toBe(DAY_MOMENTS[5].label)
    expect(noon.filter((i) => i.isPast).map((i) => i.hour)).toEqual([7.0, 7.75, 8.75, 9.0, 10.5])
    expect(at(14.2).find((i) => i.isNow)?.hour).toBe(12.0)
    expect(at(18).filter((i) => i.isNow)).toHaveLength(1)
  })

  it('keeps the night moment current after midnight, and before the day starts', () => {
    expect(buildJumpItems(0.5).find((i) => i.isNow)?.hour).toBe(22.5)
    expect(buildJumpItems(5).find((i) => i.isNow)?.hour).toBe(22.5)
    expect(dayHour(0.5)).toBe(24.5)
    expect(dayHour(7)).toBe(7)
  })

  it('has no current moment between the start of the day and the first moment', () => {
    const items = buildJumpItems(6.6)
    expect(items.some((i) => i.isNow)).toBe(false)
    expect(startIndex(items)).toBe(0)
  })

  it('starts the keyboard on the current moment', () => {
    expect(startIndex(buildJumpItems(12))).toBe(5)
  })

  it('reads the HUD clock text', () => {
    expect(clockHourOf('07:45')).toBe(7.75)
    expect(clockHourOf('22:30')).toBe(22.5)
    expect(clockHourOf('soon')).toBeNull()
  })
})
