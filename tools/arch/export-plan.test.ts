/** Wave 3: the plan Blender builds the hospital from is the sim's own floor plan, complete and in the drawn frame. */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AREAS, BUILDING, DOORS } from '../../src/sim/places'
import { LEVEL2_FOOTPRINT } from '../../src/sim/levels'
import { buildWallPieces } from '../../src/scene/building/layout/walls'
import { buildLayout } from '../../src/scene/building/layout'
import { ZONES, exportPlan, zoneOf } from './export-plan'

const inside = (x: number, z: number, r: { x0: number; x1: number; z0: number; z1: number }) => x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6 && z >= r.z0 - 1e-6 && z <= r.z1 + 1e-6

describe('the floor plan for the architectural model', () => {
  const plan = exportPlan()

  it('carries every area, door and wall piece of the sim', () => {
    expect(plan.areas.length).toBe(AREAS.length)
    expect(plan.doors.length).toBe(DOORS.length)
    expect(plan.walls.length).toBe(buildWallPieces().length)
  })

  it('draws level 2 back over the west block: every level-2 door and wall is inside its footprint as drawn', () => {
    for (const d of plan.doors.filter((d) => d.level === 2)) expect(inside(d.x, d.z, LEVEL2_FOOTPRINT), d.id).toBe(true)
    for (const w of plan.walls.filter((w) => w.level === 2)) {
      const [x0, z0, x1, z1] = w.alongX ? [w.a, w.c, w.b, w.c] : [w.c, w.a, w.c, w.b]
      expect(inside(x0, z0, LEVEL2_FOOTPRINT) && inside(x1, z1, LEVEL2_FOOTPRINT)).toBe(true)
    }
    expect(plan.levels.map((l) => l.y)).toEqual([0, 4.2])
  })

  it('is deterministic', () => {
    expect(JSON.stringify(exportPlan())).toBe(JSON.stringify(plan))
  })

  it('carries the lobby furniture anchors: every waiting seat, the reception station and the seat rows, exactly as the layout has them', () => {
    const f = plan.furniture
    const layout = buildLayout()
    const lobbySeats = layout.seats.filter((s) => s.area === 'lobby' && s.kind === 'waiting')
    expect(lobbySeats.length).toBe(14)
    for (const s of lobbySeats) {
      const e = f.seats.find((x) => x.id === s.id)
      expect(e, s.id).toBeDefined()
      expect(Math.abs((e?.x ?? 0) - s.x)).toBeLessThan(0.001)
      expect(Math.abs((e?.z ?? 0) - s.z)).toBeLessThan(0.001)
      expect(e?.height).toBe(s.height)
    }
    for (const id of ['lobby:seatsN1', 'lobby:seatsN2', 'lobby:seatsS1', 'lobby:seatsS2', 'lobby:plantNW', 'lobby:plantSW', 'lobby:sideTable', 'lobby:reception'])
      expect(f.footprints.some((p) => p.id === id), id).toBe(true)
    const rec = f.stations.find((s) => s.id === 'lobby:reception')
    expect(rec?.nodes).toEqual(['lobby:reception'])
    expect(rec?.x).toBeCloseTo(-51.52, 3)
    // everything listed is inside the building as drawn, on its level, in the zone that owns its centre
    for (const p of [...f.seats, ...f.footprints]) {
      expect(inside(p.x, p.z, p.level === 2 ? LEVEL2_FOOTPRINT : BUILDING), p.id).toBe(true)
      expect(p.zone, p.id).toBe(zoneOf(p.level, p.x, p.z))
    }
    expect(f.seats.some((s) => s.level === 2)).toBe(true)
  })
})

describe('the zones of the authored model (tools/arch/zones.json)', () => {
  const plan = exportPlan()
  const ids = ZONES.zones.map((z) => z.id)

  it('lists 8 zones with unique ids and every area of the plan in exactly one zone, on that zone\'s level', () => {
    expect(ids.length).toBe(8)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of plan.areas) {
      const owners = ZONES.zones.filter((z) => z.areas.includes(a.id))
      expect(owners.length, a.id).toBe(1)
      expect(owners[0].level, a.id).toBe(a.level)
      expect(a.zone).toBe(owners[0].id)
    }
    const known = new Set(plan.areas.map((a) => a.id))
    for (const z of ZONES.zones) for (const a of z.areas) expect(known.has(a), `${z.id}: ${a}`).toBe(true)
  })

  it('tiles each level: every point of the level footprint is inside some zone rect of that level', () => {
    for (const lv of plan.levels)
      for (let x = lv.footprint.x0; x <= lv.footprint.x1; x += 0.5)
        for (let z = lv.footprint.z0; z <= lv.footprint.z1; z += 0.5) {
          const hit = ZONES.zones.some((zn) => zn.level === lv.id && zn.rects.some((r) => inside(x, z, r)))
          expect(hit, `level ${lv.id} (${x}, ${z})`).toBe(true)
        }
  })

  it('gives every wall piece, glazing span and door one owning zone of its own level (first listed zone wins on a border)', () => {
    const levelOfZone = new Map(ZONES.zones.map((z) => [z.id, z.level]))
    for (const w of plan.walls) {
      expect(levelOfZone.get(w.zone), JSON.stringify(w)).toBe(w.level)
      if (w.cls === 'glassCut') {
        expect(w.spans && w.spans.length > 0, JSON.stringify(w)).toBe(true)
        for (const s of w.spans ?? []) {
          expect(levelOfZone.get(s.zone)).toBe(w.level)
          expect(s.a >= Math.min(w.a, w.b) - 1e-6 && s.b <= Math.max(w.a, w.b) + 1e-6).toBe(true)
        }
      } else expect(w.spans).toBeUndefined()
    }
    for (const d of plan.doors) expect(d.zone, d.id).toBe(zoneOf(d.level, d.x, d.z))
    // the border rule: the lobby (listed first) owns the spine's east wall line at x = -40 and the lobby / triage partition
    expect(zoneOf(1, -40, 0)).toBe('lobby')
    expect(zoneOf(1, -53, -6)).toBe('lobby')
    // the lobby's curtain wall spans belong to the lobby although the west façade piece they are cut from is the ER's
    const west = plan.walls.find((w) => w.level === 1 && !w.alongX && w.c === -62 && w.a === -22)
    expect(west?.zone).toBe('er')
    expect(west?.spans?.map((s) => s.zone)).toEqual(['er', 'lobby'])
  })

  it('every zone owns at least one area, and level 2 is the theatres', () => {
    for (const z of ZONES.zones) expect(plan.areas.some((a) => a.zone === z.id), z.id).toBe(true)
    expect(plan.areas.filter((a) => a.level === 2).every((a) => a.zone === 'theatres')).toBe(true)
  })
})

describe('the building manifest the runtime loads (public/assets/building/manifest.json, tools/arch/optimize.mjs)', () => {
  const dir = resolve(process.cwd(), 'public/assets/building')
  const file = resolve(dir, 'manifest.json')
  const has = existsSync(file)

  it.skipIf(!has)('lists baked zones in zones.json order, every file it names exists, and each glb references exactly its lightmaps and shared materials', () => {
    const m = JSON.parse(readFileSync(file, 'utf8')) as {
      version: number
      zones: { id: string; level: number; glb: string; lightmaps: string[]; materials: string[]; probe?: string; draws: number; tris: number; lightmapMB: number; bounds: Record<string, number> | null }[]
      materials: { files: string[]; mb: number }
      budgets: { perZone: { draws: number; tris: number; lightmapMB: number }; sharedMaterialTexturesMB: number }
    }
    expect(m.version).toBe(1)
    const order = ZONES.zones.map((z) => z.id)
    const ids = m.zones.map((z) => z.id)
    expect(ids).toEqual(order.filter((id) => ids.includes(id)))
    for (const z of m.zones) {
      expect(z.level).toBe(ZONES.zones.find((q) => q.id === z.id)?.level)
      for (const f of [z.glb, ...z.lightmaps, ...z.materials, ...(z.probe ? [z.probe] : [])]) expect(existsSync(resolve(dir, f)), f).toBe(true)
      for (const f of z.materials) expect(m.materials.files).toContain(f)
      expect(z.draws).toBeLessThanOrEqual(m.budgets.perZone.draws)
      expect(z.tris).toBeLessThanOrEqual(m.budgets.perZone.tris)
      expect(z.lightmapMB).toBeLessThanOrEqual(m.budgets.perZone.lightmapMB)
      // the glb's JSON chunk: node extras name the listed lightmaps, images point at the listed shared files
      const b = readFileSync(resolve(dir, z.glb))
      const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as {
        nodes: { extras?: { lightmap?: string } }[]
        images?: { uri?: string }[]
        scenes: { extras?: { zone?: string } }[]
      }
      expect(j.scenes[0].extras?.zone).toBe(z.id)
      const lms = new Set(j.nodes.map((n) => n.extras?.lightmap).filter((v): v is string => !!v))
      expect([...lms].map((f) => `zones/${z.id}/${f}`).sort()).toEqual([...z.lightmaps].sort())
      const imgs = new Set((j.images ?? []).map((i) => i.uri ?? ''))
      expect([...imgs].map((u) => u.replace(/^\.\.\/\.\.\//, '')).sort()).toEqual([...z.materials].sort())
    }
    expect(m.materials.mb).toBeLessThanOrEqual(m.budgets.sharedMaterialTexturesMB)
  })
})
