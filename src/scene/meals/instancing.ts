/** Small helpers for the L1 InstancedMeshes (the same idea as the robots' helpers, kept local so the features stay independent). */
import type { Color, InstancedMesh } from 'three'

/** Give every instance a colour before the first draw, so the shader variant with instance colours compiles once, at start-up. */
export function primeColors(mesh: InstancedMesh | null, color: Color): void {
  if (!mesh) return
  for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, color)
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

/** Collapse every instance (all-zero matrices draw nothing) so unit-size shapes never flash at the origin before the first frame. */
export function hideAll(mesh: InstancedMesh | null): void {
  if (!mesh) return
  mesh.instanceMatrix.array.fill(0)
  mesh.instanceMatrix.needsUpdate = true
}
