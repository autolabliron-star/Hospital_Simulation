/**
 * The kiosks' screens as tiles of the W4 atlas, in node with a mock canvas: where each tile sits, that its version changes exactly when its picture would,
 * that the painters draw what the states say (and "Simulated"), that nothing repaints without a version change, and that registering and unregistering
 * leaves the registry as it was.
 */
import { describe, expect, it } from 'vitest'
import { KIOSK_UI } from '@/content/kioskUi'
import { getLayout } from '@/scene/building/layout'
import { TILE } from '@/scene/building/layout/screenTiles'
import { W4_TILE, w4Tiles, type W4Tile } from '@/scene/w4kit/tiles'
import type { HealthKioskPhase, HealthKioskState, VitalsReading } from '@/sim/types'
import type { TriageSim } from '@/ui/kioskView'
import { KIOSKS } from './layout'
import { COLORS, clip, paintKioskScreen, paintTriageScreen } from './screens'
import { kioskTiles, listDisplay, overlayAnchor, registerKioskTiles, type TileSource } from './tiles'

function reading(over: Partial<VitalsReading> = {}): VitalsReading {
  return { id: 'r1', personId: 'p1', personName: 'Test Patient', at: 0, source: 'kiosk', station: 0, sys: null, dia: null, pulse: null, spo2: null, tempC: null, heightCm: null, weightKg: null, bmi: null, bodyFatPct: null, bp: [], partial: true, ...over }
}

function kiosk(index: number, phase: HealthKioskPhase, over: Partial<HealthKioskState> = {}): HealthKioskState {
  const busy = phase !== 'idle'
  return { index, phase, phaseTime: 0, progress: 0.25, kind: busy ? 'full' : null, userId: busy ? 'p1' : null, userName: busy ? 'Test Patient' : null, bpRound: 0, cuff: 0, reading: busy ? reading() : null, assisted: false, sessionsToday: 0, version: 1, ...over }
}

/** A canvas context that records every call and every text it was asked to draw. */
function mockCtx() {
  const texts: string[] = []
  const calls: string[] = []
  const fills: string[] = []
  /** The fill colour each text was drawn in (the last one wins when a string repeats). */
  const textColour = new Map<string, string>()
  const state: Record<string, unknown> = { font: '', fillStyle: '', strokeStyle: '', textAlign: 'left', lineWidth: 1 }
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      return (...args: unknown[]) => {
        calls.push(prop)
        if (prop === 'fillText') {
          texts.push(String(args[0]))
          textColour.set(String(args[0]), String(target.fillStyle))
        }
        if (prop === 'fillRect' || prop === 'fill') fills.push(String(target.fillStyle))
      }
    },
    set(target, prop: string, value) {
      target[prop] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, texts, calls, fills, textColour }
}

function source(kiosks: HealthKioskState[], triage: TriageSim | null = null, generation = 0): TileSource & { kiosks: () => HealthKioskState[]; gen: { n: number } } {
  const gen = { n: generation }
  return { kiosks: () => kiosks, triage: () => triage, generation: () => gen.n, gen }
}

const layout = getLayout()
const byIndex = (src: TileSource): Map<number, W4Tile> => new Map(kioskTiles(src, layout).map((t) => [t.index, t.tile]))

describe('the tiles', () => {
  it('are kiosk0/kiosk1, bp0/bp1 and triage, at the kiosks and the triage desk', () => {
    const tiles = byIndex(source([kiosk(0, 'idle'), kiosk(1, 'idle')]))
    expect([...tiles.keys()].sort((a, b) => a - b)).toEqual([W4_TILE.kiosk0, W4_TILE.kiosk1, W4_TILE.bp0, W4_TILE.bp1, W4_TILE.triage].sort((a, b) => a - b))
    for (let i = 0; i < 2; i++) {
      const a = KIOSKS[i]
      const t = tiles.get(i === 0 ? W4_TILE.kiosk0 : W4_TILE.kiosk1)!
      expect(t.anchor.at).toEqual(a.screen.at)
      expect(t.anchor.heading).toBeCloseTo(Math.PI, 9)
      expect(t.anchor.w / t.anchor.h).toBeCloseTo(1.6, 2)
      expect(t.anchor.tilt).toBeCloseTo(0.3, 9)
      const bp = tiles.get(i === 0 ? W4_TILE.bp0 : W4_TILE.bp1)!
      expect(bp.anchor.at).toEqual(a.bpScreen.at)
      expect(bp.anchor.w / bp.anchor.h).toBeCloseTo(1.6, 2)
    }
  })

  it('the touchscreen sits 3 mm in front of its bezel, facing the lobby; the picture is inside the tower\'s width', () => {
    const a = KIOSKS[0]
    expect(a.screen.at.z).toBeLessThan(a.frontZ)
    expect(a.screen.at.z).toBeGreaterThan(a.frontZ - 0.05)
    expect(Math.abs(a.screen.at.x - a.tower.x)).toBeLessThan(1e-9)
    expect(a.screen.w).toBeLessThan(0.56)
  })

  it('the triage tile is 2 mm in front of the triage desk\'s static list display, on its normal, the same way up', () => {
    const list = listDisplay(layout)!
    expect(list).not.toBeNull()
    expect(list.tile).toBe(TILE.list)
    const a = overlayAnchor(list)
    const lift = Math.hypot(a.at.x - list.position[0], a.at.y - list.position[1], a.at.z - list.position[2])
    expect(lift).toBeCloseTo(0.002, 9)
    expect(a.heading).toBeCloseTo(list.rotationY, 9)
    expect(a.tilt).toBeCloseTo(-(list.rotationX ?? 0), 9)
    expect(a.w).toBeCloseTo(list.size[0], 9) // it covers the old picture completely
    expect(a.h).toBeCloseTo(list.size[1], 9)
    const tile = byIndex(source([kiosk(0, 'idle'), kiosk(1, 'idle')])).get(W4_TILE.triage)!
    expect(tile.anchor).toEqual(a)
  })

  it('without a list display there is no triage tile', () => {
    expect(kioskTiles(source([kiosk(0, 'idle'), kiosk(1, 'idle')]), { prims: [] }).some((t) => t.index === W4_TILE.triage)).toBe(false)
  })
})

describe('versions', () => {
  it('a kiosk tile\'s version follows the state\'s own version, per kiosk; the BP tile also follows the cuff; a Jump changes them all', () => {
    const ks = [kiosk(0, 'bp', { version: 4 }), kiosk(1, 'idle', { version: 9 })]
    const src = source(ks)
    const tiles = byIndex(src)
    const k0 = tiles.get(W4_TILE.kiosk0)!
    const k1 = tiles.get(W4_TILE.kiosk1)!
    const bp0 = tiles.get(W4_TILE.bp0)!
    const v0 = k0.version()
    expect(k0.version()).toBe(v0) // stable while nothing changes
    expect(k1.version()).not.toBe(v0)
    const b0 = bp0.version()
    ks[0].cuff = 0.5
    expect(bp0.version()).not.toBe(b0)
    expect(k0.version()).toBe(v0) // the touchscreen does not repaint for the cuff
    ks[0].version = 5
    expect(k0.version()).not.toBe(v0)
    const before = k0.version()
    src.gen.n = 1
    expect(k0.version()).not.toBe(before)
  })

  it('repaints only when the version changed: a 4 Hz poll over a minute of a steady session paints once', () => {
    const ks = [kiosk(0, 'height', { version: 1 }), kiosk(1, 'idle')]
    const tiles = byIndex(source(ks))
    let painted = 0
    const seen = new Map<number, number>()
    // the atlas layer's loop, as the brief describes it: check the versions, repaint the tiles that changed
    const poll = (): void => {
      for (const [index, tile] of tiles) {
        const v = tile.version()
        if (seen.get(index) === v) continue
        seen.set(index, v)
        painted++
        tile.paint(mockCtx().ctx, 320, 200)
      }
    }
    for (let i = 0; i < 240; i++) poll()
    expect(painted).toBe(5) // kiosk0, kiosk1, bp0, bp1 and the triage list (empty: no triage source), each once
    ks[0].version++
    ks[0].phase = 'weight'
    for (let i = 0; i < 10; i++) poll()
    expect(painted).toBe(7) // kiosk0 and bp0 again (the state's version moved), nothing else
  })

  it('register and unregister leave the registry as it was', () => {
    const before = new Map(w4Tiles())
    const undo = registerKioskTiles(source([kiosk(0, 'idle'), kiosk(1, 'idle')]), layout)
    for (const i of [W4_TILE.kiosk0, W4_TILE.kiosk1, W4_TILE.bp0, W4_TILE.bp1, W4_TILE.triage]) expect(w4Tiles().has(i), String(i)).toBe(true)
    undo()
    for (const i of [W4_TILE.kiosk0, W4_TILE.kiosk1, W4_TILE.bp0, W4_TILE.bp1, W4_TILE.triage]) expect(w4Tiles().has(i), String(i)).toBe(before.has(i))
  })
})

describe('the touchscreen painter', () => {
  it('draws a free kiosk with a welcome, no values and "Simulated"', () => {
    const m = mockCtx()
    byIndex(source([kiosk(0, 'idle'), kiosk(1, 'idle')])).get(W4_TILE.kiosk0)!.paint(m.ctx, 320, 200)
    expect(m.texts).toContain(KIOSK_UI.steps.idle.title)
    expect(m.texts).toContain(KIOSK_UI.steps.idle.hint)
    expect(m.texts).toContain(KIOSK_UI.footer)
    expect(m.texts).not.toContain(KIOSK_UI.fields.height.label)
    expect(m.calls).toContain('save')
    expect(m.calls).toContain('restore')
  })

  it('draws the step, the values as they fill in, a dash for the rest, the user and "Simulated"', () => {
    const m = mockCtx()
    const r = reading({ heightCm: 172.4, weightKg: 71.43, bmi: 24.1, bodyFatPct: 22.4, spo2: 98, pulse: 72, bp: [[124, 79]], sys: 124, dia: 79 })
    const k = kiosk(0, 'temp', { reading: r, progress: 0.6 })
    byIndex(source([k, kiosk(1, 'idle')])).get(W4_TILE.kiosk0)!.paint(m.ctx, 320, 200)
    expect(m.texts).toContain('Temperature')
    expect(m.texts).toContain('172')
    expect(m.texts).toContain('71.4')
    expect(m.texts).toContain('24.1')
    expect(m.texts).toContain('22')
    expect(m.texts).toContain('98')
    expect(m.texts).toContain('72')
    expect(m.texts).toContain('124/79')
    expect(m.texts).toContain(KIOSK_UI.pending) // the temperature is not in yet
    expect(m.texts).toContain('Test Patient')
    expect(m.texts).toContain('Simulated')
    expect(m.texts.some((t) => /\bkg\b/.test(t))).toBe(true)
  })

  it('styles a value outside its usual range amber and a pending one dim, never with words', () => {
    const m = mockCtx()
    const r = reading({ spo2: 90, heightCm: 170 })
    paintKioskScreen(m.ctx, 320, 200, { idle: false, title: 'x', hint: 'y', progress: 0.5, userName: null, assisted: false, rows: [], dots: [], footer: 'Simulated' })
    byIndex(source([kiosk(0, 'spo2', { reading: r }), kiosk(1, 'idle')])).get(W4_TILE.kiosk0)!.paint(m.ctx, 320, 200)
    expect(m.textColour.get('90')).toBe(COLORS.amber) // SpO2 90: outside its usual range
    expect(m.textColour.get('170')).toBe(COLORS.white) // height: no range, styled as a value
    expect(m.textColour.get(KIOSK_UI.pending)).toBe(COLORS.faint) // not measured yet
    expect(m.texts.join(' ')).not.toMatch(/\b(low|high|normal|abnormal)\b/i)
  })

  it('scales to the canvas it is given and restores the context', () => {
    const m = mockCtx()
    byIndex(source([kiosk(0, 'weight'), kiosk(1, 'idle')])).get(W4_TILE.kiosk0)!.paint(m.ctx, 640, 400)
    expect(m.calls.filter((c) => c === 'scale').length).toBe(1)
    expect(m.calls.filter((c) => c === 'save').length).toBe(m.calls.filter((c) => c === 'restore').length)
  })
})

describe('the blood-pressure painter', () => {
  it('shows SYS, DIA and the pulse of the last cuff reading, with the cuff bar and "Simulated"', () => {
    const m = mockCtx()
    const r = reading({ bp: [[128, 82]], sys: 128, dia: 82, pulse: 71 })
    byIndex(source([kiosk(0, 'bpRest', { reading: r, bpRound: 1 }), kiosk(1, 'idle')])).get(W4_TILE.bp0)!.paint(m.ctx, 320, 200)
    expect(m.texts).toContain(KIOSK_UI.bpScreen.sys)
    expect(m.texts).toContain(KIOSK_UI.bpScreen.dia)
    expect(m.texts).toContain('128')
    expect(m.texts).toContain('82')
    expect(m.texts).toContain('71')
    expect(m.texts).toContain('Reading 1')
    expect(m.texts).toContain('Simulated')
  })

  it('while the cuff works the numbers are dashes and the bar follows the pressure', () => {
    const half = mockCtx()
    const full = mockCtx()
    const mk = (cuff: number) => byIndex(source([kiosk(0, 'bp', { cuff, bpRound: 1 }), kiosk(1, 'idle')])).get(W4_TILE.bp0)!
    mk(0.5).paint(half.ctx, 320, 200)
    mk(1).paint(full.ctx, 320, 200)
    expect(half.texts.filter((t) => t === KIOSK_UI.pending).length).toBeGreaterThanOrEqual(3)
    expect(full.fills).toContain(COLORS.amber)
  })

  it('a free unit says so', () => {
    const m = mockCtx()
    byIndex(source([kiosk(0, 'idle'), kiosk(1, 'idle')])).get(W4_TILE.bp0)!.paint(m.ctx, 320, 200)
    expect(m.texts).toContain(KIOSK_UI.bpScreen.freeHint)
    expect(m.texts).toContain('Simulated')
  })
})

describe('the triage painter', () => {
  const sim = (waiting: { id: string; name: string; reading: VitalsReading | null }[]): TriageSim => ({
    world: { er: { cases: new Map(waiting.map((w, i) => [w.id, { id: w.id, name: w.name, state: 'waitingTriage', arrivedAt: i }])) } },
    vitals: { readingsFor: (id) => waiting.filter((w) => w.id === id && w.reading).map((w) => w.reading!) },
  })

  it('lists the waiting patients with a kiosk reading and says "Simulated"', () => {
    const m = mockCtx()
    const s = sim([
      { id: 'er-1', name: 'Ana Reyes', reading: reading({ personId: 'er-1', sys: 152, dia: 94, spo2: 96, tempC: 36.9, bp: [[152, 94]] }) },
      { id: 'er-2', name: 'Ben Okafor', reading: null },
    ])
    byIndex(source([kiosk(0, 'idle'), kiosk(1, 'idle')], s)).get(W4_TILE.triage)!.paint(m.ctx, 320, 200)
    expect(m.texts).toContain(KIOSK_UI.triageScreen.title)
    expect(m.texts).toContain('Ana Reyes')
    expect(m.texts).not.toContain('Ben Okafor')
    expect(m.texts).toContain('152/94')
    expect(m.texts).toContain('96%')
    expect(m.texts).toContain('36.9')
    expect(m.textColour.get('152/94')).toBe(COLORS.amber) // the systolic is outside its usual range
    expect(m.textColour.get('96%')).toBe(COLORS.white)
    expect(m.texts.some((t) => /Simulated/.test(t))).toBe(true)
  })

  it('says nobody is waiting when nobody is, and counts the ones that do not fit', () => {
    const m = mockCtx()
    byIndex(source([kiosk(0, 'idle'), kiosk(1, 'idle')], sim([]))).get(W4_TILE.triage)!.paint(m.ctx, 320, 200)
    expect(m.texts).toContain(KIOSK_UI.triageScreen.empty)
    const many = mockCtx()
    const waiting = Array.from({ length: 8 }, (_, i) => ({ id: `er-${i}`, name: `Patient Number ${i}`, reading: reading({ personId: `er-${i}`, sys: 120, dia: 80, spo2: 98, tempC: 36.6, bp: [[120, 80]] }) }))
    byIndex(source([kiosk(0, 'idle'), kiosk(1, 'idle')], sim(waiting))).get(W4_TILE.triage)!.paint(many.ctx, 320, 200)
    expect(many.texts).toContain('and 3 more')
  })

  it('its version changes when somebody waiting gets a reading', () => {
    const waiting = [{ id: 'er-1', name: 'Ana Reyes', reading: null as VitalsReading | null }]
    const s = sim(waiting)
    const tile = byIndex(source([kiosk(0, 'idle'), kiosk(1, 'idle')], s)).get(W4_TILE.triage)!
    const v = tile.version()
    expect(tile.version()).toBe(v)
    waiting[0].reading = reading({ personId: 'er-1', sys: 120, dia: 80, bp: [[120, 80]] })
    expect(tile.version()).not.toBe(v)
  })

  it('works on a bare tile with no sim', () => {
    const m = mockCtx()
    byIndex(source([kiosk(0, 'idle'), kiosk(1, 'idle')], null)).get(W4_TILE.triage)!.paint(m.ctx, 320, 200)
    expect(m.texts).toContain(KIOSK_UI.triageScreen.empty)
    paintTriageScreen(mockCtx().ctx, 320, 200, [], 0)
    expect(clip('A very long patient name indeed', 10)).toHaveLength(10)
    expect(clip('Short', 10)).toBe('Short')
  })
})
