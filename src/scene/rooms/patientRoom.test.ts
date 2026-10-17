// The static patient room and the live ward parts (src/scene/meals/ward) are cut from the same numbers (bedParts.ts). These tests
// check that the prims the room builder draws line up with the anchors the live parts use, so a changed constant cannot leave a gap.
import { describe, expect, it } from 'vitest'
import { LayoutBuilder } from '@/scene/building/layout/builder'
import { buildLayout } from '@/scene/building/layout'
import type { Prim } from '@/scene/building/layout/types'
import { ROOMS } from '@/sim/places'
import { BACKREST, BED_ANCHORS, BEDSIDE_SCREEN, FOOT_SECTION, MATTRESS, OVERBED } from './bedParts'
import { buildPatientRoom } from './patientRoom'

function roomPrims(roomIndex: number): { prims: Prim[]; footprints: ReturnType<LayoutBuilder['finish']>['footprints'] } {
  const b = new LayoutBuilder()
  buildPatientRoom(b, ROOMS[roomIndex])
  const l = b.finish()
  return { prims: l.prims, footprints: l.footprints }
}

describe('patient room: the static bed with a live head', () => {
  for (const idx of [0, 8]) {
    const room = ROOMS[idx]
    const { prims, footprints } = roomPrims(idx)
    const s = room.ward === 'A' ? -1 : 1
    const anchors = BED_ANCHORS[idx]

    it(`${room.id}: the static mattress stops at the hinge and the backrest part takes over, with no gap and no overlap`, () => {
      const mattress = prims.find((p) => p.mat === 'linen' && p.shape === 'roundedBox' && Math.abs(p.size[0] - MATTRESS.w) < 1e-9)!
      expect(mattress).toBeDefined()
      expect(mattress.size[2]).toBeCloseTo(FOOT_SECTION.length, 9)
      // its head end (toward the corridor wall) is exactly at the hinge
      const headEnd = mattress.position[2] - s * (mattress.size[2] / 2)
      expect(headEnd).toBeCloseTo(anchors.backrest.z, 9)
      expect(mattress.position[1] - mattress.size[1] / 2).toBeCloseTo(MATTRESS.y0, 9)
      expect(mattress.position[1] + mattress.size[1] / 2).toBeCloseTo(MATTRESS.top, 9)
    })

    it(`${room.id}: no pillow and no head section in the static room, but still the head board, the base and the rails`, () => {
      // the old pillow was a 0.56 x 0.13 x 0.34 linen box
      expect(prims.some((p) => p.mat === 'linen' && Math.abs(p.size[0] - BACKREST.pillow.w) < 1e-9 && Math.abs(p.size[1] - BACKREST.pillow.h) < 1e-9)).toBe(false)
      expect(prims.some((p) => p.mat === 'woodOak' && Math.abs(p.size[1] - 0.78) < 1e-9)).toBe(true) // the head board
      expect(prims.some((p) => p.mat === 'whitePlastic' && Math.abs(p.size[2] - 2.0) < 1e-9)).toBe(true) // the full-length base
      expect(prims.filter((p) => p.mat === 'frame' && Math.abs(p.size[0] - 0.03) < 1e-9)).toHaveLength(2) // two rails
    })

    it(`${room.id}: the over-bed table's plate top is where the tray stands, across the bed, clear of the bed's width`, () => {
      const plate = prims.find((p) => p.mat === 'woodOak' && Math.abs(p.size[0] - OVERBED.plate.w) < 1e-9 && Math.abs(p.size[2] - OVERBED.plate.d) < 1e-9)!
      expect(plate).toBeDefined()
      expect(plate.position[1] + plate.size[1] / 2).toBeCloseTo(anchors.tray.y, 9)
      expect(plate.position[0]).toBeCloseTo(anchors.tray.x, 9)
      expect(plate.position[2]).toBeCloseTo(anchors.tray.z, 9)
      // the tray's footprint (0.46 x 0.32) is inside the plate (0.76 x 0.42)
      expect(0.46).toBeLessThan(OVERBED.plate.w)
      expect(0.32).toBeLessThan(OVERBED.plate.d)
    })

    it(`${room.id}: the table is an overhead footprint, never a nav obstacle (the nurse walks this side of the bed to the MedDrawer)`, () => {
      const f = footprints.find((q) => q.id === `${room.id}:overbed`)!
      expect(f).toBeDefined()
      expect(f.overhead).toBe(true)
    })

    it(`${room.id}: the bedside screen keeps its bezel, and the live picture sits just in front of it`, () => {
      const bezel = prims.find((p) => p.mat === 'metalDark' && Math.abs(p.size[0] - BEDSIDE_SCREEN.w) < 1e-9 && Math.abs(p.size[1] - BEDSIDE_SCREEN.h) < 1e-9)!
      expect(bezel).toBeDefined()
      expect(prims.some((p) => p.shape === 'quad')).toBe(false) // the picture is the live layer's now
      const pic = anchors.screen
      // the picture is in front of the bezel's centre by half the bezel plus a hair, along the way it faces and leans
      expect(pic.x).toBeCloseTo(bezel.position[0], 9)
      expect(Math.hypot(pic.z - bezel.position[2], pic.y - bezel.position[1])).toBeCloseTo(BEDSIDE_SCREEN.t / 2 + 0.003, 6)
      expect(Math.abs(bezel.rotationX! + BEDSIDE_SCREEN.lean)).toBeLessThan(1e-9)
      expect(Math.abs(bezel.rotationY - pic.ry)).toBeLessThan(1e-9)
    })
  }

  it('the whole building has no baked bedside quads left: a ward room draws its picture only through the live layer', () => {
    const layout = buildLayout()
    for (const r of ROOMS) {
      const inRoom = layout.prims.filter((p) => p.shape === 'quad' && p.position[0] > r.rect.x0 && p.position[0] < r.rect.x1 && p.position[2] > r.rect.z0 && p.position[2] < r.rect.z1)
      expect(inRoom, r.id).toHaveLength(0)
    }
  })
})
