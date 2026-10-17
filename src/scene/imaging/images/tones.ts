/**
 * How bright each tissue is. One anatomy, three looks:
 *   MRI          a grey level per tissue and weighting (T1 / T2 / FLAIR / DWI / PD fat-sat / STIR), by the rules a radiologist
 *                knows: fluid is dark on T1 and bright on T2, FLAIR keeps white matter but nulls the fluid, fat-sat drops fat.
 *   CT           Hounsfield units per tissue and contrast phase, then a window (W, L) maps them to grey.
 *   radiograph   how much a tissue stops X-rays (a density that adds up where tissues overlap).
 * All tables are plain numbers so they can be tested.
 */
import type { ScanContrast } from '@/sim/types'
import type { Tissue } from './shapes'

export type MriWeighting = 'T1' | 'T2' | 'FLAIR' | 'DWI' | 'PD' | 'STIR'

/** Map the protocol's contrast to a weighting (the localiser and unknowns look T1-like). */
export function mriWeighting(c: ScanContrast): MriWeighting {
  switch (c) {
    case 'T2':
    case 'FLAIR':
    case 'DWI':
    case 'PD':
    case 'STIR':
    case 'T1':
      return c
    default:
      return 'T1'
  }
}

type Row = Record<Tissue, number>

const base = (o: Partial<Row>): Row => ({
  air: 0,
  lung: 0.02,
  scalp: 0.5,
  fat: 0.5,
  muscle: 0.4,
  bone: 0.06,
  marrow: 0.4,
  gm: 0.5,
  wm: 0.5,
  csf: 0.5,
  cord: 0.5,
  disc: 0.5,
  annulus: 0.4,
  vessel: 0.1,
  vein: 0.1,
  cartilage: 0.5,
  meniscus: 0.1,
  ligament: 0.15,
  liver: 0.45,
  spleen: 0.45,
  kidney: 0.45,
  bowel: 0.4,
  heart: 0.4,
  organ: 0.45,
  cushion: 0.3,
  ...o,
})

/** Grey level (0..1) of a tissue for an MRI weighting. */
export const MRI_TONE: Record<MriWeighting, Row> = {
  T1: base({ scalp: 0.92, fat: 0.95, muscle: 0.46, marrow: 0.82, gm: 0.5, wm: 0.72, csf: 0.1, cord: 0.58, disc: 0.45, annulus: 0.36, vessel: 0.06, vein: 0.06, cartilage: 0.55, meniscus: 0.1, ligament: 0.14, liver: 0.55, spleen: 0.42, kidney: 0.5, bowel: 0.45, heart: 0.5, organ: 0.52 }),
  T2: base({ scalp: 0.7, fat: 0.78, muscle: 0.32, marrow: 0.55, gm: 0.58, wm: 0.36, csf: 0.98, cord: 0.52, disc: 0.94, annulus: 0.4, vessel: 0.05, vein: 0.06, cartilage: 0.6, meniscus: 0.08, ligament: 0.12, liver: 0.3, spleen: 0.6, kidney: 0.62, bowel: 0.5, heart: 0.4, organ: 0.5 }),
  FLAIR: base({ scalp: 0.62, fat: 0.7, muscle: 0.3, marrow: 0.5, gm: 0.62, wm: 0.42, csf: 0.05, cord: 0.5, disc: 0.8, annulus: 0.4, vessel: 0.05, vein: 0.06, cartilage: 0.55, meniscus: 0.08, ligament: 0.12, liver: 0.3, spleen: 0.5, kidney: 0.5, bowel: 0.4, heart: 0.4, organ: 0.45 }),
  DWI: base({ scalp: 0.3, fat: 0.25, muscle: 0.3, marrow: 0.3, gm: 0.55, wm: 0.42, csf: 0.09, cord: 0.4, disc: 0.4, annulus: 0.3, vessel: 0.05, vein: 0.06, cartilage: 0.4, meniscus: 0.1, ligament: 0.1, liver: 0.35, spleen: 0.5, kidney: 0.5, bowel: 0.3, heart: 0.3, organ: 0.4 }),
  PD: base({ scalp: 0.18, fat: 0.14, muscle: 0.42, marrow: 0.28, gm: 0.55, wm: 0.45, csf: 0.88, cord: 0.55, disc: 0.7, annulus: 0.35, vessel: 0.06, vein: 0.06, cartilage: 0.74, meniscus: 0.1, ligament: 0.13, liver: 0.45, spleen: 0.5, kidney: 0.55, bowel: 0.45, heart: 0.45, organ: 0.5 }),
  STIR: base({ scalp: 0.1, fat: 0.1, muscle: 0.3, marrow: 0.25, gm: 0.55, wm: 0.4, csf: 0.95, cord: 0.5, disc: 0.85, annulus: 0.35, vessel: 0.05, vein: 0.06, cartilage: 0.6, meniscus: 0.08, ligament: 0.12, liver: 0.3, spleen: 0.55, kidney: 0.55, bowel: 0.45, heart: 0.4, organ: 0.45 }),
}

export const mriTone = (w: MriWeighting, t: Tissue): number => MRI_TONE[w][t]

// ---------------------------------------------------------------------------------------------
// CT
// ---------------------------------------------------------------------------------------------

export type CtPhase = 'plain' | 'arterial' | 'portal'

export function ctPhase(c: ScanContrast): CtPhase {
  return c === 'arterial' || c === 'portal' ? c : 'plain'
}

const HU_BASE: Row = {
  air: -1000,
  lung: -850,
  scalp: 40,
  fat: -100,
  muscle: 55,
  bone: 1100,
  marrow: 320,
  gm: 38,
  wm: 28,
  csf: 8,
  cord: 32,
  disc: 80,
  annulus: 80,
  vessel: 45,
  vein: 42,
  cartilage: 60,
  meniscus: 60,
  ligament: 60,
  liver: 58,
  spleen: 48,
  kidney: 32,
  bowel: 38,
  heart: 45,
  organ: 50,
  cushion: 90,
}

/** Hounsfield units of a tissue in a contrast phase. */
export function hu(t: Tissue, phase: CtPhase): number {
  if (phase === 'plain') return HU_BASE[t]
  if (phase === 'arterial') {
    switch (t) {
      case 'vessel':
        return 320 // aorta and arteries bright
      case 'vein':
        return 95 // veins are still filling
      case 'liver':
        return 68
      case 'spleen':
        return 105
      case 'kidney':
        return 185
      case 'heart':
        return 190
      case 'organ':
        return 85
      case 'bowel':
        return 60
      case 'gm':
        return 40
      default:
        return HU_BASE[t]
    }
  }
  switch (t) {
    case 'vessel':
      return 175
    case 'vein':
      return 180
    case 'liver':
      return 112
    case 'spleen':
      return 122
    case 'kidney':
      return 160
    case 'heart':
      return 150
    case 'organ':
      return 95
    case 'bowel':
      return 75
    case 'muscle':
      return 62
    default:
      return HU_BASE[t]
  }
}

export interface CtWindow {
  width: number
  level: number
}

/** Grey level (0..1) of an HU value through a window. */
export function windowed(huValue: number, w: CtWindow): number {
  const lo = w.level - w.width / 2
  const v = (huValue - lo) / w.width
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export const CT_WINDOWS = {
  brain: { width: 80, level: 40 },
  lung: { width: 1500, level: -600 },
  abdomen: { width: 350, level: 50 },
  neck: { width: 400, level: 40 },
} as const satisfies Record<string, CtWindow>

export const windowLabel = (w: CtWindow): string => `W:${w.width} L:${w.level}`

export const ctTone = (t: Tissue, phase: CtPhase, w: CtWindow): number => windowed(hu(t, phase), w)

// ---------------------------------------------------------------------------------------------
// radiograph
// ---------------------------------------------------------------------------------------------

/**
 * Density a tissue adds to the film. Bone-like tissues are blended additively (so overlapping bones get brighter);
 * the rest are painted over each other like layers of soft tissue.
 */
export const XRAY_TONE: Row = base({
  air: 0.0,
  lung: 0.07,
  scalp: 0.2,
  fat: 0.17,
  muscle: 0.24,
  bone: 0.58,
  marrow: 0.34,
  gm: 0.24,
  wm: 0.24,
  csf: 0.22,
  cord: 0.24,
  disc: 0.25,
  annulus: 0.25,
  vessel: 0.28,
  vein: 0.28,
  cartilage: 0.1,
  meniscus: 0.2,
  ligament: 0.22,
  liver: 0.27,
  spleen: 0.27,
  kidney: 0.27,
  bowel: 0.2,
  heart: 0.3,
  organ: 0.25,
  cushion: 0.0,
})

const ADDITIVE: ReadonlySet<Tissue> = new Set<Tissue>(['bone', 'marrow'])
export const isAdditive = (t: Tissue): boolean => ADDITIVE.has(t)
