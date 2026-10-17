import { afterEach, describe, expect, it, vi } from 'vitest'
import { patientInRoom } from '@/content/catalogue'
import { CONFIG } from '@/sim/config'
import { EventLog } from '@/sim/events'
import { LivingDay } from '@/sim/life'
import { ROOMS } from '@/sim/places'
import { BED_STATES, type BedState } from '@/sim/types'
import { BED_COLOR } from '@/ui/bedStyle'
import { DayStatsTracker, type DayStatsSource } from '@/ui/dayStats'
import { bedsPanelModel, bedsSignature } from './bedsPanelModel'
import { BEDS_REGION, COMMAND_WALL_SIZE, paintBedsPanel, tickBedsWall } from './commandWall'

const at = (hour: number): number => (hour - CONFIG.sim.startHour) * 3600

interface Fixture extends DayStatsSource {
  t: number
  life: LivingDay
  log: EventLog
}

function fixture(startHour: number = CONFIG.sim.startHour): Fixture {
  const life = new LivingDay(
    startHour,
    ROOMS.map((r) => ({ roomId: r.id, patientId: patientInRoom(r.id).id, patientName: patientInRoom(r.id).name })),
  )
  return { t: at(startHour), life, log: new EventLog() }
}

const stats = (f: Fixture) => new DayStatsTracker().read(f)

describe('Beds panel model', () => {
  it('has 16 tiles, ward A on the top row and ward B below, in room order', () => {
    const f = fixture()
    const m = bedsPanelModel(f.life, f.t, stats(f))
    expect(m.tiles).toHaveLength(16)
    expect(m.tiles.map((t) => t.roomId)).toEqual(ROOMS.map((r) => r.id))
    for (const t of m.tiles) {
      expect(t.row).toBe(t.ward === 'A' ? 0 : 1)
      expect(t.col).toBe(Number(t.roomId.slice(1)) - 1)
    }
  })

  it('colours every tile by its bed state (the brief: white, soft blue, amber, green, teal)', () => {
    const f = fixture()
    BED_STATES.forEach((state, i) => {
      f.life.rooms.get(ROOMS[i].id)!.bed = state
    })
    const m = bedsPanelModel(f.life, f.t, stats(f))
    BED_STATES.forEach((state, i) => {
      expect(m.tiles[i].state).toBe(state)
      expect(m.tiles[i].fill).toBe(BED_COLOR[state])
    })
    const fill = (s: BedState) => BED_COLOR[s]
    expect(fill('dischargeSigned')).toBe(fill('leaving'))
    expect(fill('needsCleaning')).toBe(fill('cleaning'))
    expect(new Set(BED_STATES.map(fill)).size).toBe(5)
    // in-progress states are striped, because the wall cannot pulse
    expect(m.tiles.filter((t) => t.stripes).map((t) => t.state)).toEqual(['leaving', 'cleaning'])
  })

  it('shows the boarding timer on a reserved bed, and "on the way" without one', () => {
    const f = fixture()
    f.t = at(10)
    const a = f.life.rooms.get('A1')!
    a.bed = 'reserved'
    a.boarding = { bayId: 'er:bay2', since: f.t - 14.5 * 60 }
    f.life.rooms.get('A2')!.bed = 'reserved'
    const m = bedsPanelModel(f.life, f.t, stats(f))
    expect(m.tiles[0].note).toBe('ER 14 min')
    expect(m.tiles[1].note).toBe('On the way')
    expect(m.tiles[2].note).toBeNull()
  })

  it("carries today's figures, and labels the prediction as simulated", () => {
    const f = fixture()
    f.log.push(at(10.4), 'wentHome', 'x', { subjectId: 'pt-A1' })
    f.log.push(at(10.9), 'admittedToWard', 'y', { subjectId: 'er-5', roomId: 'A1' })
    const m = bedsPanelModel(f.life, f.t, stats(f))
    const [discharges, admissions, boarding, predicted] = m.stats
    expect(discharges.value).toBe('1')
    expect(discharges.detail).toBe('1 before noon')
    expect(admissions.value).toBe('1')
    expect(boarding.value).toBe('none')
    expect(boarding.detail).toBeNull()
    expect(predicted.label).toBe('Predicted discharges today')
    expect(predicted.tag).toBe('simulated')
    expect(predicted.detail).toMatch(/planned, \d+ to come/)
  })

  it('lists the boarding count and the longest wait', () => {
    const f = fixture()
    f.t = at(10)
    const a = f.life.rooms.get('A1')!
    a.bed = 'reserved'
    a.boarding = { bayId: 'er:bay2', since: f.t - 21 * 60 }
    const boarding = bedsPanelModel(f.life, f.t, stats(f)).stats[2]
    expect(boarding.value).toBe('1')
    expect(boarding.detail).toBe('longest 21 min')
  })
})

describe('Beds panel redraw signature', () => {
  it('changes when a room version, a state, a boarding minute or a figure changes, and not otherwise', () => {
    const f = fixture()
    const base = bedsSignature(f.life, f.t, stats(f))
    expect(bedsSignature(f.life, f.t, stats(f))).toBe(base)

    f.life.rooms.get('A1')!.version++
    const v1 = bedsSignature(f.life, f.t, stats(f))
    expect(v1).not.toBe(base)

    f.life.rooms.get('A2')!.bed = 'ready'
    const v2 = bedsSignature(f.life, f.t, stats(f))
    expect(v2).not.toBe(v1)

    const r = f.life.rooms.get('A3')!
    r.bed = 'reserved'
    r.boarding = { bayId: 'er:bay1', since: f.t }
    const v3 = bedsSignature(f.life, f.t, stats(f))
    expect(bedsSignature(f.life, f.t + 30, stats(f))).toBe(v3) // the same minute
    expect(bedsSignature(f.life, f.t + 61, stats(f))).not.toBe(v3) // the timer ticked over

    f.log.push(at(10), 'wentHome', 'x', { subjectId: 'pt-A1' })
    expect(bedsSignature(f.life, f.t, stats(f))).not.toBe(v3)
  })
})

// ---------------------------------------------------------------------------------------------
// The painter, against a recording context
// ---------------------------------------------------------------------------------------------

interface Recorded {
  texts: { s: string; x: number; y: number }[]
  fills: number
  ctx: CanvasRenderingContext2D
}

function recordingContext(): Recorded {
  const rec: Recorded = { texts: [], fills: 0, ctx: null as unknown as CanvasRenderingContext2D }
  const noop = () => undefined
  const gradient = { addColorStop: noop }
  const target: Record<string, unknown> = {
    fillText: (s: string, x: number, y: number) => rec.texts.push({ s, x, y }),
    measureText: (s: string) => ({ width: s.length * 7 }),
    createLinearGradient: () => gradient,
    fill: () => {
      rec.fills++
    },
  }
  rec.ctx = new Proxy(target, {
    get: (t, k: string) => (k in t ? t[k] : noop),
    set: (t, k: string, v) => {
      t[k] = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return rec
}

describe('Beds panel painter', () => {
  it('keeps the canvas square-pixelled and the panel inside the wall', () => {
    expect(COMMAND_WALL_SIZE.width % 9).toBe(0)
    expect(BEDS_REGION.x + BEDS_REGION.w).toBe(COMMAND_WALL_SIZE.width)
    expect(BEDS_REGION.h).toBe(COMMAND_WALL_SIZE.height)
    expect(BEDS_REGION.x % (COMMAND_WALL_SIZE.width / 9)).toBe(0) // starts on a panel seam
  })

  it('draws the 16 rooms, the title and the figures, all inside its region', () => {
    const f = fixture()
    f.life.rooms.get('B3')!.bed = 'ready'
    const rec = recordingContext()
    paintBedsPanel(rec.ctx, BEDS_REGION, bedsPanelModel(f.life, f.t, stats(f)))
    const words = rec.texts.map((t) => t.s)
    for (const r of ROOMS) expect(words).toContain(r.id)
    expect(words).toContain('BEDS')
    expect(words).toContain('SIMULATED')
    expect(words).toContain('Ready')
    expect(words.some((w) => w.startsWith('Predicted'))).toBe(true)
    for (const t of rec.texts) {
      expect(t.x, t.s).toBeGreaterThanOrEqual(BEDS_REGION.x)
      expect(t.x, t.s).toBeLessThanOrEqual(BEDS_REGION.x + BEDS_REGION.w)
      expect(t.y, t.s).toBeGreaterThanOrEqual(0)
      expect(t.y, t.s).toBeLessThanOrEqual(BEDS_REGION.h)
    }
  })

  it('paints only the frame before the first figures arrive', () => {
    const rec = recordingContext()
    paintBedsPanel(rec.ctx, BEDS_REGION, null)
    expect(rec.texts.map((t) => t.s)).toEqual(['BEDS', 'SIMULATED'])
  })
})

// ---------------------------------------------------------------------------------------------
// The redraw check: paint on change only, and again after a swap
// ---------------------------------------------------------------------------------------------

describe('tickBedsWall', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubDocument(): { paints: () => number } {
    let paints = 0
    const noop = () => undefined
    const gradient = { addColorStop: noop }
    const ctx = new Proxy(
      { createLinearGradient: () => gradient, measureText: (s: string) => ({ width: s.length * 7 }), fill: () => paints++ } as Record<string, unknown>,
      {
        get: (t, k: string) => (k in t ? t[k] : noop),
        set: (t, k: string, v) => {
          t[k] = v
          return true
        },
      },
    )
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) })
    return { paints: () => paints }
  }

  it('repaints when something changed or the hospital was swapped, and not on a quiet check', () => {
    const { paints } = stubDocument()
    const f = fixture()
    expect(tickBedsWall(f)).toBe(true) // first paint
    const after = paints()
    expect(tickBedsWall(f)).toBe(false) // nothing changed
    expect(tickBedsWall(f)).toBe(false)
    expect(paints()).toBe(after)

    f.life.rooms.get('A4')!.version++
    expect(tickBedsWall(f)).toBe(true)
    expect(tickBedsWall(f)).toBe(false)

    f.log.push(at(10.4), 'wentHome', 'x', { subjectId: 'pt-A1' })
    expect(tickBedsWall(f)).toBe(true) // a figure changed

    // a Jump: a new Simulation object whose rooms start again at version 0, even if the numbers happen to match
    const swapped = fixture()
    expect(tickBedsWall(swapped)).toBe(true)
    expect(tickBedsWall(swapped)).toBe(false)
  })
})
