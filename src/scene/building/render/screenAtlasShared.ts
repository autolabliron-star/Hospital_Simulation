/**
 * The screen atlas of the building's static screens (bedside, desks, kiosks, monitors), shared by both levels (R2): one canvas texture and one
 * material, painted once, whichever level's meshes use it. Reference counted so the last level to unmount disposes it. Browser only.
 */
import type { CanvasTexture, MeshBasicMaterial } from 'three'
import { createScreenAtlas } from './screens'

let atlas: { texture: CanvasTexture; material: MeshBasicMaterial } | null = null
let users = 0

export function acquireScreenAtlas(): { texture: CanvasTexture; material: MeshBasicMaterial } {
  atlas ??= createScreenAtlas()
  users++
  return atlas
}

export function releaseScreenAtlas(): void {
  users = Math.max(0, users - 1)
  if (users === 0 && atlas) {
    atlas.texture.dispose()
    atlas.material.dispose()
    atlas = null
  }
}
