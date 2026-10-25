/**
 * The OVERVIEW PROXY of a zone (one mesh, one unlit material, one texture): what the runtime draws for a zone seen from far away (the overview,
 * zones not near the walking camera), so the whole storey in view costs one draw call per zone instead of 16-34 (docs/handover/rollout-drawcalls.md).
 *
 *   node tools/arch/proxy.mjs --zone <id> [--src assets-src/arch/out/zones] [--out <dir>]     (standalone; arch:build calls `buildProxy` per zone)
 *
 * Built in node from the Blender export (assets-src/arch/out/zones/<id>/<id>.glb + its lm_*.png), not in Blender: every input is already here
 * (each baked node's lightmap UVs are a unique unwrap of that material, TEXCOORD_0 holds the material texture's UVs), so the colour transfer is a
 * plain software rasteriser over the lightmap UVs, with no Blender session, no lock and no bake (a few seconds a zone).
 *
 *   1. parts       every opaque primitive, in world coordinates. Baked (`extras.lightmap`) or flat (emitters, kit nodes: one colour). Glass
 *                  (alpha blend) is left out.
 *   2. detail      connected parts (welded by position) whose largest extent is under PROXY.minPart are dropped (knobs, wheels, cable
 *                  clips, the small bits of the kit), then meshoptimizer simplifies the rest with the lightmap UVs as attributes
 *                  (absolute error PROXY.error metres, isolated specks pruned). Foliage (double-sided: the leaves) is made of small parts
 *                  but must not vanish: it is clustered by the sloppy simplifier instead (a canopy becomes a few blobs).
 *   3. atlas       one power-of-two tile per lightmap, its side from the material's surface area (PROXY.texelsPerM2), packed buddy-style
 *                  (power-of-two squares, largest first: never a gap) into one power-of-two atlas (512..2048). Each tile is rasterised over
 *                  the FULL-detail triangles in lightmap-UV space: the colour of a texel is the final shaded colour the runtime draws,
 *                  albedo (base colour factor x the base colour texture: its mean, or the swatch under TEXCOORD_0 for a palette texture)
 *                  x ambient occlusion x the lightmap (decoded to linear) x lightmapScale, as three's baked look computes it (lightmaps.ts).
 *                  Gutters are dilated, the rest of a tile takes its mean. Flat parts get a small solid tile.
 *   4. encoding    linear colour / `scale` -> sRGB 8 bit (scale = the 99.8th percentile of the brightest channel, >= 1, so sunlit floors keep
 *                  their headroom), KTX2 UASTC sRGB with mips, embedded through KHR_texture_basisu; the material is KHR_materials_unlit and
 *                  the mesh node carries `extras.proxyScale` (the runtime sets the unlit material's colour to it). Meshopt + quantization.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document } from '@gltf-transform/core'
import { KHRMaterialsUnlit, KHRTextureBasisu } from '@gltf-transform/extensions'
import { meshopt, reorder } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

/** The knobs (one place; the report quotes them). */
export const PROXY = {
  /** Metres: a connected part whose largest extent is below this is dropped. */
  minPart: 0.3,
  /** Metres: meshoptimizer's absolute simplification error. */
  error: 0.02,
  /** Atlas texels per square metre of kept surface (16 texels a metre; a lightmap's islands fill about 2/3 of its square, which the tile
   *  side allows for). */
  texelsPerM2: 256,
  minAtlas: 512,
  maxAtlas: 2048,
  /** Smallest tile side (texels) and the inset of the UVs inside each tile (texels), so mips bleed less across tiles. */
  minTile: 16,
  pad: 2,
  /** Side of a flat (one colour) tile. */
  flatTile: 8,
  /** Triangles a proxy may have (a warning above it; the tests hold the shipped ones to it). */
  trisCap: 80000,
  /** A metal's share of its baked diffuse kept (three draws a metal from the environment; the proxy has none). */
  metalKeep: 0.6,
  /** Linear light a flat, unbaked surface is drawn with (kit nodes). */
  flatLight: 0.8,
  /** Foliage (double-sided materials: leaves) is never dropped as small parts; it is clustered instead (meshoptimizer's sloppy simplifier),
   *  to this share of its triangles at most, within this error (metres): a tree keeps its canopy as a few blobs. */
  foliageRatio: 0.1,
  foliageError: 0.3,
  /** Metres around unbaked foliage within which the upward-facing baked surfaces give it its light (flatColour). */
  foliageReach: 3,
  /** Which share of that light (by area, darkest first) it takes: the sunlit ground, not the canopy's own shade under it. */
  foliageLightPercentile: 0.8,
}

// --- colour --------------------------------------------------------------------------------------------------------------------------------------
const SRGB_TO_LIN = new Float32Array(256).map((_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})
export const srgbToLinear = (b) => SRGB_TO_LIN[b]
export function linearToSrgb8(v) {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
  return Math.round(s * 255)
}

/** Decoded image: { w, h, data: Uint8Array RGBA }. */
async function decode(bytes, resize) {
  let s = sharp(Buffer.from(bytes)).ensureAlpha()
  if (resize) s = s.resize(resize.w, resize.h, { fit: 'fill', kernel: 'lanczos3' })
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true })
  return { w: info.width, h: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) }
}

/** Mean of an image's channels (sRGB channels decoded to linear when `srgb`). */
function meanOf(img, srgb) {
  const out = [0, 0, 0]
  const n = img.w * img.h
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[c] += srgb ? srgbToLinear(img.data[i * 4 + c]) : img.data[i * 4 + c] / 255
  return out.map((v) => v / n)
}

const isPalette = (name, img) => /palette/i.test(name ?? '') || img.h <= 32

// --- geometry ------------------------------------------------------------------------------------------------------------------------------------
function transformPoint(m, x, y, z, out, o) {
  out[o] = m[0] * x + m[4] * y + m[8] * z + m[12]
  out[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
  out[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
}

function readAttr(acc, comps) {
  const n = acc.getCount()
  const out = new Float32Array(n * comps)
  const el = new Array(comps)
  for (let i = 0; i < n; i++) {
    acc.getElement(i, el)
    for (let c = 0; c < comps; c++) out[i * comps + c] = el[c]
  }
  return out
}

/**
 * Drop the connected parts (vertices welded by exact position) whose largest world extent is under `minPart`. Returns the kept indices.
 * Pure: positions Float32Array xyz, indices Uint32Array.
 */
export function dropSmallParts(positions, indices, minPart) {
  const nv = positions.length / 3
  const remap = MeshoptSimplifier.generatePositionRemap(positions, 3)
  const parent = new Int32Array(nv)
  for (let i = 0; i < nv; i++) parent[i] = i
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(remap[indices[t]])
    const b = find(remap[indices[t + 1]])
    const c = find(remap[indices[t + 2]])
    parent[b] = a
    parent[find(c)] = a
  }
  const lo = new Float32Array(nv * 3).fill(Infinity)
  const hi = new Float32Array(nv * 3).fill(-Infinity)
  for (let i = 0; i < nv; i++) {
    const r = find(remap[i]) * 3
    for (let c = 0; c < 3; c++) {
      const v = positions[i * 3 + c]
      if (v < lo[r + c]) lo[r + c] = v
      if (v > hi[r + c]) hi[r + c] = v
    }
  }
  const kept = []
  for (let t = 0; t < indices.length; t += 3) {
    const r = find(remap[indices[t]]) * 3
    const ext = Math.max(hi[r] - lo[r], hi[r + 1] - lo[r + 1], hi[r + 2] - lo[r + 2])
    if (ext >= minPart) kept.push(indices[t], indices[t + 1], indices[t + 2])
  }
  return new Uint32Array(kept)
}

function triArea(p, a, b, c) {
  const ux = p[b * 3] - p[a * 3]
  const uy = p[b * 3 + 1] - p[a * 3 + 1]
  const uz = p[b * 3 + 2] - p[a * 3 + 2]
  const vx = p[c * 3] - p[a * 3]
  const vy = p[c * 3 + 1] - p[a * 3 + 1]
  const vz = p[c * 3 + 2] - p[a * 3 + 2]
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
}

/** Weld by (position, uv) exactly; returns { positions, uvs, indices } with only the used vertices. */
function weldPosUv(positions, uvs, indices) {
  const key = new Map()
  const p = []
  const u = []
  const out = new Uint32Array(indices.length)
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]
    const k = `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]},${uvs[v * 2]},${uvs[v * 2 + 1]}`
    let n = key.get(k)
    if (n === undefined) {
      n = p.length / 3
      key.set(k, n)
      p.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
      u.push(uvs[v * 2], uvs[v * 2 + 1])
    }
    out[i] = n
  }
  return { positions: new Float32Array(p), uvs: new Float32Array(u), indices: out }
}

/**
 * Simplify with the (lightmap) UVs as attributes, absolute error in metres; isolated specks under the error are pruned. `sloppy` (foliage):
 * cluster instead, to `sloppy.ratio` of the triangles at most within `error` (vertices merge across parts; their UVs stay inside the tile).
 */
export function simplifyPart(mesh, error, uvWeight, sloppy = null) {
  if (mesh.indices.length < 3) return mesh
  const [idx] = sloppy
    ? MeshoptSimplifier.simplifySloppy(
        mesh.indices,
        mesh.positions,
        3,
        null,
        Math.max(3, Math.floor((mesh.indices.length * sloppy.ratio) / 3) * 3),
        error / Math.max(1e-6, MeshoptSimplifier.getScale(mesh.positions, 3)),
      )
    : MeshoptSimplifier.simplifyWithAttributes(mesh.indices, mesh.positions, 3, mesh.uvs, 2, [uvWeight, uvWeight], null, 0, error, ['ErrorAbsolute', 'Prune'])
  // compact: keep the used vertices only
  const map = new Int32Array(mesh.positions.length / 3).fill(-1)
  const p = []
  const u = []
  const out = new Uint32Array(idx.length)
  for (let i = 0; i < idx.length; i++) {
    let n = map[idx[i]]
    if (n < 0) {
      n = map[idx[i]] = p.length / 3
      p.push(mesh.positions[idx[i] * 3], mesh.positions[idx[i] * 3 + 1], mesh.positions[idx[i] * 3 + 2])
      u.push(mesh.uvs[idx[i] * 2], mesh.uvs[idx[i] * 2 + 1])
    }
    out[i] = n
  }
  return { positions: new Float32Array(p), uvs: new Float32Array(u), indices: out }
}

// --- atlas ---------------------------------------------------------------------------------------------------------------------------------------
const pow2Round = (v) => 2 ** Math.round(Math.log2(Math.max(1, v)))

/**
 * Tile sides (powers of two) for surface areas, and the atlas side: the atlas is the power of two NEAREST to what `texelsPerM2` texels per m2
 * would take (between minAtlas and maxAtlas: memory is the Quest's), the tiles start at that density (at least `minTile`), the largest are
 * halved until they fit, then the ones with the fewest texels per m2 are doubled while there is room. Pure.
 */
export function tileSizes(areas, { texelsPerM2, minTile, minAtlas, maxAtlas }, extra = []) {
  const sides = areas.map((a) => Math.min(maxAtlas, Math.max(minTile, pow2Round(Math.sqrt(Math.max(a, 0) * texelsPerM2) * 1.25))))
  const total = () => sides.reduce((s, v) => s + v * v, 0) + extra.reduce((s, v) => s + v * v, 0)
  const want = Math.sqrt(areas.reduce((s, a) => s + Math.max(a, 0), 0) * texelsPerM2) * 1.25
  const atlas = Math.min(maxAtlas, Math.max(minAtlas, pow2Round(Math.max(want, Math.sqrt(extra.reduce((s, v) => s + v * v, 0)) * 2))))
  while (total() > atlas * atlas) {
    let k = -1
    for (let i = 0; i < sides.length; i++) if (sides[i] > minTile && (k < 0 || sides[i] > sides[k])) k = i
    if (k < 0) break
    sides[k] /= 2
  }
  // fill the atlas: double the tile with the fewest texels per m2 while it still fits
  for (;;) {
    let k = -1
    for (let i = 0; i < sides.length; i++) {
      if (!(areas[i] > 0) || sides[i] * 2 > atlas || total() + 3 * sides[i] * sides[i] > atlas * atlas) continue
      if (k < 0 || sides[i] * sides[i] * areas[k] < sides[k] * sides[k] * areas[i]) k = i
    }
    if (k < 0) break
    sides[k] *= 2
  }
  return { sides, atlas }
}

/**
 * Pack power-of-two squares into a power-of-two atlas, largest first, buddy style (a free square is split in four until it fits), so squares
 * whose areas sum to at most the atlas's always fit. Returns [{ x, y }] in the input order, or null when they do not fit. Pure.
 */
export function packSquares(sides, atlas) {
  const order = sides.map((s, i) => i).sort((a, b) => sides[b] - sides[a] || a - b)
  const free = [{ x: 0, y: 0, s: atlas }]
  const out = new Array(sides.length)
  for (const i of order) {
    const s = sides[i]
    // the smallest free square that holds it (ties: the first made, so the layout is deterministic)
    let best = -1
    for (let k = 0; k < free.length; k++) if (free[k].s >= s && (best < 0 || free[k].s < free[best].s)) best = k
    if (best < 0) return null
    let f = free.splice(best, 1)[0]
    while (f.s > s) {
      const h = f.s / 2
      free.push({ x: f.x + h, y: f.y, s: h }, { x: f.x, y: f.y + h, s: h }, { x: f.x + h, y: f.y + h, s: h })
      f = { x: f.x, y: f.y, s: h }
    }
    out[i] = { x: f.x, y: f.y }
  }
  return out
}

/**
 * Rasterise one tile: every triangle (lightmap UVs `uv1` -> tile pixels) writes, at each texel centre it covers, `shade(i0, i1, i2, b0, b1, b2)`
 * (linear RGB, written into `out`). Tiny triangles that cover no centre write their centroid. `rgb` is the atlas (Float32 RGB), `cov` its
 * coverage. Pure. (`dilateTile` afterwards fills the gutters.)
 */
export function rasterTile(rgb, cov, atlas, tile, uv1, indices, shade) {
  const { x: tx, y: ty, s, pad } = tile
  const inner = s - 2 * pad
  const px = (u) => tx + pad + u * inner
  const py = (v) => ty + pad + v * inner
  const col = [0, 0, 0]
  const put = (X, Y) => {
    if (X < tx || Y < ty || X >= tx + s || Y >= ty + s) return
    const o = Y * atlas + X
    rgb[o * 3] = col[0]
    rgb[o * 3 + 1] = col[1]
    rgb[o * 3 + 2] = col[2]
    cov[o] = 1
  }
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]
    const b = indices[t + 1]
    const c = indices[t + 2]
    const ax = px(uv1[a * 2])
    const ay = py(uv1[a * 2 + 1])
    const bx = px(uv1[b * 2])
    const by = py(uv1[b * 2 + 1])
    const cx = px(uv1[c * 2])
    const cy = py(uv1[c * 2 + 1])
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    let wrote = false
    if (Math.abs(area) > 1e-12) {
      const x0 = Math.max(tx, Math.floor(Math.min(ax, bx, cx)))
      const x1 = Math.min(tx + s - 1, Math.ceil(Math.max(ax, bx, cx)))
      const y0 = Math.max(ty, Math.floor(Math.min(ay, by, cy)))
      const y1 = Math.min(ty + s - 1, Math.ceil(Math.max(ay, by, cy)))
      const eps = -1e-6 * Math.abs(area)
      for (let Y = y0; Y <= y1; Y++) {
        const qy = Y + 0.5
        for (let X = x0; X <= x1; X++) {
          const qx = X + 0.5
          const w0 = ((bx - qx) * (cy - qy) - (by - qy) * (cx - qx)) / area
          const w1 = ((cx - qx) * (ay - qy) - (cy - qy) * (ax - qx)) / area
          const w2 = 1 - w0 - w1
          if (w0 * Math.abs(area) < eps || w1 * Math.abs(area) < eps || w2 * Math.abs(area) < eps) continue
          shade(a, b, c, w0, w1, w2, col)
          put(X, Y)
          wrote = true
        }
      }
    }
    if (!wrote) {
      shade(a, b, c, 1 / 3, 1 / 3, 1 / 3, col)
      const X = Math.floor((ax + bx + cx) / 3)
      const Y = Math.floor((ay + by + cy) / 3)
      if (!cov[Y * atlas + X]) put(X, Y)
    }
  }
}

/** Dilate a tile's gutters (`passes` rings from the covered texels); what is still empty takes the tile's mean. Pure. */
export function dilateTile(rgb, cov, atlas, { x: tx, y: ty, s }, passes) {
  for (let p = 0; p < passes; p++) {
    const add = []
    for (let Y = ty; Y < ty + s; Y++)
      for (let X = tx; X < tx + s; X++) {
        if (cov[Y * atlas + X]) continue
        let n = 0
        let r = 0
        let g = 0
        let b = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const x = X + dx
            const y = Y + dy
            if (x < tx || y < ty || x >= tx + s || y >= ty + s) continue
            const o = y * atlas + x
            if (cov[o] !== 1) continue
            r += rgb[o * 3]
            g += rgb[o * 3 + 1]
            b += rgb[o * 3 + 2]
            n++
          }
        if (n) add.push(Y * atlas + X, r / n, g / n, b / n)
      }
    if (!add.length) break
    for (let i = 0; i < add.length; i += 4) {
      const o = add[i]
      rgb[o * 3] = add[i + 1]
      rgb[o * 3 + 1] = add[i + 2]
      rgb[o * 3 + 2] = add[i + 3]
      cov[o] = 1
    }
  }
  // what is left (never sampled at full size, averaged into the mips) takes the tile's mean
  const m = [0, 0, 0]
  let n = 0
  for (let Y = ty; Y < ty + s; Y++)
    for (let X = tx; X < tx + s; X++) {
      const o = Y * atlas + X
      if (!cov[o]) continue
      for (let c = 0; c < 3; c++) m[c] += rgb[o * 3 + c]
      n++
    }
  if (!n) return
  for (let Y = ty; Y < ty + s; Y++)
    for (let X = tx; X < tx + s; X++) {
      const o = Y * atlas + X
      if (cov[o]) continue
      for (let c = 0; c < 3; c++) rgb[o * 3 + c] = m[c] / n
      cov[o] = 2
    }
}

/** The encoding scale: the 99.8th percentile of the brightest channel over the covered texels, at least 1. Pure. */
export function colourScale(rgb, cov) {
  const v = []
  for (let i = 0; i < cov.length; i++) if (cov[i]) v.push(Math.max(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]))
  if (!v.length) return 1
  v.sort((a, b) => a - b)
  return Math.max(1, Math.round(v[Math.min(v.length - 1, Math.floor(v.length * 0.998))] * 1000) / 1000)
}

// --- the material's look -------------------------------------------------------------------------------------------------------------------------
async function materialLook(mat, cache) {
  if (cache.has(mat)) return cache.get(mat)
  const f = mat.getBaseColorFactor()
  const look = { factor: [f[0], f[1], f[2]], mean: [1, 1, 1], palette: null, ao: 1, metal: mat.getMetallicFactor(), emissive: null }
  const base = mat.getBaseColorTexture()
  if (base?.getImage()) {
    const full = await decode(base.getImage())
    if (isPalette(base.getName(), full)) look.palette = full
    else look.mean = meanOf(await decode(base.getImage(), { w: 64, h: 64 }), true)
  }
  const mr = mat.getMetallicRoughnessTexture()
  if (mr?.getImage()) look.metal *= meanOf(await decode(mr.getImage(), { w: 32, h: 32 }), false)[2]
  const occ = mat.getOcclusionTexture()
  if (occ?.getImage()) look.ao = 1 + (meanOf(await decode(occ.getImage(), { w: 32, h: 32 }), false)[0] - 1) * mat.getOcclusionStrength()
  const e = mat.getEmissiveFactor()
  if (Math.max(...e) > 0) {
    const strength = mat.getExtension('KHR_materials_emissive_strength')?.getEmissiveStrength?.() ?? 1
    look.emissive = e.map((v) => v * strength)
  }
  cache.set(mat, look)
  return look
}

/** Albedo (linear) at a TEXCOORD_0: factor x (palette swatch under it | the texture's mean). Writes into `out`. */
function albedoAt(look, u, v, out) {
  if (look.palette) {
    const { w, h, data } = look.palette
    const x = ((Math.floor(u * w) % w) + w) % w
    const y = ((Math.floor(v * h) % h) + h) % h
    const o = (y * w + x) * 4
    for (let c = 0; c < 3; c++) out[c] = look.factor[c] * srgbToLinear(data[o + c])
  } else for (let c = 0; c < 3; c++) out[c] = look.factor[c] * look.mean[c]
}

/** Plan cell size (metres) of the open-air light estimate. */
const SKY_CELL = 2

/**
 * Add a baked part's light on its UPWARD-facing triangles (lawn, soil, paving, planters: what open-air planting stands on and in the same
 * light) to the plan grid `light`: per cell, area-weighted sums of the lightmap (linear) x its scale at each triangle's centre.
 */
function sampleSkyLight(part, lmAt, scale, light) {
  const { positions: p, uv1, indices } = part
  const lm = [0, 0, 0]
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const area2 = Math.hypot(nx, ny, nz)
    if (area2 < 1e-9 || ny / area2 < 0.7) continue
    const i0 = indices[t] * 2, i1 = indices[t + 1] * 2, i2 = indices[t + 2] * 2
    lmAt((uv1[i0] + uv1[i1] + uv1[i2]) / 3, (uv1[i0 + 1] + uv1[i1 + 1] + uv1[i2 + 1]) / 3, lm)
    const key = `${Math.floor((p[a] + p[b] + p[c]) / 3 / SKY_CELL)},${Math.floor((p[a + 2] + p[b + 2] + p[c + 2]) / 3 / SKY_CELL)}`
    let e = light.get(key)
    if (!e) light.set(key, (e = [0, 0, 0, 0]))
    for (let k = 0; k < 3; k++) e[k] += lm[k] * scale * area2
    e[3] += area2
  }
}

/**
 * The colour of a flat (one-colour) tile: an emitter keeps its emission; a kit part its albedo x PROXY.flatLight (an indoor light level);
 * unbaked FOLIAGE its albedo x the baked light of the upward-facing surfaces around it (its parts' plan box + PROXY.foliageReach; their
 * PROXY.foliageLightPercentile: the open sun and sky the canopy's tops get), else of the whole zone's upward-facing surfaces, else flatLight.
 */
/**
 * The light of the cells at the `q` share of their area-weighted luminance order: the canopy's tops are in the open sun, the ground right
 * under it in its shade, so the planting takes the brighter part of what lies around it (q 0.8), not the shaded mean. Null: no cells.
 */
function skyPercentile(cells, q) {
  const list = cells.filter((e) => e[3] > 0).map((e) => [e[0] / e[3], e[1] / e[3], e[2] / e[3], e[3]])
  if (!list.length) return null
  list.sort((a, b) => a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722 - (b[0] * 0.2126 + b[1] * 0.7152 + b[2] * 0.0722))
  const total = list.reduce((s, e) => s + e[3], 0)
  let acc = 0
  for (const e of list) {
    acc += e[3]
    if (acc >= q * total) return [e[0], e[1], e[2]]
  }
  const e = list[list.length - 1]
  return [e[0], e[1], e[2]]
}

export function flatColour(f, light, P = PROXY) {
  if (f.emissive) return [...f.albedo]
  let L = null
  if (f.foliage) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const part of f.parts)
      for (let i = 0; i < part.positions.length; i += 3) {
        x0 = Math.min(x0, part.positions[i]); x1 = Math.max(x1, part.positions[i])
        z0 = Math.min(z0, part.positions[i + 2]); z1 = Math.max(z1, part.positions[i + 2])
      }
    const near = []
    const all = []
    const r = P.foliageReach
    for (const [key, e] of light) {
      const [cx, cz] = key.split(',').map(Number)
      const x = (cx + 0.5) * SKY_CELL
      const z = (cz + 0.5) * SKY_CELL
      all.push(e)
      if (x >= x0 - r && x <= x1 + r && z >= z0 - r && z <= z1 + r) near.push(e)
    }
    L = skyPercentile(near.length ? near : all, P.foliageLightPercentile)
  }
  return f.albedo.map((v, i) => v * (L ? L[i] : P.flatLight))
}

// --- the proxy -----------------------------------------------------------------------------------------------------------------------------------
/**
 * Build a zone's proxy document from its Blender export (a gltf-transform Document, as read) and the folder of its lightmap PNGs.
 * Returns { doc, atlas: { size, rgb, cov }, scale, tris, stats }. The texture is attached by `encodeProxy` (KTX2 needs the ktx tool).
 */
export async function buildProxyDoc(src, lmDir, opts = {}) {
  const P = { ...PROXY, ...opts }
  await MeshoptSimplifier.ready
  const looks = new Map()
  /** baked parts by lightmap file; flat parts by colour key */
  const baked = new Map()
  const flat = new Map()
  const stats = { sourceTris: 0, droppedSmall: 0, glass: 0 }
  for (const scene of src.getRoot().listScenes()) {
    const nodes = []
    scene.traverse((n) => nodes.push(n))
    for (const node of nodes) {
      const mesh = node.getMesh()
      if (!mesh) continue
      const m = node.getWorldMatrix()
      // a kit node's lightmap extra sits on the node (never on a parent: kit nodes are not baked)
      const lm = node.getExtras()?.lightmap
      const scale = Number.isFinite(node.getExtras()?.lightmapScale) ? node.getExtras().lightmapScale : 1
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial()
        const pos = prim.getAttribute('POSITION')
        if (!pos) continue
        const local = readAttr(pos, 3)
        const positions = new Float32Array(local.length)
        for (let i = 0; i < local.length; i += 3) transformPoint(m, local[i], local[i + 1], local[i + 2], positions, i)
        const idxAcc = prim.getIndices()
        const indices = idxAcc ? Uint32Array.from(idxAcc.getArray()) : Uint32Array.from({ length: pos.getCount() }, (_, i) => i)
        stats.sourceTris += indices.length / 3
        if (mat && mat.getAlphaMode() === 'BLEND') {
          stats.glass += indices.length / 3
          continue
        }
        const look = mat ? await materialLook(mat, looks) : { factor: [0.8, 0.8, 0.8], mean: [1, 1, 1], palette: null, ao: 1, metal: 0, emissive: null }
        const doubleSided = !!mat?.getDoubleSided()
        const foliage = doubleSided
        const kept = foliage ? indices : dropSmallParts(positions, indices, P.minPart)
        stats.droppedSmall += (indices.length - kept.length) / 3
        if (!kept.length) continue
        const uv0 = prim.getAttribute('TEXCOORD_0') ? readAttr(prim.getAttribute('TEXCOORD_0'), 2) : new Float32Array((positions.length / 3) * 2)
        let area = 0
        for (let t = 0; t < kept.length; t += 3) area += triArea(positions, kept[t], kept[t + 1], kept[t + 2])
        if (typeof lm === 'string' && prim.getAttribute('TEXCOORD_1')) {
          const uv1 = readAttr(prim.getAttribute('TEXCOORD_1'), 2)
          let b = baked.get(lm)
          if (!b) baked.set(lm, (b = { file: lm, scale, parts: [], area: 0 }))
          b.parts.push({ positions, uv0, uv1, indices: kept, look, doubleSided, foliage })
          b.area += area
        } else {
          // emitters and unbaked parts (kit nodes, open-air foliage): one colour per albedo. A palette material (the foliage's 12 greens,
          // KitPlastic) is split by the swatch under each triangle, so each swatch keeps its own colour (the palette's factor is white:
          // without this every leaf came out white). The light is decided once the baked tiles are read (flatColour).
          const groups = new Map()
          const alb = [0, 0, 0]
          for (let t = 0; t < kept.length; t += 3) {
            if (look.emissive) alb.splice(0, 3, ...look.emissive)
            else {
              const i0 = kept[t]
              const i1 = kept[t + 1]
              const i2 = kept[t + 2]
              albedoAt(look, (uv0[i0 * 2] + uv0[i1 * 2] + uv0[i2 * 2]) / 3, (uv0[i0 * 2 + 1] + uv0[i1 * 2 + 1] + uv0[i2 * 2 + 1]) / 3, alb)
            }
            const key = `${alb.map((v) => v.toFixed(4)).join(',')}|${look.emissive ? 'e' : foliage ? 'f' : 'k'}`
            let g = groups.get(key)
            if (!g) groups.set(key, (g = { albedo: [...alb], emissive: !!look.emissive, indices: [] }))
            g.indices.push(kept[t], kept[t + 1], kept[t + 2])
          }
          for (const [key, g] of groups) {
            let f = flat.get(key)
            if (!f) flat.set(key, (f = { albedo: g.albedo, emissive: g.emissive, foliage, colour: null, parts: [] }))
            f.parts.push({ positions, indices: Uint32Array.from(g.indices), doubleSided, foliage })
          }
        }
      }
    }
  }

  // --- the atlas layout
  const bakedList = [...baked.values()].sort((a, b) => (a.file < b.file ? -1 : 1))
  const flatList = [...flat.values()]
  const { sides, atlas } = tileSizes(
    bakedList.map((b) => b.area),
    P,
    flatList.map(() => P.flatTile),
  )
  const allSides = [...sides, ...flatList.map(() => P.flatTile)]
  const at = packSquares(allSides, atlas)
  if (!at) throw new Error(`proxy atlas: ${allSides.length} tiles do not fit ${atlas}`)
  const rgb = new Float32Array(atlas * atlas * 3)
  const cov = new Uint8Array(atlas * atlas)

  // --- rasterise the baked tiles (full detail) and collect the simplified geometry
  const outPos = []
  const outUv = []
  const outIdx = []
  let base = 0
  const emit = (mesh, mapUv, doubleSided) => {
    for (let i = 0; i < mesh.positions.length; i++) outPos.push(mesh.positions[i])
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const [u, v] = mapUv(i)
      outUv.push(u, v)
    }
    for (let i = 0; i < mesh.indices.length; i += 3) {
      outIdx.push(base + mesh.indices[i], base + mesh.indices[i + 1], base + mesh.indices[i + 2])
      if (doubleSided) outIdx.push(base + mesh.indices[i], base + mesh.indices[i + 2], base + mesh.indices[i + 1])
    }
    base += mesh.positions.length / 3
  }
  const lmCache = new Map()
  /** the baked light (linear radiance of a white surface) on the upward-facing surfaces, by plan cell: what unbaked foliage stands in */
  const light = new Map()
  for (const [k, b] of bakedList.entries()) {
    const s = sides[k]
    const tile = { x: at[k].x, y: at[k].y, s, pad: s >= 16 ? P.pad : 1 }
    const inner = s - 2 * tile.pad
    const png = path.join(lmDir, b.file)
    if (!existsSync(png)) throw new Error(`proxy: ${b.file} is not in ${lmDir}`)
    // the lightmap resampled to the tile (in linear light: sharp's gamma), sampled bilinearly at the texel's lightmap UV
    let lmImg = lmCache.get(`${png}:${inner}`)
    if (!lmImg) {
      const { data, info } = await sharp(png).removeAlpha().gamma(2.2).resize(inner, inner, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true })
      lmImg = { w: info.width, h: info.height, c: info.channels, data }
      lmCache.set(`${png}:${inner}`, lmImg)
    }
    const lmAt = (u, v, out) => {
      const x = Math.min(lmImg.w - 1, Math.max(0, u * lmImg.w - 0.5))
      const y = Math.min(lmImg.h - 1, Math.max(0, v * lmImg.h - 0.5))
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const x1 = Math.min(lmImg.w - 1, x0 + 1)
      const y1 = Math.min(lmImg.h - 1, y0 + 1)
      const fx = x - x0
      const fy = y - y0
      for (let c = 0; c < 3; c++) {
        const g = (X, Y) => srgbToLinear(lmImg.data[(Y * lmImg.w + X) * lmImg.c + c])
        out[c] = (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy
      }
    }
    const alb = [0, 0, 0]
    const lmc = [0, 0, 0]
    for (const part of b.parts) {
      const { uv0, uv1, look } = part
      const k2 = look.ao * b.scale * (1 - look.metal * (1 - P.metalKeep))
      const shade = (i0, i1, i2, w0, w1, w2, out) => {
        albedoAt(look, uv0[i0 * 2] * w0 + uv0[i1 * 2] * w1 + uv0[i2 * 2] * w2, uv0[i0 * 2 + 1] * w0 + uv0[i1 * 2 + 1] * w1 + uv0[i2 * 2 + 1] * w2, alb)
        lmAt(uv1[i0 * 2] * w0 + uv1[i1 * 2] * w1 + uv1[i2 * 2] * w2, uv1[i0 * 2 + 1] * w0 + uv1[i1 * 2 + 1] * w1 + uv1[i2 * 2 + 1] * w2, lmc)
        for (let c = 0; c < 3; c++) out[c] = alb[c] * lmc[c] * k2
      }
      rasterTile(rgb, cov, atlas, tile, uv1, part.indices, shade)
      sampleSkyLight(part, lmAt, b.scale, light)
    }
    dilateTile(rgb, cov, atlas, tile, 6)
    for (const part of b.parts) {
      const welded = weldPosUv(part.positions, part.uv1, part.indices)
      const simple = part.foliage
        ? simplifyPart(welded, P.foliageError, 0, { ratio: P.foliageRatio })
        : simplifyPart(welded, P.error, inner * 0.01)
      emit(simple, (i) => [(tile.x + tile.pad + simple.uvs[i * 2] * inner) / atlas, (tile.y + tile.pad + simple.uvs[i * 2 + 1] * inner) / atlas], part.doubleSided)
    }
  }
  for (const f of flatList) f.colour = flatColour(f, light, P)
  for (const [j, f] of flatList.entries()) {
    const k = bakedList.length + j
    const { x, y } = at[k]
    const s = P.flatTile
    for (let Y = y; Y < y + s; Y++)
      for (let X = x; X < x + s; X++) {
        const o = Y * atlas + X
        for (let c = 0; c < 3; c++) rgb[o * 3 + c] = f.colour[c]
        cov[o] = 1
      }
    const u = (x + s / 2) / atlas
    const v = (y + s / 2) / atlas
    for (const part of f.parts) {
      const welded = weldPosUv(part.positions, new Float32Array((part.positions.length / 3) * 2), part.indices)
      // unbaked foliage (materials.json Foliage, bake: false) is clustered like baked foliage: a canopy becomes a few blobs
      const simple = part.foliage ? simplifyPart(welded, P.foliageError, 0, { ratio: P.foliageRatio }) : simplifyPart(welded, P.error, 0)
      emit(simple, () => [u, v], part.doubleSided)
    }
  }
  if (!outIdx.length) throw new Error('proxy: nothing left to draw')

  // --- the document: one node, one mesh, one primitive, one unlit material
  const scale = colourScale(rgb, cov)
  const doc = new Document()
  const buffer = doc.createBuffer()
  const nv = outPos.length / 3
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(outPos)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(outUv)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(nv > 65535 ? new Uint32Array(outIdx) : new Uint16Array(outIdx)).setBuffer(buffer))
  const material = doc.createMaterial('proxy').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(false)
  material.setExtension('KHR_materials_unlit', doc.createExtension(KHRMaterialsUnlit).createUnlit())
  prim.setMaterial(material)
  const node = doc.createNode('proxy').setMesh(doc.createMesh('proxy').addPrimitive(prim)).setExtras({ proxyScale: scale })
  doc.createScene('proxy').addChild(node)
  const layout = bakedList.map((b, k) => ({ lightmap: b.file, m2: Math.round(b.area), side: sides[k] }))
  return { doc, material, atlas: { size: atlas, rgb, cov }, scale, tris: outIdx.length / 3, layout, stats: { ...stats, tiles: bakedList.length + flatList.length } }
}

/** The atlas as an sRGB 8-bit RGB PNG (linear / scale). */
export async function atlasPng(atlasData, scale) {
  const { size, rgb } = atlasData
  const px = Buffer.alloc(size * size * 3)
  for (let i = 0; i < size * size * 3; i++) px[i] = linearToSrgb8(rgb[i] / scale)
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer()
}

/**
 * Attach the atlas (KTX2 bytes, or any image the runtime's loader takes) to the proxy material, compress the geometry (meshopt, quantized:
 * the node transform carries the dequantization) and return the GLB bytes.
 */
export async function encodeProxy(io, built, texture, mimeType = 'image/ktx2') {
  const { doc, material } = built
  if (mimeType === 'image/ktx2') doc.createExtension(KHRTextureBasisu).setRequired(true)
  const tex = doc.createTexture('proxy_atlas').setImage(texture).setMimeType(mimeType)
  material.setBaseColorTexture(tex)
  await MeshoptEncoder.ready
  await doc.transform(reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 16, quantizeTexcoord: 14 }))
  return io.writeBinary(doc)
}

/**
 * The whole step for one zone: read the export, build, encode the atlas to KTX2 (`ktxCreate(png, ktx2, 'uastc')`), write `<outDir>/<id>.proxy.glb`.
 * Returns { file, tris, atlas, mb, scale, bytes, stats }.
 */
export async function buildProxy({ io, srcGlb, lmDir, outFile, ktxCreate, opts }) {
  const src = await io.read(srcGlb)
  const built = await buildProxyDoc(src, lmDir, opts)
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'arch-proxy-'))
  try {
    const png = path.join(tmp, 'atlas.png')
    writeFileSync(png, await atlasPng(built.atlas, built.scale))
    const ktx2 = path.join(tmp, 'atlas.ktx2')
    ktxCreate(png, ktx2, 'uastc')
    const glb = await encodeProxy(io, built, new Uint8Array(readFileSync(ktx2)))
    mkdirSync(path.dirname(outFile), { recursive: true })
    writeFileSync(outFile, glb)
    const size = built.atlas.size
    return { atlasData: built.atlas, file: outFile, tris: built.tris, atlas: size, mb: Math.round(((size * size * 4) / 3 / (1024 * 1024)) * 100) / 100, scale: built.scale, bytes: glb.byteLength, stats: built.stats }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// --- standalone ----------------------------------------------------------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { NodeIO, Logger } = await import('@gltf-transform/core')
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions')
  const { MeshoptDecoder } = await import('meshoptimizer')
  const { execFileSync } = await import('node:child_process')
  const argv = process.argv.slice(2)
  const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d)
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const zid = opt('zone', null)
  if (!zid) throw new Error('--zone <id>')
  const srcDir = path.resolve(ROOT, opt('src', 'assets-src/arch/out/zones'), zid)
  const out = path.resolve(opt('out', path.join(ROOT, 'public/assets/building/zones', zid)), `${zid}.proxy.glb`)
  const KTX = process.env.KTX_BIN || path.join(os.homedir(), '.local/ktx-software-4.4.2/bin/ktx')
  const ktxCreate = (input, output) =>
    execFileSync(KTX, ['create', '--format', 'R8G8B8_SRGB', '--assign-tf', 'srgb', '--generate-mipmap', '--encode', 'uastc', '--uastc-quality', '2', '--uastc-rdo', '--zstd', '18', input, output], { stdio: ['ignore', 'ignore', 'inherit'] })
  await MeshoptDecoder.ready
  const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
  const t0 = Date.now()
  const r = await buildProxy({ io, srcGlb: path.join(srcDir, `${zid}.glb`), lmDir: srcDir, outFile: out, ktxCreate })
  if (argv.includes('--png')) writeFileSync(out.replace(/\.glb$/, '.png'), await atlasPng(r.atlasData, r.scale))
  console.log(`[${zid}] proxy ${path.relative(ROOT, out)} ${(r.bytes / 1024).toFixed(0)} KB, ${r.tris} tris, atlas ${r.atlas} (${r.mb} MB GPU), scale ${r.scale}, ${JSON.stringify(r.stats)}, ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}
