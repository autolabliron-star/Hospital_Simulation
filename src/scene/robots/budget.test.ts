/**
 * The robots' budget (W2): the rail is at most 4 draw calls and 30 k triangles, and the pods stay at the six draw calls they had
 * on the floor (the blob shadow is gone, the bogie and the hatches are in). Counted from the real geometry and instance counts.
 */
import { describe, expect, it } from 'vitest'
import { ROBOT } from '@/sim/places'
import { ROBOT_LIMITS, budgetLine, totalOf, triangleCount } from './budget'
import { POD_COUNT, robotsBudget } from './manifest'
import { podHatchGeometry } from './podParts'

describe('robots budget', () => {
  const lines = robotsBudget()
  const rail = lines.filter((l) => l.name.startsWith('rail.'))
  const pods = lines.filter((l) => l.name.startsWith('pods.'))

  it('prints the breakdown (for the report)', () => {
    const rows = lines.map((l) => `${l.name.padEnd(14)} ${l.drawCalls} call ${String(Math.round(l.triangles)).padStart(6)} tris`)
    const t = totalOf(lines)
    console.log([...rows, `rail   ${totalOf(rail).drawCalls} calls / ${Math.round(totalOf(rail).triangles)} tris`, `pods   ${totalOf(pods).drawCalls} calls / ${Math.round(totalOf(pods).triangles)} tris`, `robots ${t.drawCalls} calls / ${Math.round(t.triangles)} tris`].join('\n'))
    expect(lines.length).toBe(rail.length + pods.length)
  })

  it('draws the whole rail in at most 4 draw calls and 30 k triangles', () => {
    expect(rail.length).toBeGreaterThan(0)
    expect(totalOf(rail).drawCalls).toBeLessThanOrEqual(ROBOT_LIMITS.railDrawCalls)
    expect(totalOf(rail).triangles).toBeLessThanOrEqual(ROBOT_LIMITS.railTriangles)
  })

  it('keeps the pods at six draw calls (unchanged from the floor pods), at most 10 of them, with no blob shadow', () => {
    expect(POD_COUNT).toBe(ROBOT.podsPerWard * 2)
    expect(POD_COUNT).toBeLessThanOrEqual(10)
    expect(pods.length).toBe(ROBOT_LIMITS.podDrawCalls)
    expect(totalOf(pods).drawCalls).toBe(6)
    expect(pods.map((l) => l.name).sort()).toEqual(['pods.body', 'pods.bogie', 'pods.face', 'pods.hatches', 'pods.lids', 'pods.ring'])
  })

  it('has no floor lanes or zebra left (the lanes meshes are gone)', () => {
    expect(lines.some((l) => /lane|zebra|shadow/i.test(l.name))).toBe(false)
  })

  it('counts every mesh as one draw call with real geometry, and the hatch mesh as four instances per pod', () => {
    for (const l of lines) {
      expect(l.drawCalls, l.name).toBe(1)
      expect(l.triangles, l.name).toBeGreaterThan(0)
    }
    const hatch = podHatchGeometry()
    expect(lines.find((l) => l.name === 'pods.hatches')!.triangles).toBe(triangleCount(hatch) * POD_COUNT * 4)
    hatch.dispose()
  })

  it('does the bookkeeping right', () => {
    const hatch = podHatchGeometry()
    expect(budgetLine('x', hatch, 3).triangles).toBe(triangleCount(hatch) * 3)
    expect(totalOf([budgetLine('a', hatch), budgetLine('b', hatch, 2)])).toEqual({ drawCalls: 2, triangles: triangleCount(hatch) * 3 })
    hatch.dispose()
  })
})
