/**
 * A `Look` is how one modality turns tissues into grey: an MRI weighting, a CT phase seen through a window, or a radiograph.
 * Pure data and one lookup table per look, so painting a slice never formats a colour or calls a closure per shape.
 */
import type { ScanContrast } from '@/sim/types'
import { CT_WINDOWS, ctPhase, ctTone, mriTone, mriWeighting, windowLabel, XRAY_TONE, type CtPhase, type CtWindow, type MriWeighting } from './tones'
import type { Tissue } from './shapes'

export const TISSUES: readonly Tissue[] = [
  'air', 'lung', 'scalp', 'fat', 'muscle', 'bone', 'marrow', 'gm', 'wm', 'csf', 'cord', 'disc', 'annulus', 'vessel', 'vein',
  'cartilage', 'meniscus', 'ligament', 'liver', 'spleen', 'kidney', 'bowel', 'heart', 'organ', 'cushion',
] as const

export interface Look {
  kind: 'mri' | 'ct' | 'xray'
  /** Grey level 0..1 per tissue, indexed by `TISSUES` order (see `toneOf`). */
  table: Float32Array
  /** Radiograph only: bone and marrow add to what is already there (overlapping bones get brighter). */
  additive: boolean
  /** The grey of the empty frame. */
  background: number
  /** Short label for the image corner: "T2", "W:80 L:40", "AP". */
  label: string
  /** Noise strength 0..1 (MRI grain and floor, CT grain, radiograph mottle). */
  noise: number
}

const INDEX = new Map<Tissue, number>(TISSUES.map((t, i) => [t, i]))
export const tissueIndex = (t: Tissue): number => INDEX.get(t) ?? 0
export const toneOf = (look: Look, t: Tissue): number => look.table[tissueIndex(t)]

function table(f: (t: Tissue) => number): Float32Array {
  return Float32Array.from(TISSUES, f)
}

const cache = new Map<string, Look>()
function memo(key: string, make: () => Look): Look {
  let l = cache.get(key)
  if (!l) {
    l = make()
    cache.set(key, l)
  }
  return l
}

const MRI_LABEL: Record<MriWeighting, string> = { T1: 'T1', T2: 'T2', FLAIR: 'FLAIR', DWI: 'DWI b1000', PD: 'PD FS', STIR: 'STIR' }

export function mriLook(c: ScanContrast): Look {
  const w = mriWeighting(c)
  return memo(`mri:${w}`, () => ({ kind: 'mri', table: table((t) => mriTone(w, t)), additive: false, background: 0, label: MRI_LABEL[w], noise: 0.5 }))
}

export function ctLook(c: ScanContrast, window: CtWindow): Look {
  const phase: CtPhase = ctPhase(c)
  return memo(`ct:${phase}:${window.width}:${window.level}`, () => ({ kind: 'ct', table: table((t) => ctTone(t, phase, window)), additive: false, background: 0, label: windowLabel(window), noise: 0.4 }))
}

export function xrayLook(): Look {
  return memo('xray', () => ({ kind: 'xray', table: table((t) => XRAY_TONE[t]), additive: true, background: 0.02, label: '', noise: 0.35 }))
}

export { CT_WINDOWS }
