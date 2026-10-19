import { describe, expect, it } from 'vitest'
import { LAB_CATALOGUE, analyserOf } from '@/content/lab'
import { CONFIG } from '../config'
import { LAB_OUTBOUND_LENGTH, LAB_STOPS } from '../labTrack'
import { LAB } from '../places'
import { SampleBook } from '../samples'
import type { AnalyserKind, Sample } from '../types'
import type { Job, LabHost } from './job'
import { LID_SECONDS, BRAKE_SECONDS, RAMP_UP_SECONDS } from './modules'
import { Lane } from './track'
import { DT, makeBench } from './testkit'

const CFG = CONFIG.lab

/** The modules a tube must visit, worked out here from the content and the module list, not from the lab's own routing. */
function expectedVisits(s: Sample): string[] {
  const kinds = new Set<AnalyserKind>(s.tests.map(analyserOf))
  const out = ['receive', 'camera']
  if (s.tube !== 'EDTA') out.push('cfg')
  out.push('decap')
  for (const m of LAB.modules) if (kinds.has(m.kind as AnalyserKind)) out.push(m.id)
  out.push('recap', 'archive')
  return out
}

describe('the lane (pucks keep their gap)', () => {
  function laneKit() {
    const book = new SampleBook()
    const host = {
      cfg: CFG,
      placeOnLane: (job: Job, s: number) => {
        job.sample.where.line = 'track'
        job.sample.where.s = s
      },
    } as unknown as LabHost
    const lane = new Lane(host)
    const mk = (i: number, stop: number): Job => {
      const sample = book.create({ orderId: 'o', patientId: 'p', tube: 'serum', cap: 'gold', tests: ['lipids'], priority: 'routine' }, 0)
      return { sample, order: {} as never, route: ['archive'], step: 0, stopS: stop, exitS: 0, prevS: 0, since: i }
    }
    return { lane, mk }
  }

  it('twelve tubes released at once enter one by one, never closer than puckGap, and all reach their stop', () => {
    const { lane, mk } = laneKit()
    const jobs = Array.from({ length: 12 }, (_, i) => mk(i, LAB_STOPS.archive))
    for (const j of jobs) lane.release(j, 0)
    const arrived: Job[] = []
    lane.onDivert = (j) => arrived.push(j)
    let minGap = Infinity
    for (let i = 0; i < 60 * 140; i++) {
      lane.step(i * DT, DT)
      const p = lane.pucks
      for (let k = 1; k < p.length; k++) minGap = Math.min(minGap, p[k - 1].sample.where.s - p[k].sample.where.s)
    }
    expect(arrived.length).toBe(12)
    expect(minGap).toBeGreaterThanOrEqual(CFG.puckGap - 1e-6)
    // first in, first out: the lane never reorders pucks
    expect(arrived.map((j) => j.since)).toEqual(jobs.map((j) => j.since))
    expect(lane.pucks.length).toBe(0)
    expect(lane.waiting).toBe(0)
    for (const j of arrived) expect(j.sample.where.s).toBeCloseTo(LAB_STOPS.archive, 9)
  })

  it('moves at trackSpeed, stops exactly at its module, and a tube re-enters only where the lane is clear on both sides', () => {
    const { lane, mk } = laneKit()
    const a = mk(0, LAB_STOPS.decap)
    lane.release(a, 0)
    let diverted = false
    lane.onDivert = () => (diverted = true)
    lane.step(0, DT)
    const s0 = a.sample.where.s
    lane.step(DT, DT)
    expect(a.sample.where.s - s0).toBeCloseTo(CFG.trackSpeed * DT, 9)
    // a second tube wants to join 0.05 m behind it: it has to wait until the gap is open
    const b = mk(1, LAB_STOPS.archive)
    lane.release(b, 0)
    for (let i = 2; i < 6; i++) lane.step(i * DT, DT)
    expect(b.sample.where.line).toBe('none')
    expect(lane.waiting).toBe(1)
    for (let i = 6; i < 6 + Math.ceil(CFG.puckGap / CFG.trackSpeed / DT) + 2; i++) lane.step(i * DT, DT)
    expect(b.sample.where.line).toBe('track')
    expect(lane.waiting).toBe(0)
    // (b entered at 0 only after a was at least puckGap ahead)
    expect(a.sample.where.s - b.sample.where.s).toBeGreaterThanOrEqual(CFG.puckGap - 1e-6)
    for (let i = 60; i < 60 * 30; i++) lane.step(i * DT, DT)
    expect(diverted).toBe(true)
    expect(a.sample.where.s).toBeCloseTo(LAB_STOPS.decap, 9)
  })
})

describe('the modules and the centrifuges', () => {
  it('every tube visits exactly the modules its tests need, in track order, for every panel and both priorities', () => {
    const b = makeBench()
    const visits = new Map<string, string[]>()
    b.lab.trace = (id, module) => {
      const m = /^cfg\d$/.test(module) ? 'cfg' : module
      ;(visits.get(id) ?? visits.set(id, []).get(id)!).push(m)
    }
    const orders = []
    for (const panel of Object.keys(LAB_CATALOGUE.panels)) for (const priority of ['routine', 'stat'] as const) orders.push(b.inject({ panel, priority, source: orders.length % 4 }))
    b.run(2 * 3600)
    let tubes = 0
    const kinds = new Set<string>()
    for (const o of orders)
      for (const id of o.sampleIds) {
        const s = b.lab.samples.get(id)!
        tubes++
        kinds.add(s.tube)
        expect(s.stage, `${id} ${s.tube} ${s.tests}`).toBe('archived')
        expect(visits.get(id), `${id} ${s.tube} ${s.tests}`).toEqual(expectedVisits(s))
        // the stage log agrees: it passed the module stages it visited
        expect(s.stageAt.centrifuge !== undefined).toBe(s.tube !== 'EDTA')
        expect(s.stageAt.analysing).toBeDefined()
      }
    expect(tubes).toBeGreaterThanOrEqual(40)
    expect([...kinds].sort()).toEqual(['EDTA', 'citrate', 'fluoride', 'heparin', 'serum'])
  })

  it('EDTA tubes never spin: the rotor never holds one, and their stage log has no centrifuge', () => {
    const b = makeBench()
    for (let i = 0; i < 12; i++) b.inject({ panel: i % 2 ? 'er-faint' : 'op-annual', priority: i % 3 === 0 ? 'stat' : 'routine', source: i % 3 })
    let rotorChecks = 0
    b.run(3600, () => {
      for (const u of b.lab.units) for (const j of u.tubes) if (j.sample.tube === 'EDTA') throw new Error('an EDTA tube is in a centrifuge')
      for (const u of b.lab.units) for (const j of [...u.waitStat, ...u.waitRoutine]) if (j.sample.tube === 'EDTA') throw new Error('an EDTA tube waits for a centrifuge')
      rotorChecks++
    })
    expect(rotorChecks).toBeGreaterThan(1000)
    const edta = [...b.lab.samples.samples.values()].filter((s) => s.tube === 'EDTA')
    expect(edta.length).toBe(12)
    for (const s of edta) {
      expect(s.stageAt.centrifuge).toBeUndefined()
      expect(s.stage).toBe('archived')
    }
  })

  it('a STAT tube starts a "stat" spin at once; a lone routine tube waits for the batch timer; 24 routine tubes spin as soon as the rotor is full', () => {
    // STAT
    {
      const b = makeBench()
      const o = b.inject({ panel: 'op-precontrast', priority: 'stat' })
      const s = b.lab.samples.get(o.sampleIds[0])!
      let arrived = NaN
      let spinning = NaN
      let unloading = NaN
      let phases: string[] = []
      b.lab.trace = (_id, m, t) => {
        if (/^cfg\d$/.test(m)) arrived = t
      }
      b.run(900, (t) => {
        const ph = b.lab.state.centrifuges.map((c) => c.phase).join()
        if (phases[phases.length - 1] !== ph) phases.push(ph)
        for (const c of b.lab.state.centrifuges) {
          if (c.phase === 'spinning' && Number.isNaN(spinning)) {
            spinning = t
            expect(c.program).toBe('stat')
          }
          if (c.phase === 'unloading' && Number.isNaN(unloading)) unloading = t
        }
      })
      expect(Number.isNaN(arrived)).toBe(false)
      // loading starts on the step it arrived (lid, one tube, lid), the spin follows; no waiting for a batch
      expect(spinning - arrived).toBeLessThanOrEqual(2 * LID_SECONDS + CFG.loadSecondsPerTube + 3 * DT)
      expect(unloading - spinning).toBeGreaterThanOrEqual(RAMP_UP_SECONDS + CFG.spinSeconds.stat + BRAKE_SECONDS - 1e-9)
      expect(unloading - spinning).toBeLessThan(RAMP_UP_SECONDS + CFG.spinSeconds.stat + BRAKE_SECONDS + 2 * DT)
      expect(s.stage).toBe('archived')
      expect(phases.some((p) => p.includes('loading'))).toBe(true)
    }
    // routine, alone
    {
      const b = makeBench()
      const o = b.inject({ panel: 'op-precontrast', priority: 'routine' })
      void o
      let arrived = NaN
      let loadingAt = NaN
      b.lab.trace = (_id, m, t) => {
        if (/^cfg\d$/.test(m)) arrived = t
      }
      b.run(1200, (t) => {
        for (const c of b.lab.state.centrifuges)
          if (c.phase === 'loading' && Number.isNaN(loadingAt)) {
            loadingAt = t
            expect(c.program).toBe('routine')
          }
      })
      expect(loadingAt - arrived).toBeGreaterThanOrEqual(CFG.routineBatchMaxWaitSeconds - 1e-9)
      expect(loadingAt - arrived).toBeLessThan(CFG.routineBatchMaxWaitSeconds + 2 * DT)
    }
    // 24 routine tubes: the full rotor goes at once, well before the timer
    {
      const b = makeBench()
      for (let i = 0; i < 24; i++) b.inject({ panel: 'op-precontrast', priority: 'routine', source: i % 4 })
      let last = NaN
      let loadingAt = NaN
      let loaded = 0
      b.lab.trace = (_id, m, t) => {
        if (/^cfg\d$/.test(m)) last = t
      }
      b.run(900, (t) => {
        for (const c of b.lab.state.centrifuges)
          if (c.phase === 'loading' && Number.isNaN(loadingAt)) {
            loadingAt = t
          }
        for (const u of b.lab.units) loaded = Math.max(loaded, u.tubes.length)
      })
      expect(loaded).toBe(CFG.centrifugeCapacity)
      expect(loadingAt - last).toBeLessThan(2 * DT)
      expect(loadingAt).toBeLessThan(CFG.routineBatchMaxWaitSeconds)
    }
  })

  it('a STAT tube that arrives while a routine batch is waiting goes first, and a busy unit never takes more than its capacity', () => {
    const b = makeBench()
    for (let i = 0; i < 30; i++) b.inject({ panel: 'op-precontrast', priority: 'routine', source: i % 4 })
    const stat = b.inject({ panel: 'op-precontrast', priority: 'stat', source: 0 })
    let maxLoad = 0
    b.run(2400, () => {
      for (const c of b.lab.state.centrifuges) {
        maxLoad = Math.max(maxLoad, c.load)
        expect(c.load).toBeLessThanOrEqual(c.capacity)
        expect(c.rpm01).toBeGreaterThanOrEqual(0)
        expect(c.rpm01).toBeLessThanOrEqual(1)
        expect(c.lid).toBeGreaterThanOrEqual(0)
        expect(c.lid).toBeLessThanOrEqual(1)
        if (c.phase === 'idle') expect(c.program).toBeNull()
      }
    })
    const s = b.lab.samples.get(stat.sampleIds[0])!
    const routine = [...b.lab.samples.samples.values()].filter((x) => x.priority === 'routine')
    expect(s.stage).toBe('archived')
    // the STAT tube left the centrifuge long before the routine batch had even been spun
    const firstRoutineSpinOut = Math.min(...routine.map((x) => x.stageAt.decap!))
    expect(s.stageAt.decap!).toBeLessThan(firstRoutineSpinOut)
    expect(maxLoad).toBeGreaterThan(1)
    expect(routine.every((x) => x.stage === 'archived')).toBe(true)
  })

  it('a blood count analyser does at most 100 an hour, and saturates at about that', () => {
    const b = makeBench()
    const times: number[] = []
    let last = 0
    let maxQueue = 0
    const watch = () => {
      const a = b.lab.state.analysers.haematology
      while (last < a.testsToday) {
        times.push(b.world.t)
        last++
      }
      maxQueue = Math.max(maxQueue, a.queue)
      if (a.probe < 0 || a.probe > 1) throw new Error(`probe ${a.probe}`)
    }
    // 150 ward-routine orders (a blood count + a chemistry tube each), one every 5 s
    for (let i = 0; i < 150; i++) {
      b.run(5, watch)
      b.inject({ panel: 'ward-routine', priority: 'routine', source: i % 4 })
    }
    const t0 = b.world.t
    b.run(100 * 60, watch)
    expect(times.length).toBe(150)
    let worst = 0
    for (let i = 0; i < times.length; i++) {
      let n = 0
      for (let k = i; k < times.length && times[k] < times[i] + 3600; k++) n++
      worst = Math.max(worst, n)
    }
    expect(worst).toBeLessThanOrEqual(100)
    expect(worst).toBeGreaterThanOrEqual(97)
    expect(maxQueue).toBeGreaterThan(40)
    expect(b.world.t - t0).toBeGreaterThan(0)
    // every aspiration takes aspirateSeconds[haematology]
    const gaps: number[] = []
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1])
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(CFG.aspirateSeconds.haematology - 2 * DT)
  }, 120_000)
})

describe('the whole line under load', () => {
  it('keeps every invariant for two and a half hours of mixed STAT and routine tubes (gaps, slots, one tube in the pipe, where-lines)', () => {
    const b = makeBench(5, 1)
    const panels = Object.keys(LAB_CATALOGUE.panels)
    let n = 0
    let tick = 0
    const slotsRef = b.lab.state.slots
    const cfgRef = b.lab.state.centrifuges
    let maxOnLane = 0
    let maxSlots = 0
    const fail = (msg: string): never => {
      throw new Error(msg)
    }
    const stopInjecting = (1 - 7.5) * 3600 + 5400
    b.run(2.5 * 3600, () => {
      tick++
      if (tick % (60 * 70) === 0 && b.world.t < stopInjecting) b.inject({ panel: panels[n % panels.length], priority: n % 4 === 0 ? 'stat' : 'routine', source: n++ % 4 })
      const p = b.lab.lane.pucks
      for (let k = 1; k < p.length; k++) {
        const gap = p[k - 1].sample.where.s - p[k].sample.where.s
        if (gap < CFG.puckGap - 1e-6) fail(`pucks ${gap} m apart`)
      }
      if (p.length > maxOnLane) maxOnLane = p.length
      if (tick % 11 !== 0) return
      let onTrack = 0
      let flying = 0
      const seen = new Set<number>()
      for (const s of b.lab.samples.samples.values()) {
        const w = s.where
        if (w.line === 'track') {
          onTrack++
          if (w.s < 0 || w.s >= LAB_OUTBOUND_LENGTH) fail(`track position ${w.s}`)
        }
        if (b.lab.state.pneumatic.inFlight === s.id) flying++
        if (s.slot >= 0) {
          if (seen.has(s.slot)) fail(`slot ${s.slot} shared`)
          seen.add(s.slot)
          if (b.lab.state.slots[s.slot] !== s.id) fail(`slot ${s.slot} does not hold ${s.id}`)
        }
        if (s.stage === 'archived' && s.slot !== -1) fail('archived sample keeps a slot')
        if ((w.line === 'module') !== (w.module !== null)) fail(`where ${w.line} / ${w.module}`)
      }
      if (onTrack !== p.length) fail(`${onTrack} samples on the track, ${p.length} pucks`)
      if (flying > 1) fail('two tubes in the pipe')
      if (seen.size > maxSlots) maxSlots = seen.size
    })
    // the last tubes are still spinning or analysing: let the lab drain
    b.run(1800)
    expect(b.lab.state.slots).toBe(slotsRef)
    expect(b.lab.state.centrifuges).toBe(cfgRef)
    expect(b.lab.state.slots.length).toBe(64)
    expect(n).toBeGreaterThan(50)
    expect(maxOnLane).toBeGreaterThan(1)
    expect(maxSlots).toBeGreaterThan(5)
    const stuck = [...b.lab.samples.samples.values()].filter((s) => s.stage !== 'archived').map((s) => `${s.id} ${s.stage}`)
    expect(stuck).toEqual([])
    expect(b.lab.state.slots.every((x) => x === null)).toBe(true)
    // archive slots are unique and fill from 0
    const slots = [...b.lab.samples.samples.values()].map((s) => s.archiveSlot).sort((a, c) => a - c)
    expect(slots).toEqual(slots.map((_, i) => i))
    expect(b.lab.state.archived).toBe(slots.length)
  }, 120_000)

  it('bumps state.version when something a screen shows changes, and not while nothing happens', () => {
    const b = makeBench()
    b.run(60)
    const v0 = b.lab.state.version
    b.run(120)
    expect(b.lab.state.version).toBe(v0)
    b.inject({ panel: 'er-chest', priority: 'stat', kind: 'er' })
    b.run(10)
    expect(b.lab.state.version).toBeGreaterThan(v0)
    // a spin counts down on screen: the version moves about once a second while it runs
    let bumps = 0
    let last = b.lab.state.version
    b.run(120, () => {
      if (b.lab.state.version !== last) {
        bumps++
        last = b.lab.state.version
      }
    })
    expect(bumps).toBeGreaterThan(30)
    // render-only reads never bump it
    const v1 = b.lab.state.version
    b.lab.sync(0.3)
    b.lab.sync(0.9)
    expect(b.lab.state.version).toBe(v1)
    b.run(3 * 3600)
    expect([...b.lab.samples.samples.values()].every((s) => s.stage === 'archived')).toBe(true)
    const v2 = b.lab.state.version
    b.run(300)
    expect(b.lab.state.version).toBe(v2)
  })

  it('a long run of STAT tubes cannot starve a routine batch', () => {
    const b = makeBench(13, 1)
    const routine = b.inject({ panel: 'op-precontrast', priority: 'routine' })
    const sample = b.lab.samples.get(routine.sampleIds[0])!
    let stat = 0
    // one STAT tube every 20 s for 50 minutes keeps both units busy with 5.5 minute stat spins
    b.run(30)
    for (let i = 0; i < 150; i++) {
      b.inject({ panel: 'op-precontrast', priority: 'stat', source: i % 4 })
      stat++
      b.run(20)
    }
    b.run(3 * 3600)
    expect(stat).toBe(150)
    // it waited its limit twice over at most, then a spin of its own
    const wait = sample.stageAt.decap! - sample.stageAt.centrifuge!
    expect(wait).toBeLessThan(2 * CFG.routineBatchMaxWaitSeconds + RAMP_UP_SECONDS + CFG.spinSeconds.routine + BRAKE_SECONDS + 600)
    expect([...b.lab.samples.samples.values()].every((s) => s.stage === 'archived')).toBe(true)
  }, 60_000)

  it('interpolates the render position: sDraw lies between the previous and the current step, and equals s inside a module', () => {
    const b = makeBench()
    const o = b.inject({ panel: 'op-precontrast', priority: 'stat' })
    const s = b.lab.samples.get(o.sampleIds[0])!
    let checkedTrack = 0
    let checkedPipe = 0
    b.run(240, () => {
      const before = s.where.s
      b.lab.sync(0)
      const at0 = s.where.sDraw
      b.lab.sync(1)
      const at1 = s.where.sDraw
      b.lab.sync(0.5)
      const mid = s.where.sDraw
      if (s.where.line === 'track' || s.where.line === 'pneumatic') {
        expect(at1).toBeCloseTo(s.where.s, 9)
        expect(at0).toBeLessThanOrEqual(at1 + 1e-12)
        expect(mid).toBeCloseTo((at0 + at1) / 2, 9)
        if (s.where.line === 'track') checkedTrack++
        else checkedPipe++
      } else if (s.where.line === 'module') {
        expect(at0).toBe(s.where.s)
        expect(at1).toBe(s.where.s)
      }
      void before
    })
    expect(checkedTrack).toBeGreaterThan(20)
    expect(checkedPipe).toBeGreaterThan(20)
  })
})
