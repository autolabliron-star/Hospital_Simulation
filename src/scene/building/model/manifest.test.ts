/** The zone manifest: parsing, validation, the pilot fallback when there is none, paths. */
import { describe, expect, it } from 'vitest'
import { LEVEL2_DX } from '@/sim/levels'
import { manifestZone } from './fixtures.testutil'
import { fetchManifest, lightmapUrl, normalizeUrl, parseManifest, parseManifestText } from './manifest'
import { ZONES } from './zones'

const rectOf = (id: string) => ZONES.find((z) => z.id === id)!.rects[0]
const good = () => ({
  version: 1,
  zones: [manifestZone('lobby', 1, rectOf('lobby'), { probe: 'zones/lobby/env.hdr', replaces: ['lobby'] }), manifestZone('imaging', 1, rectOf('imaging'))],
  materials: { files: ['materials/Terrazzo_diff.ktx2'], mb: 12.5 },
})

describe('parseManifest', () => {
  it('reads a zone\'s overview proxy; a malformed one warns and the zone is drawn in full', () => {
    const m = good()
    Object.assign(m.zones[0], { proxy: { glb: 'zones/lobby/lobby.proxy.glb', tris: 6531, mb: 1.33, atlas: 1024, scale: 1.14 } })
    Object.assign(m.zones[1], { proxy: { glb: '/abs/imaging.proxy.glb' } })
    const r = parseManifest(m)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.manifest.zones[0].proxy).toEqual({ glb: 'zones/lobby/lobby.proxy.glb', tris: 6531, mb: 1.33, scale: 1.14 })
    expect(r.manifest.zones[1].proxy).toBeNull()
    expect(r.warnings).toEqual(['zone imaging: its overview proxy is malformed; the zone is drawn in full at every distance'])
    // none at all is no proxy, silently; a bad scale is no scale
    const n = good()
    Object.assign(n.zones[0], { proxy: { glb: 'zones/lobby/lobby.proxy.glb', scale: -1 } })
    const r2 = parseManifest(n)
    expect(r2.ok && r2.manifest.zones[0].proxy).toEqual({ glb: 'zones/lobby/lobby.proxy.glb', tris: 0, mb: 0, scale: null })
    expect(r2.ok && r2.manifest.zones[1].proxy).toBeNull()
    expect(r2.ok && r2.warnings).toEqual([])
  })

  it('reads a good manifest', () => {
    const r = parseManifest(good())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings).toEqual([])
    expect(r.manifest.zones.map((z) => z.id)).toEqual(['lobby', 'imaging'])
    expect(r.manifest.materials).toEqual({ files: ['materials/Terrazzo_diff.ktx2'], mb: 12.5 })
    const lobby = r.manifest.zones[0]
    expect(lobby.replaces).toEqual(['lobby'])
    expect(lobby.visibleFrom).toBeNull()
    expect(lobby.simStrip).toBe(false)
    // a probe given as a file: the centre of the bounds at eye height is its eye, the room (zones.json rect) holding it its box
    expect(lobby.probe?.hdr).toBe('zones/lobby/env.hdr')
    expect(lobby.probe?.position.y).toBeCloseTo(1.6, 9)
    expect(lobby.probe?.box).toEqual({ x0: -62, x1: -40, z0: -6, z1: 6, y0: 0, y1: 3 })
    expect(r.manifest.zones[1].probe).toBeNull()
  })

  it('reads the pipeline\'s probe + probeAt (bounds that run out over the forecourt do not become the box)', () => {
    const m = good()
    Object.assign(m.zones[0], { bounds: { x0: -76.5, x1: -39.88, z0: -24.5, z1: 24.5, y0: -0.06, y1: 3.32 }, probe: 'zones/lobby/env_lobby.hdr', probeAt: [-53, 1.6, 0] })
    const r = parseManifest(m)
    expect(r.ok && r.manifest.zones[0].probe).toEqual({ hdr: 'zones/lobby/env_lobby.hdr', position: { x: -53, y: 1.6, z: 0 }, box: { x0: -62, x1: -40, z0: -6, z1: 6, y0: 0, y1: 3 } })
    ;(m.zones[0] as Record<string, unknown>).probeAt = 'here'
    const bad = parseManifest(m)
    expect(bad.ok && bad.manifest.zones[0].probe).toBeNull()
    expect(bad.ok && bad.warnings.join()).toMatch(/probe is malformed/)
  })

  it('takes a probe with its own eye and box', () => {
    const m = good()
    ;(m.zones[0] as Record<string, unknown>).probe = { hdr: 'env_lobby.hdr', position: [-53, 1.6, 0], box: { x0: -62, x1: -40, y0: 0, y1: 3, z0: -6, z1: 6 } }
    const r = parseManifest(m)
    expect(r.ok && r.manifest.zones[0].probe).toEqual({ hdr: 'env_lobby.hdr', position: { x: -53, y: 1.6, z: 0 }, box: { x0: -62, x1: -40, y0: 0, y1: 3, z0: -6, z1: 6 } })
  })

  it('drops a bad zone with a warning and keeps the rest', () => {
    const m = good()
    m.zones.push({ ...manifestZone('nowhere', 1, rectOf('lobby')) })
    m.zones.push({ ...manifestZone('er', 2, rectOf('er')) }) // wrong level
    m.zones.push({ ...manifestZone('core', 1, rectOf('core')), glb: '/abs/core.glb' })
    m.zones.push({ ...manifestZone('atrium', 1, rectOf('atrium')), bounds: { x0: 1, x1: 0, y0: 0, y1: 3, z0: 0, z1: 1 } })
    m.zones.push({ ...manifestZone('lobby', 1, rectOf('lobby')) }) // twice
    m.zones.push({ ...manifestZone('wardA', 1, rectOf('wardA')), lightmaps: 'lm.ktx2' as unknown as string[] })
    const r = parseManifest(m)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.manifest.zones.map((z) => z.id)).toEqual(['lobby', 'imaging'])
    expect(r.warnings).toHaveLength(6)
    expect(r.warnings.join('\n')).toMatch(/nowhere.*not a zone/)
    expect(r.warnings.join('\n')).toMatch(/er: level 2/)
  })

  it('fails a manifest with no usable zone or a bad top level', () => {
    expect(parseManifest(null).ok).toBe(false)
    expect(parseManifest({ zones: [] }).ok).toBe(false)
    expect(parseManifest({ version: 1, zones: [] }).ok).toBe(false)
    expect(parseManifest({ version: 1, zones: {} }).ok).toBe(false)
    expect(parseManifest({ ...good(), materials: { files: ['/abs.ktx2'] } }).ok).toBe(false)
    expect(parseManifest({ version: 1, zones: [{ id: 'nowhere' }] }).ok).toBe(false)
  })

  it('places a level-2 zone authored in the sim strip over the building', () => {
    const r = parseManifest({ version: 1, zones: [manifestZone('theatres', 2, { x0: 88, x1: 110, z0: -22, z1: 22 }, { probe: 'zones/theatres/env.hdr' })], materials: { files: [], mb: 0 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const t = r.manifest.zones[0]
    expect(t.simStrip).toBe(true)
    expect(t.bounds.x0).toBe(88 - LEVEL2_DX)
    expect(t.bounds.y0).toBe(4.2) // already drawn heights stay
    expect(t.mountOffset).toEqual({ x: -LEVEL2_DX, y: 0 })
    expect(t.probe?.position.x).toBeCloseTo((88 + 110) / 2 - LEVEL2_DX, 9)
    // floor-relative heights in the strip go one storey up
    const r2 = parseManifest({ version: 1, zones: [{ ...manifestZone('theatres', 2, { x0: 88, x1: 110, z0: -22, z1: 22 }), bounds: { x0: 88, x1: 110, z0: -22, z1: 22, y0: 0, y1: 3 } }] })
    expect(r2.ok && r2.manifest.zones[0].bounds.y0).toBe(4.2)
    expect(r2.ok && r2.manifest.zones[0].mountOffset).toEqual({ x: -LEVEL2_DX, y: 4.2 })
  })

  it('keeps only known zones in a visibility set', () => {
    const m = good()
    ;(m.zones[0] as Record<string, unknown>).visibleFrom = ['imaging', 'mars']
    const r = parseManifest(m)
    expect(r.ok && r.manifest.zones[0].visibleFrom).toEqual(['imaging'])
  })
})

describe('no manifest means the pilot', () => {
  it('an HTML page, empty text or bad JSON is no manifest', () => {
    expect(parseManifestText('<!doctype html><html>').ok).toBe(false)
    expect(parseManifestText('').ok).toBe(false)
    expect(parseManifestText('{ nope').ok).toBe(false)
    expect(parseManifestText(JSON.stringify(good())).ok).toBe(true)
  })

  it('fetchManifest never rejects: 404, network error, index page', async () => {
    const urls: string[] = []
    const f404 = await fetchManifest('/base/', async (u) => {
      urls.push(u)
      return { ok: false, status: 404, text: async () => '' }
    })
    expect(f404.ok).toBe(false)
    expect(urls).toEqual(['/base/assets/building/manifest.json'])
    expect((await fetchManifest('/', () => Promise.reject(new Error('offline')))).ok).toBe(false)
    expect((await fetchManifest('/', async () => ({ ok: true, status: 200, text: async () => '<html>' }))).ok).toBe(false)
    expect((await fetchManifest('/', async () => ({ ok: true, status: 200, text: async () => JSON.stringify(good()) }))).ok).toBe(true)
  })
})

describe('paths', () => {
  it('normalises the shared material URIs the glbs use', () => {
    expect(normalizeUrl('/assets/building/zones/lobby/../../materials/a.ktx2')).toBe('/assets/building/materials/a.ktx2')
    expect(normalizeUrl('/sub/assets/./building/x.ktx2')).toBe('/sub/assets/building/x.ktx2')
    expect(normalizeUrl('http://h:5173/a/b/../c.ktx2?v=1')).toBe('http://h:5173/a/c.ktx2?v=1')
    expect(normalizeUrl('/../a.ktx2')).toBe('/a.ktx2')
  })
  it('finds a lightmap beside its glb, or under assets/building when it names a folder', () => {
    const r = parseManifest(good())
    if (!r.ok) throw new Error(r.error)
    const z = r.manifest.zones[0]
    expect(lightmapUrl('/', z, 'lm_Terrazzo.ktx2')).toBe('/assets/building/zones/lobby/lm_Terrazzo.ktx2')
    expect(lightmapUrl('/b/', z, 'lightmaps/lobby/lm_Oak.ktx2')).toBe('/b/assets/building/lightmaps/lobby/lm_Oak.ktx2')
  })
})
