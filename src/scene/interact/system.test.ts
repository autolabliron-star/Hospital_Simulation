import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBubbles } from '@/scene/fx/bubbleStore'
import type { Interactable } from '@/scene/interact.store'
import { useWalk, walkCam } from '@/scene/player/state'
import { PLAYER_SPAWN, ROOMS, roomById } from '@/sim/places'
import { Simulation } from '@/sim/Simulation'
import type { PlayerMode } from '@/sim/types'
import { useDrawerCard } from '@/ui/walk/drawerCard.store'
import { useRx } from '@/ui/walk/rx.store'
import { useToast } from '@/ui/walk/toast.store'
import type { WalkActions } from './actions'
import { PROMPT_EVERY_MS, DRAWER_CARD_FAR, InteractionSystem, type SystemEnv } from './system'
import { buildWalkInteractables } from './registrations'
import { sittableSeats } from './picker'
import { useYourOrder } from './yourOrder.store'

interface Rig {
  placed: { x: number; z: number; heading: number }[]
  sim: Simulation
  system: InteractionSystem
  calls: string[]
  clock: { now: number }
  flags: { overlay: boolean; generation: number; closed: number }
  frame(seconds?: number): void
  place(x: number, z: number, heading: number, mode?: PlayerMode): void
  swap(next: Simulation): void
}

/** A real Simulation with you in it, the real registrations on fake actions, a fake clock and fake overlays. */
function rig(seed = 5): Rig {
  let sim = new Simulation(seed)
  sim.addPlayer(PLAYER_SPAWN)
  const calls: string[] = []
  const actions: WalkActions = {
    openRx: (r) => calls.push(`rx:${r}`),
    openPanel: (a) => calls.push(`panel:${a}`),
    openDrawer: (r) => {
      calls.push(`drawer:${r}`)
      useDrawerCard.getState().show(r)
    },
    toast: (t) => calls.push(`toast:${t}`),
  }
  const items = new Map<string, Interactable>(buildWalkInteractables({ sim: () => sim, actions }).map((i) => [i.id, i]))
  const clock = { now: 1000 }
  const flags = { overlay: false, generation: 0, closed: 0 }
  const placed: Rig['placed'] = []
  const env: SystemEnv = {
    placePlayer: (x, z, heading) => placed.push({ x, z, heading }),
    sim: () => sim,
    generation: () => flags.generation,
    now: () => clock.now,
    items: () => items,
    overlayOpen: () => flags.overlay,
    closeOverlays: () => {
      flags.closed++
    },
  }
  const system = new InteractionSystem(env)
  return {
    placed,
    get sim() {
      return sim
    },
    system,
    calls,
    clock,
    flags,
    frame(seconds = 0.2) {
      // 60 Hz frames over `seconds`, with the clock moving along
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
        clock.now += 1000 / 60
        system.tick(1 / 60)
      }
    },
    place(x, z, heading, mode = 'walk') {
      sim.movePlayer(x, z, heading, 0)
      sim.player!.mode = mode
    },
    swap(next) {
      sim = next
      flags.generation++
    },
  }
}

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
afterEach(resetStores)

/** Somebody lies in this ward-A room (the bed board's answer). */
function occupiedRoom(sim: Simulation): string {
  const room = ROOMS.find((r) => sim.meds.occupant(r.id) !== null)
  if (!room) throw new Error('no occupied room')
  return room.id
}

/** Stand at a free seat's approach spot, facing it, choosing one where it is what E would use (not a nearer station or person). */
function faceASeat(r: Rig) {
  for (const seat of r.sim.seats.free({ kind: ['waiting', 'cafe', 'lounge', 'bench'] })) {
    r.place(seat.approach.x, seat.approach.z, Math.atan2(seat.x - seat.approach.x, seat.z - seat.approach.z))
    r.frame(0.1)
    if (r.system.target?.id === seat.id) return seat
  }
  throw new Error('no free seat is what E would use anywhere in the building')
}

describe('the bedside', () => {
  it('prompts "E · Prescribe for <patient>" when you face the bed, and E opens the tablet on that room', () => {
    const r = rig()
    const id = occupiedRoom(r.sim)
    const room = roomById(id)
    r.place(room.bedside.x, room.bedside.z, room.bedsideHeading)
    r.frame()
    expect(r.system.target).toEqual({ id: `bedside:${id}`, kind: 'item', enabled: true })
    expect(useWalk.getState().prompt).toBe(`E · Prescribe for ${r.sim.meds.occupant(id)!.name}`)
    expect(r.system.press()).toBe(true)
    expect(r.calls).toEqual([`rx:${id}`])
  })

  it('shows nothing when you face away from the bed', () => {
    const r = rig()
    const room = roomById(occupiedRoom(r.sim))
    r.place(room.bedside.x, room.bedside.z, room.bedsideHeading + Math.PI)
    r.frame()
    expect(r.system.target?.id ?? null).not.toBe(`bedside:${room.id}`)
    expect(useWalk.getState().prompt ?? '').not.toMatch(/Prescribe/)
  })

  it('says so, with no key, at a bed with nobody in it, and E does nothing', () => {
    const r = rig()
    // empty the bed of the first occupied room (the bed board answers "nobody")
    const emptyId = occupiedRoom(r.sim)
    const asked = r.sim.meds.occupant.bind(r.sim.meds)
    r.sim.meds.occupant = (id) => (id === emptyId ? null : asked(id))
    const empty = roomById(emptyId)
    r.place(empty.bedside.x, empty.bedside.z, empty.bedsideHeading)
    r.frame()
    expect(useWalk.getState().prompt).toBe(`${empty.id} has no patient right now`)
    expect(r.system.press()).toBe(false)
    expect(r.calls).toEqual([])
  })
})

describe('the drawer', () => {
  it('opens its card from the corridor, and the card closes when you walk away', () => {
    const r = rig()
    const room = roomById(occupiedRoom(r.sim))
    // on the corridor centre line, facing the wall with the drawer
    const towardsWall = room.ward === 'A' ? Math.PI : 0
    r.place(room.drawer.x, room.doorOutside.z, towardsWall)
    r.frame()
    expect(r.system.target?.id).toBe(`drawer:${room.id}`)
    expect(useWalk.getState().prompt).toBe(`E · See what is in ${room.id}'s drawer`)
    r.system.press()
    expect(useDrawerCard.getState().roomId).toBe(room.id)
    r.frame(0.1)
    expect(useDrawerCard.getState().roomId).toBe(room.id)
    r.place(room.drawer.x + DRAWER_CARD_FAR + 1, room.doorOutside.z, towardsWall)
    r.frame(0.1)
    expect(useDrawerCard.getState().roomId).toBeNull()
  })
})

describe('talking', () => {
  /** Stand 1.2 m from somebody, facing them, until a place is found where they are what E would use. */
  function faceSomeone(r: Rig): string {
    r.sim.step(1 / 60)
    for (let i = 0; i < 400; i++) r.sim.step(1 / 60)
    for (const e of r.sim.entities.values()) {
      if (e.id === 'player' || e.position.z < -12 || e.position.z > 12 || (e.fade ?? 1) < 1 || e.riding) continue
      // a point 1.2 m away on the side where nobody else stands, and look at them
      for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
        const x = e.position.x + dx
        const z = e.position.z + dz
        r.place(x, z, Math.atan2(-dx, -dz))
        r.frame(0.1)
        if (r.system.target?.kind === 'person' && r.system.target.id === e.id) return e.id
      }
    }
    throw new Error('found nobody to face')
  }

  it('prompts "E · Talk to <name>" and shows their line over their head', () => {
    const r = rig()
    const id = faceSomeone(r)
    const e = r.sim.entities.get(id)!
    expect(useWalk.getState().prompt).toBe(`E · Talk to ${e.name}`)
    r.sim.reactions.talkTo = (who) => (who === id ? 'Results are back for bay 3' : null)
    r.system.press()
    const bubble = useBubbles.getState().bubbles.find((b) => b.entityId === id)
    expect(bubble?.text).toBe('Results are back for bay 3')
  })

  it('shows a soft "busy" toast when they cannot talk (the reactions have no line)', () => {
    const r = rig()
    const id = faceSomeone(r)
    r.sim.reactions.talkTo = () => null
    r.system.press()
    expect(useToast.getState().text).toBe(`${r.sim.entities.get(id)!.name} is busy right now.`)
    expect(useBubbles.getState().bubbles.find((b) => b.entityId === id)).toBeUndefined()
  })

  it('shows a line said a moment ago as a toast, because a bubble would repeat it', () => {
    const r = rig()
    const id = faceSomeone(r)
    r.sim.reactions.talkTo = () => 'Lunch is lentil soup today'
    r.system.press()
    // keep standing there and talk again: the same line inside 60 s is not shown twice as a bubble
    r.frame(0.2)
    r.system.press()
    expect(useToast.getState().text).toBe(`${r.sim.entities.get(id)!.name}: Lunch is lentil soup today`)
  })
})

describe('the speech lines the hospital wants shown', () => {
  it('are drained every frame and shown over the right head', () => {
    const r = rig()
    const queued: [string, string][] = [['nurse-1', 'Morning, Doctor']]
    r.sim.reactions.drainBubbles = (cb) => {
      for (const [id, text] of queued.splice(0)) cb(id, text)
    }
    r.frame(0.05)
    expect(useBubbles.getState().bubbles.map((b) => [b.entityId, b.text])).toEqual([['nurse-1', 'Morning, Doctor']])
    expect(queued).toEqual([])
  })
})

describe('free seats', () => {

  it('offers "E · Sit down", sits you down on E, and stands you up on E or a move key', () => {
    const r = rig()
    const seat = faceASeat(r)
    expect(useWalk.getState().prompt).toBe('E · Sit down')
    r.system.press()
    r.frame(0.7)
    // the player system is told to follow you onto the seat, so the camera does not look at an empty spot
    expect(r.placed.at(-1)).toEqual({ x: seat.x, z: seat.z, heading: seat.heading })
    expect(r.sim.seats.occupant(seat.id)).toBe('player')
    expect(r.sim.playerAvatar!.anim).toBe('sit')
    // sitting does not take your keyboard: the move key that stands you up must reach the player system, and you can look around
    expect(walkCam.inputBlocked).toBe(false)
    expect(useWalk.getState().prompt).toBe('E · Stand up')
    r.system.standUp()
    r.frame(0.2)
    // ... and back in front of the seat when you stand, so you do not pop back to where you stood
    expect(r.placed.at(-1)).toMatchObject({ x: seat.approach.x, z: seat.approach.z })
    expect(r.sim.seats.occupant(seat.id)).toBeNull()
    expect(r.sim.playerAvatar!.anim).toBe('idle')
    expect(walkCam.inputBlocked).toBe(false)
  })

  it('E while seated stands you up', () => {
    const r = rig()
    const seat = faceASeat(r)
    r.system.press()
    r.frame(0.7)
    expect(r.system.press()).toBe(true)
    expect(r.sim.seats.occupant(seat.id)).toBeNull()
  })

  it('stands you up when you leave walk mode (Tab)', () => {
    const r = rig()
    const seat = faceASeat(r)
    r.system.press()
    r.frame(0.7)
    r.sim.player!.mode = 'toOverview'
    r.frame(0.1)
    expect(r.sim.seats.occupant(seat.id)).toBeNull()
  })

  it('is told "somebody just took that seat" when another claims it first', () => {
    const r = rig()
    const seat = faceASeat(r)
    r.sim.seats.claimId(seat.id, 'quick-visitor')
    r.system.press()
    expect(useToast.getState().text).toBe('Somebody just took that seat.')
    expect(r.system.seat.active).toBeNull()
  })

  it('has free seats of the right kinds to offer in the real building', () => {
    const r = rig()
    expect(sittableSeats(r.sim.seats.all).some((s) => r.sim.seats.occupant(s.id) === null)).toBe(true)
  })
})

describe('when nothing should happen', () => {
  it('shows nothing in the overview, and E does nothing there', () => {
    const r = rig()
    const room = roomById(occupiedRoom(r.sim))
    r.place(room.bedside.x, room.bedside.z, room.bedsideHeading, 'overview')
    r.frame()
    expect(r.system.target).toBeNull()
    expect(useWalk.getState().prompt).toBeNull()
    expect(r.system.press()).toBe(false)
  })

  it('shows nothing and does nothing while an overlay is open, and blocks your input', () => {
    const r = rig()
    const room = roomById(occupiedRoom(r.sim))
    r.place(room.bedside.x, room.bedside.z, room.bedsideHeading)
    r.frame()
    expect(useWalk.getState().prompt).not.toBeNull()
    r.flags.overlay = true
    r.frame(0.2)
    expect(r.system.target).toBeNull()
    expect(useWalk.getState().prompt).toBeNull()
    expect(walkCam.inputBlocked).toBe(true)
    expect(r.system.press()).toBe(false)
    r.flags.overlay = false
    r.frame(0.2)
    expect(walkCam.inputBlocked).toBe(false)
    expect(useWalk.getState().prompt).not.toBeNull()
  })

  it('does not run an action in the middle of the flight between walk and overview', () => {
    const r = rig()
    const room = roomById(occupiedRoom(r.sim))
    r.place(room.bedside.x, room.bedside.z, room.bedsideHeading, 'toWalk')
    r.frame()
    expect(r.system.target).toBeNull()
    expect(r.system.press()).toBe(false)
  })

  it('has no player to act for before you are in the hospital', () => {
    const r = rig()
    r.sim.removePlayer()
    r.frame(0.3)
    expect(r.system.target).toBeNull()
    expect(r.system.press()).toBe(false)
    expect(useWalk.getState().prompt).toBeNull()
  })
})

describe('the prompt rate', () => {
  it('is written at most ten times a second however often the target changes', () => {
    const r = rig()
    let writes = 0
    const unsub = useWalk.subscribe((s, prev) => {
      if (s.prompt !== prev.prompt) writes++
    })
    // walk along the corridor of ward A, past a drawer and a door per room, for 4 seconds at 60 Hz
    const z = roomById('A1').doorOutside.z
    let x = -26
    r.sim.player!.mode = 'walk'
    for (let i = 0; i < 240; i++) {
      x += 0.05
      r.sim.movePlayer(x, z, Math.PI, 1.5)
      r.clock.now += 1000 / 60
      r.system.tick(1 / 60)
    }
    unsub()
    expect(writes).toBeGreaterThan(0)
    expect(writes).toBeLessThanOrEqual(Math.ceil((4000 / PROMPT_EVERY_MS) * 1.05))
  })
})

describe('your order', () => {
  it('sets the objective line from the order you prescribed, and the HUD store gets the same view', () => {
    const r = rig()
    const id = occupiedRoom(r.sim)
    r.frame(0.3)
    expect(useWalk.getState().objective).toBeNull()
    const res = r.sim.prescribe(id, [{ medId: 'salbutamol', qty: 1 }])
    expect(res.ok).toBe(true)
    r.frame(0.5)
    expect(useWalk.getState().objective).toBe(`Pharmacist Noa is checking your order for ${id}`.replace('Noa', roomById(id).ward === 'A' ? 'Noa' : 'Ravi'))
    expect(useYourOrder.getState().view).toMatchObject({ roomId: id, stage: 'prescribed' })
  })

  it('is forgotten with the prompt after a Jump (the new hospital has none of your orders)', () => {
    const r = rig()
    const id = occupiedRoom(r.sim)
    const room = roomById(id)
    r.place(room.bedside.x, room.bedside.z, room.bedsideHeading)
    r.sim.prescribe(id, [{ medId: 'salbutamol', qty: 1 }])
    r.frame(0.5)
    expect(useWalk.getState().objective).not.toBeNull()
    expect(useWalk.getState().prompt).not.toBeNull()

    const next = new Simulation(5)
    next.addPlayer({ at: { x: 0, z: -14 }, heading: 0 })
    next.player!.mode = 'walk'
    r.swap(next)
    r.frame(0.2)
    expect(useWalk.getState().objective).toBeNull()
    expect(useWalk.getState().prompt).toBeNull()
    expect(useYourOrder.getState().view).toBeNull()
    expect(r.system.order.current()).toBeNull()
  })

  it('lets go of your seat after a Jump', () => {
    const r = rig()
    const seat = faceASeat(r)
    r.system.press()
    r.frame(0.7)
    expect(r.system.seat.active).not.toBeNull()
    const next = new Simulation(5)
    next.addPlayer({ at: seat.approach, heading: 0 })
    next.player!.mode = 'walk'
    r.swap(next)
    r.frame(0.2)
    expect(r.system.seat.active).toBeNull()
    expect(walkCam.inputBlocked).toBe(false)
    expect(next.playerAvatar!.anim).not.toBe('sit')
  })
})

describe('the tablet in your hand', () => {
  it('draws you with the tablet out while the prescribing panel is open, and puts it away after', () => {
    const r = rig()
    r.frame(0.1)
    expect(r.sim.playerAvatar!.anim).not.toBe('tablet')
    useRx.setState({ open: true })
    r.frame(0.1)
    expect(r.sim.playerAvatar!.anim).toBe('tablet')
    // the player system writes idle over it every frame; ours goes back on top
    r.sim.movePlayer(r.sim.player!.x, r.sim.player!.z, 0, 0)
    r.frame(0.05)
    expect(r.sim.playerAvatar!.anim).toBe('tablet')
    useRx.setState({ open: false })
    r.frame(0.1)
    expect(r.sim.playerAvatar!.anim).toBe('idle')
  })

  it('does not take you out of a seat for it', () => {
    const r = rig()
    const seat = faceASeat(r)
    r.system.press()
    r.frame(0.7)
    useRx.setState({ open: true })
    r.frame(0.1)
    expect(r.sim.playerAvatar!.anim).toBe('sit')
    expect(r.sim.seats.occupant(seat.id)).toBe('player')
  })
})

describe('walk mode takes over from the overview', () => {
  it("closes the overview's panels when you start walking, once", () => {
    const r = rig()
    r.place(PLAYER_SPAWN.at.x, PLAYER_SPAWN.at.z, PLAYER_SPAWN.heading, 'overview')
    r.frame(0.2)
    const before = r.flags.closed
    r.sim.player!.mode = 'toWalk'
    r.frame(0.2)
    r.sim.player!.mode = 'walk'
    r.frame(0.2)
    expect(r.flags.closed).toBe(before + 1)
  })
})
