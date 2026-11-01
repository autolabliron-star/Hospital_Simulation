import { describe, expect, it } from 'vitest'
import { emptyProcedureView } from '@/sim/procedure/empty'
import { PROTOCOLS } from '@/content/imaging'
import type { ImagingExam, ImagingModality, ScannerPhase, ScannerState } from '@/sim/types'
import { createPainter, type Painter } from './paint'
import { mockEnv } from './mockCanvas'
import { LiveScreen } from './screen'

function examOf(protocolId: string): ImagingExam {
  const p = PROTOCOLS[protocolId]
  return { id: `e-${protocolId}`, modality: p.modality, bodyPart: p.bodyPart, protocol: p.name, sequences: p.sequences, patientId: 'p1', patientName: 'Mira Alder', source: 'demo', imageSeed: 99 }
}

function stateOf(modality: ImagingModality, exam: ImagingExam | null, phase: ScannerPhase, sequence = -1, progress = 0, activity = 0, detail = 0): ScannerState {
  return { modality, phase, exam, sequence, progress, remaining: 0, phaseTime: 0, tablePos: 0, activity, detail, operatorId: null, procedure: emptyProcedureView() }
}

function setup(modality: ImagingModality) {
  const { env, rec } = mockEnv()
  const real = createPainter(env)
  let paints = 0
  const painter: Painter = {
    tiles: real.tiles,
    paint: (...a) => {
      paints++
      real.paint(...a)
    },
  }
  const screen = new LiveScreen(modality, env, painter)
  rec.reset()
  return { screen, rec, paints: () => paints }
}

describe('LiveScreen', () => {
  it('shows a standby page when idle and does not redraw it again', () => {
    const { screen, rec } = setup('mri')
    const idle = stateOf('mri', null, 'idle')
    expect(screen.update(idle, 0, 1000, 100)).toBe(false) // already standing by from the constructor
    expect(rec.total()).toBe(0)
  })

  it('shows the patient-setup page once per phase', () => {
    const { screen } = setup('ct')
    const exam = examOf('ct-head')
    expect(screen.update(stateOf('ct', exam, 'prep'), 1, 1000, 100)).toBe(true)
    expect(screen.update(stateOf('ct', exam, 'prep'), 1.2, 1200, 100)).toBe(false)
    expect(screen.update(stateOf('ct', exam, 'positioning'), 2, 2000, 100)).toBe(true)
  })

  it('respects the redraw interval', () => {
    const { screen } = setup('ct')
    const exam = examOf('ct-head')
    expect(screen.update(stateOf('ct', exam, 'prep'), 1, 1000, 1000)).toBe(true)
    expect(screen.update(stateOf('ct', exam, 'positioning'), 1.1, 1100, 1000)).toBe(false) // too soon: skipped, drawn later
    expect(screen.update(stateOf('ct', exam, 'positioning'), 2.2, 2200, 1000)).toBe(true)
  })

  it('rasterises the anatomy once per slice, and a plain redraw is a handful of canvas calls', () => {
    const { screen, rec, paints } = setup('mri')
    const exam = examOf('mri-lumbar')
    const seqIndex = 1 // T2 sagittal, 15 images
    const images = exam.sequences[seqIndex].images
    let now = 1000
    screen.update(stateOf('mri', exam, 'tableIn'), 0, now, 100)
    let redraws = 0
    let maxPlain = 0
    let maxSlice = 0
    for (let i = 0; i <= 600; i++) {
      const progress = i / 600
      now += 100
      const before = paints()
      rec.reset()
      const drew = screen.update(stateOf('mri', exam, 'scanning', seqIndex, progress, 1), i * 0.35, now, 100)
      if (drew) redraws++
      const spent = rec.total()
      if (paints() > before) maxSlice = Math.max(maxSlice, spent)
      else if (drew) maxPlain = Math.max(maxPlain, spent)
    }
    expect(paints()).toBe(images)
    expect(redraws).toBeGreaterThan(images)
    expect(maxPlain).toBeLessThan(40) // blit, clip, reveal line, overlay
    expect(maxSlice).toBeLessThan(1100) // the shapes (about 100 fills), grain, text overlay: about a millisecond
  })

  it('reveals each slice from the top and keeps the final image after the scan', () => {
    const { screen } = setup('ct')
    const exam = examOf('ct-head')
    let now = 0
    const step = (phase: ScannerPhase, seq: number, progress: number): boolean => screen.update(stateOf('ct', exam, phase, seq, progress, 1), 0, (now += 200), 100)
    expect(step('scanning', 1, 0.0001)).toBe(true)
    expect(step('scanning', 1, 0.0002)).toBe(false) // inside the same reveal step
    expect(step('scanning', 1, 0.5)).toBe(true)
    expect(step('scanning', 1, 1)).toBe(true)
    expect(step('tableOut', 1, 1)).toBe(true) // the phase changed: one more draw with the full image
    expect(step('tableOut', 1, 1)).toBe(false)
  })

  it('goes back to standby when the exam ends', () => {
    const { screen } = setup('xray')
    const exam = examOf('xr-ankle')
    screen.update(stateOf('xray', exam, 'scanning', 0, 0.5, 1), 0, 1000, 100)
    expect(screen.update(stateOf('xray', null, 'idle'), 0, 2000, 100)).toBe(true)
    expect(screen.update(stateOf('xray', null, 'idle'), 0, 3000, 100)).toBe(false)
  })

  it('ultrasound: a live frame every tenth of a second of sim time, frozen between sweeps', () => {
    const { screen, rec } = setup('us')
    const exam = examOf('us-abdo')
    let now = 0
    let t = 0
    let drawn = 0
    let maxCalls = 0
    for (let i = 0; i < 40; i++) {
      now += 100
      t += 0.1
      rec.reset()
      if (screen.update(stateOf('us', exam, 'scanning', 0, i / 40, 1, i / 40), t, now, 100)) {
        drawn++
        maxCalls = Math.max(maxCalls, rec.total())
      }
    }
    expect(drawn).toBeGreaterThanOrEqual(38)
    expect(maxCalls).toBeLessThan(220)
    // the sweep ends: one frozen frame, then nothing more
    expect(screen.update(stateOf('us', exam, 'scanning', 0, 1, 0, 1), t + 1, now + 1000, 100)).toBe(true)
    expect(screen.update(stateOf('us', exam, 'scanning', 0, 1, 0, 1), t + 2, now + 2000, 100)).toBe(false)
    // the next sweep goes live again
    expect(screen.update(stateOf('us', exam, 'scanning', 1, 0, 1, 0), t + 3, now + 3000, 100)).toBe(true)
  })

  it('a paused sim (time does not move) does not redraw a live ultrasound image', () => {
    const { screen } = setup('us')
    const exam = examOf('us-renal')
    expect(screen.update(stateOf('us', exam, 'scanning', 0, 0.3, 1, 0.3), 5, 1000, 100)).toBe(true)
    expect(screen.update(stateOf('us', exam, 'scanning', 0, 0.3, 1, 0.3), 5, 2000, 100)).toBe(false)
  })
})

describe('LiveScreen with the imaging worker (R3, inline backend)', () => {
  it('draws the ultrasound from the worker while sweeping, holds it frozen between sweeps', async () => {
    const { InlineBackend } = await import('../worker/client')
    const { env, rec } = mockEnv()
    const backend = new InlineBackend()
    const screen = new LiveScreen('us', env, createPainter(env), backend)
    const exam = examOf('us-renal')
    let draws = 0
    for (let i = 0; i < 12; i++) if (screen.update(stateOf('us', exam, 'scanning', 0, i / 40, 1, i / 40), i * 0.1, 1000 + i * 100, 100)) draws++
    // every update while sweeping asks for a frame; the inline backend answers at once, so every one draws
    expect(backend.stats.sent).toBeGreaterThanOrEqual(10)
    expect(draws).toBeGreaterThanOrEqual(10)
    expect(rec.count('drawImage')).toBeGreaterThan(10)
    // the sweep ends: no more requests, one frozen redraw, then quiet
    const sent = backend.stats.sent
    const frozen = [0, 1, 2].map((i) => screen.update(stateOf('us', exam, 'scanning', 0, 1, 0, 0.9), 5 + i, 3000 + i * 200, 100))
    expect(backend.stats.sent).toBe(sent)
    expect(frozen.filter(Boolean).length).toBe(1)
  }, 60_000)

  it('asks the worker for each new CT slice (and prefetches the next) and reveals it', async () => {
    const { InlineBackend } = await import('../worker/client')
    const { env } = mockEnv()
    const backend = new InlineBackend()
    const screen = new LiveScreen('ct', env, createPainter(env), backend)
    const exam = examOf('ct-abdo')
    let drew = 0
    for (let i = 0; i < 6; i++) if (screen.update(stateOf('ct', exam, 'scanning', 1, i / 60 + 0.001, 1), i, 1000 + i * 150, 100)) drew++
    expect(drew).toBeGreaterThan(0)
    // the slice and the next one, for the first slice; later slices come from the prefetch
    expect(backend.stats.sent).toBeGreaterThanOrEqual(2)
    expect(screen.thumbOf(exam, 1)).toBeNull()
  }, 60_000)
})

describe('the scripted ProSense picture (R5): real time, whatever the sim speed', () => {
  /** A ProSense freeze of the step engine's script on the ultrasound screen. */
  function scripted(): { screen: LiveScreen; st: ScannerState } {
    const { env } = mockEnv()
    const screen = new LiveScreen('us', env, createPainter(env))
    const st = stateOf('us', examOf('us-cryo-breast'), 'scanning', 1, 0.5, 1, 0.5)
    st.procedure.procedureId = 'us-breastCancer'
    st.procedure.scope = 'freeze1'
    st.procedure.progress = 0.5
    return { screen, st }
  }

  /** Offer a frame at 60 Hz of real time for `seconds`, the sim running at `speed` times real time (0: paused). Returns the draws. */
  function drawsIn(screen: LiveScreen, st: ScannerState, seconds: number, speed: number, interval: number, from = 0): number {
    let draws = 0
    const frames = Math.round(seconds * 60)
    for (let k = 0; k < frames; k++) if (screen.update(st, 100 + (from + k) * (speed / 60), 1000 + (from + k) * (1000 / 60), interval)) draws++
    return draws
  }

  it.each([0.25, 1, 2, 4, 10])('redraws about 4 times a real second at %sx (never more), however fast or slow the sim runs', (speed) => {
    const { screen, st } = scripted()
    // (a redraw interval of 50 ms leaves the picture's own frame rate as the only limit)
    const draws = drawsIn(screen, st, 10, speed, 50)
    expect(draws).toBeLessThanOrEqual(41)
    expect(draws).toBeGreaterThanOrEqual(38)
    expect(screen.paints).toBe(draws)
  })

  it('holds the picture while the sim is paused (no redraw for a sim that has not moved), and goes on when it moves again', () => {
    const { screen, st } = scripted()
    expect(drawsIn(screen, st, 2, 1, 50)).toBeGreaterThanOrEqual(7)
    const paints = screen.paints
    // paused: the same sim time, real time running on
    let paused = 0
    for (let k = 0; k < 120; k++) if (screen.update(st, 105, 3000 + k * (1000 / 60), 50)) paused++
    expect(paused).toBeLessThanOrEqual(1) // (the frame for the time it stopped at, if it had not been drawn yet)
    expect(screen.paints).toBeLessThanOrEqual(paints + 1)
    const held = screen.paints
    expect(drawsIn(screen, st, 1, 1, 50, 200)).toBeGreaterThanOrEqual(3)
    expect(screen.paints).toBeGreaterThan(held)
  })

  it('counts every redraw of any picture (the standby page, a scan, the cryoablation) for the inset to copy again', () => {
    const { env } = mockEnv()
    const screen = new LiveScreen('mri', env, createPainter(env))
    expect(screen.paints).toBe(0) // the constructor's standby page is not a redraw the overlay waits for
    const exam = examOf('ct-head')
    const ct = new LiveScreen('ct', env, createPainter(env))
    expect(ct.update(stateOf('ct', exam, 'prep'), 1, 1000, 100)).toBe(true)
    expect(ct.paints).toBe(1)
    expect(ct.update(stateOf('ct', exam, 'prep'), 1.2, 1200, 100)).toBe(false)
    expect(ct.paints).toBe(1)
    expect(ct.update(stateOf('ct', exam, 'positioning'), 2, 2000, 100)).toBe(true)
    expect(ct.paints).toBe(2)
  })
})
