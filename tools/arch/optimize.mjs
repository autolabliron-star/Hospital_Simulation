#!/usr/bin/env node
/**
 * arch:build  ->  tools/arch/optimize.mjs: the Blender export -> the shipped game asset, zone by zone.
 *
 *   node tools/arch/optimize.mjs --zone <id>|all|<id,id> [--src assets-src/arch/out/zones] [--no-validate]
 *   node tools/arch/optimize.mjs --manifest-only          (rebuild public/assets/building/manifest.json from what is in public/)
 *   node tools/arch/optimize.mjs [--in ...pilot-lobby.glb] [--out public/assets/building/pilot-lobby.glb]   (legacy: the pilot, until the runtime
 *                                                                                                          switches to the zones)
 * Zone mode, for each zone (generate.py wrote assets-src/arch/out/zones/<id>/<id>.glb, lm_*.png, env_<id>.hdr, <id>.meta.json):
 * 1. gltf-transform: dedup, weld, prune (keeping every vertex attribute: TEXCOORD_1 is the lightmap's, referenced only from the node extras, so a
 *    plain prune would strip it), reorder, EXT_meshopt_compression (quantized, KHR_mesh_quantization).
 * 2. lightmaps: every node's extras.lightmap PNG -> public/assets/building/zones/<id>/lm_<Material>.ktx2 (UASTC, sRGB, mips; `ktx` 4.4.2), the
 *    extra rewritten to the .ktx2 name (relative to the glb).
 * 3. SHARED material textures: every texture of the zone (base colour, normal, ORM) is encoded ONCE into public/assets/building/materials/
 *    <stem>-<sha8>.ktx2 (sha of the source image: the same picture in two zones is one file; colour ETC1S sRGB, data UASTC linear) and the glb
 *    references it as an EXTERNAL image (KHR_texture_basisu, uri "../../materials/<file>"): GLTFLoader resolves it against the glb's URL and
 *    loads it with its KTX2Loader. Material textures no zone references any more are deleted.
 * 4. the zone's reflection probe (env_<id>.hdr, Radiance, linear) is copied beside the glb.
 * 5. the zone's OVERVIEW PROXY (./proxy.mjs): one mesh, one unlit material, one baked-colour KTX2 atlas, `zones/<id>/<id>.proxy.glb`, recorded
 *    as `proxy: { glb, tris, mb, atlas, scale }` (the runtime draws it in the overview and for zones far from the walking camera). A proxy that
 *    fails to build is a warning, never a failed build: the zone ships without one and the runtime draws its full model everywhere.
 * 6. gltf-validator (0 errors, the external KTX2 files resolved), the numbers, and the building manifest public/assets/building/manifest.json
 *    (docs/handover/rollout-pipeline.md) with the budgets checked per zone (zones.json budgets.perZone) and in total (shared material textures
 *    counted once); every shipped file is recorded in public/assets/manifest.json as a derived file. Over budget or invalid: exit 1 (files are
 *    still written, the manifest marks the zone `withinBudget: false`).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Logger, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions'
import { dedup, getTextureColorSpace, meshopt, prune, reorder, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
import { validateGltfBytes } from '../assets-lib.mjs'
import { PROXY, buildProxy } from './proxy.mjs'
import { acquireLock, readInstalled, writeInstalled } from '../fetch-assets.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const KTX = process.env.KTX_BIN || path.join(os.homedir(), '.local/ktx-software-4.4.2/bin/ktx')
const BUILDING = path.join(ROOT, 'public/assets/building')
const MAT_DIR = path.join(BUILDING, 'materials')
const MANIFEST = path.join(BUILDING, 'manifest.json')
const ZONES_DOC = JSON.parse(readFileSync(path.join(ROOT, 'tools/arch/zones.json'), 'utf8'))
const MANIFEST_VERSION = 1

const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const flag = (name) => argv.includes(`--${name}`)

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
/** GPU MB of a KTX2 texture: transcoded to a 1 byte per texel format (BC7 / ASTC 4x4), with mips (x 4/3). */
const gpuMB = (w, h) => (w * h * 4) / 3 / (1024 * 1024)
const sha256Of = (buf) => createHash('sha256').update(buf).digest('hex')
const r2 = (v) => Math.round(v * 100) / 100
const relPub = (f) => path.relative(BUILDING, f).split(path.sep).join('/')

if (!existsSync(KTX)) throw new Error(`missing the ktx binary at ${KTX} (KTX-Software 4.4.2, see docs/ASSETS-POLICY.md)`)
await MeshoptEncoder.ready
await MeshoptDecoder.ready
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

const MATERIAL_SPEC = JSON.parse(readFileSync(path.join(ROOT, 'tools/arch/materials.json'), 'utf8')).materials

/**
 * Metalness 0, stated, on every material the library does not make metallic. Blender's exporter writes no metallicFactor (= 1) when the ARM
 * texture's blue channel drives Metallic (Oak, Terrazzo): the texture holds 0 there, so it drew right, but only as long as the compressed blue
 * channel stays 0. Stainless (metallic 1) keeps its factor.
 */
function zeroMetalness(doc) {
  for (const m of doc.getRoot().listMaterials()) {
    const spec = MATERIAL_SPEC[m.getName()]
    if (spec && !(spec.metallic > 0) && m.getMetallicFactor() !== 0) m.setMetallicFactor(0)
  }
}

/** Draw calls (mesh nodes x primitives) and triangles of a document. */
function countDoc(doc) {
  let tris = 0
  let draws = 0
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    for (const prim of mesh.listPrimitives()) {
      draws++
      const idx = prim.getIndices()
      tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3
    }
  }
  return { draws, tris }
}

/** Lightmap PNGs named by node extras -> KTX2 beside the glb; returns [{ name, w, h, bytes }]. */
function encodeLightmaps(doc, lmDir, outDir) {
  const done = new Map()
  for (const node of doc.getRoot().listNodes()) {
    const ex = node.getExtras()
    if (!ex || typeof ex.lightmap !== 'string') continue
    const name = ex.lightmap.replace(/\.png$/i, '.ktx2')
    if (!done.has(name)) {
      const png = path.join(lmDir, ex.lightmap)
      if (!existsSync(png)) throw new Error(`node ${node.getName()} names ${ex.lightmap}, which is not in ${lmDir}`)
      ktxCreate(png, path.join(outDir, name), 'uastc')
      done.set(name, { name, ...ktx2Size(path.join(outDir, name)) })
    }
    node.setExtras({ ...ex, lightmap: name })
  }
  return [...done.values()]
}

/** Assemble a GLB from writeJSON (GLTF format) output: every data buffer merged into the BIN chunk (buffer 0), images keep their URIs. */
function assembleGLB(json, resources, external) {
  const buffers = json.buffers ?? []
  const data = []
  const map = new Map() // old buffer index -> { index, offset }
  let size = 0
  buffers.forEach((b, i) => {
    // meshopt's fallback buffer holds no data (decoders fill it): it never has a uri in a GLB
    if (b.extensions?.EXT_meshopt_compression?.fallback) {
      delete b.uri
      return
    }
    if (b.uri && resources[b.uri] && !external.has(b.uri)) {
      size = Math.ceil(size / 4) * 4
      map.set(i, { index: 0, offset: size })
      data.push({ offset: size, bytes: resources[b.uri] })
      size += resources[b.uri].byteLength
    }
  })
  const rest = buffers.map((b, i) => [b, i]).filter(([, i]) => !map.has(i))
  rest.forEach(([, i], k) => map.set(i, { index: k + (data.length ? 1 : 0), offset: 0 }))
  const bin = new Uint8Array(Math.ceil(size / 4) * 4)
  for (const d of data) bin.set(d.bytes, d.offset)
  for (const bv of json.bufferViews ?? []) {
    const m = map.get(bv.buffer)
    bv.buffer = m.index
    if (m.offset) bv.byteOffset = (bv.byteOffset ?? 0) + m.offset
    const mo = bv.extensions?.EXT_meshopt_compression
    if (mo) {
      const mm = map.get(mo.buffer)
      mo.buffer = mm.index
      if (mm.offset) mo.byteOffset = (mo.byteOffset ?? 0) + mm.offset
    }
  }
  json.buffers = [...(data.length ? [{ byteLength: bin.byteLength }] : []), ...rest.map(([b]) => b)]
  const jsonBytes = Buffer.from(JSON.stringify(json))
  const jsonPad = Buffer.alloc(Math.ceil(jsonBytes.length / 4) * 4, 0x20)
  jsonBytes.copy(jsonPad)
  const chunks = [Buffer.from(new Uint32Array([jsonPad.length, 0x4e4f534a]).buffer), jsonPad]
  if (bin.byteLength) chunks.push(Buffer.from(new Uint32Array([bin.byteLength, 0x004e4942]).buffer), Buffer.from(bin.buffer))
  const body = Buffer.concat(chunks)
  return Buffer.concat([Buffer.from(new Uint32Array([0x46546c67, 2, 12 + body.length]).buffer), body])
}

/** The JSON chunk of a GLB. */
function glbJson(file) {
  const b = readFileSync(file)
  const len = b.readUInt32LE(12)
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'))
}

// --- one zone ------------------------------------------------------------------------------------------------------------------------------------
async function buildZone(zid, srcRoot) {
  const zone = ZONES_DOC.zones.find((z) => z.id === zid)
  if (!zone) throw new Error(`unknown zone ${zid}`)
  const srcDir = path.join(srcRoot, zid)
  const IN = path.join(srcDir, `${zid}.glb`)
  if (!existsSync(IN)) throw new Error(`missing ${path.relative(ROOT, IN)}: bake the zone first (npm run arch:bake -- --zone ${zid} --draft)`)
  const meta = existsSync(path.join(srcDir, `${zid}.meta.json`)) ? JSON.parse(readFileSync(path.join(srcDir, `${zid}.meta.json`), 'utf8')) : {}
  const outDir = path.join(BUILDING, 'zones', zid)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(MAT_DIR, { recursive: true })
  for (const f of readdirSync(outDir)) if (/^lm_.*\.ktx2$|\.glb$|^env_.*\.hdr$|^anchors\.json$/.test(f)) rmSync(path.join(outDir, f))

  const doc = await io.read(IN)
  zeroMetalness(doc)
  // the kit's movable nodes (extras.kitNode): their mesh moves to a child '<name>#mesh', so quantization's corrective transform lands on the
  // child and the named node keeps its pivot (the runtime rotates / slides it)
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh || !node.getExtras()?.kitNode) continue
    node.addChild(doc.createNode(`${node.getName()}#mesh`).setMesh(mesh))
    node.setMesh(null)
  }
  await doc.transform(
    dedup(),
    weld(),
    prune({ keepAttributes: true, keepLeaves: true }),
    reorder({ encoder: MeshoptEncoder }),
    // 16-bit positions (the default 14 bits are 2.7 mm steps over a 45 m zone, each material's node on its own grid): surfaces the designs
    // lay 3-4 mm apart (a tint panel on its wall, a wall's two layers) stayed apart instead of snapping onto one plane and z-fighting.
    // Stored as 16-bit either way: the GPU memory is the same.
    meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 16 }),
  )
  const lightmaps = encodeLightmaps(doc, srcDir, outDir)

  // shared material textures: encoded once, referenced by URI
  const external = new Set()
  const matFiles = []
  const textures = doc.getRoot().listTextures()
  if (textures.length) {
    doc.createExtension(KHRTextureBasisu).setRequired(true)
    const existing = readdirSync(MAT_DIR)
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'arch-mat-'))
    try {
      for (const [i, t] of textures.entries()) {
        const src = t.getImage()
        const sha = sha256Of(src).slice(0, 8)
        const mode = getTextureColorSpace(t) === 'srgb' ? 'etc1s' : 'linear'
        const stem = ((t.getName() || '').match(/^(.*?_(?:diff|nor|arm|palette))/)?.[1] ?? `tex${i}`).replace(/[^A-Za-z0-9_]/g, '_')
        let file = existing.find((f) => f.endsWith(`-${sha}-${mode}.ktx2`))
        if (!file) {
          file = `${stem}-${sha}-${mode}.ktx2`
          const png = path.join(tmp, `t${i}.png`)
          await sharp(src).removeAlpha().png().toFile(png)
          ktxCreate(png, path.join(MAT_DIR, file), mode)
          existing.push(file)
        }
        const uri = `../../materials/${file}`
        t.setImage(new Uint8Array(readFileSync(path.join(MAT_DIR, file)))).setMimeType('image/ktx2').setURI(uri)
        external.add(uri)
        matFiles.push(file)
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  const { json, resources } = await io.writeJSON(doc, { format: 'GLTF' })
  json.scenes?.forEach((s) => (s.extras = { ...(s.extras ?? {}), zone: zid, level: zone.level }))
  const glb = assembleGLB(json, resources, external)
  const OUT = path.join(outDir, `${zid}.glb`)
  writeFileSync(OUT, glb)

  let probe = null
  if (meta.probe && existsSync(path.join(srcDir, meta.probe))) {
    const src = path.join(srcDir, meta.probe)
    const head = readFileSync(src).subarray(0, 10).toString('latin1')
    if (!head.startsWith('#?RADIANCE') && !head.startsWith('#?RGBE')) throw new Error(`${src} is not a Radiance HDR`)
    copyFileSync(src, path.join(outDir, meta.probe))
    probe = path.join(outDir, meta.probe)
  }

  let anchors = null
  if (meta.anchors && existsSync(path.join(srcDir, meta.anchors))) {
    anchors = path.join(outDir, 'anchors.json')
    copyFileSync(path.join(srcDir, meta.anchors), anchors)
  }

  // the overview proxy (never fails the build: a zone without one is drawn in full everywhere)
  let proxy = null
  if (!flag('no-proxy')) {
    try {
      const r = await buildProxy({ io, srcGlb: IN, lmDir: srcDir, outFile: path.join(outDir, `${zid}.proxy.glb`), ktxCreate })
      const pv = flag('no-validate') ? { errors: 0, warnings: 0, errorMessages: [] } : await validateGltfBytes(new Uint8Array(readFileSync(r.file)), { uri: path.basename(r.file), throwOnErrors: false })
      if (pv.errors > 0) throw new Error(`validator: ${pv.errorMessages.join(' | ')}`)
      proxy = { glb: relPub(r.file), tris: r.tris, mb: r.mb, atlas: r.atlas, scale: r.scale, kb: Math.round(r.bytes / 1024) }
      console.log(`[${zid}] proxy ${proxy.glb}  ${proxy.kb} KB, 1 draw, ${r.tris} tris (cap ${PROXY.trisCap}), atlas ${r.atlas} (${r.mb} MB GPU), scale ${r.scale}`)
      if (r.tris > PROXY.trisCap) console.warn(`[${zid}] WARNING: the proxy has ${r.tris} triangles > ${PROXY.trisCap}`)
    } catch (e) {
      rmSync(path.join(outDir, `${zid}.proxy.glb`), { force: true })
      console.warn(`[${zid}] WARNING: no overview proxy (${e instanceof Error ? e.message : String(e)}); the runtime draws the full zone everywhere`)
    }
  }

  const verdict = flag('no-validate')
    ? { errors: 0, warnings: 0, errorMessages: [] }
    : await validateGltfBytes(glb, {
        uri: `${zid}.glb`,
        throwOnErrors: false,
        resolveExternal: async (uri) => new Uint8Array(readFileSync(path.resolve(outDir, decodeURIComponent(uri)))),
      })
  const { draws, tris } = countDoc(doc)
  const lmMB = lightmaps.reduce((s, t) => s + gpuMB(t.w, t.h), 0)
  const B = ZONES_DOC.budgets.perZone
  const fails = []
  if (verdict.errors > 0) fails.push(`validator: ${verdict.errorMessages.join(' | ')}`)
  if (draws > B.draws) fails.push(`draw calls ${draws} > ${B.draws}`)
  if (tris > B.tris) fails.push(`triangles ${tris} > ${B.tris}`)
  if (lmMB > B.lightmapMB) fails.push(`lightmaps ${lmMB.toFixed(1)} MB > ${B.lightmapMB}`)
  const kb = (f) => (statSync(f).size / 1024).toFixed(0)
  console.log(`[${zid}] wrote ${path.relative(ROOT, OUT)}  ${kb(OUT)} KB  (validator: ${verdict.errors} errors, ${verdict.warnings} warnings)`)
  console.log(`[${zid}] draws ${draws}/${B.draws}  tris ${tris}/${B.tris}  lightmaps ${lmMB.toFixed(2)}/${B.lightmapMB} MB (${lightmaps.length} maps)  materials ${new Set(matFiles).size} shared textures`)
  if (fails.length) console.error(`[${zid}] OVER BUDGET / INVALID: ${fails.join('; ')}`)

  return {
    record: {
      id: zid,
      level: zone.level,
      label: zone.label,
      status: zone.status,
      quality: meta.quality ?? null,
      glb: relPub(OUT),
      lightmaps: lightmaps.map((t) => relPub(path.join(outDir, t.name))).sort(),
      materials: [...new Set(matFiles)].sort().map((f) => `materials/${f}`),
      bounds: meta.bounds ?? null,
      draws,
      tris,
      lightmapMB: r2(lmMB),
      ...(probe ? { probe: relPub(probe), probeAt: meta.probeAt } : {}),
      ...(anchors ? { anchors: relPub(anchors) } : {}),
      ...(proxy ? { proxy } : {}),
      nodes: meta.nodes ?? [],
      ...(meta.replaces?.length ? { replaces: meta.replaces } : {}),
      ...(meta.visibleFrom?.length ? { visibleFrom: meta.visibleFrom } : {}),
      bakeSeconds: meta.bake?.seconds ?? null,
      bakedAt: new Date(statSync(IN).mtimeMs).toISOString(),
      validator: { errors: verdict.errors, warnings: verdict.warnings },
      withinBudget: fails.length === 0,
    },
    fails,
    files: [OUT, ...lightmaps.map((t) => path.join(outDir, t.name)), ...(probe ? [probe] : []), ...(anchors ? [anchors] : []), ...(proxy ? [path.join(BUILDING, proxy.glb)] : [])],
  }
}

// --- the building manifest -----------------------------------------------------------------------------------------------------------------------
async function writeBuildingManifest(updated) {
  const old = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { zones: [] }
  const byId = new Map((old.zones ?? []).map((z) => [z.id, z]))
  for (const u of updated) byId.set(u.id, u)
  // keep zones whose glb is still there, in zones.json order
  const zones = ZONES_DOC.zones.map((z) => byId.get(z.id)).filter((z) => z && existsSync(path.join(BUILDING, z.glb)))
  // a proxy whose file is gone is no proxy
  for (const z of zones) if (z.proxy && !existsSync(path.join(BUILDING, z.proxy.glb))) delete z.proxy
  // shared material textures: the files some zone glb references; delete the rest
  const used = new Map() // file -> Set(material names)
  for (const z of zones) {
    const j = glbJson(path.join(BUILDING, z.glb))
    const imgFile = (i) => (j.images?.[i]?.uri ?? '').replace(/^\.\.\/\.\.\/materials\//, '')
    for (const m of j.materials ?? []) {
      const refs = [m.pbrMetallicRoughness?.baseColorTexture, m.pbrMetallicRoughness?.metallicRoughnessTexture, m.normalTexture, m.occlusionTexture, m.emissiveTexture]
      for (const ref of refs) {
        if (!ref) continue
        const tex = j.textures[ref.index]
        const src = tex.extensions?.KHR_texture_basisu?.source ?? tex.source
        const f = imgFile(src)
        if (!f) continue
        if (!used.has(f)) used.set(f, new Set())
        used.get(f).add(m.name)
      }
    }
  }
  mkdirSync(MAT_DIR, { recursive: true })
  const removed = []
  for (const f of readdirSync(MAT_DIR)) if (f.endsWith('.ktx2') && !used.has(f)) (rmSync(path.join(MAT_DIR, f)), removed.push(f))
  const files = [...used.keys()].sort().map((f) => {
    const s = ktx2Size(path.join(MAT_DIR, f))
    return { file: `materials/${f}`, w: s.w, h: s.h, mb: r2(gpuMB(s.w, s.h)), encoding: f.endsWith('-etc1s.ktx2') ? 'etc1s-srgb' : 'uastc-linear', usedBy: [...used.get(f)].sort() }
  })
  const matMB = r2(files.reduce((s, f) => s + gpuMB(f.w, f.h), 0))
  const B = ZONES_DOC.budgets
  const manifest = {
    version: MANIFEST_VERSION,
    generatedBy: 'tools/arch/optimize.mjs',
    frame: 'plan metres AS DRAWN: x east, z south, y up; level 2 stands over the west block at y = 4.2 (its sim x = drawn x + 150)',
    budgets: { perZone: B.perZone, sharedMaterialTexturesMB: B.sharedMaterialTexturesMB },
    zones,
    materials: { files: files.map((f) => f.file), mb: matMB, details: files },
    totals: {
      draws: zones.reduce((s, z) => s + z.draws, 0),
      tris: zones.reduce((s, z) => s + z.tris, 0),
      lightmapMB: r2(zones.reduce((s, z) => s + z.lightmapMB, 0)),
      textureMB: r2(matMB + zones.reduce((s, z) => s + z.lightmapMB, 0) + zones.reduce((s, z) => s + (z.proxy?.mb ?? 0), 0)),
      proxies: zones.filter((z) => z.proxy).length,
      proxyTris: zones.reduce((s, z) => s + (z.proxy?.tris ?? 0), 0),
      proxyMB: r2(zones.reduce((s, z) => s + (z.proxy?.mb ?? 0), 0)),
      withinBudget: zones.every((z) => z.withinBudget) && matMB <= B.sharedMaterialTexturesMB,
    },
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n')
  console.log(`manifest: ${zones.length} zones, ${files.length} shared material textures ${matMB} MB (budget ${B.sharedMaterialTexturesMB})` + (removed.length ? `, removed ${removed.length} unused` : ''))
  return { manifest, fails: matMB > B.sharedMaterialTexturesMB ? [`shared material textures ${matMB} MB > ${B.sharedMaterialTexturesMB}`] : [] }
}

/** public/assets/manifest.json: one derived record per zone (glb, lightmaps, probe) and one for the shared materials + the building manifest. */
async function recordDerived(zoneFiles, manifest) {
  const release = await acquireLock(ROOT)
  try {
    const installed = await readInstalled(ROOT)
    const rel = (f) => path.relative(path.join(ROOT, 'public/assets'), f).split(path.sep).join('/')
    const rec = (files, notes) => {
      const list = files.map((f) => ({ path: rel(f), sha256: sha256Of(readFileSync(f)), bytes: statSync(f).size, role: 'derived', tool: 'tools/arch/optimize.mjs' }))
      return {
        kind: 'building',
        type: 'glb',
        source: { url: null, page: null, commit: null, local: null },
        licence: 'Own work (generated by tools/arch/generate.py); textures CC0, see docs/CREDITS.md',
        licenceUrl: null,
        author: 'The Ideal Hospital (tools/arch)',
        notes,
        sha256: list[0].sha256,
        bytes: list[0].bytes,
        files: list,
        validator: null,
        fetchedAt: new Date().toISOString(),
      }
    }
    for (const [zid, files] of zoneFiles) installed.assets[`arch-zone-${zid}`] = rec(files, `Authored architecture, zone ${zid}: Blender generate.py export, meshopt geometry, KTX2 lightmaps (tools/arch/optimize.mjs); material textures in arch-building.`)
    // zones whose glb is gone lose their record
    for (const k of Object.keys(installed.assets)) if (k.startsWith('arch-zone-') && !manifest.zones.some((z) => `arch-zone-${z.id}` === k)) delete installed.assets[k]
    installed.assets['arch-building'] = rec(
      [MANIFEST, ...manifest.materials.files.map((f) => path.join(BUILDING, f))],
      'The building manifest (zones, budgets) and the shared KTX2 material textures every zone glb references (tools/arch/optimize.mjs).',
    )
    await writeInstalled(installed, ROOT)
  } finally {
    await release()
  }
}

// --- legacy: the pilot lobby (kept until the runtime switches to the zones) -----------------------------------------------------------------------
async function buildPilot() {
  const IN = path.resolve(ROOT, opt('in', 'assets-src/arch/out/pilot-lobby.glb'))
  const LM_DIR = path.resolve(ROOT, opt('lightmaps', path.dirname(IN)))
  const OUT = path.resolve(ROOT, opt('out', 'public/assets/building/pilot-lobby.glb'))
  const BUDGET = { draws: Number(opt('budget-draws', 60)), tris: Number(opt('budget-tris', 300000)), mb: Number(opt('budget-mb', 40)) }
  const PROBE = 'env_lobby.hdr'
  const outDir = path.dirname(OUT)
  if (!existsSync(IN)) throw new Error(`missing ${IN}`)
  const doc = await io.read(IN)
  await doc.transform(dedup(), weld(), prune({ keepAttributes: true }), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'high' }))
  mkdirSync(outDir, { recursive: true })
  for (const f of readdirSync(outDir)) if (/^lm_.*\.ktx2$/.test(f)) rmSync(path.join(outDir, f))
  const textures = encodeLightmaps(doc, LM_DIR, outDir)
  const embedded = doc.getRoot().listTextures()
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'arch-build-'))
  try {
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
  const probeSrc = path.join(LM_DIR, PROBE)
  const probeOut = path.join(outDir, PROBE)
  if (existsSync(probeSrc)) copyFileSync(probeSrc, probeOut)
  const shipped = [OUT, ...textures.filter((t) => !t.name.startsWith('embedded:')).map((t) => path.join(outDir, t.name)), ...(existsSync(probeOut) ? [probeOut] : [])]
  const release = await acquireLock(ROOT)
  try {
    const installed = await readInstalled(ROOT)
    const rel = (f) => path.relative(path.join(ROOT, 'public/assets'), f)
    const files = shipped.map((f) => ({ path: rel(f), sha256: sha256Of(readFileSync(f)), bytes: statSync(f).size, role: 'derived', tool: 'tools/arch/optimize.mjs' }))
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
  const { draws, tris } = countDoc(doc)
  const texMB = textures.reduce((s, t) => s + gpuMB(t.w, t.h), 0)
  const verdict = await validateGltfBytes(glb, { uri: path.basename(OUT), throwOnErrors: false, resolveExternal: async () => new Uint8Array(0) })
  console.log(`wrote ${path.relative(ROOT, OUT)} (validator: ${verdict.errors} errors); triangles ${tris}, draw calls ${draws}, texture MB ${texMB.toFixed(2)}`)
  const fails = []
  if (verdict.errors > 0) fails.push(`validator: ${verdict.errorMessages.join(' | ')}`)
  if (draws > BUDGET.draws) fails.push(`draw calls ${draws} > ${BUDGET.draws}`)
  if (tris > BUDGET.tris) fails.push(`triangles ${tris} > ${BUDGET.tris}`)
  if (texMB > BUDGET.mb) fails.push(`texture memory ${texMB.toFixed(1)} MB > ${BUDGET.mb}`)
  return fails
}

// --- main ----------------------------------------------------------------------------------------------------------------------------------------
const zoneArg = opt('zone', null)
let fails = []
if (zoneArg || flag('manifest-only')) {
  const srcRoot = path.resolve(ROOT, opt('src', 'assets-src/arch/out/zones'))
  const ids = !zoneArg
    ? []
    : zoneArg === 'all'
      ? ZONES_DOC.zones.map((z) => z.id).filter((id) => existsSync(path.join(srcRoot, id, `${id}.glb`)))
      : zoneArg.split(',').filter(Boolean)
  const updated = []
  const zoneFiles = []
  for (const zid of ids) {
    const r = await buildZone(zid, srcRoot)
    updated.push(r.record)
    zoneFiles.push([zid, r.files])
    fails.push(...r.fails.map((f) => `${zid}: ${f}`))
  }
  const { manifest, fails: mf } = await writeBuildingManifest(updated)
  fails.push(...mf)
  await recordDerived(zoneFiles, manifest)
  const t = manifest.totals
  console.log(`building: ${manifest.zones.length} zones, ${t.draws} draws, ${t.tris} triangles, lightmaps ${t.lightmapMB} MB + materials ${manifest.materials.mb} MB + proxies ${t.proxyMB} MB = ${t.textureMB} MB GPU; ${t.proxies} overview proxies (${t.proxies} draws, ${t.proxyTris} triangles)`)
} else {
  fails = await buildPilot()
}
if (fails.length) {
  console.error('OVER BUDGET / INVALID: ' + fails.join('; '))
  process.exit(1)
}
console.log('within budget (Quest 3 slice)')
