import { describe, expect, it } from 'vitest'
import { drawersBudget } from '../drawers/manifest'
import { totalOf } from '../robots/budget'
import { robotsBudget } from '../robots/manifest'
import { pharmacyBudget } from './manifest'

// M2-ART budget for pharmacy core + robots + drawers together, at the default overview (W2 added the rail, the hanging pods
// and the chutes to it: the rails and chutes are merged per area, at most 6 extra draw calls and 40 k triangles in all).
const MAX_DRAW_CALLS = 60
const MAX_TRIANGLES = 250_000
// The core on its own: 8 static meshes, 4 MedVend meshes, 2 dock lights (port lights and rank contact glow), the portal flaps,
// the two pharmacist doors' leaves and bars, and the desk displays. The W2 changes added no more than one draw call.
const MAX_CORE_DRAW_CALLS = 18
const MAX_CORE_TRIANGLES = 20_000

describe('pharmacy core + robots + drawers budget', () => {
  const pharmacy = pharmacyBudget()
  const robots = robotsBudget()
  const drawers = drawersBudget()
  const all = [...pharmacy, ...robots, ...drawers]
  const total = totalOf(all)

  it('prints the breakdown (for the report)', () => {
    const rows = all.map((l) => `${l.name.padEnd(24)} ${String(l.drawCalls).padStart(2)} calls ${String(Math.round(l.triangles)).padStart(7)} tris`)
    console.log(
      [
        ...rows,
        `pharmacy ${totalOf(pharmacy).drawCalls} calls / ${Math.round(totalOf(pharmacy).triangles)} tris`,
        `robots   ${totalOf(robots).drawCalls} calls / ${Math.round(totalOf(robots).triangles)} tris`,
        `drawers  ${totalOf(drawers).drawCalls} calls / ${Math.round(totalOf(drawers).triangles)} tris`,
        `TOTAL    ${total.drawCalls} calls / ${Math.round(total.triangles)} tris`,
      ].join('\n'),
    )
    expect(all.length).toBeGreaterThan(20)
  })

  it('stays within 60 draw calls', () => {
    expect(total.drawCalls).toBeLessThanOrEqual(MAX_DRAW_CALLS)
  })

  it('stays within 250 k triangles', () => {
    expect(total.triangles).toBeLessThanOrEqual(MAX_TRIANGLES)
  })

  it('the core alone stays within its own budget', () => {
    const t = totalOf(pharmacy)
    expect(t.drawCalls).toBeLessThanOrEqual(MAX_CORE_DRAW_CALLS)
    expect(t.triangles).toBeLessThanOrEqual(MAX_CORE_TRIANGLES)
  })

  it('W2: the floor pads, dock plates and robot doors are gone; the port lights, rank contact glow and portal flaps are in', () => {
    const names = pharmacy.map((l) => l.name)
    for (const gone of ['docks.pads', 'docks.ports', 'core.pads']) expect(names, gone).not.toContain(gone)
    for (const here of ['docks.portLights', 'rank.contactGlow', 'portals.flaps', 'medvend.gantry']) expect(names, here).toContain(here)
    // the door leaves are the two pharmacist doors only: 2 doors x 2 leaves x 2 triangles
    expect(pharmacy.find((l) => l.name === 'doors.glass')!.triangles).toBe(2 * 2 * 2)
    // four flaps' halves x 12 triangles
    expect(pharmacy.find((l) => l.name === 'portals.flaps')!.triangles).toBe(4 * 2 * 12)
  })

  it('every mesh is one draw call and has geometry', () => {
    for (const l of all) {
      expect(l.drawCalls, l.name).toBe(1)
      expect(l.triangles, l.name).toBeGreaterThan(0)
    }
  })
})
