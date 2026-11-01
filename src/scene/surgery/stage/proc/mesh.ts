/**
 * R5 wave 3 (agent J): the procedure rooms' stage mesh is the wave-2 `StageMesh` (typed arrays, a rebuild writes over them) with vertices given in the PATIENT'S frame:
 * `z` along the table toward the feet from the pelvis, `x` across, `h` above the pad's top. The mesh's own matrix carries that frame to the room (the table's place and
 * heading: runtime.ts), so a table that travels into the CT's bore costs one matrix. Triangles, normals and grids are the wave-2 ones (../mesh.ts).
 */
import { MAX_VERTS } from '../mesh'
import type { StageMesh } from '../mesh'

/** Add a vertex at (`z`, `x`, `h`) of the patient's frame in the current colour (stored as (x, h, z): x across, y up, z along); returns its index. */
export function addV(m: StageMesh, z: number, x: number, h: number): number {
  if (m.nv >= MAX_VERTS) {
    m.overflow = true
    return MAX_VERTS - 1
  }
  const i = m.nv++
  const o = i * 3
  m.pos[o] = x
  m.pos[o + 1] = h
  m.pos[o + 2] = z
  m.nrm[o] = 0
  m.nrm[o + 1] = 0
  m.nrm[o + 2] = 0
  m.col[o] = m.r
  m.col[o + 1] = m.g
  m.col[o + 2] = m.b
  return i
}
