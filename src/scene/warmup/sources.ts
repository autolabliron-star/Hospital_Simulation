/**
 * What the warm-up knows without being told by a feature: the shared palette. materials.ts keeps `ALL_MATERIALS` "for the shader warm-up", so
 * every palette material is made ready even if no mesh holds it at the moment. Everything on a mesh needs no entry: the traversal finds it.
 */
import { ALL_MATERIALS } from '@/scene/materials'
import { registerWarmSource } from './registry'

/** Register the built-in sources. Returns the function that removes them. */
export function registerDefaultWarmSources(): () => void {
  return registerWarmSource({ name: 'palette', materials: () => ALL_MATERIALS })
}
