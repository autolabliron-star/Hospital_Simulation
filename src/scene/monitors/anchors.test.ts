/**
 * Where the monitors are: the layout provides exactly the 18 bedside anchors (4 triage, 6 ER, 4 pre-op, 3 PACU and the central station) with a bezel
 * and no atlas quad behind each; with the OR's anaesthesia monitor that is 19; every face is inside its room, faces the way its bed is, has its
 * layout's aspect, and the face frame maps the corners where they belong. The faces tile per layout.
 */
import { describe, expect, it } from 'vitest'
import { buildLayout } from '@/scene/building/layout'
import { KIT_SCREENS } from '@/scene/surgery/dims'
import { areaById } from '@/sim/places'
import { levelOf } from '@/sim/levels'
import { BEDSIDE_GROUPS, faceFrame, faceNormal, MONITOR_COUNT, monitorDefs } from './anchors'
import { LAYOUTS, tilesFace } from './layouts'
import { realDefs } from './testkit'

const layout = buildLayout()

describe('the bedside monitor anchors in the layout', () => {
  it('are exactly the 18 bedside faces, each id once', () => {
    const ids = layout.bedMonitors.map((a) => a.id).sort()
    const want = [...BEDSIDE_GROUPS.flatMap((g) => Array.from({ length: g.count }, (_, i) => `${g.prefix}:${i}`)), 'pacu:station'].sort()
    expect(ids).toEqual(want)
    expect(layout.bedMonitors).toHaveLength(18)
    const level1 = layout.bedMonitors.filter((a) => levelOf(a.x) === 1).map((a) => a.id.split(':')[0])
    expect(new Set(level1)).toEqual(new Set(['triage', 'er']))
  })

  it('are drawn as a bezel only: a dark rounded box right behind each face, and no screen quad there any more', () => {
    for (const a of layout.bedMonitors) {
      const n = faceNormal({ ...a })
      const behind = layout.prims.filter((p) => p.shape === 'roundedBox' && p.mat === 'metalDark' && Math.hypot(p.position[0] - (a.x - n.x * 0.018), p.position[2] - (a.z - n.z * 0.018)) < 0.01)
      expect(behind.length, a.id).toBe(1)
      expect(behind[0].size[0]).toBeCloseTo(a.w + 0.03, 6)
      const quads = layout.prims.filter((p) => p.shape === 'quad' && Math.hypot(p.position[0] - a.x, p.position[2] - a.z) < 0.05 && Math.abs(p.position[1] - a.y) < 0.05)
      expect(quads, a.id).toEqual([])
    }
  })

  it('sit inside their rooms at a monitor\'s height, with their layout\'s aspect', () => {
    const defs = monitorDefs(layout.bedMonitors, KIT_SCREENS.anaesthesia)
    for (const d of defs) {
      const r = areaById(d.area).rect
      expect(d.anchor.x, d.id).toBeGreaterThan(r.x0)
      expect(d.anchor.x, d.id).toBeLessThan(r.x1)
      expect(d.anchor.z, d.id).toBeGreaterThan(r.z0)
      expect(d.anchor.z, d.id).toBeLessThan(r.z1)
      expect(d.anchor.y, d.id).toBeGreaterThan(1.1)
      expect(d.anchor.y, d.id).toBeLessThan(1.8)
      expect(d.anchor.w / d.anchor.h, d.id).toBeCloseTo(d.layout.w / d.layout.h, 1)
    }
  })

  it('face the bay they belong to: into the hall from the wall (triage south, ER north), the pre-op and recovery poles toward the bed\'s foot', () => {
    const byId = new Map(layout.bedMonitors.map((a) => [a.id, a]))
    for (let i = 0; i < 4; i++) expect(faceNormal(byId.get(`triage:${i}`)!).z).toBeGreaterThan(0.8)
    for (let i = 0; i < 6; i++) expect(faceNormal(byId.get(`er:${i}`)!).z).toBeLessThan(-0.8)
    for (let i = 0; i < 4; i++) expect(faceNormal(byId.get(`preop:${i}`)!).z).toBeGreaterThan(0.8)
    for (let i = 0; i < 3; i++) expect(faceNormal(byId.get(`pacu:${i}`)!).z).toBeLessThan(-0.8)
    expect(faceNormal(byId.get('pacu:station')!).z).toBeGreaterThan(0.8)
    // every face leans back a little (its normal points slightly up)
    for (const a of layout.bedMonitors) expect(faceNormal(a).y).toBeGreaterThan(0.05)
  })
})

describe('the 19 monitors', () => {
  it('are the OR, 3 PACU bays and the station, 4 pre-op, 6 ER and 4 triage, with a seat per row', () => {
    const defs = realDefs()
    expect(defs).toHaveLength(MONITOR_COUNT)
    expect(MONITOR_COUNT).toBe(19)
    expect(defs.map((d) => d.id)).toEqual([
      'or',
      'pacu:0',
      'pacu:1',
      'pacu:2',
      'pacu:station',
      'preop:0',
      'preop:1',
      'preop:2',
      'preop:3',
      'er:0',
      'er:1',
      'er:2',
      'er:3',
      'er:4',
      'er:5',
      'triage:0',
      'triage:1',
      'triage:2',
      'triage:3',
    ])
    defs.forEach((d, i) => {
      expect(d.index).toBe(i)
      expect(d.seats).toHaveLength(d.layout.rows)
    })
    expect(defs[0].anchor.x).toBe(KIT_SCREENS.anaesthesia.at.x)
    expect(defs[0].level).toBe(2)
    expect(defs.filter((d) => d.level === 2)).toHaveLength(9)
    expect(defs.find((d) => d.id === 'pacu:station')!.seats).toEqual(['surgeryBed:pacu:0', 'surgeryBed:pacu:1', 'surgeryBed:pacu:2'])
    expect(defs.find((d) => d.id === 'er:3')!.seats).toEqual(['erBay:bay:3'])
    expect(defs.find((d) => d.id === 'er:3')!.bed).toBe('ER 4')
  })

  it('throw when the layout lacks an anchor', () => {
    expect(() => monitorDefs(layout.bedMonitors.slice(1), KIT_SCREENS.anaesthesia)).toThrow(/no bed monitor/)
  })

  it('map face pixels to the face: the corners at the anchor\'s corners, right along the face, down along it, in its plane', () => {
    for (const d of realDefs()) {
      const a = d.anchor
      const f = faceFrame(a, d.layout.w, d.layout.h)
      const at = (fx: number, fy: number) => ({ x: f.ox + f.rx * fx + f.dx * fy, y: f.oy + f.ry * fx + f.dy * fy, z: f.oz + f.rz * fx + f.dz * fy })
      const c = at(d.layout.w / 2, d.layout.h / 2)
      expect(c.x).toBeCloseTo(a.x, 6)
      expect(c.y).toBeCloseTo(a.y, 6)
      expect(c.z).toBeCloseTo(a.z, 6)
      const tl = at(0, 0)
      const br = at(d.layout.w, d.layout.h)
      expect(Math.hypot(br.x - tl.x, br.y - tl.y, br.z - tl.z)).toBeCloseTo(Math.hypot(a.w, a.h), 6)
      // the top edge is higher than the bottom, and every corner lies in the face's plane
      expect(tl.y).toBeGreaterThan(br.y)
      const n = faceNormal(a)
      for (const p of [tl, br, at(d.layout.w, 0), at(0, d.layout.h)]) expect((p.x - a.x) * n.x + (p.y - a.y) * n.y + (p.z - a.z) * n.z).toBeCloseTo(0, 9)
      // right x down = into the face: the viewer, in front, sees +x to their right (front faces wind counter-clockwise)
      const r = { x: f.rx, y: f.ry, z: f.rz }
      const dn = { x: f.dx, y: f.dy, z: f.dz }
      const cross = { x: r.y * dn.z - r.z * dn.y, y: r.z * dn.x - r.x * dn.z, z: r.x * dn.y - r.y * dn.x }
      expect(cross.x * n.x + cross.y * n.y + cross.z * n.z).toBeLessThan(0)
    }
  })
})

describe('the faces', () => {
  it('every layout is tiled exactly by its statics and bands', () => {
    for (const l of Object.values(LAYOUTS)) expect(tilesFace(l), l.id).toBe(true)
    // the tiling test catches a gap and an overlap
    const broken = { ...LAYOUTS.bedside3, bands: LAYOUTS.bedside3.bands.slice(1) }
    expect(tilesFace(broken)).toBe(false)
    const overlap = { ...LAYOUTS.or, statics: [...LAYOUTS.or.statics, { role: 'header' as const, row: 0, x: 10, y: 10, w: 5, h: 5 }] }
    expect(tilesFace(overlap)).toBe(false)
  })

  it('the station has three rows of an ECG and a pleth each, and its own title bar', () => {
    const s = LAYOUTS.station
    expect(s.rows).toBe(3)
    for (let r = 0; r < 3; r++) expect(s.bands.filter((b) => b.row === r).map((b) => b.channel)).toEqual(['ecg', 'pleth'])
    expect(s.statics.filter((x) => x.row === -1).map((x) => x.role)).toEqual(['stationHeader'])
    expect(LAYOUTS.or.bands.map((b) => b.channel)).toEqual(['ecg', 'second', 'pleth', 'breath'])
    expect(LAYOUTS.or.bands.map((b) => b.speed)).toEqual(['fast', 'fast', 'fast', 'slow'])
  })
})
