/**
 * The sounds of the entrance health kiosks, as pure patterns for the device-sound engine (registry.ts, engine.ts): no Web Audio and no React, so they
 * run (and are tested) in node. A tracker looks at each kiosk's state between two plans and says what to start: sounds that mark an edge (a phase begins
 * or ends) start at the front of the plan window, sounds that run while something happens (the cuff pumping up, the cuff letting go, the printer) are
 * periodic on the audio clock, so consecutive windows join with no gap and no repeat.
 *
 *   touch beep           login (the card or QR is read) and the thermometer's beep when the forehead scan is done
 *   prompt chime         a soft two-note chime as a new step asks something of you (height, handles, take a seat, temperature)
 *   settled double-beep  the scale has settled: the weight is in (the weighing step ends)
 *   BP pump buzz         a low motor buzz while the cuff inflates (blood-pressure step, cuff rising)
 *   BP hiss and ticks    the air letting go, with a tick for every heartbeat as the cuff falls
 *   done beep            the reading is done (the rest after a cuff reading) and the report is ready
 *   printer burst        the thermal printer whirrs, and its head ticks, while the slip comes out (report)
 *
 * The engine decides whether anything is audible: each sound comes from the tower (a world position) and falls off with distance and walls. The first
 * look only learns the state, so nothing starts at load, and a quiet lobby makes no events. `devicePatterns` is what the engine's glob registers;
 * `KIOSK_SOUNDS` lists the named sound builders for whoever wants one on its own.
 */
import { HEALTH_KIOSKS } from '@/sim/places'
import type { HealthKioskPhase, HealthKioskState, Vec3 } from '@/sim/types'
import { blip, click, periodic, type DeviceEvent, type DevicePattern, type PatternSink, type PlanWindow } from './registry'

/** Where a kiosk's sounds come from: the tower's face, at chest height. */
export const kioskSoundAt = (index: number): Vec3 => {
  const k = HEALTH_KIOSKS[index]
  return { x: k.tower.x, y: 1.2, z: k.tower.z - 0.3 }
}
const AT: readonly Vec3[] = HEALTH_KIOSKS.map((_, i) => kioskSoundAt(i))

// ---------------------------------------------------------------------------------------------
// The sounds
// ---------------------------------------------------------------------------------------------

/** The slip prints for this long (audio seconds), a head tick every `PRINT_TICK_S`, starting `PRINT_DELAY_S` after the report's done beep. */
export const PRINT_S = 1.1
export const PRINT_TICK_S = 0.045
export const PRINT_DELAY_S = 0.4

/** A short, bright beep: the card or code was read, a touch was taken. */
export function touchBeep(t: number, at: Vec3 | null = null): DeviceEvent[] {
  return [blip(t, 1568, 0.07, 0.22, at, 'sine'), blip(t + 0.001, 3136, 0.04, 0.05, at, 'sine')]
}

/** The scale has settled: two quick beeps. */
export function settledBeeps(t: number, at: Vec3 | null = null): DeviceEvent[] {
  return [blip(t, 988, 0.09, 0.24, at, 'triangle'), blip(t + 0.15, 988, 0.12, 0.24, at, 'triangle')]
}

/** The kiosk's voice prompt without the voice: two soft rising notes (G5, D6). */
export function promptChime(t: number, at: Vec3 | null = null): DeviceEvent[] {
  return [blip(t, 784, 0.34, 0.16, at, 'sine'), blip(t + 0.13, 1174.7, 0.5, 0.15, at, 'sine')]
}

/** One pulse of the cuff's pump: a low buzz with a little motor noise on top. */
export function pumpBuzz(t: number, at: Vec3 | null = null): DeviceEvent[] {
  return [
    { kind: 'tone', t, f0: 108, f1: 124, dur: 0.17, peak: 0.13, wave: 'sawtooth', attack: 0.01, at },
    { kind: 'noise', t, f0: 700, f1: 1100, q: 0.9, dur: 0.15, peak: 0.07, attack: 0.01, at },
  ]
}

/** One breath of the cuff letting go: a band of air that falls in pitch. */
export function deflationHiss(t: number, at: Vec3 | null = null): DeviceEvent[] {
  return [{ kind: 'noise', t, f0: 5200, f1: 3000, q: 0.7, dur: 0.3, peak: 0.1, attack: 0.02, at }]
}

/** One heartbeat felt by the cuff as it lets go: a tiny tick. */
export function pulseTick(t: number, at: Vec3 | null = null): DeviceEvent[] {
  return [click(t, 1800, 0.18, at)]
}

/** The reading is done: a short high note and a longer, lower one (C6, G6). */
export function doneBeep(t: number, at: Vec3 | null = null): DeviceEvent[] {
  return [blip(t, 1046.5, 0.16, 0.22, at, 'sine'), blip(t + 0.17, 1568, 0.38, 0.22, at, 'sine')]
}

/** The thermal printer's motor: a band of noise for the length of the slip. */
export function printerWhirr(t: number, dur = PRINT_S, at: Vec3 | null = null): DeviceEvent[] {
  return [{ kind: 'noise', t, f0: 1400, f1: 2600, q: 0.9, dur, peak: 0.11, attack: 0.02, at }]
}

/** One tick of the print head, every few millimetres of paper. */
export function printerTick(t: number, at: Vec3 | null = null): DeviceEvent[] {
  return [click(t, 2900, 0.1, at)]
}

/** The whole burst at once (the whirr and every tick), for a caller that has no clock of its own; the tracker spreads the ticks over the audio clock instead. */
export function printerBurst(t: number, dur = PRINT_S, at: Vec3 | null = null): DeviceEvent[] {
  const out = printerWhirr(t, dur, at)
  const ticks = Math.max(1, Math.floor(dur / PRINT_TICK_S))
  for (let i = 0; i < ticks; i++) out.push(...printerTick(t + i * PRINT_TICK_S, at))
  return out
}

export const KIOSK_SOUNDS = { touchBeep, settledBeeps, promptChime, pumpBuzz, deflationHiss, pulseTick, doneBeep, printerWhirr, printerTick, printerBurst } as const

// ---------------------------------------------------------------------------------------------
// The tracker
// ---------------------------------------------------------------------------------------------

/** Steps that ask something of you: they get the prompt chime when they begin. */
export const PROMPT_PHASES: ReadonlySet<HealthKioskPhase> = new Set<HealthKioskPhase>(['height', 'bodyFat', 'sit', 'temp'])

/** The pump pulses this often while the cuff inflates, the air breathes this often while it lets go (audio seconds). */
export const PUMP_PERIOD_S = 0.16
export const HISS_PERIOD_S = 0.3
/** The pulse used for the ticks when the reading has none yet (beats per minute). */
export const DEFAULT_PULSE = 72
/** The cuff must move this far to latch a direction (it creeps by thousandths per plan), and counts as full above `CUFF_FULL`. */
const CUFF_STEP = 0.004
const CUFF_FULL = 0.999
const CUFF_EMPTY = 0.02

interface Memory {
  phase: HealthKioskPhase
  cuff: number
  /** +1 the cuff is inflating, -1 it is letting go, 0 neither. */
  dir: number
  /** The audio times the slip prints between (print head ticks run on the audio clock, a few per plan, never all at once). */
  printFrom: number
  printTo: number
}

export class KioskSoundTracker {
  private readonly mem: Memory[] = []
  private primed = false

  /** Look at the kiosks for the plan window `w`; what to start goes to `out`. The first look only learns the state. */
  step(kiosks: readonly HealthKioskState[], w: PlanWindow, out: PatternSink): void {
    for (let i = 0; i < kiosks.length; i++) {
      const k = kiosks[i]
      const m = this.mem[i]
      if (!m) {
        this.mem[i] = { phase: k.phase, cuff: k.cuff, dir: 0, printFrom: 0, printTo: 0 }
        continue
      }
      if (this.primed) this.kiosk(i, m, k, w, out)
      m.phase = k.phase
    }
    this.primed = true
  }

  private emit(out: PatternSink, events: readonly DeviceEvent[]): void {
    for (let i = 0; i < events.length; i++) out.event(events[i])
  }

  private kiosk(i: number, m: Memory, k: HealthKioskState, w: PlanWindow, out: PatternSink): void {
    const at = AT[i] ?? null
    const t0 = w.from
    const was = m.phase
    const now = k.phase
    if (was !== now) {
      if (now === 'login') this.emit(out, touchBeep(t0, at))
      else if (PROMPT_PHASES.has(now)) this.emit(out, promptChime(t0, at))
      // (a step cut short, back to idle, is not a finished one)
      if (was === 'weight' && now !== 'idle') this.emit(out, settledBeeps(t0, at))
      if (was === 'temp' && now !== 'idle') this.emit(out, touchBeep(t0, at))
      if (now === 'bpRest') this.emit(out, doneBeep(t0, at))
      if (now === 'report') {
        this.emit(out, doneBeep(t0, at))
        m.printFrom = t0 + PRINT_DELAY_S
        m.printTo = m.printFrom + PRINT_S
        this.emit(out, printerWhirr(m.printFrom, PRINT_S, at))
      }
    }

    // the cuff: a direction latches once it has moved a little, and is dropped when it is full, empty or the step is over
    if (now === 'bp') {
      const d = k.cuff - m.cuff
      if (d > CUFF_STEP) {
        m.dir = 1
        m.cuff = k.cuff
      } else if (d < -CUFF_STEP) {
        m.dir = -1
        m.cuff = k.cuff
      }
      if (k.cuff >= CUFF_FULL) m.dir = 0
      if (m.dir === -1 && k.cuff <= CUFF_EMPTY) m.dir = 0
    } else {
      m.dir = 0
      m.cuff = k.cuff
    }
    // the print head ticks while the slip comes out
    if (m.printTo > w.from) periodic(Math.max(w.from, m.printFrom), Math.min(w.to, m.printTo), PRINT_TICK_S, m.printFrom, (t) => this.emit(out, printerTick(t, at)))
    if (m.dir === 1) periodic(w.from, w.to, PUMP_PERIOD_S, 0, (t) => this.emit(out, pumpBuzz(t, at)))
    else if (m.dir === -1) {
      periodic(w.from, w.to, HISS_PERIOD_S, 0.05, (t) => this.emit(out, deflationHiss(t, at)))
      const bpm = k.reading?.pulse ?? DEFAULT_PULSE
      periodic(w.from, w.to, 60 / Math.max(40, Math.min(180, bpm)), 0.1, (t) => this.emit(out, pulseTick(t, at)))
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The pattern the engine registers
// ---------------------------------------------------------------------------------------------

/** A device pattern that reads the kiosks through `read` (null before the sim has any). */
export function createKioskPattern(read: () => readonly HealthKioskState[] | null): DevicePattern {
  const tracker = new KioskSoundTracker()
  return {
    id: 'kiosk',
    plan(w, out) {
      const kiosks = read()
      if (kiosks) tracker.step(kiosks, w, out)
    },
  }
}

// The live kiosks: the sim is loaded on the first plan (never at import, so tests that read the patterns do not build a hospital), and read afresh on
// every plan (a Jump swaps it).
let live: typeof import('@/sim') | null = null
let loading = false
function liveKiosks(): readonly HealthKioskState[] | null {
  if (live) return live.sim.vitals.kiosks
  if (!loading) {
    loading = true
    void import('@/sim').then((m) => {
      live = m
    })
  }
  return null
}

/** What `DeviceSounds.tsx` registers from this file (every `*Patterns.ts` that exports it). */
export const devicePatterns: DevicePattern[] = [createKioskPattern(liveKiosks)]
