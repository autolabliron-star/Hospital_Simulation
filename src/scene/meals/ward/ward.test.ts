import { describe, expect, it } from 'vitest'
import { BACKREST, BED_ANCHORS, BEDSIDE_SCREEN, DOOR_TILE, FOOT_SECTION, MATTRESS, OVERBED } from '@/scene/rooms/bedParts'
import { BED_STATES } from '@/sim/types'
import { ROOMS } from '@/sim/places'
import { DOOR_COLORS, DOOR_PULSE, DOOR_STYLE, bedStateIndex } from './doorStyle'
import { BEDSIDE_ATLAS, atlasCell, backrestGeometry, bedsideQuadGeometry, doorTileGeometry } from './wardParts'

/** Hue in degrees and saturation of an sRGB hex colour. */
function hueSat(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return { h: h * 60, s, l }
}

describe('door tile colours (docs/L1-LIVING-DAY.md, Bed flow)', () => {
  it('has a style for every bed state, in BED_STATES order', () => {
    expect(Object.keys(DOOR_STYLE).sort()).toEqual([...BED_STATES].sort())
    expect(DOOR_COLORS).toHaveLength(BED_STATES.length)
    BED_STATES.forEach((s, i) => expect(bedStateIndex(s)).toBe(i))
  })

  it('white, soft blue, soft blue pulsing, amber, amber pulsing, green, teal', () => {
    const white = hueSat(DOOR_STYLE.occupied.color)
    expect(white.s).toBeLessThan(0.15)
    expect(white.l).toBeGreaterThan(0.9)
    for (const s of ['dischargeSigned', 'leaving'] as const) {
      const c = hueSat(DOOR_STYLE[s].color)
      expect(c.h, s).toBeGreaterThan(200)
      expect(c.h, s).toBeLessThan(230) // blue
      expect(c.l, s).toBeGreaterThan(0.65) // soft, not a hard blue
    }
    for (const s of ['needsCleaning', 'cleaning'] as const) {
      const c = hueSat(DOOR_STYLE[s].color)
      expect(c.h, s).toBeGreaterThan(30)
      expect(c.h, s).toBeLessThan(45) // amber
    }
    const green = hueSat(DOOR_STYLE.ready.color)
    expect(green.h).toBeGreaterThan(125)
    expect(green.h).toBeLessThan(150)
    const teal = hueSat(DOOR_STYLE.reserved.color)
    expect(teal.h).toBeGreaterThan(170)
    expect(teal.h).toBeLessThan(190)
  })

  it('only leaving and cleaning pulse', () => {
    for (const s of BED_STATES) expect(DOOR_STYLE[s].pulse, s).toBe(s === 'leaving' || s === 'cleaning')
    BED_STATES.forEach((s, i) => expect(DOOR_PULSE[i]).toBe(DOOR_STYLE[s].pulse ? 1 : 0))
  })

  it('a pulsing state is the same colour as its steady twin (the pulse is not a different colour)', () => {
    expect(DOOR_STYLE.leaving.color).toBe(DOOR_STYLE.dischargeSigned.color)
    expect(DOOR_STYLE.cleaning.color).toBe(DOOR_STYLE.needsCleaning.color)
  })

  it('white stays calm and the lit tiles glow a little above 1 (a soft bloom), never blinding', () => {
    expect(DOOR_STYLE.occupied.gain).toBeLessThan(1)
    for (const s of BED_STATES) expect(DOOR_STYLE[s].gain, s).toBeLessThanOrEqual(1.6)
  })
})

describe('ward parts geometry', () => {
  it('the door tile fits the doorway (1.4 m opening, jambs 0.07 each side) and sits just above the floor', () => {
    expect(DOOR_TILE.w).toBeLessThan(ROOMS[0].doorWidth - 0.1)
    expect(DOOR_TILE.y + DOOR_TILE.h).toBeLessThan(0.05)
    const g = doorTileGeometry()
    g.computeBoundingBox()
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(DOOR_TILE.w, 6)
    expect(g.getAttribute('aPulse').count).toBe(ROOMS.length)
    g.dispose()
  })

  it('the backrest geometry matches the numbers the static bed was cut with', () => {
    const g = backrestGeometry()
    g.computeBoundingBox()
    const bb = g.boundingBox!
    expect(bb.max.z).toBeCloseTo(0, 6) // the hinge end
    expect(bb.min.z).toBeCloseTo(-BACKREST.length, 6) // the head end
    expect(bb.min.y).toBeCloseTo(MATTRESS.y0 - BACKREST.hingeY, 6)
    expect(bb.max.y).toBeCloseTo(BACKREST.pillow.y + BACKREST.pillow.h / 2, 6)
    // the head section and the static foot section tile the mattress exactly
    expect(BACKREST.length + FOOT_SECTION.length).toBeCloseTo(MATTRESS.l, 6)
    // in the flat state the slab's top is the mattress top
    expect(BACKREST.hingeY + BACKREST.slab.y1).toBeCloseTo(MATTRESS.top, 6)
    g.dispose()
  })

  it('a bedside quad per room, each with its own tile of the atlas, all inside it', () => {
    const g = bedsideQuadGeometry()
    const cells = g.getAttribute('aCell')
    expect(cells.count).toBe(ROOMS.length)
    const seen = new Set<string>()
    for (let i = 0; i < cells.count; i++) {
      seen.add(`${cells.getX(i)},${cells.getY(i)}`)
      expect(cells.getX(i)).toBeGreaterThanOrEqual(0)
      expect(cells.getX(i) + 1 / BEDSIDE_ATLAS.cols).toBeLessThanOrEqual(1 + 1e-9)
      expect(cells.getY(i)).toBeGreaterThanOrEqual(0)
      expect(cells.getY(i) + 1 / BEDSIDE_ATLAS.rows).toBeLessThanOrEqual(1 + 1e-9)
    }
    expect(seen.size).toBe(ROOMS.length)
    expect(atlasCell(0)).toMatchObject({ col: 0, row: 0, u: 0, v: 0.75 })
    expect(atlasCell(15)).toMatchObject({ col: 3, row: 3, u: 0.75, v: 0 })
    g.dispose()
  })
})

describe('anchors', () => {
  it('every room has the four anchors, ward B mirrored from ward A', () => {
    expect(BED_ANCHORS).toHaveLength(16)
    for (let n = 1; n <= 8; n++) {
      const a = BED_ANCHORS.find((b) => b.roomId === `A${n}`)!
      const b = BED_ANCHORS.find((q) => q.roomId === `B${n}`)!
      for (const k of ['backrest', 'tray', 'screen', 'doorTile'] as const) {
        expect(b[k].x).toBeCloseTo(a[k].x, 9)
        expect(b[k].z).toBeCloseTo(-a[k].z, 9)
        expect(b[k].y).toBeCloseTo(a[k].y, 9)
      }
    }
  })

  it('the tray stands on the table plate, the hinge on the bed, the screen over the bed head, the tile in the doorway', () => {
    for (const r of ROOMS) {
      const a = BED_ANCHORS.find((q) => q.roomId === r.id)!
      expect(a.tray.y).toBeCloseTo(OVERBED.plate.y + OVERBED.plate.h, 9)
      expect(Math.abs(a.tray.x - r.bed.x)).toBeLessThan(0.5)
      expect(a.backrest.x).toBeCloseTo(r.bed.x, 9)
      expect(Math.abs(a.backrest.z - r.bed.z)).toBeCloseTo(Math.abs(BACKREST.hingeDv), 9)
      expect(a.screen.y).toBeGreaterThan(BEDSIDE_SCREEN.y)
      expect(a.doorTile.x).toBe(r.door.x)
      expect(a.doorTile.z).toBe(r.door.z)
      expect(a.backrest.ry).toBe(r.bedHeading)
    }
  })
})
