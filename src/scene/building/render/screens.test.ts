import { describe, expect, it } from 'vitest'
import { BED_STATES } from '@/sim/types'
import { bedsideContent, paintBedsideDefault, paintBedsideScreen, type BedsideInfo } from './screens'

const info = (over: Partial<BedsideInfo> = {}): BedsideInfo => ({ roomId: 'A5', bed: 'occupied', name: 'Grace Adeyemi', day: 4, meal: 'none', ...over })

/** A recording 2D context: every method is a no-op that remembers its name; `measureText` is 0.55 em per character. */
function recorder() {
  const texts: { s: string; font: string }[] = []
  let font = ''
  const calls: string[] = []
  const gradient = { addColorStop: () => undefined }
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * 0.55 * (Number(/(\d+)px/.exec(font)?.[1]) || 16) }),
    fillText: (s: string) => texts.push({ s, font }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  }
  const c = new Proxy(target, {
    get(t, k: string) {
      if (k in t) return t[k]
      return (..._a: unknown[]) => {
        calls.push(k)
      }
    },
    set(t, k: string, v) {
      if (k === 'font') font = String(v)
      t[k] = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { c, texts, calls }
}

describe('bedside screen content', () => {
  it('shows the synthetic name and the day of stay of an occupied bed', () => {
    const c = bedsideContent(info())
    expect(c.title).toBe('Grace Adeyemi')
    expect(c.subtitle).toBe('Day 4 of stay')
    expect(c.header).toBe('Bed A5')
    expect(c.chip).toBeNull()
  })

  it('says "Ready for the next patient" when the bed is ready, and has words for every empty state', () => {
    expect(bedsideContent(info({ bed: 'ready', name: null })).title).toBe('Ready for the next patient')
    expect(bedsideContent(info({ bed: 'needsCleaning', name: null })).subtitle).toBe('Waiting for cleaning')
    expect(bedsideContent(info({ bed: 'cleaning', name: null })).subtitle).toBe('Cleaning in progress')
    for (const bed of ['ready', 'needsCleaning', 'cleaning'] as const) expect(bedsideContent(info({ bed, name: 'Old Name' })).title).not.toContain('Old Name')
  })

  it('tells a reserved bed who is on the way, and a discharge that the patient is going home', () => {
    const r = bedsideContent(info({ bed: 'reserved', name: 'Leo Park' }))
    expect(r.title).toBe('Leo Park')
    expect(r.header).toContain('next patient')
    expect(r.subtitle).toContain('On the way')
    expect(bedsideContent(info({ bed: 'dischargeSigned' })).chip?.text).toBe('Going home today')
    expect(bedsideContent(info({ bed: 'leaving' })).chip?.tone).toBe('blue')
  })

  it('shows the meal state as a chip, and a day of stay never below 1', () => {
    expect(bedsideContent(info({ meal: 'served' })).chip).toEqual({ text: 'Meal served', tone: 'peach' })
    expect(bedsideContent(info({ meal: 'eaten' })).chip?.text).toBe('Meal finished')
    expect(bedsideContent(info({ day: 0 })).subtitle).toBe('Day 1 of stay')
  })

  it('has content for every bed state, with no real-person data (a name is whatever the sim says, never invented here)', () => {
    for (const bed of BED_STATES) {
      const c = bedsideContent(info({ bed, name: null }))
      expect(c.title.length).toBeGreaterThan(0)
      expect(c.title).not.toMatch(/undefined|null/)
    }
  })
})

describe('bedside screen painting', () => {
  it('draws the words of the content, fitting a long name and wrapping a long sentence', () => {
    const a = recorder()
    paintBedsideScreen(a.c, 320, 200, info({ name: 'Maximilian Featherstonehaugh-Ravenscroft' }))
    const title = a.texts.find((t) => t.s.includes('Maximilian'))!
    expect(title).toBeDefined()
    expect(Number(/(\d+)px/.exec(title.font)![1])).toBeLessThan(44) // shrunk to fit
    const b = recorder()
    paintBedsideScreen(b.c, 320, 200, info({ bed: 'ready', name: null }))
    const at = b.texts.findIndex((t) => t.s.startsWith('Ready'))
    expect(at).toBeGreaterThanOrEqual(0)
    expect(b.texts[at].s).not.toBe('Ready for the next patient') // it did not fit one line...
    expect(`${b.texts[at].s} ${b.texts[at + 1].s}`).toBe('Ready for the next patient') // ...so it wrapped onto two
    expect(b.texts.some((t) => t.s === 'Clean and made up')).toBe(true)
  })

  it('draws the static default tile without a living-day view', () => {
    const a = recorder()
    paintBedsideDefault(a.c, 320, 200)
    expect(a.texts.some((t) => t.s === 'Today')).toBe(true)
  })
})
