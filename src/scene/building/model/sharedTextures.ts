/**
 * The zones' material textures (KTX2 in public/assets/building/materials/, named by every zone glb as an external image URI such as
 * `../../materials/Terrazzo_diff.ktx2`) are transcoded and uploaded ONCE and shared by every zone: one Texture per file, keyed by its
 * normalised URL. A GLTFLoader plugin that takes over `KHR_texture_basisu` hands the parser the shared texture instead of loading the file
 * again; GLTFLoader clones it where a material needs another uv channel or transform, and a clone shares the GPU upload (three keys uploads by
 * the texture's Source). Embedded images (the pilot glb) take three's normal path. Never disposed on a Jump: the building is static.
 */
import type { Texture } from 'three'
import type { GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { normalizeUrl } from './manifest'

export interface Ktx2Source {
  loadAsync(url: string): Promise<Texture>
}

/** The loader shape `GLTFParser.loadTextureImage` calls. */
interface ImageLoaderLike {
  load(url: string, onLoad: (t: Texture) => void, onProgress?: unknown, onError?: (e: unknown) => void): void
}

interface GltfJsonLike {
  textures?: { extensions?: Record<string, { source?: number }> }[]
  images?: { uri?: string; bufferView?: number }[]
}

export class SharedTextures {
  private readonly pending = new Map<string, Promise<Texture>>()
  private readonly ready = new Map<string, Texture>()
  private ktx2: Ktx2Source | null

  constructor(ktx2: Ktx2Source) {
    this.ktx2 = ktx2
  }

  /** Swap the transcoder (the zone runtime frees its worker pool when everything is loaded and makes a new one if it ever needs it again). */
  setTranscoder(ktx2: Ktx2Source): void {
    this.ktx2 = ktx2
  }

  /** The shared texture of a file, loading it once. A failed load is forgotten, so a later zone may try again. */
  load(url: string): Promise<Texture> {
    const key = normalizeUrl(url)
    const known = this.pending.get(key)
    if (known) return known
    if (!this.ktx2) return Promise.reject(new Error(`no transcoder for ${key}`))
    const p = this.ktx2.loadAsync(key).then((t) => {
      this.ready.set(key, t)
      return t
    })
    p.catch(() => this.pending.delete(key))
    this.pending.set(key, p)
    return p
  }

  get(url: string): Texture | undefined {
    return this.ready.get(normalizeUrl(url))
  }

  has(url: string): boolean {
    return this.ready.has(normalizeUrl(url))
  }

  /** Every texture loaded so far (for the warm-up's upload list). */
  textures(): Texture[] {
    return [...this.ready.values()]
  }

  get size(): number {
    return this.ready.size
  }

  /** The GLTFLoader plugin: `loader.register(shared.plugin())`. */
  plugin(): (parser: GLTFParser) => GLTFLoaderPlugin {
    const loader: ImageLoaderLike = {
      load: (url, onLoad, _p, onError) => {
        this.load(url).then(onLoad, (e) => onError?.(e))
      },
    }
    return (parser: GLTFParser) => ({
      name: 'KHR_texture_basisu',
      loadTexture: (textureIndex: number) => {
        const json = parser.json as GltfJsonLike
        const ext = json.textures?.[textureIndex]?.extensions?.KHR_texture_basisu
        if (!ext || ext.source === undefined) return null as unknown as Promise<Texture>
        const image = json.images?.[ext.source]
        const own = (parser.options as { ktx2Loader?: ImageLoaderLike }).ktx2Loader
        // an embedded image is the glb's own: three's normal path with its KTX2 loader
        const via = image?.uri ? loader : own
        if (!via) throw new Error('THREE.GLTFLoader: no KTX2 loader for an embedded KTX2 image')
        return (parser as unknown as { loadTextureImage(i: number, s: number, l: ImageLoaderLike): Promise<Texture> }).loadTextureImage(textureIndex, ext.source, via)
      },
    })
  }

  dispose(): void {
    for (const t of this.ready.values()) t.dispose()
    this.ready.clear()
    this.pending.clear()
  }
}
