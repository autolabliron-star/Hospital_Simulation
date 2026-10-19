/**
 * The lab's sound pattern in node: the launch pop, the whoosh that sweeps up and down along the path, the arrival thunk, the centrifuge whine that
 * follows the rotor, the lid latch, the conveyor hum and its ticks, the analyser chirps, and that consecutive plan windows join without a gap or a repeat.
 */
import { describe, expect, it } from 'vitest'
import { newLabState } from '@/sim/lab'
import { labTrackPointInto, LAB_STOPS } from '@/sim/labTrack'
import { flightDuration, pathPointInto, PNEUMATIC_PATHS } from '@/sim/pneumaticPath'
import { PNEUMATIC } from '@/sim/places'
import { SampleBook } from '@/sim/samples'
import type { Sample } from '@/sim/types'
import {
  arrivalThunk,
  CHIRP_PERIOD_S,
  createLabPattern,
  launchPop,
  newLabSoundMemory,
  newLabSoundView,
  planLab,
  readLabSounds,
  stepperChirps,
  whoosh,
  WHOOSH_PIECES,
  type LabSoundSource,
} from './labPatterns'
import type { DeviceEvent, DroneSpec, PatternSink, PlanWindow } from './registry'

function window(from: number, len = 0.12, over: Partial<PlanWindow> = {}): PlanWindow {
  return { from, to: from + len, now: from - 0.01, simTime: 100, simSpeed: 1, listener: { x: -28, y: 1.6, z: 19 }, ...over }
}

class Sink implements PatternSink {
  events: DeviceEvent[] = []
  drones: DroneSpec[] = []
  event(e: DeviceEvent): void {
    this.events.push(e)
  }
  drone(d: DroneSpec): void {
    this.drones.push(d)
  }
  clear(): void {
    this.events = []
    this.drones = []
  }
}

function fakeLab() {
  const state = newLabState()
  const book = new SampleBook()
  const src: LabSoundSource & { book: SampleBook; put(slot: number, where: Partial<Sample['where']> & { line: Sample['where']['line'] }, flying?: boolean): Sample } = {
    state,
    samples: book,
    book,
    put(slot, where, flying = true) {
      const s = book.create({ orderId: 'o', patientId: 'p', tube: 'serum', cap: 'gold', tests: ['bmp'], priority: 'routine' }, 0)
      s.where = { s: 0, sDraw: 0, module: null, source: -1, ...where }
      s.slot = slot
      state.slots[slot] = s.id
      // a tube flies exactly while the sim's `inFlight` is its id (queued and landed tubes are on the pneumatic line too)
      if (where.line === 'pneumatic' && flying) state.pneumatic.inFlight = s.id
      return s
    },
  }
  return src
}

function plan(lab: LabSoundSource | null, mem: ReturnType<typeof newLabSoundMemory>, w: PlanWindow): Sink {
  const sink = new Sink()
  planLab(readLabSounds(lab, newLabSoundView()), mem, w, sink)
  return sink
}

describe('the pneumatic tube sounds', () => {
  it('pops at the launch riser, then whooshes for the whole flight, once per tube', () => {
    const lab = fakeLab()
    const mem = newLabSoundMemory()
    expect(plan(lab, mem, window(10)).events).toEqual([])
    const s = lab.put(0, { line: 'pneumatic', source: 1, sDraw: 0.1 })
    const first = plan(lab, mem, window(10.12))
    const pop = first.events.filter((e) => e.kind === 'tone' && e.f1 < e.f0 && e.dur < 0.1)
    expect(pop.length).toBe(1)
    const src = PNEUMATIC.sources[1]
    expect(pop[0].at!.x).toBeCloseTo(src.x, 6)
    expect(pop[0].at!.z).toBeCloseTo(src.z, 6)
    const swoosh = first.events.filter((e) => e.kind === 'noise' && e.q === 0.7)
    expect(swoosh.length).toBe(WHOOSH_PIECES)
    // the same tube still flying the next windows: nothing new
    s.where.sDraw = 4
    expect(plan(lab, mem, window(10.24)).events).toEqual([])
    expect(plan(lab, mem, window(10.36)).events).toEqual([])
  })

  it('the whoosh sweeps up and then down, follows the tube along its path, and is as long as the flight (shorter at 4x)', () => {
    for (const source of [0, 1, 2, 3]) {
      const path = PNEUMATIC_PATHS[source]
      const real = flightDuration(path.length)
      const pieces = whoosh(50, source, real)
      expect(pieces.length).toBe(WHOOSH_PIECES)
      // the band rises over the first half and falls over the second
      const mids = pieces.map((p) => (p.f0 + p.f1) / 2)
      const half = WHOOSH_PIECES / 2
      for (let i = 1; i < half; i++) expect(mids[i]).toBeGreaterThan(mids[i - 1])
      for (let i = half + 1; i < WHOOSH_PIECES; i++) expect(mids[i]).toBeLessThan(mids[i - 1])
      expect(mids[half - 1]).toBeCloseTo(mids[half], 6) // the sweep peaks in the middle of the flight
      // in time order, spread over the flight
      for (let i = 1; i < pieces.length; i++) expect(pieces[i].t).toBeGreaterThan(pieces[i - 1].t)
      expect(pieces[pieces.length - 1].t + pieces[pieces.length - 1].dur).toBeGreaterThanOrEqual(50 + real - 1e-9)
      expect(pieces[pieces.length - 1].t + pieces[pieces.length - 1].dur).toBeLessThan(50 + real * 1.35 + 1e-9)
      // each piece sits on the path, from the riser to the hood
      const ends = [pathPointInto(source, 0, { x: 0, y: 0, z: 0 }), pathPointInto(source, path.length, { x: 0, y: 0, z: 0 })]
      expect(Math.hypot(pieces[0].at!.x - ends[0].x, pieces[0].at!.z - ends[0].z)).toBeLessThan(path.length / 3)
      expect(Math.hypot(pieces[5].at!.x - ends[1].x, pieces[5].at!.z - ends[1].z)).toBeLessThan(path.length / 3)
      for (const p of pieces) expect(p.peak).toBeLessThanOrEqual(0.5)
    }
    // four times the speed, a quarter of the real time
    const lab = fakeLab()
    lab.put(0, { line: 'pneumatic', source: 1, sDraw: 0.1 })
    const slow = plan(lab, newLabSoundMemory(), window(10, 0.12, { simSpeed: 1 })).events.filter((e) => e.kind === 'noise' && e.q === 0.7)
    const fast = plan(lab, newLabSoundMemory(), window(10, 0.12, { simSpeed: 4 })).events.filter((e) => e.kind === 'noise' && e.q === 0.7)
    const spanOf = (es: DeviceEvent[]) => es[es.length - 1].t - es[0].t
    expect(spanOf(fast) / spanOf(slow)).toBeCloseTo(0.25, 2)
    // paused demos still whoosh at a sane length (quarter speed floor), never forever
    const paused = plan(lab, newLabSoundMemory(), window(10, 0.12, { simSpeed: 0 })).events.filter((e) => e.kind === 'noise' && e.q === 0.7)
    expect(spanOf(paused)).toBeCloseTo(spanOf(slow) * 4, 2)
  })

  it('thunks once, at the receive hood, when the tube is gone from the pipe', () => {
    const lab = fakeLab()
    const mem = newLabSoundMemory()
    const s = lab.put(0, { line: 'pneumatic', source: 2, sDraw: 3 })
    plan(lab, mem, window(10))
    expect(plan(lab, mem, window(10.12)).events).toEqual([])
    s.where = { line: 'track', s: 0, sDraw: 0, module: null, source: 2 }
    lab.state.pneumatic.inFlight = null
    const landed = plan(lab, mem, window(10.24))
    const thunk = landed.events.filter((e) => e.kind === 'tone' && e.f0 < 130)
    expect(thunk.length).toBe(1)
    const end = PNEUMATIC.trunk[PNEUMATIC.trunk.length - 1]
    expect(thunk[0].at!.x).toBeCloseTo(end.x, 6)
    expect(thunk[0].at!.z).toBeCloseTo(end.z, 6)
    expect(plan(lab, mem, window(10.36)).events.filter((e) => e.kind === 'tone' && e.f0 < 130)).toEqual([])
    // a second tube sets it off again
    lab.put(1, { line: 'pneumatic', source: 0, sDraw: 0.1 })
    expect(plan(lab, mem, window(11)).events.length).toBeGreaterThan(5)
  })

  it('sounds only the tube the sim says is flying: queued and landed tubes on the pneumatic line make no pop or thunk', () => {
    const lab = fakeLab()
    const mem = newLabSoundMemory()
    lab.put(0, { line: 'pneumatic', source: 0, sDraw: 0 }, false) // queued at its riser
    lab.put(1, { line: 'pneumatic', source: 1, sDraw: PNEUMATIC_PATHS[1].length }, false) // landed in the hood
    expect(plan(lab, mem, window(10)).events).toEqual([])
    expect(plan(lab, mem, window(10.12)).events).toEqual([])
    // and the tube that lands (inFlight goes null) thunks once at that moment, not when the sorter later takes it
    lab.state.pneumatic.inFlight = lab.state.slots[0]
    expect(plan(lab, mem, window(10.24)).events.length).toBeGreaterThan(5)
    lab.state.pneumatic.inFlight = null
    expect(plan(lab, mem, window(10.36)).events.filter((e) => e.kind === 'tone' && e.f0 < 130).length).toBe(1)
  })

  it('has the pop and the thunk as short, low, loud-enough voices', () => {
    const at = { x: 0, y: 0, z: 0 }
    for (const e of [...launchPop(1, at), ...arrivalThunk(1, at)]) {
      expect(e.peak).toBeGreaterThan(0.2)
      expect(e.peak).toBeLessThanOrEqual(1)
      expect(e.dur).toBeLessThan(0.2)
    }
  })
})

describe('the centrifuge sounds', () => {
  it('whines with the rotor: higher and louder as it speeds up, silent at rest, muffled with the lid shut, one voice per centrifuge', () => {
    const lab = fakeLab()
    const mem = newLabSoundMemory()
    expect(plan(lab, mem, window(5)).drones.filter((d) => d.id.startsWith('lab:cfg'))).toEqual([])
    const levels: number[] = []
    const hz: number[] = []
    for (const rpm of [0.1, 0.4, 0.7, 1]) {
      lab.state.centrifuges[0].rpm01 = rpm
      const d = plan(lab, mem, window(5)).drones.find((q) => q.id === 'lab:cfg0')!
      expect(d.voice).toBe('whine')
      levels.push(d.level)
      hz.push(d.hz)
    }
    for (let i = 1; i < 4; i++) {
      expect(levels[i]).toBeGreaterThan(levels[i - 1])
      expect(hz[i]).toBeGreaterThan(hz[i - 1])
    }
    expect(Math.max(...levels)).toBeLessThanOrEqual(0.5)
    // lid open: louder than shut
    lab.state.centrifuges[0].lid = 1
    const open = plan(lab, mem, window(5)).drones.find((q) => q.id === 'lab:cfg0')!
    expect(open.level).toBeGreaterThan(levels[3])
    // the other centrifuge makes no sound while it is at rest, and has its own id
    lab.state.centrifuges[1].rpm01 = 0.5
    const both = plan(lab, mem, window(5)).drones.filter((q) => q.id.startsWith('lab:cfg')).map((q) => q.id)
    expect(both.sort()).toEqual(['lab:cfg0', 'lab:cfg1'])
  })

  it('clicks when a lid shuts (with a thump) and when it opens, once each', () => {
    const lab = fakeLab()
    const mem = newLabSoundMemory()
    plan(lab, mem, window(1))
    lab.state.centrifuges[1].lid = 0.5
    const opened = plan(lab, mem, window(1.12))
    expect(opened.events.length).toBe(1)
    expect(opened.events[0].kind).toBe('noise')
    expect(plan(lab, mem, window(1.24)).events).toEqual([])
    lab.state.centrifuges[1].lid = 0
    const shut = plan(lab, mem, window(1.36))
    expect(shut.events.length).toBe(2)
    expect(shut.events.some((e) => e.kind === 'tone' && e.f1 < e.f0)).toBe(true)
    expect(plan(lab, mem, window(1.48)).events).toEqual([])
    // positioned at that centrifuge
    expect(shut.events[0].at!.z).toBeGreaterThan(18.3)
    expect(shut.events[0].at!.z).toBeLessThan(19.2)
  })
})

describe('the conveyor sounds', () => {
  it('hums all the time, a little louder with more tubes on the belt', () => {
    const lab = fakeLab()
    const mem = newLabSoundMemory()
    const hum = (): DroneSpec => plan(lab, mem, window(2)).drones.find((d) => d.id === 'lab:belt')!
    const empty = hum()
    expect(empty.voice).toBe('hum')
    expect(empty.level).toBeGreaterThan(0)
    for (let i = 0; i < 6; i++) lab.put(i, { line: 'track', sDraw: 1 + i })
    expect(hum().level).toBeGreaterThan(empty.level)
    for (let i = 6; i < 20; i++) lab.put(i, { line: 'track', sDraw: 1 + i * 0.3 })
    expect(hum().level).toBeLessThanOrEqual(0.4)
  })

  it('ticks once as a tube passes each module\'s stop, at that stop, and not for a tube that stays put or jumps', () => {
    const lab = fakeLab()
    const mem = newLabSoundMemory()
    const s = lab.put(0, { line: 'track', sDraw: LAB_STOPS.cfg1 - 0.05 })
    plan(lab, mem, window(3))
    s.where.sDraw = LAB_STOPS.cfg1 + 0.05
    const tick = plan(lab, mem, window(3.12))
    expect(tick.events.length).toBe(1)
    const stop = labTrackPointInto(LAB_STOPS.cfg1, { x: 0, z: 0 })
    expect(tick.events[0].at!.x).toBeCloseTo(stop.x, 6)
    expect(tick.events[0].at!.z).toBeCloseTo(stop.z, 6)
    // staying put, or moving between stops: silent
    expect(plan(lab, mem, window(3.24)).events).toEqual([])
    s.where.sDraw += 0.2
    expect(plan(lab, mem, window(3.36)).events).toEqual([])
    // a jump (a Jump, or a long pause): a metre and a half or more is not a pass
    s.where.sDraw = LAB_STOPS.immuno + 0.1
    expect(plan(lab, mem, window(3.48)).events).toEqual([])
    // a lap: the position wraps back to small: nothing
    s.where.sDraw = 0.1
    expect(plan(lab, mem, window(3.6)).events).toEqual([])
    // a brand new tube is not a pass either
    lab.put(1, { line: 'track', sDraw: LAB_STOPS.haem + 0.05 })
    expect(plan(lab, mem, window(3.72)).events).toEqual([])
  })

  it('two tubes passing two stops in one window tick in the order of the stops, without stacking on one instant', () => {
    const lab = fakeLab()
    const mem = newLabSoundMemory()
    const a = lab.put(0, { line: 'track', sDraw: LAB_STOPS.camera - 0.05 })
    const b = lab.put(1, { line: 'track', sDraw: LAB_STOPS.decap - 0.05 })
    plan(lab, mem, window(1))
    a.where.sDraw += 0.1
    b.where.sDraw += 0.1
    const out = plan(lab, mem, window(1.12))
    expect(out.events.length).toBe(2)
    expect(out.events[1].t).toBeGreaterThan(out.events[0].t)
  })
})

describe('the analyser sounds', () => {
  const chirps = (es: DeviceEvent[]) => es.filter((e) => e.kind === 'tone' && e.wave === 'square' && e.f0 > 2000)

  it('chirps only while an analyser works, three rising blips at a time, at that analyser', () => {
    const lab = fakeLab()
    const mem = newLabSoundMemory()
    expect(chirps(plan(lab, mem, window(0, 3)).events)).toEqual([])
    lab.state.analysers.chemistry.aspirating = 'S1'
    const burst = chirps(plan(lab, mem, window(0, 3)).events)
    expect(burst.length).toBe(3 * Math.ceil(3 / CHIRP_PERIOD_S))
    expect(burst[0].f0).toBeLessThan(burst[1].f0)
    expect(burst[1].f0).toBeLessThan(burst[2].f0)
    // chemistry sits at x -28.05 on the south bench
    for (const e of burst) expect(e.at!.x).toBeCloseTo(-28.05, 1)
    lab.state.analysers.chemistry.aspirating = null
    expect(chirps(plan(lab, mem, window(0, 3)).events)).toEqual([])
    // a running analyser (not aspirating this instant) still chirps
    lab.state.analysers.haematology.running = 1
    expect(chirps(plan(lab, mem, window(0, 3)).events).length).toBeGreaterThan(0)
  })

  it('has chirps that join across plan windows with no gap and no repeat, whatever the window length', () => {
    const lab = fakeLab()
    lab.state.analysers.immunoassay.running = 2
    const whole = chirps(plan(lab, newLabSoundMemory(), window(20, 6)).events).map((e) => e.t)
    for (const step of [0.05, 0.12, 0.2]) {
      const pat = createLabPattern(() => lab)
      const got: number[] = []
      for (let from = 20; from < 26 - 1e-9; from += step) {
        const sink = new Sink()
        pat.plan(window(from, Math.min(step, 26 - from)), sink)
        got.push(...chirps(sink.events).map((e) => e.t))
      }
      expect(got.length, `step ${step}`).toBe(whole.length)
      got.sort((x, y) => x - y)
      whole.slice().sort((x, y) => x - y).forEach((t, i) => expect(got[i]).toBeCloseTo(t, 9))
    }
    // the three blips of a burst are 60 ms apart; bursts are 0.62 s apart
    const starts = whole.filter((_, i) => i % 3 === 0)
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(CHIRP_PERIOD_S, 9)
    expect(stepperChirps(0, { x: 0, y: 0, z: 0 }).map((e) => e.t)).toEqual([0, 0.06, 0.12])
  })

  it('whirrs while a probe moves, and not while it holds still', () => {
    const lab = fakeLab()
    const mem = newLabSoundMemory()
    plan(lab, mem, window(0))
    lab.state.analysers.coagulation.probe = 0.3
    const whirr = (es: DeviceEvent[]) => es.filter((e) => e.kind === 'tone' && e.f1 > e.f0 && e.wave === 'square')
    expect(whirr(plan(lab, mem, window(0.12)).events).length).toBe(1)
    expect(whirr(plan(lab, mem, window(0.24)).events).length).toBe(0)
    lab.state.analysers.coagulation.probe = 0.6
    expect(whirr(plan(lab, mem, window(0.36)).events).length).toBe(1)
  })
})

describe('the lab pattern as the engine sees it', () => {
  it('is a registered-shape pattern with an id, silent without a lab, and survives a lab that vanishes (a Jump)', () => {
    let lab: LabSoundSource | null = null
    const pat = createLabPattern(() => lab)
    expect(pat.id).toBe('lab')
    const sink = new Sink()
    expect(() => pat.plan(window(1), sink)).not.toThrow()
    // only the conveyor's low hum with nothing in the lab
    expect(sink.events).toEqual([])
    expect(sink.drones.map((d) => d.id)).toEqual(['lab:belt'])
    lab = fakeLab()
    lab.state.centrifuges[0].rpm01 = 0.5
    sink.clear()
    pat.plan(window(1.12), sink)
    expect(sink.drones.map((d) => d.id).sort()).toEqual(['lab:belt', 'lab:cfg0'])
    lab = null
    expect(() => pat.plan(window(1.24), new Sink())).not.toThrow()
  })
})
