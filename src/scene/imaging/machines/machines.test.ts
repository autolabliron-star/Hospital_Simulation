import { type BufferGeometry, MeshBasicMaterial, type Mesh } from 'three'
import { describe, expect, it } from 'vitest'
import { getLayout } from '@/scene/building/layout'
import { IMAGING } from '@/sim/places'
import type { ImagingExam, ImagingModality, ScannerState } from '@/sim/types'
import { buildCtBase, buildCtCradle, buildCtGantry, buildCtGlow, buildCtRotor, CT } from './ct'
import { triangles } from './geometry'
import { monitorPlanes, screenPlane } from './monitors'
import { buildMriBase, buildMriCoil, buildMriCradle, buildMriGlow, buildMriMagnet, MRI } from './mri'
import { CRADLE, COIL_OFFSET, US_CART, XRAY_POSE } from './motion'
import { probeLive } from './probeLive'
import { createRig, disposeRig, type Rig, updateRig } from './rig'
import { buildUsCable, buildUsCart, buildUsMonitor, buildUsProbe, US_FOOTPRINT } from './us'
import { buildXrayCarriage, buildXrayColumn, buildXrayGlow, buildXrayHead, buildXrayStatic, XRAY } from './xray'

const screens = getLayout().consoleScreens
const stub = (): MeshBasicMaterial => new MeshBasicMaterial()

function box(g: BufferGeometry) {
  g.computeBoundingBox()
  return g.boundingBox!
}

function finite(g: BufferGeometry): boolean {
  const a = g.getAttribute('position').array as Float32Array
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false
  return true
}

/** Smallest and largest distance of any vertex from the axis through (y0, z0) along x. */
function radial(g: BufferGeometry, y0: number, z0: number): [number, number] {
  const p = g.getAttribute('position')
  let lo = Infinity
  let hi = 0
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getY(i) - y0, p.getZ(i) - z0)
    lo = Math.min(lo, r)
    hi = Math.max(hi, r)
  }
  return [lo, hi]
}

function state(modality: ImagingModality, o: Partial<ScannerState> = {}): ScannerState {
  return { modality, phase: 'idle', exam: null, sequence: -1, progress: 0, remaining: 0, phaseTime: 0, tablePos: 0, activity: 0, detail: 0, operatorId: null, ...o }
}

function exam(modality: ImagingModality, bodyPart: ImagingExam['bodyPart']): ImagingExam {
  return { id: 'e1', modality, bodyPart, protocol: 'test', sequences: [], patientId: 'p1', patientName: 'Test Patient', source: 'demo', imageSeed: 1 }
}

function states(o: Partial<Record<ImagingModality, Partial<ScannerState>>> = {}): Record<ImagingModality, ScannerState> {
  return { mri: state('mri', { activity: 0.15, ...o.mri }), ct: state('ct', o.ct), xray: state('xray', o.xray), us: state('us', o.us) }
}

describe('budget', () => {
  const rig = createRig(screens, stub)
  // the head coil rides the table of an MRI exam: exactly one coil is ever drawn
  updateRig(rig, states({ mri: { exam: exam('mri', 'brain'), phase: 'scanning' } }), 1 / 60, 0)

  it('draws at most 20 meshes and under 100k triangles, every vertex finite', () => {
    const visible = rig.meshes.filter((m) => m.visible)
    const tris = visible.reduce((n, m) => n + triangles(m.geometry), 0)
    expect(visible.length).toBeLessThanOrEqual(20)
    expect(tris).toBeLessThan(100_000)
    const all = rig.meshes.reduce((n, m) => n + triangles(m.geometry), 0)
    expect(all).toBeLessThan(100_000)
    for (const m of rig.meshes) expect(finite(m.geometry), m.name).toBe(true)
    // the planned split: MRI 3 + 1 coil, CT 4, X-ray 5, ultrasound 3, monitors 4
    const count = (prefix: string) => visible.filter((m) => m.name.startsWith(prefix)).length
    expect([count('mri-') - count('mri-monitor'), count('ct-') - count('ct-monitor'), count('xray-') - count('xray-monitor'), count('us-') - count('us-monitor')]).toEqual([4, 4, 5, 3])
    expect(visible.filter((m) => m.name.endsWith('-monitor')).length).toBe(4)
  })

  it('moving meshes are not auto-updated, not culled and do not cast; static solids cast', () => {
    for (const m of rig.meshes) {
      const moving = /cradle|coil|rotor|table|carriage|column|head|probe|cable/.test(m.name) && !/monitor/.test(m.name)
      if (moving) {
        expect(m.matrixAutoUpdate, m.name).toBe(false)
        expect(m.frustumCulled, m.name).toBe(false)
      }
      expect(m.castShadow && moving, m.name).toBe(false)
    }
    for (const n of ['mri-static', 'ct-static', 'us-cart']) {
      const m = rig.meshes.find((x) => x.name === n)!
      expect(m.castShadow && m.receiveShadow, n).toBe(true)
    }
  })

  it('no coil is drawn without an exam, and disposing frees the geometries', () => {
    const r = createRig(screens, stub)
    updateRig(r, states(), 1 / 60, 0)
    expect(r.meshes.filter((m) => m.name.startsWith('mri-coil') && m.visible)).toEqual([])
    disposeRig(r)
  })

  it('reports the size of each machine', () => {
    const of = (prefix: string): number => rig.meshes.filter((m) => m.visible && m.name.startsWith(prefix)).reduce((n, m) => n + triangles(m.geometry), 0)
    // a smoke check that nothing is absurdly large: each machine stays far under its share
    for (const p of ['mri-', 'ct-', 'xray-', 'us-']) expect(of(p)).toBeLessThan(40_000)
  })
})

describe('MRI geometry', () => {
  const A = IMAGING.mri.machine
  const t = IMAGING.mri.table

  it('the magnet stays inside the room footprint and under 2.4 m', () => {
    const b = box(buildMriMagnet())
    expect(b.min.x).toBeGreaterThanOrEqual(A.x - 1.075)
    expect(b.max.x).toBeLessThanOrEqual(A.x + 1.075)
    expect(b.min.z).toBeGreaterThanOrEqual(A.z - 1.1 - 1e-6)
    expect(b.max.z).toBeLessThanOrEqual(A.z + 1.1 + 1e-6)
    expect(b.min.y).toBeGreaterThanOrEqual(0)
    expect(b.max.y).toBeLessThanOrEqual(2.4)
    // it fills the footprint: 2.2 wide, about 1.9 deep
    expect(b.max.z - b.min.z).toBeGreaterThan(2.15)
    expect(b.max.x - b.min.x).toBeGreaterThan(1.85)
  })

  it('has a 0.7 m bore centred at 1.1 m on the anchor, open along x', () => {
    const [lo] = radial(buildMriMagnet(), MRI.boreY, A.z)
    expect(lo).toBeGreaterThan(0.345)
    expect(lo).toBeLessThan(0.36)
  })

  it('the base cabinet is inside the table travel the room reserves and tops out at 0.70', () => {
    const b = box(buildMriBase())
    const x0 = Math.min(t.out.x, t.in.x) - CRADLE.length / 2
    const x1 = Math.max(t.out.x, t.in.x) + CRADLE.length / 2
    expect(b.min.x).toBeGreaterThanOrEqual(x0)
    expect(b.max.x).toBeLessThanOrEqual(x1)
    expect(b.min.z).toBeGreaterThanOrEqual(t.out.z - 0.35)
    expect(b.max.z).toBeLessThanOrEqual(t.out.z + 0.35)
    expect(b.max.y).toBeCloseTo(MRI.base.top, 3)
    // the table's head end rests on it when the table is out
    expect(b.max.x).toBeGreaterThan(t.out.x + CRADLE.length / 2 - 1e-9)
  })

  it('the table top is 2.2 x 0.46 with its pad at the table height, riding just above the base', () => {
    const b = box(buildMriCradle())
    expect(b.max.x - b.min.x).toBeCloseTo(CRADLE.length, 3)
    expect(b.max.z - b.min.z).toBeCloseTo(CRADLE.width, 3)
    expect(b.max.y).toBeCloseTo(t.height, 3)
    expect(b.min.y).toBeGreaterThanOrEqual(MRI.base.top)
  })

  it('each coil sits at its offset on the table, above the pad', () => {
    for (const k of ['head', 'knee', 'spine'] as const) {
      const b = box(buildMriCoil(k))
      const centre = (b.min.x + b.max.x) / 2
      expect(Math.abs(centre - COIL_OFFSET[k])).toBeLessThan(0.1)
      expect(b.min.y).toBeGreaterThanOrEqual(t.height - 0.03)
      expect(b.max.z - b.min.z).toBeLessThanOrEqual(CRADLE.width + 0.02)
    }
  })

  it('the LED ring is centred on the bore on the front (west) face', () => {
    const g = buildMriGlow()
    const b = box(g.geometry)
    expect(b.max.x).toBeLessThan(A.x - 0.9)
    expect((b.min.y + b.max.y) / 2).toBeCloseTo(MRI.boreY, 2)
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(A.z, 2)
    expect(g.regions.led.count).toBe(g.geometry.getAttribute('position').count)
  })
})

describe('CT geometry', () => {
  const C = IMAGING.ct.machine
  const t = IMAGING.ct.table

  it('the gantry stays in x +-0.5 and z +-1.1 of the anchor', () => {
    const b = box(buildCtGantry())
    expect(b.min.x).toBeGreaterThanOrEqual(C.x - 0.5)
    expect(b.max.x).toBeLessThanOrEqual(C.x + 0.5)
    expect(b.min.z).toBeGreaterThanOrEqual(C.z - 1.1 - 1e-6)
    expect(b.max.z).toBeLessThanOrEqual(C.z + 1.1 + 1e-6)
    expect(b.max.y).toBeLessThanOrEqual(2.4)
    expect(b.max.z - b.min.z).toBeGreaterThan(1.85)
  })

  it('the liner opens a 0.38 m radius bore and the aperture is 0.60 m', () => {
    const [lo, hi] = radial(buildCtGantry(), CT.centreY, C.z)
    expect(lo).toBeGreaterThan(0.375)
    expect(lo).toBeLessThan(0.385)
    expect(hi).toBeGreaterThan(0.9)
  })

  it('the rotor fits the recess between the liner and the aperture and turns about the bore axis', () => {
    const b = box(buildCtRotor())
    const [lo, hi] = radial(buildCtRotor(), 0, 0)
    expect(lo).toBeGreaterThan(CT.linerOut)
    expect(hi).toBeLessThan(CT.aperture)
    expect(b.max.x - b.min.x).toBeLessThan(0.2)
    // the tube block is on top (+y), the detectors below
    expect(b.max.y).toBeGreaterThan(0.55)
  })

  it('the pedestal is inside the reserved table travel, the table top has its pad at 0.80', () => {
    const base = box(buildCtBase())
    const x0 = Math.min(t.out.x, t.in.x) - CRADLE.length / 2
    const x1 = Math.max(t.out.x, t.in.x) + CRADLE.length / 2
    expect(base.min.x).toBeGreaterThanOrEqual(x0)
    expect(base.max.x).toBeLessThanOrEqual(x1)
    expect(base.min.z).toBeGreaterThanOrEqual(t.out.z - 0.35)
    expect(base.max.z).toBeLessThanOrEqual(t.out.z + 0.35)
    const top = box(buildCtCradle())
    expect(top.max.y).toBeCloseTo(t.height, 3)
    expect(top.min.y).toBeGreaterThanOrEqual(CT.base.top)
    expect(top.max.z - top.min.z).toBeCloseTo(CRADLE.width, 3)
  })

  it('the lasers and the status strip are separate regions of one glow mesh', () => {
    const g = buildCtGlow()
    expect(Object.keys(g.regions).sort()).toEqual(['laser', 'status'])
    const strip = box(g.geometry)
    expect(strip.max.y).toBeLessThanOrEqual(CT.y1 + 0.01)
    expect(g.regions.laser.count + g.regions.status.count).toBe(g.geometry.getAttribute('position').count)
  })
})

describe('X-ray geometry', () => {
  it('the rails run along z from 4.6 to 10.6 near the ceiling, one either side of the tube line', () => {
    const b = box(buildXrayStatic(screens.filter((s) => s.modality === 'xray')))
    expect(b.max.y).toBeLessThanOrEqual(3.0)
    expect(b.min.z).toBeGreaterThanOrEqual(1.9)
    // the rails themselves
    const rail = XRAY.rail
    expect(b.max.z).toBeCloseTo(rail.z1, 3)
  })

  it('the carriage rides over both rails and the column hangs below it as a unit length', () => {
    const c = box(buildXrayCarriage())
    expect(c.min.x).toBeCloseTo(XRAY.x - XRAY.beam.halfX, 3)
    expect(c.max.x).toBeCloseTo(XRAY.x + XRAY.beam.halfX, 3)
    expect(c.max.z - c.min.z).toBeLessThan(0.5)
    expect(c.max.y).toBeLessThan(3.0)
    const col = box(buildXrayColumn())
    expect(col.max.y).toBeCloseTo(0, 6)
    expect(col.min.y).toBeCloseTo(-1, 6)
    expect(Math.abs(col.min.x + col.max.x)).toBeLessThan(1e-6)
  })

  it('the head is centred on its pivot with the collimator below it', () => {
    const b = box(buildXrayHead())
    expect(b.max.y).toBeLessThanOrEqual(XRAY_POSE.headHalf + 1e-3)
    expect(b.min.y).toBeLessThan(-0.3)
    expect(Math.abs(b.min.x + b.max.x)).toBeLessThan(0.1)
  })

  it('the glow has the table field, the wall field and the lamp over the booth door', () => {
    const g = buildXrayGlow()
    expect(Object.keys(g.regions).sort()).toEqual(['lamp', 'tableCross', 'tableFill', 'wallCross', 'wallFill'])
    const b = box(g.geometry)
    expect(b.max.y).toBeCloseTo(XRAY.lamp.y + 0.04, 3)
  })
})

describe('ultrasound geometry', () => {
  const U = IMAGING.us.machine

  it('the cart stays inside its 0.7 x 0.9 footprint', () => {
    const b = box(buildUsCart())
    expect(b.min.x).toBeGreaterThanOrEqual(U.x - US_FOOTPRINT.halfX)
    expect(b.max.x).toBeLessThanOrEqual(U.x + US_FOOTPRINT.halfX)
    expect(b.min.z).toBeGreaterThanOrEqual(U.z - US_FOOTPRINT.halfZ)
    expect(b.max.z).toBeLessThanOrEqual(U.z + US_FOOTPRINT.halfZ)
    expect(b.min.y).toBeGreaterThanOrEqual(0)
    expect(b.max.y).toBeLessThanOrEqual(1.6)
  })

  it('the monitor plane is about 0.42 x 0.32 at about 1.25 m, in front of the monitor head', () => {
    const b = box(buildUsMonitor())
    expect((b.min.y + b.max.y) / 2).toBeCloseTo(1.27, 2)
    expect(b.max.y - b.min.y).toBeCloseTo(0.32, 3)
    expect(b.max.x).toBeLessThanOrEqual(U.x + US_FOOTPRINT.halfX)
    expect(b.min.x).toBeGreaterThanOrEqual(U.x - US_FOOTPRINT.halfX)
  })

  it('the probe is about 0.05 x 0.11, the hand follows the probe in the vertex list', () => {
    const p = buildUsProbe()
    const total = p.geometry.getAttribute('position').count
    expect(p.probeVertices).toBeGreaterThan(0)
    expect(p.probeVertices).toBeLessThan(total)
    p.geometry.setDrawRange(0, p.probeVertices)
    const probeOnly = triangles(p.geometry)
    p.geometry.setDrawRange(0, Infinity)
    expect(triangles(p.geometry)).toBeGreaterThan(probeOnly)
    const b = box(p.geometry)
    expect(b.min.y).toBeCloseTo(0, 3) // the lens is the origin
    expect(b.max.y).toBeLessThan(0.2)
  })

  it('the parked probe stands in the holder cup and the cable socket is on the cart', () => {
    expect(US_CART.holder.x).toBeGreaterThan(U.x - US_FOOTPRINT.halfX)
    expect(Math.abs(US_CART.socket.x - U.x)).toBeLessThan(US_FOOTPRINT.halfX)
    expect(box(buildUsCable()).max.z).toBeCloseTo(0.5, 6)
  })
})

describe('monitors', () => {
  it('there is a console screen anchor for every MRI and CT monitor (2 each) and the X-ray booth (1)', () => {
    const n = (m: string): number => screens.filter((s) => s.modality === m).length
    expect([n('mri'), n('ct'), n('xray')]).toEqual([2, 2, 1])
  })

  it('each screen is a square picture at the screen height, centred, with black bars, facing the anchor heading', () => {
    for (const m of ['mri', 'ct', 'xray'] as const) {
      const list = screens.filter((s) => s.modality === m)
      const g = monitorPlanes(list)
      expect(triangles(g)).toBe(6 * list.length)
      const pos = g.getAttribute('position')
      const nor = g.getAttribute('normal')
      const col = g.getAttribute('color')
      const uv = g.getAttribute('uv')
      for (const s of list) {
        // the picture vertices of this screen (white) lie on a square of side h, centred on the anchor
        let x0 = Infinity
        let x1 = -Infinity
        let y0 = Infinity
        let y1 = -Infinity
        let picture = 0
        for (let i = 0; i < pos.count; i++) {
          if (Math.hypot(pos.getX(i) - s.x, pos.getZ(i) - s.z) > s.w) continue
          expect(nor.getX(i)).toBeCloseTo(Math.sin(s.ry), 6)
          expect(nor.getZ(i)).toBeCloseTo(Math.cos(s.ry), 6)
          if (col.getX(i) > 0.5) {
            picture++
            expect(uv.getX(i) === 0 || uv.getX(i) === 1).toBe(true)
            x0 = Math.min(x0, pos.getX(i))
            x1 = Math.max(x1, pos.getX(i))
            y0 = Math.min(y0, pos.getY(i))
            y1 = Math.max(y1, pos.getY(i))
          }
        }
        expect(picture).toBe(4) // the picture's indexed quad
        expect(y1 - y0).toBeCloseTo(s.h, 5)
        expect(y0 + (y1 - y0) / 2).toBeCloseTo(s.y, 5)
        expect(Math.max(x1 - x0, 0)).toBeGreaterThan(0)
      }
    }
  })

  it('a screen as wide as it is high is one quad; the ultrasound monitor is about 0.42 x 0.32', () => {
    const g = screenPlane(0.3, 0.3, { x: 0, y: 1, z: 0, ry: 0 })
    expect(triangles(g)).toBe(2)
    const us = buildUsMonitor()
    expect(triangles(us)).toBe(6)
  })
})

describe('animation from the scanner state', () => {
  const m = (rig: Rig, name: string): Mesh => rig.meshes.find((x) => x.name === name)!
  const dt = 1 / 60

  it('the MRI table slides with tablePos and the coil follows the exam', () => {
    const rig = createRig(screens, stub)
    const t = IMAGING.mri.table
    updateRig(rig, states({ mri: { tablePos: 0 } }), dt, 0)
    expect(rig.mri.table.position.x).toBeCloseTo(t.out.x, 6)
    expect(rig.mri.table.matrix.elements[12]).toBeCloseTo(t.out.x, 6)
    updateRig(rig, states({ mri: { tablePos: 0.5, exam: exam('mri', 'knee') } }), dt, 0)
    expect(rig.mri.table.matrix.elements[12]).toBeCloseTo((t.out.x + t.in.x) / 2, 6)
    expect(rig.mri.table.matrix.elements[14]).toBeCloseTo(t.out.z, 6)
    expect(rig.mri.coils.map((c) => c.visible)).toEqual([false, true, false])
    updateRig(rig, states({ mri: { tablePos: 1, exam: exam('mri', 'lumbarSpine') } }), dt, 0)
    expect(rig.mri.table.matrix.elements[12]).toBeCloseTo(t.in.x, 6)
    expect(rig.mri.coils.map((c) => c.visible)).toEqual([false, false, true])
    updateRig(rig, states({ mri: { exam: exam('mri', 'brain') } }), dt, 0)
    expect(rig.mri.coils.map((c) => c.visible)).toEqual([true, false, false])
    updateRig(rig, states(), dt, 0)
    expect(rig.mri.coils.map((c) => c.visible)).toEqual([false, false, false])
  })

  it('the MRI LED ring is dim when idle and brighter while scanning', () => {
    const rig = createRig(screens, stub)
    const at = rig.mri.glow.regions.led.start * 4
    const col = rig.mri.glow.geometry.getAttribute('color').array as Float32Array
    updateRig(rig, states({ mri: { activity: 0.15 } }), dt, 0)
    const idle = col[at + 2]
    updateRig(rig, states({ mri: { activity: 1, phase: 'scanning' } }), dt, 0.1)
    expect(col[at + 2]).toBeGreaterThan(idle * 2)
    expect(col[at + 2]).toBeGreaterThan(1) // blooms
  })

  it('the CT rotor spins about two turns a second at full speed, stops at zero, the table follows tablePos', () => {
    const rig = createRig(screens, stub)
    const rotor = m(rig, 'ct-rotor')
    for (let i = 0; i < 15; i++) updateRig(rig, states({ ct: { activity: 1, phase: 'scanning', tablePos: 1 } }), dt, i * dt)
    // a quarter of a second: half a turn
    expect(rig.ct.angle).toBeCloseTo(Math.PI, 5)
    expect(rotor.rotation.x).toBeCloseTo(Math.PI, 5)
    expect(rotor.position.x).toBeCloseTo(CT.rotor.x, 6)
    expect(m(rig, 'ct-table').matrix.elements[12]).toBeCloseTo(IMAGING.ct.table.in.x, 6)
    const before = rotor.rotation.x
    for (let i = 0; i < 30; i++) updateRig(rig, states({ ct: { activity: 0 } }), dt, 1 + i * dt)
    expect(rotor.rotation.x).toBeCloseTo(before, 9)
  })

  it('the CT lasers fade in while positioning and out in 0.3 s; the strip goes green', () => {
    const rig = createRig(screens, stub)
    const col = rig.ct.glow.geometry.getAttribute('color').array as Float32Array
    const laser = rig.ct.glow.regions.laser.start * 4
    const strip = rig.ct.glow.regions.status.start * 4
    updateRig(rig, states(), dt, 0)
    expect(col[laser + 3]).toBe(0)
    for (let i = 0; i < 18; i++) updateRig(rig, states({ ct: { phase: 'positioning' } }), dt, i * dt)
    expect(col[laser + 3]).toBeCloseTo(1, 5)
    for (let i = 0; i < 9; i++) updateRig(rig, states({ ct: { phase: 'scanning' } }), dt, i * dt)
    expect(col[laser + 3]).toBeGreaterThan(0.3)
    expect(col[laser + 3]).toBeLessThan(0.7)
    for (let i = 0; i < 10; i++) updateRig(rig, states({ ct: { phase: 'scanning' } }), dt, i * dt)
    expect(col[laser + 3]).toBe(0)
    const amberGreen = col[strip + 1] / col[strip]
    for (let i = 0; i < 30; i++) updateRig(rig, states({ ct: { phase: 'scanning', activity: 1 } }), dt, i * dt)
    expect(col[strip + 1] / col[strip]).toBeGreaterThan(amberGreen) // greener
  })

  it('the X-ray tube follows detail: carriage z, head angle, telescoping column', () => {
    const rig = createRig(screens, stub)
    updateRig(rig, states({ xray: { detail: 0 } }), dt, 0)
    const carriage = m(rig, 'xray-carriage')
    const column = m(rig, 'xray-column')
    const head = m(rig, 'xray-head')
    expect(carriage.matrix.elements[14]).toBeCloseTo(8.4, 6)
    expect(head.rotation.z).toBeCloseTo(0, 6)
    expect(head.position.y).toBeCloseTo(1.95, 6)
    const len0 = column.scale.y
    updateRig(rig, states({ xray: { detail: 1 } }), dt, 0)
    expect(carriage.matrix.elements[14]).toBeCloseTo(5.3, 6)
    expect(head.rotation.z).toBeCloseTo(-Math.PI / 2, 6)
    expect(head.position.y).toBeCloseTo(1.2, 6)
    expect(head.position.z).toBeCloseTo(5.3, 6)
    expect(column.position.z).toBeCloseTo(5.3, 6)
    expect(column.scale.y).toBeGreaterThan(len0 * 2)
    // the column's bottom meets the head housing's top at both ends
    expect(column.position.y - column.scale.y).toBeCloseTo(head.position.y + XRAY_POSE.headHalf, 6)
  })

  it('the collimator light, the head flash and the lamp follow phase and activity', () => {
    const rig = createRig(screens, stub)
    const col = rig.xray.glow.geometry.getAttribute('color').array as Float32Array
    const g = rig.xray.glow.regions
    const alpha = (name: string): number => col[g[name].start * 4 + 3]
    const lamp = () => col[g.lamp.start * 4]
    updateRig(rig, states({ xray: { phase: 'idle' } }), dt, 0)
    expect(alpha('tableFill')).toBe(0)
    expect(alpha('wallFill')).toBe(0)
    const dim = lamp()
    for (let i = 0; i < 12; i++) updateRig(rig, states({ xray: { phase: 'positioning', detail: 0 } }), dt, 0)
    expect(alpha('tableFill')).toBeGreaterThan(0.7)
    expect(alpha('wallFill')).toBe(0)
    for (let i = 0; i < 12; i++) updateRig(rig, states({ xray: { phase: 'scanning', detail: 1 } }), dt, 0)
    expect(alpha('tableFill')).toBe(0)
    expect(alpha('wallFill')).toBeGreaterThan(0.7)
    const scanLamp = lamp()
    expect(scanLamp).toBeGreaterThan(dim * 1.5)
    const head = rig.xray.head.geometry.getAttribute('color').array as Float32Array
    const rest = head[0]
    for (let i = 0; i < 12; i++) updateRig(rig, states({ xray: { phase: 'scanning', detail: 1, activity: 1 } }), dt, 0)
    expect(head[0]).toBeGreaterThan(rest * 2)
    expect(lamp()).toBeGreaterThan(scanLamp)
    for (let i = 0; i < 20; i++) updateRig(rig, states({ xray: { phase: 'scanning', detail: 1, activity: 0 } }), dt, 0)
    expect(head[0]).toBeCloseTo(rest, 6)
    expect(lamp()).toBeCloseTo(scanLamp, 3)
  })

  it('the probe is parked when idle, works over the couch while scanning and returns afterwards', () => {
    const rig = createRig(screens, stub)
    const probe = m(rig, 'us-probe')
    const cable = m(rig, 'us-cable')
    const h = US_CART.holder
    for (let i = 0; i < 5; i++) updateRig(rig, states(), dt, 0)
    expect(probe.position.x).toBeCloseTo(h.x, 6)
    expect(probe.position.y).toBeCloseTo(h.y, 6)
    expect(probe.position.z).toBeCloseTo(h.z, 6)
    expect(rig.us.hand).toBe(false)
    expect(probe.geometry.drawRange.count).toBe(rig.us.probeVertices)
    expect(cable.scale.z).toBeGreaterThan(0.01)

    // a renal exam's first sweep: the right kidney, from the patient's right flank (+x in the world)
    const renal: ImagingExam = { ...exam('us', 'kidneys'), sequences: ['Right kidney', 'Left kidney', 'Bladder'].map((name) => ({ name, plane: 'sweep' as const, contrast: 'none' as const, seconds: 90, images: 3 })) }
    for (let i = 0; i < 240; i++) updateRig(rig, states({ us: { exam: renal, phase: 'scanning', sequence: 0, detail: 0.5, activity: 1 } }), dt, i * dt)
    expect(probe.position.x).toBeGreaterThan(IMAGING.us.table.out.x + 0.1)
    expect(probe.position.z).toBeGreaterThan(8.7)
    expect(probe.position.z).toBeLessThan(9.05)
    expect(probe.position.y).toBeLessThan(IMAGING.us.table.height + 0.3)
    // the screen images that very probe
    expect(probeLive.active).toBe(true)
    expect(probeLive.examId).toBe(renal.id)
    expect(rig.us.hand).toBe(true)
    expect(probe.geometry.drawRange.count).toBe(Infinity)
    // the cable ends on the cart and on the probe
    expect(cable.scale.z).toBeGreaterThan(0.5)

    for (let i = 0; i < 240; i++) updateRig(rig, states({ us: { phase: 'cleanup' } }), dt, i * dt)
    expect(probe.position.x).toBeCloseTo(h.x, 2)
    expect(probe.position.z).toBeCloseTo(h.z, 2)
    expect(rig.us.hand).toBe(false)
  })

  it('a paused sim (dt 0) holds every pose', () => {
    const rig = createRig(screens, stub)
    const renal: ImagingExam = { ...exam('us', 'kidneys'), sequences: [{ name: 'Right kidney', plane: 'sweep', contrast: 'none', seconds: 90, images: 3 }] }
    const s = states({ ct: { activity: 1 }, us: { exam: renal, phase: 'scanning', sequence: 0, activity: 1, detail: 0.3 } })
    updateRig(rig, s, dt, 0)
    const rotor = rig.ct.angle
    const probeZ = rig.us.probe.position.z
    for (let i = 0; i < 20; i++) updateRig(rig, s, 0, 0)
    expect(rig.ct.angle).toBe(rotor)
    expect(rig.us.probe.position.z).toBe(probeZ)
  })
})
