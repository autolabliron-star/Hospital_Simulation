import { describe, expect, it } from 'vitest'
import { PROTOCOLS } from '@/content/imaging'
import type { ImagingExam, ImagingModality, ScannerPhase, ScannerState } from '@/sim/types'
import { captionOf, phaseWords } from './captions'
import { paramsLine } from './scan'

const exam = (id: string): ImagingExam => {
  const p = PROTOCOLS[id]
  return { id, modality: p.modality, bodyPart: p.bodyPart, protocol: p.name, sequences: p.sequences, patientId: 'p', patientName: 'Mira Alder', source: 'outpatient', imageSeed: 1 }
}
const state = (m: ImagingModality, e: ImagingExam | null, phase: ScannerPhase, sequence = -1, progress = 0): ScannerState => ({ modality: m, phase, exam: e, sequence, progress, remaining: 0, phaseTime: 0, tablePos: 0, activity: 0, detail: 0, operatorId: null })

describe('scanner captions', () => {
  it('names the scanner when it is idle', () => {
    expect(captionOf(state('ct', null, 'idle'))).toEqual({ title: 'CT scanner', line: 'Ready for the next patient' })
  })
  it('names the protocol and the step with the image counter while scanning', () => {
    const e = exam('mri-lumbar')
    const c = captionOf(state('mri', e, 'scanning', 1, 0.5))
    expect(c.title).toBe('MRI lumbar spine')
    expect(c.line).toContain('T2 sagittal')
    expect(c.line).toContain('image 8 of 15')
    expect(c.line).toContain('TE 98')
  })
  it('says what is happening before and after the scan', () => {
    const e = exam('ct-head')
    expect(captionOf(state('ct', e, 'positioning')).line).toBe('Positioning the patient')
    expect(captionOf(state('ct', e, 'tableOut', 1, 1)).line).toBe('Table moving out')
    expect(phaseWords('tableOut', 'xray')).toBe('Scan finished')
  })
  it('has parameters for every step of every protocol', () => {
    for (const p of Object.values(PROTOCOLS)) for (const s of p.sequences) expect(paramsLine(p.modality, s, p.bodyPart).length).toBeGreaterThan(3)
  })
})
