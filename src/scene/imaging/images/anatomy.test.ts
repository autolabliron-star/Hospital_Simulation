import { describe, expect, it } from 'vitest'
import { PROTOCOLS } from '@/content/imaging'
import type { ImagingExam } from '@/sim/types'
import { brainAxial, brainSagittal } from './brain'
import { kneeCoronal, kneeSagittal } from './knee'
import { ctLook, mriLook, toneOf, xrayLook, CT_WINDOWS } from './looks'
import { neckAxial } from './neck'
import * as RX from './radiograph'
import { imageStats, rasterize, visibleTone } from './sample'
import { pickImage, sliceAt, slicePos, type ExamLike } from './scan'
import { flatten, modelSize, type SliceModel } from './shapes'
import { lumbarAxial, lumbarSagittal } from './spine'
import { abdomenAxial, chestAxial } from './torso'

const examOf = (protocolId: string, seed = 20240611): ExamLike => {
  const p = PROTOCOLS[protocolId]
  return { id: `x-${protocolId}`, modality: p.modality, bodyPart: p.bodyPart, imageSeed: seed, sequences: p.sequences, protocol: p.name, patientName: 'Test Patient' } satisfies Partial<ImagingExam> & ExamLike
}

const ANATOMY: Record<string, (seed: number, z: number) => SliceModel> = {
  brainAxial: (s, z) => brainAxial(s, z),
  brainAxialCt: (s, z) => brainAxial(s, z, true),
  brainSagittal: (s, z) => brainSagittal(s, z),
  lumbarSagittal,
  lumbarAxial,
  kneeCoronal,
  kneeSagittal,
  chestAxial,
  abdomenAxial,
  neckAxial,
}

describe('every protocol has pictures', () => {
  it('has a protocol for every modality', () => {
    const modalities = new Set(Object.values(PROTOCOLS).map((p) => p.modality))
    expect([...modalities].sort()).toEqual(['ct', 'mri', 'us', 'xray'])
  })

  for (const p of Object.values(PROTOCOLS)) {
    for (let si = 0; si < p.sequences.length; si++) {
      const seq = p.sequences[si]
      it(`${p.id} / ${seq.name}: first, middle and last slice are non-empty and deterministic`, () => {
        const exam = examOf(p.id)
        for (const k of [0, Math.floor(seq.images / 2), seq.images - 1]) {
          const a = pickImage(exam, si, k)
          const b = pickImage(exam, si, k)
          if (a.kind === 'us') {
            expect(b.kind).toBe('us')
            expect(['liver', 'gallbladder', 'kidneyR', 'kidneyL', 'spleen', 'bladder', 'pancreas', 'breast']).toContain(a.view)
            continue
          }
          expect(b.kind).toBe('slice')
          if (b.kind !== 'slice') continue
          expect(flatten(a.model)).toEqual(flatten(b.model))
          expect(a.model.prims.length).toBeGreaterThan(10)
          const g = rasterize(a.model, a.look, 72)
          const st = imageStats(g)
          expect(st.max, `${p.id} ${seq.name} slice ${k}: something bright`).toBeGreaterThan(0.35)
          expect(st.sd, `${p.id} ${seq.name} slice ${k}: contrast`).toBeGreaterThan(0.05)
          expect(st.mean, `${p.id} ${seq.name} slice ${k}: not a blank frame`).toBeGreaterThan(0.04)
        }
      })
    }
  }

  it('different patients (seeds) look different, and the same exam looks the same', () => {
    for (const id of ['mri-brain', 'mri-lumbar', 'mri-knee', 'ct-chest', 'ct-abdo', 'xr-ankle', 'xr-wrist', 'xr-chest', 'xr-hip']) {
      const a = pickImage(examOf(id, 1), 1, 1)
      const b = pickImage(examOf(id, 2), 1, 1)
      if (a.kind !== 'slice' || b.kind !== 'slice') throw new Error('expected slices')
      expect(flatten(a.model), id).not.toEqual(flatten(b.model))
    }
  })

  it('a slice position spreads evenly across the covered range', () => {
    expect(slicePos(0, 10, 0, 1)).toBeCloseTo(0.05, 6)
    expect(slicePos(9, 10, 0, 1)).toBeCloseTo(0.95, 6)
    expect(slicePos(0, 1, 0.2, 0.8)).toBeCloseTo(0.5, 6)
    const first = sliceAt(20, 0)
    const last = sliceAt(20, 1)
    expect(first).toEqual({ index: 0, frac: 0 })
    expect(last.index).toBe(19)
    expect(last.frac).toBe(1)
    expect(sliceAt(20, 0.5).index).toBe(10)
  })
})

describe('slices change smoothly through the volume', () => {
  for (const [name, f] of Object.entries(ANATOMY)) {
    it(`${name}: same shape list at every position, and no big jump over a step of 0.01`, () => {
      let max = 0
      let len = -1
      for (let i = 0; i < 100; i++) {
        const a = flatten(f(7, i / 100))
        const b = flatten(f(7, (i + 1) / 100))
        expect(a.length).toBe(b.length)
        len = a.length
        for (let k = 0; k < a.length; k++) max = Math.max(max, Math.abs(a[k] - b[k]))
      }
      expect(len).toBeGreaterThan(100)
      // coordinates and sizes are in the -1..1 square and alphas in 0..1: a hundredth of the volume never moves anything by a big step
      expect(max).toBeLessThan(0.65)
    })

    it(`${name}: neighbouring slices of a real series differ by far less than slices far apart`, () => {
      const near = flatten(f(7, 0.5))
      const next = flatten(f(7, 0.52))
      const far = flatten(f(7, 0.9))
      const dist = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0)
      expect(dist(near, next)).toBeLessThan(dist(near, far))
    })
  }

  it('models are small (a slice paints in about a millisecond)', () => {
    for (const [name, f] of Object.entries(ANATOMY)) {
      const s = modelSize(f(3, 0.5))
      expect(s.prims, name).toBeLessThan(220)
      expect(s.points, name).toBeLessThan(1500)
    }
  })
})

describe('contrast follows the rules a radiologist knows', () => {
  const brain = brainAxial(5, 0.55)
  it('MRI: CSF is dark on T1 and FLAIR but bright on T2', () => {
    const t1 = visibleTone(brain, mriLook('T1'), 'csf')
    const t2 = visibleTone(brain, mriLook('T2'), 'csf')
    const flair = visibleTone(brain, mriLook('FLAIR'), 'csf')
    expect(t2).toBeGreaterThan(0.85)
    expect(t1).toBeLessThan(0.2)
    expect(flair).toBeLessThan(0.2)
  })
  it('MRI: white matter is brighter than grey matter on T1, darker on T2', () => {
    const l1 = mriLook('T1')
    const l2 = mriLook('T2')
    expect(toneOf(l1, 'gm')).toBeLessThan(toneOf(l1, 'wm'))
    expect(toneOf(l2, 'gm')).toBeGreaterThan(toneOf(l2, 'wm'))
  })
  it('MRI lumbar spine: the disc is bright on T2 and the cord is darker than the CSF around it', () => {
    const m = lumbarSagittal(5, 0.5)
    expect(visibleTone(m, mriLook('T2'), 'csf')).toBeGreaterThan(0.85)
    expect(visibleTone(m, mriLook('T2'), 'disc')).toBeGreaterThan(0.45)
    expect(visibleTone(m, mriLook('T2'), 'cord')).toBeLessThan(visibleTone(m, mriLook('T2'), 'csf'))
    expect(visibleTone(m, mriLook('T1'), 'csf')).toBeLessThan(0.2)
  })
  it('MRI knee: menisci and ligaments are dark, cartilage is bright on PD', () => {
    const m = kneeCoronal(5, 0.5)
    const pd = mriLook('PD')
    expect(visibleTone(m, pd, 'meniscus')).toBeLessThan(0.2)
    expect(visibleTone(m, pd, 'cartilage')).toBeGreaterThan(0.6)
  })
  it('CT: bone is white and the brain is grey in the brain window; the skull is whiter in CT than the tissue inside', () => {
    const m = brainAxial(5, 0.55, true)
    const look = ctLook('plain', CT_WINDOWS.brain)
    expect(visibleTone(m, look, 'bone')).toBeGreaterThan(0.95)
    const gm = visibleTone(m, look, 'gm')
    expect(gm).toBeGreaterThan(0.3)
    expect(gm).toBeLessThan(0.7)
  })
  it('CT chest: lungs are dark and the vessels inside them are bright', () => {
    const m = chestAxial(5, 0.5)
    const look = ctLook('arterial', { width: 1400, level: -400 })
    expect(visibleTone(m, look, 'lung')).toBeLessThan(0.3)
    expect(visibleTone(m, look, 'vessel')).toBeGreaterThan(0.8)
  })
  it('CT abdomen: the aorta lights up first, the liver and the veins in the portal phase', () => {
    const arterial = ctLook('arterial', CT_WINDOWS.abdomen)
    const portal = ctLook('portal', CT_WINDOWS.abdomen)
    const m = abdomenAxial(5, 0.25)
    expect(visibleTone(m, arterial, 'vessel')).toBeGreaterThan(visibleTone(m, arterial, 'vein'))
    expect(visibleTone(m, portal, 'vein')).toBeGreaterThan(visibleTone(m, arterial, 'vein'))
    expect(visibleTone(m, portal, 'liver')).toBeGreaterThan(visibleTone(m, arterial, 'liver'))
  })
  it('radiographs: bone is bright on a dark background with soft tissue between', () => {
    for (const f of [RX.ankleAP, RX.ankleLateral, RX.wristPA, RX.wristLateral, RX.chestPA, RX.chestLateral, RX.pelvisAP, RX.hipLateral]) {
      const g = rasterize(f(3), xrayLook(), 80)
      const st = imageStats(g)
      expect(st.max).toBeGreaterThan(0.7)
      expect(st.min).toBeLessThan(0.1)
      const soft = g.filter((v) => v > 0.15 && v < 0.45).length / g.length
      expect(soft).toBeGreaterThan(0.08)
    }
  })
})
