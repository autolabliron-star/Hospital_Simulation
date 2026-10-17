/** Draw-call and triangle bookkeeping for the node budget test: one line per mesh, computed from the real geometry. */
import type { BufferGeometry } from 'three'

export interface BudgetLine {
  name: string
  drawCalls: number
  triangles: number
}

/** W2: what the robots may spend. The rail (static, merged) and the pods (instanced, one mesh per part). */
export const ROBOT_LIMITS = {
  /** The rail: body, hanger clamps and light lines, merged per material. */
  railDrawCalls: 4,
  railTriangles: 30_000,
  /** The pods were six meshes before the move to the ceiling (skirt, body, ring, face, lids, blob shadow) and stay six. */
  podDrawCalls: 6,
} as const

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
