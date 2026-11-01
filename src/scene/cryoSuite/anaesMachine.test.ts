/**
 * R5 wave 3: the CT suite's anaesthesia machine in node. It is drawn from the rig's own instance pools (no new mesh, no new material), always (its footprint is
 * permanent, the kidney's days too), at CRYO_SUITE.anaesMachine facing north to the table, inside its 0.64 x 0.78 m footprint, with a cabinet, drawers, a work
 * surface, the ventilator (a unit, a vaporiser, a bellows), a tower and a bezel for the monitor, the circuit's hoses and the gas hoses; its monitor's quad stands
 * in front of the bezel, at the tower, facing the way the machine does.
 */
import { Matrix4, Vector3, Color } from 'three'
import { describe, expect, it } from 'vitest'
import { MAT } from '@/scene/materials'
import { CRYO_SUITE } from '@/sim/places'
import { ANAES_BOXES, ANAES_COLOURS, ANAES_CYLS, ANAES_SCREEN, PARTS, TOWER_FRONT, toWorld, type PlacedPart } from './anaesMachine'
import { BOX_COUNT, createCryoRig, CYL_COUNT, drawCallsOf, MACHINE_BOX_BASE, MACHINE_CYL_BASE, MAX_NEEDLES, type CryoRig } from './rig'
import { anaesState, cryoState } from './testkit'

const M = CRYO_SUITE.anaesMachine
const CX = M.at.at.x
const CZ = M.at.at.z

const _m = new Matrix4()
const _v = new Vector3()

interface Box3d {
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
}
/** The world bounds of the unit box (or of the unit cylinder's box) of instance `i`. */
function boundsOf(rig: CryoRig, placed: PlacedPart): Box3d {
  const mesh = placed.pool === 'box' ? rig.boxes : rig.cyls
  mesh.getMatrixAt(placed.index, _m)
  const b: Box3d = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity }
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [-0.5, 0.5]) {
      for (const sz of [-0.5, 0.5]) {
        _v.set(sx, sy, sz).applyMatrix4(_m)
        b.x0 = Math.min(b.x0, _v.x)
        b.x1 = Math.max(b.x1, _v.x)
        b.y0 = Math.min(b.y0, _v.y)
        b.y1 = Math.max(b.y1, _v.y)
        b.z0 = Math.min(b.z0, _v.z)
        b.z1 = Math.max(b.z1, _v.z)
      }
    }
  }
  return b
}
const det = (rig: CryoRig, placed: PlacedPart): number => {
  ;(placed.pool === 'box' ? rig.boxes : rig.cyls).getMatrixAt(placed.index, _m)
  return _m.determinant()
}
const named = (rig: CryoRig, name: string): PlacedPart => rig.machine.find((p) => p.part.name === name)!

describe('the anaesthesia machine is drawn from the cryo rig\'s own instance pools', () => {
  const rig = createCryoRig()

  it('adds boxes and cylinders to the arm\'s pools after the arm\'s and the needles\' slots, and no mesh and no material', () => {
    expect(ANAES_BOXES).toBeGreaterThanOrEqual(10)
    expect(ANAES_CYLS).toBeGreaterThanOrEqual(14)
    expect(MACHINE_BOX_BASE).toBe(6 + MAX_NEEDLES)
    expect(MACHINE_CYL_BASE).toBe(6 + MAX_NEEDLES)
    expect(BOX_COUNT).toBe(MACHINE_BOX_BASE + ANAES_BOXES)
    expect(CYL_COUNT).toBe(MACHINE_CYL_BASE + ANAES_CYLS)
    expect(rig.boxes.count).toBe(BOX_COUNT)
    expect(rig.cyls.count).toBe(CYL_COUNT)
    expect(rig.machine).toHaveLength(ANAES_BOXES + ANAES_CYLS)
    // the same six meshes and 7 draw calls with the screens, on the palette's tinted program
    expect(rig.root.children).toHaveLength(6)
    expect(drawCallsOf(rig) + 1).toBeLessThanOrEqual(7)
    expect(rig.boxes.material).toBe(MAT.tinted)
    expect(rig.cyls.material).toBe(MAT.tinted)
    // every part has a slot of its own, after the arm's
    const seen = new Set<string>()
    for (const p of rig.machine) {
      expect(p.index).toBeGreaterThanOrEqual(p.pool === 'box' ? MACHINE_BOX_BASE : MACHINE_CYL_BASE)
      expect(p.index).toBeLessThan(p.pool === 'box' ? BOX_COUNT : CYL_COUNT)
      const key = `${p.pool}:${p.index}`
      expect(seen.has(key), key).toBe(false)
      seen.add(key)
    }
  })

  it('has the OR machine\'s parts: a cabinet with three drawers, a work surface, a tower with a monitor bezel, the ventilator (unit, vaporiser, bellows), hoses', () => {
    const names = PARTS.map((p) => p.name)
    for (const want of ['plinth', 'cabinet', 'work surface', 'tower', 'monitor bezel', 'ventilator unit', 'vaporiser', 'bellows']) expect(names, want).toContain(want)
    expect(names.filter((n) => n.startsWith('drawer seam'))).toHaveLength(3)
    expect(names.filter((n) => n.startsWith('drawer handle'))).toHaveLength(3)
    expect(names.filter((n) => n.startsWith('castor'))).toHaveLength(4)
    expect(PARTS.filter((p) => p.kind === 'hose').length).toBeGreaterThanOrEqual(6)
    // the vaporiser is yellow, the oxygen hose white, the nitrous oxide blue
    expect(named(rig, 'vaporiser').part.colour).toBe('yellow')
    expect(named(rig, 'supply O2 1').part.colour).toBe('gasWhite')
    expect(named(rig, 'supply N2O 1').part.colour).toBe('gasBlue')
  })

  it('is drawn from the very first frame: every part has a real matrix before any step, and the instance colours are the parts\'', () => {
    const c = new Color()
    for (const p of rig.machine) {
      expect(Math.abs(det(rig, p)), p.part.name).toBeGreaterThan(1e-9)
      ;(p.pool === 'box' ? rig.boxes : rig.cyls).getColorAt(p.index, c)
      const want = ANAES_COLOURS[p.part.colour]
      expect([c.r, c.g, c.b].map((v) => +v.toFixed(3))).toEqual([want.r, want.g, want.b].map((v) => +v.toFixed(3)))
    }
    // the arm's own colours are untouched by the machine's
    rig.boxes.getColorAt(0, c)
    expect(c.getHexString()).toBe('eef1f3')
  })
})

describe('where it stands', () => {
  const rig = createCryoRig()
  const body = rig.machine.filter((p) => p.part.kind !== 'hose')

  it('every body part is inside its 0.64 x 0.78 m footprint and no taller than 1.5 m; the castors touch the floor, the tower reaches the top', () => {
    let top = 0
    let bottom = Infinity
    for (const p of body) {
      const b = boundsOf(rig, p)
      expect(b.x0, p.part.name).toBeGreaterThanOrEqual(CX - M.size.w / 2 - 1e-3)
      expect(b.x1, p.part.name).toBeLessThanOrEqual(CX + M.size.w / 2 + 1e-3)
      expect(b.z0, p.part.name).toBeGreaterThanOrEqual(CZ - M.size.d / 2 - 1e-3)
      expect(b.z1, p.part.name).toBeLessThanOrEqual(CZ + M.size.d / 2 + 1e-3)
      top = Math.max(top, b.y1)
      bottom = Math.min(bottom, b.y0)
    }
    expect(top).toBeCloseTo(M.size.h, 3)
    expect(bottom).toBeCloseTo(0, 3)
    // the hoses stay within 0.2 m of the footprint and above the floor
    for (const p of rig.machine.filter((q) => q.part.kind === 'hose')) {
      const b = boundsOf(rig, p)
      expect(b.z0, p.part.name).toBeGreaterThan(CZ - M.size.d / 2 - 0.2)
      expect(b.z1, p.part.name).toBeLessThan(CZ + M.size.d / 2 + 0.2)
      expect(b.y0, p.part.name).toBeGreaterThan(0.3)
    }
  })

  it('faces north, to the table (heading pi): the drawers and the circuit\'s hoses on the north side, the tower behind the ventilator, the gas hoses on the south', () => {
    expect(Math.cos(M.at.heading)).toBeCloseTo(-1, 9)
    const z = (name: string): number => {
      const b = boundsOf(rig, named(rig, name))
      return (b.z0 + b.z1) / 2
    }
    expect(z('drawer handle 0')).toBeLessThan(CZ - 0.3)
    expect(z('ventilator unit')).toBeLessThan(CZ)
    expect(z('tower')).toBeGreaterThan(z('ventilator unit'))
    expect(z('supply O2 2')).toBeGreaterThan(CZ + 0.4)
    expect(z('circuit A 2')).toBeLessThan(CZ - 0.4)
    // the table is north of it: the circuit's hoses reach toward it
    expect(CRYO_SUITE.ct.table.out.z).toBeLessThan(CZ)
    // the bellows is on the west, the ventilator unit on the east (the OR's layout turned half a turn)
    expect(boundsOf(rig, named(rig, 'bellows')).x0).toBeLessThan(boundsOf(rig, named(rig, 'ventilator unit')).x0)
  })

  it('toWorld turns the machine\'s frame by its heading: the front is north, the machine\'s left is west', () => {
    const front = toWorld(0, 1)
    expect(front.x).toBeCloseTo(CX, 9)
    expect(front.z).toBeCloseTo(CZ - 1, 9)
    const left = toWorld(1, 0)
    expect(left.x).toBeCloseTo(CX - 1, 9)
    expect(left.z).toBeCloseTo(CZ, 9)
  })
})

describe('its monitor quad', () => {
  it('stands in front of the tower\'s bezel, on the machine\'s axis, its glass topping out at the places\' monitorY, facing the machine\'s way and the anaesthetist who stands at the head', () => {
    expect(ANAES_SCREEN.heading).toBe(M.at.heading)
    expect(ANAES_SCREEN.x).toBeCloseTo(CX, 6)
    // in front of the tower's front face (north of it), by the bezel's thickness and a hair
    const front = toWorld(0, TOWER_FRONT)
    expect(Math.hypot(ANAES_SCREEN.x - front.x, ANAES_SCREEN.z - front.z)).toBeGreaterThan(0.008)
    expect(Math.hypot(ANAES_SCREEN.x - front.x, ANAES_SCREEN.z - front.z)).toBeLessThan(0.03)
    expect(ANAES_SCREEN.z).toBeLessThan(front.z)
    expect(ANAES_SCREEN.y + ANAES_SCREEN.h / 2).toBeCloseTo(M.monitorY, 6)
    expect(ANAES_SCREEN.y - ANAES_SCREEN.h / 2).toBeGreaterThan(1.1)
    // a screen's aspect, a little smaller than the tower's width
    expect(ANAES_SCREEN.w / ANAES_SCREEN.h).toBeGreaterThan(1.4)
    expect(ANAES_SCREEN.w / ANAES_SCREEN.h).toBeLessThan(1.7)
    expect(ANAES_SCREEN.w).toBeLessThan(0.6)
    // its normal looks toward the anaesthetist's spot at the head
    const nx = Math.sin(ANAES_SCREEN.heading) * Math.cos(ANAES_SCREEN.tilt)
    const nz = Math.cos(ANAES_SCREEN.heading) * Math.cos(ANAES_SCREEN.tilt)
    const to = CRYO_SUITE.staff.anaesHead.at
    const d = Math.hypot(to.x - ANAES_SCREEN.x, to.z - ANAES_SCREEN.z)
    expect((nx * (to.x - ANAES_SCREEN.x) + nz * (to.z - ANAES_SCREEN.z)) / d).toBeGreaterThan(0.6)
    // the bellows and the dome (under it) stay below the glass
    const rig = createCryoRig()
    expect(boundsOf(rig, named(rig, 'bellows dome')).y1).toBeLessThan(ANAES_SCREEN.y - ANAES_SCREEN.h / 2)
  })
})

describe('always there', () => {
  const rig = createCryoRig()
  const before = rig.machine.map((p) => {
    ;(p.pool === 'box' ? rig.boxes : rig.cyls).getMatrixAt(p.index, _m)
    return _m.elements.slice()
  })

  it('its slots are never written by a step: the same matrices through every state of a day, the kidney\'s and the others\', whatever the arm and the needles do', () => {
    const states = [
      cryoState({ step: 'idle', needles: 0 }),
      cryoState({ step: 'aim', needles: 6, robot: 'aiming', robotNeedle: 2, inserted: [1, 1, 0.5, 0, 0, 0] }),
      cryoState({ step: 'freeze1', ice: 0.8, tablePos: 1 }),
      anaesState({ step: 'checkCt', needles: 4 }),
      anaesState({ target: 'liver', apnoea: true }),
    ]
    let t = 0
    for (const s of states) {
      for (let i = 0; i < 90; i++) rig.step({ state: s, t: (t += 1 / 60), dt: 1 / 60 })
    }
    rig.snap()
    rig.step({ state: states[0], t, dt: 1 / 60 })
    rig.machine.forEach((p, i) => {
      ;(p.pool === 'box' ? rig.boxes : rig.cyls).getMatrixAt(p.index, _m)
      expect(_m.elements, p.part.name).toEqual(before[i])
      expect(Math.abs(_m.determinant()), p.part.name).toBeGreaterThan(1e-9)
    })
    // and the arm and the needles still move in their own slots
    rig.boxes.getMatrixAt(0, _m)
    expect(Math.abs(_m.determinant())).toBeGreaterThan(1e-9)
  })
})
