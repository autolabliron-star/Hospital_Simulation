/**
 * Realism step 1 (docs/handover/realism-furniture.md): in the authored building every piece of STATIC procedural furniture inside a shipped
 * zone is drawn by the zone's bake (Cycles light, contact shadows) and hidden at runtime through the zone's `replaces` keys
 * (src/scene/building/model/region.ts). What a zone may still leave to the procedural layout is listed here, each with its reason: the live
 * devices (animated, or carrying live screens), the lift call panels, floor marks, and the things a zone design keeps on purpose. A new
 * procedural piece of furniture in a designed zone fails this test until the zone's design bakes it (and lists its key) or it is added
 * below with a reason.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AREAS } from '../../src/sim/places'
import { levelOf } from '../../src/sim/levels'
import { getLayout } from '../../src/scene/building/layout'
import type { Footprint, Prim } from '../../src/scene/building/layout/types'
import { parseManifest } from '../../src/scene/building/model/manifest'
import { zoneCoverage } from '../../src/scene/building/model/region'
import { zoneAtSim } from '../../src/scene/building/model/zones'

const MANIFEST = path.join(process.cwd(), 'public/assets/building/manifest.json')

/** Footprint ids (prefix match) whose prims stay procedural, and why. */
const KEPT_FOOTPRINTS: Record<string, string> = {
  'health:': 'W4 health kiosks (lobby): devices with live screens and the BP wing the crowd puts an arm into',
  'lobby:kiosk': 'self check-in kiosks: live screens (the lobby rule keeps them)',
  'draw:': 'blood-draw robots, tube prep, check-in and send station (animated; the robots\' arm cradles reach into the chairs\' footprints)',
  'imaging:xray:table': 'the radiography table moves with the X-ray machine',
  'imaging:xray:detector': 'the wall bucky of the X-ray machine',
  'lab:': 'the lab and its robots stay procedural (zones/wardB.py)',
  'l2:or:table': 'the robotic theatre\'s table (the robot cart docks to it; the footprint also holds the ceiling lights over it)',
  'l2:or:console:surgeon': 'the surgeon console: live viewer and status screens',
  'l2:or:console:teach': 'the teaching console: live viewer and status screens',
  'l2:or:vision': 'the vision cart: live endoscope screen',
  'l2:or:anaesthesia': 'the anaesthesia machine: live monitor',
  'command:wall': 'the command centre\'s video wall plinths (the wall\'s screens and bezels are live)',
}

/** Areas whose footprint-less prims stay procedural, and why. */
const KEPT_AREAS: Record<string, string> = {
  liftA: 'lift doors and call panels (interactive)',
  liftB: 'lift doors and call panels (interactive)',
  l2LiftA: 'lift doors and call panels (interactive)',
  l2LiftB: 'lift doors and call panels (interactive)',
  corridorA: 'room-door leaves of the overview cut (overviewOnly; walking, the door leaves are the walk building\'s)',
  corridorB: 'room-door leaves of the overview cut, and the lab\'s pneumatic tube station',
  diagnostics: 'the blood-draw robots\' arm cradles (part of the animated robots)',
  l2Or: 'the theatre\'s surgical light heads, pendant and boom (walkOnly, animated faces)',
  l2Hall: 'the level-2 slab under the floor (never seen from inside) and a teal wall sign',
  imagingHall: 'imaging signage discs',
  mri: 'the MRI room\'s warning sign',
  command: 'the plinth and the slab under the floor (never seen from inside)',
  lobby: 'the health kiosks\' weighing platforms',
}

const kept = (p: Prim) => p.shape === 'quad' || p.mat === 'screen' || (p.mat === 'metalDark' && p.position[1] > 1.0)
/** Floor marks: wayfinding lines, bay outlines, floor discs (flat, on the floor). */
const floorMark = (p: Prim) => p.position[1] <= 0.02 && (p.shape === 'plane' || ((p.shape === 'cylinder' || p.shape === 'box') && p.size[1] <= 0.02))

function inside(p: Prim, f: Footprint, pad: number): boolean {
  const dx = p.position[0] - f.x
  const dz = p.position[2] - f.z
  if (f.kind === 'circle') return Math.hypot(dx, dz) <= f.hw + pad
  const c = Math.cos(f.rotationY)
  const s = Math.sin(f.rotationY)
  return Math.abs(dx * c - dz * s) <= f.hw + pad && Math.abs(dx * s + dz * c) <= f.hd + pad
}

function areaAt(x: number, z: number): string | null {
  let best: string | null = null
  let bestA = Infinity
  for (const a of AREAS) {
    const r = a.rect
    if (levelOf(r.x0) !== levelOf(x) || x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue
    const s = (r.x1 - r.x0) * (r.z1 - r.z0)
    if (s < bestA) {
      best = a.id
      bestA = s
    }
  }
  return best
}

describe.skipIf(!existsSync(MANIFEST))('static furniture of the shipped zones is baked', () => {
  const parsed = parseManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')))
  if (!parsed.ok) throw new Error('manifest')
  const zones = parsed.manifest.zones.map((z) => ({ id: z.id, replaces: z.replaces }))

  it('every replaces key of every zone names something', () => {
    const unknown: string[] = []
    zoneCoverage(zones, unknown)
    expect(unknown).toEqual([])
  })

  it('what is still procedural inside a zone is a live device, a lift panel, a floor mark or listed with a reason', () => {
    const cov = zoneCoverage(zones)
    const listed = new Set(zones.map((z) => z.id))
    const layout = getLayout()
    const left = new Map<string, number>()
    for (const p of layout.prims) {
      const [x, , z] = p.position
      const area = areaAt(x, z)
      const zone = area ? zoneAtSim(x, z) : null
      if (!area || !zone || !listed.has(zone) || kept(p) || floorMark(p) || cov.cellOfPrim(p.mat, x, z)) continue
      const fp = layout.footprints.find((f) => inside(p, f, 0.1))
      const ok = fp ? Object.keys(KEPT_FOOTPRINTS).some((k) => fp.id.startsWith(k)) : area in KEPT_AREAS
      if (ok) continue
      const key = `${zone}: ${fp ? `footprint ${fp.id}` : `area ${area}`}`
      left.set(key, (left.get(key) ?? 0) + 1)
    }
    expect([...left].map(([k, n]) => `${k} (${n} prims)`)).toEqual([])
  })
})
