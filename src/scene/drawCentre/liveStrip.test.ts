import { describe, expect, it } from 'vitest'
import { DRAW_UI } from '@/content/drawUi'
import { createRecorder, mockSurface } from '@/scene/imaging/images/mockCanvas'
import type { Ctx2D, Env } from '@/scene/imaging/images/ctx'
import type { DrawPhase, DrawStationState } from '@/sim/types'
import { BUSY_MS, CELLS, CELL_W, LIVE_MS, LiveStrip, STRIP_H, STRIP_W, cellMode, cellRefresh, hash, isLivePhase, paintCell, paintReadyCell, seedOf, veinsFor } from './liveStrip'
import { inDrawCentre, playerInDrawCentre } from './presence'

const PHASES: DrawPhase[] = ['idle', 'calling', 'cardScan', 'armIn', 'cuff', 'sanitise', 'veinScan', 'needleIn', 'filling', 'needleOut', 'bandage', 'release', 'awaitPorter', 'armMoved', 'fallbackToNurse', 'reset']

function station(i: number, o: Partial<DrawStationState> = {}): DrawStationState {
  return {
    index: i,
    phase: 'idle',
    phaseTime: 0,
    progress: 0,
    ticket: null,
    patientId: null,
    patientName: null,
    tubes: [],
    tube: 0,
    tubeFill: 0,
    inversions: 0,
    cuff: 0,
    needle: 0,
    scan: 0,
    trayHere: false,
    attendantId: null,
    light: 'white',
    attempts: 0,
    drawsToday: 0,
    robotDrawsToday: 0,
    nurseDrawsToday: 0,
    version: 0,
    ...o,
  }
}

/** A recording environment that also keeps every string drawn. */
function logEnv(): { env: Env; rec: ReturnType<typeof createRecorder>; texts: string[]; size: { w: number; h: number } } {
  const rec = createRecorder()
  const texts: string[] = []
  const size = { w: 0, h: 0 }
  const env: Env = {
    supportsFilter: true,
    createSurface: (w, h) => {
      size.w = w
      size.h = h
      const s = mockSurface(w, h, rec)
      const ctx = s.ctx as unknown as Record<string, unknown>
      ctx.fillText = (t: string) => {
        texts.push(t)
        rec.calls.set('fillText', (rec.calls.get('fillText') ?? 0) + 1)
      }
      return s
    },
  }
  return { env, rec, texts, size }
}

describe('the refresh rules', () => {
  it('classes every phase: idle and reset are idle, scanning/inserting/filling are live, the rest busy', () => {
    for (const p of PHASES) {
      const m = cellMode(p)
      if (p === 'idle' || p === 'reset') expect(m, p).toBe('idle')
      else if (p === 'veinScan' || p === 'needleIn' || p === 'filling' || p === 'needleOut') expect(m, p).toBe('live')
      else expect(m, p).toBe('busy')
      expect(isLivePhase(p), p).toBe(m === 'live')
    }
  })

  it('10 Hz for a live robot while the room is focused or you are in it, 2 Hz while busy elsewhere, once for an idle robot', () => {
    expect(LIVE_MS).toBe(100)
    expect(BUSY_MS).toBe(500)
    for (const p of PHASES) {
      const mode = cellMode(p)
      expect(cellRefresh(p, true), `${p} in the room`).toBe(mode === 'idle' ? null : mode === 'live' ? 100 : 500)
      expect(cellRefresh(p, false), `${p} elsewhere`).toBe(mode === 'idle' ? null : 500)
    }
  })

  it('is one canvas of 768 x 160 with three cells', () => {
    const { env, size } = logEnv()
    new LiveStrip(env)
    expect(size).toEqual({ w: 768, h: 160 })
    expect(STRIP_W).toBe(768)
    expect(STRIP_H).toBe(160)
    expect(CELLS).toBe(3)
    expect(CELL_W).toBe(256)
  })
})

describe('the strip over time', () => {
  /** Run the strip for `seconds` at 60 fps and count the cell paints. */
  function paints(states: (t: number) => DrawStationState[], inRoom: boolean, seconds: number): number {
    const { env } = logEnv()
    const strip = new LiveStrip(env)
    let n = 0
    for (let f = 0; f < seconds * 60; f++) {
      const t = f / 60
      n += strip.update(states(t), inRoom, t * 1000, t)
    }
    return n
  }

  const idle = (): DrawStationState[] => [station(0), station(1), station(2)]
  const scanning = (): DrawStationState[] => [station(0), station(1, { phase: 'veinScan', ticket: 'P007', patientId: 'p7', scan: 0.4 }), station(2)]

  it('paints nothing for an idle centre, however long it runs (the static Ready frames are drawn once, at construction)', () => {
    expect(paints(idle, true, 20)).toBe(0)
    expect(paints(idle, false, 20)).toBe(0)
  })

  it('repaints a live robot at 10 Hz in the room: about 100 paints in 10 s (and only that robot)', () => {
    const n = paints(scanning, true, 10)
    expect(n).toBeGreaterThanOrEqual(95)
    expect(n).toBeLessThanOrEqual(105)
  })

  it('repaints a busy or distant robot at 2 Hz: about 20 paints in 10 s', () => {
    const elsewhere = paints(scanning, false, 10)
    expect(elsewhere).toBeGreaterThanOrEqual(18)
    expect(elsewhere).toBeLessThanOrEqual(22)
    const cuffing = (): DrawStationState[] => [station(0, { phase: 'cuff', ticket: 'P001' }), station(1), station(2)]
    const busyInRoom = paints(cuffing, true, 10)
    expect(busyInRoom).toBeGreaterThanOrEqual(18)
    expect(busyInRoom).toBeLessThanOrEqual(22)
  })

  it('scales with the number of live robots (three scanning in the room: about 300 paints in 10 s) and never more than one per cell per 100 ms', () => {
    const all = (): DrawStationState[] => [0, 1, 2].map((i) => station(i, { phase: 'filling', ticket: `P00${i}`, tubes: ['serum'], tubeFill: 0.3 }))
    const n = paints(all, true, 10)
    expect(n).toBeGreaterThanOrEqual(290)
    expect(n).toBeLessThanOrEqual(315)
  })

  it('draws the Ready frame once when a robot goes back to idle, then stops', () => {
    const { env } = logEnv()
    const strip = new LiveStrip(env)
    let n = 0
    for (let f = 0; f < 60 * 5; f++) {
      const t = f / 60
      // robot 1 scans for the first 2 s, then is free
      const st = [station(0), t < 2 ? station(1, { phase: 'veinScan', ticket: 'P007' }) : station(1), station(2)]
      n += strip.update(st, true, t * 1000, t)
    }
    // 2 s of live (20 paints, +1 for the first frame's phase change) and exactly one Ready frame after it
    expect(n).toBeGreaterThanOrEqual(20)
    expect(n).toBeLessThanOrEqual(23)
    const before = strip.paints
    for (let f = 0; f < 600; f++) strip.update([station(0), station(1), station(2)], true, 10000 + f * 16, 10 + f / 60)
    expect(strip.paints).toBe(before)
  })

  it('tells the texture to upload after a paint, and not otherwise', () => {
    const { env } = logEnv()
    const strip = new LiveStrip(env)
    let uploads = 0
    strip.onDraw = () => uploads++
    strip.update(idle(), true, 0, 0)
    expect(uploads).toBe(0)
    strip.update(scanning(), true, 100, 0.1)
    expect(uploads).toBe(1)
    strip.update(scanning(), true, 120, 0.12) // not due yet
    expect(uploads).toBe(1)
    strip.update(scanning(), true, 210, 0.21)
    expect(uploads).toBe(2)
  })
})

describe('the painting', () => {
  it('draws every phase without error, with the robot number and the phase words from the content', () => {
    for (const p of PHASES) {
      const { env, texts } = logEnv()
      const s = env.createSurface(STRIP_W, STRIP_H)
      const log: string[] = []
      ;(s.ctx as unknown as Record<string, unknown>).fillText = (t: string) => log.push(t)
      paintCell(s.ctx, 1, station(1, { phase: p, ticket: 'P007', patientId: 'p7', tubes: ['citrate', 'serum'], tube: 1, tubeFill: 0.5, needle: 0.5, scan: 0.5, light: 'teal' }), 3.2)
      expect(log, p).toContain('ROBOT 2')
      expect(log.some((t) => t.length > 3), p).toBe(true)
      expect(texts.length).toBe(0)
    }
  })

  it('draws a Ready frame with the word and the disclaimer', () => {
    const { env } = logEnv()
    const s = env.createSurface(STRIP_W, STRIP_H)
    const log: string[] = []
    ;(s.ctx as unknown as Record<string, unknown>).fillText = (t: string) => log.push(t)
    paintReadyCell(s.ctx as Ctx2D, 0)
    expect(log).toContain(DRAW_UI.strip.ready.toUpperCase())
    expect(log).toContain(DRAW_UI.strip.simulated)
    expect(log).toContain('ROBOT 1')
  })

  it('shows the NIR vein map, an ultrasound inset and a progress bar in each live cell (three panels, labelled)', () => {
    const { env } = logEnv()
    const s = env.createSurface(STRIP_W, STRIP_H)
    const log: string[] = []
    ;(s.ctx as unknown as Record<string, unknown>).fillText = (t: string) => log.push(t)
    paintCell(s.ctx, 2, station(2, { phase: 'filling', ticket: 'V004', patientId: 'p', tubes: ['citrate', 'serum', 'EDTA'], tube: 1, tubeFill: 0.4, needle: 1 }), 1)
    expect(log).toContain(DRAW_UI.strip.nir)
    expect(log).toContain(DRAW_UI.strip.us)
    expect(log).toContain('Tube 2 of 3')
    expect(log).toContain('V004')
  })

  it('gives the same patient the same veins, different patients different ones', () => {
    expect(veinsFor(seedOf('p7'))).toEqual(veinsFor(seedOf('p7')))
    expect(veinsFor(seedOf('p7'))).not.toEqual(veinsFor(seedOf('p8')))
    expect(hash(5, 1, 2)).toBe(hash(5, 1, 2))
    expect(hash(5, 1, 2)).not.toBe(hash(5, 2, 1))
    for (let i = 0; i < 50; i++) {
      const v = veinsFor(seedOf(`patient-${i}`))
      expect(v.tx).toBeGreaterThan(0.5)
      expect(v.tx).toBeLessThan(0.9)
      expect(v.ty).toBeGreaterThan(0.1)
      expect(v.ty).toBeLessThan(0.9)
    }
  })

  it('stays cheap: a live cell is a few dozen canvas calls, not hundreds', () => {
    const rec = createRecorder()
    const surface = mockSurface(STRIP_W, STRIP_H, rec)
    paintCell(surface.ctx, 0, station(0, { phase: 'needleIn', ticket: 'P001', patientId: 'p', needle: 0.5 }), 1)
    expect(rec.total()).toBeLessThan(180)
  })
})

describe('who is in the room', () => {
  it('is true for the focused room and for you standing inside the walls, false otherwise', () => {
    expect(inDrawCentre('diagnostics', null)).toBe(true)
    expect(inDrawCentre(null, { x: -25, z: 7 })).toBe(true)
    expect(inDrawCentre(null, { x: -25, z: 1 })).toBe(false) // the hall
    expect(inDrawCentre('lobby', { x: -50, z: 0 })).toBe(false)
    expect(inDrawCentre(null, null)).toBe(false)
    expect(playerInDrawCentre({ x: -28.2, z: 7 })).toBe(false)
    expect(playerInDrawCentre({ x: -22.1, z: 11.9 })).toBe(true)
  })
})
