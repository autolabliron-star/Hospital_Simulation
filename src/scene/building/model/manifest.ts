/**
 * public/assets/building/manifest.json: what the zone pipeline shipped (tools/arch, docs/handover/rollout-pipeline.md). Parsed and validated
 * here, pure, so node tests it with fixtures. The runtime reads it once; no manifest (404, a dev server answering with its index page, bad JSON,
 * a shape it does not know) means the pilot path (`assets/building/pilot-lobby.glb`), exactly as before the rollout.
 *
 *   {
 *     "version": 1,
 *     "zones": [{
 *       "id": "lobby",                       a zone of tools/arch/zones.json (unknown ids are dropped with a warning)
 *       "level": 1,                          must match zones.json
 *       "glb": "zones/lobby/lobby.glb",      relative to assets/building/
 *       "lightmaps": ["zones/lobby/lm_Terrazzo.ktx2"],   informational: the runtime loads what the nodes' extras name, beside the glb
 *       "bounds": { x0, x1, z0, z1, y0, y1 },the zone's world box AS DRAWN (level 2 at y 4.2+); culling and the probe box default use it
 *       "draws": 24, "tris": 58976, "lightmapMB": 20.5,
 *       "probe": "zones/lobby/env_lobby.hdr", "probeAt": [-53, 1.6, 0],   optional (the pipeline's shape; the eye with y absolute), or
 *       "probe": { "hdr": "...", "position": [x, y, z], "box": { x0, x1, y0, y1, z0, z1 } }
 *       "replaces": ["lobby", "footprint:er:bay*", "area:atrium", "rect:-30,-20,2,8"],   optional: procedural furniture the zone's designed furniture replaces (see region.ts)
 *       "visibleFrom": ["lobby", "imaging"]   optional potential-visibility set: walking INSIDE this zone, only these zones (and itself) are drawn
 *       "proxy": { "glb": "zones/lobby/lobby.proxy.glb", "tris": 6531, "mb": 1.33, "scale": 1.14 }   optional: the zone's OVERVIEW PROXY (one
 *                                            mesh, one unlit material, one baked-colour atlas: tools/arch/proxy.mjs), drawn in the overview and for
 *                                            zones far from the walking camera (./culling.ts). Missing or malformed: the full model everywhere.
 *     }],
 *     "materials": { "files": ["materials/Terrazzo_diff.ktx2", ...], "mb": 31.2 }   shared material textures, relative to assets/building/
 *   }
 */
import { LEVEL2_DX, LEVEL2_SPLIT_X, LEVEL_Y, type LevelId } from '@/sim/levels'
import { AREAS, WALL } from '@/sim/places'
import { parseRectKey, zoneDef, type ZoneDef } from './zones'

export const MANIFEST_FILE = 'assets/building/manifest.json'
/** Every path in the manifest is relative to this (under the site base). */
export const BUILDING_DIR = 'assets/building/'

export interface Bounds {
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
}

export interface ZoneProbe {
  /** Relative to assets/building/. */
  hdr: string
  /** Where the probe was rendered from (drawn), the box projection's eye. */
  position: { x: number; y: number; z: number }
  /** The box the probe is projected onto (drawn). */
  box: Bounds
}

/** A zone's overview proxy (tools/arch/proxy.mjs): one draw call. */
export interface ZoneProxy {
  /** Relative to assets/building/. */
  glb: string
  tris: number
  /** GPU MB of its atlas. */
  mb: number
  /** The atlas's encoding scale (linear colour = texel x scale); the glb's node extras `proxyScale` win. Null: not given. */
  scale: number | null
}

export interface ManifestZone {
  id: string
  level: LevelId
  /** Relative to assets/building/. */
  glb: string
  lightmaps: string[]
  /** Drawn (world) coordinates. */
  bounds: Bounds
  draws: number
  tris: number
  lightmapMB: number
  probe: ZoneProbe | null
  replaces: string[] | null
  visibleFrom: string[] | null
  /** The overview proxy, or null (the full model is drawn at every distance). */
  proxy: ZoneProxy | null
  /** True when the pipeline authored a level-2 zone in sim coordinates (x 88..110): it is mounted moved by `mountOffset`. */
  simStrip: boolean
  /** Where the glb's own origin is drawn: (0, 0, 0), or (-LEVEL2_DX, +4.2 when its heights are floor-relative, 0) for a sim-strip zone. */
  mountOffset: { x: number; y: number }
}

export interface BuildingManifest {
  version: number
  zones: ManifestZone[]
  materials: { files: string[]; mb: number }
}

export type ManifestResult = { ok: true; manifest: BuildingManifest; warnings: string[] } | { ok: false; error: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const relPath = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && !v.startsWith('/') && !/^[a-z]+:/i.test(v) && !v.includes('\\')

function parseBounds(v: unknown): Bounds | null {
  if (!isObj(v)) return null
  const { x0, x1, y0, y1, z0, z1 } = v
  if (![x0, x1, y0, y1, z0, z1].every(num)) return null
  const b = { x0, x1, y0, y1, z0, z1 } as Bounds
  return b.x0 < b.x1 && b.y0 < b.y1 && b.z0 < b.z1 ? b : null
}

function parseVec(v: unknown): { x: number; y: number; z: number } | null {
  if (Array.isArray(v) && v.length === 3 && v.every(num)) return { x: v[0], y: v[1], z: v[2] }
  if (isObj(v) && num(v.x) && num(v.y) && num(v.z)) return { x: v.x, y: v.y, z: v.z }
  return null
}

const shift = (b: Bounds, dx: number, dy: number): Bounds => ({ x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy, z0: b.z0, z1: b.z1 })

/**
 * The probe of a zone: `probe` (a file) with `probeAt` (its eye, y absolute; the pipeline's shape), or `{ hdr, position, box }`. Without an
 * eye, the centre of the bounds at eye height (1.6 m over the floor); without a box, the zones.json rect holding the eye, floor to ceiling
 * (the room the probe sees: the lobby's rect, not its bounds, which run out over the forecourt), else the bounds.
 */
function parseProbe(v: unknown, at: unknown, bounds: Bounds, def: ZoneDef): ZoneProbe | null | 'bad' {
  if (v === undefined || v === null) return null
  const centre = { x: (bounds.x0 + bounds.x1) / 2, y: bounds.y0 + 1.6, z: (bounds.z0 + bounds.z1) / 2 }
  const hdr = relPath(v) ? v : isObj(v) && relPath(v.hdr) ? v.hdr : null
  if (!hdr) return 'bad'
  const rawEye = isObj(v) && v.position !== undefined ? v.position : at
  const position = rawEye === undefined ? centre : parseVec(rawEye)
  if (!position) return 'bad'
  if (isObj(v) && v.box !== undefined) {
    const box = parseBounds(v.box)
    return box ? { hdr, position, box } : 'bad'
  }
  return { hdr, position, box: roomBox(def, position, bounds) }
}

/** The zones.json rect holding a point (in the frame of `bounds`), floor to ceiling, else the bounds. */
function roomBox(def: ZoneDef, p: { x: number; z: number }, bounds: Bounds): Bounds {
  const dx = bounds.x0 >= LEVEL2_SPLIT_X ? LEVEL2_DX : 0 // a sim-strip zone: its rects are drawn
  const floor = def.level === 2 && bounds.y0 >= LEVEL_Y[2] - 1 ? LEVEL_Y[2] : 0
  for (const r of def.rects)
    if (p.x - dx >= r.x0 && p.x - dx <= r.x1 && p.z >= r.z0 && p.z <= r.z1) return { x0: r.x0 + dx, x1: r.x1 + dx, z0: r.z0, z1: r.z1, y0: floor, y1: floor + WALL.height }
  return bounds
}

const AREA_IDS: ReadonlySet<string> = new Set(AREAS.map((a) => a.id))
/** The `proxy` record: undefined / null = none; anything else must name a relative .glb (else 'bad'). */
function parseProxy(v: unknown): ZoneProxy | null | 'bad' {
  if (v === undefined || v === null) return null
  if (!isObj(v) || !relPath(v.glb) || !/\.glb$/i.test(v.glb)) return 'bad'
  return { glb: v.glb, tris: num(v.tris) ? v.tris : 0, mb: num(v.mb) ? v.mb : 0, scale: num(v.scale) && v.scale > 0 ? v.scale : null }
}

const strList = (v: unknown): string[] | null => (Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : null)

/** Validate a manifest. A bad zone is dropped (with a warning) and the rest still load; a bad top level fails the whole manifest. */
export function parseManifest(json: unknown): ManifestResult {
  if (!isObj(json)) return { ok: false, error: 'the manifest is not a JSON object' }
  if (!num(json.version) || json.version < 1) return { ok: false, error: 'the manifest has no version' }
  if (!Array.isArray(json.zones)) return { ok: false, error: 'the manifest has no zones array' }
  const mats = json.materials
  const files = isObj(mats) ? strList(mats.files) : mats === undefined ? [] : null
  if (!files || !files.every(relPath)) return { ok: false, error: 'materials.files must be a list of relative paths' }
  const mb = isObj(mats) && num(mats.mb) ? mats.mb : 0
  const warnings: string[] = []
  const zones: ManifestZone[] = []
  const seen = new Set<string>()
  for (const raw of json.zones) {
    const id = isObj(raw) && typeof raw.id === 'string' ? raw.id : '?'
    const bad = (why: string): void => {
      warnings.push(`zone ${id}: ${why}; it is skipped (its region stays procedural)`)
    }
    if (!isObj(raw)) {
      bad('not an object')
      continue
    }
    const def = zoneDef(id)
    if (!def) {
      bad('not a zone of tools/arch/zones.json')
      continue
    }
    if (seen.has(id)) {
      bad('listed twice')
      continue
    }
    if (raw.level !== def.level) {
      bad(`level ${String(raw.level)} but zones.json says ${def.level}`)
      continue
    }
    if (!relPath(raw.glb) || !/\.glb$/i.test(raw.glb)) {
      bad('no relative .glb path')
      continue
    }
    const lightmaps = strList(raw.lightmaps ?? [])
    if (!lightmaps || !lightmaps.every(relPath)) {
      bad('lightmaps must be a list of relative paths')
      continue
    }
    const rawBounds = parseBounds(raw.bounds)
    if (!rawBounds) {
      bad('bounds missing or empty')
      continue
    }
    let probe = parseProbe(raw.probe, raw.probeAt, rawBounds, def)
    if (probe === 'bad') {
      warnings.push(`zone ${id}: its probe is malformed; the zone loads without it`)
      probe = null
    }
    // a level-2 zone authored in the sim's strip: drawn = sim - LEVEL2_DX, one storey up (when its heights are floor-relative)
    const simStrip = def.level === 2 && rawBounds.x0 >= LEVEL2_SPLIT_X
    const dy = simStrip && rawBounds.y0 < LEVEL_Y[2] - 1 ? LEVEL_Y[2] : 0
    const bounds = simStrip ? shift(rawBounds, -LEVEL2_DX, dy) : rawBounds
    if (probe && simStrip) {
      const p = probe.position
      probe = { hdr: probe.hdr, position: { x: p.x - LEVEL2_DX, y: p.y + dy, z: p.z }, box: shift(probe.box, -LEVEL2_DX, dy) }
    }
    let replaces = raw.replaces === undefined ? null : strList(raw.replaces)
    if (raw.replaces !== undefined && !replaces) warnings.push(`zone ${id}: replaces must be a list of strings; ignored`)
    if (replaces) {
      // `area:<areaId>` must name an area of the sim (other keys are checked when the coverage is built: region.ts)
      const badAreas = replaces.filter((k) => k.startsWith('area:') && !AREA_IDS.has(k.slice('area:'.length)))
      if (badAreas.length) {
        warnings.push(`zone ${id}: replaces names areas that do not exist (dropped): ${badAreas.join(', ')}`)
        replaces = replaces.filter((k) => !badAreas.includes(k))
      }
      // `rect:<x0>,<x1>,<z0>,<z1>` must be four numbers with x0 < x1 and z0 < z1
      const badRects = replaces.filter((k) => k.startsWith('rect:') && parseRectKey(k) === null)
      if (badRects.length) {
        warnings.push(`zone ${id}: replaces has malformed rects (rect:x0,x1,z0,z1 with x0 < x1 and z0 < z1; dropped): ${badRects.join(', ')}`)
        replaces = replaces.filter((k) => !badRects.includes(k))
      }
    }
    const visibleFrom = raw.visibleFrom === undefined ? null : strList(raw.visibleFrom)
    if (raw.visibleFrom !== undefined && !visibleFrom) warnings.push(`zone ${id}: visibleFrom must be a list of zone ids; ignored`)
    let proxy = parseProxy(raw.proxy)
    if (proxy === 'bad') {
      warnings.push(`zone ${id}: its overview proxy is malformed; the zone is drawn in full at every distance`)
      proxy = null
    }
    seen.add(id)
    zones.push({
      id,
      level: def.level,
      glb: raw.glb,
      lightmaps,
      bounds,
      draws: num(raw.draws) ? raw.draws : 0,
      tris: num(raw.tris) ? raw.tris : 0,
      lightmapMB: num(raw.lightmapMB) ? raw.lightmapMB : 0,
      probe,
      replaces,
      visibleFrom: visibleFrom ? visibleFrom.filter((z) => zoneDef(z) !== undefined) : null,
      proxy,
      simStrip,
      mountOffset: { x: simStrip ? -LEVEL2_DX : 0, y: dy },
    })
  }
  if (zones.length === 0) return { ok: false, error: `the manifest lists no usable zone${warnings.length ? ` (${warnings.join('; ')})` : ''}` }
  return { ok: true, manifest: { version: json.version, zones, materials: { files, mb } }, warnings }
}

/** The text a fetch returned, as a manifest (an HTML page, empty text or bad JSON is no manifest). */
export function parseManifestText(text: string): ManifestResult {
  const t = text.trimStart()
  if (!t.startsWith('{')) return { ok: false, error: 'not JSON (no manifest on the server)' }
  try {
    return parseManifest(JSON.parse(t))
  } catch (e) {
    return { ok: false, error: `bad JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export type FetchText = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

/** Fetch and parse the manifest; never rejects. */
export async function fetchManifest(base: string, fetcher: FetchText = (u) => fetch(u, { cache: 'no-cache' })): Promise<ManifestResult> {
  try {
    const res = await fetcher(`${base}${MANIFEST_FILE}`)
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return parseManifestText(await res.text())
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Resolve "a/../b/./c" style paths (the glbs name shared textures as ../../materials/x.ktx2). Keeps a leading "/" and a scheme. */
export function normalizeUrl(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)?(.*)$/i.exec(url)
  const origin = m?.[1] ?? ''
  const path = m?.[2] ?? url
  const query = path.search(/[?#]/)
  const head = query >= 0 ? path.slice(0, query) : path
  const tail = query >= 0 ? path.slice(query) : ''
  const out: string[] = []
  for (const part of head.split('/')) {
    if (part === '..') {
      if (out.length > 1 || (out.length === 1 && out[0] !== '')) out.pop()
    } else if (part !== '.') out.push(part)
  }
  return origin + out.join('/') + tail
}

/** The URL of a zone's lightmap: beside the glb, or under assets/building/ when the name has a "/". */
export function lightmapUrl(base: string, zone: ManifestZone, file: string): string {
  if (file.includes('/')) return normalizeUrl(`${base}${BUILDING_DIR}${file}`)
  const glb = `${base}${BUILDING_DIR}${zone.glb}`
  return normalizeUrl(glb.slice(0, glb.lastIndexOf('/') + 1) + file)
}
