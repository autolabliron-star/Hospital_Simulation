/** The building's source (manifest or pilot) and the per-zone reflection probes that follow from it. */
import { afterEach, describe, expect, it } from 'vitest'
import { Texture, type WebGLRenderTarget, type WebGLRenderer } from 'three'
import { clearWarmGates, warmGateNames, warmGatesPending } from '@/scene/warmup/registry'
import {
  loadLobbyEnvironment,
  loadZoneProbes,
  lobbyProbe,
  probeEntriesFor,
  resetZoneProbesForTests,
  selectZoneProbe,
  zoneProbeEntries,
  zoneProbeTexture,
} from '@/scene/lighting/env/lobbyProbe'
import { manifestZone } from './fixtures.testutil'
import { parseManifest } from './manifest'
import { reflectionUniforms } from './reflections'
import { getCoverage, PILOT_CELL } from './region'
import { getBuildingSource, getManifest, notifyBuildingCommitted, resetBuildingSourceForTests, startBuildingSource } from './source'
import { ZONES } from './zones'

const rect = (id: string) => ZONES.find((z) => z.id === id)!.rects[0]
const MANIFEST = {
  version: 1,
  zones: [
    manifestZone('lobby', 1, { x0: -62, x1: -40, z0: -22, z1: 22 }, { probe: { hdr: 'zones/lobby/env.hdr', position: [-53, 1.6, 0], box: { x0: -62, x1: -40, y0: 0, y1: 3, z0: -6, z1: 6 } } }),
    manifestZone('core', 1, rect('core'), { probe: 'zones/core/env.hdr' }),
    manifestZone('theatres', 2, rect('theatres'), { probe: 'zones/theatres/env.hdr' }),
    manifestZone('atrium', 1, rect('atrium')),
  ],
  materials: { files: [], mb: 0 },
}
const text = (body: string, ok = true) => async () => ({ ok, status: ok ? 200 : 404, text: async () => body })
const gl = {} as WebGLRenderer
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

afterEach(() => {
  resetBuildingSourceForTests()
  clearWarmGates()
  resetZoneProbesForTests()
  lobbyProbe.ready = false
})

describe('the building source', () => {
  it('is procedural when the model is off (node, ?building=procedural)', async () => {
    expect(await startBuildingSource('/')).toBe('procedural')
    expect(getCoverage()).toBeNull()
  })

  it('no manifest: the pilot, with the pilot coverage; the gate holds until the model component committed', async () => {
    expect(await startBuildingSource('/', { modelOn: true, fetcher: text('', false) })).toBe('pilot')
    expect(getBuildingSource()).toBe('pilot')
    expect(getCoverage()?.cells).toEqual([PILOT_CELL])
    expect(warmGateNames()).toContain('building-source')
    await flush()
    expect(warmGatesPending()).toBe(1)
    notifyBuildingCommitted()
    await flush()
    expect(warmGatesPending()).toBe(0)
  })

  it('a manifest: the zones, with their coverage; bad zones warn', async () => {
    const warnings: string[] = []
    const body = JSON.stringify({ ...MANIFEST, zones: [...MANIFEST.zones, { id: 'mars' }] })
    expect(await startBuildingSource('/', { modelOn: true, fetcher: text(body), warn: (m) => warnings.push(m) })).toBe('zones')
    expect(getCoverage()?.cells).toEqual(['lobby', 'core', 'theatres', 'atrium'])
    expect(getManifest()?.zones).toHaveLength(4)
    expect(warnings).toHaveLength(1)
    // asked again: the same decision, no second fetch
    expect(await startBuildingSource('/', { modelOn: true, fetcher: () => Promise.reject(new Error('not again')) })).toBe('zones')
  })
})

describe('per-zone reflection probes', () => {
  const parsed = () => {
    const r = parseManifest(MANIFEST)
    if (!r.ok) throw new Error(r.error)
    return r.manifest
  }

  it('one probe per manifest zone that has one; the pilot keeps env_lobby.hdr', () => {
    const list = probeEntriesFor('zones', parsed())
    expect(list.map((e) => e.zone)).toEqual(['lobby', 'core', 'theatres'])
    expect(list[1].file).toBe('assets/building/zones/core/env.hdr')
    expect(probeEntriesFor('pilot', null).map((e) => e.file)).toEqual(['assets/building/env_lobby.hdr'])
    // a manifest with the lobby but no probes at all keeps the pilot's lobby probe for the lobby
    const bare = parseManifest({ version: 1, zones: [manifestZone('lobby', 1, rect('lobby'))] })
    expect(bare.ok && probeEntriesFor('zones', bare.manifest).map((e) => [e.zone, e.file])).toEqual([['lobby', 'assets/building/env_lobby.hdr']])
  })

  it('binds the camera zone probe on its storey and moves the box projection with it', () => {
    const list = probeEntriesFor('zones', parsed())
    for (const e of list) e.texture = new Texture()
    resetZoneProbesForTests(list, { perZone: true })
    expect(selectZoneProbe(-53, 1.6, 0)?.zone).toBe('lobby')
    expect(reflectionUniforms.uProbePos.value.toArray()).toEqual([-53, 1.6, 0])
    expect(reflectionUniforms.uBoxMax.value.x).toBe(-40)
    expect(selectZoneProbe(0, 1.6, 0)?.zone).toBe('core')
    expect(reflectionUniforms.uBoxMin.value.x).toBe(rect('core').x0)
    expect(zoneProbeTexture()).toBe(list[1].texture)
    expect(selectZoneProbe(30, 1.6, 0)).toBeNull() // the atrium has none
    expect(selectZoneProbe(-50, 4.2 + 1.6, 0)?.zone).toBe('theatres') // level 2, drawn 4.2 m up
    expect(selectZoneProbe(-53, 60, 0)).toBeNull() // the overview camera is above every storey
  })

  it('with today\'s single binding, only the primary probe (the lobby\'s) is ever bound', () => {
    const list = probeEntriesFor('zones', parsed())
    resetZoneProbesForTests(list, { perZone: false })
    expect(selectZoneProbe(-53, 1.6, 0)).toBeNull() // not loaded yet
    lobbyProbe.ready = true
    expect(selectZoneProbe(-53, 1.6, 0)?.zone).toBe('lobby')
    expect(selectZoneProbe(0, 1.6, 0)).toBeNull() // the core's probe is not what Lighting has bound
  })

  it('loadLobbyEnvironment loads the primary probe from the manifest; loadZoneProbes loads them all', async () => {
    await startBuildingSource('/b/', { modelOn: true, fetcher: text(JSON.stringify(MANIFEST)) })
    const urls: string[] = []
    const deps = {
      load: async (url: string) => {
        urls.push(url)
        if (url.includes('theatres')) throw new Error('404')
        return new Texture()
      },
      pmrem: () => ({ texture: new Texture(), dispose: () => undefined }) as unknown as WebGLRenderTarget,
    }
    const primary = await loadLobbyEnvironment(gl, '/b/', deps)
    expect(primary).not.toBeNull()
    expect(urls).toEqual(['/b/assets/building/zones/lobby/env.hdr'])
    const all = await loadZoneProbes(gl, '/b/', deps)
    expect(all.textures).toHaveLength(2) // the theatres' probe is missing: that zone simply has none
    expect(zoneProbeEntries().filter((e) => e.texture).map((e) => e.zone)).toEqual(['lobby', 'core'])
    all.dispose()
    expect(zoneProbeEntries().every((e) => e.texture === null)).toBe(true)
  })
})
