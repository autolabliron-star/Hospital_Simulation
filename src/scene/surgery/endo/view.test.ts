/**
 * The endoscope's view model in node: the procedure comes from the current case, each slot's look from its arm's instrument, the withdrawal from the arm's
 * engagement (an exchange takes the tool out of the picture and brings the new one back), the energy pedal only for energy tools, one at a time, and the
 * camera always looks inside its plate.
 */
import { describe, expect, it } from 'vitest'
import { SURGERY_COPY } from '@/content/surgery'
import { caseView, dockedRobot, surgeryState, theatre } from '../testkit'
import { LOOKS } from './looks'
import { cameraPose, CAMERA, energyAt, fillEndoView, INSTRUMENT_ARMS, newEndoView, REST_HALF, setProcedureLooks, withdrawOf, type CameraPose } from './view'
import { PLATE_ASPECT } from './anatomy'

function docked(procedure: 'cholecystectomy' | 'hysterectomy' | 'prostatectomy' = 'hysterectomy') {
  const names = SURGERY_COPY.procedures[procedure].instruments
  const robot = dockedRobot('transverse', { phaseSince: 0, arms: dockedRobot('transverse').arms.map((a, i) => ({ ...a, instrument: names[i] })) })
  return surgeryState({ theatre: theatre('console', { cases: [caseView('c1', { procedure, consoleStart: 0 })] }), robot })
}

const lookId = (i: number): string => (i < 0 ? '' : LOOKS[i].id)

describe('the view model', () => {
  it('takes the procedure from the current case and each slot\'s look from its arm', () => {
    const v = fillEndoView(docked('hysterectomy'), 100, newEndoView())
    expect(v.proc).toBe(1)
    expect(v.look.map(lookId)).toEqual(['cadiere', 'curvedScissors', 'needleDriver'])
    expect(fillEndoView(docked('prostatectomy'), 100, v).look.map(lookId)).toEqual(['prograsp', 'fenestratedBipolar', 'needleDriver'])
    expect(v.proc).toBe(2)
    expect(INSTRUMENT_ARMS).toEqual([0, 2, 3])
    expect(v.gain).toBe(1)
    expect(v.withdraw).toEqual([0, 0, 0])
    expect(v.exchanging).toBe(-1)
  })

  it('withdraws a tool as its arm disengages: out of the picture at the bottom of an exchange, and says which slot is exchanging', () => {
    expect(withdrawOf(1)).toBe(0)
    expect(withdrawOf(0.55)).toBeCloseTo(1, 9)
    expect(withdrawOf(0)).toBe(1)
    const s = docked('cholecystectomy')
    s.robot.arms[2].engage = 0.775
    const v = fillEndoView(s, 100, newEndoView())
    expect(v.withdraw[1]).toBeCloseTo(0.5, 9)
    expect(v.exchanging).toBe(1)
    // while docking nothing is "exchanging", the tools are just coming in
    s.robot.phase = 'docking'
    expect(fillEndoView(s, 100, v).exchanging).toBe(-1)
  })

  it('presses the pedal only for an energy tool that is in place, in seeded bursts, one tool at a time', () => {
    const s = docked('cholecystectomy') // bipolar, scissors (monopolar), prograsp (none)
    const v = newEndoView()
    let on = [0, 0, 0]
    let both = 0
    for (let t = 10; t < 400; t += 0.1) {
      fillEndoView(s, t, v)
      v.energy.forEach((e, k) => (on[k] += e > 0.5 ? 1 : 0))
      if (v.energy[0] > 0 && v.energy[1] > 0) both++
    }
    expect(on[0]).toBeGreaterThan(50)
    expect(on[1]).toBeGreaterThan(50)
    expect(on[2]).toBe(0)
    expect(both).toBe(0)
    // a tool withdrawn for an exchange never fires
    s.robot.arms[0].engage = 0.8
    on = [0, 0, 0]
    for (let t = 10; t < 400; t += 0.1) on[0] += fillEndoView(s, t, v).energy[0] > 0 ? 1 : 0
    expect(on[0]).toBe(0)
    // the bursts are seeded: the same seed and time give the same pedal
    expect(energyAt(0, 7, 123.4)).toBe(energyAt(0, 7, 123.4))
  })

  it('fits a procedure\'s own instruments to the slots', () => {
    const v = setProcedureLooks(newEndoView(), 2)
    expect(v.proc).toBe(2)
    expect(v.look.map(lookId)).toEqual(['prograsp', 'fenestratedBipolar', 'needleDriver'])
  })
})

describe('the camera', () => {
  it('always looks inside the plate, pans and zooms with arm 2\'s tip motion, and breathes', () => {
    const cam: CameraPose = { cx: 0, cy: 0, hh: 0, breath: 0 }
    const v = newEndoView({ seed: 11 })
    let minX = 9
    let maxX = -9
    let minZ = 9
    let maxZ = -9
    for (let t = 0; t < 600; t += 0.37) {
      v.t = t
      cameraPose(v, cam)
      const hw = cam.hh * PLATE_ASPECT
      expect(cam.cx - hw).toBeGreaterThanOrEqual(0)
      expect(cam.cx + hw).toBeLessThanOrEqual(PLATE_ASPECT)
      expect(cam.cy - cam.hh).toBeGreaterThanOrEqual(0)
      expect(cam.cy + cam.hh).toBeLessThanOrEqual(1)
      minX = Math.min(minX, cam.cx)
      maxX = Math.max(maxX, cam.cx)
      const z = REST_HALF / cam.hh
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
    expect(maxX - minX).toBeGreaterThan(0.05)
    expect(maxZ - minZ).toBeGreaterThan(0.04)
    // still (gain 0): only the breathing moves it
    v.gain = 0
    v.t = 1 / (4 * CAMERA.breathHz)
    cameraPose(v, cam)
    expect(cam.cx).toBeCloseTo(PLATE_ASPECT / 2, 9)
    expect(cam.breath).toBeCloseTo(1, 9)
  })
})
