/**
 * Test helpers for the lab (agent L): a driver that stands in for the draw centre, injecting orders and sending their tubes the way a robot draw
 * would (one tube every 12 s), and small readers over a lab's state. Used by the node tests only.
 */
import { LAB_CATALOGUE } from '@/content/lab'
import { CONFIG } from '../config'
import type { World } from '../er/world'
import { EventLog } from '../events'
import { ArrivalProcess, timeAtHour, type Curve } from '../population/schedule'
import { Rng } from '../rng'
import type { Simulation } from '../Simulation'
import type { LabOrder, LabPriority, Sample, SimEventType } from '../types'
import { makeWalker } from '../walker'
import { Lab } from './index'

export const DT = CONFIG.sim.step

const ER_PANELS = [...new Set(Object.values(LAB_CATALOGUE.erPanels))]

interface Plan {
  at: number
  sampleId: string
  source: number
}

export interface DriverOptions {
  /** Outpatient draws per hour (default: the draw centre's curve). */
  outpatients?: Curve
  /** STAT ER orders per hour (flat) and pre-scan creatinine orders per hour (flat). */
  erPerHour?: number
  preScanPerHour?: number
  /** Stop injecting at this clock hour (the lab drains afterwards). */
  injectUntilHour?: number
}

export class Driver {
  readonly orders: LabOrder[] = []
  private readonly rng: Rng
  private readonly plans: Plan[] = []
  private readonly streams: { next: number; proc: ArrivalProcess; make: (t: number) => void }[] = []
  private seq = 0
  private stopAt: number

  constructor(
    readonly sim: Simulation,
    seed: number,
    opts: DriverOptions = {},
  ) {
    this.rng = new Rng(seed ^ 0x5eed)
    const lab = sim.lab
    this.stopAt = timeAtHour(opts.injectUntilHour ?? 12.5)
    const t0 = sim.t
    const add = (curve: Curve, label: string, make: (t: number) => void) => {
      const proc = new ArrivalProcess(this.rng.fork(label), curve, t0)
      this.streams.push({ next: proc.next(), proc, make })
    }
    add(opts.outpatients ?? CONFIG.blood.outpatientsPerHour, 'op', (t) => {
      const panel = this.rng.weighted(
        LAB_CATALOGUE.outpatientPanels.map((p) => p.panel),
        LAB_CATALOGUE.outpatientPanels.map((p) => p.weight),
      )
      this.place(lab, 'outpatient', panel, 'routine', t)
    })
    const er = opts.erPerHour ?? 6
    if (er > 0)
      add(
        [
          [6, er],
          [24, er],
        ],
        'er',
        (t) => this.place(lab, 'er', this.rng.pick(ER_PANELS), 'stat', t),
      )
    const pre = opts.preScanPerHour ?? 2
    if (pre > 0)
      add(
        [
          [6, pre],
          [24, pre],
        ],
        'pre',
        (t) => this.place(lab, 'preScan', 'op-precontrast', 'routine', t),
      )
  }

  private place(lab: Lab, source: LabOrder['source'], panel: string, priority: LabPriority, t: number): void {
    const n = ++this.seq
    const order = lab.order({ patientId: `T${n}`, patientName: `Test Patient ${n}`, source, panel, priority, ticket: source === 'outpatient' ? `P${String(n).padStart(3, '0')}` : source === 'er' ? `V${String(n).padStart(3, '0')}` : null })
    order.drawnBy = 'robot'
    order.drawnAt = t
    this.orders.push(order)
    // a robot fills a tube every 12 s; the tubes fly one after the other
    order.sampleIds.forEach((id, i) => this.plans.push({ at: t + 12 * (i + 1), sampleId: id, source: n % 3 }))
  }

  /** Call after each `sim.step(DT)`. */
  tick(): void {
    const t = this.sim.t
    for (const s of this.streams) {
      while (s.next <= t && s.next <= this.stopAt) {
        s.make(s.next)
        s.next = s.proc.next()
      }
    }
    const p = this.plans
    for (let i = 0; i < p.length; ) {
      if (p[i].at <= t) {
        this.sim.lab.send(p[i].sampleId, p[i].source)
        p.splice(i, 1)
      } else i++
    }
  }

  get pendingSends(): number {
    return this.plans.length
  }
}

export function run(sim: Simulation, seconds: number, driver?: Driver, each?: () => void): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    sim.step(DT)
    driver?.tick()
    each?.()
  }
}

export function samplesOf(lab: Lab): Sample[] {
  return [...lab.samples.samples.values()]
}

/** The (draw to verified) turnaround of one result in minutes. */
export function tatMinutes(order: LabOrder, verifiedAt: number): number {
  return (verifiedAt - (order.drawnAt ?? order.orderedAt)) / 60
}

/** A lab on its own: a stub world (a clock, an event log, a walker factory), stepped directly. Starts at `hour` (default 01:00: the ward's own samples only start arriving at 06:00). */
export interface Bench {
  lab: Lab
  world: { t: number; log: EventLog }
  /** Advance `seconds` of sim time. */
  run(seconds: number, each?: (t: number) => void): void
  /** Order and send one patient's tubes now (all at once, from `source`). */
  inject(opts: { panel: string; priority: LabPriority; source?: number; patientId?: string; ticket?: string | null; kind?: LabOrder['source'] }): LabOrder
}

export function makeBench(seed = 11, hour = 1): Bench {
  const log = new EventLog()
  const world = {
    t: (hour - CONFIG.sim.startHour) * 3600,
    log,
    say: (type: SimEventType, text: string, refs = {}) => log.push(world.t, type, text, refs),
    walkerFor: (id: string) => makeWalker(undefined, { id }),
    hooks: { add: () => {}, remove: () => {} },
  }
  const lab = new Lab(world as unknown as World, new Rng(seed).fork('lab'))
  lab.warmStart(hour)
  let n = 0
  return {
    lab,
    world,
    run(seconds, each) {
      for (let i = 0, k = Math.round(seconds / DT); i < k; i++) {
        world.t += DT
        lab.step(world.t, DT)
        each?.(world.t)
      }
    },
    inject(o) {
      const id = o.patientId ?? `B${++n}`
      const order = lab.order({ patientId: id, patientName: `Bench ${id}`, source: o.kind ?? 'outpatient', panel: o.panel, priority: o.priority, ticket: o.ticket ?? null })
      order.drawnBy = 'robot'
      order.drawnAt = world.t
      for (const sid of order.sampleIds) lab.send(sid, o.source ?? 0)
      return order
    },
  }
}
