/**
 * The one running hospital for the browser: a Simulation seeded from `?seed=` (default: the world seed) and started
 * at `?start=HH:MM` (default 07:30), its SimLoop and the store publisher. Tests build their own Simulation instead.
 *
 * `sim` is a live binding: a Jump (L1) rebuilds the hospital at another hour with the same seed and swaps it in, so
 * modules that read `sim.…` at use time see the new one. Anything that caches per-sim data must watch
 * `simGeneration` (or `sim.rosterVersion`, which jumps forward on a swap).
 */
import { CONFIG } from './config'
import { SimLoop } from './SimLoop'
import { Simulation } from './Simulation'
import { hourAt } from './population/schedule'
import { parseStartHour } from './startHour'
import type { OpeningKind } from './types'
import { publishWorld } from './world.store'

function seedFromUrl(): number {
  if (typeof window === 'undefined') return CONFIG.sim.worldSeed
  const raw = new URLSearchParams(window.location.search).get('seed')
  const n = raw === null ? NaN : Number(raw)
  return Number.isFinite(n) ? n >>> 0 : CONFIG.sim.worldSeed
}

function startFromUrl(): number | undefined {
  if (typeof window === 'undefined') return undefined
  return parseStartHour(new URLSearchParams(window.location.search).get('start'))
}

/** S1: `?opening=quiet` opens the R2 day (empty machines at 07:30); anything else is the showcase. */
export function openingFromUrl(): OpeningKind {
  if (typeof window === 'undefined') return 'showcase'
  return new URLSearchParams(window.location.search).get('opening') === 'quiet' ? 'quiet' : 'showcase'
}

/**
 * Build the hospital at `startHour` and settle it with the hidden pre-roll. Every warm start (a Jump, a Skip) places
 * work already under way; so does the showcase opening at 07:30, with its own shorter pre-roll so the clock still reads
 * 07:30. A quiet 07:30 start has no pre-roll (the R2 day).
 */
export function buildSimulation(seed: number, startHour: number | undefined, rosterBase = 0, opening: OpeningKind = openingFromUrl()): Simulation {
  const atDefault = startHour === undefined || startHour === CONFIG.sim.startHour
  const inFlight = !atDefault || opening === 'showcase'
  const s = new Simulation(seed, { startHour, rosterBase, opening, inFlight })
  const preRoll = !atDefault ? CONFIG.day.jumpPreRollSeconds : opening === 'showcase' ? CONFIG.opening.preRollSeconds : 0
  if (preRoll > 0) s.preRoll(preRoll)
  return s
}

/**
 * F-18: built at import, so a throw here (a content edit, a bad `?start=`) would be a white page with no message. Retry with the
 * default start, then with the default seed too.
 */
function buildInitial(): Simulation {
  try {
    return buildSimulation(seedFromUrl(), startFromUrl())
  } catch (error) {
    console.error('Building the hospital from the URL failed; falling back to the default start.', error)
  }
  try {
    return buildSimulation(seedFromUrl(), undefined)
  } catch (error) {
    console.error('Building the hospital with this seed failed; falling back to the default seed.', error)
  }
  return buildSimulation(CONFIG.sim.worldSeed, undefined)
}

export let sim = buildInitial()
export const loop = new SimLoop(sim, publishWorld)
/** Bumped on every Jump; React layers that hold per-sim state key on it. */
export let simGeneration = 0

/** Jump (L1): rebuild the hospital at `hour` with the same seed and swap it in. Call behind a fade. */
export function jumpTo(hour: number): void {
  const next = buildSimulation(sim.seed, hour, sim.rosterVersion + 1000, sim.opening)
  // you come along (W1): same place, same mode
  const you = sim.player
  if (you) {
    const p = next.addPlayer({ at: { x: you.x, z: you.z }, heading: you.heading })
    p.mode = you.mode
    p.view = you.view
  }
  sim = next
  simGeneration++
  loop.replace(next)
}

/** S1: the latest sim time a skip may reach (the day the Jump menu covers ends at CONFIG.day.endHour). */
export function skipLimit(): number {
  return (CONFIG.day.endHour - CONFIG.sim.startHour) * 3600
}

/**
 * S1 Skip, short: run the same hospital `seconds` forward headless (full continuity: the same people, your order under
 * way, the selection). Call behind the time-lapse veil. Clamped to the end of the day.
 */
export function advanceBy(seconds: number): void {
  const s = Math.min(seconds, skipLimit() - sim.t)
  if (s <= 0) return
  sim.preRoll(s)
  loop.resync()
}

/**
 * S1 Skip, long: a forward Jump that lands with the clock at `t` (the rebuild's hidden pre-roll is counted). Surgery stays
 * on its seeded plan (the same cases and names); the other departments are re-warmed with work under way.
 */
export function skipRebuild(t: number): void {
  const target = Math.min(t, skipLimit())
  jumpTo(hourAt(target - CONFIG.day.jumpPreRollSeconds))
}
