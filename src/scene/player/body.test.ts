/**
 * The body as one object (BodyMover, no camera, no React): the speed spring on the keys, the numbers it publishes (`BodyState` = `walkBody`),
 * head-on pressure, reversals, determinism and frame-rate independence. Run in the open plaza, where nothing but the fences is near.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { PLAYER_PLAZA } from '@/sim/places'
import { BodyMover, BODY_FEEL, copyBodyState, newBodyState } from './body'
import { SMOOTH_TIME } from './motion'
import { maxTurnRate, TURN_RELEASE_SECONDS, TURN_RISE_SECONDS } from './scheme'
import { EASY } from './tuning'

const P = CONFIG.player
const DTS = [1 / 20, 1 / 30, 1 / 60, 1 / 144]
const DEG = Math.PI / 180

/** An easy-scheme body at (x, z) facing `heading` on the plaza. */
function easy(x = -73, z = 0, heading = Math.PI / 2): BodyMover {
  const m = new BodyMover('easy')
  m.place(x, z, heading)
  return m
}

function run(m: BodyMover, seconds: number, dt: number, forward: number, right = 0, hurry = false): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) m.step(dt, forward, right, hurry, 0)
}

describe('the body from the keys', () => {
  it('starts from rest to 95 % of the walk in 0.35 s, and the first frame moves it by well under a millimetre-per-frame of speed (60 fps: dv < 0.1)', () => {
    const m = easy()
    m.step(1 / 60, 1, 0, false, 0)
    expect(Math.hypot(m.state.vx, m.state.vz)).toBeLessThan(0.1)
    expect(Math.hypot(m.state.vx, m.state.vz)).toBeGreaterThan(0)
    let t = 1 / 60
    while (Math.hypot(m.state.vx, m.state.vz) < 0.95 * P.walkSpeed && t < 2) {
      m.step(1 / 60, 1, 0, false, 0)
      t += 1 / 60
    }
    expect(t).toBeGreaterThan(0.3)
    expect(t).toBeLessThan(0.4)
  })

  it('walks at the walk speed exactly, runs at the run speed exactly, backs up at half the walk and never runs backwards', () => {
    const m = easy()
    run(m, 2, 1 / 60, 1)
    expect(m.spring.v).toBe(P.walkSpeed)
    run(m, 2, 1 / 60, 1, 0, true)
    expect(m.spring.v).toBe(P.hurrySpeed)
    run(m, 3, 1 / 60, 0)
    expect(m.spring.v).toBe(0)
    const back = easy(-66, 0)
    run(back, 2, 1 / 60, -1, 0, true)
    expect(back.spring.v).toBe(-P.walkSpeed * EASY.backSpeedFactor)
    expect(back.x).toBeLessThan(-67.5) // west, backwards
  })

  it('the same 3 s walk and the stop after it end within 2 cm at 20, 30, 60 and 144 frames a second', () => {
    const ends: number[] = []
    for (const dt of DTS) {
      const m = easy()
      run(m, 3, dt, 1)
      run(m, 1, dt, 0)
      ends.push(m.x)
      expect(m.z).toBeCloseTo(0, 9)
    }
    // eslint-disable-next-line no-console
    console.log(`3 s walk + stop, end x at 20/30/60/144 fps: ${ends.map((e) => e.toFixed(4)).join(', ')} (spread ${(Math.max(...ends) - Math.min(...ends)).toExponential(2)} m)`)
    expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(0.02)
  })

  it('a curved walk (W and D, then released) ends within 3 cm at every frame rate too: the turn is integrated exactly and the path is followed along the mid heading', () => {
    const ends: { x: number; z: number }[] = []
    for (const dt of DTS) {
      const m = easy(-68, 0, 0)
      run(m, 1.5, dt, 1, 1)
      run(m, 1, dt, 0)
      ends.push({ x: m.x, z: m.z })
    }
    let worst = 0
    for (const e of ends) for (const f of ends) worst = Math.max(worst, Math.hypot(e.x - f.x, e.z - f.z))
    // eslint-disable-next-line no-console
    console.log(`curved walk, worst end-point spread over 20/30/60/144 fps: ${(worst * 100).toFixed(2)} cm`)
    expect(worst).toBeLessThan(0.03)
  })

  it('the stop takes under 0.3 s from a walk and under 0.35 from a run to 5 % of the speed, over 0.2-0.3 m from a walk and 0.4-0.6 m from a run', () => {
    for (const [hurry, lo, hi] of [[false, 0.2, 0.3], [true, 0.4, 0.6]] as const) {
      const m = easy()
      run(m, 2.5, 1 / 60, 1, 0, hurry)
      const x0 = m.x
      const v0 = hurry ? P.hurrySpeed : P.walkSpeed
      let t = 0
      let at = -1
      for (let i = 0; i < 120; i++) {
        m.step(1 / 60, 0, 0, hurry, 0)
        t += 1 / 60
        if (at < 0 && Math.hypot(m.state.vx, m.state.vz) <= 0.05 * v0) at = t
      }
      expect(at).toBeLessThanOrEqual(0.3 + 1e-9)
      expect(m.x - x0).toBeGreaterThanOrEqual(lo)
      expect(m.x - x0).toBeLessThanOrEqual(hi)
      expect(m.spring.v).toBe(0)
    }
  })
})

describe('the numbers it publishes', () => {
  it('wish is the velocity the keys ask for (0 with no key), vx and vz the velocity achieved, a and the lean direction along the motion', () => {
    const m = easy()
    m.step(1 / 60, 0, 0, false, 0)
    expect(m.state.wishX).toBe(0)
    expect(m.state.wishZ).toBe(0)
    expect(m.state.live).toBe(true)
    m.step(1 / 60, 1, 0, false, 0)
    expect(m.state.wishX).toBeCloseTo(P.walkSpeed, 9) // facing east
    expect(m.state.wishZ).toBeCloseTo(0, 9)
    expect(m.state.vx).toBeGreaterThan(0)
    expect(m.state.ax).toBeGreaterThan(0) // accelerating east
    run(m, 1, 1 / 60, 1, 0, true)
    expect(m.state.wishX).toBeCloseTo(P.hurrySpeed, 9)
    run(m, 0.05, 1 / 60, 0)
    expect(m.state.wishX).toBe(0)
    expect(m.state.ax).toBeLessThan(0) // braking
    // backing up: the wish and the velocity point west
    const back = easy(-66, 0)
    run(back, 1, 1 / 60, -1)
    expect(back.state.wishX).toBeCloseTo(-P.walkSpeed * EASY.backSpeedFactor, 9)
    expect(back.state.vx).toBeLessThan(0)
  })

  it('stopping is true from the moment the key is let go until it is at rest, and stillFor counts the seconds since it last moved above 0.05 m/s', () => {
    const m = easy()
    run(m, 1, 1 / 60, 1)
    expect(m.state.stopping).toBe(false)
    expect(m.state.stillFor).toBe(0)
    m.step(1 / 60, 0, 0, false, 0)
    expect(m.state.stopping).toBe(true)
    let frames = 0
    while (m.state.stopping && frames < 200) {
      m.step(1 / 60, 0, 0, false, 0)
      frames++
    }
    expect(frames * (1 / 60)).toBeLessThan(0.45)
    expect(m.state.stopping).toBe(false)
    const was = m.state.stillFor
    run(m, 1, 1 / 60, 0)
    expect(m.state.stillFor).toBeCloseTo(was + 1, 6)
    m.step(1 / 60, 1, 0, false, 0)
    m.step(1 / 60, 1, 0, false, 0)
    run(m, 0.5, 1 / 60, 1)
    expect(m.state.stillFor).toBe(0)
  })

  it('the rest point is where you actually come to rest if you let go now: at a walk, in mid-start, at a run, and backing up (within 5 mm)', () => {
    for (const [dt, lead, forward, hurry] of [[1 / 60, 3, 1, false], [1 / 60, 0.12, 1, false], [1 / 60, 3, 1, true], [1 / 60, 0.3, 1, true], [1 / 144, 3, -1, false], [1 / 30, 3, 1, true]] as const) {
      const m = easy()
      run(m, lead, dt, forward, 0, hurry)
      // what it says while the key is still down
      const sayX = m.state.restX
      const sayZ = m.state.restZ
      run(m, 1.5, dt, 0)
      expect(Math.hypot(m.x - sayX, m.z - sayZ), `lead ${lead} forward ${forward} hurry ${hurry}`).toBeLessThan(0.005)
    }
    // while standing it is where you stand
    const m = easy()
    run(m, 1, 1 / 60, 0)
    expect(m.state.restX).toBe(m.x)
    expect(m.state.restZ).toBe(m.z)
  })

  it('the rest point is swept through the solids: running at a wall, it is the stopping point at the wall, not 0.5 m through it', () => {
    const m = easy(PLAYER_PLAZA.x0 + 1.0, 0, -Math.PI / 2) // facing the west fence, 1 m from it
    run(m, 0.4, 1 / 60, 1, 0, true)
    // the wall is at x0; the body stops r + skin from it
    expect(m.state.restX).toBeGreaterThanOrEqual(PLAYER_PLAZA.x0 + P.bodyRadius + P.bodySkin - 1e-9)
  })

  it('the turn rate is d heading / dt, signed like the heading (D is negative), and rises as the lag does', () => {
    const m = easy()
    m.step(1 / 60, 0, 1, false, 0)
    expect(m.state.turnRate).toBeLessThan(0)
    expect(m.state.turnRate).toBeCloseTo(-maxTurnRate(false) * 0.0, -1)
    run(m, 1, 1 / 60, 0, 1)
    expect(m.state.turnRate).toBeCloseTo(-maxTurnRate(false), 3)
    run(m, 1, 1 / 60, 0, 0)
    expect(m.state.turnRate).toBe(0)
  })

  it('the turn rate never changes by more than the lag allows per frame, at any frame rate', () => {
    for (const dt of DTS) {
      const m = easy()
      let last = 0
      for (let i = 0; i < Math.round(0.6 / dt); i++) {
        m.step(dt, 0, 1, false, 0)
        expect(Math.abs(m.state.turnRate - last)).toBeLessThanOrEqual(maxTurnRate(false) * (1 - Math.exp(-dt / TURN_RISE_SECONDS)) + 1e-9)
        last = m.state.turnRate
      }
      for (let i = 0; i < Math.round(0.6 / dt); i++) {
        m.step(dt, 0, 0, false, 0)
        expect(Math.abs(m.state.turnRate - last)).toBeLessThanOrEqual(maxTurnRate(false) * (1 - Math.exp(-dt / TURN_RELEASE_SECONDS)) + 1e-9)
        last = m.state.turnRate
      }
      expect(m.state.turnRate).toBe(0)
    }
  })

  it('copyBodyState copies every field', () => {
    const a = newBodyState()
    const b = newBodyState()
    const m = easy()
    run(m, 1, 1 / 60, 1, 1)
    copyBodyState(m.state, a)
    expect(a).toEqual(m.state)
    copyBodyState(a, b)
    expect(b).toEqual(a)
    expect(Object.keys(b).sort()).toEqual(['ax', 'az', 'live', 'restX', 'restZ', 'stillFor', 'stopping', 'turnRate', 'vx', 'vz', 'wishX', 'wishZ', 'x', 'z'])
  })
})

describe('pressing against something, and reversing', () => {
  it('head on into a wall the speed drops to what is achieved (0): letting go afterwards does not coast, and holding on does not wind the spring up', () => {
    const m = easy(PLAYER_PLAZA.x0 + 1.0, 0, -Math.PI / 2)
    run(m, 2, 1 / 60, 1, 0, true)
    const xs = m.x
    expect(m.spring.v).toBe(0)
    expect(m.state.vx).toBe(0)
    expect(m.state.stopping).toBe(false)
    expect(m.state.stillFor).toBeGreaterThan(0.5)
    // let go: nothing left to coast
    run(m, 1, 1 / 60, 0)
    expect(m.x).toBe(xs)
    // and walking away at once starts from zero, not from the run it pressed with
    m.heading = Math.PI / 2
    m.step(1 / 60, 1, 0, false, 0)
    expect(Math.hypot(m.state.vx, m.state.vz)).toBeLessThan(0.1)
  })

  it('classic: a 180 degree reversal slows to 0.3 m/s before it turns, and never exceeds the run speed; the direction turns at most 10 rad/s', () => {
    const m = new BodyMover('classic')
    m.place(-68, 0)
    const face = Math.PI / 2
    run0(m, 1.5, face, true)
    expect(m.spring.v).toBe(P.hurrySpeed)
    let minV = Infinity
    let last = Math.atan2(Math.sin(face), Math.cos(face))
    let worstTurn = 0
    for (let i = 0; i < 60; i++) {
      m.step(1 / 60, 1, 0, true, -Math.PI / 2) // now ask for the opposite way
      minV = Math.min(minV, m.spring.v)
      const dir = Math.atan2(m.state.vx, m.state.vz)
      if (Math.hypot(m.state.vx, m.state.vz) > 0.05) {
        let d = dir - last
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        worstTurn = Math.max(worstTurn, Math.abs(d) * 60)
        last = dir
      }
      expect(m.spring.v).toBeLessThanOrEqual(P.hurrySpeed + 1e-9)
      expect(m.spring.v).toBeGreaterThanOrEqual(0)
    }
    expect(m.spring.v).toBeGreaterThan(P.hurrySpeed * 0.9) // and it is running again afterwards
    // the slow-down is real: the reversal's target is 0.3 m/s, reached partially in the frames the angle is beyond 100 degrees
    expect(minV).toBeLessThan(P.hurrySpeed * 0.9)
    expect(worstTurn).toBeLessThanOrEqual(BODY_FEEL.classicTurnRate + 0.5)
    expect(BODY_FEEL.reversalSpeed).toBe(0.3)
  })

  it('classic: from rest the body sets off straight the way it is asked, in any direction, with no turn first', () => {
    for (const a of [0, 90, 135, 180, -90, -170]) {
      const m = new BodyMover('classic')
      m.place(-68, 0)
      m.step(1 / 60, 1, 0, false, a * DEG)
      expect(Math.atan2(m.state.vx, m.state.vz)).toBeCloseTo(Math.atan2(Math.sin(a * DEG), Math.cos(a * DEG)), 6)
    }
  })
})

/** Classic body running along `facing` for `seconds`. */
function run0(m: BodyMover, seconds: number, facing: number, hurry: boolean): void {
  for (let i = 0; i < Math.round(seconds / (1 / 60)); i++) m.step(1 / 60, 1, 0, hurry, facing)
}

describe('determinism and bounds', () => {
  it('the same keys give the same body, bit for bit', () => {
    const a = easy()
    const b = easy()
    for (let i = 0; i < 600; i++) {
      const fwd = i % 200 < 120 ? 1 : 0
      const right = i % 150 < 40 ? 1 : i % 150 > 100 ? -1 : 0
      a.step(1 / 60, fwd, right, i % 300 < 100, 0)
      b.step(1 / 60, fwd, right, i % 300 < 100, 0)
    }
    expect(a.x).toBe(b.x)
    expect(a.z).toBe(b.z)
    expect(a.heading).toBe(b.heading)
    expect(a.state).toEqual(b.state)
  })

  it('a zero-length frame changes nothing, a long one (the owner clamps at 1/20 s) cannot hop a wall', () => {
    const m = easy()
    run(m, 1, 1 / 60, 1)
    const x = m.x
    m.step(0, 1, 0, false, 0)
    expect(m.x).toBe(x)
    // a 0.5 s hitch at the run speed straight at the west fence: stopped at the fence
    const w = easy(PLAYER_PLAZA.x0 + 3, 0, -Math.PI / 2)
    w.cruise(P.hurrySpeed, -Math.PI / 2)
    w.step(0.5, 1, 0, true, 0)
    expect(w.x).toBeGreaterThanOrEqual(PLAYER_PLAZA.x0 + P.bodyRadius)
  })

  it('smooth times are tied to the contract', () => {
    expect(SMOOTH_TIME.start).toBeCloseTo(P.startSeconds / 2.37, 12)
  })
})
