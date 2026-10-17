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
import { parseStartHour } from './startHour'
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

/** Build the hospital at `startHour` and settle it with the hidden pre-roll (none for the default start). */
export function buildSimulation(seed: number, startHour: number | undefined, rosterBase = 0): Simulation {
  const s = new Simulation(seed, { startHour, rosterBase })
  if (startHour !== undefined && startHour !== CONFIG.sim.startHour) s.preRoll(CONFIG.day.jumpPreRollSeconds)
  return s
}

export let sim = buildSimulation(seedFromUrl(), startFromUrl())
export const loop = new SimLoop(sim, publishWorld)
/** Bumped on every Jump; React layers that hold per-sim state key on it. */
export let simGeneration = 0

/** Jump (L1): rebuild the hospital at `hour` with the same seed and swap it in. Call behind a fade. */
export function jumpTo(hour: number): void {
  const next = buildSimulation(sim.seed, hour, sim.rosterVersion + 1000)
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
