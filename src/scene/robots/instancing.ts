/** Small helpers for InstancedMeshes that are rewritten every frame. */
import type { Color, InstancedMesh } from 'three'

/**
 * Give every instance a colour. Doing this before the first draw creates `instanceColor` up front, so the shader
 * variant with instance colours compiles once at start-up instead of when the first colour is written mid-demo.
 */
export function prime(mesh: InstancedMesh | null, color: Color): void {
  if (!mesh) return
  for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, color)
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

/** Collapse every instance (all-zero matrices draw nothing), so unit-size boxes do not flash at the origin before the first frame writes real poses. */
export function hideInstances(mesh: InstancedMesh | null): void {
  if (!mesh) return
  mesh.instanceMatrix.array.fill(0)
  mesh.instanceMatrix.needsUpdate = true
}
