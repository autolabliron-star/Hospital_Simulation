/**
 * YOU at a health kiosk, in node with a fake environment: E begins the session and steps you onto the platform; each phase poses your avatar; the BP
 * stool seats you and the thermometer stands you up; the platform lifts you 5 cm; walking off, E again, standing up mid-cuff, a Jump and the service ending
 * the session all end it cleanly and leave the card as the report.
 */
import { describe, expect, it } from 'vitest'
import { KIOSK_UI } from '@/content/kioskUi'
import { getLayout } from '@/scene/building/layout'
import { PLATFORM } from '@/scene/kiosks/layout'
import { HEALTH_KIOSKS } from '@/sim/places'
import type { AnimState, Entity, HealthKioskPhase, HealthKioskState, PlayerMode, SeatSpec } from '@/sim/types'
import { CARD_FAR, GLIDE_SECONDS, HealthCheck, SIT_ARM_SECONDS, healthCheckRegistry, onPlatform, stoolId, type HealthEnv, type HealthSim } from './healthCheck'

const seats = new Map(getLayout().seats.map((s) => [s.id, s]))

function state(index: number, over: Partial<HealthKioskState> = {}): HealthKioskState {
  return { index, phase: 'idle', phaseTime: 0, progress: 0, kind: null, userId: null, userName: null, bpRound: 0, cuff: 0, reading: null, assisted: false, sessionsToday: 0, version: 0, ...over }
}

function avatar(): Entity {
  return { id: 'player', role: 'doctor', name: 'You', position: { x: -53, y: 0, z: 3 }, heading: 0, speed: 0, anim: 'idle', mood: 'neutral', emote: 'none', tier: 'near', variant: 1 }
}

interface Rig {
  sim: HealthSim & { me: { x: number; z: number; heading: number; speed: number; mode: PlayerMode } }
  env: HealthEnv
  health: HealthCheck
  log: string[]
  kiosks: HealthKioskState[]
  av: Entity
  seated: { seat: SeatSpec | null }
  card: { open: boolean; kiosk: number }
  toasts: string[]
  busy: { value: boolean }
  /** What the keys ask of your body (m/s): the player system moves you by it every frame. */
  keys: { speed: number }
  /** One frame: the player system moves you (resetting the pose it does not own), the interaction system holds your seated pose, then the controller. */
  frame(dt?: number): void
  frames(seconds: number): void
  setPhase(i: number, phase: HealthKioskPhase, over?: Partial<HealthKioskState>): void
}

function rig(): Rig {
  const kiosks = [state(0), state(1)]
  const av = avatar()
  const me = { x: -53.9, z: 3.7, heading: 0, speed: 0, mode: 'walk' as PlayerMode }
  const log: string[] = []
  const seated: Rig['seated'] = { seat: null }
  const card = { open: false, kiosk: 0 }
  const toasts: string[] = []
  const busy = { value: false }
  const keys = { speed: 0 }
  const sim: Rig['sim'] = {
    me,
    player: me,
    playerAvatar: av,
    vitals: {
      kiosks,
      beginPlayer: (i) => {
        log.push(`begin:${i}`)
        if (busy.value) return 'busy'
        kiosks[i] = state(i, { phase: 'login', kind: 'player', userId: 'player', userName: 'You' })
        return 'started'
      },
      cancelPlayer: () => {
        log.push('cancel')
        for (let i = 0; i < kiosks.length; i++) if (kiosks[i].kind === 'player') kiosks[i] = state(i)
      },
    },
    seats: {
      byId: (id) => seats.get(id)!,
      occupant: () => null,
      release: () => undefined,
    },
    movePlayer: (x, z, heading, speed) => {
      me.x = x
      me.z = z
      me.heading = heading
      me.speed = speed
      av.position.x = x
      av.position.y = 0
      av.position.z = z
      av.heading = heading
      av.speed = speed
      // the real one: a pose another system set is kept while you stand still
      if (av.anim === 'walk' || av.anim === 'idle' || speed > 0.05) av.anim = speed > 0.05 ? 'walk' : 'idle'
    },
  }
  const env: HealthEnv = {
    sim: () => sim,
    sitAt: (seat) => {
      log.push(`sit:${seat.id}`)
      seated.seat = seat
      me.x = seat.x
      me.z = seat.z
      me.heading = seat.heading
      return true
    },
    seatedOn: () => seated.seat,
    standUp: () => {
      const seat = seated.seat
      log.push('standUp')
      seated.seat = null
      av.anim = 'idle' // (SeatSession.stand)
      if (seat) sim.movePlayer(seat.approach.x, seat.approach.z, Math.atan2(seat.approach.x - seat.x, seat.approach.z - seat.z), 0)
    },
    place: (x, z, heading) => {
      log.push(`place:${x.toFixed(2)},${z.toFixed(2)}`)
      me.x = x
      me.z = z
      me.heading = heading
    },
    toast: (t) => toasts.push(t),
    card: {
      isOpen: () => card.open,
      kiosk: () => card.kiosk,
      show: (i) => {
        card.open = true
        card.kiosk = i
      },
      close: () => {
        card.open = false
      },
    },
  }
  const health = new HealthCheck(env)
  const r: Rig = {
    sim,
    env,
    health,
    log,
    kiosks,
    av,
    seated,
    card,
    toasts,
    busy,
    keys,
    frame(dt = 1 / 60) {
      // the player system: it puts you where your body is (its own idea of where you are), at the speed your keys give (0 unless you walk)
      sim.movePlayer(me.x, me.z, me.heading, keys.speed)
      if (seated.seat) {
        // the interaction system's seated pose
        av.anim = 'sit'
        av.speed = 0
      }
      health.tick(dt)
    },
    frames(seconds) {
      for (let i = 0; i < Math.round(seconds * 60); i++) r.frame()
    },
    setPhase(i, phase, over = {}) {
      const k = kiosks[i]
      Object.assign(k, { phase, phaseTime: 0, progress: 0 }, over)
    },
  }
  return r
}

const kiosk0 = HEALTH_KIOSKS[0]

describe('pressing E', () => {
  it('begins your session, opens the card and steps you onto the platform, facing the tower', () => {
    const r = rig()
    r.health.press(0)
    expect(r.log).toContain('begin:0')
    expect(r.card).toEqual({ open: true, kiosk: 0 })
    expect(r.health.runningOn(0)).toBe(true)
    expect(r.health.runningOn(1)).toBe(false)
    expect(r.health.cardOpenFor(0)).toBe(true)
    expect(r.health.cardOpenFor(1)).toBe(false)
    expect(r.log).toContain(`place:${kiosk0.stand.at.x.toFixed(2)},${kiosk0.stand.at.z.toFixed(2)}`)
    r.frames(GLIDE_SECONDS + 0.3)
    expect(Math.hypot(r.sim.me.x - kiosk0.stand.at.x, r.sim.me.z - kiosk0.stand.at.z)).toBeLessThan(1e-6)
    expect(r.sim.me.heading).toBeCloseTo(kiosk0.stand.heading, 6)
    expect(r.av.anim).toBe('finger') // login
  })

  it('does nothing but say so when the kiosk is busy', () => {
    const r = rig()
    r.busy.value = true
    r.health.press(1)
    expect(r.card.open).toBe(false)
    expect(r.health.active).toBe(false)
    expect(r.toasts).toEqual([KIOSK_UI.prompt.busyToast])
    expect(r.log).not.toContain('place')
  })

  it('does nothing in the overview', () => {
    const r = rig()
    r.sim.me.mode = 'overview'
    r.health.press(0)
    expect(r.log).toEqual([])
  })

  it('E again while it runs leaves it (the service cancels, the card closes); E with a finished report open closes the card', () => {
    const r = rig()
    r.health.press(0)
    r.frames(0.5)
    r.health.press(0)
    expect(r.log).toContain('cancel')
    expect(r.health.active).toBe(false)
    expect(r.card.open).toBe(false)
    // a finished session leaves the report open: E closes it without starting another
    r.log.length = 0
    r.card.open = true
    r.card.kiosk = 0
    r.health.press(0)
    expect(r.card.open).toBe(false)
    expect(r.log).toEqual([])
  })

  it('starting on the other kiosk moves the card to it', () => {
    const r = rig()
    r.card.open = true
    r.card.kiosk = 0
    r.health.press(1)
    expect(r.card).toEqual({ open: true, kiosk: 1 })
    expect(r.health.runningOn(1)).toBe(true)
  })
})

describe('the phases', () => {
  /** Walk a whole session in the order the service runs it, one second per phase (two for the BP and the steps that move you). */
  it('poses you for each step, seats you for the cuff, stands you up for the thermometer and lifts you 5 cm on the platform', () => {
    const r = rig()
    r.health.press(0)
    const seen: [HealthKioskPhase, AnimState][] = []
    const step = (phase: HealthKioskPhase, seconds: number, over: Partial<HealthKioskState> = {}) => {
      r.setPhase(0, phase, { kind: 'player', userId: 'player', ...over })
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        r.kiosks[0].phaseTime += 1 / 60
        r.frame()
      }
      seen.push([phase, r.av.anim])
    }
    step('login', 1.5)
    expect(r.av.position.y).toBeCloseTo(PLATFORM.h, 6) // on the platform
    step('height', 1)
    step('weight', 1)
    step('bodyFat', 1)
    step('sit', 1.5)
    expect(r.log).toContain(`sit:${stoolId(0)}`)
    expect(r.seated.seat?.id).toBe('kioskBp:0')
    expect(r.av.position.y).toBe(0) // seated on the stool: down off the platform
    step('spo2', 1)
    step('bp', 1, { bpRound: 1 })
    step('bpRest', 1, { bpRound: 1 })
    step('bp', 1, { bpRound: 2 })
    step('temp', 0.3)
    expect(r.log).toContain('standUp')
    expect(r.seated.seat).toBeNull()
    r.frames(1.2)
    step('temp', 0.1)
    step('report', 1)
    expect(seen).toEqual([
      ['login', 'finger'],
      ['height', 'idle'],
      ['weight', 'idle'],
      ['bodyFat', 'grip'],
      ['sit', 'armIn'],
      ['spo2', 'armIn'],
      ['bp', 'armIn'],
      ['bpRest', 'armIn'],
      ['bp', 'armIn'],
      ['temp', 'walk'], // stepping back onto the platform: a short walk
      ['temp', 'idle'],
      ['report', 'finger'],
    ])
    // back on the platform for the thermometer and the report, 5 cm up
    expect(Math.hypot(r.sim.me.x - kiosk0.stand.at.x, r.sim.me.z - kiosk0.stand.at.z)).toBeLessThan(1e-6)
    expect(r.av.position.y).toBeCloseTo(PLATFORM.h, 6)
    // the sit was asked once, the stand-up once
    expect(r.log.filter((l) => l.startsWith('sit:')).length).toBe(1)
    expect(r.log.filter((l) => l === 'standUp').length).toBe(1)
  })

  it('sits you first (still the plain seated pose) and puts the arm in after the glide', () => {
    const r = rig()
    r.health.press(0)
    r.frames(1)
    r.setPhase(0, 'sit', { kind: 'player', userId: 'player' })
    r.frames(0.2)
    expect(r.av.anim).toBe('sit')
    r.kiosks[0].phaseTime = SIT_ARM_SECONDS + 0.1
    r.frame()
    expect(r.av.anim).toBe('armIn')
  })

  it('when the session ends (the service sets the kiosk free) you are let go of the stool, your pose is back and the card stays as the report', () => {
    const r = rig()
    r.health.press(0)
    r.frames(1)
    r.setPhase(0, 'bp', { kind: 'player', userId: 'player', bpRound: 1 })
    r.frames(1.5)
    expect(r.seated.seat).not.toBeNull()
    r.kiosks[0] = state(0) // the service ended it
    r.frames(0.1)
    expect(r.health.active).toBe(false)
    expect(r.seated.seat).toBeNull()
    expect(r.log).toContain('standUp')
    expect(r.card.open).toBe(true)
    expect(r.log).not.toContain('cancel') // nothing to cancel: it was over
    r.frame()
    expect(['idle', 'walk']).toContain(r.av.anim)
  })

  it('a session that never shows a phase is let go of after a moment (the service refused it)', () => {
    const r = rig()
    r.health.press(0)
    r.kiosks[0] = state(0) // beginPlayer said started but nothing runs
    r.frames(2)
    expect(r.health.active).toBe(false)
  })
})

describe('leaving', () => {
  it('standing up from the stool in the middle of the cuff (E or a move key) cancels the session', () => {
    const r = rig()
    r.health.press(0)
    r.frames(1)
    r.setPhase(0, 'bp', { kind: 'player', userId: 'player', bpRound: 1 })
    r.frames(1)
    expect(r.seated.seat).not.toBeNull()
    r.env.standUp() // the interaction system: E or a move key
    r.frames(0.1)
    expect(r.log).toContain('cancel')
    expect(r.health.active).toBe(false)
    expect(r.card.open).toBe(true) // the partial slip stays
  })

  it('walking away from the platform ends it (after the grace, beyond 1.5 m)', () => {
    const r = rig()
    r.health.press(0)
    r.setPhase(0, 'weight', { kind: 'player', userId: 'player' })
    r.frames(3)
    expect(r.health.active).toBe(true)
    r.sim.me.x = kiosk0.stand.at.x - 2
    r.sim.me.z = kiosk0.stand.at.z - 1.5
    r.keys.speed = 2
    r.frames(0.2)
    expect(r.log).toContain('cancel')
    expect(r.health.active).toBe(false)
  })

  it('walking a step on the platform does not end it, and leaves the pose to the player system while you move', () => {
    const r = rig()
    r.health.press(0)
    r.setPhase(0, 'bodyFat', { kind: 'player', userId: 'player' })
    r.frames(3)
    expect(r.av.anim).toBe('grip')
    r.sim.me.x += 0.3
    r.keys.speed = 1.5
    r.frame()
    expect(r.av.anim).toBe('walk')
    r.keys.speed = 0
    r.frame()
    expect(r.av.anim).toBe('grip')
    expect(r.health.active).toBe(true)
  })

  it('leaving walk mode ends it', () => {
    const r = rig()
    r.health.press(0)
    r.setPhase(0, 'height', { kind: 'player', userId: 'player' })
    r.frames(1)
    r.sim.me.mode = 'toOverview'
    r.frame()
    expect(r.log).toContain('cancel')
    expect(r.card.open).toBe(false) // the overview has no cards
  })

  it('a Jump (a new hospital) forgets the session and closes the card', () => {
    const r = rig()
    r.health.press(0)
    r.frames(1)
    const other = rig()
    ;(r.env as { sim: () => HealthSim }).sim = () => other.sim
    r.health.tick(1 / 60)
    expect(r.health.active).toBe(false)
    expect(r.card.open).toBe(false)
    expect(r.health.y).toBe(0)
  })

  it('the card closes by itself once you are well away from the kiosk', () => {
    const r = rig()
    r.card.open = true
    r.card.kiosk = 0
    r.sim.me.x = kiosk0.stand.at.x
    r.sim.me.z = kiosk0.stand.at.z - (CARD_FAR - 0.5)
    r.frame()
    expect(r.card.open).toBe(true)
    r.sim.me.z = kiosk0.stand.at.z - (CARD_FAR + 0.5)
    r.frame()
    expect(r.card.open).toBe(false)
  })
})

describe('the weighing platform', () => {
  it('lifts you 5 cm when you step on it, even without a session, and lets you down when you step off', () => {
    const r = rig()
    r.sim.me.x = kiosk0.stand.at.x
    r.sim.me.z = kiosk0.stand.at.z
    expect(onPlatform(r.sim.me.x, r.sim.me.z)).toBe(true)
    let last = 0
    for (let i = 0; i < 12; i++) {
      r.frame()
      expect(r.av.position.y).toBeGreaterThanOrEqual(last)
      last = r.av.position.y
    }
    expect(last).toBeGreaterThan(0)
    expect(last).toBeLessThan(PLATFORM.h)
    r.frames(0.6)
    expect(r.av.position.y).toBeCloseTo(PLATFORM.h, 9)
    r.sim.me.z -= 1
    r.frames(0.6)
    expect(r.av.position.y).toBe(0)
  })

  it('is exactly the platform: 0.50 x 0.46 around each stand spot', () => {
    for (const k of HEALTH_KIOSKS) {
      expect(onPlatform(k.stand.at.x, k.stand.at.z)).toBe(true)
      expect(onPlatform(k.stand.at.x + PLATFORM.w / 2 - 0.01, k.stand.at.z + PLATFORM.d / 2 - 0.01)).toBe(true)
      expect(onPlatform(k.stand.at.x + PLATFORM.w / 2 + 0.01, k.stand.at.z)).toBe(false)
      expect(onPlatform(k.stand.at.x, k.stand.at.z - PLATFORM.d / 2 - 0.01)).toBe(false)
    }
    expect(onPlatform(0, 0)).toBe(false)
  })

  it('while you sit on the stool you are on the floor', () => {
    const r = rig()
    r.sim.me.x = kiosk0.stand.at.x
    r.sim.me.z = kiosk0.stand.at.z
    r.frames(1)
    expect(r.av.position.y).toBeCloseTo(PLATFORM.h, 9)
    r.seated.seat = seats.get('kioskBp:0')!
    r.frames(1)
    expect(r.av.position.y).toBe(0)
  })
})

describe('the registry', () => {
  it('holds no controller until the kiosk layer registers one', () => {
    expect(healthCheckRegistry.current).toBeNull()
  })
})
