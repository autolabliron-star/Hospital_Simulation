import { describe, expect, it } from 'vitest'
import { STATUS, WAYFINDING } from '@/scene/materials'
import type { Emote } from '@/sim/types'
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  CELL,
  COLS,
  EMOTE_CODE,
  EMOTE_UV,
  ICON_ACCENT,
  ICON_CELL,
  ICON_EMOTES,
  ROWS,
  UV_TABLE,
  drawEmoteIcon,
  mix,
  uvRectForCell,
  type IconEmote,
  type UvRect,
} from './emoteAtlas'

/** Every value of the contract's Emote union. A `Record` so a new value breaks the build until it is listed here. */
const EVERY_EMOTE: Record<Emote, true> = {
  none: true,
  tablet: true,
  pill: true,
  hourglass: true,
  bed: true,
  check: true,
  scan: true,
  heart: true,
  question: true,
  coffee: true,
  meal: true,
}
const ALL = Object.keys(EVERY_EMOTE) as Emote[]
const WITH_ICON = ALL.filter((e): e is IconEmote => e !== 'none')

function overlaps(a: UvRect, b: UvRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

describe('emote atlas cell mapping', () => {
  it('has an icon for every emote except none, and nothing else', () => {
    expect([...ICON_EMOTES].sort()).toEqual([...WITH_ICON].sort())
    expect(Object.keys(ICON_CELL).sort()).toEqual([...WITH_ICON].sort())
  })

  it('gives every emote a unique whole cell inside the grid', () => {
    const cells = WITH_ICON.map((e) => ICON_CELL[e])
    expect(new Set(cells).size).toBe(cells.length)
    for (const c of cells) {
      expect(Number.isInteger(c)).toBe(true)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThan(COLS * ROWS)
    }
  })

  it('numbers instances 0 for none and cell + 1 for the rest, all different', () => {
    expect(EMOTE_CODE.none).toBe(0)
    const codes = WITH_ICON.map((e) => EMOTE_CODE[e])
    expect(new Set(codes).size).toBe(codes.length)
    for (const e of WITH_ICON) expect(EMOTE_CODE[e]).toBe(ICON_CELL[e] + 1)
    expect(Object.keys(EMOTE_CODE).sort()).toEqual([...ALL].sort())
  })

  it('keeps every UV rect inside [0, 1], non-empty, and clear of its neighbours', () => {
    const rects = WITH_ICON.map((e) => EMOTE_UV[e])
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(1)
      expect(r.y + r.h).toBeLessThanOrEqual(1)
      expect(r.w).toBeGreaterThan(0)
      expect(r.h).toBeGreaterThan(0)
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false)
  })

  it('lays the atlas out top-down: cell 0 is the upper left of the canvas, which is the high-v side of the texture', () => {
    const first = uvRectForCell(0)
    expect(first.x).toBeLessThan(0.5)
    expect(first.y + first.h).toBeGreaterThan(0.5)
    const last = uvRectForCell(COLS * ROWS - 1)
    expect(last.x + last.w).toBeGreaterThan(0.5)
    expect(last.y).toBeLessThan(0.5)
    expect(ATLAS_WIDTH).toBe(COLS * CELL)
    expect(ATLAS_HEIGHT).toBe(ROWS * CELL)
  })

  it('flattens the same rects into the table the frame loop reads', () => {
    for (const e of WITH_ICON) {
      const r = EMOTE_UV[e]
      const i = (EMOTE_CODE[e] - 1) * 4
      expect([UV_TABLE[i], UV_TABLE[i + 1], UV_TABLE[i + 2], UV_TABLE[i + 3]].map((v) => Math.fround(v))).toEqual(
        [r.x, r.y, r.w, r.h].map((v) => Math.fround(v)),
      )
    }
  })
})

/** A canvas context that records what is drawn instead of drawing it. */
function recordingContext() {
  const calls: { op: string; args: unknown[] }[] = []
  const props: Record<string, unknown> = {}
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop in props) return props[prop]
        return (...args: unknown[]) => {
          calls.push({ op: prop, args })
        }
      },
      set(_t, prop: string, value: unknown) {
        props[prop] = value
        if (prop === 'fillStyle' || prop === 'strokeStyle') calls.push({ op: prop, args: [value] })
        return true
      },
    },
  ) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

describe('drawing the icons', () => {
  const logs = new Map<IconEmote, ReturnType<typeof recordingContext>['calls']>()
  for (const e of WITH_ICON) {
    const { ctx, calls } = recordingContext()
    drawEmoteIcon(ctx, e)
    logs.set(e, calls)
  }

  it('paints something for every icon, with the shapes finite and inside the cell', () => {
    for (const [emote, calls] of logs) {
      expect(calls.filter((c) => c.op === 'fill' || c.op === 'stroke' || c.op === 'fillRect').length, emote).toBeGreaterThan(3)
      for (const c of calls) {
        if (c.op === 'fillStyle' || c.op === 'strokeStyle' || c.op === 'scale') continue
        for (const a of c.args) {
          if (typeof a !== 'number') continue
          expect(Number.isFinite(a), `${emote} ${c.op}`).toBe(true)
          expect(Math.abs(a), `${emote} ${c.op}`).toBeLessThanOrEqual(CELL / 2)
        }
      }
    }
  })

  it('draws every icon differently', () => {
    const keys = [...logs.values()].map((calls) => JSON.stringify(calls))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('uses palette colours: teal pill, rose heart, amber hourglass', () => {
    const colours = (e: IconEmote) =>
      logs
        .get(e)!
        .filter((c) => c.op === 'fillStyle' || c.op === 'strokeStyle')
        .map((c) => String(c.args[0]))
    expect(ICON_ACCENT.pill).toBe(STATUS.teal)
    expect(ICON_ACCENT.heart).toBe(WAYFINDING.emergency)
    expect(ICON_ACCENT.hourglass).toBe(STATUS.amber)
    expect(colours('pill')).toContain(STATUS.teal)
    expect(colours('heart')).toContain(WAYFINDING.emergency)
    expect(colours('hourglass')).toContain(STATUS.amber)
  })

  it('mixes shades from the palette without leaving the hex format', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#102030', '#ffffff', 0.5)).toMatch(/^#[0-9a-f]{6}$/)
    for (const e of WITH_ICON) expect(ICON_ACCENT[e]).toMatch(/^#[0-9a-f]{6}$/)
  })
})
