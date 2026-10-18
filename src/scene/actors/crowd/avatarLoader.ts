// Ported from Waltz City (src/scene/actors/crowd/avatarLoader.ts, wave 10b). Hospital: every avatar, its three LODs and one 1K atlas (no phone
// plan), and a module-level promise so a second mount (React's strict mode, a remount) reuses the same download.
/**
 * Loads the realistic people for the crowd: public/assets/people/index.json, then for every avatar its LOD glbs (meshopt, decoded by three's
 * bundled MeshoptDecoder: everything is served from public/, nothing comes from a CDN) and its atlas. Each glb's skinned primitive becomes the
 * vertex buffers of an instanced body (position, normal, uv, aJoints, aWeights); its skin's inverse bind matrices must equal the index's B_p^-1,
 * or the avatar is refused. Any failure rejects the whole load, and the crowd simply keeps its procedural bodies.
 */
import { BufferAttribute, InstancedBufferGeometry, LinearMipmapLinearFilter, SRGBColorSpace, TextureLoader, type BufferGeometry, type SkinnedMesh, type Texture } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { PEOPLE_DIR, PEOPLE_INDEX, type AvatarEntry, type PeopleIndex } from './avatars'

export interface LoadedAvatar {
  entry: AvatarEntry
  /** Vertex buffers of the near, mid and far bodies (shared: the renderer wraps them in geometries of its own). */
  lods: [InstancedBufferGeometry, InstancedBufferGeometry, InstancedBufferGeometry]
  atlas: Texture
}

export interface LoadedPeople {
  avatars: LoadedAvatar[]
  /** Bytes fetched (glbs and atlases), for the probe. */
  bytes: number
}

/** The instanced body's vertex buffers from a converted glb's skinned primitive. */
export function bodyGeometry(src: BufferGeometry): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry()
  g.index = src.index
  const need = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']
  for (const n of need) if (!src.getAttribute(n)) throw new Error(`avatar glb has no ${n}`)
  g.setAttribute('position', src.getAttribute('position'))
  g.setAttribute('normal', src.getAttribute('normal'))
  g.setAttribute('uv', src.getAttribute('uv'))
  g.setAttribute('aJoints', src.getAttribute('skinIndex') as BufferAttribute)
  g.setAttribute('aWeights', src.getAttribute('skinWeight') as BufferAttribute)
  g.instanceCount = 0
  return g
}

/** The glb's inverse bind matrices against the index (column-major 4x4 vs row-major 3x4). */
export function bindsMatch(mesh: SkinnedMesh, entry: AvatarEntry): boolean {
  const inv = mesh.skeleton.boneInverses
  if (inv.length !== entry.bindInverse.length / 12) return false
  for (let p = 0; p < inv.length; p++) {
    const e = inv[p].elements
    const b = entry.bindInverse
    const o = p * 12
    const pairs = [[e[0], b[o]], [e[4], b[o + 1]], [e[8], b[o + 2]], [e[12], b[o + 3]], [e[1], b[o + 4]], [e[5], b[o + 5]], [e[9], b[o + 6]], [e[13], b[o + 7]], [e[2], b[o + 8]], [e[6], b[o + 9]], [e[10], b[o + 10]], [e[14], b[o + 11]]]
    for (const [x, y] of pairs) if (Math.abs(x - y) > 1e-3) return false
  }
  return true
}

/** The skinned mesh of a parsed glb, refused unless its binds match the index. */
export async function parseAvatarGlb(loader: GLTFLoader, buf: ArrayBuffer, entry: AvatarEntry, label: string): Promise<InstancedBufferGeometry> {
  const gltf = await loader.parseAsync(buf, '')
  let mesh: SkinnedMesh | null = null
  gltf.scene.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh
  })
  if (!mesh) throw new Error(`${label}: no skinned mesh`)
  const m = mesh as SkinnedMesh
  if (!bindsMatch(m, entry)) throw new Error(`${label}: its bind matrices do not match index.json`)
  const geometry = bodyGeometry(m.geometry)
  ;(Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose())
  return geometry
}

/** The GLTF loader the people use: meshopt decoding, nothing else (the glbs have no images). */
export function avatarGltfLoader(): GLTFLoader {
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  return loader
}

async function loadLod(loader: GLTFLoader, url: string, entry: AvatarEntry): Promise<{ geometry: InstancedBufferGeometry; bytes: number }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  return { geometry: await parseAvatarGlb(loader, buf, entry, url), bytes: buf.byteLength }
}

/** Fetches the index and every avatar. `base` is the site base (import.meta.env.BASE_URL). */
async function fetchPeople(base: string): Promise<LoadedPeople> {
  const res = await fetch(`${base}${PEOPLE_INDEX}`)
  if (!res.ok) throw new Error(`${PEOPLE_INDEX}: HTTP ${res.status}`)
  const index = (await res.json()) as PeopleIndex
  if (index.version !== 1 || !Array.isArray(index.avatars) || index.avatars.length === 0) throw new Error('people index has an unknown shape')
  const loader = avatarGltfLoader()
  const textures = new TextureLoader()
  const dir = `${base}${PEOPLE_DIR}`
  let bytes = 0
  const avatars = await Promise.all(
    index.avatars.map(async (entry): Promise<LoadedAvatar> => {
      if (entry.lods.length !== 3) throw new Error(`${entry.id}: expected three LODs`)
      const [near, mid, far] = await Promise.all(entry.lods.map((l) => loadLod(loader, dir + l.file, entry)))
      const atlas = await textures.loadAsync(dir + entry.texture.file)
      atlas.name = `crowd-atlas-${entry.id}`
      atlas.flipY = false // glTF convention: the converter wrote v down
      atlas.colorSpace = SRGBColorSpace
      atlas.minFilter = LinearMipmapLinearFilter
      atlas.anisotropy = 4
      atlas.needsUpdate = true
      bytes += near.bytes + mid.bytes + far.bytes + entry.texture.bytes
      return { entry, lods: [near.geometry, mid.geometry, far.geometry], atlas }
    }),
  )
  return { avatars, bytes }
}

let cached: Promise<LoadedPeople> | null = null

/**
 * The realistic people, loaded once per page: a second call returns the same promise (a failed load is forgotten, so a later mount may try again).
 * The geometries and atlases are shared by every rig that attaches them.
 */
export function loadPeople(base: string): Promise<LoadedPeople> {
  if (!cached) {
    cached = fetchPeople(base)
    cached.catch(() => {
      cached = null
    })
  }
  return cached
}
