/** Which zones are drawn, per camera position, level and mode (./culling.ts), and the upload batches (./uploader.ts). */
import { describe, expect, it } from 'vitest'
import { Mesh, OrthographicCamera, PerspectiveCamera } from 'three'
import { LOD_HYSTERESIS_M, LOD_VIEW_FULL_M, LOD_WALK_FULL_M, cameraZoneIndex, cullEntry, cullZones, frustumOf, levelAllows, setVisibilitySets, wantsFull, zoneLodDistance, type CullEntry, type CullView } from './culling'
import { geometryBatchEnd, uploadJob, UPLOAD_BYTES_PER_FRAME } from './uploader'
import { ZONES } from './zones'

const bounds = (id: string) => {
  const z = ZONES.find((x) => x.id === id)!
  const y0 = z.level === 2 ? 4.2 : 0
  return {
    x0: Math.min(...z.rects.map((r) => r.x0)),
    x1: Math.max(...z.rects.map((r) => r.x1)),
    z0: Math.min(...z.rects.map((r) => r.z0)),
    z1: Math.max(...z.rects.map((r) => r.z1)),
    y0,
    y1: y0 + 3.2,
  }
}
const entries = (): CullEntry[] =>
  ZONES.map((z) => {
    const e = cullEntry(z, bounds(z.id))
    e.ready = true
    return e
  })
const view = (v: Partial<CullView>): CullView => ({ walking: false, shown: 1, overview: true, x: 0, y: 60, z: 0, ...v })
const drawn = (es: CullEntry[]) => es.filter((e) => e.visible).map((e) => e.id)

describe('level rule', () => {
  it('overview level 1: every level-1 zone; level 2 none', () => {
    const es = entries()
    cullZones(es, view({}), null)
    expect(drawn(es).sort()).toEqual(['atrium', 'core', 'er', 'imaging', 'lobby', 'wardA', 'wardB'])
  })
  it('overview level 2: the theatres, and level 1 around the slab (not lobby and ER under it)', () => {
    const es = entries()
    cullZones(es, view({ shown: 2 }), null)
    expect(drawn(es).sort()).toEqual(['atrium', 'core', 'imaging', 'theatres', 'wardA', 'wardB'])
    expect(levelAllows(es.find((e) => e.id === 'lobby')!, view({ shown: 2 }))).toBe(false)
  })
  it('walking on level 2: only level 2 (the roof cap closes the hospital below)', () => {
    const es = entries()
    cullZones(es, view({ walking: true, overview: false, shown: 2, x: -50, y: 5.8, z: 0 }), null)
    expect(drawn(es)).toEqual(['theatres'])
  })
  it('a zone that is not ready is never drawn', () => {
    const es = entries()
    es.find((e) => e.id === 'core')!.ready = false
    cullZones(es, view({}), null)
    expect(drawn(es)).not.toContain('core')
  })
})

describe('frustum', () => {
  it('walking in the lobby looking east sees the building ahead, not what is behind', () => {
    const es = entries()
    const cam = new PerspectiveCamera(70, 16 / 9, 0.1, 300)
    cam.position.set(-30, 1.6, 0)
    cam.lookAt(40, 1.6, 0)
    cam.updateMatrixWorld()
    const v = view({ walking: true, overview: false, x: -30, y: 1.6, z: 0 })
    cullZones(es, v, frustumOf(cam))
    expect(drawn(es)).toEqual(expect.arrayContaining(['imaging', 'core', 'atrium']))
    expect(drawn(es)).not.toContain('lobby') // x -62..-40 lies behind a camera at -30 looking east
    expect(drawn(es)).not.toContain('er')
  })
  it('the overview camera high above sees the whole storey', () => {
    const es = entries()
    const cam = new OrthographicCamera(-70, 70, 40, -40, 0.1, 500)
    cam.position.set(-11, 120, 0)
    cam.lookAt(-11, 0, 0)
    cam.updateMatrixWorld()
    cullZones(es, view({}), frustumOf(cam))
    expect(drawn(es)).toHaveLength(7)
  })
})

describe('portals (potential visibility sets)', () => {
  it('walking inside a zone with a set draws only the set; without one, everything that passes the frustum', () => {
    const es = entries()
    setVisibilitySets(es, (id) => (id === 'wardA' ? ['core', 'lobby'] : null))
    const inWardA = view({ walking: true, overview: false, x: 0, y: 1.6, z: -17 })
    expect(es[cameraZoneIndex(es, inWardA)].id).toBe('wardA')
    cullZones(es, inWardA, null)
    expect(drawn(es).sort()).toEqual(['core', 'lobby', 'wardA'])
    const inCore = view({ walking: true, overview: false, x: 0, y: 1.6, z: 0 })
    cullZones(es, inCore, null)
    expect(drawn(es)).toHaveLength(7)
    // the overview never uses the sets
    cullZones(es, view({ x: 0, z: -17 }), null)
    expect(drawn(es)).toHaveLength(7)
  })
})

describe('detail (LOD): full model near the camera, overview proxy far', () => {
  const withFar = (): CullEntry[] => {
    const es = entries()
    for (const e of es) e.farReady = true
    return es
  }
  const full = (es: CullEntry[]) => es.filter((e) => e.drawFull).map((e) => e.id).sort()
  const far = (es: CullEntry[]) => es.filter((e) => e.drawFar).map((e) => e.id).sort()

  it('the default overview draws every zone as its proxy', () => {
    const es = withFar()
    cullZones(es, view({ x: -11, y: 60, z: 0 }), null)
    expect(full(es)).toEqual([])
    expect(far(es)).toEqual(['atrium', 'core', 'er', 'imaging', 'lobby', 'wardA', 'wardB'])
  })

  it('walking: the zones within the walking distance of their rects in full, in plan (height does not matter)', () => {
    const es = withFar()
    cullZones(es, view({ walking: true, overview: false, x: 30, y: 1.6, z: 0 }), null) // in the atrium
    expect(full(es)).toEqual(['atrium'])
    cullZones(es, view({ walking: true, overview: false, x: 0, y: 1.6, z: -14 }), null) // in corridor A, by the core
    expect(full(es)).toEqual(['core', 'wardA'])
    const core = es.find((e) => e.id === 'core')!
    expect(zoneLodDistance(core, view({ walking: true, overview: false, x: 0, y: 99, z: -14 }))).toBeCloseTo(2)
  })

  it('has hysteresis, so a zone on the line does not flicker', () => {
    const e = withFar().find((x) => x.id === 'imaging')!
    const at = (x: number) => view({ walking: true, overview: false, x, y: 1.6, z: 0 }) // imaging starts at x = -40
    e.full = false
    expect(wantsFull(e, at(-40 - LOD_WALK_FULL_M - 0.5))).toBe(false)
    expect(wantsFull(e, at(-40 - LOD_WALK_FULL_M + 0.5))).toBe(true)
    e.full = true
    expect(wantsFull(e, at(-40 - LOD_WALK_FULL_M - LOD_HYSTERESIS_M + 0.5))).toBe(true)
    expect(wantsFull(e, at(-40 - LOD_WALK_FULL_M - LOD_HYSTERESIS_M - 0.5))).toBe(false)
  })

  it('any other view: by the 3D distance to the zone box; what is not ready falls back to the other representation', () => {
    const es = withFar()
    const low = view({ x: 0, y: 3.7 + LOD_VIEW_FULL_M - 1, z: 0 }) // just over the core's padded box
    cullZones(es, low, null)
    expect(full(es)).toEqual(['core'])
    // the core's full model not ready: its proxy; another zone's proxy not ready: its full model
    es.find((e) => e.id === 'core')!.ready = false
    es.find((e) => e.id === 'atrium')!.farReady = false
    cullZones(es, low, null)
    expect(far(es)).toContain('core')
    expect(full(es)).toEqual(['atrium'])
    // a drawn zone shows exactly one representation
    for (const e of es) expect(Number(e.drawFull) + Number(e.drawFar)).toBe(e.visible ? 1 : 0)
  })
})

describe('upload batches', () => {
  it('take at least one mesh, then as many as fit the byte budget', () => {
    const meshes = [1, 2, 3, 4].map(() => new Mesh())
    const sizes = new Map<Mesh, number>([
      [meshes[0], UPLOAD_BYTES_PER_FRAME * 2],
      [meshes[1], 100],
      [meshes[2], UPLOAD_BYTES_PER_FRAME - 150],
      [meshes[3], 100],
    ])
    const job = uploadJob(meshes[0], meshes, [], (m) => sizes.get(m)!)
    expect(geometryBatchEnd(job, 0)).toBe(1) // one big mesh alone
    expect(geometryBatchEnd(job, 1)).toBe(3)
    expect(geometryBatchEnd(job, 3)).toBe(4)
  })
})
