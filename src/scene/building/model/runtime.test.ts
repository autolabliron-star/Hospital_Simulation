/**
 * The zone runtime in node, over fake loaders but the real GLTFLoader: what loads before Enter (shared textures once, a skeleton of every zone,
 * the priority zones), what the warm-up is given (a proxy for every material of every zone, with the same program key), streaming after
 * Enter (one zone at a time, nearest first), a failed zone keeping its procedural cell, and culling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Group, Mesh, MeshStandardMaterial, PerspectiveCamera } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { LEVEL2_DX } from '@/sim/levels'
import { cellReplaced, resetCells } from './cells'
import { frustumOf } from './culling'
import { fakeKtx2, manifestZone, meshKeys, programKey, proxyGlb, zoneGlb, type FixtureMesh } from './fixtures.testutil'
import { normalizeUrl, parseManifest, type BuildingManifest } from './manifest'
import { ZoneRuntime, nextZone, priorityZones } from './runtime'
import { SharedTextures } from './sharedTextures'
import { fetchGlbJson, readGlbJson, skeletonGlb, skeletonTexturePlugin, type FetchBytes } from './skeleton'
import { ZONES } from './zones'

// GLTFLoader's external-image path reads `self.URL` (a browser global): node's own URL stands in
;(globalThis as { self?: unknown }).self ??= globalThis

const rectOf = (id: string) => {
  const rs = ZONES.find((z) => z.id === id)!.rects
  return { x0: Math.min(...rs.map((r) => r.x0)), x1: Math.max(...rs.map((r) => r.x1)), z0: Math.min(...rs.map((r) => r.z0)), z1: Math.max(...rs.map((r) => r.z1)) }
}

const MESHES: FixtureMesh[] = [
  { name: 'floor', material: 0, lightmap: 'lm_Terrazzo.ktx2' },
  { name: 'wall', material: 1, lightmap: 'lm_WallPaint.ktx2' },
  { name: 'led', material: 2 },
  { name: 'glass', material: 3 },
  { name: 'bench', material: 1, lightmap: 'lm_Terrazzo.ktx2', colors: true },
]
const IDS = ['lobby', 'er', 'imaging', 'wardA', 'wardB', 'core', 'atrium', 'theatres']
const MATERIAL_FILES = ['Terrazzo_diff', 'Terrazzo_nor', 'Terrazzo_arm', 'Plaster_diff'].map((n) => `materials/${n}.ktx2`)

function manifest(proxies: readonly string[] = []): BuildingManifest {
  const r = parseManifest({
    version: 1,
    zones: IDS.map((id) =>
      manifestZone(id, id === 'theatres' ? 2 : 1, rectOf(id), proxies.includes(id) ? { proxy: { glb: `zones/${id}/${id}.proxy.glb`, tris: 1, mb: 1.33, scale: 1.2 } } : {}),
    ),
    materials: { files: MATERIAL_FILES, mb: 10 },
  })
  if (!r.ok) throw new Error(r.error)
  return r.manifest
}

/** Everything a runtime needs, over in-memory files; records what was transcoded and when. */
function harness(opts: { failLightmapOf?: string[]; rangeIgnored?: boolean; proxies?: readonly string[]; missingProxyOf?: string[] } = {}) {
  const m = manifest(opts.proxies)
  const files = new Map<string, ArrayBuffer>()
  for (const z of m.zones) files.set(normalizeUrl(`/assets/building/${z.glb}`), zoneGlb(MESHES, { origin: [z.bounds.x0 + 1, z.bounds.y0, z.bounds.z0 + 1] }))
  for (const z of m.zones)
    if (z.proxy && !opts.missingProxyOf?.includes(z.id)) files.set(normalizeUrl(`/assets/building/${z.proxy.glb}`), proxyGlb([z.bounds.x0 + 1, z.bounds.y0, z.bounds.z0 + 1]))
  const ktx2Calls: string[] = []
  const shared = new SharedTextures({
    loadAsync: async (url) => {
      ktx2Calls.push(url)
      return fakeKtx2(url)
    },
  })
  const gltf = new GLTFLoader()
  gltf.register(shared.plugin())
  const skeleton = new GLTFLoader()
  skeleton.register(skeletonTexturePlugin())
  const inFlight = new Map<string, number>()
  let overlap = 0
  const lightmapCalls: string[] = []
  const fetcher: FetchBytes = async (url, init) => {
    const buf = files.get(url)
    if (!buf) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
    const range = /bytes=0-(\d+)/.exec(init?.headers?.Range ?? '')
    if (!range || opts.rangeIgnored) return { ok: true, status: 200, arrayBuffer: async () => buf }
    return { ok: true, status: 206, arrayBuffer: async () => buf.slice(0, Math.min(buf.byteLength, Number(range[1]) + 1)) }
  }
  const warn = vi.fn()
  const runtime = new ZoneRuntime({
    base: '/',
    manifest: m,
    shared,
    loaders: {
      parse: (buffer, path) => gltf.parseAsync(buffer, path) as Promise<{ scene: Group }>,
      fetch: async (url) => {
        const b = files.get(url)
        if (!b) throw new Error(`404 ${url}`)
        return b
      },
      lightmap: async (url) => {
        lightmapCalls.push(url)
        const zone = /zones\/(\w+)\//.exec(url)?.[1] ?? '?'
        inFlight.set(zone, (inFlight.get(zone) ?? 0) + 1)
        if ([...inFlight.values()].filter((n) => n > 0).length > 1) overlap++
        await new Promise((r) => setTimeout(r, 1))
        inFlight.set(zone, inFlight.get(zone)! - 1)
        if (opts.failLightmapOf?.includes(zone)) throw new Error('cannot transcode')
        return fakeKtx2(url)
      },
    },
    fetchJson: (url) => fetchGlbJson(url, fetcher),
    parseSkeleton: (buffer) => skeleton.parseAsync(buffer, '') as Promise<{ scene: Group }>,
    warn,
  })
  return { runtime, shared, ktx2Calls, lightmapCalls, overlap: () => overlap, warn, m }
}

const until = async (cond: () => boolean, ms = 2000): Promise<void> => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 2))
  }
}

beforeEach(() => resetCells())
afterEach(() => resetCells())

describe('the skeleton of a zone', () => {
  it('is read from the first bytes of the glb (Range), or from the whole file when the server ignores Range', async () => {
    const buf = zoneGlb(MESHES)
    const json = readGlbJson(buf)!.json
    let asks = 0
    const partial: FetchBytes = async (_u, init) => {
      const n = Number(/bytes=0-(\d+)/.exec(init?.headers?.Range ?? '')![1])
      const cap = ++asks === 1 ? 40 : Infinity // the first answer is too short for the JSON: a second, exact ask
      return { ok: true, status: 206, arrayBuffer: async () => buf.slice(0, Math.min(n + 1, cap)) }
    }
    const a = await fetchGlbJson('/z.glb', partial)
    expect(a.json).toEqual(json)
    expect(a.whole).toBeNull()
    expect(asks).toBe(2)
    const b = await fetchGlbJson('/z.glb', async () => ({ ok: true, status: 200, arrayBuffer: async () => buf }))
    expect(b.whole).toBe(buf)
    await expect(fetchGlbJson('/z.glb', async () => ({ ok: false, status: 404, arrayBuffer: async () => buf }))).rejects.toThrow(/404/)
  })

  it('builds, through GLTFLoader, the same program keys as the real zone', async () => {
    const h = harness()
    await h.runtime.preload([])
    // load one zone for real and compare mesh by mesh
    h.runtime.setView(true, 1, false, -30, 1.6, 0)
    h.runtime.startStreaming()
    await until(() => h.runtime.slot('imaging')!.state === 'uploading')
    const real = meshKeys(h.runtime.slot('imaging')!.model!.scene)
    const proxy = meshKeys(h.runtime.skeletons.children.find((c) => c.name === 'building-zone-skeleton-imaging') as Group)
    expect(real.size).toBe(MESHES.length)
    expect(proxy).toEqual(real)
    // the lightmapped ones really are baked, on channel 1, and every model material is clipped by the storey's cut
    expect(real.get('floor')).toContain('light:uv1')
    expect(real.get('floor')).toContain('key:baked-look|box|floor')
    expect(real.get('led')).toContain('light:-')
    expect(real.get('glass')).toContain('tr:true')
    expect(real.get('bench')).toContain('vc:true')
    for (const k of real.values()) expect(k).toContain('clip:1')
  })
})

describe('before Enter', () => {
  it('starts with the zone you are in and its neighbours', () => {
    const m = manifest()
    expect(priorityZones(m, -53, 0).sort()).toEqual(['er', 'imaging', 'lobby', 'wardA', 'wardB'])
    expect(priorityZones(m, 30, 0)[0]).toBe('atrium')
    expect(priorityZones(m, -70, 0)[0]).toBe('lobby') // the plaza: the nearest zone
    expect(priorityZones(m, -50 + LEVEL2_DX, 0)).toEqual(['theatres'])
    // a manifest with only the lobby, and a start in the core: the lobby anyway
    const only = parseManifest({ version: 1, zones: [manifestZone('lobby', 1, rectOf('lobby'))] })
    expect(only.ok && priorityZones(only.manifest, 0, 0)).toEqual(['lobby'])
  })

  it('loads the shared textures once, a skeleton of every zone, and the priority zones; the warm-up gets them all', async () => {
    const h = harness()
    await h.runtime.preload(['lobby', 'er'])
    // every shared file transcoded exactly once, though every zone's glb names them
    expect(h.ktx2Calls.sort()).toEqual(MATERIAL_FILES.map((f) => `/assets/building/${f}`).sort())
    expect(h.shared.size).toBe(MATERIAL_FILES.length)
    expect(h.runtime.skeletons.children).toHaveLength(IDS.length)
    for (const id of IDS) expect(h.runtime.slot(id)!.proxies.length, id).toBeGreaterThan(0)
    expect(h.runtime.slot('lobby')!.state).toBe('ready')
    expect(h.runtime.slot('er')!.state).toBe('ready')
    expect(h.runtime.slot('core')!.state).toBe('pending')
    expect(cellReplaced('lobby')).toBe(true)
    expect(cellReplaced('core')).toBe(false)
    // the warm-up: every proxy and every loaded material; the shared textures and the loaded lightmaps
    const mats = new Set(h.runtime.warmMaterials())
    for (const s of h.runtime.slots) for (const p of s.proxies) expect(mats.has(p)).toBe(true)
    for (const p of h.runtime.slot('lobby')!.model!.materials) expect(mats.has(p)).toBe(true)
    const tex = new Set(h.runtime.warmTextures())
    for (const t of h.shared.textures()) expect(tex.has(t)).toBe(true)
    for (const t of h.runtime.slot('er')!.model!.lightmaps) expect(tex.has(t)).toBe(true)
    // the loaded zones' material textures ARE the shared ones (one GPU upload)
    const floor = h.runtime.slot('er')!.model!.scene.getObjectByName('floor') as Mesh
    const map = (floor.material as MeshStandardMaterial).map!
    expect(map.source).toBe(h.shared.get('/assets/building/materials/Terrazzo_diff.ktx2')!.source)
    expect(h.overlap()).toBe(0)
  })

  it('does not download a zone twice when the server ignored the Range request', async () => {
    const h = harness({ rangeIgnored: true })
    await h.runtime.preload(['lobby'])
    expect(h.runtime.slot('lobby')!.state).toBe('ready')
    expect(h.runtime.slot('core')!.prefetched).not.toBeNull()
  })
})

describe('after Enter', () => {
  it('streams the rest one at a time, nearest to the camera first, and frees the skeletons at the end', async () => {
    const h = harness()
    await h.runtime.preload(['lobby'])
    h.runtime.setView(true, 1, false, 30, 1.6, 0) // in the atrium
    h.runtime.startStreaming()
    const order: string[] = []
    for (let i = 0; i < IDS.length - 1; i++) {
      await until(() => h.runtime.slots.some((s) => s.state === 'uploading'))
      const s = h.runtime.slots.find((x) => x.state === 'uploading')!
      order.push(s.zone.id)
      expect(cellReplaced(s.zone.id)).toBe(false) // the procedural region is drawn until the zone is
      h.runtime.finishUploadForTests()
      expect(cellReplaced(s.zone.id)).toBe(true)
    }
    expect(order[0]).toBe('atrium')
    expect(['wardA', 'wardB']).toContain(order[1]) // 12 m away; the core is 18 m
    expect(order[order.length - 1]).toBe('theatres') // the other storey last
    expect(h.runtime.slots.every((s) => s.state === 'ready')).toBe(true)
    expect(h.overlap()).toBe(0) // never two zones transcoding at once
    expect(h.runtime.skeletons.parent).toBeNull()
    expect(h.runtime.slots.every((s) => s.proxies.length === 0)).toBe(true)
  })

  it('a zone that fails keeps its procedural region, warns once, and the others still come', async () => {
    const h = harness({ failLightmapOf: ['core'] })
    await h.runtime.preload(['lobby'])
    h.runtime.setView(true, 1, false, 0, 1.6, 0)
    h.runtime.startStreaming()
    for (let i = 0; i < IDS.length - 2; i++) {
      await until(() => h.runtime.slots.some((s) => s.state === 'uploading'))
      h.runtime.finishUploadForTests()
    }
    await until(() => h.runtime.slots.every((s) => s.state === 'ready' || s.state === 'failed'))
    expect(h.runtime.slot('core')!.state).toBe('failed')
    expect(h.runtime.slot('core')!.error).toMatch(/lightmaps failed/)
    expect(cellReplaced('core')).toBe(false)
    expect(IDS.filter((id) => id !== 'core').every((id) => cellReplaced(id))).toBe(true)
    expect(h.warn.mock.calls.filter((c) => /core/.test(String(c[0])))).toHaveLength(1)
  })
})

describe('culling through the runtime', () => {
  it('draws only ready zones of the shown level inside the frustum', async () => {
    const h = harness()
    await h.runtime.preload(IDS)
    const cam = new PerspectiveCamera(70, 16 / 9, 0.1, 400)
    // standing in the lobby looking east down the building
    cam.position.set(-55, 1.6, 0)
    cam.lookAt(40, 1.6, 0)
    cam.updateMatrixWorld()
    h.runtime.setView(true, 1, false, -55, 1.6, 0)
    h.runtime.cull(frustumOf(cam))
    const vis = (id: string) => h.runtime.slot(id)!.model!.scene.visible
    expect(vis('lobby')).toBe(true)
    expect(vis('core')).toBe(true)
    expect(vis('theatres')).toBe(false) // another storey
    // turn round: looking west out of the entrance, the east of the building is behind you
    cam.lookAt(-90, 1.6, 0)
    cam.updateMatrixWorld()
    h.runtime.cull(frustumOf(cam))
    expect(vis('lobby')).toBe(true)
    expect(vis('atrium')).toBe(false)
    expect(vis('core')).toBe(false)
  })
})

describe('nextZone', () => {
  it('prefers the camera level, then the nearest', () => {
    const h = harness()
    expect(nextZone(h.runtime.slots, 2, -50, 0)?.zone.id).toBe('theatres')
    expect(nextZone(h.runtime.slots, 1, 30, 0)?.zone.id).toBe('atrium')
  })
})

describe('skeletonGlb', () => {
  it('keeps nodes, extras and materials, drops the heavy parts', () => {
    const json = readGlbJson(zoneGlb(MESHES))!.json
    const sk = readGlbJson(skeletonGlb({ ...json, extensionsRequired: ['KHR_texture_basisu', 'EXT_meshopt_compression'] }))!.json
    expect(sk.nodes).toEqual(json.nodes)
    expect(sk.materials).toEqual(json.materials)
    expect(sk.extensionsRequired).toEqual(['KHR_texture_basisu'])
    expect((sk.images as unknown[]).length).toBe(1)
    expect(Object.keys(sk.meshes![4].primitives![0].attributes as object).sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION', 'TEXCOORD_0', 'TEXCOORD_1'])
  })
})

describe('overview proxies (LOD)', () => {
  const L1 = IDS.filter((id) => id !== 'theatres')
  const drawnFull = (h: ReturnType<typeof harness>) => h.runtime.slots.filter((s) => s.model?.scene.visible).map((s) => s.zone.id).sort()
  const drawnFar = (h: ReturnType<typeof harness>) => h.runtime.slots.filter((s) => s.far?.scene.visible).map((s) => s.zone.id).sort()

  it('loads every proxy before Enter: the cells go at once, one shared unlit program, all of it in the warm-up', async () => {
    const h = harness({ proxies: IDS })
    await h.runtime.preload(['lobby'])
    const mats = new Set(h.runtime.warmMaterials())
    const tex = new Set(h.runtime.warmTextures())
    const keys = new Set<string>()
    for (const s of h.runtime.slots) {
      expect(s.far, s.zone.id).not.toBeNull()
      expect(cellReplaced(s.zone.id), s.zone.id).toBe(true) // the proxy stands in for the procedural cell straight away
      expect(mats.has(s.far!.material)).toBe(true)
      expect(tex.has(s.far!.texture)).toBe(true)
      expect(s.far!.material.color.r).toBeCloseTo(1.5) // the glb's proxyScale wins over the manifest's
      expect(s.far!.mesh.castShadow).toBe(false)
      keys.add(programKey(s.far!.material, s.far!.mesh))
    }
    expect(keys.size).toBe(1)
    const [key] = keys
    expect(key).toContain('MeshBasicMaterial')
    expect(key).toContain('map:uv0')
    expect(key).toContain('clip:1')
    expect(h.runtime.slot('theatres')!.far!.material.clippingPlanes![0]).not.toBe(h.runtime.slot('lobby')!.far!.material.clippingPlanes![0])
  })

  it('the overview draws proxies only; walking draws the zones near you in full; zooming onto a zone brings it in full', async () => {
    const h = harness({ proxies: IDS })
    await h.runtime.preload(IDS)
    h.runtime.setView(false, 1, true, -11, 60, 0) // the default overview
    h.runtime.cull(null)
    expect(drawnFull(h)).toEqual([])
    expect(drawnFar(h)).toEqual([...L1].sort())
    expect(h.runtime.drawnCounts()).toEqual({ full: 0, far: L1.length })
    // the overview of level 2: the theatres' proxy, level 1 around the slab as proxies
    h.runtime.setView(false, 2, true, -11, 60, 0)
    h.runtime.cull(null)
    expect(drawnFar(h)).toEqual(['atrium', 'core', 'imaging', 'theatres', 'wardA', 'wardB'])
    // walking in the middle of the lobby: the lobby and the ER (6 m) in full, the rest as proxies
    h.runtime.setView(true, 1, false, -53, 1.6, 0)
    h.runtime.cull(null)
    expect(drawnFull(h)).toEqual(['er', 'lobby'])
    expect(drawnFar(h)).toEqual(['atrium', 'core', 'imaging', 'wardA', 'wardB'])
    // towards imaging: in full under 9 m, and it stays full until 11 m (hysteresis)
    h.runtime.setView(true, 1, false, -48.5, 1.6, 0)
    h.runtime.cull(null)
    expect(drawnFull(h)).toContain('imaging')
    h.runtime.setView(true, 1, false, -50.5, 1.6, 0)
    h.runtime.cull(null)
    expect(drawnFull(h)).toContain('imaging')
    h.runtime.setView(true, 1, false, -51.5, 1.6, 0)
    h.runtime.cull(null)
    expect(drawnFar(h)).toContain('imaging')
    // never both, never neither, for a drawn zone
    for (const s of h.runtime.slots) expect(s.model!.scene.visible && s.far!.scene.visible).toBe(false)
    // the overview zoomed down onto the core (26 m up, a room shot): the core in full, the zones around it as proxies
    h.runtime.setView(false, 1, true, -5, 26, 0)
    h.runtime.cull(null)
    expect(drawnFull(h)).toEqual(['core'])
    expect(drawnFar(h)).toContain('wardA')
  })

  it('a zone near you whose full model is not ready yet shows its proxy', async () => {
    const h = harness({ proxies: IDS })
    await h.runtime.preload([])
    h.runtime.setView(true, 1, false, 0, 1.6, 0) // in the core
    h.runtime.cull(null)
    expect(h.runtime.slot('core')!.state).toBe('pending')
    expect(drawnFar(h)).toContain('core')
  })

  it('a zone without a proxy, or whose proxy fails to load, draws its full model at every distance', async () => {
    const h = harness({ proxies: IDS.filter((id) => id !== 'core'), missingProxyOf: ['atrium'] })
    await h.runtime.preload(IDS)
    expect(h.runtime.slot('atrium')!.far).toBeNull()
    expect(h.warn.mock.calls.filter((c) => /atrium: no overview proxy/.test(String(c[0])))).toHaveLength(1)
    h.runtime.setView(false, 1, true, -11, 60, 0)
    h.runtime.cull(null)
    expect(drawnFull(h)).toEqual(['atrium', 'core'])
    expect(drawnFar(h)).toEqual(['er', 'imaging', 'lobby', 'wardA', 'wardB'])
  })

  it('a zone whose full model fails loses its proxy too and keeps its procedural region', async () => {
    const h = harness({ proxies: IDS, failLightmapOf: ['core'] })
    await h.runtime.preload(['lobby'])
    expect(cellReplaced('core')).toBe(true) // its proxy stood in
    h.runtime.setView(true, 1, false, 0, 1.6, 0)
    h.runtime.startStreaming()
    for (let i = 0; i < IDS.length - 2; i++) {
      await until(() => h.runtime.slots.some((s) => s.state === 'uploading'))
      h.runtime.finishUploadForTests()
    }
    await until(() => h.runtime.slots.every((s) => s.state === 'ready' || s.state === 'failed'))
    expect(h.runtime.slot('core')!.state).toBe('failed')
    expect(h.runtime.slot('core')!.far).toBeNull()
    expect(cellReplaced('core')).toBe(false)
    h.runtime.setView(false, 1, true, -11, 60, 0)
    h.runtime.cull(null)
    expect(drawnFar(h)).not.toContain('core')
    expect(drawnFull(h)).not.toContain('core')
  })
})
