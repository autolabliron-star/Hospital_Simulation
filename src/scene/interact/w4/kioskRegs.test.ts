/**
 * The health kiosks' E interactions, in node: the two stations, their labels in each state, and the real interaction system and a real Simulation
 * picking them (stand at the platform facing the tower: "E · Use health kiosk 1") and seating you on the BP stool (`sitAt`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KIOSK_UI } from '@/content/kioskUi'
import type { Interactable } from '@/scene/interact.store'
import { labelOf } from '@/scene/interact.store'
import { useWalk, walkCam } from '@/scene/player/state'
import { HEALTH_KIOSKS, PLAYER_SPAWN } from '@/sim/places'
import { Simulation } from '@/sim/Simulation'
import type { HealthKioskPhase, HealthKioskState, PlayerMode } from '@/sim/types'
import { useBubbles } from '@/scene/fx/bubbleStore'
import { useDrawerCard } from '@/ui/walk/drawerCard.store'
import { useRx } from '@/ui/walk/rx.store'
import { useToast } from '@/ui/walk/toast.store'
import { useYourOrder } from '../yourOrder.store'
import { healthCheckRegistry, type HealthCheckLike } from '../healthCheck'
import { InteractionSystem, type SystemEnv } from '../system'
import { buildKioskInteractables, KIOSK_PROMPT_RADIUS, usable, type KioskRegEnv } from './kioskRegs'

function state(index: number, phase: HealthKioskPhase = 'idle', over: Partial<HealthKioskState> = {}): HealthKioskState {
  return { index, phase, phaseTime: 0, progress: 0, kind: phase === 'idle' ? null : 'full', userId: null, userName: null, bpRound: 0, cuff: 0, reading: null, assisted: false, sessionsToday: 0, version: 0, ...over }
}

function fakeController(): HealthCheckLike & { calls: number[]; running: number; card: number } {
  const c = {
    calls: [] as number[],
    running: -1,
    card: -1,
    press: (i: number) => {
      c.calls.push(i)
    },
    runningOn: (i: number) => c.running === i,
    cardOpenFor: (i: number) => c.card === i,
  }
  return c
}

function env(kiosks: HealthKioskState[], controller: HealthCheckLike | null): KioskRegEnv {
  return { kiosks: () => kiosks, controller: () => controller }
}

const host = { sim: () => ({ meds: { occupant: () => null } }), actions: { openRx: () => undefined, openPanel: () => undefined, openDrawer: () => undefined, toast: () => undefined } }

describe('the two kiosk stations', () => {
  it('are hkiosk:0 and hkiosk:1, priority-1 stations at the platforms, 1.2 m reach', () => {
    const items = buildKioskInteractables(host, env([state(0), state(1)], fakeController()))
    expect(items.map((i) => i.id)).toEqual(['hkiosk:0', 'hkiosk:1'])
    items.forEach((it, i) => {
      expect(it.kind).toBe('station')
      expect(it.priority).toBe(1)
      expect(it.radius).toBe(KIOSK_PROMPT_RADIUS)
      expect(it.position).toEqual({ x: HEALTH_KIOSKS[i].stand.at.x, y: 0, z: HEALTH_KIOSKS[i].stand.at.z })
    })
    expect(KIOSK_PROMPT_RADIUS).toBeCloseTo(1.2, 9)
  })

  it('say "Use health kiosk n" when it is free, "Leave" while your session runs, "Close the health report" with the report open; "in use" for somebody else', () => {
    const ks = [state(0), state(1)]
    const c = fakeController()
    const [k0, k1] = buildKioskInteractables(host, env(ks, c))
    expect(labelOf(k0, false)).toBe('Use health kiosk 1')
    expect(labelOf(k1, false)).toBe('Use health kiosk 2')
    expect(k0.enabled!()).toBe(true)
    c.running = 0
    ks[0] = state(0, 'bp', { kind: 'player' })
    expect(labelOf(k0, false)).toBe('Leave health kiosk 1')
    expect(k0.enabled!()).toBe(true)
    c.running = -1
    c.card = 0
    ks[0] = state(0)
    expect(labelOf(k0, false)).toBe(KIOSK_UI.prompt.closeReport)
    expect(k0.enabled!()).toBe(true)
    // somebody else's session
    c.card = -1
    ks[1] = state(1, 'weight', { kind: 'full', userName: 'Ana Reyes' })
    expect(k1.enabled!()).toBe(false)
    expect(labelOf(k1, true)).toBe('Health kiosk 2 is in use')
  })

  it('E calls the controller; with no controller (the layer is not mounted) it does nothing', () => {
    const c = fakeController()
    const items = buildKioskInteractables(host, env([state(0), state(1)], c))
    items[1].onInteract()
    items[0].onInteract()
    expect(c.calls).toEqual([1, 0])
    const none = buildKioskInteractables(host, env([state(0), state(1)], null))
    expect(() => none[0].onInteract()).not.toThrow()
  })

  it('usable: free, or yours, or your report is open; never somebody else\'s', () => {
    const c = fakeController()
    expect(usable(undefined, c, 0)).toBe(false)
    expect(usable(state(0), c, 0)).toBe(true)
    expect(usable(state(0, 'height', { kind: 'full' }), c, 0)).toBe(false)
    expect(usable(state(0, 'height', { kind: 'player' }), c, 0)).toBe(true)
    c.card = 0
    expect(usable(state(0, 'height', { kind: 'full' }), c, 0)).toBe(true)
    expect(usable(state(0), null, 0)).toBe(true)
  })

  it('reads the host\'s live sim when no environment is given: no vitals service means no kiosks, never a crash', () => {
    const items = buildKioskInteractables(host)
    expect(items[0].enabled!()).toBe(false)
    expect(labelOf(items[0], false)).toBe('Use health kiosk 1')
    healthCheckRegistry.current = null
  })
})

// ---------------------------------------------------------------------------------------------
// With the real interaction system and a real Simulation
// ---------------------------------------------------------------------------------------------

function resetStores(): void {
  useWalk.setState({ mode: 'walk', view: 'third', prompt: null, objective: null })
  walkCam.inputBlocked = false
  useBubbles.setState({ bubbles: [] })
  useToast.getState().clear()
  useDrawerCard.getState().close()
  useYourOrder.getState().set(null)
  useRx.setState({ open: false, roomId: null })
}
beforeEach(resetStores)
afterEach(() => {
  resetStores()
  healthCheckRegistry.current = null
})

function world() {
  const sim = new Simulation(5)
  sim.addPlayer(PLAYER_SPAWN)
  const controller = fakeController()
  healthCheckRegistry.current = controller
  const items = new Map<string, Interactable>(buildKioskInteractables({ ...host, sim: () => sim as never }).map((i) => [i.id, i]))
  const clock = { now: 1000 }
  const placed: { x: number; z: number; heading: number }[] = []
  const systemEnv: SystemEnv = {
    placePlayer: (x, z, heading) => placed.push({ x, z, heading }),
    sim: () => sim,
    generation: () => 0,
    now: () => clock.now,
    items: () => items,
    overlayOpen: () => false,
    closeOverlays: () => undefined,
  }
  const system = new InteractionSystem(systemEnv)
  const frame = (seconds = 0.2): void => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
      clock.now += 1000 / 60
      system.tick(1 / 60)
    }
  }
  const place = (x: number, z: number, heading: number, mode: PlayerMode = 'walk'): void => {
    sim.movePlayer(x, z, heading, 0)
    sim.player!.mode = mode
  }
  return { sim, system, controller, frame, place, placed }
}

describe('with the real interaction system', () => {
  it('standing on the platform facing the tower, E prompts "Use health kiosk 1" and runs the controller', () => {
    const w = world()
    const s = HEALTH_KIOSKS[0].stand
    w.place(s.at.x, s.at.z, s.heading)
    w.frame()
    expect(w.system.target).toEqual({ id: 'hkiosk:0', kind: 'item', enabled: true })
    expect(useWalk.getState().prompt).toBe('E · Use health kiosk 1')
    expect(w.system.press()).toBe(true)
    expect(w.controller.calls).toEqual([0])
  })

  it('the second kiosk is its own station', () => {
    const w = world()
    const s = HEALTH_KIOSKS[1].stand
    w.place(s.at.x, s.at.z, s.heading)
    w.frame()
    expect(w.system.target?.id).toBe('hkiosk:1')
    expect(useWalk.getState().prompt).toBe('E · Use health kiosk 2')
  })

  it('walking up from the lobby (1 m north of the platform, facing it) finds the kiosk; 2 m away does not', () => {
    const w = world()
    const s = HEALTH_KIOSKS[0].stand
    w.place(s.at.x, s.at.z - 1.0, 0)
    w.frame()
    expect(w.system.target?.id).toBe('hkiosk:0')
    w.place(s.at.x, s.at.z - 2.2, 0)
    w.frame()
    expect(w.system.target?.id ?? null).not.toBe('hkiosk:0')
  })

  it('somebody else on the kiosk shows "in use" and E does nothing', () => {
    const w = world()
    const s = HEALTH_KIOSKS[0].stand
    const k = w.sim.vitals.kiosks[0]
    Object.assign(k, { phase: 'weight', kind: 'full', userId: 'x', userName: 'Ana' })
    w.place(s.at.x, s.at.z, s.heading)
    w.frame()
    expect(w.system.target).toEqual({ id: 'hkiosk:0', kind: 'item', enabled: false })
    expect(useWalk.getState().prompt).toBe('Health kiosk 1 is in use')
    expect(w.system.press()).toBe(false)
    expect(w.controller.calls).toEqual([])
    Object.assign(k, { phase: 'idle', kind: null, userId: null, userName: null })
  })
})

describe('sitAt: seating you on the BP stool', () => {
  it('claims the stool for you, seats you facing the desk with the plain seated pose, and E stands you up in front of it', () => {
    const w = world()
    const seat = w.sim.seats.byId('kioskBp:0')
    const s = HEALTH_KIOSKS[0].stand
    w.place(s.at.x, s.at.z, s.heading)
    w.frame(0.1)
    expect(w.system.sitAt(seat)).toBe(true)
    expect(w.system.seat.active?.id).toBe('kioskBp:0')
    expect(w.sim.seats.occupant('kioskBp:0')).toBe('player')
    expect(w.placed.at(-1)).toMatchObject({ x: seat.x, z: seat.z, heading: seat.heading })
    w.frame(1)
    const av = w.sim.playerAvatar!
    expect(av.anim).toBe('sit')
    expect(av.seated).toEqual({ seatId: 'kioskBp:0', pose: 'sit' })
    expect(Math.hypot(av.position.x - seat.x, av.position.z - seat.z)).toBeLessThan(0.01)
    expect(w.system.promptNow()).toBe('E · Stand up')
    // E stands you up at the stool's approach spot and gives the stool back
    expect(w.system.press()).toBe(true)
    expect(w.system.seat.active).toBeNull()
    expect(w.sim.seats.occupant('kioskBp:0')).toBeNull()
    expect(w.placed.at(-1)).toMatchObject({ x: seat.approach.x, z: seat.approach.z })
    expect(w.sim.playerAvatar!.anim).toBe('idle')
  })

  it('is refused when somebody holds the stool, and the stool is not offered as a free seat to sit on by E', () => {
    const w = world()
    const seat = w.sim.seats.byId('kioskBp:1')
    expect(w.sim.seats.claimId('kioskBp:1', 'someone')).toBe(true)
    expect(w.system.sitAt(seat)).toBe(false)
    expect(w.system.seat.active).toBeNull()
    w.sim.seats.release('kioskBp:1', 'someone')
    // standing right at the free stool, E would not sit you: it is a station seat, not a waiting seat
    w.place(seat.approach.x, seat.approach.z, Math.atan2(seat.x - seat.approach.x, seat.z - seat.approach.z))
    w.frame()
    expect(w.system.target?.kind ?? null).not.toBe('seat')
  })
})
