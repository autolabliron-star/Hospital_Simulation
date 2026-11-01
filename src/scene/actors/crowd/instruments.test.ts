/**
 * R5: the instruments mesh (crowd/instruments.ts) and its table (instrumentTable.ts): every shape within its triangle cap and the whole mesh within 3,000
 * (every instance submits all of it), every vertex in its own kind with a valid colour slot, the moving parts only where the table says, the tips where the
 * poses expect them, every ToolKind either modelled or knowingly not, and no red-saturated colour anywhere (no blood in the hospital).
 */
import { describe, expect, it } from 'vitest'
import type { ToolKind } from '@/sim/types'
import { FIXED_COLORS, FX, GOWN_KIND, INSTRUMENT_FIRST, INSTRUMENT_HAND, MASK_KIND, PALETTE_SLOTS } from './constants'
import { buildInstrument, buildInstrumentGeometry, instrumentTriangles } from './instruments'
import { INSTRUMENT, INSTRUMENTS, INSTRUMENTS_MAX_TRIS, INSTRUMENT_LAST, INSTRUMENT_NAMES, MOVING_TAG, TABLET_TOOLS, TOOL_TABLE, instrumentKindOf, specOfKind } from './instrumentTable'
import { buildGownGeometry, buildMaskGeometry } from './attire'

/** HSV saturation and hue (degrees) of an sRGB hex. */
function hsv(hex: string): { h: number; s: number; v: number } {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  if (h < 0) h += 360
  return { h, s: max > 0 ? d / max : 0, v: max }
}
const redSaturated = (hex: string): boolean => {
  const c = hsv(hex)
  return (c.h < 20 || c.h > 330) && c.s > 0.45 && c.v > 0.25
}

describe('the instruments mesh', () => {
  const g = buildInstrumentGeometry()
  const tris = instrumentTriangles()

  it('keeps every shape within its cap and the whole mesh within 3,000 triangles', () => {
    for (const n of INSTRUMENT_NAMES) {
      expect(tris[n], n).toBeGreaterThan(0)
      expect(tris[n], n).toBeLessThanOrEqual(INSTRUMENTS[n].maxTris)
    }
    expect(g.total).toBe(INSTRUMENT_NAMES.reduce((s, n) => s + tris[n], 0))
    expect(g.total).toBeLessThanOrEqual(INSTRUMENTS_MAX_TRIS)
    console.log(`instruments: ${g.total} triangles (${INSTRUMENT_NAMES.map((n) => `${n} ${tris[n]}`).join(', ')})`)
  })

  it('every vertex is in its own kind, takes a fixed colour, and moves only where its instrument has a moving part', () => {
    for (const n of INSTRUMENT_NAMES) {
      const b = buildInstrument(n)
      const spec = INSTRUMENTS[n]
      let moving = 0
      for (let i = 0; i < b.part.length; i += 2) {
        const x = b.part[i]
        const slot = b.part[i + 1]
        expect(Math.round(x), n).toBe(spec.kind)
        const tag = Math.round((x - Math.floor(x + 0.05)) * 10) / 10
        if (tag > 0) {
          moving++
          expect(tag, n).toBeCloseTo(MOVING_TAG[spec.moving], 6)
        }
        // instruments never take a person's colours: fixed slots only, inside the table
        expect(slot, n).toBeGreaterThanOrEqual(PALETTE_SLOTS)
        expect(slot, n).toBeLessThan(PALETTE_SLOTS + FIXED_COLORS.length)
      }
      if (spec.moving !== 'none') expect(moving, `${n} moves`).toBeGreaterThan(0)
      else expect(moving, `${n} does not move`).toBe(0)
    }
  })

  it('has its tip where the poses expect it: the lowest point within 2.5 cm of -tip', () => {
    for (const n of INSTRUMENT_NAMES) {
      const b = buildInstrument(n)
      let lo = Infinity
      for (let i = 1; i < b.pos.length; i += 3) lo = Math.min(lo, b.pos[i])
      expect(Math.abs(lo + INSTRUMENTS[n].tip), `${n}: lowest ${lo.toFixed(3)}, tip ${INSTRUMENTS[n].tip}`).toBeLessThan(0.025)
    }
  })

  it('has kinds after the gown, below the hand packing, and a spec for each', () => {
    expect(INSTRUMENT_FIRST).toBe(GOWN_KIND + 1)
    expect(GOWN_KIND).toBe(MASK_KIND + 1)
    expect(INSTRUMENT_LAST).toBeLessThan(INSTRUMENT_HAND)
    for (const n of INSTRUMENT_NAMES) expect(specOfKind(INSTRUMENT[n])?.name).toBe(n)
    expect(specOfKind(INSTRUMENT_FIRST - 1)).toBeNull()
    expect(specOfKind(INSTRUMENT_LAST + 1)).toBeNull()
  })

  it('draws every hand-held ToolKind, and knows which ones it does not', () => {
    const notModelled: ToolKind[] = ['none', 'tablet', 'countBoard', 'ecgLeads', 'gelPad', 'gown', 'drapeSheet', 'gasLine', 'catheter', 'manipulator', 'usTransducer', 'mouse']
    for (const [tool, spec] of Object.entries(TOOL_TABLE) as [ToolKind, unknown][]) {
      if (notModelled.includes(tool)) expect(spec, tool).toBeNull()
      else expect(instrumentKindOf(tool), tool).toBeGreaterThanOrEqual(INSTRUMENT_FIRST)
    }
    for (const t of TABLET_TOOLS) expect(TOOL_TABLE[t]).toBeNull()
    expect(instrumentKindOf('cryoProbe')).toBe(INSTRUMENT.cryoNeedle)
    expect(instrumentKindOf('salineSyringe')).toBe(INSTRUMENT.syringe)
  })
})

describe('the attire meshes', () => {
  it('the mask is about 210 triangles of kind MASK_KIND, the gown skirt about 140 of GOWN_KIND, each in its own colour', () => {
    const m = buildMaskGeometry()
    const gw = buildGownGeometry()
    expect(m.total).toBeLessThanOrEqual(220)
    expect(gw.total).toBeLessThanOrEqual(160)
    for (const [geo, kind, fx] of [
      [m.geometry, MASK_KIND, FX.mask],
      [gw.geometry, GOWN_KIND, FX.gown],
    ] as const) {
      const a = geo.getAttribute('aPart')
      for (let i = 0; i < a.count; i++) {
        expect(a.getX(i)).toBe(kind)
        expect(a.getY(i)).toBe(PALETTE_SLOTS + fx)
      }
    }
  })
})

describe('clean colours', () => {
  it('no instrument, attire or other fixed colour is a saturated red', () => {
    const reds = FIXED_COLORS.filter((c, i) => i !== FX.mouth && redSaturated(c))
    expect(reds).toEqual([])
    for (const fx of [FX.steel, FX.steelDark, FX.plasticBlue, FX.clear, FX.bagGreen, FX.glove, FX.mask, FX.gown, FX.lead]) expect(redSaturated(FIXED_COLORS[fx]), FIXED_COLORS[fx]).toBe(false)
    // the check itself
    expect(redSaturated('#c0202a')).toBe(true)
    expect(redSaturated('#efe3c8')).toBe(false)
  })
})
