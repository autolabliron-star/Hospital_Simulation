// Ported from Waltz City (src/scene/actors/crowd/constants.ts); the part table, colour slots and texture layout are rewritten for the hospital.
/**
 * Shared constants of the crowd renderer: the nominal body, the part and colour-slot tables and the
 * layout of the pose texture that carries every person's skeleton to the GPU.
 *
 * HEAD HEIGHTS (for anything placed over a head). Everything is metres above the ground (standing) or above
 * the seat surface (seated), for a person of nominal size; a real person is scaled by `look.scale` (0.94 to
 * 1.06), use `headPosition()` in head.ts to get the exact point.
 *
 *   standing   head centre 1.63    crown (top of the head) 1.745
 *   seated     head centre 0.82    crown 0.94      (above the seat surface)
 */
import { MATTRESS, TROLLEY } from '@/scene/rooms/bedParts'
import { SURGERY, VEHICLE_AHEAD as VEHICLE_AHEAD_BY_KIND } from '@/sim/places'

/** Nominal body, metres. A relaxed standing adult is 1.745 m to the crown. */
export const BODY = {
  /** Ankle joint above the floor (sole to ankle centre). */
  ankle: 0.075,
  shin: 0.4,
  thigh: 0.42,
  /** Hip joint lateral offset from the pelvis centre, and how far below the pelvis centre it sits. */
  hipHalf: 0.092,
  hipDrop: 0.05,
  /** Pelvis centre to the waist (spine) joint. */
  waist: 0.1,
  /** Waist joint to the neck base (where the head joint is). */
  neck: 0.42,
  shoulderHalf: 0.19,
  /** Waist joint to the shoulder joints. */
  shoulderUp: 0.365,
  upperArm: 0.29,
  forearm: 0.25,
  /** Wrist to the middle of the hand. */
  hand: 0.085,
  /** Neck base to the head centre, and to the crown. */
  headCentre: 0.18,
  crown: 0.295,
  /** Seated: pelvis centre above the seat surface. */
  seatedPelvis: 0.125,
} as const

/** Leg length when fully straight, and how straight a relaxed stance keeps it. */
export const LEG_LENGTH = BODY.thigh + BODY.shin
export const LEG_RELAXED = 0.985
export const LEG_MAX = 0.995

/** Pelvis centre height of a relaxed standing person. */
export const STAND_PELVIS = BODY.ankle + LEG_LENGTH * LEG_RELAXED + BODY.hipDrop

/** Head heights at nominal size (see the header). */
export const STAND_HEAD_CENTRE = STAND_PELVIS + BODY.waist + BODY.neck + BODY.headCentre
export const STAND_CROWN = STAND_PELVIS + BODY.waist + BODY.neck + BODY.crown
export const SEATED_HEAD_CENTRE = BODY.seatedPelvis + BODY.waist + BODY.neck + BODY.headCentre
export const SEATED_CROWN = BODY.seatedPelvis + BODY.waist + BODY.neck + BODY.crown

/** Seat surface height assumed when a seated entity does not say (a plain chair), and the lowest seat we draw. */
export const DEFAULT_SEAT_HEIGHT = 0.45
export const MIN_SEAT_HEIGHT = 0.45
/**
 * Lying: the "surface height" of a bed, trolley or stretcher is the top of its mattress. The sim does not say it (an entity's `position.y` is the floor), so
 * the crowd looks it up from where the person lies (head.ts `levelsOf`): a ward bed (`bed:*`, bedParts.ts MATTRESS.top 0.49), an ER bay trolley (`erBay:*`,
 * TROLLEY.top 0.44) and a stretcher with a rider (`stretcher`, gear.ts builds its mattress to this top). A lying person rests IN the mattress: the procedural
 * body's pelvis centre rides `LIE.pelvisAbove` above it (its back sinks about 7 cm into the linen: pelvis half thickness 0.095 minus the sink), a realistic
 * avatar's rides its own `BodyDims.liePelvis` (back sunk 2 to 3 cm). The imaging tables are looked up at their own heights (places.ts IMAGING; their patients
 * are not covered by a blanket). `bed` is also the default for a lying entity that says nothing about where, `wheelchairSeat` the seat of a wheelchair rider.
 * R2 (level 2): the pre-op and recovery trolleys (`surgeryBed:*`, mattress top 0.8 m, rooms/surgery/shell.ts BED_TOP: a test pins the two together) are covered
 * like a ward bed; the OR table (`orTable:*`, top 0.88 m, places.ts SURGERY.table.height) is bare: the surgical drape over the patient is the OR's (agent O).
 */
export const LIE = { pelvisAbove: 0.025, bed: MATTRESS.top, trolley: TROLLEY.top, stretcher: 0.79, wheelchairSeat: 0.5, surgeryBed: 0.8, orTable: SURGERY.table.height } as const

/**
 * Lying: how straight the legs are (the chord between hip and ankle over the leg length). A standing person's are LEG_RELAXED; lying they bend a little
 * more, but not so much that the knees stand a hand's breadth above the thighs (the blanket over the bed would have to be a tent).
 */
export const LIE_LEG = 0.995

/**
 * A patient in a ward bed with the head raised: the pelvis and everything above it ride up by at most this much (rig.ts). The torso turns about the waist
 * joint, the backrest about its hinge under the back, so a body that lies high (an avatar with a big `liePelvis`) would sink into the slab; the lift keeps
 * its back in it, up to this limit (beyond it the back sinks a little deeper rather than the hips floating further above the mattress). The feet stay
 * planted, so the legs slope up to the hips and the blanket (gear.ts) covers them at their highest.
 */
export const LIE_RECLINE_LIFT_MAX = 0.045

/**
 * W3 wave B: a skeleton's proportions, metres at nominal size: BODY plus the small front/back offsets a real body has (the neck and shoulders
 * of a person sit a few centimetres behind the waist) and the lying pelvis height. The procedural crowd uses NOMINAL_BODY (exactly BODY, so
 * every procedural person is posed number for number as before); every realistic avatar (avatars.ts) carries its own, measured from its mesh
 * by tools/convert-people.mjs, so the rig puts each joint where that mesh has it and nothing is stretched. The standing crown of every avatar
 * body is STAND_CROWN, so head.ts stays exact for everyone standing.
 */
export interface BodyDims {
  ankle: number
  shin: number
  thigh: number
  hipHalf: number
  hipDrop: number
  waist: number
  /** Forward offset of the waist joint from the pelvis centre (+Z forward). */
  waistZ: number
  neck: number
  /** Forward offset of the neck base from the waist joint. */
  neckZ: number
  shoulderHalf: number
  shoulderUp: number
  /** Forward offset of the shoulder joints from the waist joint. */
  shoulderZ: number
  upperArm: number
  forearm: number
  hand: number
  headCentre: number
  crown: number
  /** Seated: pelvis centre above the seat surface. */
  seatedPelvis: number
  /** Lying: pelvis centre above the mattress (LIE.pelvisAbove for the procedural body; an avatar's own, so its back sinks 2 to 3 cm into the linen). */
  liePelvis: number
  /**
   * Lying: how far back (towards the head) the feet are planted in the upright solve before the body is laid flat, so the heels of a body thicker
   * than the procedural one rest on the mattress instead of hovering. 0 for the procedural body.
   */
  lieFeet: number
}

/** The procedural crowd's skeleton. */
export const NOMINAL_BODY: Readonly<BodyDims> = Object.freeze({ ...BODY, waistZ: 0, neckZ: 0, shoulderZ: 0, liePelvis: LIE.pelvisAbove, lieFeet: 0 })

/** Pelvis centre height of a relaxed standing person with the proportions `b` (STAND_PELVIS for NOMINAL_BODY, to the last bit). */
export function standPelvis(b: Readonly<BodyDims>): number {
  return b.ankle + (b.thigh + b.shin) * LEG_RELAXED + b.hipDrop
}

/** The skeleton: one rigid, instanced piece per entry. The index is the part's column group in the pose texture. */
export const P = {
  pelvis: 0,
  chest: 1,
  head: 2,
  hairCap: 3,
  hairBack: 4,
  armL: 5,
  foreL: 6,
  handL: 7,
  armR: 8,
  foreR: 9,
  handR: 10,
  thighL: 11,
  shinL: 12,
  footL: 13,
  thighR: 14,
  shinR: 15,
  footR: 16,
  /** Skirt, white coat or hospital gown: one flared tube hanging from the pelvis, scaled per outfit. */
  skirt: 17,
  /** W1: the third hair piece (a fringe, a side sweep or a puff on the forehead); the close-up head only. */
  hairFront: 18,
  /** Not in the body mesh: the matrix of the item held in the right hand, read by the props mesh. */
  prop: 19,
} as const
export const PART_COUNT = 20
/** Parts in the body meshes (everything but the prop frame). */
export const BODY_PARTS = 19

/**
 * Colour slots. A vertex carries a slot number, a person carries 15 colours: slots 0 to 14 are read from the
 * person's palette, slots 15 and above are fixed colours (eyes, soles, tablet, cart plastic, ...). Some fixed slots are
 * "feature" slots of the close-up head and the staff details: the vertex stage moves them (the iris, the brows, the mouth),
 * tints them from the person's own palette (brows from the hair, lips from the skin) or hides them (a badge on someone
 * who wears none); see FEATURE_FIRST and shaders.ts.
 *
 * Why so many: one rigid mesh serves every outfit. A short sleeve is "sleeve = skin", a long sleeve is
 * "sleeve = top", shorts are "lowerLeg = skin", a gown is "coat = gown colour, upperLeg = lowerLeg = skin".
 */
export const SLOT = {
  skin: 0,
  hair: 1,
  /** Shirt, jacket, scrub top, white coat's body. */
  top: 2,
  /** Trousers (the scrub trousers under a white coat). */
  pants: 3,
  shoes: 4,
  /** The shirt or scrub top showing in a jacket's V (the same as `top` when there is no jacket). */
  front: 5,
  /** Tie, scarf, and the hi-vis bands of a paramedic's vest (the same as `top` for everyone else, so invisible). */
  accent: 6,
  /** Lower half of the upper arm and the forearm: the top colour for long sleeves, skin for short ones. */
  sleeve: 7,
  /** Shin: trousers, or skin for shorts, gowns and skirts. */
  lowerLeg: 8,
  /** Lanyard strap (a doctor's stethoscope tube, a badge strap). */
  lanyard: 9,
  /** Thigh down to the hem. */
  upperLeg: 10,
  /** Sunglasses/glasses (skin colour when there are none, so the band vanishes). */
  glasses: 11,
  /** The skirt piece: white coat, gown, skirt (the pants colour when the person wears none). */
  coat: 12,
  /** A per-person tint for what they carry: bag, folder, flowers. */
  gear: 13,
  /** W1: the colour band of the staff badge (the player's "You" badge is gold). */
  badge: 14,
} as const
export const PALETTE_SLOTS = 15

/** Index into FIXED_COLORS (slot = PALETTE_SLOTS + index). */
export const FX = {
  eye: 0,
  sole: 1,
  paper: 2,
  tabletBody: 3,
  tabletScreen: 4,
  metalDark: 5,
  metalLight: 6,
  rubber: 7,
  trayGrey: 8,
  cupWhite: 9,
  coffee: 10,
  stem: 11,
  linen: 12,
  fabricTeal: 13,
  cartYellow: 14,
  bucketBlue: 15,
  sage: 16,
  mopHead: 17,
  mopPole: 18,
  wood: 19,
  // ---- W1 close-up people: feature slots (the vertex stage of the near bodies knows them by number; props and vehicles never use them)
  /** The white of the eye (squashed by the blink). */
  sclera: 20,
  /** Eyebrows: the person's hair colour, a little darker. */
  brow: 21,
  /** The mouth line: the person's skin, darker and redder. */
  mouth: 22,
  /** Glasses frame: the person's glasses colour; hidden on everyone who wears none. */
  frame: 23,
  /** Badge card (paper; gold on the player), colour band (the role colour; dark on the player), photo patch and the player's "Y". Hidden where there is no badge. */
  badgeCard: 24,
  badgeBand: 25,
  badgePhoto: 26,
  badgeMark: 27,
  /** The stethoscope's tail and chest piece (doctors), the radiographer's dosimeter, the ward host's apron bib. */
  stethTube: 28,
  stethPiece: 29,
  dosimeter: 30,
  bib: 31,
  /** The ink of the player's "You" badge: its band and its "Y" (the card is gold, the person's badge colour). */
  youInk: 32,
} as const
/** sRGB hex of the fixed colours, in the order of FX. Warm-white and grey tones come from the shared palette (materials.ts). */
export const FIXED_COLORS: readonly string[] = [
  '#241812', // eye (the iris)
  '#2b2623', // sole
  '#f2efe6', // paper
  '#2f393c', // tablet body
  '#8fd0cc', // tablet screen (a soft teal, readable but not a light source)
  '#3a4245', // metalDark
  '#c6cdcf', // metalLight (frame)
  '#2b3133', // rubber
  '#d5dcdc', // tray
  '#f5f6f6', // cup
  '#7a5037', // coffee lid
  '#5c9a5b', // stems
  '#ffffff', // linen
  '#5ea89c', // fabricTeal
  '#e8c25a', // cleaning cart
  '#5c9fd6', // bucket
  '#a7bdab', // fabricSage
  '#ece8df', // mop head
  '#a9b3b5', // mop pole
  '#c9a678', // woodOak
  '#ece7df', // sclera
  '#3a2a20', // brow (placeholder: the shader uses the person's hair)
  '#a8605a', // mouth (placeholder: the shader uses the person's skin)
  '#23262a', // frame (placeholder: the shader uses the person's glasses colour)
  '#f4f2ec', // badgeCard
  '#3f7fd1', // badgeBand (placeholder: the shader uses the person's badge colour)
  '#8f9ca2', // badgePhoto
  '#1d2b4a', // badgeMark
  '#26303a', // stethTube
  '#c6cdcf', // stethPiece
  '#e8a33a', // dosimeter
  '#f4ecd8', // bib (placeholder: the shader uses the person's coat colour, the apron)
  '#1d2b4a', // youInk
]
export const fixedSlot = (i: number): number => PALETTE_SLOTS + i
/** The first fixed slot the vertex stage treats as a feature (the sclera) and the iris, which sits earlier in the table. */
export const FEATURE_FIRST = fixedSlot(FX.sclera)

/**
 * What can be held in the right hand. The mop is the cleaner's tool: the renderer adds it whenever `anim` is 'clean'. The blanket is not held: it is the
 * cover of a patient lying in a bed or on a stretcher, carried in the prop frame of the lying person (nobody lying holds anything), see gear.ts BLANKET.
 */
export const PROP = { none: 0, tablet: 1, folder: 2, tray: 3, cup: 4, bag: 5, flowers: 6, mop: 7, blanket: 8 } as const
export const PROP_COUNT = 9
/**
 * W3 wave B: the props shader's kind for the player's gold "You" badge pinned on the realistic avatar's coat. It is not held: its frame is
 * BADGE_FRAME (model.ts), and it is drawn by a mesh of its own (gear.ts buildBadgeGeometry) with the props material, only while the player wears one.
 */
export const BADGE_KIND = PROP_COUNT
/**
 * W3 wave B: the part slot that carries the frame of the "You" badge for a person drawn as a realistic avatar. The avatar mesh is skinned to the
 * body parts only (avatars.ts SKINNED_PARTS), so the close-up head's third hair piece, which only the procedural body draws, is free for it.
 */
export const BADGE_FRAME: number = P.hairFront

/** Wheeled things. A pusher pushes one, a rider sits or lies on it. */
export const VEHICLE = { none: 0, wheelchair: 1, stretcher: 2, cleaningCart: 3, linenCart: 4 } as const
export const VEHICLE_COUNT = 5

/**
 * How far in front of the pusher (along their heading) each vehicle's origin is, metres. The origin is where a rider's hips
 * are (wheelchair, stretcher) or the middle of the cart. The vehicle models put their push handle at HANDLE.ahead from the
 * pusher: the handle sits at `HANDLE.ahead - ahead` in the vehicle's own frame. A sim that places riders itself should use
 * the same numbers (the renderer also snaps a nearby rider onto the vehicle, so a few centimetres either way do not show).
 */
// single source of truth is the sim contract (the sim places riders at the same offset), in vehicle-index order
export const VEHICLE_AHEAD = [
  VEHICLE_AHEAD_BY_KIND.none,
  VEHICLE_AHEAD_BY_KIND.wheelchair,
  VEHICLE_AHEAD_BY_KIND.stretcher,
  VEHICLE_AHEAD_BY_KIND.cleaningCart,
  VEHICLE_AHEAD_BY_KIND.linenCart,
] as const

/**
 * The pose texture: one row per person, RGBA float, `width` texels wide.
 *
 *   texel 0           root: x, y, z, heading
 *   texel 1           lod: c0, c1, p, rim strength.  A pixel belongs to the high-detail body when its
 *                     dither value t is in [0, c0), to the mid-detail body in [c0, c1) and to the far
 *                     figure in [c1, p). p is the person's presence (fade in and out); c0 = p * wHigh and
 *                     c1 = p * (wHigh + wMid). So exactly one of the three is drawn at every pixel.
 *   texel 2           rim colour r, g, b and a spare
 *   texel 3           far figure size: height scale, width scale, spare, spare
 *   texels 4..63      20 parts x 3 texels, a 3x4 matrix row-major per part (relative to the root)
 *   texels 64..78     the 15 palette colours (linear sRGB)
 *   texel 79          face (W1): eye yaw, eye pitch (radians, in the head's frame), expression (-1 frown .. +1 smile), blink (0 open .. 1 shut)
 *   texel 80          staff details (W1): badge kind (0 none, 1 staff, 2 the player's "You"), flag bits (GEAR_BIT in staff.ts), mouth open (0..1), spare
 */
const PALETTE_AT = 4 + PART_COUNT * 3
export const TEX = {
  width: PALETTE_AT + PALETTE_SLOTS + 2,
  root: 0,
  lod: 1,
  rim: 2,
  size: 3,
  parts: 4,
  palette: PALETTE_AT,
  face: PALETTE_AT + PALETTE_SLOTS,
  gear: PALETTE_AT + PALETTE_SLOTS + 1,
} as const

/** Floats per person row. */
export const ROW_FLOATS = TEX.width * 4

/** People the crowd can draw at once (rows in the pose texture). The hospital holds about 100 to 200. */
export const MAX_PEOPLE = 320

/** Rim colours (sRGB hex) for the emphasis states. */
export const RIM_COLORS = {
  selected: '#8cc0ff',
  followed: '#ffd873',
  hovered: '#cfe3ff',
} as const

/** Colour of a person's soft ground ring when selected or followed. */
export const RING_COLORS = {
  selected: '#6fb0ff',
  followed: '#ffc94d',
} as const
