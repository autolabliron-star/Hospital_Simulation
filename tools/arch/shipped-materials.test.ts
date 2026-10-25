/**
 * The shipped zones' MATERIALS against the library (tools/arch/materials.json), so a look that differs from the Blender stills is caught here
 * rather than in a walk-through (2026-10-24: the atrium's foliage and every KitPlastic part drew near-black, the ward curtains grey and
 * smudged). For every material of every zone glb in public/assets/building/manifest.json:
 *   - it is a library material, with the library's double-sidedness, roughness and (untextured) base colour;
 *   - metalness 0 unless the library makes it metallic (stated as a factor, not left to a texture channel);
 *   - a palette material keeps its palette (its own `_palette` texture under a white factor);
 *   - each texture is of its slot's kind (base colour `_diff` / `_palette`, normal `_nor`, metallic-roughness `_arm`) and was made from the
 *     picture the library gives THIS material (a shared file such as the speckle set is used only by the materials that name that set);
 *   - `bake: false` materials carry no lightmap, every other non-kit node does;
 *   - every lightmapped node's lightmap UVs give its surface real texels: at least MIN_TEXELS_PER_M2 over its area, and at most
 *     MAX_DEGENERATE of its area on (near) zero-area UV triangles. The packer had shrunk thousands of small islands to nothing (KitPlastic
 *     1-24 texels/m2, Foliage 0) and the whole material read one black texel.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NodeIO, type Document } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

const ROOT = process.cwd()
const BUILDING = path.join(ROOT, 'public/assets/building')
const MANIFEST = path.join(BUILDING, 'manifest.json')
const present = existsSync(MANIFEST)

interface Spec {
  color?: string
  roughness?: number
  metallic?: number
  texture?: string
  process?: unknown
  set?: string
  palette?: string[]
  emission?: string
  glass?: boolean
  doubleSided?: boolean
  bake?: boolean
}
const LIB = JSON.parse(readFileSync(path.join(ROOT, 'tools/arch/materials.json'), 'utf8')) as { materials: Record<string, Spec> }

/** Lightmapped by one top-down projection (bake.py PLANAR): their walls' faces are zero-area in the lightmap by design. */
const PLANAR = new Set(['CeilingTile', 'CeilingGrid', 'AcousticTile'])
/** About 15 cm a texel: the floor of a usable lightmap (the default density is 400 texels/m2). */
const MIN_TEXELS_PER_M2 = 40
const MAX_DEGENERATE = 0.25

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const hexLinear = (hex: string): number[] => [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255))

/**
 * What picture a material's map of one kind is made from (materials.py `_process`): two materials with one key may share the file. The base
 * colour is the photo recoloured by the whole `process`; the normal map only loses the joints; the ARM map also takes the roughness remap.
 */
function sourceKey(name: string, kind: string): string | null {
  const m = LIB.materials[name]
  if (!m) return null
  if (m.palette) return `palette:${name}`
  if (typeof m.set === 'string') return m.set.startsWith('@') ? sourceKey(m.set.slice(1), kind) : `set:${m.set}`
  if (!m.texture) return null
  const pr = (m.process ?? {}) as { removeJoints?: unknown; roughness?: unknown; metal?: unknown }
  if (kind === 'nor') return `texture:${m.texture}:nor:${JSON.stringify(pr.removeJoints ?? null)}`
  if (kind === 'arm') return `texture:${m.texture}:arm:${JSON.stringify([pr.removeJoints ?? null, pr.roughness ?? m.roughness ?? 0.5, pr.metal ?? 0])}`
  return `texture:${m.texture}:diff:${JSON.stringify(m.process ?? {})}`
}

/** The picture a shared material file was made from, by its name (optimize.mjs: `<Material>_<kind>-<sha8>-<enc>.ktx2`, sets `set_<name>_...`). */
function fileSource(uri: string): { key: string | null; kind: string } | null {
  const m = path.basename(uri).match(/^(set_)?(.+?)_(diff|nor|arm|palette)-[0-9a-f]{8}-(etc1s|linear)\.ktx2$/)
  if (!m) return null
  return { key: m[1] ? `set:${m[2]}` : sourceKey(m[2], m[3]), kind: m[3] }
}

interface ZoneRecord {
  id: string
  glb: string
}
const zones: ZoneRecord[] = present ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { zones: ZoneRecord[] }).zones : []

interface GlbJson {
  materials?: {
    name?: string
    doubleSided?: boolean
    pbrMetallicRoughness?: {
      baseColorFactor?: number[]
      metallicFactor?: number
      roughnessFactor?: number
      baseColorTexture?: { index: number }
      metallicRoughnessTexture?: { index: number }
    }
    normalTexture?: { index: number }
  }[]
  textures?: { source?: number; extensions?: { KHR_texture_basisu?: { source: number } } }[]
  images?: { uri?: string }[]
}
function glbJson(file: string): GlbJson {
  const b = readFileSync(file)
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as GlbJson
}

describe.skipIf(!present)('the shipped zone materials follow the library', () => {
  for (const z of zones) {
    it(`${z.id}: every material is the library's (colour, metalness, palette, its own textures)`, () => {
      const j = glbJson(path.join(BUILDING, z.glb))
      const uriOf = (ref?: { index: number }): string | null => {
        if (!ref) return null
        const t = j.textures![ref.index]
        const src = t.extensions?.KHR_texture_basisu?.source ?? t.source
        return src === undefined ? null : (j.images![src].uri ?? null)
      }
      const problems: string[] = []
      for (const m of j.materials ?? []) {
        const name = m.name ?? '?'
        const spec = LIB.materials[name]
        if (!spec) {
          problems.push(`${name}: not a library material`)
          continue
        }
        const pbr = m.pbrMetallicRoughness ?? {}
        if (!!m.doubleSided !== !!spec.doubleSided) problems.push(`${name}: doubleSided ${!!m.doubleSided}, library ${!!spec.doubleSided}`)
        const metal = pbr.metallicFactor ?? 1
        if ((spec.metallic ?? 0) > 0 ? metal <= 0 : metal !== 0) problems.push(`${name}: metallicFactor ${pbr.metallicFactor}, library metallic ${spec.metallic ?? 0}`)
        const factor = pbr.baseColorFactor ?? [1, 1, 1, 1]
        if (factor.some((v) => !(v >= 0 && v <= 1))) problems.push(`${name}: base colour factor ${factor} out of 0..1`)
        const slots: [string, ReturnType<typeof uriOf>, string[]][] = [
          ['baseColor', uriOf(pbr.baseColorTexture), spec.palette ? ['palette'] : ['diff']],
          ['normal', uriOf(m.normalTexture), ['nor']],
          ['metallicRoughness', uriOf(pbr.metallicRoughnessTexture), ['arm']],
        ]
        for (const [slot, uri, kinds] of slots) {
          if (!uri) continue
          const f = fileSource(uri)
          if (!f) problems.push(`${name}: ${slot} ${uri} is not a shared material file`)
          else {
            if (!kinds.includes(f.kind)) problems.push(`${name}: ${slot} binds a '${f.kind}' map (${path.basename(uri)})`)
            if (f.key !== sourceKey(name, f.kind)) problems.push(`${name}: ${slot} binds ${path.basename(uri)}, made for ${f.key}, not this material's ${sourceKey(name, f.kind)}`)
          }
        }
        if (spec.palette) {
          const uri = uriOf(pbr.baseColorTexture)
          if (!uri || fileSource(uri)?.kind !== 'palette') problems.push(`${name}: a palette material without its palette texture`)
          if (factor.slice(0, 3).some((v) => Math.abs(v - 1) > 1e-3)) problems.push(`${name}: palette under a non-white factor ${factor}`)
        }
        const textured = !!(spec.texture || spec.set || spec.palette)
        if (!textured && !spec.emission && !spec.glass && spec.color) {
          const want = hexLinear(spec.color)
          if (want.some((v, i) => Math.abs(v - factor[i]) > 0.02)) problems.push(`${name}: base colour ${factor.slice(0, 3).map((v) => v.toFixed(3))}, library ${spec.color}`)
        }
        if (!pbr.metallicRoughnessTexture && spec.roughness !== undefined && Math.abs((pbr.roughnessFactor ?? 1) - spec.roughness) > 0.01)
          problems.push(`${name}: roughness ${pbr.roughnessFactor}, library ${spec.roughness}`)
      }
      expect(problems).toEqual([])
    })
  }
})

describe.skipIf(!present)('the shipped lightmaps give every baked surface its own texels', () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const read = async (file: string): Promise<Document> => {
    await MeshoptDecoder.ready
    return io.read(file)
  }
  for (const z of zones) {
    it(`${z.id}: lightmapped exactly where the library bakes, at a usable density`, async () => {
      const file = path.join(BUILDING, z.glb)
      const doc = await read(file)
      const problems: string[] = []
      const rows: string[] = []
      for (const node of doc.getRoot().listNodes()) {
        const mesh = node.getMesh()
        if (!mesh) continue
        const extras = node.getExtras() as { lightmap?: string; kitNode?: unknown }
        const kit = !!extras.kitNode || !!(node.getParentNode()?.getExtras() as { kitNode?: unknown } | undefined)?.kitNode
        for (const prim of mesh.listPrimitives()) {
          const name = prim.getMaterial()?.getName() ?? '?'
          const spec = LIB.materials[name]
          const baked = spec?.bake !== false && !spec?.glass
          if (!extras.lightmap) {
            if (baked && !kit && !spec?.emission) problems.push(`${node.getName()} (${name}): no lightmap`)
            continue
          }
          if (!baked) problems.push(`${node.getName()} (${name}): lightmapped, but the library does not bake it`)
          if (PLANAR.has(name)) continue
          const size = readFileSync(path.join(path.dirname(file), extras.lightmap)).readUInt32LE(20)
          const pos = prim.getAttribute('POSITION')!
          const uv = prim.getAttribute('TEXCOORD_1')
          const idx = prim.getIndices()
          if (!uv || !idx) {
            problems.push(`${node.getName()} (${name}): no lightmap UVs`)
            continue
          }
          const W = node.getWorldMatrix()
          const sx = Math.hypot(W[0], W[1], W[2])
          const sy = Math.hypot(W[4], W[5], W[6])
          const sz = Math.hypot(W[8], W[9], W[10])
          const a = [0, 0, 0]
          const b = [0, 0, 0]
          const c = [0, 0, 0]
          const ua = [0, 0]
          const ub = [0, 0]
          const uc = [0, 0]
          let area = 0
          let texels = 0
          let degenerate = 0
          for (let t = 0; t < idx.getCount(); t += 3) {
            const i0 = idx.getScalar(t)
            const i1 = idx.getScalar(t + 1)
            const i2 = idx.getScalar(t + 2)
            pos.getElement(i0, a)
            pos.getElement(i1, b)
            pos.getElement(i2, c)
            uv.getElement(i0, ua)
            uv.getElement(i1, ub)
            uv.getElement(i2, uc)
            const e1 = [(b[0] - a[0]) * sx, (b[1] - a[1]) * sy, (b[2] - a[2]) * sz]
            const e2 = [(c[0] - a[0]) * sx, (c[1] - a[1]) * sy, (c[2] - a[2]) * sz]
            const a3 = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2
            const t2 = (Math.abs((ub[0] - ua[0]) * (uc[1] - ua[1]) - (uc[0] - ua[0]) * (ub[1] - ua[1])) / 2) * size * size
            area += a3
            texels += t2
            if (t2 < 0.01 * a3) degenerate += a3 // under a hundredth of a texel per square metre: no texel of its own
          }
          if (area <= 1e-6) continue
          const density = texels / area
          rows.push(`${name} ${density.toFixed(0)}/m2 ${((degenerate / area) * 100).toFixed(0)}%`)
          if (density < MIN_TEXELS_PER_M2) problems.push(`${name}: ${density.toFixed(1)} lightmap texels/m2 (< ${MIN_TEXELS_PER_M2})`)
          if (degenerate / area > MAX_DEGENERATE) problems.push(`${name}: ${((degenerate / area) * 100).toFixed(0)}% of its area on zero-area lightmap UVs`)
        }
      }
      expect(problems, rows.join(', ')).toEqual([])
    }, 60000)
  }
})
