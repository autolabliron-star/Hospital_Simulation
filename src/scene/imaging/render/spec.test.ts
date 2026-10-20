/**
 * R3: the slice planner plans every exam the way a radiographer would on the landmarks (CT head along the skull-base tilt, the cervical
 * spine square to its curve, the chest from above the apices to below the domes, the knee's planes along the femur, radiographs centred on
 * the joint with the lead marker on the right side), and `sliceMeta` puts the slice's line where it belongs on the scout inset.
 */
import { describe, expect, it } from 'vitest'
import type { BodyPart, ImagingModality } from '@/sim/types'
import { BodyBuilder, type V3 } from '../phantom/body'
import { patientParams } from '../phantom/params'
import { buildRegions } from '../phantom/regions'
import type { Landmarks } from '../phantom/regions/types'
import { sliceMeta, sliceSpec, specKnown, type SeqLike, type SliceSpec } from './spec'

const p = patientParams(4242)
const axial = (images: number, contrast: SeqLike['contrast'] = 'plain', name = 'Axial'): SeqLike => ({ name, plane: 'axial', contrast, images })
const seq = (name: string, plane: SeqLike['plane'], contrast: SeqLike['contrast'], images: number): SeqLike => ({ name, plane, contrast, images })

/** Landmarks of a made-up head, chest and limbs (the region builders' own are tested with them). */
const tilt: V3 = [0, -Math.sin(0.2), Math.cos(0.2)]
const LM: Landmarks = {
  headCentre: [0, 10, 900],
  vertex: [0, 10, 985],
  foramenMagnum: [0, 20, 812],
  axialNormal: tilt,
  vertC1: [0, 18, 798],
  vertC2: [0, 16, 780],
  vertC3: [0, 12, 762],
  vertC4: [0, 10, 745],
  vertC5: [0, 10, 728],
  vertC6: [0, 12, 711],
  vertC7: [0, 16, 694],
  vertT1: [0, 22, 676],
  apexR: [-60, 20, 660],
  apexL: [60, 20, 655],
  domeR: [-80, 10, 420],
  domeL: [80, 10, 400],
  kneeCentre: [-95, 0, -440],
  femurAxis: [0, 0, 1],
  lateral: [-1, 0, 0],
  anterior: [0, -1, 0],
  ankleCentre: [-95, 0, -860],
  tibiaAxis: [0, 0, 1],
  wristCentre: [-230, 0, 80],
  forearmAxis: [0, 0, 1],
  radial: [-1, 0, 0],
}

const plane = (s: SliceSpec | null) => {
  expect(s).not.toBeNull()
  expect(s!.kind).not.toBe('xray')
  return (s as Extract<SliceSpec, { plane: unknown }>).plane
}

describe('the planner', () => {
  it('knows every catalogue exam it has a region for', () => {
    const exams: [ImagingModality, BodyPart][] = [
      ['ct', 'head'],
      ['ct', 'cervicalSpine'],
      ['ct', 'chest'],
      ['ct', 'abdomen'],
      ['mri', 'brain'],
      ['mri', 'knee'],
      ['mri', 'lumbarSpine'],
      ['xray', 'chest'],
      ['xray', 'knee'],
      ['xray', 'ankle'],
      ['xray', 'wrist'],
      ['xray', 'pelvis'],
    ]
    for (const [m, b] of exams) expect(specKnown(m, b), `${m} ${b}`).toBe(true)
    expect(specKnown('us', 'abdomen')).toBe(false)
  })

  it('tilts CT head slices along the skull base, from below the foramen magnum to the vertex, in the brain window', () => {
    const first = sliceSpec('ct', 'head', axial(40), 0, LM, p)
    const last = sliceSpec('ct', 'head', axial(40), 39, LM, p)
    const a = plane(first)
    const b = plane(last)
    expect(a.nx * tilt[0] + a.ny * tilt[1] + a.nz * tilt[2]).toBeGreaterThan(0.999)
    expect(a.cz).toBeLessThan(820)
    expect(b.cz).toBeGreaterThan(960)
    expect(first!.kind === 'ct' && first!.width === 80 && first!.level === 40).toBe(true)
  })

  it('keeps cervical spine slices square to the curve, in the bone window with the sharp kernel', () => {
    for (let k = 0; k < 50; k += 7) {
      const s = sliceSpec('ct', 'cervicalSpine', axial(50), k, LM, p)
      const pl = plane(s)
      expect(pl.nz).toBeGreaterThan(0.85)
      expect(s!.kind === 'ct' && s!.kernel === 'sharp' && s!.width >= 1500).toBe(true)
    }
    expect(plane(sliceSpec('ct', 'cervicalSpine', axial(50), 0, LM, p)).cz).toBeGreaterThan(plane(sliceSpec('ct', 'cervicalSpine', axial(50), 49, LM, p)).cz)
  })

  it('covers the chest from above the apices to below the diaphragm', () => {
    expect(plane(sliceSpec('ct', 'chest', axial(60, 'arterial'), 0, LM, p)).cz).toBeGreaterThan(660)
    expect(plane(sliceSpec('ct', 'chest', axial(60, 'arterial'), 59, LM, p)).cz).toBeLessThan(400)
  })

  it('plans MRI brain axials along the AC-PC tilt and the knee planes along the femur, with the right sequences', () => {
    const t2 = sliceSpec('mri', 'brain', axial(24, 'T2', 'T2 axial'), 12, LM, p)
    expect(t2!.kind === 'mri' && t2!.seq === 'T2' && t2!.coil === 'head').toBe(true)
    const flair = sliceSpec('mri', 'brain', axial(24, 'FLAIR', 'FLAIR axial'), 12, LM, p)
    expect(flair!.kind === 'mri' && flair!.seq).toBe('FLAIR')
    const pdfs = sliceSpec('mri', 'knee', seq('PD fat-sat coronal', 'coronal', 'PD', 22), 11, LM, p)
    expect(pdfs!.kind === 'mri' && pdfs!.seq).toBe('PDFS')
    // a knee coronal is seen from the front: its normal points front-back
    expect(Math.abs(plane(pdfs).ny)).toBeGreaterThan(0.99)
    const sag = sliceSpec('mri', 'knee', seq('PD fat-sat sagittal', 'sagittal', 'PD', 22), 11, LM, p)
    expect(Math.abs(plane(sag).nx)).toBeGreaterThan(0.99)
  })

  it('puts the lead marker on the side imaged and the R on the patient’s right of a chest', () => {
    const chest = sliceSpec('xray', 'chest', seq('PA view', 'projection', 'none', 1), 0, LM, p)
    expect(chest!.kind === 'xray' && chest!.marker).toBe('R')
    expect(chest!.kind === 'xray' && chest!.markerX).toBeLessThan(0.5)
    const knee = sliceSpec('xray', 'knee', seq('AP view', 'projection', 'none', 1), 0, LM, p)
    expect(knee!.kind === 'xray' && knee!.marker).toBe(p.side < 0 ? 'R' : 'L')
    for (const part of ['knee', 'ankle', 'wrist'] as const) for (const v of ['AP view', 'Lateral view']) expect(sliceSpec('xray', part, seq(v, 'projection', 'none', 1), 0, LM, p), `${part} ${v}`).not.toBeNull()
  })

  it('returns null without the landmarks a region would give', () => {
    expect(sliceSpec('ct', 'head', axial(40), 0, {}, p)).toBeNull()
    expect(sliceSpec('mri', 'knee', axial(20, 'T1'), 0, {}, p)).toBeNull()
  })
})

describe('the scout inset', () => {
  const b = new BodyBuilder()
  const lm = buildRegions(b, p, ['abdomen'])
  const ct = axial(60, 'arterial', 'Arterial phase')

  it('draws a CT abdomen slice as a level line across the topogram, lower for later slices, inside the picture', () => {
    const at = (k: number) => sliceMeta(sliceSpec('ct', 'abdomen', ct, k, lm, p)!, 'ct', 'abdomen', ct, lm, p)
    const a = at(0)
    const z = at(59)
    expect(a.insetK).toBe(0)
    expect(Math.abs(a.lines[1] - a.lines[3])).toBeLessThan(0.01)
    expect(z.lines[1]).toBeGreaterThan(a.lines[1] + 0.3)
    for (const v of [...a.lines, ...z.lines]) expect(v).toBeGreaterThan(-0.2)
    for (const v of [...a.lines, ...z.lines]) expect(v).toBeLessThan(1.2)
    expect(a.level).toBe(60)
    expect(a.kv).toBe(120)
  })

  it('shows a lumbar MRI axial on a localiser square to it, with TR and TE of the sequence', () => {
    const t2ax = seq('T2 axial', 'axial', 'T2', 20)
    const m = sliceMeta(sliceSpec('mri', 'lumbarSpine', t2ax, 5, lm, p)!, 'mri', 'lumbarSpine', t2ax, lm, p)
    expect(m.insetK).toBe(0)
    expect(m.tr).toBeGreaterThan(2000)
    expect(m.te).toBeGreaterThan(60)
    expect(m.lines.slice(0, 4).every((v) => v > -0.5 && v < 1.5)).toBe(true)
  })

  it('gives a radiograph its exposure index and marker, and no inset', () => {
    const ap = seq('AP pelvis', 'projection', 'none', 1)
    const m = sliceMeta(sliceSpec('xray', 'pelvis', ap, 0, lm, p)!, 'xray', 'pelvis', ap, lm, p)
    expect(m.insetK).toBe(-1)
    expect(m.marker).toBe(1)
    expect(m.ei).toBeGreaterThan(200)
    expect(m.ei).toBeLessThan(400)
  })
})
