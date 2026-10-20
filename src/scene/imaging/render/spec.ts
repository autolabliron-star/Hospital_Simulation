/**
 * R3 "Real screens": what slice k of a sequence images on THIS patient, the way a radiographer plans it on the landmarks: CT abdomen from the
 * diaphragm to the symphysis, CT head along the skull base's tilt, the cervical spine following its curve, lumbar MRI sagittals across the
 * canal and axial blocks tilted to each disc, the knee's planes along the femur, radiographs centred on the joint. Pure: (exam's modality and
 * body part, the sequence, k, the body's landmarks and the patient) -> a renderer request, or null when the region is not one this planner
 * knows yet or its landmarks are missing (the screen then keeps the vector picture).
 *
 * `sliceMeta` gives what the scanner prints round the picture (window, table position, TR/TE, exposure, the lead marker) and where the
 * slice lies on the exam's scout picture (the topogram or the localiser), so the screen can draw the slice line on its inset.
 */
import type { BodyPart, ImagingModality, ScanSequence } from '@/sim/types'
import type { V3 } from '../phantom/body'
import type { PatientParams } from '../phantom/params'
import type { Landmarks } from '../phantom/regions/types'
import type { CtPhase } from './ct'
import { MRI_TIMING, type Coil, type MriSeq } from './mri'
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
  kv: number
  mas: number
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
  /** Tube current-time product (mAs) for the screen's words. */
  mas: number
  /** The lead marker: which side ('R' / 'L', '' none) and where it lies on the picture (fractions). */
  marker: '' | 'R' | 'L'
  markerX: number
  markerY: number
}

export type SliceSpec = CtSpec | MriSpec | XraySpec

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const frac = (k: number, n: number): number => (n <= 1 ? 0.5 : (Math.max(0, Math.min(n - 1, k)) + 0.5) / n)
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
/** `v` made perpendicular to unit `n`, normalised. */
const perp = (v: V3, n: V3): V3 => unit(add(v, n, -dot(v, n)))

/** Axial: picture right = patient left, picture down = posterior (radiological, seen from the feet). */
const AX_U: V3 = [1, 0, 0]
const AX_V: V3 = [0, 1, 0]
/** Sagittal: picture right = posterior, picture down = feet. */
const SAG_U: V3 = [0, 1, 0]
const SAG_V: V3 = [0, 0, -1]
/** Coronal: picture right = patient left, picture down = feet. */
const COR_U: V3 = [1, 0, 0]
const COR_V: V3 = [0, 0, -1]

/** An axial-like plane through c with normal n (toward the head): picture right the patient's left, down posterior. */
function axialPlane(c: V3, n: V3, fov: number, thick: number): Plane {
  const u = perp(AX_U, n)
  return plane(c, u, cross(n, u), fov, thick)
}

/** A projection with the focal spot `sid` mm from the detector, the beam along unit `dir` through c, picture axes u (right) and v (down). */
function projection(c: V3, dir: V3, u: V3, v: V3, w: number, h: number, sid: number): Projection {
  return { sx: c[0] - dir[0] * sid * 0.8, sy: c[1] - dir[1] * sid * 0.8, sz: c[2] - dir[2] * sid * 0.8, dx: c[0] + dir[0] * sid * 0.2, dy: c[1] + dir[1] * sid * 0.2, dz: c[2] + dir[2] * sid * 0.2, ux: u[0], uy: u[1], uz: u[2], vx: v[0], vy: v[1], vz: v[2], width: w, height: h }
}

/** An AP projection (tube in front, detector behind) of a region `w` x `h` mm centred at c, seen as a radiograph is hung. */
function apProjection(c: V3, w: number, h: number, sid: number): Projection {
  return projection(c, [0, 1, 0], [1, 0, 0], [0, 0, -1], w, h, sid)
}

/** A lateral projection from the patient's right (the face on the picture's left, head up). */
function lateralProjection(c: V3, w: number, h: number, sid: number): Projection {
  return projection(c, [1, 0, 0], [0, 1, 0], [0, 0, -1], w, h, sid)
}

function xray(proj: Projection, kv: number, mas: number, spr: number, photons: number, fieldW: number, fieldH: number, marker: XraySpec['marker'] = '', markerX = 0.1, markerY = 0.1): XraySpec {
  return { kind: 'xray', proj, kv, spr, photons, fieldW, fieldH, topogram: false, mas, marker, markerX, markerY }
}

function topogram(proj: Projection): XraySpec {
  return { kind: 'xray', proj, kv: 120, spr: 1.2, photons: 2500, fieldW: 1, fieldH: 1, topogram: true, mas: 35, marker: '', markerX: 0, markerY: 0 }
}

// --- CT -------------------------------------------------------------------------------------------------------------------

function ctAbdomen(seq: SeqLike, k: number, p: PatientParams): CtSpec {
  const top = 412 * p.height
  const bottom = -24 * p.height
  const z = lerp(top, bottom, frac(k, seq.images))
  const phase: CtPhase = seq.contrast === 'arterial' ? 'arterial' : seq.contrast === 'portal' ? 'portal' : 'plain'
  return {
    kind: 'ct',
    plane: plane([0, 6 * p.depth, z], AX_U, AX_V, 420 * Math.max(p.width, 0.95), 1.25),
    phase,
    level: phase === 'arterial' ? 60 : 50,
    width: 400,
    kernel: 'soft',
    noiseHu: 10 * Math.sqrt(p.width * p.depth),
    z,
    kv: 120,
    mas: 210,
  }
}

/** CT head: 5 mm axials from below the foramen magnum to the vertex, tilted along the skull base (the orbitomeatal line), brain window. */
function ctHead(seq: SeqLike, k: number, lm: Landmarks): CtSpec | null {
  const { headCentre: hc, vertex, foramenMagnum: fm } = lm
  if (!hc || !vertex || !fm) return null
  const n = unit(lm.axialNormal ?? [0, 0, 1])
  const s0 = dot(add(fm, hc, -1), n) - 16
  const s1 = dot(add(vertex, hc, -1), n) - 4
  const s = lerp(s0, s1, frac(k, seq.images))
  const c = add(hc, n, s)
  return { kind: 'ct', plane: axialPlane(c, n, 240, 5), phase: 'plain', level: 40, width: 80, kernel: 'soft', noiseHu: 3.5, z: c[2], kv: 120, mas: 280 }
}

/** The polyline of the cervical vertebral bodies, C1 (top) to T1. */
function cervicalPath(lm: Landmarks): V3[] | null {
  const names = ['vertC1', 'vertC2', 'vertC3', 'vertC4', 'vertC5', 'vertC6', 'vertC7', 'vertT1']
  const pts = names.map((n) => lm[n])
  return pts.every(Boolean) ? (pts as V3[]) : null
}

/** CT cervical spine: thin axials from the skull base to T1, each square to the spine's curve where it is, bone window, sharp kernel. */
function ctCspine(seq: SeqLike, k: number, lm: Landmarks): CtSpec | null {
  const path = cervicalPath(lm)
  if (!path) return null
  // from 14 mm above C1 to T1, by arc length
  const pts: V3[] = [add(path[0], unit(add(path[0], path[1], -1)), 14), ...path]
  const len: number[] = [0]
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]))
  const at = frac(k, seq.images) * len[len.length - 1]
  let i = 0
  while (i < pts.length - 2 && len[i + 1] < at) i++
  const t = (at - len[i]) / (len[i + 1] - len[i] || 1)
  const c = add(pts[i], add(pts[i + 1], pts[i], -1), t)
  // the normal points to the head
  const n = unit(add(pts[i], pts[i + 1], -1))
  return { kind: 'ct', plane: axialPlane(add(c, [0, 14, 0]), n, 160, 1), phase: 'plain', level: 500, width: 2000, kernel: 'sharp', noiseHu: 14, z: c[2], kv: 120, mas: 200 }
}

/** CT chest: from above the lung apices to below the diaphragm, lung window (the vessels and bronchi are what the eye reads). */
function ctChest(seq: SeqLike, k: number, lm: Landmarks, p: PatientParams): CtSpec | null {
  const { apexR, apexL, domeR, domeL } = lm
  if (!apexR || !apexL || !domeR || !domeL) return null
  const top = Math.max(apexR[2], apexL[2]) + 18
  const bottom = Math.min(domeR[2], domeL[2]) - 45
  const z = lerp(top, bottom, frac(k, seq.images))
  const phase: CtPhase = seq.contrast === 'arterial' ? 'arterial' : seq.contrast === 'portal' ? 'portal' : 'plain'
  return { kind: 'ct', plane: plane([0, 8 * p.depth, z], AX_U, AX_V, 400 * Math.max(p.width, 0.95), 1.25), phase, level: -600, width: 1500, kernel: 'sharp', noiseHu: 12 * Math.sqrt(p.width * p.depth), z, kv: 120, mas: 120 }
}

/** The CT topogram of an exam: an AP scout of the trunk, or a lateral scout of the head and neck. */
function ctTopogram(bodyPart: BodyPart, lm: Landmarks, p: PatientParams): XraySpec | null {
  if (bodyPart === 'head') {
    const { headCentre: hc, vertex } = lm
    if (!hc || !vertex) return null
    return topogram(lateralProjection([0, hc[1], vertex[2] - 150], 340, 340, 1000))
  }
  if (bodyPart === 'cervicalSpine') {
    const c = lm.vertC4
    if (!c) return null
    return topogram(lateralProjection([0, c[1] + 10, c[2] + 40], 300, 300, 1000))
  }
  if (bodyPart === 'chest') return topogram(apProjection([0, 4 * p.depth, 500 * p.height], 520, 520, 1000))
  return topogram(apProjection([0, 4 * p.depth, 190 * p.height], 520, 520, 1000))
}

// --- MRI ------------------------------------------------------------------------------------------------------------------

function mriSeqOf(seq: SeqLike): MriSeq {
  if (seq.plane === 'scout') return 'LOC'
  switch (seq.contrast) {
    case 'T1':
      return 'T1'
    case 'FLAIR':
      return 'FLAIR'
    case 'DWI':
      return 'DWI'
    case 'STIR':
      return 'STIR'
    case 'PD':
      return /fat.?sat|\bFS\b/i.test(seq.name) ? 'PDFS' : 'PD'
    default:
      return 'T2'
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
  const seqOf = mriSeqOf(seq)
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

/** MRI brain: a three-plane localiser, sagittals across the whole head, axials along the AC-PC line from the foramen magnum to the vertex. */
function mriBrain(seq: SeqLike, k: number, lm: Landmarks): MriSpec | null {
  const { headCentre: hc, vertex, foramenMagnum: fm } = lm
  if (!hc || !vertex || !fm) return null
  const n = unit(lm.axialNormal ?? [0, 0, 1])
  const seqOf = mriSeqOf(seq)
  if (seq.plane === 'scout') {
    const pl = k === 0 ? plane([0, hc[1], hc[2] - 20], SAG_U, SAG_V, 280, 8) : k === 1 ? plane([0, hc[1] + 6, hc[2] - 20], COR_U, COR_V, 280, 8) : axialPlane(hc, n, 260, 8)
    return { kind: 'mri', plane: pl, seq: 'LOC', coil: 'head', snr: 20, z: hc[2] }
  }
  if (seq.plane === 'sagittal') {
    const l = lerp(-64, 64, frac(k, seq.images))
    return { kind: 'mri', plane: plane([l, hc[1] + 4, hc[2] - 22], SAG_U, SAG_V, 250, 5), seq: seqOf, coil: 'head', snr: 32, z: l }
  }
  if (seq.plane === 'coronal') {
    const a = lerp(-80, 90, frac(k, seq.images))
    return { kind: 'mri', plane: plane([0, hc[1] + a, hc[2] - 20], COR_U, COR_V, 250, 5), seq: seqOf, coil: 'head', snr: 30, z: a }
  }
  const s0 = dot(add(fm, hc, -1), n) + 2
  const s1 = dot(add(vertex, hc, -1), n) - 6
  const c = add(hc, n, lerp(s0, s1, frac(k, seq.images)))
  const snr = seqOf === 'DWI' ? 14 : seqOf === 'FLAIR' ? 22 : 30
  return { kind: 'mri', plane: axialPlane(c, n, 230, 5), seq: seqOf, coil: 'head', snr, z: c[2] }
}

/** The knee's frame from its landmarks: the joint centre, the femur's axis (toward the hip), lateral and anterior. */
function kneeFrame(lm: Landmarks): { c: V3; a: V3; lat: V3; ant: V3 } | null {
  const { kneeCentre: c, femurAxis, lateral } = lm
  if (!c || !femurAxis || !lateral) return null
  const a = unit(femurAxis)
  const lat = perp(lateral, a)
  const ant = perp(lm.anterior ?? [0, -1, 0], a)
  return { c, a, lat, ant }
}

/** MRI knee: a three-plane localiser, coronals from back to front, sagittals from side to side, in the knee coil. */
function mriKnee(seq: SeqLike, k: number, lm: Landmarks, p: PatientParams): MriSpec | null {
  const f = kneeFrame(lm)
  if (!f) return null
  const seqOf = mriSeqOf(seq)
  const down: V3 = [-f.a[0], -f.a[1], -f.a[2]]
  const back: V3 = [-f.ant[0], -f.ant[1], -f.ant[2]]
  // coronal: picture right = the patient's left; sagittal: picture right = posterior
  const corU = perp(COR_U, f.a)
  if (seq.plane === 'scout') {
    const pl = k === 0 ? plane(f.c, back, down, 200, 6) : k === 1 ? plane(f.c, corU, down, 200, 6) : plane(f.c, corU, back, 180, 6)
    return { kind: 'mri', plane: pl, seq: 'LOC', coil: 'knee', snr: 18, z: f.c[2] }
  }
  if (seq.plane === 'sagittal') {
    const o = lerp(-46, 46, frac(k, seq.images)) * p.width
    return { kind: 'mri', plane: plane(add(f.c, f.lat, o), back, down, 160, 3), seq: seqOf, coil: 'knee', snr: 26, z: o }
  }
  if (seq.plane === 'axial') {
    const o = lerp(40, -40, frac(k, seq.images))
    return { kind: 'mri', plane: plane(add(f.c, f.a, o), corU, back, 150, 3), seq: seqOf, coil: 'knee', snr: 26, z: o }
  }
  const o = lerp(-34, 30, frac(k, seq.images)) * p.depth
  return { kind: 'mri', plane: plane(add(f.c, f.ant, o), corU, down, 160, 3), seq: seqOf, coil: 'knee', snr: 26, z: o }
}

// --- X-ray ----------------------------------------------------------------------------------------------------------------

const sideMarker = (side: -1 | 1): 'R' | 'L' => (side < 0 ? 'R' : 'L')

function xrayPelvis(seq: SeqLike, p: PatientParams): XraySpec {
  if (/lateral/i.test(seq.name)) {
    // the hip of the patient's side, an oblique view collimated to it
    const h: V3 = [p.side * 100 * p.width, 2 * p.depth, -10 * p.height]
    const dir = unit([-p.side * 0.7, 0.72, 0])
    // picture right: across the beam, horizontal; down: the feet
    const u = unit([dir[1], -dir[0], 0])
    return xray(projection(h, dir, u, [0, 0, -1], 260, 260, 1000), 80, 25, 1.4, 3500, 0.86, 0.86, sideMarker(p.side), 0.14, 0.14)
  }
  // the R marker at the patient's right: the picture's left
  return xray(apProjection([0, 4 * p.depth, 70 * p.height], 430, 430, 1000), 75, 16, 1.6, 4000, 0.94, 0.78, 'R', 0.1, 0.17)
}

/** Chest PA: the tube behind, the detector against the chest, 1.8 m away; the R marker over the right apex. */
function xrayChest(p: PatientParams): XraySpec {
  const c: V3 = [0, 10 * p.depth, 505 * p.height]
  return xray(projection(c, [0, -1, 0], [1, 0, 0], [0, 0, -1], 420, 430, 1800), 110, 2, 1.8, 4200, 0.92, 0.96, 'R', 0.08, 0.06)
}

/** AP and lateral of a limb joint: centre, the limb's axis (toward the trunk), its lateral direction; field size (mm). */
function limbViews(seq: SeqLike, c: V3, axis: V3, lat: V3, side: -1 | 1, w: number, h: number, kv: number, mas: number, spr: number): XraySpec {
  const a = unit(axis)
  const l = perp(lat, a)
  const down: V3 = [-a[0], -a[1], -a[2]]
  const marker = sideMarker(side)
  if (/lateral/i.test(seq.name)) {
    // beam from the medial side to the lateral: picture right = posterior
    const ant = cross(a, l)
    const post: V3 = [-ant[0], -ant[1], -ant[2]]
    return xray(projection(c, l, ant[1] < 0 ? post : ant, down, h, h, 1000), kv + 3, mas, spr, 3000, 0.82, 0.92, marker, 0.15, 0.1)
  }
  // AP (or PA): across the limb from the front, picture right = the patient's left; the marker on the lateral side
  const u = perp(COR_U, a)
  const mx = dot(l, u) > 0 ? 0.84 : 0.16
  return xray(projection(c, [0, 1, 0], u, down, w, h, 1000), kv, mas, spr, 3000, 0.78, 0.92, marker, mx, 0.1)
}

function xrayLimb(bodyPart: BodyPart, seq: SeqLike, lm: Landmarks, p: PatientParams): XraySpec | null {
  if (bodyPart === 'knee') {
    const f = kneeFrame(lm)
    return f ? limbViews(seq, f.c, f.a, f.lat, p.side, 230, 290, 65, 5, 0.6) : null
  }
  if (bodyPart === 'ankle') {
    const { ankleCentre: c, tibiaAxis: a, lateral } = lm
    if (!c || !a || !lateral) return null
    // the AP is the mortise and the distal leg (the foot, seen end on, would flood it); the lateral takes in the hindfoot
    const lat = /lateral/i.test(seq.name)
    return limbViews(seq, lat ? add(add(c, a, 12), lm.footAxis ?? [0, -1, 0], 18) : add(c, a, 48), a, lateral, p.side, 190, 250, 57, 3.2, 0.35)
  }
  const { wristCentre: c, forearmAxis: a, radial } = lm
  if (!c || !a || !radial) return null
  // the hand is laid flat for the PA (fingers up on the picture); the lateral shows the radius over the ulna
  const s = limbViews(seq, c, [-a[0], -a[1], -a[2]], radial, p.side, 150, 200, 55, 2.5, 0.25)
  return s
}

// --- the planner ----------------------------------------------------------------------------------------------------------

/** The request for slice `k` of a sequence, or null if this body part's planner or its landmarks are missing. */
export function sliceSpec(modality: ImagingModality, bodyPart: BodyPart, seq: SeqLike, k: number, lm: Landmarks, p: PatientParams): SliceSpec | null {
  switch (modality) {
    case 'ct':
      if (seq.plane === 'scout') return ctTopogram(bodyPart, lm, p)
      if (bodyPart === 'abdomen' || bodyPart === 'pelvis') return ctAbdomen(seq, k, p)
      if (bodyPart === 'head') return ctHead(seq, k, lm)
      if (bodyPart === 'cervicalSpine') return ctCspine(seq, k, lm)
      if (bodyPart === 'chest') return ctChest(seq, k, lm, p)
      return null
    case 'mri':
      if (bodyPart === 'lumbarSpine') return mriLumbar(seq, k, lm, p)
      if (bodyPart === 'brain' || bodyPart === 'head') return mriBrain(seq, k, lm)
      if (bodyPart === 'knee') return mriKnee(seq, k, lm, p)
      return null
    case 'xray':
      if (bodyPart === 'pelvis') return xrayPelvis(seq, p)
      if (bodyPart === 'chest') return xrayChest(p)
      if (bodyPart === 'knee' || bodyPart === 'ankle' || bodyPart === 'wrist') return xrayLimb(bodyPart, seq, lm, p)
      return null
    case 'us':
      return null
  }
}

const KNOWN: Record<ImagingModality, readonly BodyPart[]> = {
  ct: ['abdomen', 'pelvis', 'head', 'cervicalSpine', 'chest'],
  mri: ['lumbarSpine', 'brain', 'head', 'knee'],
  xray: ['pelvis', 'chest', 'knee', 'ankle', 'wrist'],
  us: [],
}

/** Does the planner know this exam (before any region is built)? */
export function specKnown(modality: ImagingModality, bodyPart: BodyPart): boolean {
  return KNOWN[modality].includes(bodyPart)
}

// --- what the scanner prints, and the scout inset ----------------------------------------------------------------------------

export interface SliceMeta {
  /** CT window (HU). */
  level: number
  width: number
  /** Table / slice position (mm), slice thickness and field of view (mm); CT: 1 for the sharp (bone, lung) kernel. */
  pos: number
  thick: number
  fov: number
  sharp: number
  /** Tube voltage and current-time product (CT, X-ray). */
  kv: number
  mas: number
  /** MRI repetition, echo and inversion times (ms). */
  tr: number
  te: number
  ti: number
  /** Which scout picture the inset shows (its k in the exam's scout step), -1 none. */
  insetK: number
  /** On the inset, as picture fractions: this slice's line, then the first and last slices of the series: [ax, ay, bx, by] x 3. */
  lines: number[]
  /** X-ray: exposure index; the lead marker (0 none, 1 R, 2 L) and its place on the picture (fractions). */
  ei: number
  marker: number
  markerX: number
  markerY: number
}

const SCOUT: SeqLike = { name: 'Scout', plane: 'scout', contrast: 'none', images: 3 }

/** A segment of a plane's trace on a projection (from the focal spot onto the detector), as picture fractions, into out at o. */
function traceOnProjection(pl: Plane, pr: Projection, out: number[], o: number): boolean {
  const b = unit([pr.dx - pr.sx, pr.dy - pr.sy, pr.dz - pr.sz])
  const n: V3 = [pl.nx, pl.ny, pl.nz]
  const w0 = cross(n, b)
  if (Math.hypot(w0[0], w0[1], w0[2]) < 0.2) return false
  const w = unit(w0)
  const c: V3 = [pl.cx, pl.cy, pl.cz]
  const S: V3 = [pr.sx, pr.sy, pr.sz]
  const D: V3 = [pr.dx, pr.dy, pr.dz]
  const dd = dot(add(D, S, -1), b)
  for (let e = 0; e < 2; e++) {
    const pt = add(c, w, (e ? 0.5 : -0.5) * pl.fov)
    const rel = add(pt, S, -1)
    const q = add(S, rel, dd / (dot(rel, b) || 1))
    out[o + e * 2] = 0.5 + dot(add(q, D, -1), [pr.ux, pr.uy, pr.uz]) / pr.width
    out[o + e * 2 + 1] = 0.5 + dot(add(q, D, -1), [pr.vx, pr.vy, pr.vz]) / pr.height
  }
  return true
}

/** A segment of a plane's intersection with a localiser plane, as fractions of the localiser picture, into out at o. */
function traceOnPlane(pl: Plane, loc: Plane, out: number[], o: number): boolean {
  const n1: V3 = [pl.nx, pl.ny, pl.nz]
  const n2: V3 = [loc.nx, loc.ny, loc.nz]
  const w0 = cross(n1, n2)
  const s2 = dot(w0, w0)
  if (s2 < 0.04) return false
  const d1 = dot(n1, [pl.cx, pl.cy, pl.cz])
  const d2 = dot(n2, [loc.cx, loc.cy, loc.cz])
  const k = dot(n1, n2)
  const c1 = (d1 - d2 * k) / s2
  const c2 = (d2 - d1 * k) / s2
  const w = unit(w0)
  // a point on both planes, then the one nearest the slice's centre
  let x0: V3 = [n1[0] * c1 + n2[0] * c2, n1[1] * c1 + n2[1] * c2, n1[2] * c1 + n2[2] * c2]
  x0 = add(x0, w, dot(add([pl.cx, pl.cy, pl.cz], x0, -1), w))
  const lc: V3 = [loc.cx, loc.cy, loc.cz]
  for (let e = 0; e < 2; e++) {
    const pt = add(x0, w, (e ? 0.5 : -0.5) * pl.fov)
    const rel = add(pt, lc, -1)
    out[o + e * 2] = 0.5 + dot(rel, [loc.ux, loc.uy, loc.uz]) / loc.fov
    out[o + e * 2 + 1] = 0.5 + dot(rel, [loc.vx, loc.vy, loc.vz]) / loc.fov
  }
  return true
}

/** The scout picture an exam's slice is best shown on (CT: its topogram; MRI: the localiser most square to it) and the lines on it. */
function insetLines(modality: ImagingModality, bodyPart: BodyPart, seq: SeqLike, pl: Plane, lm: Landmarks, p: PatientParams, meta: SliceMeta): void {
  meta.insetK = -1
  if (seq.plane === 'scout' || seq.plane === 'projection') return
  const plOf = (kk: number): Plane | null => {
    const s = sliceSpec(modality, bodyPart, seq, kk, lm, p)
    return s && s.kind !== 'xray' ? s.plane : null
  }
  const first = plOf(0)
  const last = plOf(seq.images - 1)
  if (modality === 'ct') {
    const t = sliceSpec('ct', bodyPart, SCOUT, 0, lm, p)
    if (!t || t.kind !== 'xray') return
    if (!traceOnProjection(pl, t.proj, meta.lines, 0)) return
    if (first) traceOnProjection(first, t.proj, meta.lines, 4)
    if (last) traceOnProjection(last, t.proj, meta.lines, 8)
    meta.insetK = 0
    return
  }
  if (modality !== 'mri') return
  let best = -1
  let bestS = 0.2
  let loc: Plane | null = null
  for (let kk = 0; kk < 3; kk++) {
    const s = sliceSpec('mri', bodyPart, SCOUT, kk, lm, p)
    if (!s || s.kind !== 'mri') continue
    const w = cross([pl.nx, pl.ny, pl.nz], [s.plane.nx, s.plane.ny, s.plane.nz])
    const sn = Math.hypot(w[0], w[1], w[2])
    if (sn > bestS + 0.05) {
      best = kk
      bestS = sn
      loc = s.plane
    }
  }
  if (!loc || !traceOnPlane(pl, loc, meta.lines, 0)) return
  if (first) traceOnPlane(first, loc, meta.lines, 4)
  if (last) traceOnPlane(last, loc, meta.lines, 8)
  meta.insetK = best
}

/** A fresh, empty meta. */
export function emptySliceMeta(): SliceMeta {
  return { level: 0, width: 0, pos: 0, thick: 0, fov: 0, sharp: 0, kv: 0, mas: 0, tr: 0, te: 0, ti: 0, insetK: -1, lines: new Array(12).fill(-1), ei: 0, marker: 0, markerX: 0, markerY: 0 }
}

/** What the scanner prints round slice k, and its line on the scout inset. */
export function sliceMeta(spec: SliceSpec, modality: ImagingModality, bodyPart: BodyPart, seq: SeqLike, lm: Landmarks, p: PatientParams): SliceMeta {
  const m = emptySliceMeta()
  if (spec.kind === 'ct') {
    m.level = spec.level
    m.width = spec.width
    m.pos = spec.z
    m.thick = spec.plane.thick
    m.fov = spec.plane.fov
    m.sharp = spec.kernel === 'sharp' ? 1 : 0
    m.kv = spec.kv
    m.mas = spec.mas
    insetLines(modality, bodyPart, seq, spec.plane, lm, p, m)
  } else if (spec.kind === 'mri') {
    const t = MRI_TIMING[spec.seq]
    m.tr = t.tr
    m.te = t.te
    m.ti = t.ti
    m.pos = spec.z
    m.thick = spec.plane.thick
    m.fov = spec.plane.fov
    insetLines(modality, bodyPart, seq, spec.plane, lm, p, m)
  } else {
    m.fov = spec.proj.width
    m.kv = spec.kv
    m.mas = spec.mas
    // a well-exposed plate: EI near the target, a little either side from patient to patient
    m.ei = spec.topogram ? 0 : Math.round(300 * Math.pow(10, (((p.seed >>> 3) % 21) - 10) / 100))
    m.marker = spec.marker === 'R' ? 1 : spec.marker === 'L' ? 2 : 0
    m.markerX = spec.markerX
    m.markerY = spec.markerY
  }
  return m
}
