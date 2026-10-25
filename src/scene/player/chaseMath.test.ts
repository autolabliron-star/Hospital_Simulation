import { describe, expect, it } from 'vitest'
import {
  angleDelta,
  approach,
  avatarFade,
  boomAfterHit,
  boomWithinSlab,
  chaseFov,
  dampAngle,
  dampVec3,
  defaultBoom,
  dragOrbit,
  forwardOf,
  gaitBob,
  LAG_KNEE,
  limitFollowLag,
  followYawStep,
  lookAheadFor,
  lookTargetFor,
  minPitchAboveGround,
  newDamped,
  orbitOffset,
  REST,
  rightOf,
  runShare,
  shoulderPose,
  smooth01,
  smoothBoom,
  smoothDamp,
  smoothDampMax,
  smoothLength,
  softLimit,
  wrapAngle,
  zoomBoom,
} from './chaseMath'
import { CONFIG } from '@/sim/config'
import { CHASE } from './tuning'

const DEG = Math.PI / 180
const DT = 1 / 60

describe('angles', () => {
  it('wraps into (-pi, pi] and takes the short way round', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 9)
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI, 9)
    expect(wrapAngle(0.5)).toBeCloseTo(0.5, 9)
    expect(angleDelta(170 * DEG, -170 * DEG)).toBeCloseTo(20 * DEG, 9)
    expect(angleDelta(-170 * DEG, 170 * DEG)).toBeCloseTo(-20 * DEG, 9)
  })

  it('forward and right are perpendicular unit vectors, right on your right hand (facing +z, right is -x)', () => {
    for (const yaw of [0, 1, Math.PI / 2, Math.PI, -2.3]) {
      const f = forwardOf(yaw)
      const r = rightOf(yaw)
      expect(Math.hypot(f.x, f.z)).toBeCloseTo(1, 9)
      expect(Math.hypot(r.x, r.z)).toBeCloseTo(1, 9)
      expect(f.x * r.x + f.z * r.z).toBeCloseTo(0, 9)
      // right = forward turned 90 degrees clockwise seen from above (x east, z south): (fx, fz) -> (-fz, fx)
      expect(r.x).toBeCloseTo(-f.z, 9)
      expect(r.z).toBeCloseTo(f.x, 9)
    }
    expect(rightOf(0).x).toBeCloseTo(-1, 9)
    expect(rightOf(Math.PI / 2).z).toBeCloseTo(1, 9) // facing east, your right hand is south
  })
})

describe('the shoulder pose: behind your right shoulder, a little above eye level', () => {
  it('puts the pivot CONFIG.player.camera.shoulder to the right of your head and the camera behind it', () => {
    const C = CONFIG.player.camera
    for (const heading of [0, 1, Math.PI / 2, Math.PI, -2.3, 3.1]) {
      const feet = { x: -66, y: 0, z: 3 }
      const { position, target } = shoulderPose(feet, heading)
      const f = forwardOf(heading)
      const r = rightOf(heading)
      // the camera is `boom` from the pivot, behind it at the default elevation
      const { dist, pitch } = defaultBoom()
      const px = feet.x + r.x * C.shoulder
      const pz = feet.z + r.z * C.shoulder
      expect(Math.hypot(position.x - px, position.y - (feet.y + C.pivotHeight), position.z - pz)).toBeCloseTo(dist, 6)
      // behind (opposite the facing) and exactly on the shoulder line sideways
      expect((position.x - feet.x) * f.x + (position.z - feet.z) * f.z).toBeCloseTo(-dist * Math.cos(pitch), 6)
      expect((position.x - feet.x) * r.x + (position.z - feet.z) * r.z).toBeCloseTo(C.shoulder, 6)
      // slightly above the head, looking a little ahead at head height
      expect(position.y).toBeGreaterThan(feet.y + C.pivotHeight)
      expect(target.y).toBeCloseTo(feet.y + C.pivotHeight + CHASE.lookRaise, 6)
    }
  })

  it('is the camera at rest: the boom and elevation of defaultBoom reproduce it', () => {
    const { dist, pitch } = defaultBoom()
    const o = orbitOffset(0.8, pitch)
    expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(1, 9)
    expect(dist).toBe(CONFIG.player.camera.boom)
    expect(pitch).toBeCloseTo(-CONFIG.player.camera.pitchDeg * DEG, 9)
    expect(pitch).toBeGreaterThan(0)
    expect(pitch).toBeLessThan(20 * DEG)
  })
})

describe('orbitOffset', () => {
  it('is a unit vector, level at pitch 0, and behind the direction the camera faces', () => {
    const level = orbitOffset(0, 0)
    expect(level).toEqual({ x: -0, y: 0, z: -1 }) // facing +Z, so the camera sits on the -Z side
    const up = orbitOffset(Math.PI / 2, 45 * DEG)
    expect(up.x).toBeLessThan(0) // facing +X, camera on the -X side
    expect(up.y).toBeGreaterThan(0)
    for (const [yaw, pitch] of [[0.3, 0.2], [2, -0.1], [-1, 1.1]]) {
      const o = orbitOffset(yaw, pitch)
      expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(1, 9)
    }
  })
})

describe('mouse and wheel', () => {
  it('turns the view right when the mouse moves right, and looks down on you when it moves down', () => {
    const r = dragOrbit(0, 0.1, 100, 0)
    expect(r.yaw).toBeLessThan(0) // heading decreasing is turning right (the right-hand side of +Z is -X)
    expect(r.pitch).toBeCloseTo(0.1, 9)
    const d = dragOrbit(0, 0.1, 0, 50)
    expect(d.pitch).toBeGreaterThan(0.1)
  })

  it('clamps pitch and wraps yaw', () => {
    expect(dragOrbit(0, 0, 0, 1e6).pitch).toBe(CHASE.maxPitch)
    expect(dragOrbit(0, 0, 0, -1e6).pitch).toBe(CHASE.minPitch)
    const w = dragOrbit(3.1, 0, -400, 0)
    expect(w.yaw).toBeGreaterThan(-Math.PI)
    expect(w.yaw).toBeLessThanOrEqual(Math.PI)
  })

  it('zooms by a fixed share per notch, out on scroll down, never more than one notch per event', () => {
    const base = 3
    expect(zoomBoom(base, 100)).toBeGreaterThan(base)
    expect(zoomBoom(base, -100)).toBeLessThan(base)
    expect(zoomBoom(zoomBoom(base, 100), -100)).toBeCloseTo(base, 9)
    expect(zoomBoom(base, 10000)).toBeCloseTo(zoomBoom(base, 240), 9)
    expect(zoomBoom(base, 0)).toBe(base)
  })

  it('a few notches in from the default boom pass the first-person threshold; the wheel range does not start below it', () => {
    let d: number = defaultBoom().dist
    let notches = 0
    while (d >= CHASE.firstPersonBelow && notches < 100) {
      d = zoomBoom(d, -100)
      notches++
    }
    expect(notches).toBeGreaterThan(3)
    expect(notches).toBeLessThan(20)
    expect(CHASE.minDistance).toBeGreaterThanOrEqual(CHASE.firstPersonBelow)
    expect(defaultBoom().dist).toBeGreaterThan(CHASE.minDistance)
    expect(defaultBoom().dist).toBeLessThan(CHASE.maxDistance)
  })
})

describe('camera boom shortening', () => {
  it('keeps the wanted length when nothing is in the way', () => {
    expect(boomAfterHit(3, null, 0.03, 0.1)).toBe(3)
    expect(boomAfterHit(3, Number.NaN, 0.03, 0.1)).toBe(3)
  })

  it('stops short of a wall by the margin', () => {
    expect(boomAfterHit(3, 2, 0.03, 0.1)).toBeCloseTo(1.97, 9)
    expect(boomAfterHit(3, 2.99, 0.03, 0.1)).toBeCloseTo(2.96, 9)
  })

  it('never lengthens past the wish, never collapses past the minimum', () => {
    expect(boomAfterHit(3, 9, 0.03, 0.1)).toBe(3)
    expect(boomAfterHit(3, 0.05, 0.03, 0.1)).toBe(0.1)
    expect(boomAfterHit(0.08, 0.01, 0.03, 0.1)).toBe(0.08) // a boom already shorter than the minimum is left alone
  })

  it('keeps the camera under a ceiling: a steep boom is cut where it would cross it', () => {
    const pivotY = 1.62
    const ceiling = 3 - 0.25
    const dirY = Math.sin(60 * DEG)
    const len = boomWithinSlab(pivotY, dirY, 6, 0.25, ceiling)
    expect(len).toBeCloseTo((ceiling - pivotY) / dirY, 9)
    expect(pivotY + len * dirY).toBeLessThanOrEqual(ceiling + 1e-9)
    // the default chase boom (a few degrees up) is nowhere near the ceiling
    const def = defaultBoom()
    expect(boomWithinSlab(pivotY, Math.sin(def.pitch), def.dist, 0.25, ceiling)).toBe(def.dist)
  })

  it('keeps the camera above the floor when it looks up at you', () => {
    const len = boomWithinSlab(1.62, -Math.sin(30 * DEG), 6, 0.25, 2.75)
    expect(1.62 - len * Math.sin(30 * DEG)).toBeCloseTo(0.25, 9)
    expect(boomWithinSlab(1.62, 0, 5, 0.25, 2.75)).toBe(5) // level: no limit
  })

  it('copes with a pivot already outside the slab', () => {
    expect(boomWithinSlab(5, 1, 4, 0.3, 2.75)).toBe(CHASE.minBoom)
  })

  it('shortens at once and lengthens slowly', () => {
    let shrinking = 3
    for (let i = 0; i < 6; i++) shrinking = smoothBoom(shrinking, 1, DT)
    expect(shrinking).toBeLessThan(1 + (3 - 1) * 0.2) // 0.1 s: most of the way
    let growing = 1
    for (let i = 0; i < 6; i++) growing = smoothBoom(growing, 3, DT)
    expect(growing).toBeLessThan(1 + (3 - 1) * 0.3) // 0.1 s: only a little way
    let settled = 1
    for (let i = 0; i < 400; i++) settled = smoothBoom(settled, 3, DT)
    expect(settled).toBe(3)
  })

  it('finds the lowest pitch that clears the floor', () => {
    const p = minPitchAboveGround(3, 1.62, 0.25)
    expect(1.62 + 3 * Math.sin(p)).toBeGreaterThanOrEqual(0.25 - 1e-9)
    expect(p).toBeGreaterThanOrEqual(CHASE.minPitch)
    // a boom so short the floor cannot matter allows the full range
    expect(minPitchAboveGround(0.5, 1.62, 0.25)).toBe(CHASE.minPitch)
  })
})

describe('smoothing that ends: no endless sub-pixel creep', () => {
  it('SmoothDamp arrives at its target exactly, with no velocity left, and then stays', () => {
    for (const T of [0.05, 0.07, 0.13, 0.4]) {
      const vel = { v: 0 }
      let x = 0
      let arrivedAt = -1
      for (let i = 0; i < 60 * 4; i++) {
        x = smoothDamp(x, 1, vel, T, DT)
        if (x === 1 && arrivedAt < 0) arrivedAt = i
      }
      expect(x).toBe(1)
      expect(vel.v).toBe(0)
      expect(arrivedAt * DT).toBeLessThan(T * 9 + 0.1)
      expect(arrivedAt).toBeGreaterThan(0)
    }
  })

  it('converges without overshooting', () => {
    const vel = { v: 0 }
    let x = 0
    let max = 0
    for (let i = 0; i < 240; i++) {
      x = smoothDamp(x, 1, vel, 0.12, DT)
      max = Math.max(max, x)
    }
    expect(x).toBe(1)
    expect(max).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('snaps only what has all but arrived: a hair away (and still) is on its target at once, a visible gap is not', () => {
    const vel = { v: 0 }
    expect(smoothDamp(1 - REST.position / 2, 1, vel, 0.1, DT)).toBe(1)
    const far = { v: 0 }
    const next = smoothDamp(1 - 0.01, 1, far, 0.1, DT)
    expect(next).toBeGreaterThan(0.99)
    expect(next).toBeLessThan(1)
  })

  it('an angle also ends in an exact rest, the short way round', () => {
    const vel = { v: 0 }
    let a = 170 * DEG
    for (let i = 0; i < 20; i++) a = dampAngle(a, -170 * DEG, vel, 0.05, DT)
    expect(a).toBeGreaterThan(170 * DEG) // moved up through pi, not back down through zero
    for (let i = 0; i < 60 * 3; i++) a = dampAngle(a, -170 * DEG, vel, 0.05, DT)
    expect(angleDelta(a, -170 * DEG)).toBe(0)
    expect(vel.v).toBe(0)
  })

  it('the boom grows back in about a second and arrives exactly, speed running down to nothing (a pure exponential never arrived)', () => {
    let b = 0.3
    let steps = 0
    let last = b
    let lastStep = Infinity
    let monotone = true
    while (b < 1 && steps < 60 * 5) {
      b = smoothBoom(b, 1, DT)
      steps++
      const step = b - last
      if (step > lastStep + 1e-9 && b < 1) monotone = false // never speeds up on the way in
      lastStep = step
      last = b
    }
    expect(b).toBe(1)
    expect(steps * DT).toBeLessThan(1.3)
    expect(steps * DT).toBeGreaterThan(0.5) // still a slow glide, not a snap
    expect(monotone).toBe(true)
  })

  it('shortening is still at once, and a boom already at its target stays put', () => {
    expect(smoothBoom(4, 1, DT)).toBeLessThan(4 - 3 * 0.35)
    expect(smoothBoom(2, 2, DT)).toBe(2)
    expect(smoothBoom(1.9999999, 2, DT)).toBe(2)
  })

  it('works in any unit: a boom in metres and one in shares of the wanted length arrive in the same time', () => {
    const run = (from: number, to: number) => {
      let b = from
      let n = 0
      while (b < to && n < 600) {
        b = smoothBoom(b, to, DT)
        n++
      }
      return n
    }
    expect(run(0.3, 1)).toBe(run(1.2, 4))
  })

  it('a follow point trails a moving target by about speed times the lag time, and ends in an exact rest', () => {
    const speed = CONFIG.player.walkSpeed
    const state = newDamped({ x: 0, y: 0, z: 0 })
    let target = 0
    for (let i = 0; i < 60 * 3; i++) {
      target += speed / 60
      dampVec3(state, { x: target, y: 0, z: 0 }, CHASE.lagSeconds, DT)
    }
    const lag = target - state.x
    expect(lag).toBeGreaterThan(speed * CHASE.lagSeconds * 0.85)
    expect(lag).toBeLessThan(speed * CHASE.lagSeconds * 1.15)
    for (let i = 0; i < 60 * 2; i++) dampVec3(state, { x: target, y: 0, z: 0 }, CHASE.lagSeconds, DT)
    expect(state.x).toBe(target)
    expect(state.vx).toBe(0)
  })

  it('smooth01 and approach behave', () => {
    expect(smooth01(-1)).toBe(0)
    expect(smooth01(2)).toBe(1)
    expect(smooth01(0.5)).toBe(0.5)
    expect(approach(0, 1, 0.3)).toBeCloseTo(0.3, 9)
    expect(approach(0.9, 1, 0.3)).toBe(1)
    expect(approach(0.1, 0, 0.3)).toBe(0)
  })
})

describe('look-ahead and the aim point', () => {
  it('lookTargetFor is ahead of the pivot along the camera facing', () => {
    const t = lookTargetFor({ x: 1, y: 1.62, z: 1 }, Math.PI / 2)
    expect(t.x).toBeCloseTo(1 + CHASE.lookAhead, 6)
    expect(t.z).toBeCloseTo(1, 6)
  })

  it('look-ahead is zero standing still, grows with speed along the way you go, and is capped', () => {
    expect(lookAheadFor(0, 0)).toEqual({ x: 0, z: 0 })
    const walk = lookAheadFor(0, -CONFIG.player.walkSpeed)
    const hurry = lookAheadFor(0, -CONFIG.player.hurrySpeed)
    expect(walk.x).toBeCloseTo(0, 9)
    expect(walk.z).toBeCloseTo(-CONFIG.player.walkSpeed * CHASE.lookAheadSeconds, 9)
    expect(Math.abs(hurry.z)).toBeGreaterThan(Math.abs(walk.z))
    expect(Math.hypot(hurry.x, hurry.z)).toBeLessThanOrEqual(CHASE.lookAheadMax + 1e-9)
    const fast = lookAheadFor(30, 40)
    expect(Math.hypot(fast.x, fast.z)).toBeCloseTo(CHASE.lookAheadMax, 9)
    expect(lookAheadFor(5, 0).z).toBeCloseTo(0, 9) // sideways stays sideways
  })
})

describe('the field of view and your avatar', () => {
  it('is the walk lens behind your shoulder, the first-person lens through your eyes, blended between', () => {
    const { fovDeg, fovFirstDeg } = CONFIG.player.camera
    expect(chaseFov(0)).toBe(fovDeg)
    expect(chaseFov(1)).toBeCloseTo(fovFirstDeg, 9)
    expect(chaseFov(0.5)).toBeGreaterThan(Math.min(fovDeg, fovFirstDeg))
    expect(chaseFov(0.5)).toBeLessThan(Math.max(fovDeg, fovFirstDeg))
  })

  it('through your eyes is the walkthrough\'s lens and eye (step 3): 55 degrees at 1.6 m, narrower than the chase lens', () => {
    expect(CONFIG.player.camera.fovFirstDeg).toBe(55)
    expect(CONFIG.player.camera.eyeHeight).toBe(1.6)
    expect(CONFIG.player.camera.fovFirstDeg).toBeLessThan(CONFIG.player.camera.fovDeg)
  })

  it('your avatar fades out below hideAvatarBelow and in first person, and is fully there at the normal boom', () => {
    const below = CONFIG.player.camera.hideAvatarBelow
    expect(avatarFade(3, 0)).toBe(1)
    expect(avatarFade(below, 0)).toBe(0)
    expect(avatarFade(0.1, 0)).toBe(0)
    expect(avatarFade(below + CHASE.avatarFadeRange / 2, 0)).toBeGreaterThan(0)
    expect(avatarFade(below + CHASE.avatarFadeRange / 2, 0)).toBeLessThan(1)
    expect(avatarFade(3, 1)).toBe(0)
    expect(avatarFade(0, 1)).toBe(0)
    // monotone in the boom
    let prev = -1
    for (let b = 0; b <= 2; b += 0.05) {
      const a = avatarFade(b, 0)
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
  })
})

describe('W3: the springs that never snap', () => {
  it('smoothDampMax: a jump of the target is followed at no more than the speed limit, the speed never exceeds it, and it comes to an exact rest', () => {
    const vel = { v: 0 }
    let x = 0
    let worst = 0
    for (let i = 0; i < 600; i++) {
      const next = smoothDampMax(x, 5, vel, 0.08, DT, 2.7)
      worst = Math.max(worst, Math.abs(next - x) / DT)
      x = next
    }
    expect(worst).toBeLessThanOrEqual(2.7 + 1e-9)
    expect(worst).toBeGreaterThan(2.0) // it does use the speed it is given
    expect(x).toBe(5)
    expect(vel.v).toBe(0)
  })

  it('smoothDampMax carries a velocity that is too fast down to the limit at once, and never overshoots the target', () => {
    const vel = { v: -10 }
    const next = smoothDampMax(1, 2, vel, 0.5, DT, 3)
    expect(Math.abs(next - 1) / DT).toBeLessThanOrEqual(3 + 1e-9)
    // approaching a target from far with a fast velocity: lands on it, never past
    const v2 = { v: 8 }
    let x = 0
    for (let i = 0; i < 300; i++) {
      x = smoothDampMax(x, 1, v2, 0.1, DT, 9)
      expect(x).toBeLessThanOrEqual(1)
    }
    expect(x).toBe(1)
  })

  it('smoothDampMax with a small step is the plain smoothDamp', () => {
    const a = { v: 0 }
    const b = { v: 0 }
    let x = 0
    let y = 0
    for (let i = 0; i < 40; i++) {
      x = smoothDamp(x, 0.05, a, 0.1, DT)
      y = smoothDampMax(y, 0.05, b, 0.1, DT, 100)
      expect(y).toBeCloseTo(x, 12)
    }
  })

  it('smoothLength shortens quickly and lengthens slowly, turns round without a jump in its position, and arrives in finite time', () => {
    const vel = { v: 0 }
    let x = 3
    // a wall appears: in (0.08 s, at most 2.7 m/s)
    for (let i = 0; i < 20; i++) x = smoothLength(x, 1.5, vel, DT, 0.08, 2.7, 0.5, 2.4, 1.6, 3)
    expect(x).toBeGreaterThan(3 - 2.7 * (20 / 60) - 1e-9) // never faster than 2.7 m/s: a third of a second cannot take it further than that
    for (let i = 0; i < 40; i++) x = smoothLength(x, 1.5, vel, DT, 0.08, 2.7, 0.5, 2.4, 1.6, 3)
    expect(x).toBeLessThan(1.51)
    expect(x).toBeGreaterThanOrEqual(1.5)
    // it goes away: out, never faster than 2.4 m/s, and it arrives exactly
    let worst = 0
    let frames = 0
    while (x !== 3 && frames < 600) {
      const next = smoothLength(x, 3, vel, DT, 0.08, 2.7, 0.5, 2.4, 1.6, 3)
      worst = Math.max(worst, (next - x) / DT)
      x = next
      frames++
    }
    expect(x).toBe(3)
    expect(frames).toBeLessThan(180)
    expect(worst).toBeLessThanOrEqual(2.4 + 1e-9)
    expect(vel.v).toBe(0)
  })

  it('softLimit is the identity up to the knee, bends over after it with no corner, stays under the limit and never goes down', () => {
    const knee = 0.6
    const limit = 1
    for (const x of [0, 0.2, 0.59, 0.6]) expect(softLimit(x, knee, limit)).toBe(x)
    let last = softLimit(0.6, knee, limit)
    for (let x = 0.6; x < 5; x += 0.01) {
      const y = softLimit(x, knee, limit)
      expect(y).toBeLessThan(limit)
      expect(y).toBeGreaterThanOrEqual(last - 1e-12)
      expect(y).toBeLessThanOrEqual(x + 1e-12)
      last = y
    }
    // C1 at the knee: the slope just after it is 1
    const h = 1e-4
    expect((softLimit(knee + h, knee, limit) - softLimit(knee, knee, limit)) / h).toBeGreaterThan(0.999)
  })
})

describe('W3: the follow lag is squeezed softly', () => {
  const MAX = (40 * Math.PI) / 180

  /** The camera's yaw behind a heading that turns at `rate` rad/s for `seconds`: returns the lag and the yaw rate per frame. */
  function follow(rate: number, seconds: number, dt = DT): { lag: number[]; rates: number[]; yaw: number } {
    const vel = { v: 0 }
    let heading = 0
    let yaw = 0
    const lag: number[] = []
    const rates: number[] = []
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      heading += rate * dt
      const next = followYawStep(yaw, heading, vel, 0.22, MAX, dt)
      rates.push(angleDelta(yaw, next) / dt)
      yaw = next
      lag.push(Math.abs(angleDelta(yaw, heading)))
    }
    return { lag, rates, yaw }
  }

  it('a 200 degrees a second turn (a natural lag of 44 degrees) never lags past the limit and its rate never jumps by more than 2 rad/s', () => {
    const { lag, rates } = follow(200 * DEG, 5)
    expect(Math.max(...lag)).toBeLessThanOrEqual(MAX + 1 * DEG)
    expect(Math.max(...lag)).toBeLessThan(MAX)
    let worst = 0
    for (let i = 1; i < rates.length; i++) worst = Math.max(worst, Math.abs(rates[i] - rates[i - 1]))
    expect(worst).toBeLessThan(2)
    // and it is the same smooth thing at other frame rates
    for (const fps of [30, 144]) {
      const r = follow(200 * DEG, 5, 1 / fps)
      expect(Math.max(...r.lag)).toBeLessThan(MAX)
    }
  })

  it('a lag under the knee is exactly the plain critically damped follow', () => {
    const vel = { v: 0 }
    const plain = { v: 0 }
    let a = 0
    let b = 0
    let heading = 0
    for (let i = 0; i < 120; i++) {
      heading += 90 * DEG * DT // a natural lag of 20 degrees: under the knee (24)
      a = followYawStep(a, heading, vel, 0.22, MAX, DT)
      b = dampAngle(b, heading, plain, 0.22, DT)
      expect(a).toBe(b)
    }
    expect(20 * DEG).toBeLessThan(LAG_KNEE * MAX)
  })

  it('a lag that is already bigger than the limit (a hand turn) shrinks at the spring\'s own pace, and is only kept from growing', () => {
    const vel = { v: 0 }
    let yaw = 0
    const heading = 120 * DEG
    let last = Math.abs(angleDelta(yaw, heading))
    for (let i = 0; i < 40; i++) {
      yaw = followYawStep(yaw, heading, vel, 0.22, MAX, DT)
      const lag = Math.abs(angleDelta(yaw, heading))
      expect(lag).toBeLessThanOrEqual(last + 1e-12)
      last = lag
    }
    expect(last).toBeLessThan(120 * DEG * 0.5)
  })

  it('limitFollowLag: a hitch is squeezed under the limit with no jump in the follow point\'s speed; at running speed it does not touch it', () => {
    const f = newDamped({ x: 0, y: 0, z: 0 })
    const pivot = { x: 0, y: 0, z: 0 }
    // 0.34 m of lag (a run, 0.08 s behind 4.2 m/s) is a hair over the knee at 0.3 m
    f.x = -0.34
    limitFollowLag(f, pivot, 0.5, DT)
    expect(f.x).toBeCloseTo(-0.3395, 3)
    // a teleport: far away is brought in under the limit, and the velocity gets the rate it was moved at
    f.x = -3
    f.vx = 0
    limitFollowLag(f, pivot, 0.5, DT)
    expect(Math.abs(f.x)).toBeLessThan(0.5)
    expect(f.vx).toBeGreaterThan(0)
    // within the knee nothing happens at all
    const g = newDamped({ x: -0.2, y: 0, z: 0.1 })
    limitFollowLag(g, pivot, 0.5, DT)
    expect(g.x).toBe(-0.2)
    expect(g.z).toBe(0.1)
  })
})

describe('W3: running shows in the lens and the bob', () => {
  it('runShare is 0 at a walk and below, 1 at a hurry, or the legs\' own run blend when that is more', () => {
    expect(runShare(0, 0)).toBe(0)
    expect(runShare(CONFIG.player.walkSpeed, 0)).toBe(0)
    expect(runShare(CONFIG.player.hurrySpeed, 0)).toBe(1)
    expect(runShare(0.5, 0.4)).toBe(0.4)
    expect(runShare(CONFIG.player.hurrySpeed, 0.4)).toBe(1)
    expect(runShare(3, 0)).toBeGreaterThan(0)
    expect(runShare(3, 0)).toBeLessThan(1)
  })

  it('gaitBob is lowest at a heel strike, highest between the steps, twice a cycle, and continuous across the wrap', () => {
    expect(gaitBob(0)).toBe(-1) // a left heel strike
    expect(gaitBob(0.5)).toBeCloseTo(-1, 12) // a right one
    expect(gaitBob(0.25)).toBeCloseTo(1, 12)
    expect(gaitBob(0.75)).toBeCloseTo(1, 12)
    expect(Math.abs(gaitBob(0.9999) - gaitBob(0))).toBeLessThan(1e-6)
  })
})
