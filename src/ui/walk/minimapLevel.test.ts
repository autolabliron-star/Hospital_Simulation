import { describe, expect, it } from 'vitest'
import type { YourOrderView } from '@/scene/interact/yourOrder'
import { LEVEL2_STRIP, levelOf } from '@/sim/levels'
import { AREAS, LIFTS, areaById } from '@/sim/places'
import { drawMinimap, type MapWorld } from './minimapDraw'
import {
  MAP_BOUNDS,
  MAP_BOUNDS_L2,
  MAP_LABELS,
  arrowAngle,
  fallbackAreas,
  labelBox,
  labelLayout,
  labelsFor,
  mapBounds,
  mapFrame,
  minimapLevel,
  toMapX,
  toMapY,
} from './minimapModel'
import { paintFallback, paintLabels } from './minimapPlan'

const L2_AREAS = AREAS.filter((a) => a.id.startsWith('l2'))
const L2_LABELLED = L2_AREAS.filter((a) => a.mapLabel)

describe('which plan the map shows', () => {
  it('is the plan of the level you stand on: level 1 on the ground floor, level 2 in the strip, level 1 when you are not in the hospital', () => {
    expect(minimapLevel({ x: -60 })).toBe(1)
    expect(minimapLevel({ x: -42 })).toBe(1)
    expect(minimapLevel({ x: 40 })).toBe(1)
    expect(minimapLevel({ x: 69.9 })).toBe(1)
    expect(minimapLevel({ x: 70 })).toBe(2)
    expect(minimapLevel({ x: 98 })).toBe(2)
    expect(minimapLevel(null)).toBe(1)
    expect(minimapLevel(undefined)).toBe(1)
  })

  it('has your own lift lobby on the plan of the level the lift takes you to (the arrival spots are in the right plan)', () => {
    for (const shaft of ['A', 'B'] as const) {
      for (const level of [1, 2] as const) {
        const spot = LIFTS[shaft][level].walkers[0]
        const level_ = minimapLevel(spot)
        expect(level_).toBe(level)
        const f = mapFrame(300, mapBounds(level_))
        expect(toMapX(f, spot.x), `${shaft}${level}`).toBeGreaterThan(0)
        expect(toMapX(f, spot.x), `${shaft}${level}`).toBeLessThan(f.width)
        expect(toMapY(f, spot.z), `${shaft}${level}`).toBeGreaterThan(0)
        expect(toMapY(f, spot.z), `${shaft}${level}`).toBeLessThan(f.height)
      }
    }
  })
})

describe('the level-2 plan', () => {
  it('holds the strip of the sim the suite lies in (x 88..110, z -22..22) with air round it, and is portrait', () => {
    const b = MAP_BOUNDS_L2
    expect(mapBounds(2)).toBe(b)
    expect(mapBounds(1)).toBe(MAP_BOUNDS)
    expect(b.x0).toBeLessThanOrEqual(LEVEL2_STRIP.x0)
    expect(b.x1).toBeGreaterThanOrEqual(LEVEL2_STRIP.x1)
    expect(b.z0).toBeLessThanOrEqual(LEVEL2_STRIP.z0)
    expect(b.z1).toBeGreaterThanOrEqual(LEVEL2_STRIP.z1)
    expect(b.x0).toBeGreaterThanOrEqual(86 - 1e-9)
    expect(b.x1).toBeLessThanOrEqual(112 + 1e-9)
    const f = mapFrame(120, b)
    expect(f.height).toBeGreaterThan(f.width)
    expect(f.scale).toBeCloseTo(120 / 26, 9)
  })

  it('puts every level-2 area on the map and none of them on the level-1 plan', () => {
    const f2 = mapFrame(240, mapBounds(2))
    const f1 = mapFrame(240, mapBounds(1))
    for (const a of L2_AREAS) {
      expect(toMapX(f2, a.rect.x0), a.id).toBeGreaterThanOrEqual(0)
      expect(toMapX(f2, a.rect.x1), a.id).toBeLessThanOrEqual(f2.width)
      expect(toMapY(f2, a.rect.z0), a.id).toBeGreaterThanOrEqual(0)
      expect(toMapY(f2, a.rect.z1), a.id).toBeLessThanOrEqual(f2.height)
      expect(toMapX(f1, a.rect.x0), a.id).toBeGreaterThan(f1.width)
    }
  })

  it('is north up and east right, like the other plan (the player marker moves with sim x and z)', () => {
    const f = mapFrame(240, mapBounds(2))
    expect(toMapY(f, -10)).toBeLessThan(toMapY(f, 10))
    expect(toMapX(f, 100)).toBeGreaterThan(toMapX(f, 95))
  })
})

describe('the level-2 labels', () => {
  it('are in MAP_LABELS, once each, short, on level-2 areas', () => {
    expect(new Set(MAP_LABELS.map((l) => l.area)).size).toBe(MAP_LABELS.length)
    const l2 = labelsFor(2)
    expect(l2.length).toBeGreaterThanOrEqual(L2_LABELLED.length)
    for (const l of l2) {
      expect(levelOf(areaById(l.area).rect.x0), l.area).toBe(2)
      expect(l.text.length, l.area).toBeLessThanOrEqual(9)
    }
    // every level-2 area the map names (and goes to in the Go to menu) has a label
    for (const a of L2_LABELLED) expect(l2.map((l) => l.area), a.id).toContain(a.id)
  })

  it('split cleanly by level: the ground-floor plan names no level-2 area and the level-2 plan no ground-floor one', () => {
    const l1 = labelsFor(1)
    const l2 = labelsFor(2)
    expect(l1.length + l2.length).toBe(MAP_LABELS.length)
    for (const l of l1) expect(l.area.startsWith('l2'), l.area).toBe(false)
    for (const l of l2) expect(l.area.startsWith('l2'), l.area).toBe(true)
    expect(l1.map((l) => l.text)).toContain('Lobby')
    expect(l2.map((l) => l.text)).toEqual(expect.arrayContaining(['Pre-op', 'OR', 'PACU', 'Sterile', 'Lounge']))
  })

  it('fit their rooms on a card about 130 px wide at map size (the OR, recovery, pre-op, sterile supply and the lounge)', () => {
    // the card is 46% of a 292 px column: about 116 px of plan, at 9 px type and 0.55 em a letter
    const f = mapFrame(116, mapBounds(2))
    const width = (t: string): number => t.length * 0.55 * 9
    for (const a of L2_LABELLED) {
      const text = labelsFor(2).find((l) => l.area === a.id)!.text
      expect(labelLayout(labelBox(f, a.id), width(text), 9), a.id).not.toBeNull()
    }
  })
})

describe('painting a plan of one level', () => {
  function recorder() {
    const calls: { op: string; args: unknown[] }[] = []
    const state: Record<string, unknown> = { font: '', fillStyle: '', strokeStyle: '' }
    const ctx = new Proxy(state, {
      get(target, prop: string) {
        if (prop in target) return target[prop]
        if (prop === 'measureText') return (text: string) => ({ width: text.length * 0.55 * parseFloat(/([\d.]+)px/.exec(String(target.font))![1]) })
        return (...args: unknown[]) => {
          calls.push({ op: prop, args })
        }
      },
      set(target, prop: string, value) {
        target[prop] = value
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    return { ctx, calls }
  }

  it('draws the flat plan of level 2 from the level-2 areas only, and of level 1 from the others (no level argument: all of them, as before)', () => {
    const count = (level?: 1 | 2): number => {
      const f = mapFrame(278, level ? mapBounds(level) : undefined)
      const { ctx, calls } = recorder()
      paintFallback(ctx, f, level)
      return calls.filter((c) => c.op === 'fillRect').length - 1
    }
    expect(count(2)).toBe(L2_AREAS.length)
    expect(count(1)).toBe(AREAS.length - L2_AREAS.length)
    expect(count()).toBe(AREAS.length)
    expect(fallbackAreas(2).length).toBe(L2_AREAS.length)
    expect(fallbackAreas(1).every((a) => !a.id.startsWith('l2'))).toBe(true)
  })

  it('names the level-2 rooms on the level-2 plan, centred in each room, and no ground-floor name', () => {
    const f = mapFrame(232, mapBounds(2))
    const { ctx, calls } = recorder()
    paintLabels(ctx, f, 2, 2)
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]))
    for (const t of ['Pre-op', 'OR', 'PACU', 'Lounge']) expect(texts, t).toContain(t)
    for (const t of texts) expect(labelsFor(2).map((l) => l.text)).toContain(t)
    for (const t of ['Lobby', 'Triage', 'ER', 'Pharmacy', 'Atrium']) expect(texts, t).not.toContain(t)
    const box = labelBox(f, 'l2Or')
    const i = calls.findIndex((c) => c.op === 'fillText' && c.args[0] === 'OR')
    const tr = [...calls.slice(0, i)].reverse().find((c) => c.op === 'translate')!
    expect(tr.args).toEqual([box.x, box.y])
  })

  it('names no level-2 room on the ground-floor plan', () => {
    const f = mapFrame(556)
    const { ctx, calls } = recorder()
    paintLabels(ctx, f, 2, 1)
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]))
    expect(texts).toContain('Lobby')
    for (const t of ['Pre-op', 'OR', 'PACU', 'Sterile']) expect(texts, t).not.toContain(t)
  })
})

describe('drawing on the level-2 map', () => {
  type Call = { op: string; args: number[]; fill: string; stroke: string }
  function recorder() {
    const calls: Call[] = []
    const state = { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, lineJoin: '' }
    const note =
      (op: string) =>
      (...args: unknown[]): void => {
        calls.push({ op, args: args.filter((a): a is number => typeof a === 'number'), fill: state.fillStyle, stroke: state.strokeStyle })
      }
    const ctx = new Proxy(state, {
      get(target, prop: string) {
        if (prop in target) return (target as Record<string, unknown>)[prop]
        return note(prop)
      },
      set(target, prop: string, value) {
        ;(target as Record<string, unknown>)[prop] = value
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    return { ctx, calls }
  }

  const dpr = 2
  const canvas = { width: 0, height: 0 } as unknown as HTMLCanvasElement
  const plan2 = { canvas, frame: mapFrame(116 * dpr, mapBounds(2)), level: 2 as const }
  const plan1 = { canvas, frame: mapFrame(278 * dpr), level: 1 as const }
  const pods = [{ pod: { id: 'A1', position: { x: 0, y: 0, z: -14 }, light: 'teal' as const, orderId: 'ord-1' } }]
  const world = (player: MapWorld['player']): MapWorld => ({ meds: { fleet: { drivers: pods } }, player })
  const order: YourOrderView = { orderId: 'ord-1', roomId: 'A3', ward: 'A', stage: 'enRoute', podId: 'A1', text: '' }

  it('draws you at your place in the strip, turned to your heading, and nothing of level 1: no pods, no order diamond or ring', () => {
    const { ctx, calls } = recorder()
    drawMinimap(ctx, plan2, world({ x: 98, z: 5.9, heading: Math.PI / 2 }), order, dpr, 600)
    const f = plan2.frame
    expect(calls.filter((c) => c.op === 'arc').length).toBe(1) // the disc under your arrow, no pods
    expect(calls.some((c) => c.fill === '#e8590c' || c.stroke === '#e8590c')).toBe(false)
    const tr = calls.filter((c) => c.op === 'translate').pop()!
    expect(tr.args).toEqual([toMapX(f, 98), toMapY(f, 5.9)])
    expect(calls.filter((c) => c.op === 'rotate').pop()!.args).toEqual([arrowAngle(Math.PI / 2)])
    // and the marker is inside the card
    expect(tr.args[0]).toBeGreaterThan(0)
    expect(tr.args[0]).toBeLessThan(f.width)
    expect(tr.args[1]).toBeGreaterThan(0)
    expect(tr.args[1]).toBeLessThan(f.height)
  })

  it('still draws the pods and your order on the level-1 plan, as before', () => {
    const { ctx, calls } = recorder()
    drawMinimap(ctx, plan1, world({ x: -40, z: 0, heading: 0 }), order, dpr, 600)
    expect(calls.filter((c) => c.op === 'arc').length).toBeGreaterThanOrEqual(3) // pod, its ring, you
    expect(calls.some((c) => c.fill === '#e8590c')).toBe(true)
  })

  it('draws no arrow on a plan of the other level than yours', () => {
    const a = recorder()
    drawMinimap(a.ctx, plan1, world({ x: 98, z: 5.9, heading: 0 }), null, dpr, 0)
    expect(a.calls.some((c) => c.op === 'translate')).toBe(false)
    const b = recorder()
    drawMinimap(b.ctx, plan2, world({ x: -40, z: 0, heading: 0 }), null, dpr, 0)
    expect(b.calls.some((c) => c.op === 'translate')).toBe(false)
  })

  it('a plan with no level is the ground-floor plan (the old call)', () => {
    const { ctx, calls } = recorder()
    drawMinimap(ctx, { canvas, frame: plan1.frame }, world({ x: -40, z: 0, heading: 0 }), null, dpr, 0)
    expect(calls.filter((c) => c.op === 'arc').length).toBe(2)
  })
})
