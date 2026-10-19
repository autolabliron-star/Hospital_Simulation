/**
 * The roof cap's geometry (R2): the boxes of layout/roofCap.ts merged into at most two meshes' worth of buffers, one per material (the cap grey `wallCap`
 * and `glass` for the atrium's skylight). Pure three.js (no DOM, no React), so the two-draw-call budget is measured in node.
 */
import { BoxGeometry, BufferGeometry, Matrix4 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { buildRoofCap, type CapBox } from '../layout/roofCap'

export interface CompiledCap {
  /** The deck, skirt, parapet and skylight rails, in `wallCap` (null if there are none). */
  body: BufferGeometry | null
  /** The skylight pane, in `glass`. */
  glass: BufferGeometry | null
}

function merged(boxes: readonly CapBox[]): BufferGeometry | null {
  if (boxes.length === 0) return null
  const m = new Matrix4()
  const parts = boxes.map((b) => {
    const g = new BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0)
    g.applyMatrix4(m.makeTranslation((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2))
    return g
  })
  const out = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  return out
}

export function compileRoofCap(boxes: readonly CapBox[] = buildRoofCap()): CompiledCap {
  return { body: merged(boxes.filter((b) => b.mat === 'wallCap')), glass: merged(boxes.filter((b) => b.mat === 'glass')) }
}

const triangles = (g: BufferGeometry | null): number => (g?.index ? g.index.count / 3 : 0)

/** Draw calls (one per non-empty mesh) and triangles of a compiled cap. */
export function estimateCapBudget(c: CompiledCap): { drawCalls: number; triangles: number } {
  return { drawCalls: (c.body ? 1 : 0) + (c.glass ? 1 : 0), triangles: triangles(c.body) + triangles(c.glass) }
}

export function disposeCap(c: CompiledCap): void {
  c.body?.dispose()
  c.glass?.dispose()
}
