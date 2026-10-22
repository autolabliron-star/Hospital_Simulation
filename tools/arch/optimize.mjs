#!/usr/bin/env node
/**
 * arch:build  ->  tools/arch/optimize.mjs: the Blender export -> the shipped game asset.
 *
 *   node tools/arch/optimize.mjs [--in assets-src/arch/out/pilot-lobby.glb] [--lightmaps assets-src/arch/out] [--out public/assets/building/pilot-lobby.glb]
 *                                [--budget-draws 60] [--budget-tris 300000] [--budget-mb 40] [--no-validate]
 *
 * 1. gltf-transform: dedup, weld, prune (keeping every vertex attribute: TEXCOORD_1 is the lightmap's, referenced only from the node extras, so a
 *    plain prune would strip it), reorder, EXT_meshopt_compression (quantized, KHR_mesh_quantization; the plan check applies the node matrices)
 * 2. every node's extras.lightmap (a PNG baked by generate.py --bake) is encoded to KTX2 with the local `ktx` binary (UASTC, sRGB, mipmaps) beside
 *    the .glb, and the extra is rewritten to the .ktx2 file name. Textures embedded in the glb become KTX2 (KHR_texture_basisu) by role: colour
 *    (base colour, emissive) ETC1S sRGB; data (normal, occlusion/roughness/metalness) UASTC linear, since ETC1S blocks wreck normals.
 * 3. the lobby's reflection probe (env_lobby.hdr, rendered by generate.py --probe beside the lightmaps) is copied beside the .glb.
 * 4. gltf-validator (0 errors), then the numbers: triangles, draw calls (nodes with a mesh x primitives), texture MB (the GPU copy of a KTX2 is
 *    transcoded to a 1 byte per pixel format, BC7 / ASTC 4x4, with mips = x 4/3), and the Quest 3 slice for the hero model is enforced (exit 1):
 *    <= 60 draw calls, <= 300k triangles, <= 40 MB of GPU texture memory (lightmaps + material textures).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } from '@gltf-transform/extensions'
import { dedup, getTextureColorSpace, meshopt, prune, reorder, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
import { validateGltfBytes } from '../assets-lib.mjs'
import { acquireLock, readInstalled, writeInstalled } from '../fetch-assets.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const KTX = process.env.KTX_BIN || path.join(os.homedir(), '.local/ktx-software-4.4.2/bin/ktx')

const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const IN = path.resolve(ROOT, opt('in', 'assets-src/arch/out/pilot-lobby.glb'))
const LM_DIR = path.resolve(ROOT, opt('lightmaps', path.dirname(IN)))
const OUT = path.resolve(ROOT, opt('out', 'public/assets/building/pilot-lobby.glb'))
const BUDGET = { draws: Number(opt('budget-draws', 60)), tris: Number(opt('budget-tris', 300000)), mb: Number(opt('budget-mb', 40)) }
const PROBE = 'env_lobby.hdr'
const outDir = path.dirname(OUT)

/** mode: 'uastc' (lightmaps, sRGB), 'etc1s' (colour, sRGB) or 'linear' (normal / ORM data, UASTC). */
const ktxCreate = (input, output, mode) => {
  const linear = mode === 'linear'
  const args = ['create', '--format', linear ? 'R8G8B8_UNORM' : 'R8G8B8_SRGB', '--assign-tf', linear ? 'linear' : 'srgb', '--generate-mipmap']
  if (mode === 'uastc' || linear) args.push('--encode', 'uastc', '--uastc-quality', '2', '--uastc-rdo', '--zstd', '18')
  else args.push('--encode', 'basis-lz', '--clevel', '4', '--qlevel', '128')
  execFileSync(KTX, [...args, input, output], { stdio: ['ignore', 'ignore', 'inherit'] })
}
/** width, height of a KTX2 file (header bytes 20..28). */
const ktx2Size = (file) => {
  const b = readFileSync(file)
  return { w: b.readUInt32LE(20), h: b.readUInt32LE(24), bytes: b.length }
}

if (!existsSync(IN)) throw new Error(`missing ${IN}: run the Blender bake and export first (npm run arch:pilot)`)
if (!existsSync(KTX)) throw new Error(`missing the ktx binary at ${KTX} (KTX-Software 4.4.2, see docs/ASSETS-POLICY.md)`)
await MeshoptEncoder.ready
await MeshoptDecoder.ready

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(IN)
const root = doc.getRoot()

await doc.transform(dedup(), weld(), prune({ keepAttributes: true }), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'high' }))

mkdirSync(outDir, { recursive: true })
for (const f of readdirSync(outDir)) if (/^lm_.*\.ktx2$/.test(f)) rmSync(path.join(outDir, f))

const tmp = mkdtempSync(path.join(os.tmpdir(), 'arch-build-'))
const textures = [] // { name, w, h, bytes }
try {
  // lightmaps: PNG -> KTX2 (UASTC), referenced from the node extras
  const done = new Map()
  for (const node of root.listNodes()) {
    const ex = node.getExtras()
    if (!ex || typeof ex.lightmap !== 'string') continue
    const png = path.join(LM_DIR, ex.lightmap)
    if (!existsSync(png)) throw new Error(`node ${node.getName()} names ${ex.lightmap}, which is not in ${LM_DIR}`)
    const name = ex.lightmap.replace(/\.png$/i, '.ktx2')
    if (!done.has(name)) {
      ktxCreate(png, path.join(outDir, name), 'uastc')
      done.set(name, ktx2Size(path.join(outDir, name)))
      textures.push({ name, ...done.get(name) })
    }
    node.setExtras({ ...ex, lightmap: name })
  }
  // textures embedded in the glb, by role (colour in sRGB, data in linear); sharp normalises the JPEG/PNG the exporter wrote to an RGB PNG
  const embedded = root.listTextures()
  if (embedded.length) {
    doc.createExtension(KHRTextureBasisu).setRequired(true)
    for (const [i, t] of embedded.entries()) {
      const src = path.join(tmp, `t${i}.png`)
      const dst = path.join(tmp, `t${i}.ktx2`)
      await sharp(t.getImage()).removeAlpha().png().toFile(src)
      const mode = getTextureColorSpace(t) === 'srgb' ? 'etc1s' : 'linear'
      ktxCreate(src, dst, mode)
      t.setImage(new Uint8Array(readFileSync(dst))).setMimeType('image/ktx2')
      textures.push({ name: `embedded:${t.getName() || i} (${mode})`, ...ktx2Size(dst) })
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

const glb = await io.writeBinary(doc)
writeFileSync(OUT, glb)

// the reflection probe (Radiance .hdr, linear; an allowed type, docs/ASSETS-POLICY.md) ships beside the model
const probeSrc = path.join(LM_DIR, PROBE)
const probeOut = path.join(outDir, PROBE)
if (existsSync(probeSrc)) {
  const head = readFileSync(probeSrc).subarray(0, 10).toString('latin1')
  if (!head.startsWith('#?RADIANCE') && !head.startsWith('#?RGBE')) throw new Error(`${probeSrc} is not a Radiance HDR`)
  copyFileSync(probeSrc, probeOut)
}

// record the shipped files as derived assets (docs/ASSETS-POLICY.md, "Authored assets"), under the gate's shared lock
const sha256Of = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const shipped = [OUT, ...textures.filter((t) => !t.name.startsWith('embedded:')).map((t) => path.join(outDir, t.name)), ...(existsSync(probeOut) ? [probeOut] : [])]
const release = await acquireLock(ROOT)
try {
  const installed = await readInstalled(ROOT)
  const rel = (f) => path.relative(path.join(ROOT, 'public/assets'), f)
  const files = shipped.map((f) => ({ path: rel(f), sha256: sha256Of(f), bytes: statSync(f).size, role: 'derived', tool: 'tools/arch/optimize.mjs' }))
  installed.assets[`arch-${path.basename(OUT, '.glb')}`] = {
    kind: 'building',
    type: 'glb',
    source: { url: null, page: null, commit: null, local: null },
    licence: 'Own work (generated by tools/arch/generate.py); textures CC0, see docs/CREDITS.md',
    licenceUrl: null,
    author: 'The Ideal Hospital (tools/arch)',
    notes: 'Authored architecture: Blender generate.py export, meshopt geometry, KTX2 textures and lightmaps (tools/arch/optimize.mjs).',
    sha256: files[0].sha256,
    bytes: files[0].bytes,
    files,
    validator: null,
    fetchedAt: new Date().toISOString(),
  }
  await writeInstalled(installed, ROOT)
} finally {
  await release()
}

// --- the numbers --------------------------------------------------------------------------------------------------------------------------------
let tris = 0
let draws = 0
for (const node of root.listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  for (const prim of mesh.listPrimitives()) {
    draws++
    const idx = prim.getIndices()
    tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3
  }
}
const texMB = textures.reduce((s, t) => s + (t.w * t.h * 4) / 3, 0) / (1024 * 1024)
const fileKB = (f) => (statSync(f).size / 1024).toFixed(0)
const verdict = await validateGltfBytes(glb, { uri: path.basename(OUT), throwOnErrors: false, resolveExternal: async () => new Uint8Array(0) })

console.log(`wrote ${path.relative(ROOT, OUT)}  ${fileKB(OUT)} KB  (validator: ${verdict.errors} errors, ${verdict.warnings} warnings)`)
for (const t of textures) console.log(`  ${t.name}  ${t.w}x${t.h}  ${(t.bytes / 1024).toFixed(0)} KB on disk  ${((t.w * t.h * 4) / 3 / 1048576).toFixed(2)} MB GPU`)
console.log(`triangles   ${tris}  (budget ${BUDGET.tris})`)
console.log(`draw calls  ${draws}  (budget ${BUDGET.draws})`)
console.log(`texture MB  ${texMB.toFixed(2)}  (budget ${BUDGET.mb})`)
const fails = []
if (verdict.errors > 0) fails.push(`validator: ${verdict.errorMessages.join(' | ')}`)
if (draws > BUDGET.draws) fails.push(`draw calls ${draws} > ${BUDGET.draws}`)
if (tris > BUDGET.tris) fails.push(`triangles ${tris} > ${BUDGET.tris}`)
if (texMB > BUDGET.mb) fails.push(`texture memory ${texMB.toFixed(1)} MB > ${BUDGET.mb}`)
if (fails.length) {
  console.error('OVER BUDGET / INVALID: ' + fails.join('; '))
  process.exit(1)
}
if (existsSync(probeOut)) console.log(`  ${PROBE}  ${(statSync(probeOut).size / 1024).toFixed(0)} KB (reflection probe, Radiance HDR)`)
console.log('within the hero model budget (Quest 3 slice)')
