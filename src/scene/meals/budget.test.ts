import { describe, expect, it } from 'vitest'
import { Matrix4 } from 'three'
import { LayoutBuilder, wardFrame } from '@/scene/building/layout/builder'
import { compileLayout, estimateBudget } from '@/scene/building/render/compile'
import { overBedTable } from '@/scene/rooms/patientRoom'
import { OVERBED } from '@/scene/rooms/bedParts'
import { MEALBOT_SIZE, ROOMS } from '@/sim/places'
import { CONFIG } from '@/sim/config'
import { botStaticGeometry } from './botParts'
import { mealsBudget, mealsTotal, nightLightsLine, totalOf } from './budget'
import { MAX_BOTS } from './life'

/** The triangles the 16 over-bed tables add to the building's merged meshes (no extra draw call). */
function overBedTableTriangles(): number {
  const b = new LayoutBuilder()
  b.area = `room:${ROOMS[0].id}`
  const f = wardFrame(b, 'A', ROOMS[0].rect.x0, 16)
  overBedTable(f, 'probe', 3.2, 1.35)
  return estimateBudget(compileLayout(b.finish())).triangles * ROOMS.length
}

describe('L1 look budget (docs/L1-LIVING-DAY.md: <= 12 extra draw calls, <= 60k triangles)', () => {
  const lines = mealsBudget()
  const day = totalOf(lines)
  const tables = overBedTableTriangles()

  it('reports the estimate', () => {
    // eslint-disable-next-line no-console
    console.log(
      `L1 look budget: ${day.drawCalls} draw calls (+1 at night for the corridor lights), ${day.triangles} triangles (+${tables} for the over-bed tables, +${nightLightsLine().triangles} at night)\n` +
        lines.map((l) => `  ${l.name}: ${l.drawCalls} call, ${l.triangles} tris`).join('\n'),
    )
    expect(lines.length).toBeGreaterThan(5)
  })

  it('fits the bots the config builds', () => {
    expect(CONFIG.meals.botsPerWard * 2 + CONFIG.meals.spareBots).toBeLessThanOrEqual(MAX_BOTS)
    expect(MAX_BOTS).toBeLessThanOrEqual(6)
    expect(CONFIG.meals.shelves).toBe(8)
  })

  it('adds at most 12 draw calls (the corridor night lights are the 10th and only drawn at night)', () => {
    expect(day.drawCalls).toBeLessThanOrEqual(11)
    expect(mealsTotal().drawCalls).toBeLessThanOrEqual(12)
  })

  it('adds at most 60k triangles, the tables and the night lights included', () => {
    expect(mealsTotal().triangles + tables).toBeLessThanOrEqual(60_000)
  })

  it('the over-bed table is a small part of a room (no extra draw call: it merges into the building)', () => {
    expect(tables / ROOMS.length).toBeLessThan(3000)
    expect(OVERBED.top).toBeGreaterThan(0.7)
  })

  it('every MealBot part stays inside the footprint the nav and the stops were planned for', () => {
    const g = botStaticGeometry()
    g.computeBoundingBox()
    const bb = g.boundingBox!
    const eps = 0.04 // wheels and the front sensor bar stick out a few centimetres
    expect(bb.max.x - bb.min.x).toBeLessThanOrEqual(MEALBOT_SIZE.w + eps)
    expect(bb.max.z - bb.min.z).toBeLessThanOrEqual(MEALBOT_SIZE.l + eps)
    expect(bb.max.y).toBeLessThanOrEqual(MEALBOT_SIZE.h + 1e-6)
    expect(bb.min.y).toBeGreaterThanOrEqual(0)
    g.dispose()
    expect(new Matrix4().identity().determinant()).toBe(1)
  })
})
