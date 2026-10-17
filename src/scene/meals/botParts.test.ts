import { describe, expect, it } from 'vitest'
import { BufferGeometry } from 'three'
import { MEALBOT_SIZE } from '@/sim/places'
import { CONFIG } from '@/sim/config'
import { BOT, BOT_COLORS, CABINET, DOOR_ORIGIN, SHELF, SHELF_COUNT, botDoorGeometry, botRingGeometry, botShadowGeometry, botStaticGeometry, shelfY } from './botParts'
import { TRAY, trayBaseGeometry, trayClocheGeometry } from './trayParts'

function bounds(g: BufferGeometry) {
  g.computeBoundingBox()
  return g.boundingBox!
}

describe('MealBot geometry', () => {
  it('is a white cart robot of the contract size (0.6 x 1.1 x 1.25), floor at y = 0, nose along +z', () => {
    const g = botStaticGeometry()
    const b = bounds(g)
    expect(b.min.y).toBeGreaterThanOrEqual(0)
    expect(b.max.y).toBeCloseTo(MEALBOT_SIZE.h, 6)
    expect(b.max.x - b.min.x).toBeLessThanOrEqual(MEALBOT_SIZE.w + 0.04)
    expect(b.max.z - b.min.z).toBeLessThanOrEqual(MEALBOT_SIZE.l + 0.04)
    // centred on its own origin, so heading and position are the whole transform
    expect((b.max.x + b.min.x) / 2).toBeCloseTo(0, 2)
    expect(Math.abs((b.max.z + b.min.z) / 2)).toBeLessThan(0.02) // the front sensor bar sticks out a little
    // vertex colours on every vertex, in [0, 1]
    const c = g.getAttribute('color')
    expect(c.count).toBe(g.getAttribute('position').count)
    for (let i = 0; i < c.count; i++) for (const v of [c.getX(i), c.getY(i), c.getZ(i)]) expect(v >= 0 && v <= 1).toBe(true)
    g.dispose()
  })

  it('has eight shelves, that fit the tray cabinet and the config', () => {
    expect(SHELF_COUNT).toBe(CONFIG.meals.shelves)
    expect(SHELF_COUNT).toBe(8)
    expect(shelfY(0)).toBeGreaterThan(CABINET.openingY0)
    // the top shelf's tray (with its cup) still fits under the header
    const trayTop = shelfY(SHELF_COUNT - 1) + (TRAY.h + 0.07) * SHELF.trayScale
    expect(trayTop).toBeLessThan(CABINET.openingY1)
    // and every shelf tray fits between its shelf and the next
    expect((TRAY.h + 0.07) * SHELF.trayScale).toBeLessThan(SHELF.pitch)
    // a shelf tray lies inside the cabinet's inner width and length
    expect(TRAY.l * SHELF.trayScale / 2).toBeLessThan(CABINET.innerW / 2 + 1e-9)
    expect(TRAY.w * SHELF.trayScale).toBeLessThan(BOT.cabinetZ1 - BOT.cabinetZ0)
  })

  it('the shutter closes the cabinet opening at the rear, hinged at its top edge, and retracts into the header', () => {
    const g = botDoorGeometry()
    const b = bounds(g)
    expect(b.max.y).toBeLessThanOrEqual(1e-6) // the origin is the top edge
    expect(b.min.y).toBeCloseTo(-(CABINET.openingY1 - CABINET.openingY0), 6)
    expect(b.max.x - b.min.x).toBeCloseTo(CABINET.innerW, 6)
    expect(DOOR_ORIGIN.y).toBe(CABINET.openingY1)
    // in the rear plane, a hair inside the rear face
    expect(DOOR_ORIGIN.z).toBeGreaterThan(BOT.cabinetZ0)
    expect(DOOR_ORIGIN.z).toBeLessThan(BOT.cabinetZ0 + 0.05)
    g.dispose()
  })

  it('the ring is a band just wider than the body, like the pods, near the top of the cabinet', () => {
    const g = botRingGeometry()
    const b = bounds(g)
    expect(b.max.x - b.min.x).toBeGreaterThan(MEALBOT_SIZE.w)
    expect(b.max.x - b.min.x).toBeLessThan(MEALBOT_SIZE.w + 0.05)
    expect(b.max.y - b.min.y).toBeLessThan(0.06)
    expect(b.min.y).toBeGreaterThan(CABINET.openingY1)
    expect(b.max.y).toBeLessThan(BOT.cabinetTop)
    g.dispose()
  })

  it('the shadow blob is flat on the floor', () => {
    const g = botShadowGeometry()
    const b = bounds(g)
    expect(b.max.y).toBeLessThan(0.05)
    expect(b.max.y).toBeGreaterThan(0)
    g.dispose()
  })

  it('has a warm peach accent and no teal anywhere (meals are never confused with medicine)', () => {
    const hex = BOT_COLORS.stripe
    const n = parseInt(hex.slice(1), 16)
    expect((n >> 16) & 255).toBeGreaterThan(n & 255) // red above blue
    for (const v of Object.values(BOT_COLORS)) {
      const m = parseInt(v.slice(1), 16)
      const r = (m >> 16) & 255
      const g = (m >> 8) & 255
      const b = m & 255
      // teal: green and blue both well above red
      expect(g > r + 30 && b > r + 30, v).toBe(false)
    }
  })
})

describe('tray geometry', () => {
  it('is a small grey tray, the long axis along x, standing on y = 0', () => {
    const g = trayBaseGeometry()
    const b = bounds(g)
    expect(b.min.y).toBeCloseTo(0, 6)
    expect(b.max.x - b.min.x).toBeCloseTo(TRAY.l, 3)
    expect(b.max.z - b.min.z).toBeCloseTo(TRAY.w, 3)
    expect(b.max.y).toBeLessThan(0.1)
    g.dispose()
  })

  it('the cloche covers the plate', () => {
    const g = trayClocheGeometry()
    const b = bounds(g)
    expect((b.max.x + b.min.x) / 2).toBeCloseTo(TRAY.plate.x, 3)
    expect((b.max.x - b.min.x) / 2).toBeGreaterThanOrEqual(TRAY.plate.r)
    expect(b.min.y).toBeGreaterThanOrEqual(TRAY.h)
    expect(b.max.y).toBeLessThan(0.2)
    g.dispose()
  })
})
