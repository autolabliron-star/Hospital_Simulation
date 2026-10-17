/**
 * What the L1 look adds to the draw-call and triangle budget at the default view, counted from the real geometry and the real
 * instance counts (the node budget test checks it against the L1 brief: at most 12 extra draw calls and 60 k triangles).
 *
 * Not counted because they add no draw call: the over-bed tables and the door-tile-free parts of the static room, which merge into the
 * building's existing meshes (their triangles are counted by `overBedTableTriangles` in the test), and the daylight driver (uniforms).
 * Moving things never cast into the baked shadow map, so none of these is drawn into the shadow pass.
 */
import { botDoorGeometry, botRingGeometry, botShadowGeometry, botStaticGeometry, SHELF_COUNT } from './botParts'
import { MAX_BOTS } from './life'
import { trayBaseGeometry, trayClocheGeometry } from './trayParts'
import { backrestGeometry, bedsideQuadGeometry, doorTileGeometry } from './ward/wardParts'
import { nightLightsGeometry } from '@/scene/daylight/nightLights'
import { ROOMS } from '@/sim/places'
import type { BufferGeometry } from 'three'

const ROOM_COUNT = ROOMS.length

export interface BudgetLine {
  name: string
  drawCalls: number
  triangles: number
}

export function triangleCount(g: BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.getAttribute('position').count / 3
}

/** One mesh, or one InstancedMesh of `instances` copies, in a single draw call. */
export function budgetLine(name: string, geometry: BufferGeometry, instances = 1): BudgetLine {
  return { name, drawCalls: 1, triangles: triangleCount(geometry) * instances }
}

export function totalOf(lines: readonly BudgetLine[]): { drawCalls: number; triangles: number } {
  return lines.reduce((t, l) => ({ drawCalls: t.drawCalls + l.drawCalls, triangles: t.triangles + l.triangles }), { drawCalls: 0, triangles: 0 })
}

/** One line per mesh: the shadow blob, the body, the shutter and the ring of every MealBot, the trays, and the three ward parts. */
export function mealsBudget(): BudgetLine[] {
  const parts: [string, BufferGeometry, number][] = [
    ['bots.shadow', botShadowGeometry(), MAX_BOTS],
    ['bots.static', botStaticGeometry(), MAX_BOTS],
    ['bots.door', botDoorGeometry(), MAX_BOTS],
    ['bots.ring', botRingGeometry(), MAX_BOTS],
    ['trays.base', trayBaseGeometry(), ROOM_COUNT + MAX_BOTS * SHELF_COUNT],
    ['trays.cloche', trayClocheGeometry(), ROOM_COUNT],
    ['ward.backrests', backrestGeometry(), ROOM_COUNT],
    ['ward.doorTiles', doorTileGeometry(), ROOM_COUNT],
    ['ward.bedsideScreens', bedsideQuadGeometry(), ROOM_COUNT],
  ]
  const lines = parts.map(([name, g, n]) => budgetLine(name, g, n))
  for (const [, g] of parts) g.dispose()
  return lines
}

/** The corridor night lights: one mesh, drawn only at night (so it is not in the default-view total by day). */
export function nightLightsLine(): BudgetLine {
  const g = nightLightsGeometry()
  const line = budgetLine('daylight.nightLights', g, 1)
  g.dispose()
  return line
}

export function mealsTotal(): { drawCalls: number; triangles: number } {
  return totalOf([...mealsBudget(), nightLightsLine()])
}
