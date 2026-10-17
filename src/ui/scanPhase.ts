/**
 * Plain-words helpers for the Scan viewer: what the scanner is doing, how far along the exam is, how long is left.
 * Pure (no React, no sim singleton) so they are unit-tested in node.
 */
import type { ImagingExam, ImagingModality, ScannerPhase, ScannerState } from '@/sim/types'

export const SCANNER_PHASES: readonly ScannerPhase[] = ['idle', 'prep', 'positioning', 'tableIn', 'scanning', 'tableOut', 'cleanup'] as const

export const MODALITY_NAME: Record<ImagingModality, string> = {
  mri: 'MRI',
  ct: 'CT',
  xray: 'X-ray',
  us: 'Ultrasound',
}

/** The exam step names a viewer needs, kept apart from the full exam so the sim's objects are not captured. */
export interface PhaseContext {
  modality: ImagingModality
  /** Name of the current step ("T2 sagittal"), or null before the first. */
  stepName: string | null
}

/**
 * The phase in words a visitor understands. Only MRI has the changing-room routine; the table moves for MRI and CT only
 * (the sim passes straight through `tableIn` and `tableOut` for X-ray and ultrasound).
 */
export function phaseText(phase: ScannerPhase, ctx: PhaseContext): string {
  switch (phase) {
    case 'idle':
      return 'Ready'
    case 'prep':
      return ctx.modality === 'mri' ? 'Changing and safety check' : 'Safety check and explaining the scan'
    case 'positioning':
      return 'Positioning'
    case 'tableIn':
      return ctx.modality === 'mri' || ctx.modality === 'ct' ? 'Table moving in' : 'Getting into position'
    case 'scanning':
      return ctx.stepName ? `Scanning: ${ctx.stepName}` : 'Scanning'
    case 'tableOut':
      return ctx.modality === 'mri' || ctx.modality === 'ct' ? 'Table moving out' : 'Scan finished'
    case 'cleanup':
      return 'Cleaning the room'
    default: {
      const never: never = phase
      return never
    }
  }
}

export function sourceLabel(source: ImagingExam['source']): string {
  switch (source) {
    case 'er':
      return 'Emergency patient'
    case 'outpatient':
      return 'Outpatient'
    case 'demo':
      return 'Demo patient'
  }
}

/** "6 min 20 s", "45 s", "under 5 s". Sim time, rounded for reading. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 s'
  if (seconds < 5) return 'under 5 s'
  const s = Math.round(seconds)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m >= 10) return `${m + (rest >= 30 ? 1 : 0)} min`
  return rest === 0 ? `${m} min` : `${m} min ${rest} s`
}

/** The step the viewer shows as "i / n": 0 before the first step, n once the table is coming out. */
export function currentStep(state: Pick<ScannerState, 'phase' | 'sequence'>, total: number): number {
  if (total <= 0) return 0
  if (state.phase === 'tableOut' || state.phase === 'cleanup') return total
  if (state.phase !== 'scanning') return Math.max(0, Math.min(total, state.sequence + 1))
  return Math.max(1, Math.min(total, state.sequence + 1))
}

/**
 * Indices of the steps whose images are finished: earlier steps, the current one once its progress reaches 100 %,
 * and every step from the moment the table starts coming out.
 */
export function completedSteps(state: Pick<ScannerState, 'phase' | 'sequence' | 'progress'>, total: number): number[] {
  if (total <= 0 || state.phase === 'idle') return []
  const upTo = state.phase === 'tableOut' || state.phase === 'cleanup' ? total : state.sequence + (state.phase === 'scanning' && state.progress >= 0.999 ? 1 : 0)
  const out: number[] = []
  for (let i = 0; i < Math.min(total, upTo); i++) out.push(i)
  return out
}

/** Progress of the current step as 0..100 (the bar). */
export function stepPercent(state: Pick<ScannerState, 'phase' | 'progress'>): number {
  if (state.phase === 'tableOut' || state.phase === 'cleanup') return 100
  if (state.phase !== 'scanning') return 0
  return Math.max(0, Math.min(100, Math.round(state.progress * 100)))
}
