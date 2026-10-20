/**
 * R3 "Real screens": which regions an exam's synthetic body is built from, and the builders. A region that is not built yet is missing from
 * BUILDERS; `regionsReady` then says no and the screen keeps the R1 vector picture for that exam.
 */
import type { BodyPart, ImagingModality } from '@/sim/types'
import type { BodyBuilder } from '../body'
import type { PatientParams } from '../params'
import { buildAbdomen, VERTEBRAE } from './abdomen'
import type { Landmarks, RegionId } from './types'

export type RegionBuilder = (b: BodyBuilder, p: PatientParams, regions: readonly RegionId[]) => Landmarks

const abdomen: RegionBuilder = (b, p, regions) => {
  buildAbdomen(b, p, { lungs: !regions.includes('thorax') })
  const out: Landmarks = { kidneyR: p.kidneyR.c, kidneyL: p.kidneyL.c }
  for (const [name, s, pp] of VERTEBRAE) out[`vert${name}`] = [0, pp * p.depth, s * p.height]
  return out
}

/** The builders that exist (the others arrive with their region). */
export const BUILDERS: Partial<Record<RegionId, RegionBuilder>> = { abdomen }

/** The regions an exam needs, in build order. */
export function regionsFor(modality: ImagingModality, bodyPart: BodyPart): RegionId[] {
  switch (bodyPart) {
    case 'brain':
    case 'head':
    case 'cervicalSpine':
    case 'neck':
      return ['head']
    case 'chest':
      return modality === 'ct' ? ['thorax', 'abdomen'] : ['thorax', 'abdomen']
    case 'knee':
      return ['knee']
    case 'ankle':
      return ['ankle']
    case 'wrist':
      return ['wrist']
    case 'lumbarSpine':
    case 'abdomen':
    case 'pelvis':
    case 'kidneys':
      return BUILDERS.thorax ? ['abdomen', 'thorax'] : ['abdomen']
  }
}

/** Can the synthetic body be built for these regions yet? */
export function regionsReady(regions: readonly RegionId[]): boolean {
  return regions.every((r) => BUILDERS[r] !== undefined)
}

/** Build the regions into one body; the landmarks of all of them, merged. */
export function buildRegions(b: BodyBuilder, p: PatientParams, regions: readonly RegionId[]): Landmarks {
  const out: Landmarks = {}
  for (const r of regions) Object.assign(out, BUILDERS[r]!(b, p, regions))
  return out
}
