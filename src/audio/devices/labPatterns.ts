/**
 * The lab's device sounds (W4), as a pure pattern for the device engine (engine.ts): no Web Audio, no React and no sim singleton here, so the whole
 * thing runs under vitest in node. `createLabPattern(read)` is the pattern; DeviceSounds.tsx supplies `read` (the live `sim.lab`).
 *
 *   pneumatic tube   a launch pop at the robot's riser, a whoosh of band-passed noise that sweeps up and then down while the tube travels (in six
 *                    pieces, each at the tube's place on its path, so it moves through the building), and an arrival thunk at the receive hood
 *   centrifuges      a whine that follows the rotor's speed (muffled while the lid is shut), a latch click when a lid shuts, an unlatch when it opens
 *   conveyor         a low hum (a little louder with more tubes on the belt) and a tick as each tube passes a module's stop
 *   analysers        stepper chirps while an analyser works, a short whirr while its probe moves
 *
 * One-shots are edges (a tube appears in the pipe, a lid crosses its latch point, a tube crosses a stop): the pattern remembers the last state it
 * saw. The chirps are periodic on the audio clock (src/audio/devices/registry.ts `periodic`), so consecutive windows join with no gap and no repeat.
 */
import { centrifuge, PROBE_IDS, probeAt } from '@/scene/lab/labDims'
import { LAB_STOPS, labTrackPointInto } from '@/sim/labTrack'
import { flightDistance, flightDuration, pathPointInto, PNEUMATIC_PATHS } from '@/sim/pneumaticPath'
import { PNEUMATIC } from '@/sim/places'
import type { AnalyserKind, LabState, Sample, Vec3 } from '@/sim/types'
import { blip, click, periodic, type DevicePattern, type NoiseEvent, type PatternSink, type PlanWindow, type ToneEvent } from './registry'

const ANALYSER_KIND = { haem: 'haematology', chem: 'chemistry', immuno: 'immunoassay', coag: 'coagulation' } as const satisfies Record<(typeof PROBE_IDS)[number], AnalyserKind>

/** What the lab sounds read of the lab service (the sim's `Lab` satisfies it). */
export interface LabSoundSource {
  state: LabState
  samples: { get(id: string): Sample | undefined }
}

/** A flat view of the lab for the sounds: no allocation after construction except the track list's growth. */
export interface LabSoundView {
  flight: { id: string; source: number } | null
  rpm01: [number, number]
  lid: [number, number]
  /** Tubes on the belt: their ids and distances along the loop. */
  trackIds: string[]
  trackS: number[]
  trackCount: number
  /** Per analyser (haem, chem, immuno, coag): working, and the probe's dip. */
  busy: boolean[]
  probe: number[]
}

export function newLabSoundView(): LabSoundView {
  return { flight: null, rpm01: [0, 0], lid: [0, 0], trackIds: [], trackS: [], trackCount: 0, busy: [false, false, false, false], probe: [0, 0, 0, 0] }
}

/** Read the lab's state into `out`. */
export function readLabSounds(lab: LabSoundSource | null, out: LabSoundView): LabSoundView {
  out.flight = null
  out.trackCount = 0
  if (!lab) {
    out.rpm01[0] = out.rpm01[1] = out.lid[0] = out.lid[1] = 0
    out.busy.fill(false)
    out.probe.fill(0)
    return out
  }
  const st = lab.state
  for (let i = 0; i < 2; i++) {
    out.rpm01[i] = st.centrifuges[i].rpm01
    out.lid[i] = st.centrifuges[i].lid
  }
  PROBE_IDS.forEach((id, i) => {
    const a = st.analysers[ANALYSER_KIND[id]]
    out.busy[i] = a.aspirating !== null || a.running > 0
    out.probe[i] = a.probe
  })
  // a tube flies exactly while `state.pneumatic.inFlight` is its id (queued and landed tubes also sit on the pneumatic line)
  const fid = st.pneumatic.inFlight
  const flying = fid ? lab.samples.get(fid) : undefined
  if (flying) out.flight = { id: flying.id, source: flying.where.source }
  for (let i = 0; i < st.slots.length; i++) {
    const id = st.slots[i]
    const s = id ? lab.samples.get(id) : undefined
    if (!s) continue
    if (s.where.line === 'track') {
      out.trackIds[out.trackCount] = s.id
      out.trackS[out.trackCount] = s.where.sDraw
      out.trackCount++
    }
  }
  return out
}

/** What the pattern remembers between plans. */
export interface LabSoundMemory {
  flightId: string | null
  lidOpen: [boolean, boolean]
  probe: number[]
  lastS: Map<string, number>
}
export function newLabSoundMemory(): LabSoundMemory {
  return { flightId: null, lidOpen: [false, false], probe: [0, 0, 0, 0], lastS: new Map() }
}

// ---------------------------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------------------------

const CFG_AT: readonly Vec3[] = [0, 1].map((i) => {
  const c = centrifuge(i)
  return { x: c.cx, y: 1.0, z: c.cz }
})
const PROBE_AT: readonly Vec3[] = PROBE_IDS.map((id) => {
  const p = probeAt(id)
  return { x: p.x, y: 1.1, z: p.z }
})
const BELT_AT: Vec3 = { x: -28.0, y: 0.9, z: 19.0 }
const RECEIVE_AT: Vec3 = { ...PNEUMATIC.trunk[PNEUMATIC.trunk.length - 1] }
const STOPS: readonly { s: number; at: Vec3 }[] = Object.entries(LAB_STOPS).map(([, s]) => {
  const p = labTrackPointInto(s, { x: 0, z: 0 })
  return { s, at: { x: p.x, y: 0.95, z: p.z } }
})

// ---------------------------------------------------------------------------------------------
// The voices
// ---------------------------------------------------------------------------------------------

/** The pop of a tube leaving its riser: a quick low thump and a puff of air. */
export function launchPop(t: number, at: Vec3): (ToneEvent | NoiseEvent)[] {
  return [
    { kind: 'tone', t, f0: 190, f1: 60, dur: 0.09, peak: 0.6, wave: 'sine', attack: 0.003, at },
    { kind: 'noise', t, f0: 900, f1: 500, q: 0.8, dur: 0.06, peak: 0.45, attack: 0.002, at },
  ]
}

/** The arrival of a tube in the receive hood: a dull thunk and a small clack. */
export function arrivalThunk(t: number, at: Vec3): (ToneEvent | NoiseEvent)[] {
  return [
    { kind: 'tone', t, f0: 120, f1: 45, dur: 0.16, peak: 0.75, wave: 'sine', attack: 0.003, at },
    click(t + 0.012, 1300, 0.5, at),
  ]
}

/** Pieces in a whoosh. */
export const WHOOSH_PIECES = 6

/**
 * The whoosh of a flight from source `source`: noise whose band sweeps from low up to high and back down over the flight, in `WHOOSH_PIECES` pieces,
 * each at the tube's place on the path at that moment (the sim's own flight profile). `real` is the flight's length in real seconds (the sim's
 * flight time divided by the demo's speed).
 */
export function whoosh(t0: number, source: number, real: number): NoiseEvent[] {
  const path = PNEUMATIC_PATHS[source]
  const total = flightDuration(path.length)
  const out: NoiseEvent[] = []
  const p = { x: 0, y: 0, z: 0 }
  const band = (f: number): number => 450 + 2300 * Math.sin(Math.PI * f)
  for (let i = 0; i < WHOOSH_PIECES; i++) {
    const a = i / WHOOSH_PIECES
    const b = (i + 1) / WHOOSH_PIECES
    const mid = (a + b) / 2
    pathPointInto(source, flightDistance(path.length, mid * total), p)
    out.push({
      kind: 'noise',
      t: t0 + a * real,
      f0: band(a),
      f1: band(b),
      q: 0.7,
      dur: (real / WHOOSH_PIECES) * 1.35,
      peak: 0.1 + 0.32 * Math.sin(Math.PI * mid),
      attack: 0.02,
      at: { x: p.x, y: p.y, z: p.z },
    })
  }
  return out
}

/** Three quick rising chirps: an analyser's stepper working. */
export function stepperChirps(t: number, at: Vec3): ToneEvent[] {
  return [2300, 2650, 3000].map((hz, i) => blip(t + i * 0.06, hz, 0.035, 0.16, at, 'square'))
}

/** How often an analyser chirps while it works, and the offset of each analyser so they never chirp in unison. */
export const CHIRP_PERIOD_S = 0.62
export const CHIRP_OFFSET_S = 0.17

// ---------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------

/** Plan the window `w` from the lab's view, remembering what was seen in `mem`. One-shots are edges; chirps are periodic on the audio clock. */
export function planLab(view: LabSoundView, mem: LabSoundMemory, w: PlanWindow, out: PatternSink): void {
  const t0 = w.from + 0.004
  const speed = w.simSpeed > 0.25 ? w.simSpeed : 0.25

  // ----- the pneumatic tube -----
  const flightId = view.flight ? view.flight.id : null
  if (view.flight && flightId !== mem.flightId) {
    const src = PNEUMATIC.sources[view.flight.source]
    if (src) {
      for (const e of launchPop(t0, { x: src.x, y: src.y + 0.3, z: src.z })) out.event(e)
      const real = flightDuration(PNEUMATIC_PATHS[view.flight.source].length) / speed
      for (const e of whoosh(t0 + 0.03, view.flight.source, real)) out.event(e)
    }
  }
  if (mem.flightId !== null && flightId !== mem.flightId) for (const e of arrivalThunk(t0, RECEIVE_AT)) out.event(e)
  mem.flightId = flightId

  // ----- the centrifuges -----
  for (let i = 0; i < 2; i++) {
    const rpm = view.rpm01[i]
    if (rpm > 0.02) {
      const muffle = 0.55 + 0.45 * Math.min(1, view.lid[i] * 3)
      out.drone({ id: `lab:cfg${i}`, voice: 'whine', hz: 150 + 520 * rpm, level: 0.34 * Math.pow(rpm, 1.3) * muffle, at: CFG_AT[i] })
    }
    const open = view.lid[i] > 0.04
    if (open !== mem.lidOpen[i]) {
      mem.lidOpen[i] = open
      if (open) out.event(click(t0, 1700, 0.4, CFG_AT[i]))
      else {
        out.event(click(t0, 2400, 0.55, CFG_AT[i]))
        out.event({ kind: 'tone', t: t0, f0: 140, f1: 90, dur: 0.07, peak: 0.35, wave: 'sine', attack: 0.003, at: CFG_AT[i] })
      }
    }
  }

  // ----- the conveyor -----
  out.drone({ id: 'lab:belt', voice: 'hum', hz: 58, level: 0.08 + 0.025 * Math.min(view.trackCount, 8), at: BELT_AT })
  let ticks = 0
  const seen = new Set<string>()
  for (let i = 0; i < view.trackCount; i++) {
    const id = view.trackIds[i]
    const s = view.trackS[i]
    seen.add(id)
    const prev = mem.lastS.get(id)
    mem.lastS.set(id, s)
    if (prev === undefined || s - prev > 1.5 || s < prev) continue
    for (const stop of STOPS) {
      if (prev < stop.s && s >= stop.s) out.event(click(t0 + 0.012 * ticks++, 1900, 0.32, stop.at))
    }
  }
  for (const id of mem.lastS.keys()) if (!seen.has(id)) mem.lastS.delete(id)

  // ----- the analysers -----
  for (let i = 0; i < PROBE_IDS.length; i++) {
    if (view.busy[i]) {
      periodic(w.from, w.to, CHIRP_PERIOD_S, CHIRP_OFFSET_S * i, (t) => {
        for (const e of stepperChirps(t, PROBE_AT[i])) out.event(e)
      })
    }
    if (Math.abs(view.probe[i] - mem.probe[i]) > 0.004) out.event({ kind: 'tone', t: t0, f0: 1800, f1: 2600, dur: 0.05, peak: 0.12, wave: 'square', attack: 0.004, at: PROBE_AT[i] })
    mem.probe[i] = view.probe[i]
  }
}

/** The lab pattern: `read` returns the live lab service (or null before it exists). */
export function createLabPattern(read: () => LabSoundSource | null): DevicePattern {
  const view = newLabSoundView()
  const mem = newLabSoundMemory()
  return {
    id: 'lab',
    plan(w, out) {
      planLab(readLabSounds(read(), view), mem, w, out)
    },
  }
}

/** Where the lab's voices sit (for the tests and the probe). */
export const LAB_SOUND_PLACES = { cfg: CFG_AT, probes: PROBE_AT, belt: BELT_AT, receive: RECEIVE_AT } as const
