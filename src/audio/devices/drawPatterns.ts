/**
 * The sounds of the robot blood-draw centre, as pure patterns: no Web Audio and no React, so they run (and are tested) in node. A tracker watches
 * the draw state between two looks and returns the sounds to START now, as plain voice events; the device-sound engine (src/audio/devices, built
 * by the lab agent) turns them into oscillators and filtered noise, and decides whether they are audible (the room is focused or you stand in it).
 *
 *   servo whir        a robot head moves along the forearm (a rising whine) and parks again afterwards
 *   tourniquet hiss   the cuff pumps up, and lets go
 *   needle click      the needle goes in; and a second click when it comes out
 *   soft done chime   the draw is finished and the bandage goes on
 *   alert             the arm moved or the nurse is needed: two low beeps
 *   gripper clicks    the tube-prep gripper picks a tube, changes bin, lets go on the tray
 *   label printer     a whirr with ticks while a label prints
 *   queue call        a three-note chime (then the voice: speech.ts)
 *
 * Patterns are driven by edges (a value crossing a threshold, a phase changing): a quiet room makes no events, and the same inputs give the same
 * events. `registerDrawSounds` plugs the tracker into the engine through a structural `DeviceSoundSource` (the engine only needs `area` and `step`).
 */
import type { AreaId } from '@/sim/places'
import type { DrawPhase, DrawStationState, TubeKind, TubePrepState } from '@/sim/types'

/** One sound to start, times in seconds from the moment the tracker returned it. `level` is 0..1, before the master trim. */
export type DrawVoice =
  | { kind: 'tone'; source: string; t: number; freq: number; dur: number; level: number; wave: 'sine' | 'triangle' | 'square'; glideTo?: number }
  | { kind: 'noise'; source: string; t: number; dur: number; level: number; lowHz: number; highHz: number }
  | { kind: 'click'; source: string; t: number; level: number; freq: number }

/** What the sounds read of the draw centre. */
export interface DrawSoundView {
  stations: readonly Pick<DrawStationState, 'phase' | 'scan' | 'needle' | 'cuff'>[]
  prep: Pick<TubePrepState, 'phase' | 'bin' | 'held' | 'progress'>
  /** The ticket on the queue screen and the robot (0-based) it goes to. */
  calling: { ticket: string; station: number | null } | null
}

/** The area the sounds belong to: the engine plays them while it is focused or you are in it. */
export const DRAW_SOUND_AREA: AreaId = 'diagnostics'

/** The engine's view of a source of device sounds (structural: any engine with `area` and `step` can take it). */
export interface DeviceSoundSource {
  readonly id: string
  readonly area: AreaId
  /** Look at the world `dt` seconds after the last look and return the sounds to start. */
  step(dt: number): readonly DrawVoice[]
}

// ---------------------------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------------------------

export const CALL_NOTES_HZ = [523.25, 659.25, 783.99] as const
export const CALL_NOTE_GAP_S = 0.3
/** The three-note call chime lasts about this long; the voice starts after it. */
export const CALL_CHIME_S = 1.2

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0)

/** The robot head's servo: a whine that rises with its speed (`speed` 0..1) and a soft band of motor noise under it. */
export function servoWhir(source: string, speed: number, dur: number, t = 0): DrawVoice[] {
  const s = clamp01(speed)
  return [
    { kind: 'tone', source, t, freq: 380 + 520 * s, dur, level: 0.16 + 0.1 * s, wave: 'triangle', glideTo: 420 + 600 * s },
    { kind: 'noise', source, t, dur, level: 0.07 + 0.05 * s, lowHz: 1400, highHz: 3600 },
  ]
}

/** The tourniquet: air hissing in (rising band) or out (falling). */
export function tourniquetHiss(source: string, inflate: boolean, dur: number, t = 0): DrawVoice[] {
  return [{ kind: 'noise', source, t, dur, level: inflate ? 0.2 : 0.15, lowHz: inflate ? 2200 : 3200, highHz: inflate ? 6500 : 8200 }]
}

/** The needle's click: a short tick and a faint tone (a little lower coming out). */
export function needleClick(source: string, inward: boolean, t = 0): DrawVoice[] {
  return [
    { kind: 'click', source, t, level: inward ? 0.5 : 0.38, freq: inward ? 2400 : 1900 },
    { kind: 'tone', source, t, freq: inward ? 1320 : 990, dur: 0.07, level: 0.08, wave: 'sine' },
  ]
}

/** The soft "done" chime: two notes, a fifth apart. */
export function doneChime(source: string, t = 0): DrawVoice[] {
  return [
    { kind: 'tone', source, t, freq: 659.25, dur: 0.5, level: 0.16, wave: 'sine' },
    { kind: 'tone', source, t: t + 0.18, freq: 987.77, dur: 0.7, level: 0.14, wave: 'sine' },
  ]
}

/** Two low beeps: the arm moved, or a person is needed. */
export function alertBeeps(source: string, t = 0): DrawVoice[] {
  return [
    { kind: 'tone', source, t, freq: 330, dur: 0.16, level: 0.14, wave: 'square' },
    { kind: 'tone', source, t: t + 0.24, freq: 262, dur: 0.2, level: 0.14, wave: 'square' },
  ]
}

/** The prep gripper's tick. */
export function gripperClick(source: string, level = 0.4, t = 0): DrawVoice[] {
  return [{ kind: 'click', source, t, level, freq: 1700 }]
}

/** The label printer: a thermal whirr with a tick for every few millimetres of label. */
export function printerWhirr(source: string, dur: number, t = 0): DrawVoice[] {
  const out: DrawVoice[] = [{ kind: 'noise', source, t, dur, level: 0.11, lowHz: 900, highHz: 2600 }]
  const ticks = Math.max(1, Math.floor(dur / 0.11))
  for (let i = 0; i < ticks; i++) out.push({ kind: 'click', source, t: t + i * 0.11, level: 0.16, freq: 2900 })
  return out
}

/** The queue call: C - E - G, each note a little shorter than the gap so they ring into each other. */
export function callChime(source = 'queue', t = 0): DrawVoice[] {
  return CALL_NOTES_HZ.map((freq, i): DrawVoice => ({ kind: 'tone', source, t: t + i * CALL_NOTE_GAP_S, freq, dur: 0.55, level: 0.2, wave: 'sine' }))
}

// ---------------------------------------------------------------------------------------------
// The tracker
// ---------------------------------------------------------------------------------------------

const EMPTY: readonly DrawVoice[] = Object.freeze([])

/** The head is moving at least this fast (fractions of the forearm per second) to whir. */
export const WHIR_MIN_SPEED = 0.05
/** A whir burst lasts this long and is re-issued while the head keeps moving. */
export const WHIR_BURST_S = 0.22
export const CUFF_UP_AT = 0.1
export const CUFF_DOWN_AT = 0.9
export const NEEDLE_IN_AT = 0.05
export const NEEDLE_OUT_AT = 0.95

const WORKING: ReadonlySet<DrawPhase> = new Set<DrawPhase>(['veinScan', 'needleIn', 'filling', 'needleOut'])

interface StationMemory {
  phase: DrawPhase
  scan: number
  needle: number
  cuff: number
  whirIn: number
}

export class DrawSoundTracker {
  private readonly st: StationMemory[] = []
  private prepPhase: TubePrepState['phase'] = 'idle'
  private prepBin = -1
  private prepHeld: TubeKind | null = null
  private callKey: string | null | undefined = undefined
  private primed = false
  private readonly out: DrawVoice[] = []

  /** Look at the world `dt` seconds after the last look; the first look only learns the state (nothing starts at load). */
  step(view: DrawSoundView, dt: number): readonly DrawVoice[] {
    for (let i = 0; i < view.stations.length; i++) {
      const s = view.stations[i]
      let m = this.st[i]
      if (!m) {
        m = { phase: s.phase, scan: s.scan, needle: s.needle, cuff: s.cuff, whirIn: 0 }
        this.st[i] = m
        continue
      }
      if (this.primed) this.station(i, m, s, dt)
      m.phase = s.phase
      m.scan = s.scan
      m.needle = s.needle
      m.cuff = s.cuff
    }
    if (this.primed) this.prep(view.prep)
    this.prepPhase = view.prep.phase
    this.prepBin = view.prep.bin
    this.prepHeld = view.prep.held
    const key = view.calling ? `${view.calling.ticket}:${view.calling.station ?? -1}` : null
    if (this.primed && key !== null && key !== this.callKey) this.emit(callChime())
    this.callKey = key
    this.primed = true
    return this.out.length > 0 ? this.out.splice(0) : EMPTY
  }

  private emit(voices: readonly DrawVoice[]): void {
    for (const v of voices) this.out.push(v)
  }

  private station(i: number, m: StationMemory, s: DrawSoundView['stations'][number], dt: number): void {
    const src = `robot${i}`
    // the head: a whir while it moves along the arm, and when it leaves or returns to its park position
    const speed = dt > 0 ? Math.abs(s.scan - m.scan) / dt : 0
    m.whirIn -= dt
    if (speed >= WHIR_MIN_SPEED && s.phase === 'veinScan' && m.whirIn <= 0) {
      this.emit(servoWhir(src, Math.min(1, speed / 0.6), WHIR_BURST_S))
      m.whirIn = WHIR_BURST_S * 0.8
    }
    const was = WORKING.has(m.phase)
    const now = WORKING.has(s.phase)
    if (!was && now && s.phase !== 'veinScan') this.emit(servoWhir(src, 0.3, 0.7))
    if (!was && s.phase === 'veinScan') this.emit(servoWhir(src, 0.35, 0.8))
    if (was && !now && m.phase !== s.phase && (s.phase === 'bandage' || s.phase === 'release')) this.emit(servoWhir(src, 0.3, 0.7))
    // the tourniquet
    if (m.cuff < CUFF_UP_AT && s.cuff >= CUFF_UP_AT) this.emit(tourniquetHiss(src, true, 1.1))
    if (m.cuff > CUFF_DOWN_AT && s.cuff <= CUFF_DOWN_AT) this.emit(tourniquetHiss(src, false, 0.7))
    // the needle
    if (m.needle < NEEDLE_IN_AT && s.needle >= NEEDLE_IN_AT) this.emit(needleClick(src, true))
    if (m.needle > NEEDLE_OUT_AT && s.needle <= NEEDLE_OUT_AT) this.emit(needleClick(src, false))
    // done, and the alert
    if (m.phase !== s.phase) {
      if (s.phase === 'bandage' && m.phase !== 'release') this.emit(doneChime(src, 0.2))
      if (s.phase === 'armMoved' || s.phase === 'fallbackToNurse') this.emit(alertBeeps(src))
    }
  }

  private prep(p: DrawSoundView['prep']): void {
    const src = 'prep'
    if (p.bin !== this.prepBin && p.bin >= 0) this.emit(gripperClick(src, 0.3))
    if (p.held !== null && this.prepHeld === null) this.emit(gripperClick(src, 0.5))
    if (p.held === null && this.prepHeld !== null) this.emit(gripperClick(src, 0.35))
    if (p.phase !== this.prepPhase) {
      if (p.phase === 'labelling') this.emit(printerWhirr(src, 1.1))
      if (p.phase === 'output') this.emit(gripperClick(src, 0.45, 0.05))
    }
  }
}

/** The draw centre's sound view of the live `sim.blood` (the stations and the prep state are read in place; only the call is a small new object). */
export function soundViewOf(blood: { stations: DrawSoundView['stations']; prep: DrawSoundView['prep']; calling: { id: string; station: number | null } | null }): DrawSoundView {
  const c = blood.calling
  return { stations: blood.stations, prep: blood.prep, calling: c ? { ticket: c.id, station: c.station } : null }
}

/** A source for the engine: it reads the draw state through `read` (null before the sim has one) and returns the tracker's sounds. */
export function createDrawSoundSource(read: () => DrawSoundView | null): DeviceSoundSource {
  const tracker = new DrawSoundTracker()
  return {
    id: 'draw',
    area: DRAW_SOUND_AREA,
    step(dt) {
      const view = read()
      return view ? tracker.step(view, dt) : EMPTY
    },
  }
}

/**
 * Plug the draw sounds into the engine: `register` is the engine's registration function (it takes a source and returns the function that removes it
 * again). Returns that remover.
 */
export function registerDrawSounds(register: (source: DeviceSoundSource) => () => void, read: () => DrawSoundView | null): () => void {
  return register(createDrawSoundSource(read))
}
