/**
 * The meal service (L1): MealBots, ward hosts, trays, the recline, warm starts and determinism. Node tests, each over a
 * window of at most 2 h of sim time; the whole file runs in about half a minute.
 *
 * The bed-flow builder moves patients out of beds during the day, so these tests ask "a room whose patient stayed in bed
 * through the window must have been served, and its tray collected" rather than "every room" (`RoomTracker`).
 */
import { describe, expect, it } from 'vitest'
import { fillDayTemplate } from '@/content/day'
import { dishesFor } from '@/content/meals'
import { CONFIG } from '../config'
import { tryPlanRoute } from '../nav/graph'
import { isWalkable } from '../nav/layout'
import { inDoorway } from '../er/spots'
import { MEAL_STOPS, ROOMS, SERVICE_LIFT, roomById } from '../places'
import { Simulation } from '../Simulation'
import type { MealKind, RoomId, SimEvent, WardId } from '../types'
import { MEAL_WINDOWS, STOPS_OF, dishFor, hostSpot, liftHostSpot } from './plan'
import { DT, RoomTracker, Watch, hourT, runWatched } from './testkit'

const mealEvents = (sim: Simulation, type: 'mealServed' | 'trayCollected'): SimEvent[] => sim.log.events.filter((e) => e.type === type)
const roomsOf = (events: SimEvent[]): string[] => events.map((e) => e.roomId!).sort()
const windowOf = (meal: MealKind) => MEAL_WINDOWS.find((w) => w.meal === meal)!
const ROOM_IDS: RoomId[] = ROOMS.map((r) => r.id)
const inBed = (sim: Simulation): RoomId[] =>
  [...sim.life.rooms.values()].filter((r) => (r.bed === 'occupied' || r.bed === 'dischargeSigned') && r.patientId !== null).map((r) => r.roomId).sort()
const trays = (sim: Simulation) => [...sim.life.rooms.values()].filter((r) => r.meal !== 'none')
const hosts = (sim: Simulation) => sim.people.filter((p) => p.entity.role === 'host')
const botsOnFloor = (sim: Simulation) => sim.meals.units.filter((u) => u.onDuty)

describe('meal service: places and routes', () => {
  it('every bot and host route exists, and the host spots are clear', () => {
    for (const ward of ['A', 'B'] as WardId[]) {
      const lift = SERVICE_LIFT[ward].at
      const hostLift = liftHostSpot(ward).at
      expect(isWalkable(lift.x, lift.z, 0.25), `${ward} lift bot spot`).toBe(true)
      expect(isWalkable(hostLift.x, hostLift.z, 0.25), `${ward} lift host spot`).toBe(true)
      expect(tryPlanRoute(hostLift, STOPS_OF[ward][0].at)).not.toBeNull()
      for (const stop of STOPS_OF[ward]) {
        expect(tryPlanRoute(lift, stop.at), `${stop.id} from the lift`).not.toBeNull()
        expect(tryPlanRoute(stop.at, lift), `${stop.id} to the lift`).not.toBeNull()
        const spot = hostSpot(stop, { x: 0, z: 0 })
        expect(isWalkable(spot.x, spot.z, 0.25), `${stop.id} host spot walkable`).toBe(true)
        expect(inDoorway(spot.x, spot.z, 0.1), `${stop.id} host spot is not in a doorway`).toBe(false)
        for (const id of stop.rooms) {
          const room = roomById(id)
          expect(tryPlanRoute(spot, room.bedside), `${stop.id} host to ${id}`).not.toBeNull()
          expect(tryPlanRoute(room.bedside, spot), `${id} back to ${stop.id}`).not.toBeNull()
        }
      }
    }
  })

  it("the dish a patient chose is stable and comes from the meal's menu", () => {
    for (const w of MEAL_WINDOWS) {
      const menu = dishesFor(w.meal).map((d) => d.name)
      const seen = new Set<string>()
      for (const id of ROOM_IDS) {
        const a = dishFor(7, w.meal, `patient-${id}`)
        expect(menu).toContain(a.name)
        expect(dishFor(7, w.meal, `patient-${id}`).name).toBe(a.name)
        seen.add(a.name)
      }
      expect(seen.size).toBeGreaterThan(2)
    }
  })

  it('has a window for each meal, in order', () => {
    expect(MEAL_WINDOWS.map((w) => w.meal)).toEqual(['breakfast', 'lunch', 'dinner'] satisfies MealKind[])
  })
})

describe('meal service: lunch from a warm start', () => {
  const sim = new Simulation(2026, { startHour: 12, population: false })
  const lunch = windowOf('lunch')
  const tracker = new RoomTracker(sim, hourT(lunch.start), hourT(lunch.end))
  const watch = new Watch(sim)
  const reclineMax = new Map<RoomId, number>()
  const version0 = new Map<RoomId, number>()
  for (const r of sim.life.rooms.values()) version0.set(r.roomId, r.version)
  const eaten = new Set<RoomId>()
  const seen = { tray: false, carryPose: false, mealEmote: false, hostInRoom: false, doorOpen: false, peach: false, white: false, sawStates: new Set<string>() }
  let simMs = 0
  let n = 0

  it('serves every room whose patient stayed in bed, inside the window, and takes every tray away', () => {
    const t0 = performance.now()
    runWatched(sim, 3600, watch, () => {
      tracker.sample()
      if (++n % 20 === 0) {
        for (const p of sim.people) {
          if (p.entity.role === 'host') {
            if (p.entity.prop === 'tray') seen.tray = true
            if (p.entity.prop === 'tray' && p.entity.anim === 'carry') seen.carryPose = true
            if (p.entity.roomId) seen.hostInRoom = true
          } else if (p.entity.role === 'patient' && p.entity.emote === 'meal') seen.mealEmote = true
        }
        for (const u of sim.meals.units) {
          if (!u.onDuty) continue
          seen.sawStates.add(u.bot.state)
          if (u.bot.door >= 1) seen.doorOpen = true
          if (u.bot.light === 'peach') seen.peach = true
          if (u.bot.light === 'white') seen.white = true
        }
      }
      for (const r of sim.life.rooms.values()) {
        reclineMax.set(r.roomId, Math.max(reclineMax.get(r.roomId) ?? 0, r.recline))
        if (r.meal === 'eaten') eaten.add(r.roomId)
      }
    })
    simMs = performance.now() - t0

    const served = mealEvents(sim, 'mealServed')
    const collected = mealEvents(sim, 'trayCollected')
    const servedRooms = roomsOf(served)
    const always = tracker.alwaysOccupied()
    expect(always.length).toBeGreaterThanOrEqual(12)
    for (const id of always) expect(servedRooms, `${id} was in bed all through lunch`).toContain(id)
    expect(new Set(servedRooms).size, 'each room is served at most once').toBe(servedRooms.length)
    for (const e of served) {
      expect(e.t, `${e.roomId} served inside the window`).toBeGreaterThanOrEqual(hourT(lunch.start))
      expect(e.t, `${e.roomId} served inside the window`).toBeLessThanOrEqual(hourT(lunch.end))
      expect(e.text).toMatch(/^Host (Ilona|Caspian) served .+ in [AB][1-8]\.$/)
      const dish = sim.meals.chosenDish('lunch', e.roomId!)
      if (dish) expect(e.text).toBe(fillDayTemplate('mealServed', { host: e.text.split(' served')[0], dish: dish.name, room: e.roomId! }))
      const later = collected.find((c) => c.roomId === e.roomId)
      if (later) {
        expect(later.t - e.t, `${e.roomId}: the tray is collected after the patient has eaten`).toBeGreaterThanOrEqual(CONFIG.meals.eatSeconds[0])
        expect(later.text).toBe(fillDayTemplate('trayCollected', { host: e.text.split(' served')[0], room: e.roomId! }))
      } else expect(tracker.vacatedSince(e.roomId!, e.t), `${e.roomId}: no tray collected, so the patient left first`).toBe(true)
    }
    // nothing is left behind
    for (const r of sim.life.rooms.values()) {
      expect(r.meal, `${r.roomId} meal`).toBe('none')
      if (r.bed === 'occupied') expect(r.recline, `${r.roomId} recline`).toBe(0)
    }
    expect(sim.meals.units.every((u) => !u.onDuty && u.bot.state === 'offsite' && u.bot.fade === 0 && u.bot.trays === 0)).toBe(true)
    expect(hosts(sim)).toHaveLength(0)
    expect(sim.entities.has('host-A') || sim.entities.has('host-B')).toBe(false)
    // each patient who was served was reclined to the full and (unless they left first) finished eating
    for (const id of always) {
      expect(reclineMax.get(id), `${id} recline`).toBe(1)
      expect(eaten.has(id) || tracker.vacatedSince(id, hourT(lunch.start)), `${id} eaten`).toBe(true)
    }
    // what the renderers need to show: the tray in the host's hand, the meal emote, the cabinet door, the light ring, every state
    expect(seen.tray && seen.carryPose, 'a host carried a tray').toBe(true)
    expect(seen.hostInRoom, 'a host worked inside a room').toBe(true)
    expect(seen.mealEmote, 'a patient got the meal emote').toBe(true)
    expect(seen.doorOpen, 'the cabinet door opened').toBe(true)
    expect(seen.peach && seen.white, 'peach while carrying, white when empty').toBe(true)
    expect([...seen.sawStates].sort()).toEqual(['collecting', 'returning', 'serving', 'toWard'])
    // the screens redraw a handful of times per meal, not 60 times a second
    for (const r of sim.life.rooms.values()) expect(r.version - version0.get(r.roomId)!, `${r.roomId} version bumps`).toBeLessThanOrEqual(16)
  }, 120_000)

  it('keeps the bots and hosts out of trouble', () => {
    expect(watch.problems).toEqual([])
    expect(watch.maxBots).toBe(2)
    expect(watch.maxHosts).toBe(2)
    expect(watch.hostSamples).toBeGreaterThan(1000)
    expect(watch.minPersonDistance, watch.minPersonWho).toBeGreaterThanOrEqual(0.4)
    // (a host may wait a moment at a single-file door; a bot never stops in a doorway)
    expect(watch.longestStill, watch.longestStillWho).toBeLessThanOrEqual(3)
  })

  it('has the contract number of bots, and the sim stays cheap with them on the floor', () => {
    expect(sim.life.mealBots.size).toBe(CONFIG.meals.botsPerWard * 2 + CONFIG.meals.spareBots)
    const us = (simMs * 1000) / (3600 / DT)
    console.log(`[meals] 12:00-13:00, ward staff only: ${us.toFixed(1)} us per sim step`)
    expect(us).toBeLessThan(300)
  })
})

describe('meal service: a patient who comes to a bed during the window', () => {
  it('still gets the meal, and the tray is collected', () => {
    const sim = new Simulation(31, { startHour: 12, population: false })
    // A6 is empty when the bot comes round, and gets its patient (an admission) twelve minutes later
    const room = sim.life.rooms.get('A6')!
    room.bed = 'ready'
    room.patientId = null
    room.patientName = null
    const tracker = new RoomTracker(sim, hourT(12), hourT(12.75))
    while (sim.t < hourT(12) + 12 * 60) {
      sim.step(DT)
      tracker.sample()
    }
    expect(mealEvents(sim, 'mealServed').some((e) => e.roomId === 'A6')).toBe(false)
    expect(botsOnFloor(sim).length + hosts(sim).length, 'the first round is over').toBe(0)
    room.bed = 'occupied'
    room.patientId = 'pt-late'
    room.patientName = 'Late Patient'
    room.version++
    while (sim.t < hourT(13)) {
      sim.step(DT)
      tracker.sample()
    }
    const served = mealEvents(sim, 'mealServed').find((e) => e.roomId === 'A6')
    expect(served, 'the late patient was served').toBeDefined()
    expect(served!.t).toBeLessThan(hourT(12.75))
    expect(served!.t).toBeGreaterThan(hourT(12) + 12 * 60)
    expect(mealEvents(sim, 'trayCollected').some((e) => e.roomId === 'A6' && e.t > served!.t)).toBe(true)
    for (const r of sim.life.rooms.values()) expect(r.meal, r.roomId).toBe('none')
    expect(botsOnFloor(sim)).toHaveLength(0)
  }, 60_000)
})

describe('meal service: warm starts', () => {
  it('12:00 shows the lunch run starting; 12:05 mid-run; 12:40 trays on tables; 15:00 quiet', () => {
    const start = new Simulation(5, { startHour: 12, population: false })
    start.preRoll(60)
    start.sync(1)
    const onDuty = botsOnFloor(start)
    expect(onDuty).toHaveLength(2)
    expect(onDuty.every((u) => (u.bot.state === 'toWard' || u.bot.state === 'serving') && u.bot.meal === 'lunch' && u.bot.trays > 0 && u.bot.fade === 1)).toBe(true)
    expect(hosts(start)).toHaveLength(2)
    expect(trays(start)).toHaveLength(0)

    const mid = new Simulation(5, { startHour: 12 + 5 / 60, population: false })
    mid.preRoll(5)
    const n = inBed(mid).length
    const some = trays(mid).length
    expect(some).toBeGreaterThanOrEqual(4)
    expect(some).toBeLessThan(n)
    expect(botsOnFloor(mid).filter((u) => u.bot.state === 'serving')).toHaveLength(2)
    expect(hosts(mid)).toHaveLength(2)
    mid.sync(1)
    for (const u of botsOnFloor(mid)) {
      const stop = MEAL_STOPS.find((s) => Math.hypot(s.at.x - u.bot.position.x, s.at.z - u.bot.position.z) < 0.5)
      expect(stop, `${u.bot.id} is at a meal stop`).toBeDefined()
    }

    const after = new Simulation(5, { startHour: 12 + 40 / 60, population: false })
    after.preRoll(30)
    // F-29: a patient who is nil by mouth (an ER admission for a stroke work-up, say) has no tray: every other bed does
    const mayEat = inBed(after).filter((id) => !after.meals.nilByMouth(id))
    expect(trays(after).map((r) => r.roomId).sort()).toEqual(mayEat)
    expect(trays(after).length).toBeGreaterThanOrEqual(13)
    expect([...after.life.rooms.values()].filter((r) => r.meal === 'eaten').length).toBeGreaterThan(8)
    for (const r of trays(after)) expect(r.recline).toBe(r.meal === 'served' ? 1 : 0)
    expect(botsOnFloor(after)).toHaveLength(0)
    expect(hosts(after)).toHaveLength(0)

    const quiet = new Simulation(5, { startHour: 15, population: false })
    quiet.preRoll(120)
    expect(trays(quiet)).toHaveLength(0)
    expect(botsOnFloor(quiet)).toHaveLength(0)
  }, 60_000)

  it('breakfast and dinner starts show their own runs', () => {
    for (const [hour, meal] of [[7.75, 'breakfast'], [17.5, 'dinner']] as const) {
      const sim = new Simulation(5, { startHour: hour, population: false })
      sim.preRoll(60)
      expect(botsOnFloor(sim)).toHaveLength(2)
      expect(botsOnFloor(sim).every((u) => u.bot.meal === meal)).toBe(true)
    }
  }, 60_000)

  it('a mid-collection start finishes the collection', () => {
    const sim = new Simulation(8, { startHour: 12 + 44 / 60, population: false })
    sim.preRoll(10)
    expect(botsOnFloor(sim).length).toBeGreaterThan(0)
    const t0 = sim.t
    while (sim.t < t0 + 900) sim.step(DT)
    expect(trays(sim)).toHaveLength(0)
    expect(botsOnFloor(sim)).toHaveLength(0)
    expect(hosts(sim)).toHaveLength(0)
  }, 60_000)

  it('is deterministic for (seed, startHour) at breakfast, lunch and dinner', () => {
    for (const hour of [7.75, 12.0, 17.5]) {
      const a = new Simulation(11, { startHour: hour, population: false })
      const b = new Simulation(11, { startHour: hour, population: false })
      const pose = (s: Simulation) => s.meals.units.map((u) => `${u.bot.id} ${u.bot.state} ${u.bot.position.x.toFixed(3)} ${u.bot.position.z.toFixed(3)} ${u.bot.trays} ${u.bot.light} ${u.bot.door.toFixed(2)}`)
      const rooms = (s: Simulation) => [...s.life.rooms.values()].map((r) => `${r.roomId} ${r.meal} ${r.recline.toFixed(3)} ${r.version}`)
      for (let i = 0; i < 60 * 20 * 60; i++) {
        a.step(DT)
        b.step(DT)
        if (i % 1800 === 0) {
          a.sync(1)
          b.sync(1)
          expect(pose(a)).toEqual(pose(b))
          expect(rooms(a)).toEqual(rooms(b))
        }
      }
      const log = (s: Simulation) => s.log.events.map((e) => `${e.t.toFixed(3)} ${e.type} ${e.text}`)
      expect(mealEvents(a, 'mealServed').length, `${hour}`).toBeGreaterThanOrEqual(10)
      expect(log(a)).toEqual(log(b))
    }
  }, 120_000)
})

describe('meal service: breakfast from the default start, with the whole hospital around', () => {
  it('serves and collects with everyone else on the floor', () => {
    const sim = new Simulation(2026)
    const breakfast = windowOf('breakfast')
    const tracker = new RoomTracker(sim, hourT(breakfast.start), hourT(breakfast.end))
    const watch = new Watch(sim)
    const t0 = performance.now()
    runWatched(sim, hourT(9.0), watch, () => tracker.sample())
    const ms = performance.now() - t0
    const served = mealEvents(sim, 'mealServed')
    const collected = mealEvents(sim, 'trayCollected')
    for (const id of tracker.alwaysOccupied()) expect(roomsOf(served), `${id} was in bed all through breakfast`).toContain(id)
    expect(served.length).toBeGreaterThanOrEqual(14)
    for (const e of served) {
      expect(e.t).toBeGreaterThanOrEqual(hourT(breakfast.start))
      expect(e.t).toBeLessThanOrEqual(hourT(breakfast.end))
      if (!collected.some((c) => c.roomId === e.roomId)) expect(tracker.vacatedSince(e.roomId!, e.t), `${e.roomId} tray`).toBe(true)
    }
    for (const r of sim.life.rooms.values()) expect(r.meal).toBe('none')
    expect(hosts(sim)).toHaveLength(0)
    expect(watch.problems).toEqual([])
    expect(watch.minPersonDistance, watch.minPersonWho).toBeGreaterThanOrEqual(0.4)
    console.log(
      `[meals] 07:30-09:00 full hospital: ${((ms * 1000) / (hourT(9.0) / DT)).toFixed(1)} us per step, ` +
        `closest bot-person ${watch.minPersonDistance.toFixed(2)} m, longest still in a doorway ${watch.longestStill.toFixed(1)} s (${watch.longestStillWho})`,
    )
  }, 300_000)
})
