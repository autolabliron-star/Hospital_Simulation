import { describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/Simulation'
import { CONFIG } from '@/sim/config'
import { HATCH, MV, PACK, TRAY, TRAY_TRAVEL } from './layout'
import { DROP, followTray, handTargets, progress, RELEASE, trayPackPose, type HandTargets, type PackPose } from './gantryMotion'

const DT = CONFIG.sim.step
/** Peak speeds a mechanical arm may show (m/s): the arm, the fingers, and the transfer tray. */
const MAX_ARM = 2.0
const MAX_FINGER = 0.6
const t = (): HandTargets => ({ reach: 0, grip: 0, holding: false, onTray: false, tray: 0, enter: 0 })

describe('picker hand motion', () => {
  it('starts and ends every state with the arm retracted, so states join without a jump', () => {
    const P = CONFIG.pharmacy.pickSeconds
    const D = CONFIG.pharmacy.dropSeconds
    const a = t()
    handTargets('picking', P, a) // just entered picking
    expect(a.reach).toBeCloseTo(0, 9)
    expect(a.grip).toBeCloseTo(0, 9)
    expect(a.holding).toBe(false)
    handTargets('picking', 0, a) // about to leave picking
    expect(a.reach).toBeCloseTo(0, 9)
    expect(a.grip).toBeCloseTo(1, 9)
    expect(a.holding).toBe(true)
    handTargets('toPort', 0.5, a)
    expect(a).toMatchObject({ reach: 0, grip: 1, holding: true, onTray: false, tray: 0, enter: 0 })
    handTargets('dropping', D, a)
    expect(a.reach).toBeCloseTo(0, 9)
    expect(a.grip).toBeCloseTo(1, 9)
    expect(a).toMatchObject({ holding: true, onTray: false, tray: 0, enter: 0 })
    handTargets('dropping', 0, a)
    expect(a.reach).toBeCloseTo(0, 9)
    expect(a.grip).toBeCloseTo(0, 9)
    expect(a.tray).toBeCloseTo(0, 9)
    expect(a.enter).toBeCloseTo(1, 9)
    expect(a).toMatchObject({ holding: false, onTray: false })
    handTargets('toBin', 1, a)
    expect(a).toMatchObject({ reach: 0, grip: 0, holding: false, onTray: false, tray: 0, enter: 0 })
    handTargets('idle', 0, a)
    expect(a).toMatchObject({ reach: 0, grip: 0, holding: false, tray: 0 })
  })

  it('reaches into the bin while picking and to the tray\'s back end while dropping, never further', () => {
    const P = CONFIG.pharmacy.pickSeconds
    const D = CONFIG.pharmacy.dropSeconds
    let maxBin = 0
    let maxTray = 0
    const a = t()
    for (let k = 0; k <= 200; k++) {
      handTargets('picking', P * (1 - k / 200), a)
      maxBin = Math.max(maxBin, a.reach)
      expect(a.reach).toBeGreaterThanOrEqual(-1e-9)
      handTargets('dropping', D * (1 - k / 200), a)
      maxTray = Math.max(maxTray, a.reach)
      expect(a.reach).toBeGreaterThanOrEqual(-1e-9)
    }
    expect(maxBin).toBeCloseTo(MV.reachBin, 3)
    expect(maxTray).toBeCloseTo(MV.reachTray, 3)
    // the pushed pack ends up on the plate, a pack's half-thickness in from its back edge
    expect(MV.handBase + MV.reachTray + MV.packAhead).toBeCloseTo(TRAY.stowedBack + TRAY.packAt, 9)
  })

  it('moves smoothly: the arm never exceeds 2 m/s and the fingers 0.6 m/s', () => {
    const a = t()
    const b = t()
    for (const [state, dur] of [['picking', CONFIG.pharmacy.pickSeconds], ['dropping', CONFIG.pharmacy.dropSeconds]] as const) {
      const n = Math.round(dur / DT)
      for (let k = 0; k < n; k++) {
        handTargets(state, dur - k * DT, a)
        handTargets(state, dur - (k + 1) * DT, b)
        expect(Math.abs(b.reach - a.reach) / DT).toBeLessThan(MAX_ARM)
        expect((Math.abs(b.grip - a.grip) * MV.finger.travel) / DT).toBeLessThan(MAX_FINGER)
      }
    }
  })

  it('the arm retracts only after the fingers are fully open', () => {
    const D = CONFIG.pharmacy.dropSeconds
    const a = t()
    handTargets('dropping', D * (1 - DROP.armBack[0]), a)
    expect(a.grip).toBeLessThan(0.01)
    expect(a.reach).toBeCloseTo(MV.reachTray, 6)
  })

  it('holds a pack from the grip until the release, then it lies on the tray until it has gone into the pod', () => {
    const D = CONFIG.pharmacy.dropSeconds
    const a = t()
    let phase = 0 // 0 held, 1 on the tray, 2 gone
    for (let k = 0; k <= 200; k++) {
      handTargets('dropping', D * (1 - k / 200), a)
      const now = a.holding ? 0 : a.onTray ? 1 : 2
      expect(now, `step ${k}`).toBeGreaterThanOrEqual(phase)
      phase = now
      expect(a.holding && a.onTray).toBe(false)
      // the tray never moves while the pack is still in the hand
      if (a.holding) expect(a.tray).toBe(0)
    }
    expect(phase).toBe(2)
    handTargets('dropping', D * (1 - RELEASE - 0.01), a)
    expect(a.onTray).toBe(true)
  })

  it('progress is clamped', () => {
    expect(progress(2, 1)).toBe(0)
    expect(progress(-1, 1)).toBe(1)
    expect(progress(0.25, 1)).toBeCloseTo(0.75)
  })
})

describe('the transfer tray', () => {
  /** The displayed extension through one drop, followed at the sim's step, then on through the next state (target 0). */
  function runDrop(): { k: number; ext: number; speed: number; targets: HandTargets }[] {
    const D = CONFIG.pharmacy.dropSeconds
    const n = Math.round(D / DT)
    const out: { k: number; ext: number; speed: number; targets: HandTargets }[] = []
    let ext = 0
    const a = t()
    for (let i = 0; i < n + Math.round(0.6 / DT); i++) {
      const inDrop = i < n
      if (inDrop) handTargets('dropping', D - i * DT, a)
      else handTargets('toBin', 1, a)
      const next = followTray(ext, a.tray, DT)
      out.push({ k: i / n, ext: next, speed: ((next - ext) * TRAY_TRAVEL) / DT, targets: { ...a } })
      ext = next
    }
    return out
  }

  it('slides out to the hatch and back, ends fully stowed, and never exceeds its top speed', () => {
    const run = runDrop()
    expect(Math.max(...run.map((r) => r.ext))).toBeGreaterThan(0.995)
    expect(run[run.length - 1].ext).toBe(0)
    for (const r of run) {
      expect(Math.abs(r.speed)).toBeLessThanOrEqual(TRAY.maxSpeed + 1e-6)
      expect(r.ext).toBeGreaterThanOrEqual(0)
      expect(r.ext).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('does not move before the pack is on it', () => {
    for (const r of runDrop()) if (r.k < RELEASE) expect(r.ext).toBe(0)
  })

  it('is out to the hatch while the pack goes in, and starts back only when the pack is hidden inside the pod', () => {
    const run = runDrop()
    const pose: PackPose = { out: 0, y: 0, scale: 1 }
    let maxExt = 0
    for (const r of run) {
      maxExt = Math.max(maxExt, r.ext)
      if (r.targets.onTray && r.targets.enter > 0) {
        // the pack is sliding off the plate's front: the plate is out (to within 3 mm of the hatch)
        expect(r.ext * TRAY_TRAVEL, `k=${r.k.toFixed(3)}`).toBeGreaterThan(TRAY_TRAVEL - 0.003)
      }
      // once the plate has retreated by a few millimetres the pack must be gone
      if (r.k > DROP.trayBack[0] && r.ext * TRAY_TRAVEL < TRAY_TRAVEL - 0.01 && r.targets.enter >= 1) {
        trayPackPose(r.ext, r.targets.enter, pose)
        expect(pose.scale).toBeLessThan(0.01)
      }
    }
    expect(maxExt).toBeGreaterThan(0.995)
  })

  it('follower: speed-limited, settles on the target, snaps shut', () => {
    let e = 0
    for (let i = 0; i < 600; i++) e = followTray(e, 1, DT)
    expect(e).toBeCloseTo(1, 4)
    let prev = e
    for (let i = 0; i < 600; i++) {
      e = followTray(e, 0, DT)
      expect(((prev - e) * TRAY_TRAVEL) / DT).toBeLessThanOrEqual(TRAY.maxSpeed + 1e-6)
      prev = e
    }
    expect(e).toBe(0)
    // frozen when paused
    expect(followTray(0.4, 1, 0)).toBe(0.4)
  })
})

describe('the pack on the tray', () => {
  const pose: PackPose = { out: 0, y: 0, scale: 1 }

  it('starts exactly where the hand set it down, at the held height', () => {
    // hand held pack at the release: arm fully out
    const heldOut = MV.handBase + MV.reachTray + MV.packAhead
    trayPackPose(0, 0, pose)
    expect(pose.out).toBeCloseTo(heldOut, 9)
    // hand height at the drop: carriage at the sim's drop height plus the mount
    const handY = CONFIG.pharmacy.dropHeight + MV.handMount
    expect(Math.abs(pose.y - handY)).toBeLessThan(1e-9)
    expect(pose.scale).toBe(1)
  })

  it('rides the plate out to the hatch, with its front still short of the pod', () => {
    trayPackPose(1, 0, pose)
    expect(pose.out + PACK.z / 2).toBeLessThan(HATCH.out)
    expect(pose.out).toBeGreaterThan(TRAY.stowedBack + TRAY_TRAVEL)
  })

  it('then slides off the front into the pod: forward only, ending inside the pod, shrinking only after it is past the hatch plane', () => {
    let prev = -Infinity
    for (let i = 0; i <= 100; i++) {
      const q = i / 100
      trayPackPose(1, q, pose)
      expect(pose.out).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = pose.out
      // it only shrinks away once it is (almost) wholly inside the pod
      if (pose.scale < 0.999) expect(pose.out - PACK.z / 2).toBeGreaterThan(HATCH.out - 0.02)
    }
    expect(pose.out).toBeGreaterThan(HATCH.out + 0.02)
    expect(pose.scale).toBeLessThan(0.01)
  })
})

describe('against the real simulation', () => {
  it('a presenter order drives the picker through every hand state without any jump in reach, grip or position', () => {
    const sim = new Simulation(7)
    const res = sim.prescribe('A3', [{ medId: 'paracetamol', qty: 1 }, { medId: 'omeprazole', qty: 1 }, { medId: 'cetirizine', qty: 1 }])
    expect(res.ok).toBe(true)
    const g = sim.meds.dispensers.A
    const a = t()
    const b = t()
    const seen = new Set<string>()
    let prevX = g.gantry.x
    let prevY = g.gantry.y
    let handPrev = handTargets(g.gantry.state, g.gantry.timer, a).reach
    let gripPrev = a.grip
    let trayAtTop = 0
    for (let step = 0; step < 60 * 90; step++) {
      sim.step(DT)
      seen.add(g.gantry.state)
      handTargets(g.gantry.state, g.gantry.timer, b)
      // continuity from step to step, across state changes too
      expect(Math.abs(b.reach - handPrev) / DT).toBeLessThan(MAX_ARM)
      expect((Math.abs(b.grip - gripPrev) * MV.finger.travel) / DT).toBeLessThan(MAX_FINGER)
      expect(Math.hypot(g.gantry.x - prevX, g.gantry.y - prevY)).toBeLessThan(0.06)
      // the tray is only ever wanted at the top port height
      if (b.tray > 0) {
        trayAtTop++
        expect(g.gantry.state).toBe('dropping')
        expect(Math.abs(g.gantry.y - CONFIG.pharmacy.dropHeight)).toBeLessThan(1e-6)
      }
      handPrev = b.reach
      gripPrev = b.grip
      prevX = g.gantry.x
      prevY = g.gantry.y
    }
    for (const s of ['toBin', 'picking', 'toPort', 'dropping', 'idle']) expect(seen.has(s), s).toBe(true)
    expect(trayAtTop).toBeGreaterThan(30)
    // three items were picked into the pod's compartments
    const order = [...sim.meds.orders.values()][0]
    expect(order.stage).not.toBe('prescribed')
  })
})
