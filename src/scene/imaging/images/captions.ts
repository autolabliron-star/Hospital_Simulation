/**
 * The words that go with a scanner's state: the viewer's header (`scanCaption`) and the lines drawn on the live picture. Pure, so they are
 * tested in node. The plain-words phase names match the Scan viewer's own (`src/ui/scanPhase.ts`), kept here so this module does not
 * import the UI.
 */
import type { ImagingModality, ScannerPhase, ScannerState } from '@/sim/types'
import { paramsLine, sliceAt } from './scan'

export const MODALITY_LABEL: Record<ImagingModality, string> = { mri: 'MRI', ct: 'CT', xray: 'X-ray', us: 'Ultrasound' }

export function phaseWords(phase: ScannerPhase, modality: ImagingModality): string {
  switch (phase) {
    case 'idle':
      return 'Ready for the next patient'
    case 'prep':
      return modality === 'mri' ? 'Changing and safety check' : 'Safety check and explaining the scan'
    case 'positioning':
      return 'Positioning the patient'
    case 'tableIn':
      return modality === 'mri' || modality === 'ct' ? 'Table moving in' : 'Getting into position'
    case 'scanning':
      return 'Scanning'
    case 'tableOut':
      return modality === 'mri' || modality === 'ct' ? 'Table moving out' : 'Scan finished'
    case 'cleanup':
      return 'Cleaning the room'
  }
}

/** The title and one line under it for the Scan viewer's header. */
export function captionOf(state: Pick<ScannerState, 'modality' | 'phase' | 'exam' | 'sequence' | 'progress'>): { title: string; line: string } {
  const label = MODALITY_LABEL[state.modality]
  const exam = state.exam
  if (!exam) return { title: `${label} scanner`, line: phaseWords('idle', state.modality) }
  const seqIndex = Math.max(0, Math.min(exam.sequences.length - 1, state.sequence))
  const seq = exam.sequences[seqIndex]
  if (state.phase === 'scanning' && state.sequence >= 0 && seq) {
    const { index } = sliceAt(seq.images, state.progress)
    const count = seq.images > 1 ? `image ${index + 1} of ${seq.images}` : 'single image'
    return { title: exam.protocol, line: `${seq.name} · ${count} · ${paramsLine(exam.modality, seq, exam.bodyPart)}` }
  }
  return { title: exam.protocol, line: phaseWords(state.phase, state.modality) }
}
