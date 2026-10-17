/**
 * What the rest of the app (the M4 HUD, the camera) uses to talk to the crowd without importing the renderer: which person is selected,
 * followed or hovered, and a ray test against the live people. No GL in here.
 */
import type { Raycaster } from 'three'
import type { CrowdModel } from './model'

/** The emphasis states. The renderer reads them every frame: a rim light on the person and a ring on the ground. */
export const highlight: { selectedId: string | null; followId: string | null; hoverId: string | null } = { selectedId: null, followId: null, hoverId: null }

export function setSelectedPerson(id: string | null): void {
  highlight.selectedId = id
}
export function setFollowedPerson(id: string | null): void {
  highlight.followId = id
}
export function setHoveredPerson(id: string | null): void {
  highlight.hoverId = id
}

let active: CrowdModel | null = null
export function setActiveCrowd(model: CrowdModel | null): void {
  active = model
}
export function activeCrowd(): CrowdModel | null {
  return active
}

/**
 * The entity id of the person under the ray, nearest first, or null. The ray is tested against a capsule per person (standing,
 * seated or lying) whose radius grows with distance. Call it from a click handler; it is not for use every frame.
 */
export function pickPerson(raycaster: Raycaster): string | null {
  if (!active) return null
  const o = raycaster.ray.origin
  const d = raycaster.ray.direction
  return active.pick(o.x, o.y, o.z, d.x, d.y, d.z, raycaster.far)
}
