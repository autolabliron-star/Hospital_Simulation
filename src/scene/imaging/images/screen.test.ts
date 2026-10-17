import { describe, expect, it } from 'vitest'
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
  return { modality, phase, exam, sequence, progress, remaining: 0, phaseTime: 0, tablePos: 0, activity, detail, operatorId: null }
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
