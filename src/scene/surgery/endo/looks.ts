/**
 * R3 (endoscope): how each instrument is drawn. The content (src/content/endoscopeUi.json) maps an instrument's display name to a look id and its chip's short
 * label; this file says what a look is made of: its jaws (a sprite of sprites.ts, or none for the hook and the suction tip), its wrist (steel, black, or
 * none for the rigid suction), a tip cover (the monopolar scissors' translucent sleeve), what it holds (a needle with its suture, a clip), its energy (none,
 * bipolar or monopolar: the tip glint's colour and the pedal icon of its HUD chip), whether it grasps (and so tents the tissue when it closes), and its size.
 * Lengths are in frame units: the picture's half-height is 1.
 */
import { ENDOSCOPE_UI, LOOK_IDS, type LookId } from '@/content/endoscopeUi'

export const ENERGY = { none: 0, bipolar: 1, monopolar: 2 } as const
export type Energy = (typeof ENERGY)[keyof typeof ENERGY]

/** The jaw sprites (sprites.ts draws one per kind: the upper jaw, mirrored for the lower). */
export const JAW_KINDS = ['fenestrated', 'cadiere', 'prograsp', 'scissors', 'needle', 'clip', 'sealer'] as const
export type JawKind = (typeof JAW_KINDS)[number]

export interface Look {
  id: LookId
  index: number
  /** The jaw sprite's index in JAW_KINDS, or -1 (no jaws: a hook or a suction tip). */
  jaw: number
  /** A tip with no jaws. */
  tip: 'hook' | 'suction' | 'none'
  wrist: 'steel' | 'dark' | 'none'
  tipCover: boolean
  holds: 'needle' | 'clip' | 'none'
  energy: Energy
  /** It grips tissue, so the tissue tents toward it when the jaws close. */
  grasps: boolean
  /** The jaws' (or the tip's) length, and how far they open: the half angle at jaw = 1, radians. */
  jawLen: number
  open: number
  /** The chip's short label. */
  short: string
  /** Drawn at all (the endoscope is the camera: never in its own picture). */
  drawn: boolean
}

const jaw = (k: JawKind): number => JAW_KINDS.indexOf(k)

const BUILD: Record<LookId, Omit<Look, 'id' | 'index' | 'short' | 'drawn'>> = {
  endoscope: { jaw: -1, tip: 'none', wrist: 'none', tipCover: false, holds: 'none', energy: ENERGY.none, grasps: false, jawLen: 0, open: 0 },
  fenestratedBipolar: { jaw: jaw('fenestrated'), tip: 'none', wrist: 'dark', tipCover: false, holds: 'none', energy: ENERGY.bipolar, grasps: true, jawLen: 0.455, open: 0.42 },
  curvedScissors: { jaw: jaw('scissors'), tip: 'none', wrist: 'steel', tipCover: true, holds: 'none', energy: ENERGY.monopolar, grasps: false, jawLen: 0.42, open: 0.36 },
  prograsp: { jaw: jaw('prograsp'), tip: 'none', wrist: 'steel', tipCover: false, holds: 'none', energy: ENERGY.none, grasps: true, jawLen: 0.525, open: 0.45 },
  cadiere: { jaw: jaw('cadiere'), tip: 'none', wrist: 'steel', tipCover: false, holds: 'none', energy: ENERGY.none, grasps: true, jawLen: 0.56, open: 0.42 },
  needleDriver: { jaw: jaw('needle'), tip: 'none', wrist: 'steel', tipCover: false, holds: 'needle', energy: ENERGY.none, grasps: false, jawLen: 0.333, open: 0.3 },
  clipApplier: { jaw: jaw('clip'), tip: 'none', wrist: 'steel', tipCover: false, holds: 'clip', energy: ENERGY.none, grasps: false, jawLen: 0.42, open: 0.32 },
  hook: { jaw: -1, tip: 'hook', wrist: 'dark', tipCover: false, holds: 'none', energy: ENERGY.monopolar, grasps: false, jawLen: 0.455, open: 0 },
  suction: { jaw: -1, tip: 'suction', wrist: 'none', tipCover: false, holds: 'none', energy: ENERGY.none, grasps: false, jawLen: 0.525, open: 0 },
  vesselSealer: { jaw: jaw('sealer'), tip: 'none', wrist: 'dark', tipCover: false, holds: 'none', energy: ENERGY.bipolar, grasps: true, jawLen: 0.525, open: 0.34 },
}

/** The short label of a look: the first instrument name that maps to it. */
function shortFor(id: LookId): string {
  for (const m of Object.values(ENDOSCOPE_UI.instruments)) if (m.look === id) return m.short
  return id
}

/** Every look, indexed like LOOK_IDS. */
export const LOOKS: readonly Look[] = LOOK_IDS.map((id, index) => ({ id, index, ...BUILD[id], short: shortFor(id), drawn: id !== 'endoscope' }))

/** The look used for a name the content does not map (the content test keeps this from happening). */
export const FALLBACK_LOOK = LOOK_IDS.indexOf('cadiere')

const BY_NAME = new Map<string, number>(Object.entries(ENDOSCOPE_UI.instruments).map(([name, m]) => [name, LOOK_IDS.indexOf(m.look)]))

/** The look of an instrument's display name: -1 for none ('' or the camera), FALLBACK_LOOK for a name the content does not know. A map lookup: no allocation. */
export function lookIndexOf(instrument: string): number {
  if (instrument === '') return -1
  const i = BY_NAME.get(instrument)
  return i === undefined ? FALLBACK_LOOK : i
}
