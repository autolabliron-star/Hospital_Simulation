import { describe, expect, it } from 'vitest'
import type { ImagingModality, ScannerPhase, ScannerState } from '@/sim/types'
import {
  CHUG_PERIOD_S,
  CT_SMOOTH_TAU_S,
  activeMriPattern,
  approach,
  chugEvents,
  clamp01,
  crossedUp,
  ctGain,
  ctPitchHz,
  edgeEvents,
  mriPatternEvents,
  mriPatternName,
  noiseSamples,
  patternOfKind,
  whatShouldPlay,
  type MachineSnap,
  type MriPattern,
  type ScannerView,
  type VoiceEvent,
} from './patterns'

const PHASES: ScannerPhase[] = ['idle', 'prep', 'positioning', 'tableIn', 'scanning', 'tableOut', 'cleanup']
const PATTERNS: MriPattern[] = ['scout', 'T1', 'T2', 'FLAIR', 'PD', 'DWI']

function seq(contrast: string, plane = 'axial') {
  return { name: `${contrast} ${plane}`, plane, contrast, seconds: 60, images: 20 }
}

/** A scanner view with one exam of the given sequences. Only the fields the sounds read are filled in. */
function view(modality: ImagingModality, phase: ScannerPhase, activity: number, sequences = [seq('T1')], sequence = 0): ScannerView {
  return { modality, phase, activity, sequence, exam: { sequences } as unknown as ScannerState['exam'] }
}

const byTime = (events: VoiceEvent[]): VoiceEvent[] => [...events].sort((a, b) => a.t - b.t)
const countKind = (events: VoiceEvent[], kind: VoiceEvent['kind']): number => events.filter((e) => e.kind === kind).length

describe('MRI pattern rates', () => {
  it('T1 knocks about 8 times a second, evenly spaced', () => {
    const ev = mriPatternEvents('T1', 0, 10, 1)
    expect(ev.every((e) => e.kind === 'knock')).toBe(true)
    expect(ev.length).toBe(80)
    expect(ev[1].t - ev[0].t).toBeCloseTo(0.125, 9)
  })

  it('T2 gives paired knocks at about 3.5 knocks a second, with a buzzy undertone', () => {
    const ev = mriPatternEvents('T2', 0, 20, 1)
    const knocksPerSecond = countKind(ev, 'knock') / 20
    expect(Math.abs(knocksPerSecond - 3.5)).toBeLessThan(0.1)
    const buzzes = ev.filter((e): e is Extract<VoiceEvent, { kind: 'buzz' }> => e.kind === 'buzz')
    expect(buzzes.length).toBeGreaterThan(0)
    expect(buzzes.every((b) => b.freq === 140)).toBe(true)
  })

  it('FLAIR is three knocks and a short gap, repeated every 0.9 s', () => {
    const ev = mriPatternEvents('FLAIR', 0, 10, 1)
    // three knocks per 0.9 s group: about 3.3 knocks a second
    expect(Math.abs(countKind(ev, 'knock') - (10 / 0.9) * 3)).toBeLessThanOrEqual(2)
    // every knock falls in the first 0.36 s of its group, then the gap follows (the epsilon allows float rounding at the boundary)
    expect(ev.every((e) => e.t % 0.9 <= 0.37 || e.t % 0.9 > 0.9 - 1e-9)).toBe(true)
  })

  it('PD and STIR knock about 5 times a second, each with a click', () => {
    expect(mriPatternName('STIR', 'axial')).toBe('PD')
    const ev = mriPatternEvents('PD', 0, 10, 1)
    expect(Math.abs(countKind(ev, 'knock') - 50)).toBeLessThanOrEqual(2)
    expect(ev.every((e) => e.kind !== 'knock' || e.click)).toBe(true)
  })

  it('scout gives quick light chirps, about 6 a second', () => {
    const ev = mriPatternEvents('scout', 0, 10, 1)
    expect(ev.every((e) => e.kind === 'chirp')).toBe(true)
    expect(Math.abs(ev.length - 60)).toBeLessThanOrEqual(2)
  })

  it('DWI gives buzz bursts near 1000 Hz, twice a second', () => {
    const ev = mriPatternEvents('DWI', 0, 10, 1)
    expect(ev.length).toBe(20)
    expect(ev.every((e) => e.kind === 'buzz' && e.freq >= 900 && e.freq <= 1100)).toBe(true)
  })

  it('the helium chug comes about every 1.2 s, with or without a pattern', () => {
    const ev = chugEvents(0, 12, 0.15)
    expect(ev.length).toBe(10)
    expect(ev.every((e) => e.kind === 'chug')).toBe(true)
    expect(ev[1].t - ev[0].t).toBeCloseTo(CHUG_PERIOD_S, 9)
  })
})

describe('windows join up with no gaps and no repeats', () => {
  it.each(PATTERNS)('%s: three windows give the same events as one', (p) => {
    const whole = mriPatternEvents(p, 0, 7.3, 0.8)
    const parts = [
      ...mriPatternEvents(p, 0, 2.1, 0.8),
      ...mriPatternEvents(p, 2.1, 5.55, 0.8),
      ...mriPatternEvents(p, 5.55, 7.3, 0.8),
    ]
    expect(byTime(parts)).toEqual(byTime(whole))
  })

  it('the chug joins up the same way', () => {
    const whole = chugEvents(0, 7.3, 0.5)
    const parts = [...chugEvents(0, 2.1, 0.5), ...chugEvents(2.1, 5.55, 0.5), ...chugEvents(5.55, 7.3, 0.5)]
    expect(byTime(parts)).toEqual(byTime(whole))
  })

  it.each(PATTERNS)('%s: is deterministic, and every event falls inside its window', (p) => {
    const a = mriPatternEvents(p, 3, 9, 0.7)
    expect(mriPatternEvents(p, 3, 9, 0.7)).toEqual(a)
    expect(a.every((e) => e.t >= 3 && e.t < 9)).toBe(true)
  })

  it('an empty or backwards window gives no events', () => {
    expect(mriPatternEvents('T1', 5, 5, 1)).toEqual([])
    expect(mriPatternEvents('T1', 6, 5, 1)).toEqual([])
    expect(chugEvents(4, 3, 1)).toEqual([])
  })
})

describe('MRI pattern from contrast and plane', () => {
  it.each([
    ['T1', 'T1'],
    ['T2', 'T2'],
    ['FLAIR', 'FLAIR'],
    ['PD', 'PD'],
    ['STIR', 'PD'],
    ['DWI', 'DWI'],
  ])('contrast %s gives %s', (contrast, expected) => {
    expect(mriPatternName(contrast, 'axial')).toBe(expected)
  })

  it('a scout plane gives chirps whatever the contrast', () => {
    expect(mriPatternName('T2', 'scout')).toBe('scout')
    expect(mriPatternName('none', 'scout')).toBe('scout')
  })

  it('none, unknown and CT-only contrasts give no pattern, so no knocks', () => {
    for (const c of ['none', 'plain', 'arterial', 'portal', 'bogus']) {
      expect(mriPatternName(c, 'axial')).toBeNull()
      expect(mriPatternEvents(mriPatternName(c, 'axial'), 0, 5, 1)).toEqual([])
    }
    expect(mriPatternEvents(null, 0, 5, 1)).toEqual([])
  })

  it('knocks only while scanning above the knock threshold with a usable sequence', () => {
    expect(activeMriPattern(view('mri', 'scanning', 1))).toBe('T1')
    expect(activeMriPattern(view('mri', 'scanning', 0.15))).toBeNull()
    expect(activeMriPattern(view('mri', 'scanning', 1, [seq('T1')], -1))).toBeNull()
    expect(activeMriPattern(view('mri', 'scanning', 1, [seq('T1')], 4))).toBeNull()
    expect(activeMriPattern(view('mri', 'tableIn', 1))).toBeNull()
  })

  it('patternOfKind maps kinds back to patterns', () => {
    expect(patternOfKind('mri:DWI')).toBe('DWI')
    expect(patternOfKind('mri:chug')).toBeNull()
    expect(patternOfKind('ct:whir')).toBeNull()
    expect(patternOfKind('silent')).toBeNull()
  })
})

describe('whatShouldPlay', () => {
  it('is silent with no focus, when muted, or before audio is unlocked', () => {
    const s = view('mri', 'scanning', 1)
    expect(whatShouldPlay(null, s, false, true).kind).toBe('silent')
    expect(whatShouldPlay('mri', s, true, true).kind).toBe('silent')
    expect(whatShouldPlay('mri', s, false, false).kind).toBe('silent')
    expect(whatShouldPlay('ct', view('ct', 'scanning', 1), true, true)).toEqual({ kind: 'silent', level: 0 })
  })

  it('MRI knocks only while scanning, and otherwise plays the chug, in every phase', () => {
    for (const phase of PHASES) {
      const d = whatShouldPlay('mri', view('mri', phase, 1), false, true)
      expect(d.kind).toBe(phase === 'scanning' ? 'mri:T1' : 'mri:chug')
    }
  })

  it('MRI between sequences (activity about 0.15) is quiet apart from the chug', () => {
    const d = whatShouldPlay('mri', view('mri', 'scanning', 0.15), false, true)
    expect(d).toEqual({ kind: 'mri:chug', level: 0.15 })
  })

  it('MRI scout sequence gives the scout kind', () => {
    expect(whatShouldPlay('mri', view('mri', 'scanning', 1, [seq('none', 'scout')]), false, true).kind).toBe('mri:scout')
  })

  it('CT gives the whir in every phase, with the level following rotor speed', () => {
    for (const phase of PHASES) {
      expect(whatShouldPlay('ct', view('ct', phase, 0.6), false, true)).toEqual({ kind: 'ct:whir', level: 0.6 })
    }
  })

  it('X-ray is armed in every phase, and ultrasound is armed at level 0', () => {
    for (const phase of PHASES) {
      expect(whatShouldPlay('xray', view('xray', phase, 0), false, true).kind).toBe('xray:armed')
      expect(whatShouldPlay('us', view('us', phase, 1), false, true)).toEqual({ kind: 'us:armed', level: 0 })
    }
  })

  it('with no scanner state (sim not wired yet) every machine reads as idle', () => {
    expect(whatShouldPlay('mri', undefined, false, true)).toEqual({ kind: 'mri:chug', level: 0 })
    expect(whatShouldPlay('ct', undefined, false, true)).toEqual({ kind: 'ct:whir', level: 0 })
    expect(whatShouldPlay('xray', null, false, true)).toEqual({ kind: 'xray:armed', level: 0 })
  })

  it('a state for another modality counts as idle', () => {
    expect(whatShouldPlay('ct', view('mri', 'scanning', 1), false, true)).toEqual({ kind: 'ct:whir', level: 0 })
  })
})

describe('CT whir', () => {
  it('pitch rises monotonically with rotor speed, from 110 Hz to 260 Hz', () => {
    expect(ctPitchHz(0)).toBe(110)
    expect(ctPitchHz(1)).toBe(260)
    let prev = -Infinity
    for (let i = 0; i <= 100; i++) {
      const f = ctPitchHz(i / 100)
      expect(f).toBeGreaterThan(prev)
      prev = f
    }
  })

  it('gain is silent at rest and rises monotonically with rotor speed', () => {
    expect(ctGain(0)).toBe(0)
    let prev = -Infinity
    for (let i = 0; i <= 100; i++) {
      const g = ctGain(i / 100)
      expect(g).toBeGreaterThanOrEqual(prev)
      prev = g
    }
    expect(ctGain(1)).toBeGreaterThan(ctGain(0.5))
  })

  it('pitch and gain clamp out-of-range speeds', () => {
    expect(ctPitchHz(-1)).toBe(110)
    expect(ctPitchHz(3)).toBe(260)
    expect(ctGain(3)).toBe(ctGain(1))
  })

  it('smoothing reaches about 95% of a step in 1.5 s, and falls back the same way', () => {
    expect(CT_SMOOTH_TAU_S).toBe(0.5)
    let up = 0
    for (let i = 0; i < 30; i++) up = approach(up, 1, 0.05, CT_SMOOTH_TAU_S)
    expect(up).toBeGreaterThan(0.94)
    expect(up).toBeLessThan(0.96)
    let down = up
    for (let i = 0; i < 30; i++) down = approach(down, 0, 0.05, CT_SMOOTH_TAU_S)
    expect(down).toBeGreaterThan(0.04)
    expect(down).toBeLessThan(0.06)
  })

  it('smoothing moves monotonically towards the target and needs no frame rate', () => {
    let s = 0
    let prev = s
    for (let i = 0; i < 100; i++) {
      s = approach(s, 0.8, 0.05, CT_SMOOTH_TAU_S)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
    expect(approach(0, 1, 0.5, 0)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0)
  })
})

describe('edge sounds', () => {
  it('the X-ray beep fires once per upward crossing of 0.5', () => {
    const activity = [0, 0, 0.3, 0.7, 0.9, 0.4, 0, 0.6, 1, 0]
    let beeps = 0
    let prev: MachineSnap | null = null
    for (let i = 0; i < activity.length; i++) {
      const curr: MachineSnap = { phase: 'scanning', activity: activity[i] }
      beeps += edgeEvents('xray', prev, curr, i * 0.05).filter((e) => e.kind === 'beep').length
      prev = curr
    }
    expect(beeps).toBe(2)
  })

  it('crossedUp is true only on the rising sample', () => {
    expect(crossedUp(0.2, 0.7, 0.5)).toBe(true)
    expect(crossedUp(0.7, 0.2, 0.5)).toBe(false)
    expect(crossedUp(0.7, 0.9, 0.5)).toBe(false)
  })

  it('no beep without an earlier sample, so entering a room is silent', () => {
    expect(edgeEvents('xray', null, { phase: 'scanning', activity: 1 }, 0)).toEqual([])
    expect(edgeEvents('ct', null, { phase: 'scanning', activity: 1 }, 0)).toEqual([])
  })

  it('X-ray clicks once when positioning starts', () => {
    const prev: MachineSnap = { phase: 'prep', activity: 0 }
    const curr: MachineSnap = { phase: 'positioning', activity: 0 }
    expect(edgeEvents('xray', prev, curr, 1).map((e) => e.kind)).toEqual(['click'])
    expect(edgeEvents('xray', curr, { phase: 'positioning', activity: 0 }, 1)).toEqual([])
  })

  it('CT chimes once when scanning starts, and ultrasound makes a faint click', () => {
    const prev: MachineSnap = { phase: 'positioning', activity: 0 }
    const curr: MachineSnap = { phase: 'scanning', activity: 0.2 }
    expect(edgeEvents('ct', prev, curr, 1).map((e) => e.kind)).toEqual(['chime'])
    const us = edgeEvents('us', prev, curr, 1)
    expect(us.map((e) => e.kind)).toEqual(['click'])
    expect(us[0].level).toBeLessThan(0.1)
  })

  it('MRI has no edge sounds', () => {
    expect(edgeEvents('mri', { phase: 'prep', activity: 0 }, { phase: 'scanning', activity: 1 }, 1)).toEqual([])
  })
})

describe('noise samples', () => {
  it('is deterministic and bounded, and pink is smoother than white', () => {
    const a = noiseSamples('pink', 4000, 7)
    expect(noiseSamples('pink', 4000, 7)).toEqual(a)
    expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(1)
    const roughness = (x: Float32Array): number => {
      let sum = 0
      for (let i = 1; i < x.length; i++) sum += Math.abs(x[i] - x[i - 1])
      return sum / (x.length - 1)
    }
    expect(roughness(a)).toBeLessThan(roughness(noiseSamples('white', 4000, 7)))
  })
})
