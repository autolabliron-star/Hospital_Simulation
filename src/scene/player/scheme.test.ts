import { describe, expect, it } from 'vitest'
import { angleDelta, wrapAngle } from './chaseMath'
import { DEFAULT_SCHEME, TURN_RELEASE_SECONDS, TURN_RISE_SECONDS, maxTurnRate, newSteering, newTurn, routeInput, schemeFromSearch, stepTurn, turnedHeading } from './scheme'
import { EASY } from './tuning'

const DEG = Math.PI / 180
const DT = 1 / 60

describe('which scheme is in use', () => {
  it('the easy scheme is the default; `?controls=classic` brings the camera-relative one back', () => {
    expect(DEFAULT_SCHEME).toBe('easy')
    expect(schemeFromSearch('')).toBe('easy')
    expect(schemeFromSearch('?seed=7&probe=1')).toBe('easy')
    expect(schemeFromSearch('?controls=classic')).toBe('classic')
    expect(schemeFromSearch('?seed=7&controls=classic&probe=1')).toBe('classic')
    expect(schemeFromSearch('?controls=Classic')).toBe('classic')
    expect(schemeFromSearch('?controls=easy')).toBe('easy')
    expect(schemeFromSearch('?controls=nonsense')).toBe('easy')
  })
})

describe('GTA classic: WASD is relative to the camera', () => {
  const YAWS = [0, 30, 90, 135, 180, -90, -170].map((d) => d * DEG)
  const classic = (forward: number, right: number, cameraYaw: number, heading = 0.77) => routeInput('classic', forward, right, heading, cameraYaw)

  it('W walks the way the camera faces, S back towards it, for every camera yaw', () => {
    for (const yaw of YAWS) {
      const w = classic(1, 0, yaw)
      expect(w.dirX).toBeCloseTo(Math.sin(yaw), 9)
      expect(w.dirZ).toBeCloseTo(Math.cos(yaw), 9)
      const s = classic(-1, 0, yaw)
      expect(s.dirX).toBeCloseTo(-Math.sin(yaw), 9)
      expect(s.dirZ).toBeCloseTo(-Math.cos(yaw), 9)
    }
  })

  it('D walks to the right of the picture and A to the left, for every camera yaw', () => {
    for (const yaw of YAWS) {
      const d = classic(0, 1, yaw)
      const a = classic(0, -1, yaw)
      // the right-hand side of someone facing yaw is (-cos yaw, sin yaw)
      expect(d.dirX).toBeCloseTo(-Math.cos(yaw), 9)
      expect(d.dirZ).toBeCloseTo(Math.sin(yaw), 9)
      expect(a.dirX).toBeCloseTo(Math.cos(yaw), 9)
      expect(a.dirZ).toBeCloseTo(-Math.sin(yaw), 9)
    }
  })

  it('on the map: facing south (+z) D goes west, facing east (+x) D goes south, facing north (-z) D goes east', () => {
    // x is east and z is south
    const south = classic(0, 1, 0)
    expect(south.dirX).toBeCloseTo(-1, 9)
    expect(south.dirZ).toBeCloseTo(0, 9)
    const east = classic(0, 1, Math.PI / 2)
    expect(east.dirX).toBeCloseTo(0, 9)
    expect(east.dirZ).toBeCloseTo(1, 9)
    const north = classic(0, 1, Math.PI)
    expect(north.dirX).toBeCloseTo(1, 9)
    expect(north.dirZ).toBeCloseTo(0, 9)
  })

  it('a diagonal is a unit vector, half way between the two keys\' directions', () => {
    for (const yaw of YAWS) {
      const wd = classic(1, 1, yaw)
      expect(Math.hypot(wd.dirX, wd.dirZ)).toBeCloseTo(1, 9)
      const w = classic(1, 0, yaw)
      const d = classic(0, 1, yaw)
      expect(wd.dirX).toBeCloseTo((w.dirX + d.dirX) / Math.SQRT2, 9)
      expect(wd.dirZ).toBeCloseTo((w.dirZ + d.dirZ) / Math.SQRT2, 9)
    }
  })

  it('opposite keys cancel, and no key is no steering', () => {
    const none = classic(0, 0, 1.2)
    expect(none).toEqual({ dirX: 0, dirZ: 0, turn: 0, speedFactor: 0, backing: false, active: false })
    const wasd = classic(1 - 1, 1 - 1, 0.4)
    expect(wasd.active).toBe(false)
    expect(routeInput('classic', 1, 0, 0, 0, newSteering()).active).toBe(true)
  })

  it('the heading does not matter, nothing turns the body with a key, nothing is slower, and S does not back up', () => {
    for (const heading of [0, 1, -2.5]) {
      for (const [f, r] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]] as const) {
        const s = routeInput('classic', f, r, heading, 0.4)
        const base = routeInput('classic', f, r, 0, 0.4)
        expect(s.dirX).toBeCloseTo(base.dirX, 12)
        expect(s.dirZ).toBeCloseTo(base.dirZ, 12)
        expect(s.turn).toBe(0)
        expect(s.speedFactor).toBe(1)
        expect(s.backing).toBe(false)
      }
    }
  })

  it('the picture and the walk agree: walking forward moves the player towards what the camera looks at', () => {
    // a camera at yaw 1.1 looks at a point 5 m ahead of the player; W moves the player towards it
    const yaw = 1.1
    const target = { x: Math.sin(yaw) * 5, z: Math.cos(yaw) * 5 }
    const s = classic(1, 0, yaw)
    const before = Math.hypot(target.x, target.z)
    const after = Math.hypot(target.x - s.dirX, target.z - s.dirZ)
    expect(after).toBeLessThan(before)
    expect(before - after).toBeCloseTo(1, 4)
  })
})

describe('easy: W and S walk along the way you face, A and D turn you', () => {
  const HEADINGS = [0, 30, 90, 135, 180, -90, -170].map((d) => d * DEG)
  const easy = (forward: number, right: number, heading: number, cameraYaw = 2.2) => routeInput('easy', forward, right, heading, cameraYaw)

  it('W walks along your heading and S backs up along it, whichever way the camera faces', () => {
    for (const heading of HEADINGS) {
      const w = easy(1, 0, heading)
      expect(w.dirX).toBeCloseTo(Math.sin(heading), 9)
      expect(w.dirZ).toBeCloseTo(Math.cos(heading), 9)
      expect(w.speedFactor).toBe(1)
      expect(w.backing).toBe(false)
      const s = easy(-1, 0, heading)
      expect(s.dirX).toBeCloseTo(-Math.sin(heading), 9)
      expect(s.dirZ).toBeCloseTo(-Math.cos(heading), 9)
      expect(s.backing).toBe(true)
      expect(s.speedFactor).toBe(EASY.backSpeedFactor)
    }
    expect(EASY.backSpeedFactor).toBeCloseTo(0.5, 6)
  })

  it('A and D do not walk anywhere: they only ask for a turn (D right, A left)', () => {
    for (const heading of HEADINGS) {
      const d = easy(0, 1, heading)
      expect(d.dirX).toBe(0)
      expect(d.dirZ).toBe(0)
      expect(d.turn).toBe(1)
      expect(d.speedFactor).toBe(0)
      expect(d.active).toBe(true)
      const a = easy(0, -1, heading)
      expect(a.turn).toBe(-1)
      expect(a.dirX === 0 && a.dirZ === 0).toBe(true)
    }
  })

  it('W and D together walk forward while turning; the camera\'s yaw is not read at all', () => {
    for (const heading of HEADINGS) {
      const wd = easy(1, 1, heading, 0.3)
      expect(wd.dirX).toBeCloseTo(Math.sin(heading), 9)
      expect(wd.dirZ).toBeCloseTo(Math.cos(heading), 9)
      expect(wd.turn).toBe(1)
      expect(easy(1, 1, heading, -2.9).dirX).toBe(wd.dirX)
    }
  })

  it('no key is no steering, and opposite keys cancel', () => {
    const none = easy(0, 0, 1.2)
    expect(none).toEqual({ dirX: 0, dirZ: 0, turn: 0, speedFactor: 0, backing: false, active: false })
    expect(easy(1 - 1, 1 - 1, 0.4).active).toBe(false)
  })
})

describe('turning with A and D', () => {
  it('D turns you right, which makes the heading SMALLER (heading = atan2(dx, dz)); A makes it larger', () => {
    const d = newTurn()
    expect(stepTurn(d, 1, false, DT)).toBeLessThan(0)
    const a = newTurn()
    expect(stepTurn(a, -1, false, DT)).toBeGreaterThan(0)
    // and in the world: facing +z, turning right faces west (-x), as the right-hand side of someone facing +z is -x
    let heading = 0
    const t = newTurn()
    for (let i = 0; i < 20; i++) heading = turnedHeading(heading, stepTurn(t, 1, false, DT))
    expect(heading).toBeLessThan(0)
    expect(Math.sin(heading)).toBeLessThan(0)
    expect(Math.cos(heading)).toBeGreaterThan(0)
  })

  it('there is no dead frame and no kick: the very first frame of a press already turns a little, and the rate rises as a first-order lag', () => {
    for (const turn of [1, -1]) {
      const t = newTurn()
      const delta = Math.abs(stepTurn(t, turn, false, DT))
      // the angle of the first frame is the integral of the rising rate: well under the old 45 % kick (1 degree), well over nothing
      expect(delta).toBeGreaterThan(0.1 * DEG)
      expect(delta).toBeLessThan(0.45 * maxTurnRate(false) * DT)
      // and the rate after it is the first-order step: max (1 - e^(-dt / tau))
      expect(Math.abs(t.rate)).toBeCloseTo(maxTurnRate(false) * (1 - Math.exp(-DT / TURN_RISE_SECONDS)), 9)
    }
  })

  it('holding it turns at about 140 degrees a second (200 running), reaching that rate within a few frames', () => {
    for (const running of [false, true]) {
      const t = newTurn()
      for (let i = 0; i < 30; i++) stepTurn(t, 1, running, DT) // half a second in
      const full = (running ? EASY.sprintTurnDegPerSecond : EASY.turnDegPerSecond) * DEG
      expect(Math.abs(t.rate)).toBeCloseTo(full, 2)
      let heading = 0
      for (let i = 0; i < 60; i++) heading += stepTurn(t, 1, running, DT) // one more second at the full rate
      expect(-heading / DEG).toBeCloseTo(running ? 200 : 140, 0)
    }
    expect(EASY.turnDegPerSecond).toBe(140)
    expect(EASY.sprintTurnDegPerSecond).toBe(200)
  })

  it('a full second of D turns you about 140 degrees to the right, in the first second including the ramp (a little less)', () => {
    const t = newTurn()
    let heading = 0
    for (let i = 0; i < 60; i++) heading = turnedHeading(heading, stepTurn(t, 1, false, DT))
    const turned = -heading / DEG
    expect(turned).toBeGreaterThan(130)
    expect(turned).toBeLessThanOrEqual(140)
  })

  it('letting go stops it quickly and ends in an exact stop (the rate is exactly 0 within half a second)', () => {
    const t = newTurn()
    for (let i = 0; i < 60; i++) stepTurn(t, 1, false, DT)
    let after = 0
    let frames = 0
    while (t.rate !== 0 && frames < 120) {
      after += stepTurn(t, 0, false, DT)
      frames++
    }
    expect(t.rate).toBe(0)
    expect(frames * DT).toBeLessThan(0.5)
    expect(stepTurn(t, 0, false, DT)).toBe(0)
    // the coast after the release is small: under 10 degrees
    expect(Math.abs(after) / DEG).toBeLessThan(10)
  })

  it('reversing (D then A) turns the new way at once (the rate passes through zero as a lag, with no jump and no kick)', () => {
    const t = newTurn()
    for (let i = 0; i < 30; i++) stepTurn(t, 1, false, DT)
    expect(t.rate).toBeLessThan(0)
    const before = t.rate
    const delta = stepTurn(t, -1, false, DT)
    // the rate moves towards the new target by the lag's share of the whole gap: never past it, never a jump to it
    const gap = maxTurnRate(false) - before // A asks for the opposite rate
    expect(t.rate - before).toBeCloseTo(gap * (1 - Math.exp(-DT / TURN_RISE_SECONDS)), 9)
    expect(Math.abs(t.rate - before)).toBeLessThanOrEqual(2 * maxTurnRate(false) * (1 - Math.exp(-DT / TURN_RISE_SECONDS)) + 1e-12)
    expect(delta).toBeLessThan(0.0) // the first frame is still mostly the old turn
    // a few frames later it is turning the new way
    for (let i = 0; i < 10; i++) stepTurn(t, -1, false, DT)
    expect(t.rate).toBeGreaterThan(0)
  })

  it('the rate never changes by more than the lag allows in a frame (at any frame rate), and the angle is the exact integral of the rate', () => {
    for (const dt of [1 / 20, 1 / 30, 1 / 60, 1 / 144]) {
      const t = newTurn()
      let last = 0
      let angle = 0
      for (let i = 0; i < Math.round(0.5 / dt); i++) {
        angle += stepTurn(t, 1, false, dt)
        expect(Math.abs(t.rate - last)).toBeLessThanOrEqual(maxTurnRate(false) * (1 - Math.exp(-dt / TURN_RISE_SECONDS)) + 1e-12)
        last = t.rate
      }
      for (let i = 0; i < Math.round(0.5 / dt); i++) {
        angle += stepTurn(t, 0, false, dt)
        expect(Math.abs(t.rate - last)).toBeLessThanOrEqual(maxTurnRate(false) * (1 - Math.exp(-dt / TURN_RELEASE_SECONDS)) + 1e-12)
        last = t.rate
      }
      // the same turn whatever the frame rate: the closed form of half a second of D, then half a second of letting go
      const tau = TURN_RISE_SECONDS
      const m = maxTurnRate(false)
      const held = m * (0.5 - tau * (1 - Math.exp(-0.5 / tau)))
      const rateAtRelease = m * (1 - Math.exp(-0.5 / tau))
      const coast = rateAtRelease * TURN_RELEASE_SECONDS * (1 - Math.exp(-0.5 / TURN_RELEASE_SECONDS))
      expect(-angle).toBeCloseTo(held + coast, 4) // (the last 1e-3 rad/s of the release is snapped to 0)
    }
  })

  it('both keys cancel (the turn input is 0), the input is clamped, and a zero-length frame turns nothing', () => {
    const t = newTurn()
    expect(stepTurn(t, 1 - 1, false, DT)).toBe(0)
    const big = newTurn()
    const clamped = newTurn()
    expect(stepTurn(big, 5, false, DT)).toBe(stepTurn(clamped, 1, false, DT))
    expect(Math.abs(stepTurn(newTurn(), 1, false, 0))).toBe(0)
  })

  it('the frame rate does not change how far you turn in a second (within a few percent)', () => {
    const turnedIn = (dt: number): number => {
      const t = newTurn()
      let h = 0
      for (let i = 0; i < Math.round(1 / dt); i++) h += stepTurn(t, 1, false, dt)
      return -h / DEG
    }
    expect(Math.abs(turnedIn(1 / 30) - turnedIn(1 / 120))).toBeLessThan(12)
  })

  it('turnedHeading wraps into (-pi, pi]', () => {
    expect(turnedHeading(3.1, 0.2)).toBeCloseTo(wrapAngle(3.3), 12)
    expect(turnedHeading(3.1, 0.2)).toBeLessThan(0)
    expect(angleDelta(turnedHeading(-3.1, -0.2), 2 * Math.PI - 3.3)).toBeCloseTo(0, 12)
  })
})
