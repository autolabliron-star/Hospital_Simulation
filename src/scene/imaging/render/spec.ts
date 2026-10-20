/**
 * R3 "Real screens": what slice k of a sequence images on THIS patient, the way a radiographer plans it on the landmarks: CT abdomen from the
 * diaphragm to the symphysis, lumbar MRI sagittals across the canal and axial blocks tilted to each disc, the pelvis radiograph centred on
 * the hips. Pure: (exam's modality and body part, the sequence, k, the body's landmarks and the patient) -> a renderer request, or null when
 * the region is not one this planner knows yet (the screen then keeps the vector picture).
 */
import type { BodyPart, ImagingModality, ScanSequence } from '@/sim/types'
import type { V3 } from '../phantom/body'
import type { PatientParams } from '../phantom/params'
import type { Landmarks } from '../phantom/regions/types'
import type { CtPhase } from './ct'
import type { Coil, MriSeq } from './mri'
import { plane, type Plane } from './raster'
import type { Projection } from './xray'

export type SeqLike = Pick<ScanSequence, 'name' | 'plane' | 'contrast' | 'images'>

export interface CtSpec {
  kind: 'ct'
  plane: Plane
  phase: CtPhase
  level: number
  width: number
  kernel: 'soft' | 'sharp'
  noiseHu: number
  /** Where along the scan (mm, S) for the screen's words. */
  z: number
}

export interface MriSpec {
  kind: 'mri'
  plane: Plane
  seq: MriSeq
  coil: Coil
  snr: number
  z: number
}

export interface XraySpec {
  kind: 'xray'
  proj: Projection
  kv: number
  spr: number
  photons: number
  fieldW: number
  fieldH: number
  topogram: boolean
}

export type SliceSpec = CtSpec | MriSpec | XraySpec

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const frac = (k: number, n: number): number => (n <= 1 ? 0.5 : (Math.max(0, Math.min(n - 1, k)) + 0.5) / n)
const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Axial: picture right = patient left, picture down = posterior (radiological, seen from the feet). */
const AX_U: V3 = [1, 0, 0]
const AX_V: V3 = [0, 1, 0]
/** Sagittal: picture right = posterior, picture down = feet. */
const SAG_U: V3 = [0, 1, 0]
const SAG_V: V3 = [0, 0, -1]
/** Coronal: picture right = patient left, picture down = feet. */
const COR_U: V3 = [1, 0, 0]
const COR_V: V3 = [0, 0, -1]

/** An AP projection (tube in front, detector behind) of a region `w` x `h` mm centred at c, seen as a radiograph is hung. */
function apProjection(c: V3, w: number, h: number, sid: number): Projection {
  return { sx: c[0], sy: c[1] - sid * 0.8, sz: c[2], dx: c[0], dy: c[1] + sid * 0.2, dz: c[2], ux: 1, uy: 0, uz: 0, vx: 0, vy: 0, vz: -1, width: w, height: h }
}

function ctAbdomen(seq: SeqLike, k: number, lm: Landmarks, p: PatientParams): CtSpec {
  const top = 412 * p.height
  const bottom = -24 * p.height
  const z = lerp(top, bottom, frac(k, seq.images))
  const phase: CtPhase = seq.contrast === 'arterial' ? 'arterial' : seq.contrast === 'portal' ? 'portal' : 'plain'
  void lm
  return {
    kind: 'ct',
    plane: plane([0, 6 * p.depth, z], AX_U, AX_V, 420 * Math.max(p.width, 0.95), 1.25),
    phase,
    level: phase === 'arterial' ? 60 : 50,
    width: 400,
    kernel: 'soft',
    noiseHu: 10 * Math.sqrt(p.width * p.depth),
    z,
  }
}

/** The disc centres of the lumbar spine and their normals, from the vertebral landmarks: L2-3 down to L5-S1. */
function lumbarDiscs(lm: Landmarks): { c: V3; n: V3 }[] {
  const pairs: [string, string][] = [
    ['vertL2', 'vertL3'],
    ['vertL3', 'vertL4'],
    ['vertL4', 'vertL5'],
    ['vertL5', 'vertS1'],
  ]
  const out: { c: V3; n: V3 }[] = []
  for (const [a, b] of pairs) {
    const A = lm[a]
    const B = lm[b]
    if (!A || !B) continue
    out.push({ c: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2], n: unit([A[0] - B[0], A[1] - B[1], A[2] - B[2]]) })
  }
  return out
}

function mriLumbar(seq: SeqLike, k: number, lm: Landmarks, p: PatientParams): MriSpec | null {
  const L3 = lm.vertL3
  if (!L3) return null
  const seqOf: MriSeq = seq.plane === 'scout' ? 'LOC' : seq.contrast === 'T1' ? 'T1' : 'T2'
  if (seq.plane === 'scout') {
    const c: V3 = [0, L3[1] + 12, L3[2]]
    const pl = k === 0 ? plane(c, SAG_U, SAG_V, 400, 8) : k === 1 ? plane([0, L3[1], L3[2]], COR_U, COR_V, 400, 8) : plane([0, L3[1] - 20, L3[2] - 30], AX_U, AX_V, 360, 8)
    return { kind: 'mri', plane: pl, seq: 'LOC', coil: 'spine', snr: 18, z: c[2] }
  }
  if (seq.plane === 'sagittal') {
    const l = lerp(-30, 30, frac(k, seq.images)) * p.width
    return { kind: 'mri', plane: plane([l, L3[1] + 20 * p.depth, L3[2] - 20], SAG_U, SAG_V, 320, 4), seq: seqOf, coil: 'spine', snr: 34, z: l }
  }
  // axial: blocks of slices through each disc, tilted to it
  const discs = lumbarDiscs(lm)
  if (discs.length === 0) return null
  const per = Math.max(1, Math.round(seq.images / discs.length))
  const d = discs[Math.min(discs.length - 1, Math.floor(k / per))]
  const off = ((k % per) - (per - 1) / 2) * 4
  const n = d.n
  // v: posterior, made perpendicular to the disc's normal; u across (picture right = the patient's left)
  const v: V3 = unit([-n[1] * n[0], 1 - n[1] * n[1], -n[1] * n[2]])
  const u: V3 = unit([v[1] * n[2] - v[2] * n[1], v[2] * n[0] - v[0] * n[2], v[0] * n[1] - v[1] * n[0]])
  const c: V3 = [d.c[0] + n[0] * off, d.c[1] + n[1] * off + 10, d.c[2] + n[2] * off]
  return { kind: 'mri', plane: plane(c, u[0] < 0 ? [-u[0], -u[1], -u[2]] : u, v, 200, 4), seq: seqOf, coil: 'spine', snr: 26, z: c[2] }
}

function xrayPelvis(seq: SeqLike, p: PatientParams): XraySpec {
  if (/lateral/i.test(seq.name)) {
    // the hip of the patient's side, an oblique view collimated to it
    const h: V3 = [p.side * 100 * p.width, 2 * p.depth, -10 * p.height]
    const dir = unit([-p.side * 0.7, 0.72, 0])
    const sid = 1000
    const s: V3 = [h[0] - dir[0] * sid * 0.8, h[1] - dir[1] * sid * 0.8, h[2]]
    const d: V3 = [h[0] + dir[0] * sid * 0.2, h[1] + dir[1] * sid * 0.2, h[2]]
    // picture right: across the beam, horizontal; down: the feet
    const u = unit([dir[1], -dir[0], 0])
    return { kind: 'xray', proj: { sx: s[0], sy: s[1], sz: s[2], dx: d[0], dy: d[1], dz: d[2], ux: u[0], uy: u[1], uz: u[2], vx: 0, vy: 0, vz: -1, width: 260, height: 260 }, kv: 80, spr: 1.4, photons: 3500, fieldW: 0.86, fieldH: 0.86, topogram: false }
  }
  return { kind: 'xray', proj: apProjection([0, 4 * p.depth, 70 * p.height], 430, 430, 1000), kv: 75, spr: 1.6, photons: 4000, fieldW: 0.94, fieldH: 0.78, topogram: false }
}

/** The CT topogram of an abdomen exam: an AP scout from the dome to below the hips. */
function topogramAbdomen(p: PatientParams): XraySpec {
  return { kind: 'xray', proj: apProjection([0, 4 * p.depth, 190 * p.height], 520, 520, 1000), kv: 120, spr: 1.2, photons: 2500, fieldW: 1, fieldH: 1, topogram: true }
}

/** The request for slice `k` of a sequence, or null if this body part's region has no planner yet. */
export function sliceSpec(modality: ImagingModality, bodyPart: BodyPart, seq: SeqLike, k: number, lm: Landmarks, p: PatientParams): SliceSpec | null {
  switch (modality) {
    case 'ct':
      if (bodyPart !== 'abdomen' && bodyPart !== 'pelvis') return null
      return seq.plane === 'scout' ? topogramAbdomen(p) : ctAbdomen(seq, k, lm, p)
    case 'mri':
      if (bodyPart !== 'lumbarSpine') return null
      return mriLumbar(seq, k, lm, p)
    case 'xray':
      if (bodyPart !== 'pelvis') return null
      return xrayPelvis(seq, p)
    case 'us':
      return null
  }
}

/** Does the planner know this exam (before any region is built)? */
export function specKnown(modality: ImagingModality, bodyPart: BodyPart): boolean {
  if (modality === 'ct') return bodyPart === 'abdomen' || bodyPart === 'pelvis'
  if (modality === 'mri') return bodyPart === 'lumbarSpine'
  if (modality === 'xray') return bodyPart === 'pelvis'
  return false
}
