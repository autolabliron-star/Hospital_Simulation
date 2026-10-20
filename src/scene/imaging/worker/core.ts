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
import { sliceSpec, specKnown } from '../render/spec'
import { US_FULL, US_LITE, UsRenderer } from '../render/us'
import { XrayRenderer } from '../render/xray'
import type { FrameMeta, Job, SliceJob, UsJob } from './protocol'

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
    return job.t === 'us' ? this.renderUs(job) : this.renderSlice(job)
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
    meta.ms = now() - t0
    return { rgba, w: job.size, h: job.size, meta }
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
