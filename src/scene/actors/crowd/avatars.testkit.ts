// W3 wave B: a test kit, not shipped (nothing but tests imports it). It loads the converted people from public/assets/people the way the game does
// (three's GLTFLoader with the bundled MeshoptDecoder, the binds checked against index.json), but from disk in node, with a stand-in texture for each
// atlas (no image decoding in node), and skins a mesh on the CPU exactly as the avatar vertex shader does.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Texture, type BufferAttribute, type InstancedBufferGeometry } from 'three'
import { PART_COUNT, ROW_FLOATS, TEX } from './constants'
import { skinPoint, type AvatarEntry, type PeopleIndex } from './avatars'
import { avatarGltfLoader, parseAvatarGlb, type LoadedAvatar, type LoadedPeople } from './avatarLoader'

const here = path.dirname(fileURLToPath(import.meta.url))
export const PEOPLE_PATH = path.join(here, '../../../../public/assets/people')

export function readIndex(): PeopleIndex {
  return JSON.parse(readFileSync(path.join(PEOPLE_PATH, 'index.json'), 'utf8')) as PeopleIndex
}

/** One LOD of an avatar as the game's instanced body (position, normal, uv, aJoints, aWeights). */
export async function loadBody(entry: AvatarEntry, lod: number): Promise<InstancedBufferGeometry> {
  const buf = readFileSync(path.join(PEOPLE_PATH, entry.lods[lod].file))
  return parseAvatarGlb(avatarGltfLoader(), buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, entry, entry.lods[lod].file)
}

let cache: Promise<LoadedPeople> | null = null

/** Every avatar with its three LODs and a stand-in atlas texture, as `loadPeople` gives them in the browser (loaded once per test file). */
export function loadPeopleFromDisk(): Promise<LoadedPeople> {
  if (!cache) {
    cache = (async () => {
      const index = readIndex()
      let bytes = 0
      const avatars: LoadedAvatar[] = []
      for (const entry of index.avatars) {
        const lods = (await Promise.all([0, 1, 2].map((l) => loadBody(entry, l)))) as LoadedAvatar['lods']
        const atlas = new Texture()
        atlas.name = `crowd-atlas-${entry.id}`
        bytes += entry.lods.reduce((s, l) => s + l.bytes, 0) + entry.texture.bytes
        avatars.push({ entry, lods, atlas })
      }
      return { avatars, bytes }
    })()
  }
  return cache
}

export interface CpuMesh {
  pos: Float32Array
  joints: Float32Array
  weights: Float32Array
  index: ArrayLike<number>
  count: number
}

/** The body's vertex data as plain arrays (dequantised). */
export function cpuMesh(g: InstancedBufferGeometry): CpuMesh {
  const read = (name: string, size: number) => {
    const a = g.getAttribute(name) as BufferAttribute
    const out = new Float32Array(a.count * size)
    for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) out[i * size + c] = a.getComponent(i, c)
    return out
  }
  const pos = read('position', 3)
  return { pos, joints: read('aJoints', 4), weights: read('aWeights', 4), index: g.index!.array as ArrayLike<number>, count: pos.length / 3 }
}

/** Skin every vertex with a block of PART_COUNT rows (binds applied), as the vertex shader does: positions in the person's root frame. */
export function skinAll(m: CpuMesh, rows: ArrayLike<number>): Float32Array {
  const out = new Float32Array(m.count * 3)
  const p = [0, 0, 0]
  const j = [0, 0, 0, 0]
  const w = [0, 0, 0, 0]
  for (let v = 0; v < m.count; v++) {
    for (let k = 0; k < 4; k++) {
      j[k] = Math.round(m.joints[v * 4 + k])
      w[k] = m.weights[v * 4 + k]
    }
    skinPoint(rows, j, w, m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2], p)
    out[v * 3] = p[0]
    out[v * 3 + 1] = p[1]
    out[v * 3 + 2] = p[2]
  }
  return out
}

/** The part block (PART_COUNT x 12 floats) of a person's row of the pose texture. */
export function rowParts(data: Float32Array, row: number): Float32Array {
  const o = row * ROW_FLOATS + TEX.parts * 4
  return data.subarray(o, o + PART_COUNT * 12)
}
