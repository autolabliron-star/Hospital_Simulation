/**
 * R5 wave 2: the robot's ports follow the table's tilt. `applyRobot` hands the arms the ports it is given (four preallocated points, rewritten in place each tick
 * from the room's published table pose with tablePose.ts `tablePointInto`, the transform the engine's `portN` targets use), and the level ports of the layout when
 * it is given none. In a whole sim day a watched (scripted) case's docked arms hold the ports of the tilted, rolled table within a millimetre, the very points
 * the step engine resolves `port0..3` to (a level table gives the contract's own ports back to the last bit: tablePose.test.ts).
 */
import { describe, expect, it } from 'vitest'
import { SURGERY, type PortLayout } from '../places'
import { newTargetCtx, resolveTarget, setTable } from '../procedure'
import { timeAtHour } from '../population/schedule'
import type { RobotState, Vec3 } from '../types'
import type { Surgery } from './index'
import { applyRobot, type RobotContext, type RobotSegment } from './robot'
import { newTablePose, setTablePose, tablePointInto } from './tablePose'
import { suite } from './testkit'

function newRobot(): RobotState {
  return {
    phase: 'stowed',
    cart: { x: SURGERY.cart.park.at.x, z: SURGERY.cart.park.at.z, heading: SURGERY.cart.park.heading },
    boomYaw: 0,
    boomHeight: SURGERY.cart.size.stowedHeight,
    boomExtend: 0,
    laser: false,
    arms: [0, 1, 2, 3].map((i) => ({ index: i as 0 | 1 | 2 | 3, instrument: '', port: null, drape: 0, engage: 0, force: 0, exchanges: 0 })),
    motionSeed: 7,
    phaseSince: 0,
    version: 0,
  }
}

const seg = (kind: RobotSegment['kind']): RobotSegment => ({ kind, since: 0, until: 100, caseIndex: 0 })
const ctxOf = (layout: PortLayout, t: number, ports?: readonly Vec3[]): RobotContext => ({
  t,
  layout,
  ports,
  instruments: ['a', 'b', 'c', 'd'],
  boomYaw: 0.1,
  motionSeed: 7,
  consoleStart: 0,
  exchanges: [],
})

/** Four ports of `layout` on a table tipped `tilt` and rolled `roll`. */
function tiltedPorts(layout: PortLayout, tilt: number, roll: number): Vec3[] {
  const p = newTablePose()
  setTablePose(p, tilt, roll)
  return SURGERY.ports[layout].map((q) => tablePointInto(p, q.x, q.y, q.z, { x: 0, y: 0, z: 0 }))
}

describe('applyRobot carries the ports it is given', () => {
  const ports = tiltedPorts('transverse', -25, 3)

  it('docks the endoscope arm on the given port 1, swings the others onto theirs in targeting, and holds all four docked and while undocking (the very objects, so a rewrite in place moves them)', () => {
    const ctx = ctxOf('transverse', 50, ports)
    const r = newRobot()
    applyRobot(r, seg('docking'), ctx)
    expect(r.arms[1].port).toBe(ports[1])
    for (const i of [0, 2, 3]) expect(r.arms[i].port).toBeNull()
    applyRobot(r, seg('targeting'), ctxOf('transverse', 99, ports))
    for (let i = 0; i < 4; i++) expect(r.arms[i].port, `targeting, arm ${i}`).toBe(ports[i])
    applyRobot(r, seg('docked'), ctx)
    for (let i = 0; i < 4; i++) expect(r.arms[i].port, `docked, arm ${i}`).toBe(ports[i])
    applyRobot(r, seg('undocking'), ctxOf('transverse', 10, ports))
    for (let i = 0; i < 4; i++) expect(r.arms[i].port, `undocking, arm ${i}`).toBe(ports[i])
    // rewriting a port in place (the table moves) moves what the arm holds
    ports[2].y += 0.01
    expect(r.arms[2].port!.y).toBe(ports[2].y)
    ports[2].y -= 0.01
  })

  it('lets go of every port once the arms are free again', () => {
    const r = newRobot()
    applyRobot(r, seg('docked'), ctxOf('oblique', 50, ports))
    for (const phase of ['returning', 'cleaning', 'stowed', 'draping', 'draped', 'deploying', 'driving'] as const) {
      applyRobot(r, seg(phase), ctxOf('oblique', 50, ports))
      for (const a of r.arms) expect(a.port, phase).toBeNull()
    }
  })

  it('falls back to the layout\'s level ports (the contract\'s own objects) when it is given none', () => {
    for (const layout of ['transverse', 'oblique'] as const) {
      const r = newRobot()
      applyRobot(r, seg('docked'), ctxOf(layout, 50))
      for (let i = 0; i < 4; i++) expect(r.arms[i].port).toBe(SURGERY.ports[layout][i])
    }
  })
})

describe('the arms hold the tilted ports in a whole day', () => {
  const DT = 0.1
  const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  const tilted = (s: Surgery): { tilt: number; roll: number; on: boolean } => {
    const v = s.state.procedure
    return { tilt: v.patient.headTiltDeg, roll: v.patient.rollDeg, on: v.procedureId !== null }
  }

  it('docks, holds and undocks a watched case on ports that sit within 1 mm of the level ports moved by the published table pose, at every tick, and they are the engine\'s port targets', () => {
    const h = suite(2026, { crowd: false, hour: 7 })
    const s = h.surgery!
    while (h.t < timeAtHour(7 + 5 / 60)) h.step(DT)
    expect(s.startWatch('cholecystectomy')).toBe('started')
    const ctx = newTargetCtx('oblique')
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    const pose = newTablePose()
    let withPort = 0
    let tiltedSamples = 0
    let worst = 0
    let worstEngine = 0
    let sawDocked = false
    const seen = new Set<Vec3>()
    const end = timeAtHour(9)
    while (h.t < end) {
      h.step(DT)
      const r = s.state.robot
      if (r.phase === 'docked') sawDocked = true
      if (sawDocked && r.phase === 'cleaning') break
      const { tilt, roll, on } = tilted(s)
      const layout = s.runs.find((c) => c.inRoom)?.plan.layout
      for (const a of r.arms) {
        if (a.port === null) continue
        withPort++
        seen.add(a.port)
        expect(layout, 'a port while a case is in the room').toBeDefined()
        // the level port moved by the pose the room publishes (a case in the room: its table; none: level)
        setTablePose(pose, on ? tilt : 0, on ? roll : 0)
        const level = SURGERY.ports[layout!][a.index]
        tablePointInto(pose, level.x, level.y, level.z, out)
        worst = Math.max(worst, dist(a.port, out))
        // and the point the step engine resolves port0..3 to for the same table
        ctx.layout = layout!
        ctx.cart = r.cart
        setTable(ctx, on ? tilt : 0, on ? roll : 0, s.state.procedure.patient.position)
        resolveTarget(`port${a.index}` as 'port0', ctx, out)
        worstEngine = Math.max(worstEngine, dist(a.port, out))
        if (Math.abs(tilt) > 5 || Math.abs(roll) > 5) tiltedSamples++
      }
    }
    expect(sawDocked).toBe(true)
    expect(withPort).toBeGreaterThan(1000)
    // the script tips the table (the gallbladder's reverse Trendelenburg and roll) while the arms are docked: the test saw tilted ports
    expect(tiltedSamples).toBeGreaterThan(200)
    expect(worst).toBeLessThan(1e-3)
    expect(worstEngine).toBeLessThan(1e-3)
    // the arms carry four preallocated points, never new objects
    expect(seen.size).toBeLessThanOrEqual(4)
  }, 240_000)
})
