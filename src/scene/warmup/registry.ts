/**
 * Things the warm-up must make ready that are NOT reachable by walking the mounted scene: a material that no mesh holds yet (the palette keeps
 * every material "for the shader warm-up"), or a texture that only a later object will use. A feature that creates something like that on
 * demand registers it here (a registry, so the feature never imports the warm-up and the warm-up never imports the feature).
 *
 * Everything that sits on a mesh in the scene needs no registration: the traversal finds it, hidden or not.
 */
import type { Material, Texture } from 'three'

export interface WarmSource {
  /** Shown in the probe and in test failures. */
  name: string
  materials?: () => readonly Material[]
  textures?: () => readonly Texture[]
}

const sources = new Map<string, WarmSource>()

/** Register (or replace, by name) a source. Returns the function that removes it. */
export function registerWarmSource(source: WarmSource): () => void {
  sources.set(source.name, source)
  return () => {
    if (sources.get(source.name) === source) sources.delete(source.name)
  }
}

export interface WarmExtras {
  materials: Material[]
  textures: Texture[]
}

/** Everything registered, de-duplicated. A source that throws is skipped (the warm-up is best effort). */
export function warmExtras(): WarmExtras {
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  for (const s of sources.values()) {
    try {
      for (const m of s.materials?.() ?? []) materials.add(m)
      for (const t of s.textures?.() ?? []) textures.add(t)
    } catch {
      /* one broken source must not cost the others */
    }
  }
  return { materials: [...materials], textures: [...textures] }
}

export function warmSourceNames(): string[] {
  return [...sources.keys()]
}

/** For tests. */
export function clearWarmSources(): void {
  sources.clear()
}
