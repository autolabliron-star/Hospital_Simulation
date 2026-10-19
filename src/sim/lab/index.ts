/**
 * W4: the automated lab (agent L, src/sim/lab/**). The interface is frozen in ports.ts; the draw centre (src/sim/blood) calls `order()` and
 * `send()`, the scene and the panel read `state` and `samples`.
 *
 * A tube's life: ordered -> labelled -> drawn (the draw centre) -> `send()` -> inTube (queued, then flying: pneumatic.ts) -> received (the
 * receive station) -> sorted onto the track -> onTrack -> camera -> [centrifuge, not for EDTA] -> decap -> analysers (as its tests need) ->
 * recap -> archived (modules.ts, track.ts). Its tests are measured `analyticSeconds` after aspiration and verified (verify.ts); when all of an
 * order's tests are verified, `onOrderComplete` fires.
 *
 * Everything is stepped from the fixed 60 Hz loop and seeded (`rng.fork`): the same seed replays the same lab. Nothing here reads a result
 * value to decide anything (no clinical decisions).
 *
 * Render-facing state is mutated in place and never reallocated: `state`, and each sample's `where`, `slot`, `stage`.
 *
 * Conventions the scene and the panel can rely on (Sample.where, set by the lab):
 *   - queued at a riser, or flying:  line 'pneumatic', source = riser 0..3, s = metres along PNEUMATIC_PATHS[source] (0 while it waits, the
 *     path length while it sits in the receive station). It flies exactly while `state.pneumatic.inFlight === sample.id`.
 *   - receive station / sorter:      line 'module', module 'receive', s 0 (stage 'received').
 *   - on the lane:                   line 'track', s = metres along the loop (labTrackPointInto), always on the outbound lane.
 *   - inside a module:               line 'module', module = the module id (camera, cfg0, cfg1, decap, haem, chem, immuno, coag, recap, archive),
 *                                    s = that module's stop (LAB_STOPS). In a centrifuge it is in the rotor between the unit's phases 'loading'
 *                                    (counted by `load`) and 'unloading', otherwise it waits in the unit's rack. In an analyser it is the
 *                                    `aspirating` one, or waits in its `queue`.
 *   - `sDraw` is `s` interpolated between the last two steps on the pipe and the lane, and `s` everywhere else (set in `sync`).
 *   - `slot` is the render slot (state.slots) from `send()` until the tube is archived, then -1 and `archiveSlot` is its place in the fridge.
 * Orders: `drawnAt` is set by the draw centre (or at the first send), `receivedAt` when the order's last tube is out of the pipe, `completeAt`
 * when its last result is verified. Source 'demo' is the panel's "Send a sample now" (one STAT tube from riser 0); 'background' is the ward's own.
 */
import { analyserOf, panelTests, testById, tubesFor } from '@/content/lab'
import { labLine } from '@/content/labCopy'
import { CONFIG } from '../config'
import type { World } from '../er/world'
import { LAB } from '../places'
import { LAB_STOPS } from '../labTrack'
import { timeAtHour } from '../population/schedule'
import type { Rng } from '../rng'
import { SAMPLE_STAGES, SampleBook } from '../samples'
import type { AnalyserKind, LabOrder, LabState, Sample, SampleStage } from '../types'
import { BackgroundFlow } from './background'
import type { Job, LabHost } from './job'
import { Analyser, Archive, Camera, CentrifugeUnit, Decapper, pickUnit, Recapper, Sorter, Station, type ModuleEvents } from './modules'
import { Pneumatic } from './pneumatic'
import type { LabPort, NewLabOrder } from './ports'
import { seededValue, type ValueGenerator } from './results'
import { LabScientist, spawnScientist } from './scientist'
import { Lane } from './track'
import { Verifier } from './verify'

export const LAB_SLOTS = 64
/** The riser the demo sample flies from (robot 0's). */
export const DEMO_SOURCE = 0
/** One tube, one test: the demo sample's panel. */
export const DEMO_PANEL = 'op-precontrast'
export const BACKGROUND_PANEL = 'ward-routine'

function analyser(kind: AnalyserKind) {
  return { kind, queue: 0, aspirating: null as string | null, probe: 0, running: 0, testsToday: 0 }
}
export function newLabState(): LabState {
  return {
    pneumatic: { inFlight: null, queued: 0, sentToday: 0 },
    slots: new Array<string | null>(LAB_SLOTS).fill(null),
    centrifuges: [0, 1].map((index) => ({ index, phase: 'idle' as const, load: 0, capacity: CONFIG.lab.centrifugeCapacity, rpm01: 0, lid: 0, program: null, timeLeft: 0 })),
    analysers: { haematology: analyser('haematology'), chemistry: analyser('chemistry'), immunoassay: analyser('immunoassay'), coagulation: analyser('coagulation') },
    reviewQueue: 0,
    archived: 0,
    kpis: { samplesToday: 0, onTrack: 0, medianTatMin: null, autoVerifiedPct: null },
    version: 0,
  }
}

/** The module that serves each analyser kind (from LAB.modules), and the order the stops come along the lane. */
const ANALYSER_MODULE: Readonly<Record<AnalyserKind, string>> = (() => {
  const out: Partial<Record<AnalyserKind, string>> = {}
  for (const m of LAB.modules) if (m.kind === 'haematology' || m.kind === 'chemistry' || m.kind === 'immunoassay' || m.kind === 'coagulation') out[m.kind] = m.id
  return out as Record<AnalyserKind, string>
})()
const ANALYSER_KINDS = Object.keys(ANALYSER_MODULE) as AnalyserKind[]
const STAGE_RANK = new Map<SampleStage, number>(SAMPLE_STAGES.map((s, i) => [s, i]))

/** The modules a tube visits, in lane order (`'cfg'` becomes a unit when the tube leaves the camera). */
export function routeFor(sample: Sample): string[] {
  const route = ['camera']
  if (sample.tube !== 'EDTA') route.push('cfg')
  route.push('decap')
  const kinds = new Set<AnalyserKind>()
  for (const t of sample.tests) kinds.add(analyserOf(t))
  const ids = [...kinds].map((k) => ANALYSER_MODULE[k]).sort((a, b) => LAB_STOPS[a] - LAB_STOPS[b])
  route.push(...ids, 'recap', 'archive')
  return route
}

interface Enqueuer {
  enqueue(job: Job, t: number): void
}

export class Lab implements LabPort {
  readonly state: LabState = newLabState()
  readonly samples = new SampleBook()
  onOrderComplete: ((order: LabOrder) => void) | null = null
  /** The raw value draw (tests swap in a constant to prove values never change the flow). */
  valueGenerator: ValueGenerator = seededValue
  /** Debug hook for the tests: a tube entered a module (`receive`, `camera`, `cfg0`..). */
  trace: ((sampleId: string, moduleId: string, t: number) => void) | null = null
  readonly scientist: LabScientist
  protected readonly orders = new Map<string, LabOrder>()
  private orderSeq = 0
  private demoSeq = 0
  private bgSeq = 0
  private isDirty = false
  private inLab = 0

  private readonly flow: Rng
  private readonly host: LabHost
  private readonly active: Job[] = []
  private readonly jobs = new Map<string, Job>()
  private readonly needSlot: Job[] = []
  private readonly receivedOf = new Map<string, number>()
  /** The pneumatic line and the track's lane (the tests read them; the scene reads only `state` and the samples). */
  readonly pneumatic: Pneumatic
  readonly lane: Lane
  private readonly sorter: Sorter
  private readonly camera: Camera
  /** The two centrifuge units (the tests read them). */
  readonly units: CentrifugeUnit[]
  private readonly stations: Station[] = []
  private readonly modules = new Map<string, Enqueuer>()
  /** The measuring and review desk (the tests read it). */
  readonly verifier: Verifier
  private readonly background: BackgroundFlow

  constructor(
    protected readonly world: World,
    protected readonly rng: Rng,
  ) {
    this.flow = rng.fork('flow')
    this.host = {
      cfg: CONFIG.lab,
      state: this.state,
      samples: this.samples,
      rng: this.flow,
      dirty: () => {
        this.isDirty = true
      },
      setStage: (job, stage, t) => this.setStage(job, stage, t),
      placeInModule: (job, id, s) => {
        const w = job.sample.where
        w.line = 'module'
        w.module = id
        w.s = s
        w.sDraw = s
        job.prevS = s
      },
      placeOnLane: (job, s) => {
        const w = job.sample.where
        w.line = 'track'
        w.module = null
        w.s = s
        w.sDraw = s
        job.prevS = s
      },
      traceVisit: (job, id, t) => this.trace?.(job.sample.id, id, t),
    }
    const events: ModuleEvents = {
      done: (job, id, t) => this.moduleDone(job, id, t),
      aspirated: (job, kind, t) => {
        for (const test of job.sample.tests) if (analyserOf(test) === kind) this.verifier.schedule(job.order, test, t + this.analyticSeconds(test))
        this.state.analysers[kind].running += this.testsOn(job, kind)
      },
    }
    const stop = (id: string): number => LAB_STOPS[id]
    this.pneumatic = new Pneumatic(this.host)
    this.pneumatic.onReceived = (job, t) => this.received(job, t)
    this.lane = new Lane(this.host)
    this.lane.onDivert = (job, t) => this.modules.get(job.route[job.step])!.enqueue(job, t)
    this.lane.onEnter = (job, t) => {
      if (job.sample.stage === 'received') this.setStage(job, 'onTrack', t)
    }
    this.sorter = new Sorter(this.host, events, 'receive', 0)
    this.camera = new Camera(this.host, events, 'camera', stop('camera'))
    this.units = this.state.centrifuges.map((st) => new CentrifugeUnit(this.host, events, `cfg${st.index}`, stop(`cfg${st.index}`), st))
    this.stations.push(this.sorter, this.camera)
    this.stations.push(new Decapper(this.host, events, 'decap', stop('decap')))
    for (const kind of ANALYSER_KINDS) {
      const id = ANALYSER_MODULE[kind]
      this.stations.push(new Analyser(this.host, events, id, stop(id), kind, (j, k) => this.testsOn(j, k)))
    }
    this.stations.push(new Recapper(this.host, events, 'recap', stop('recap')), new Archive(this.host, events, 'archive', stop('archive')))
    for (const s of this.stations) this.modules.set(s.id, s)
    for (const u of this.units) this.modules.set(u.id, u)

    const verifyRng = rng.fork('verify')
    this.verifier = new Verifier(
      {
        host: this.host,
        seed: rng.seed,
        generator: () => this.valueGenerator,
        say: (type, text, refs) => this.world.say(type, text, refs),
        complete: (order) => this.onOrderComplete?.(order),
        reviewer: () => this.scientist,
      },
      verifyRng.float(),
    )
    this.background = new BackgroundFlow(rng.fork('background'), world.t)
    this.scientist = spawnScientist(world, rng.fork('scientist'))
  }

  // --- the frozen port -----------------------------------------------------------------------------

  order(input: NewLabOrder): LabOrder {
    const id = `L${String(++this.orderSeq).padStart(5, '0')}`
    const tests = panelTests(input.panel)
    const t = this.world.t
    const order: LabOrder = {
      id,
      patientId: input.patientId,
      patientName: input.patientName,
      source: input.source,
      panel: input.panel,
      tests,
      priority: input.priority,
      sampleIds: [],
      ticket: input.ticket ?? null,
      drawnBy: null,
      orderedAt: t,
      drawnAt: null,
      receivedAt: null,
      completeAt: null,
      results: [],
    }
    for (const tube of tubesFor(tests)) order.sampleIds.push(this.samples.create({ orderId: id, patientId: input.patientId, tube: tube.tube, cap: tube.cap, tests: tube.tests, priority: input.priority }, t).id)
    this.orders.set(id, order)
    this.verifier.register(order)
    return order
  }

  send(sampleId: string, source: number): void {
    const s = this.samples.get(sampleId)
    if (!s) throw new Error(`Unknown sample ${sampleId}`)
    if (!Number.isInteger(source) || source < 0 || source > 3) throw new Error(`Unknown pneumatic source ${source}`)
    if (this.jobs.has(sampleId) || STAGE_RANK.get(s.stage)! >= STAGE_RANK.get('inTube')!) return
    const order = this.orders.get(s.orderId)
    if (!order) throw new Error(`Sample ${sampleId} has no lab order`)
    const t = this.world.t
    for (const stage of ['labelled', 'drawn', 'inTube'] as const) if (STAGE_RANK.get(s.stage)! < STAGE_RANK.get(stage)!) this.samples.advance(sampleId, stage, t)
    if (order.drawnAt === null) order.drawnAt = t
    this.pneumatic.enqueue(this.newJob(s, order), source)
    this.isDirty = true
  }

  ordersFor(patientId: string): readonly LabOrder[] {
    const out: LabOrder[] = []
    for (const o of this.orders.values()) if (o.patientId === patientId) out.push(o)
    return out
  }

  orderById(orderId: string): LabOrder | undefined {
    return this.orders.get(orderId)
  }

  /** The panel's "Send a sample now": one STAT single-tube sample (source 'demo') flies from robot 0's riser, a visible flight. */
  sendDemo(): void {
    const order = this.order({ patientId: `demo-${++this.demoSeq}`, patientName: 'Demo sample', source: 'demo', panel: DEMO_PANEL, priority: 'stat' })
    order.drawnBy = 'external'
    this.send(order.sampleIds[0], DEMO_SOURCE)
  }

  step(t: number, dt: number): void {
    const active = this.active
    for (let i = 0; i < active.length; i++) active[i].prevS = active[i].sample.where.s
    while (this.background.due(t)) this.arriveBackground(t)
    this.pneumatic.step(t)
    this.lane.step(t, dt)
    this.sorter.step(t, dt)
    this.camera.step(t, dt)
    for (let i = 0; i < this.units.length; i++) this.units[i].step(t, dt)
    for (let i = 2; i < this.stations.length; i++) this.stations[i].step(t, dt)
    this.verifier.step(t)
    this.scientist.reviewing = this.verifier.reviewing
    if (this.needSlot.length > 0) this.assignSlots()
    if (this.isDirty) {
      this.isDirty = false
      this.state.version++
    }
  }

  /** Interpolate what the renderer draws between the previous and the current step. */
  sync(alpha: number): void {
    const active = this.active
    for (let i = 0; i < active.length; i++) {
      const j = active[i]
      const w = j.sample.where
      w.sDraw = w.line === 'track' || w.line === 'pneumatic' ? j.prevS + (w.s - j.prevS) * alpha : w.s
    }
  }

  /** An empty lab at `hour`: the ward's samples arrive from there on, the scientist's first reagent trip is planned. */
  warmStart(hour: number): void {
    const t = timeAtHour(hour)
    this.background.reset(t)
    this.scientist.reset(t)
  }

  // --- the tube's way through ------------------------------------------------------------------------

  private newJob(sample: Sample, order: LabOrder): Job {
    const route = routeFor(sample)
    const job: Job = { sample, order, route, step: 0, stopS: LAB_STOPS[route[0]], exitS: 0, prevS: 0, since: this.world.t }
    this.jobs.set(sample.id, job)
    this.active.push(job)
    this.needSlot.push(job)
    this.assignSlots()
    return job
  }

  private assignSlots(): void {
    const slots = this.state.slots
    const need = this.needSlot
    let n = 0
    let free = 0
    for (let k = 0; k < need.length; k++) {
      while (free < slots.length && slots[free] !== null) free++
      if (free >= slots.length) {
        need[n++] = need[k]
        continue
      }
      slots[free] = need[k].sample.id
      need[k].sample.slot = free
      this.isDirty = true
    }
    need.length = n
  }

  private freeSlot(job: Job): void {
    const s = job.sample
    if (s.slot >= 0) {
      this.state.slots[s.slot] = null
      s.slot = -1
    } else {
      const i = this.needSlot.indexOf(job)
      if (i >= 0) this.needSlot.splice(i, 1)
    }
  }

  private setStage(job: Job, stage: SampleStage, t: number): void {
    this.samples.advance(job.sample.id, stage, t)
    this.isDirty = true
  }

  /** A tube left the pneumatic line (or arrived from the ward): into the sorter. */
  private received(job: Job, t: number): void {
    this.setStage(job, 'received', t)
    this.inLab++
    this.state.kpis.samplesToday++
    this.state.kpis.onTrack = this.inLab
    const order = job.order
    const n = (this.receivedOf.get(order.id) ?? 0) + 1
    this.receivedOf.set(order.id, n)
    if (n >= order.sampleIds.length) {
      order.receivedAt = t
      if (order.source === 'demo') this.world.say('samplesReceived', labLine('demoReceived'), {})
      else if (order.source !== 'background')
        this.world.say('samplesReceived', order.ticket ? labLine('samplesReceived', { ticket: order.ticket }) : labLine('samplesReceivedNoTicket', { name: order.patientName }), { subjectId: order.patientId })
    }
    this.sorter.enqueue(job, t)
  }

  /** A module has finished with a tube: it travels on. */
  private moduleDone(job: Job, moduleId: string, t: number): void {
    if (moduleId === 'archive') return this.archived(job, t)
    if (moduleId === 'receive') {
      this.lane.release(job, 0)
      return
    }
    job.step++
    if (job.route[job.step] === 'cfg') {
      const unit = pickUnit(this.units, job.sample.priority, t)
      job.route[job.step] = unit.id
      unit.enRoute++
    }
    job.stopS = LAB_STOPS[job.route[job.step]]
    this.lane.release(job, LAB_STOPS[moduleId])
  }

  private archived(job: Job, t: number): void {
    const s = job.sample
    this.setStage(job, 'archived', t)
    s.archiveSlot = this.state.archived % CONFIG.lab.archiveCapacity
    this.state.archived++
    this.freeSlot(job)
    const i = this.active.indexOf(job)
    if (i >= 0) {
      this.active[i] = this.active[this.active.length - 1]
      this.active.pop()
    }
    this.jobs.delete(s.id)
    this.inLab--
    this.state.kpis.onTrack = this.inLab
    this.isDirty = true
  }

  /** A sample from the ward arrives at the receive station directly (drawn at the bedside, not modelled). */
  private arriveBackground(t: number): void {
    const n = ++this.bgSeq
    const order = this.order({ patientId: `ward-${n}`, patientName: `Ward sample ${n}`, source: 'background', panel: BACKGROUND_PANEL, priority: 'routine' })
    order.drawnAt = t
    order.drawnBy = 'external'
    for (const id of order.sampleIds) {
      const s = this.samples.get(id)!
      for (const stage of ['labelled', 'drawn', 'inTube'] as const) this.samples.advance(id, stage, t)
      this.received(this.newJob(s, order), t)
    }
  }

  private analyticSeconds(testId: string): number {
    return testById(testId).analyticSeconds
  }

  private testsOn(job: Job, kind: AnalyserKind): number {
    let n = 0
    for (const t of job.sample.tests) if (analyserOf(t) === kind) n++
    return n
  }
}
