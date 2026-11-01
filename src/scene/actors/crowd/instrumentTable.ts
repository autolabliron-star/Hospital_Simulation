/**
 * R5: what each `ToolKind` the sim puts in a hand looks like and how it is held: the instruments mesh's kind (crowd/instruments.ts builds one shape per
 * kind), the grip, where the grip point sits in the hand, which part moves, the most triangles its shape may have, and whether its tip is aimed at the
 * point the hands work at. Tools that are not modelled (a gown, a drape sheet, a gel pad, ECG leads, the catheter and the uterine manipulator, the
 * ultrasound transducer the ultrasound machine already draws with its hand) are null: they show by their effect. The tablet and the count board are the
 * crowd's existing tablet (the props mesh, PROP.tablet).
 *
 * THE HAND FRAME (rig.ts): origin at the wrist, -Y to the fingertips, +Z the thumb side, the palm at -side x (side +1 the left hand: the palm of the left
 * hand faces -x, of the right +x; measured on every avatar's hand mesh, whose middle sits 2 cm towards the palm). An instrument's GRIP POINT is the middle
 * of the hand (BODY.hand down -Y) moved 2 cm towards the palm, plus the grip's offset below (x towards the palm, y along the fingers' line, z towards the
 * thumb). Its TIP AXIS is the instrument's -Y: the grip's own direction in the hand (GRIP_AXIS), or, when the action aims and the tool aims, the line from
 * the grip point to the hand's tip point (surgicalPoses.ts). The instrument frame is always right handed (built by cross products, never mirrored: the left
 * hand's instrument is the right hand's turned half a turn about its long axis), so the props material's front faces stay front faces.
 */
import type { ToolKind } from '@/sim/types'
import { INSTRUMENT_FIRST } from './constants'

/** The instruments mesh's kinds, in the order instruments.ts builds them. */
export const INSTRUMENT_NAMES = [
  'scalpel',
  'forceps',
  'needleHolder',
  'scissors',
  'prepStick',
  'marker',
  'veressNeedle',
  'trocar8',
  'trocar12',
  'laparoscope',
  'lapGrasper',
  'lapSuction',
  'lapClipApplier',
  'syringe',
  'laryngoscope',
  'breathingTube',
  'bagValveMask',
  'oxygenMask',
  'cryoNeedle',
  'retrievalBag',
  'gauze',
  'dressing',
  'skinGlue',
  'scrubBrush',
  'tableRemote',
  'robotInstrument',
  'specimenPot',
  'iceBag',
] as const
export type InstrumentName = (typeof INSTRUMENT_NAMES)[number]
/** Kind numbers (the props shader's `aPart.x` of the shape, `aKind` of an instance before the hand is packed in). */
export const INSTRUMENT: Readonly<Record<InstrumentName, number>> = Object.freeze(Object.fromEntries(INSTRUMENT_NAMES.map((n, i) => [n, INSTRUMENT_FIRST + i])) as Record<InstrumentName, number>)
export const INSTRUMENT_COUNT = INSTRUMENT_NAMES.length
export const INSTRUMENT_LAST = INSTRUMENT_FIRST + INSTRUMENT_COUNT - 1

/**
 * How a tool sits in the (rigid, fingerless) hand:
 *   pencil  between the thumb and the fingers, the tip past the fingertips (scalpel, marker, forceps, a syringe, a needle, the Veress needle)
 *   ring    in the fingers along the hand, the tip past the fingertips (needle holder, scissors, the sponge stick, the laryngoscope's handle)
 *   power   across the fist, the business end out of the thumb side (a robot instrument's housing)
 *   pistol  a laparoscopic handle in the fist, the shaft forward along the forearm out of the top of the hand
 *   cradle  in or under the palm (a trocar's cap: the palm on top; gauze, a dressing, a remote, a brush, a pot)
 *   mask    under the palm, its opening facing away from it (oxygen mask, bag-valve mask: a C-grip)
 */
export type Grip = 'pencil' | 'ring' | 'power' | 'pistol' | 'cradle' | 'mask'
/** The moving part of a shape (instruments.ts marks its vertices; the props shader moves them by the instance's 0..1 parameter). */
export type Moving = 'none' | 'slide' | 'squeeze' | 'spread'
/** The vertex tag of each moving part, added to the kind in `aPart.x` (shaders.ts GEAR_VERT). */
export const MOVING_TAG: Readonly<Record<Moving, number>> = { none: 0, slide: 0.2, squeeze: 0.3, spread: 0.4 }
/** How far a slide moves (metres along -Y at parameter 1: a syringe's plunger pressed home). */
export const SLIDE_TRAVEL = 0.05

export interface ToolSpec {
  name: InstrumentName
  kind: number
  grip: Grip
  /** The grip point from the palm-side middle of the hand: x towards the palm, y along +Y of the hand (towards the wrist), z towards the thumb (metres). */
  offset: readonly [number, number, number]
  moving: Moving
  /** The most triangles its shape may have (instruments.test.ts). */
  maxTris: number
  /** Its tip is pointed at the hand's tip point when the action aims (surgicalPoses.ts ActionDef.aim). */
  aim: boolean
  /** Metres from the grip point to the tip along -Y (the reach the poses leave for it). */
  tip: number
}

/** The tip axis of each grip in the hand frame (unit; x towards the palm, mirrored by the rig for the left hand). */
export const GRIP_AXIS: Readonly<Record<Grip, readonly [number, number, number]>> = {
  pencil: [0.1, -0.86, 0.5],
  ring: [0.05, -0.95, 0.3],
  power: [0, -0.3, 0.954],
  pistol: [0, -0.94, 0.34],
  cradle: [1, 0, 0],
  mask: [1, 0, 0],
}

/** The grip point's offset per grip (hand frame, as ToolSpec.offset), before a tool's own. */
export const GRIP_OFFSET: Readonly<Record<Grip, readonly [number, number, number]>> = {
  pencil: [0.012, -0.03, 0.028],
  ring: [0.01, -0.01, 0.02],
  power: [0.012, 0, 0],
  pistol: [0.01, 0.005, 0.03],
  cradle: [0.028, 0, 0],
  mask: [0.034, 0, 0],
}

const spec = (name: InstrumentName, grip: Grip, maxTris: number, tip: number, o: { moving?: Moving; aim?: boolean; offset?: readonly [number, number, number] } = {}): ToolSpec => ({
  name,
  kind: INSTRUMENT[name],
  grip,
  offset: o.offset ?? GRIP_OFFSET[grip],
  moving: o.moving ?? 'none',
  maxTris,
  aim: o.aim ?? true,
  tip,
})

/** Every modelled instrument, by name. */
export const INSTRUMENTS: Readonly<Record<InstrumentName, ToolSpec>> = Object.freeze({
  scalpel: spec('scalpel', 'pencil', 60, 0.07),
  forceps: spec('forceps', 'pencil', 70, 0.07, { moving: 'squeeze' }),
  needleHolder: spec('needleHolder', 'ring', 140, 0.12),
  scissors: spec('scissors', 'ring', 120, 0.11, { moving: 'spread' }),
  prepStick: spec('prepStick', 'ring', 120, 0.21),
  marker: spec('marker', 'pencil', 40, 0.06),
  veressNeedle: spec('veressNeedle', 'pencil', 60, 0.14),
  trocar8: spec('trocar8', 'cradle', 120, 0.13),
  trocar12: spec('trocar12', 'cradle', 140, 0.15),
  laparoscope: spec('laparoscope', 'pistol', 150, 0.36),
  lapGrasper: spec('lapGrasper', 'pistol', 110, 0.33, { moving: 'squeeze' }),
  lapSuction: spec('lapSuction', 'pistol', 110, 0.33),
  lapClipApplier: spec('lapClipApplier', 'pistol', 120, 0.33, { moving: 'squeeze' }),
  syringe: spec('syringe', 'pencil', 120, 0.08, { moving: 'slide' }),
  laryngoscope: spec('laryngoscope', 'ring', 120, 0.12),
  breathingTube: spec('breathingTube', 'pencil', 100, 0.14),
  bagValveMask: spec('bagValveMask', 'mask', 300, 0.02, { moving: 'squeeze' }),
  oxygenMask: spec('oxygenMask', 'mask', 120, 0.02),
  cryoNeedle: spec('cryoNeedle', 'pencil', 80, 0.17),
  retrievalBag: spec('retrievalBag', 'pistol', 90, 0.25),
  gauze: spec('gauze', 'cradle', 12, 0.01),
  dressing: spec('dressing', 'cradle', 12, 0.01),
  skinGlue: spec('skinGlue', 'pencil', 40, 0.06),
  scrubBrush: spec('scrubBrush', 'cradle', 30, 0.02, { aim: false }),
  tableRemote: spec('tableRemote', 'cradle', 30, 0.02, { aim: false }),
  robotInstrument: spec('robotInstrument', 'power', 60, 0.4, { aim: false }),
  specimenPot: spec('specimenPot', 'cradle', 40, 0.03, { aim: false }),
  iceBag: spec('iceBag', 'cradle', 30, 0.02),
})

/** The most triangles the whole instruments mesh may have (every instance submits all of them). */
export const INSTRUMENTS_MAX_TRIS = 3000

/** What the props mesh holds for a tool that is the crowd's existing tablet. */
export const TABLET_TOOLS: readonly ToolKind[] = ['tablet', 'countBoard']

/** ToolKind -> the instrument that draws it (null: not modelled, shown by its effect, or the tablet). */
export const TOOL_TABLE: Readonly<Record<ToolKind, ToolSpec | null>> = Object.freeze({
  none: null,
  tablet: null,
  syringe: INSTRUMENTS.syringe,
  oxygenMask: INSTRUMENTS.oxygenMask,
  bagValveMask: INSTRUMENTS.bagValveMask,
  laryngoscope: INSTRUMENTS.laryngoscope,
  breathingTube: INSTRUMENTS.breathingTube,
  ecgLeads: null,
  gelPad: null,
  tableRemote: INSTRUMENTS.tableRemote,
  scrubBrush: INSTRUMENTS.scrubBrush,
  gown: null,
  prepStick: INSTRUMENTS.prepStick,
  drapeSheet: null,
  marker: INSTRUMENTS.marker,
  scalpel: INSTRUMENTS.scalpel,
  veressNeedle: INSTRUMENTS.veressNeedle,
  trocar8: INSTRUMENTS.trocar8,
  trocar12: INSTRUMENTS.trocar12,
  laparoscope: INSTRUMENTS.laparoscope,
  gasLine: null,
  catheter: null,
  manipulator: null,
  robotInstrument: INSTRUMENTS.robotInstrument,
  lapSuction: INSTRUMENTS.lapSuction,
  lapGrasper: INSTRUMENTS.lapGrasper,
  lapClipApplier: INSTRUMENTS.lapClipApplier,
  retrievalBag: INSTRUMENTS.retrievalBag,
  specimenPot: INSTRUMENTS.specimenPot,
  needleHolder: INSTRUMENTS.needleHolder,
  forceps: INSTRUMENTS.forceps,
  scissors: INSTRUMENTS.scissors,
  skinGlue: INSTRUMENTS.skinGlue,
  dressing: INSTRUMENTS.dressing,
  countBoard: null,
  gauze: INSTRUMENTS.gauze,
  cryoNeedle: INSTRUMENTS.cryoNeedle,
  cryoProbe: INSTRUMENTS.cryoNeedle,
  usTransducer: null,
  salineSyringe: INSTRUMENTS.syringe,
  warmGauze: INSTRUMENTS.gauze,
  iceBag: INSTRUMENTS.iceBag,
  ctRemote: INSTRUMENTS.tableRemote,
  mouse: null,
})

/** Specs by kind number (index kind - INSTRUMENT_FIRST), for the rig. */
export const SPEC_BY_KIND: readonly ToolSpec[] = INSTRUMENT_NAMES.map((n) => INSTRUMENTS[n])

/** The spec of an instrument kind, or null for anything else. */
export function specOfKind(kind: number): ToolSpec | null {
  const i = kind - INSTRUMENT_FIRST
  return i >= 0 && i < SPEC_BY_KIND.length ? SPEC_BY_KIND[i] : null
}

/** The instrument kind a tool is drawn with (0: none). */
export function instrumentKindOf(tool: ToolKind | undefined | null): number {
  if (!tool) return 0
  const s = TOOL_TABLE[tool]
  return s ? s.kind : 0
}
