/**
 * The pharmacist glass doors' logic (W3): they open for YOU (not only for the sim's people), along the way you are going, also while the
 * sim is paused, and their leaves are solid boxes for your body that match the drawn bars.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { CORE_BLOCKERS_PER_DOOR, CoreDoors, coreLeafTravel, coreLeafWidth, coreLeafX, coreLeafZ, doorStepSeconds, writeCoreBlockers, type CoreLead } from './coreDoors'
import { DOOR, OPENINGS } from './layout'

const DT = 1 / 60
const LEAD = CONFIG.player.doorLeadSeconds
const WALK = CONFIG.player.walkSpeed
const HURRY = CONFIG.player.hurrySpeed

const person = (x: number, z: number) => ({ entity: { position: { x, z } } })

describe('the pharmacist doors open for you', () => {
  it('there are two, one per ward, in the core\'s corridor walls', () => {
    expect(OPENINGS.length).toBe(2)
    expect(OPENINGS.map((o) => o.side).sort()).toEqual(['N', 'S'])
  })

  it('you alone, with no one else about, open a door you stand next to (the old doors only ever sensed the sim\'s people)', () => {
    for (let i = 0; i < OPENINGS.length; i++) {
      const o = OPENINGS[i]
      const doors = new CoreDoors()
      for (let k = 0; k < 60; k++) doors.update(DT, [], { x: o.x, z: o.z + 1.0 })
      expect(doors.shown[i]).toBe(1)
      expect(doors.shown[1 - i]).toBe(0) // the other one stays shut
    }
  })

  it('people open them as before: within 1.4 m, and not from 1.5 m', () => {
    const o = OPENINGS[0]
    const near = new CoreDoors()
    for (let k = 0; k < 60; k++) near.update(DT, [person(o.x + 1.3, o.z)], null)
    expect(near.shown[0]).toBe(1)
    const far = new CoreDoors()
    for (let k = 0; k < 120; k++) far.update(DT, [person(o.x + 1.5, o.z)], null)
    expect(far.shown[0]).toBe(0)
  })

  it('every door, from both sides, at a walk and at a hurry: wide open (98 %) when your body is 0.6 m from the wall line', () => {
    for (let i = 0; i < OPENINGS.length; i++) {
      const o = OPENINGS[i]
      for (const side of [1, -1] as const) {
        for (const speed of [WALK, HURRY]) {
          const doors = new CoreDoors()
          const lead: CoreLead = { vx: 0, vz: -side * speed, seconds: LEAD }
          let z = o.z + side * 9
          let shownAt = -1
          for (let k = 0; k < 60 * 12 && shownAt < 0; k++) {
            doors.update(DT, [], { x: o.x, z }, lead)
            if (Math.abs(z - o.z) <= 0.6) shownAt = doors.shown[i]
            z += lead.vz * DT
          }
          expect(shownAt, `${o.id}, side ${side}, ${speed} m/s`).toBeGreaterThanOrEqual(0.98)
        }
      }
    }
  })

  it('without the lead a body at a hurry reaches a door that is not yet open (the lead is what makes them solid-safe)', () => {
    const o = OPENINGS[0]
    const doors = new CoreDoors()
    let z = o.z - 9
    let shownAt = -1
    for (let k = 0; k < 60 * 12 && shownAt < 0; k++) {
      doors.update(DT, [], { x: o.x, z })
      if (Math.abs(z - o.z) <= 0.6) shownAt = doors.shown[0]
      z += HURRY * DT
    }
    expect(shownAt).toBeLessThan(0.9)
  })

  it('while the sim is paused the doors still step, in real time (the old ones froze and you walked through the shut glass)', () => {
    expect(doorStepSeconds(DT, true, 1)).toBe(DT)
    expect(doorStepSeconds(DT, true, 4)).toBe(DT) // paused: real time, whatever the speed was set to
    expect(doorStepSeconds(DT, false, 1)).toBe(DT)
    expect(doorStepSeconds(DT, false, 4)).toBeCloseTo(4 * DT, 12)
    expect(doorStepSeconds(0.5, true, 1)).toBe(0.1) // a hitch is cut
    // and a door driven that way opens for you
    const o = OPENINGS[1]
    const doors = new CoreDoors()
    for (let k = 0; k < 60; k++) doors.update(doorStepSeconds(DT, true, 4), [], { x: o.x, z: o.z - 0.8 })
    expect(doors.shown[1]).toBe(1)
  })

  it('they hold open a second after the last one leaves, ease shut, and come to an exact rest', () => {
    const o = OPENINGS[0]
    const doors = new CoreDoors()
    for (let k = 0; k < 60; k++) doors.update(DT, [], { x: o.x, z: o.z + 0.5 })
    expect(doors.shown[0]).toBe(1)
    for (let k = 0; k < 50; k++) doors.update(DT, [], null)
    expect(doors.shown[0]).toBe(1)
    let last = 1
    for (let k = 0; k < 180; k++) {
      doors.update(DT, [], null)
      expect(doors.shown[0]).toBeLessThanOrEqual(last + 1e-9)
      last = doors.shown[0]
    }
    expect(doors.shown[0]).toBe(0)
    expect(doors.update(DT, [], null)).toBe(false)
  })

  it('Tab into a doorway: the door you are in range of is open at once', () => {
    const o = OPENINGS[0]
    const doors = new CoreDoors()
    expect(doors.snapOpenNear({ x: o.x, z: o.z + 0.4 })).toBe(true)
    expect(doors.shown[0]).toBe(1)
    expect(doors.shown[1]).toBe(0)
    expect(doors.snapOpenNear({ x: o.x, z: o.z + 0.4 })).toBe(false)
  })
})

describe('the pharmacist doors\' leaves as solid boxes', () => {
  const read = (a: Float64Array, i: number) => ({ cx: a[i * 6], cz: a[i * 6 + 1], ux: a[i * 6 + 2], uz: a[i * 6 + 3], hu: a[i * 6 + 4], hv: a[i * 6 + 5] })

  it('two boxes a door, along x, inside the core in front of the glass, a centimetre thicker than the drawn bars', () => {
    const out = new Float64Array(OPENINGS.length * CORE_BLOCKERS_PER_DOOR * 6)
    const n = writeCoreBlockers(OPENINGS, new Float32Array(OPENINGS.length), out)
    expect(n).toBe(OPENINGS.length * CORE_BLOCKERS_PER_DOOR)
    for (let i = 0; i < OPENINGS.length; i++) {
      for (let side = 0; side < 2; side++) {
        const b = read(out, i * 2 + side)
        const o = OPENINGS[i]
        expect([b.ux, b.uz]).toEqual([1, 0])
        expect(b.cz).toBeCloseTo(o.z + (o.side === 'N' ? DOOR.inset : -DOOR.inset), 9)
        expect(b.hu).toBeCloseTo(o.width / 4, 9) // a leaf is half the opening wide
        expect(b.hv).toBeCloseTo(DOOR.leafT / 2 + 0.01, 9)
      }
    }
  })

  it('shut, the two leaves meet in the middle and close the whole opening; open, they slide out to each side by the drawn travel', () => {
    for (const o of OPENINGS) {
      for (const e of [0, 0.3, 0.7, 1]) {
        const out = new Float64Array(2 * 6)
        writeCoreBlockers([o], [e], out)
        const a = read(out, 0)
        const b = read(out, 1)
        // the same numbers the drawn bars use
        expect(a.cx).toBeCloseTo(coreLeafX(o, 0, e), 12)
        expect(b.cx).toBeCloseTo(coreLeafX(o, 1, e), 12)
        expect(a.cz).toBeCloseTo(coreLeafZ(o), 12)
        expect(b.cx - a.cx).toBeCloseTo(coreLeafWidth(o) + 2 * e * coreLeafTravel(o), 9)
        if (e === 0) {
          expect(a.cx + a.hu).toBeCloseTo(o.x, 9)
          expect(b.cx - b.hu).toBeCloseTo(o.x, 9)
          expect(a.cx - a.hu).toBeCloseTo(o.x - o.width / 2, 9)
          expect(b.cx + b.hu).toBeCloseTo(o.x + o.width / 2, 9)
        }
        if (e === 1) {
          // wide open: at least 1.1 m of a 1.2 m door is clear for a body 0.6 m wide
          expect(b.cx - b.hu - (a.cx + a.hu)).toBeGreaterThanOrEqual(o.width - 0.1)
        }
      }
    }
  })
})
