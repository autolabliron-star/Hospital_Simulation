import { describe, expect, it } from 'vitest'
import { IMAGING } from '@/sim/places'
import type { ScannerPhase } from '@/sim/types'
import {
  coilFor,
  collimatorTarget,
  CRADLE,
  ctStatusTarget,
  flashLevel,
  handShown,
  laserTarget,
  lampLevel,
  ledLevel,
  PROBE,
  probeActive,
  type ProbePose,
  probeTargetInto,
  ROTOR_TURNS_PER_SECOND,
  rotorAdvance,
  smoothTo,
  stepToward,
  tableSweep,
  tableX,
  US_CART,
  xrayPose,
  XRAY_POSE,
} from './motion'

const TAU = Math.PI * 2
const PHASES: ScannerPhase[] = ['idle', 'prep', 'positioning', 'tableIn', 'scanning', 'tableOut', 'cleanup']
const newProbe = (): ProbePose => ({ x: 0, y: 0, z: 0, rx: 0, tz: 0 })

describe('table travel', () => {
  for (const m of ['mri', 'ct'] as const) {
    const t = IMAGING[m].table
    it(`${m}: the table x is the interpolation from out to in`, () => {
      expect(tableX(t, 0)).toBe(t.out.x)
      expect(tableX(t, 1)).toBe(t.in.x)
      expect(tableX(t, 0.5)).toBeCloseTo((t.out.x + t.in.x) / 2, 9)
      expect(tableX(t, 0.25)).toBeCloseTo(t.out.x + (t.in.x - t.out.x) * 0.25, 9)
    })
    it(`${m}: the table never leaves the range the room reserves, even for out-of-range input`, () => {
      const [x0, x1] = tableSweep(t)
      for (const k of [-3, -0.1, 0, 0.3, 0.77, 1, 1.4, 9]) {
        const x = tableX(t, k)
        expect(x - CRADLE.length / 2).toBeGreaterThanOrEqual(x0 - 1e-9)
        expect(x + CRADLE.length / 2).toBeLessThanOrEqual(x1 + 1e-9)
      }
    })
  }
})

describe('CT rotor', () => {
  it('does two turns per second at activity 1 and none at activity 0', () => {
    expect(ROTOR_TURNS_PER_SECOND).toBe(2)
    // a quarter of a second is half a turn
    expect(rotorAdvance(0, 1, 0.25)).toBeCloseTo(Math.PI, 9)
    // 60 frames of 1/60 s add up to two whole turns: back where it started
    let a = 0.3
    for (let i = 0; i < 60; i++) a = rotorAdvance(a, 1, 1 / 60)
    expect(a).toBeCloseTo(0.3, 6)
    expect(rotorAdvance(1.25, 0, 1)).toBeCloseTo(1.25, 12)
  })
  it('scales with the published speed fraction and stays wrapped to one turn', () => {
    expect(rotorAdvance(0, 0.5, 0.25)).toBeCloseTo(Math.PI / 2, 9)
    let a = 0
    for (let i = 0; i < 1000; i++) {
      a = rotorAdvance(a, 1, 0.016)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(TAU)
    }
    expect(rotorAdvance(0, 1, 0)).toBe(0)
  })
  it('lasers show only while positioning, and the status strip turns green above half speed', () => {
    for (const p of PHASES) expect(laserTarget(p)).toBe(p === 'positioning' ? 1 : 0)
    expect(ctStatusTarget(0.5)).toBe(0)
    expect(ctStatusTarget(0.51)).toBe(1)
  })
  it('a fade covers the whole range in the given time', () => {
    let v = 0
    for (let i = 0; i < 18; i++) v = stepToward(v, 1, 1 / 60, 0.3)
    expect(v).toBeCloseTo(1, 6)
    expect(stepToward(1, 0, 0, 0.3)).toBe(1)
  })
})

describe('MRI', () => {
  it('the LED ring is dim and steady when idle, bright and pulsing at 2.5 Hz while scanning', () => {
    const idle = [0, 0.1, 0.2, 0.37, 0.5].map((t) => ledLevel(0.15, t))
    for (const v of idle) expect(v).toBeCloseTo(0.15, 9)
    let lo = 9
    let hi = 0
    for (let i = 0; i < 400; i++) {
      const v = ledLevel(1, i / 400)
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    expect(hi).toBeCloseTo(1, 2)
    expect(lo).toBeLessThan(0.6)
    expect(lo).toBeGreaterThan(0.5)
    // period 0.4 s
    expect(ledLevel(1, 0.1)).toBeCloseTo(ledLevel(1, 0.5), 9)
    expect(ledLevel(1, 0.1)).not.toBeCloseTo(ledLevel(1, 0.3), 3)
  })
  it('the coil follows the exam: none without one, the head coil by default', () => {
    expect(coilFor(null)).toBeNull()
    expect(coilFor(undefined)).toBeNull()
    expect(coilFor('brain')).toBe('head')
    expect(coilFor('head')).toBe('head')
    expect(coilFor('cervicalSpine')).toBe('head')
    expect(coilFor('knee')).toBe('knee')
    expect(coilFor('lumbarSpine')).toBe('spine')
  })
})

describe('X-ray tube', () => {
  it('hangs over the table, pointing down, at detail 0', () => {
    const p = xrayPose(0)
    expect(p.carriageZ).toBe(IMAGING.xray.table.out.z)
    expect(p.headAngle).toBeCloseTo(0, 12)
    expect(p.pivotY).toBe(XRAY_POSE.pivotYTable)
    expect(p.columnDrop).toBe(0)
  })
  it('is at the wall detector, pointing west, at detail 1', () => {
    const p = xrayPose(1)
    expect(p.carriageZ).toBe(5.3)
    // rotation about z by -90 degrees turns the head's -y (down) into -x (west)
    expect(p.headAngle).toBeCloseTo(-Math.PI / 2, 12)
    expect(Math.sin(p.headAngle)).toBeCloseTo(-1, 12)
    expect(p.pivotY).toBeCloseTo(1.2, 12)
    expect(p.columnDrop).toBeCloseTo(0.75, 12)
  })
  it('moves smoothly between, and the column always has positive length', () => {
    let prevZ = xrayPose(0).carriageZ
    for (let i = 1; i <= 20; i++) {
      const p = xrayPose(i / 20)
      expect(p.carriageZ).toBeLessThan(prevZ)
      expect(p.columnLength).toBeGreaterThan(0.3)
      prevZ = p.carriageZ
    }
    expect(xrayPose(-1).carriageZ).toBe(xrayPose(0).carriageZ)
    expect(xrayPose(2).carriageZ).toBe(xrayPose(1).carriageZ)
  })
  it('the collimator light is on the table for detail below a half and on the wall from a half, only while exposing', () => {
    for (const p of PHASES) {
      const on = p === 'positioning' || p === 'scanning' || p === 'tableIn'
      expect(collimatorTarget(p, 0, 'table')).toBe(on ? 1 : 0)
      expect(collimatorTarget(p, 0, 'wall')).toBe(0)
      expect(collimatorTarget(p, 1, 'wall')).toBe(on ? 1 : 0)
      expect(collimatorTarget(p, 1, 'table')).toBe(0)
    }
    expect(collimatorTarget('scanning', 0.49, 'table')).toBe(1)
    expect(collimatorTarget('scanning', 0.5, 'wall')).toBe(1)
  })
  it('the lamp is dim at rest, lit for the whole scan step and brightest during the flash', () => {
    const rest = lampLevel('idle', 0)
    const scan = lampLevel('scanning', 0)
    const flash = lampLevel('scanning', 1)
    expect(rest).toBeLessThan(scan)
    expect(scan).toBeLessThan(flash)
    expect(lampLevel('positioning', 0)).toBe(rest)
    expect(lampLevel('idle', 1)).toBe(flash)
  })
  it('the head flash jumps with the exposure and decays in about 0.2 s', () => {
    expect(flashLevel(0, 1, 1 / 60)).toBe(1)
    let f = 1
    for (let i = 0; i < 12; i++) f = flashLevel(f, 0, 1 / 60)
    expect(f).toBeCloseTo(0, 6)
  })
})

describe('ultrasound probe', () => {
  const holder = US_CART.holder
  it('is parked on the cart holder whenever the scan is not under way', () => {
    for (const p of PHASES) {
      if (probeActive(p)) continue
      const out = probeTargetInto(newProbe(), p, 0.7, 1, 3.3)
      expect([out.x, out.y, out.z, out.rx, out.tz]).toEqual([holder.x, holder.y, holder.z, 0, 0])
      expect(handShown(out)).toBe(false)
    }
  })
  it('works over the abdomen while positioning and scanning, with the hand on it', () => {
    for (const p of ['positioning', 'tableIn', 'scanning'] as const) {
      expect(probeActive(p)).toBe(true)
      expect(handShown(probeTargetInto(newProbe(), p, 0.5, 1, 0))).toBe(true)
    }
  })
  it('sweeps z over 8.2 .. 9.0 with detail, a few cm across the couch, and presses down in contact', () => {
    const couchX = IMAGING.us.table.out.x
    const y = IMAGING.us.table.height + PROBE.surface
    const a = probeTargetInto(newProbe(), 'scanning', 0, 1, 0)
    const b = probeTargetInto(newProbe(), 'scanning', 1, 1, 0)
    expect(a.z).toBeCloseTo(8.2, 9)
    expect(b.z).toBeCloseTo(9.0, 9)
    for (let i = 0; i <= 50; i++) {
      const p = probeTargetInto(newProbe(), 'scanning', i / 50, 1, i * 0.07)
      expect(Math.abs(p.x - couchX)).toBeLessThanOrEqual(0.05 + 1e-9)
      expect(p.z).toBeGreaterThanOrEqual(8.2 - 1e-9)
      expect(p.z).toBeLessThanOrEqual(9.0 + 1e-9)
      expect(p.y).toBeCloseTo(y - PROBE.press, 9)
    }
    // in contact the probe is pressed 2 cm below the surface level; without contact it hovers above it
    expect(probeTargetInto(newProbe(), 'scanning', 0.5, 0, 0).y).toBeCloseTo(y + PROBE.hover, 9)
  })
  it('rocks within +-12 degrees at 0.4 Hz in contact and not at all without it', () => {
    let peak = 0
    for (let i = 0; i < 500; i++) peak = Math.max(peak, Math.abs(probeTargetInto(newProbe(), 'scanning', 0.5, 1, i * 0.01).rx))
    expect(peak).toBeCloseTo((12 * Math.PI) / 180, 2)
    expect(peak).toBeLessThanOrEqual((12 * Math.PI) / 180 + 1e-9)
    expect(probeTargetInto(newProbe(), 'scanning', 0.5, 0, 0.6).rx).toBe(0)
    // period 2.5 s
    expect(probeTargetInto(newProbe(), 'scanning', 0.5, 1, 0.3).rx).toBeCloseTo(probeTargetInto(newProbe(), 'scanning', 0.5, 1, 2.8).rx, 9)
  })
  it('the monitor turns toward the sonographer on the stool', () => {
    const m = US_CART.monitor
    const op = IMAGING.us.operator.at
    const dx = op.x - m.x
    const dz = op.z - m.z
    // the screen normal is (sin yaw, cos yaw): it points at the stool
    expect(Math.sin(m.yaw) * dx + Math.cos(m.yaw) * dz).toBeCloseTo(Math.hypot(dx, dz), 9)
  })
})

describe('smoothing', () => {
  it('is exponential, frame-rate independent and frozen at dt 0', () => {
    expect(smoothTo(0, 1, 5, 0)).toBe(0)
    const once = smoothTo(0, 1, 5, 0.1)
    let twice = smoothTo(0, 1, 5, 0.05)
    twice = smoothTo(twice, 1, 5, 0.05)
    expect(once).toBeCloseTo(twice, 12)
    expect(smoothTo(0, 1, 5, 100)).toBeCloseTo(1, 9)
  })
})
