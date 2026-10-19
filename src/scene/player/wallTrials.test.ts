/**
 * Wall trials, driven through the real PlayerSystem (a real Simulation, a fake rig, the keys pressed by hand): the doctor walks into a
 * wall, and then must be able to LEAVE it. Reported from the running app: once he touched a wall he was stuck (backing away from the
 * corridor-A wall with S did not move him, W at an angle into the triage wall did not move him, turning away with A or D barely did):
 * a body at contact distance saw its own wall as a hit at t = 0 for any motion, even motion away from it (see sweep.ts, CONTACT).
 *
 * What is claimed, with the numbers measured before and after the fix in the final report:
 *   - backing away from a wall (S) after a head-on press walks the full back speed away from it;
 *   - turning away from it with W+A or W+D walks (a turning circle of radius ~0.8 m, away from the wall);
 *   - walking at 30 degrees into a plain wall slides along it at v sin 30, at exactly R from its face, never inside it;
 *   - walking parallel to a wall is unchanged: the same distance as in the middle of the corridor;
 *   - where the body stays put (an inside corner of a wall and a monitor in the triage bay) the geometry really leaves it nowhere to go
 *     in the direction asked, and it can still leave by backing up or turning.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { OVERVIEW_FOV_DEG, type RigHandle } from '@/scene/camera/cameraApi'
import { Simulation } from '@/sim/Simulation'
import { SKIN, walkableAt } from './collision'
import { KIND_CIRCLE, QUERY_CAPACITY, SOLID_STRIDE, queryStatic, staticSolids } from './solids'
import { boxDistance } from './bodyTestKit'
import { PlayerSystem } from './system'
import { BODY } from './tuning'

const DT = 1 / 60
/** The grown radius the body presses against a wall with. */
const R = BODY.radius + SKIN

class FakeRig implements RigHandle {
  camera = {}
  suspended = false
  enabled = true
  pos = new Vector3(-11, 80, 66)
  tgt = new Vector3(-11, 0, 0)
  getPosition(out: Vector3): Vector3 {
    return out.copy(this.pos)
  }
  getTarget(out: Vector3): Vector3 {
    return out.copy(this.tgt)
  }
  setLookAt(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void {
    this.pos.set(px, py, pz)
    this.tgt.set(tx, ty, tz)
  }
}

interface Rig {
  sim: Simulation
  sys: PlayerSystem
}

const made: PlayerSystem[] = []

/** A player system in the default ("easy") scheme, standing at (x, z) facing `heading`, at rest. */
function standAt(x: number, z: number, heading: number): Rig {
  const sim = new Simulation(5)
  const camera = new PerspectiveCamera(OVERVIEW_FOV_DEG, 16 / 9, 1, 500)
  const rig = new FakeRig()
  const sys = new PlayerSystem({ camera, getSim: () => sim, getRig: () => rig, reducedMotion: () => false })
  made.push(sys)
  sys.update(DT)
  sys.placeAt(x, z, heading)
  for (let i = 0; i < 6; i++) sys.update(DT)
  return { sim, sys }
}

afterEach(() => {
  while (made.length) made.pop()?.dispose()
})

interface Leg {
  /** Metres walked (the sum of every frame's step), the straight distance from where the leg began, and where it ended. */
  path: number
  dx: number
  dz: number
  x: number
  z: number
  /** Frames that ended somewhere a body cannot stand (inside a solid or off the floor). */
  inside: number
  speed: number
}

/** Hold `keys` for `seconds`, then let go. */
function hold(r: Rig, keys: readonly string[], seconds: number): Leg {
  const p = (): { x: number; z: number } => r.sim.player!
  const x0 = p().x
  const z0 = p().z
  let lx = x0
  let lz = z0
  let path = 0
  let inside = 0
  for (const k of keys) r.sys.input.keyDown(k)
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    r.sys.update(DT)
    const q = p()
    path += Math.hypot(q.x - lx, q.z - lz)
    lx = q.x
    lz = q.z
    if (!walkableAt(q.x, q.z)) inside++
  }
  const speed = r.sim.player!.speed
  for (const k of keys) r.sys.input.keyUp(k)
  return { path, dx: lx - x0, dz: lz - z0, x: lx, z: lz, inside, speed }
}

const idx = new Int32Array(QUERY_CAPACITY)

/** The static solids within `reach` of the body's contact distance (R) at (x, z): their ids and the outward normals (from the solid to the body). */
function contacts(x: number, z: number, reach = 1e-3): { id: string; nx: number; nz: number }[] {
  const s = staticSolids()
  const n = queryStatic(x - 1, x + 1, z - 1, z + 1, idx)
  const out: { id: string; nx: number; nz: number }[] = []
  for (let k = 0; k < n; k++) {
    const i = idx[k]
    const o = i * SOLID_STRIDE
    const d = s.data
    const dist = d[o] === KIND_CIRCLE ? Math.hypot(x - d[o + 1], z - d[o + 2]) - d[o + 5] : boxDistance(x, z, d[o + 1], d[o + 2], d[o + 3], d[o + 4], d[o + 5], d[o + 6])
    if (dist > R + reach) continue
    // the normal: from the nearest point of the solid to the body (a numerical gradient of the distance field)
    const e = 1e-5
    const dd = (px: number, pz: number): number =>
      d[o] === KIND_CIRCLE ? Math.hypot(px - d[o + 1], pz - d[o + 2]) - d[o + 5] : boxDistance(px, pz, d[o + 1], d[o + 2], d[o + 3], d[o + 4], d[o + 5], d[o + 6])
    const gx = (dd(x + e, z) - dd(x - e, z)) / (2 * e)
    const gz = (dd(x, z + e) - dd(x, z - e)) / (2 * e)
    const len = Math.hypot(gx, gz) || 1
    out.push({ id: s.ids[i], nx: gx / len, nz: gz / len })
  }
  return out
}

/** Is there ANY direction that goes (a bit) the way asked (dx, dz) without going into a solid the body touches? A body for which there is none is in a corner. */
function hasWayToGo(x: number, z: number, dx: number, dz: number): boolean {
  const c = contacts(x, z)
  for (let a = 0; a < 3600; a++) {
    const vx = Math.cos((a / 3600) * Math.PI * 2)
    const vz = Math.sin((a / 3600) * Math.PI * 2)
    if (vx * dx + vz * dz < 1e-3) continue
    if (c.every((k) => vx * k.nx + vz * k.nz >= -1e-9)) return true
  }
  return false
}

/** The numbers each trial measured, printed at the end (the final report quotes them). */
const report: string[] = []
const note = (line: string): void => {
  report.push(line)
}

/** A wall to be pressed against: stand at (x, z) facing `heading`, walk into it, and it stops at `axis` = `at` (a body radius and a skin from the face). */
interface Wall {
  name: string
  x: number
  z: number
  heading: number
  axis: 'x' | 'z'
  at: number
}

const WALLS: readonly Wall[] = [
  // corridor A's north wall: its face is z = -15.9; (-20, -13) faces it head on (heading pi faces -z). x = -20 is where a partition meets it (a T)
  { name: 'corridor A north wall at the partition (-20)', x: -20, z: -13, heading: Math.PI, axis: 'z', at: -15.9 + R },
  { name: 'corridor A north wall, plain (x -30)', x: -30, z: -13.5, heading: Math.PI, axis: 'z', at: -15.9 + R },
  // its south wall: the face is z = -12.1, facing it is heading 0 (+z)
  { name: 'corridor A south wall, plain (x -30)', x: -30, z: -14.5, heading: 0, axis: 'z', at: -12.1 - R },
  // ward room A3: the east partition's face is x = -10.1 (facing east is heading pi/2), the west one's x = -14.9 (heading 3 pi / 2)
  { name: 'ward room A3 east wall', x: -12, z: -19, heading: Math.PI / 2, axis: 'x', at: -10.1 - R },
  { name: 'ward room A3 west wall', x: -13.5, z: -17.2, heading: (3 * Math.PI) / 2, axis: 'x', at: -14.9 + R },
  // the plain façade on the plaza
  { name: 'the façade on the plaza', x: -65, z: 6, heading: Math.PI / 2, axis: 'x', at: -62.1 - R },
]

/** Stand where `w` says and walk into its wall until pressed against it (and prove that it is). */
function press(w: Wall): { r: Rig; into: Leg } {
  const r = standAt(w.x, w.z, w.heading)
  const into = hold(r, ['KeyW'], 1.5)
  expect(w.axis === 'x' ? into.x : into.z, `${w.name}: it walked up to the wall`).toBeCloseTo(w.at, 3)
  expect(into.speed, `${w.name}: and stopped there`).toBe(0)
  return { r, into }
}

describe('wall trials: pressed against a wall, the doctor can always leave it', () => {
  const corridorA = WALLS[0]

  it('backing away with S after a head-on press walks away at the back speed (half the walking speed): 1.8 m or more in 2 s, from every kind of wall', () => {
    const legs = WALLS.map((w) => {
      const { r } = press(w)
      const leg = hold(r, ['KeyS'], 2)
      note(`S away from ${w.name}, 2 s: path ${leg.path.toFixed(3)} m`)
      return { w, leg }
    })
    for (const { w, leg } of legs) {
      expect(leg.path, w.name).toBeGreaterThanOrEqual(1.8)
      // straight back, away from the wall, and never into anything
      const away = w.axis === 'x' ? Math.abs(leg.dx) : Math.abs(leg.dz)
      const across = w.axis === 'x' ? Math.abs(leg.dz) : Math.abs(leg.dx)
      expect(away, w.name).toBeGreaterThanOrEqual(1.8)
      expect(across, w.name).toBeLessThan(1e-6)
      expect(leg.inside, w.name).toBe(0)
    }
  })

  it('turning away with W+A or W+D after a head-on press walks (a turning circle away from the wall): 1.5 m or more in 2 s, never into the wall', () => {
    const legs: { name: string; leg: Leg }[] = []
    for (const w of [WALLS[0], WALLS[1], WALLS[3]]) {
      for (const [turn, key] of [
        ['W+A', 'KeyA'],
        ['W+D', 'KeyD'],
      ] as const) {
        const { r } = press(w)
        const leg = hold(r, ['KeyW', key], 2)
        note(`${turn} away from ${w.name}, 2 s: path ${leg.path.toFixed(3)} m`)
        legs.push({ name: `${turn} at ${w.name}`, leg })
      }
    }
    for (const { name, leg } of legs) {
      expect(leg.path, name).toBeGreaterThanOrEqual(1.5)
      expect(leg.inside, name).toBe(0)
    }
  })

  it('a hard turn on the spot and then W leaves the wall along the corridor at full speed', () => {
    const { r } = press(corridorA)
    const turn = hold(r, ['KeyA'], 0.7) // 140 deg/s: about 98 degrees, so it faces along the corridor
    const leg = hold(r, ['KeyW'], 2)
    note(`A 0.7 s then W 2 s from the corridor-A wall: turned on the spot (${Math.hypot(turn.dx, turn.dz).toFixed(3)} m), then path ${leg.path.toFixed(3)} m`)
    expect(leg.path).toBeGreaterThanOrEqual(2.5)
    expect(leg.inside).toBe(0)
  })

  it('30 degrees into a plain wall (the corridor-A north wall at x -28) slides along it: at least 0.9 m along the wall in 2 s, at R from its face, never inside', () => {
    const legs = [1, -1].map((sign) => {
      // facing -z and 30 degrees to one side: heading pi + 0.52 goes west (-x) as well, pi - 0.52 east
      const r = standAt(-28, -14.4, Math.PI + sign * 0.52)
      hold(r, ['KeyW'], 1.5)
      const leg = hold(r, ['KeyW'], 2)
      note(`30 deg slide ${sign > 0 ? 'west' : 'east'} on the corridor-A wall, 2 s after the press: along ${Math.abs(leg.dx).toFixed(3)} m, path ${leg.path.toFixed(3)} m, z ${leg.z.toFixed(4)}`)
      return { sign, leg }
    })
    for (const { sign, leg } of legs) {
      expect(Math.abs(leg.dx), `sign ${sign}`).toBeGreaterThanOrEqual(0.9)
      expect(Math.sign(leg.dx), `sign ${sign}`).toBe(-sign) // west for pi + 0.52 (sin < 0), east for pi - 0.52
      expect(leg.z, `sign ${sign}`).toBeGreaterThanOrEqual(corridorA.at - 1e-6) // never into the wall
      expect(leg.z, `sign ${sign}`).toBeLessThan(corridorA.at + 1e-6) // and no backing off it either
      expect(leg.inside).toBe(0)
    }
  })

  it('walking parallel to a wall is unchanged: the same distance as in the middle of the corridor, at R from the wall the whole way', () => {
    const along = standAt(-31.5, corridorA.at, Math.PI / 2) // facing +x, along the wall
    const free = standAt(-31.5, -13.8, Math.PI / 2) // the same walk down the middle of the corridor
    const a = hold(along, ['KeyW'], 2)
    const f = hold(free, ['KeyW'], 2)
    note(`walk parallel to the wall, 2 s: ${a.dx.toFixed(4)} m along the wall, ${f.dx.toFixed(4)} m in the open corridor`)
    expect(a.dx).toBeGreaterThan(2.5)
    expect(a.dx).toBeCloseTo(f.dx, 9)
    expect(a.z).toBeCloseTo(corridorA.at, 9)
    expect(a.inside).toBe(0)
  })

  it('a ward room: pressed head-on into the east wall of room A3, A+W and D+W both leave it (the floor is clear along that wall)', () => {
    const legs = ([
      ['A+W', 'KeyA'],
      ['D+W', 'KeyD'],
    ] as const).map(([name, key]) => {
      const { r } = press(WALLS[3])
      const leg = hold(r, [key, 'KeyW'], 2)
      note(`${name} from the A3 east wall, 2 s: path ${leg.path.toFixed(3)} m`)
      return { name, leg }
    })
    for (const { name, leg } of legs) {
      expect(leg.path, name).toBeGreaterThanOrEqual(1.5)
      expect(leg.inside, name).toBe(0)
    }
  })

  it('a ward room bedside pocket: placed 1 cm inside the skin of the A1 bath (the spot the app reported), W then A+W turns away at once, and the move never ends inside anything', () => {
    // (-21.5, -20.5) is 0.30 m from the bath's west face (R is 0.31) and the sofa's corner closes the way ahead at z -20.69
    const r = standAt(-21.5, -20.5, Math.PI)
    const into = hold(r, ['KeyW'], 1.5)
    const leg = hold(r, ['KeyA', 'KeyW'], 2)
    note(`A1 pocket (-21.5, -20.5): W 1.5 s to (${into.x.toFixed(3)}, ${into.z.toFixed(3)}), then A+W 2 s: path ${leg.path.toFixed(3)} m`)
    expect(leg.path).toBeGreaterThanOrEqual(1.5)
    expect(leg.inside).toBe(0)
  })

  it('the triage back wall at 30 degrees: it slides, or if a monitor makes it an inside corner it stays only because there is nowhere to go, and it can still back out and turn out', () => {
    const r = standAt(-49.4, -21.0, Math.PI + 0.52)
    const press = hold(r, ['KeyW'], 1.5)
    const heading = r.sys.snapshot().heading
    const dirX = Math.sin(heading)
    const dirZ = Math.cos(heading)
    const slide = hold(r, ['KeyW'], 2)
    const cornered = !hasWayToGo(press.x, press.z, dirX, dirZ)
    const touching = contacts(press.x, press.z)
    // ...from the same spot, backing up with S, and (a fresh run to it) turning away with D+W
    const back = hold(r, ['KeyS'], 2)
    const r2 = standAt(-49.4, -21.0, Math.PI + 0.52)
    hold(r2, ['KeyW'], 1.5)
    const turn = hold(r2, ['KeyW', 'KeyD'], 2)
    note(
      `triage 30 deg: pressed at (${press.x.toFixed(3)}, ${press.z.toFixed(3)}) touching ${touching.map((c) => c.id).join(' + ')}; inside corner ${cornered}; W 2 s: path ${slide.path.toFixed(3)} m; S 2 s: ${back.path.toFixed(3)} m; D+W 2 s: ${turn.path.toFixed(3)} m`,
    )
    if (cornered) {
      // stuck only because it is a corner: two solids touching, and no direction towards where it faces that is free
      expect(touching.length).toBeGreaterThanOrEqual(2)
      expect(slide.path).toBeLessThan(0.02)
      // but it can leave: backing up (the way back is open for 1.7 m, along the bay's curtain) and turning away
      expect(back.path).toBeGreaterThanOrEqual(1.2)
      expect(turn.path).toBeGreaterThanOrEqual(1.5)
    } else {
      expect(slide.path).toBeGreaterThanOrEqual(0.9)
    }
    expect(slide.inside).toBe(0)
    expect(back.inside).toBe(0)
    expect(turn.inside).toBe(0)
  })
})

describe('wall trial numbers', () => {
  it('prints what the trials measured', () => {
    // eslint-disable-next-line no-console
    console.log(`wall trials:\n  ${report.join('\n  ')}`)
    expect(report.length).toBeGreaterThan(10)
  })
})
