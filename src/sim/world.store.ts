/**
 * Slow state for the HUD, published by SimLoop at ~4 Hz (never per frame). Components subscribe with
 * selectors; the 3D layers read the Simulation directly inside useFrame instead.
 */
import { create } from 'zustand'
import { clockText } from './events'
import type { SimLoop } from './SimLoop'
import { noteEvents } from './records/chartIndex'
import type { Simulation } from './Simulation'
import { ORDER_STAGES, type OrderStage, type SimEvent } from './types'

export interface Kpis {
  /** Orders that reached a drawer today. */
  delivered: number
  given: number
  /** Median minutes from prescription to the drawer, over delivered orders (null before the first one). */
  medianOrderToDrawerMin: number | null
  podsBusy: number
  podsCharging: number
}

export interface WorldState {
  clock: string
  t: number
  speed: number
  paused: boolean
  /** Orders currently at each stage of the rail. */
  stageCounts: Record<OrderStage, number>
  /** The latest events, oldest first. */
  events: SimEvent[]
  kpis: Kpis
}

const emptyCounts = (): Record<OrderStage, number> => Object.fromEntries(ORDER_STAGES.map((s) => [s, 0])) as Record<OrderStage, number>

export const useWorld = create<WorldState>(() => ({
  clock: clockText(0),
  t: 0,
  speed: 1,
  paused: false,
  stageCounts: emptyCounts(),
  events: [],
  kpis: { delivered: 0, given: 0, medianOrderToDrawerMin: null, podsBusy: 0, podsCharging: 0 },
}))

let lastEventId = 0
let lastSim: Simulation | null = null

export function publishWorld(sim: Simulation, loop: SimLoop): void {
  noteEvents(sim.log) // the patient record keeps each patient's events past the log's 2000-event window
  if (lastSim !== sim) {
    // a Jump swapped the hospital (L1): its log numbers events from 1, and the pre-roll's events happened behind the cover
    lastSim = sim
    lastEventId = sim.log.events.at(-1)?.id ?? 0
    useWorld.setState({ events: [] })
  }
  const counts = emptyCounts()
  const durations: number[] = []
  let delivered = 0
  let given = 0
  for (const o of sim.meds.orders.values()) {
    // a cancelled order (its patient left before the pick) never reaches "given": keep it off the rail
    if (o.cancelledAt === undefined) counts[o.stage]++
    if (o.stageAt.inDrawer !== undefined) {
      delivered++
      durations.push(o.stageAt.inDrawer - o.createdAt)
    }
    if (o.stage === 'given') given++
  }
  durations.sort((a, b) => a - b)
  const median = durations.length ? durations[Math.floor((durations.length - 1) / 2)] / 60 : null
  let busy = 0
  let charging = 0
  for (const d of sim.meds.fleet.drivers) {
    if (d.pod.state === 'charging') charging++
    else busy++
  }
  const prev = useWorld.getState()
  const newEvents = sim.log.since(lastEventId)
  if (newEvents.length) lastEventId = newEvents[newEvents.length - 1].id
  useWorld.setState({
    clock: clockText(sim.t),
    t: sim.t,
    speed: loop.speed,
    paused: loop.paused,
    stageCounts: counts,
    events: newEvents.length ? [...prev.events, ...newEvents].slice(-40) : prev.events,
    kpis: { delivered, given, medianOrderToDrawerMin: median, podsBusy: busy, podsCharging: charging },
  })
}
