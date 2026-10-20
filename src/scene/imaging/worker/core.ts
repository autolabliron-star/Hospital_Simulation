/**
 * R3 "Real screens": the imaging worker's brain, with no worker in it (so node tests and the inline backend run it as is). It keeps the
 * compiled synthetic bodies of the last few patients and one renderer per slot (their buffers and look-up tables), and turns a job into
 * greyscale-as-RGBA pixels plus metadata.
 */
import { BodyBuilder, type Phantom } from '../phantom/body'
import { patientParams, type PatientParams } from '../phantom/params'
import { buildRegions, regionsFor, regionsReady } from '../phantom/regions'
import type { Landmarks, RegionId } from '../phantom/regions/types'
import { CtRenderer } from '../render/ct'
import { MriRenderer } from '../render/mri'
import { sliceMeta, sliceSpec, specKnown } from '../render/spec'
import { US_FULL, US_LITE, UsRenderer } from '../render/us'
import { XrayRenderer } from '../render/xray'
import { NirRenderer } from '../render/nir'
import { US_LINEAR } from '../render/us'
import { skinExit } from '../phantom/body'
import type { V3 } from '../phantom/body'
import type { FrameMeta, Job, SliceJob, UsJob, VeinJob } from './protocol'

interface Body {
  ph: Phantom
  params: PatientParams
  landmarks: Landmarks
  /** Organ group of every part: 0 none, 1 kidney, 2 liver, 3 gallbladder, 4 spleen, 5 bladder. */
  group: Uint8Array
}

const GROUPS: [RegExp, number][] = [
  [/^(kidneyCortex|pyramids|sinus|renalPelvis)/, 1],
  [/^liver$/, 2],
  [/^(bile|gbWall|gallstone)$/, 3],
  [/^spleen$/, 4],
  [/^bladder/, 5],
]

export interface Rendered {
  rgba: Uint8ClampedArray
  w: number
  h: number
  meta: FrameMeta
}

export class RenderCore {
  private readonly bodies = new Map<string, Body>()
  private readonly us = new Map<string, UsRenderer>()

  private readonly ct = new Map<string, CtRenderer>()
  private readonly mri = new Map<string, MriRenderer>()
  private readonly xray = new Map<string, XrayRenderer>()
  private readonly nir = new Map<string, NirRenderer>()
  /** The last vein map per slot (it changes only with the patient) and whose it was. */
  private readonly nirCache = new Map<string, { seed: number; w: number; h: number; grey: Uint8Array; tx: number; ty: number }>()

  /** The compiled body of a patient for a set of regions (the last 4 are kept). */
  body(seed: number, regions: readonly RegionId[]): Body {
    const key = `${regions.join('+')}:${seed}`
    let b = this.bodies.get(key)
    if (b) {
      // most recently used last
      this.bodies.delete(key)
      this.bodies.set(key, b)
      return b
    }
    const params = patientParams(seed)
    const builder = new BodyBuilder()
    const landmarks = buildRegions(builder, params, regions)
    const ph = builder.compile()
    const group = new Uint8Array(ph.nParts)
    ph.names.forEach((n, i) => {
      for (const [re, g] of GROUPS) if (re.test(n)) group[i] = g
    })
    b = { ph, params, landmarks, group }
    this.bodies.set(key, b)
    while (this.bodies.size > 4) this.bodies.delete(this.bodies.keys().next().value as string)
    return b
  }

  handle(job: Job): Rendered {
    return job.t === 'us' ? this.renderUs(job) : job.t === 'vein' ? this.renderVein(job) : this.renderSlice(job)
  }

  renderSlice(job: SliceJob): Rendered {
    const t0 = now()
    const n = job.size * job.size
    const rgba = new Uint8ClampedArray(n * 4)
    const meta: FrameMeta = { kidney: 0, liver: 0, gallbladder: 0, spleen: 0, bladder: 0, ms: 0 }
    const regions = regionsFor(job.modality, job.bodyPart)
    if (!specKnown(job.modality, job.bodyPart) || !regionsReady(regions)) return { rgba, w: job.size, h: job.size, meta }
    const b = this.body(job.seed, regions)
    const spec = sliceSpec(job.modality, job.bodyPart, job.seq, job.k, b.landmarks, b.params)
    if (!spec) {
      meta.ms = now() - t0
      return { rgba, w: job.size, h: job.size, meta }
    }
    // every slice of every series has its own noise
    const slice = job.k * 7 + job.seq.name.length * 131
    let grey: Uint8Array
    if (spec.kind === 'ct') grey = pick(this.ct, job.slot, () => new CtRenderer()).render(b.ph, { plane: spec.plane, phase: spec.phase, level: spec.level, width: spec.width, kernel: spec.kernel, noiseHu: spec.noiseHu, seed: job.seed, slice, size: job.size })
    else if (spec.kind === 'mri') grey = pick(this.mri, job.slot, () => new MriRenderer()).render(b.ph, { plane: spec.plane, seq: spec.seq, coil: spec.coil, snr: spec.snr, seed: job.seed, slice, size: job.size })
    else grey = pick(this.xray, job.slot, () => new XrayRenderer()).render(b.ph, { proj: spec.proj, kv: spec.kv, spr: spec.spr, photons: spec.photons, fieldW: spec.fieldW, fieldH: spec.fieldH, seed: job.seed ^ (job.k * 977), size: job.size, topogram: spec.topogram })
    for (let p = 0, q = 0; p < n; p++, q += 4) {
      const v = grey[p]
      rgba[q] = v
      rgba[q + 1] = v
      rgba[q + 2] = v
      rgba[q + 3] = 255
    }
    meta.slice = sliceMeta(spec, job.modality, job.bodyPart, job.seq, b.landmarks, b.params)
    meta.ms = now() - t0
    return { rgba, w: job.size, h: job.size, meta }
  }

  renderVein(job: VeinJob): Rendered {
    const t0 = now()
    const b = this.body(job.seed, ['forearm'])
    const g = veinGeometry(b.ph, b.landmarks)
    const W = job.mapW + job.us
    const H = Math.max(job.mapH, job.us)
    const rgba = new Uint8ClampedArray(W * H * 4)
    // the vein map: drawn once per patient
    let map = this.nirCache.get(job.slot)
    if (!map || map.seed !== job.seed || map.w !== job.mapW || map.h !== job.mapH) {
      const r = pick(this.nir, job.slot, () => new NirRenderer())
      const grey = r.render(b.ph, { centre: g.centre, xDir: [0, 0, 1], yDir: [1, 0, 0], view: VEIN_VIEW, w: g.w, h: g.h, sizeW: job.mapW, sizeH: job.mapH, seed: job.seed }).slice()
      const tx = 0.5 + (g.target[2] - g.centre[2]) / g.w
      const ty = 0.5 + (g.target[0] - g.centre[0]) / g.h
      map = { seed: job.seed, w: job.mapW, h: job.mapH, grey, tx, ty }
      this.nirCache.set(job.slot, map)
    }
    for (let y = 0; y < job.mapH; y++) {
      for (let x = 0; x < job.mapW; x++) {
        const v = map.grey[y * job.mapW + x]
        const q = (y * W + x) * 4
        rgba[q] = v
        rgba[q + 1] = v
        rgba[q + 2] = v
        rgba[q + 3] = 255
      }
    }
    // the needle guide: a linear probe along the vein, the needle in the image plane
    let r = this.us.get(job.slot)
    if (!r) {
      r = new UsRenderer()
      this.us.set(job.slot, r)
    }
    const nd = Math.max(0, Math.min(1, job.needle)) * 1.04
    const needle = nd > 0 ? { ax: g.entry[0], ay: g.entry[1], az: g.entry[2], bx: g.entry[0] + (g.target[0] - g.entry[0]) * nd, by: g.entry[1] + (g.target[1] - g.entry[1]) * nd, bz: g.entry[2] + (g.target[2] - g.entry[2]) * nd } : undefined
    const out = r.render(b.ph, b.params, { frame: g.probe, depth: 22, focus: 9, t: job.time, n: job.n, preset: US_LINEAR, size: job.us, needle })
    for (let y = 0; y < job.us; y++) {
      for (let x = 0; x < job.us; x++) {
        const v = out.grey[y * job.us + x]
        const q = (y * W + job.mapW + x) * 4
        rgba[q] = v
        rgba[q + 1] = v
        rgba[q + 2] = v
        rgba[q + 3] = 255
      }
    }
    return { rgba, w: W, h: H, meta: { kidney: 0, liver: 0, gallbladder: 0, spleen: 0, bladder: 0, ms: now() - t0, vein: { tx: map.tx, ty: map.ty } } }
  }

  renderUs(job: UsJob): Rendered {
    const t0 = now()
    const b = this.body(job.seed, regionsFor('us', 'abdomen'))
    let r = this.us.get(job.slot)
    if (!r) {
      r = new UsRenderer()
      this.us.set(job.slot, r)
    }
    const preset = job.lite ? US_LITE : US_FULL
    const out = r.render(b.ph, b.params, { frame: job.frame, depth: job.depth, focus: job.depth * 0.55, t: job.time, n: job.n, preset, size: job.size })
    const n = job.size * job.size
    const rgba = new Uint8ClampedArray(n * 4)
    const g = out.grey
    for (let p = 0, q = 0; p < n; p++, q += 4) {
      const v = g[p]
      rgba[q] = v
      rgba[q + 1] = v
      rgba[q + 2] = v
      rgba[q + 3] = 255
    }
    const share = [0, 0, 0, 0, 0, 0]
    for (let i = 0; i < b.ph.nParts; i++) share[b.group[i]] += out.partShare[i]
    return { rgba, w: job.size, h: job.size, meta: { kidney: share[1], liver: share[2], gallbladder: share[3], spleen: share[4], bladder: share[5], ms: now() - t0 } }
  }
}

const VEIN_VIEW: V3 = [0, 1, 0]

export interface VeinGeometry {
  /** The map's centre on the arm, its x (toward the elbow) and y directions, its field (mm). */
  centre: V3
  w: number
  h: number
  /** The probe: its face on the skin, the beam and the array (along the vein), the needle's entry and its target (LPS mm). */
  probe: { ox: number; oy: number; oz: number; bx: number; by: number; bz: number; ax: number; ay: number; az: number; contact: number }
  entry: V3
  target: V3
}

/** Where the vein map looks and where the needle-guide probe sits on a forearm body, from its landmarks. */
export function veinGeometry(ph: Phantom, lm: Landmarks): VeinGeometry {
  const t = lm.veinTarget
  const fossa = lm.fossa
  const ax = lm.veinAxis
  // the probe's face: straight above the target on the skin of the palm side
  const up = skinExit(ph, t[0], t[1], t[2], 0, -1, 0, 60)
  const ox = t[0]
  const oy = t[1] - (Number.isFinite(up) ? up : 6)
  const oz = t[2]
  // the needle comes in at the probe's wrist end, about 30 degrees to the skin, in the image plane
  const entry: V3 = [ox - ax[0] * 17, oy - 0.5, oz - ax[2] * 17]
  return {
    centre: [fossa[0], fossa[1], t[2] - 34],
    w: 136,
    h: 87,
    probe: { ox, oy, oz, bx: 0, by: 1, bz: 0, ax: ax[0], ay: ax[1], az: ax[2], contact: 1 },
    entry,
    target: t,
  }
}

function pick<T>(m: Map<string, T>, key: string, make: () => T): T {
  let v = m.get(key)
  if (!v) {
    v = make()
    m.set(key, v)
  }
  return v
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
