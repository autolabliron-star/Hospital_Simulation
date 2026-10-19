// Ported from Waltz City (src/scene/actors/crowd/outfit.ts): the skin, hair and casual tables and `lookFor`'s structure. The roles, uniforms and colours are the hospital's.
/**
 * Who looks like what. `lookFor` turns an identity (entity id, role, outfit class, variant) into a complete, deterministic
 * appearance: size, build, skin, hair, and a colour for every outfit slot.
 *
 * Design rules
 *  - A person looks the same for their whole life. Everything but the clothes comes from the id and the variant; the clothes also
 *    follow the role and the outfit class (a patient who is admitted changes from everyday clothes into a gown).
 *  - Roles read from the overview (the camera is about 110 m away and a person is 25 to 40 px tall): the colour of the scrubs is
 *    the role. Doctors and pharmacists add a white coat; the paramedic wears hi-vis bands; patients wear a pale gown.
 *  - Skin tones span a wide range, hair has six shapes (hair.ts) in natural colours, height varies by 6 % either way.
 *  - W1: staff wear a badge in their role's colour and the player (id 'player') a gold "You" badge; doctors wear a stethoscope, radiographers a
 *    dosimeter, the ward host an apron bib. Everything is chosen from the id and variant, so a person looks the same all day.
 *
 * ALL NAMES AND COLOURS OF THE CLOTHES LIVE IN THIS FILE (the tables below). The tones come from docs/M2-ART.md and the shared palette
 * (materials.ts): teal and mint for the scrubs of the clinical staff, the wayfinding blue and green for nurses and pharmacists,
 * slate for the coordinator, the warm greys of the porter.
 */
import type { Presentation } from '@/content/roster'
import type { Outfit, Role } from '@/sim/types'
import { clamp, hash32, rnd, rndSoft } from './math'
import { STAND_CROWN } from './constants'
import { type HairStyle } from './hair'
import { BADGE, type BadgeKind } from './staff'

export type { HairStyle }
/** What the legs show: long trousers, shorts, or bare legs (a gown, a skirt). */
export type LegStyle = 'long' | 'shorts' | 'bare'
/** The piece that hangs from the pelvis: nothing, a skirt, a white coat or a hospital gown. */
export type Overlay = 'none' | 'skirt' | 'coat' | 'gown'
export type SleeveStyle = 'short' | 'long'

export interface Look {
  /** Per-person random seed: idle phases, gesture speeds and so on come from it. */
  seed: number
  /** Crown height of a relaxed standing person, metres. */
  height: number
  /** height / nominal crown height: scales every length of the body (0.94 to 1.06). */
  scale: number
  /** Width factor of torso and pelvis, about 0.94 to 1.1. */
  build: number
  hairStyle: HairStyle
  /** Whether the person wears glasses (their frame colour is `glasses`). */
  glassesOn: boolean
  /** W1 close-up details: the badge (none, staff, or the player's "You") and its colour; the stethoscope, dosimeter and apron bib. */
  badgeKind: BadgeKind
  stethoscope: boolean
  dosimeter: boolean
  apron: boolean
  legs: LegStyle
  overlay: Overlay
  sleeves: SleeveStyle
  lanyardOn: boolean
  /** +1 right handed (gestures), -1 left handed. */
  hand: 1 | -1
  // colours, sRGB hex
  skin: string
  hair: string
  top: string
  pants: string
  shoes: string
  front: string
  accent: string
  sleeve: string
  lowerLeg: string
  lanyard: string
  upperLeg: string
  glasses: string
  /** The skirt piece: coat, gown or skirt colour (the pants colour when there is none). */
  coat: string
  /** What they carry (bag, folder, flowers). */
  gear: string
  /** The colour band of the staff badge; the card of the player's. */
  badge: string
}

export interface LookKey {
  /** Entity id. */
  id: string
  role: Role
  /** Clothing class: 'role' (default) dresses by role, 'gown' and 'everyday' override it. */
  outfit?: Outfit
  variant: number
  /**
   * W3 wave B: how the person's given name reads (content/roster.ts `presentationOf`). The procedural people (`?people=0`, and everybody while the
   * realistic ones load) follow the same rule as the realistic bodies: a woman's hair and skirts for 'female', a man's cut and trousers for 'male'.
   * 'either' or nothing keeps the seeded draw exactly as it was.
   */
  presentation?: Presentation
}

/** The named tones of the uniforms. Hex values; the comments say where they come from. */
export const TONE = {
  white: '#f6f8f8',
  paper: '#f4f2ec',
  /** Soft teal (the STATUS teal, a little deeper for cloth). */
  scrubTeal: '#1f8f8a',
  scrubNavy: '#243b63',
  /** WAYFINDING.wardA blue. */
  scrubBlue: '#3f7fd1',
  scrubBlue2: '#4a8bd8',
  /** WAYFINDING.wardB green. */
  scrubGreen: '#2f9e6e',
  gown: '#bcd9ee',
  slipper: '#dfe7e8',
  porterTop: '#8d9996',
  porterPants: '#566269',
  cleanerTunic: '#9a7fc4',
  cleanerPants: '#4a4f5a',
  receptionNavy: '#1f3556',
  /** fabricTeal, the receptionist's scarf. */
  scarf: '#5ea89c',
  slate: '#5b6b7c',
  coordinatorPants: '#3c4651',
  chino: '#c9c2b0',
  paramedicGreen: '#3f8a58',
  paramedicPants: '#2f6e45',
  hiVis: '#e2f23c',
  stethoscope: '#2d3a3e',
  badgeStrap: '#e6f0ef',
  teal: '#2aa39a',
  dark: '#222326',
  white2: '#ebe8e0',
  /** Radiographers: the wine-red tunic many imaging departments use, over navy trousers, with a dosimeter badge. */
  scrubWine: '#7c3a4c',
  dosimeter: '#e8a33a',
  /** Ward host (L1): a soft sage-green polo (lighter than the pharmacist's scrubs, so it never reads as a nurse or a pharmacist), a warm cream apron and a peach lanyard that matches the MealBot's light. */
  hostPolo: '#8fcaa0',
  hostApron: '#f4ecd8',
  hostPants: '#434b57',
  peach: '#f2a07c',
  /** Badge bands: one per staff role, so a badge says who it is on at 2 m. The player's is gold. */
  badgeDoctor: '#1f8f8a',
  badgeNurse: '#3f7fd1',
  badgePharmacist: '#2f9e6e',
  badgePorter: '#d58a3a',
  badgeReception: '#5ea89c',
  badgeCoordinator: '#7a6bb5',
  badgeRadiographer: '#7c3a4c',
  badgeSonographer: '#243b63',
  badgeHost: '#f2a07c',
  youGold: '#ffc83d',
  /** R2 theatre scrubs: a cool surgical blue and a blue-teal (a little lighter than the doctors' scrubTeal, and not the nurses' bright blue), with a pale cap. */
  theatreBlue: '#2a8fb0',
  theatreTeal: '#2f9d9e',
  theatreCap: '#8fcfdc',
} as const

/** What each role wears, in words (the labels the inspect card and the tests can use). */
export const OUTFIT_NAMES: Readonly<Record<Role, string>> = {
  doctor: 'white coat over teal or navy scrubs, stethoscope',
  nurse: 'blue scrubs',
  pharmacist: 'green scrubs under a white coat',
  porter: 'grey uniform',
  cleaner: 'purple tunic',
  receptionist: 'navy blazer',
  coordinator: 'slate smart casual',
  paramedic: 'green uniform with hi-vis bands',
  radiographer: 'wine-red tunic, navy trousers, dosimeter badge',
  sonographer: 'navy scrubs',
  host: 'soft green polo, apron',
  labScientist: 'lavender scrubs, lab coat',
  patient: 'pale blue gown',
  visitor: 'everyday clothes',
}
export const GOWN_NAME = 'pale blue gown'
export const EVERYDAY_NAME = 'everyday clothes'
/** R2: what everybody on level 2's clinical side wears (the 'theatre' outfit), whatever their role. */
export const THEATRE_NAME = 'theatre scrubs and a cap'

const SKIN = ['#f4d6c1', '#ebc2a1', '#dba883', '#c48b60', '#a76b42', '#8b5332', '#6b3d26', '#4b2a1a'] as const
const SKIN_WEIGHTS = [0.12, 0.2, 0.2, 0.17, 0.12, 0.08, 0.07, 0.04] as const

const HAIR = ['#15110f', '#251a14', '#3a261a', '#5a3a22', '#7b4e2c', '#a8743a', '#c9a05a', '#e0c78c', '#8c3a22', '#8d8b88', '#cfcdc8'] as const
const HAIR_WEIGHTS = [0.2, 0.17, 0.15, 0.13, 0.08, 0.06, 0.05, 0.04, 0.04, 0.05, 0.03] as const
/** Patients skew older: more grey. */
const HAIR_WEIGHTS_OLD = [0.1, 0.08, 0.08, 0.08, 0.05, 0.04, 0.03, 0.03, 0.02, 0.26, 0.23] as const
/** The six hair shapes, with the common ones listed twice. */
const HAIR_STYLES: readonly HairStyle[] = ['crop', 'crop', 'swept', 'swept', 'bob', 'long', 'long', 'ponytail', 'curly']
/** The shapes of a woman's and of a man's hair (a name that reads one way, see LookKey.presentation); curls belong to both. */
const HAIR_STYLES_FEMALE: readonly HairStyle[] = ['bob', 'bob', 'long', 'long', 'ponytail', 'ponytail', 'curly']
const HAIR_STYLES_MALE: readonly HairStyle[] = ['crop', 'crop', 'crop', 'swept', 'swept', 'swept', 'curly']
/** Frames of glasses. */
const FRAMES = ['#222326', '#222326', '#6b4a32', '#2b3a55', '#8a2f3a', '#a9b3b5'] as const

/** Everyday clothes, from a soft palette (nothing louder than the scrubs, so roles stay readable). */
const TOPS_SOFT = [
  '#e8e2d4', '#f4f1ea', '#cfe0d8', '#b9d3e8', '#e6c8c8', '#d9d2ec', '#f1dcae', '#bdd8c6', '#e9b8a6', '#9fb8cf', '#d8c3a5', '#c9d6c0',
  '#f0cfc0', '#aab8d6', '#e4d4e8', '#cbd6a8', '#d6c9b8', '#a9c9c4', '#e8c4a0', '#c4b8d8',
] as const
const PANTS_LONG = ['#3a4d70', '#5b7092', '#47556b', '#b8a584', '#cdbf9f', '#8b7a5e', '#d9d1bd', '#4e535c', '#6b7a8f', '#a8a193', '#2b3c5c', '#7d8a74'] as const
const PANTS_SHORT = ['#c4b08a', '#5b7092', '#ebe8e0', '#6b7a8f', '#a49c8e'] as const
const SKIRTS = ['#3a4d70', '#8e6a7a', '#b88a72', '#4f8a87', '#d9d4c7', '#6b7a8f', '#a8837a', '#7d9a82'] as const
const SHOES_EVERYDAY = ['#ebe8e0', '#ebe8e0', '#222326', '#6b4a32', '#2b3a55', '#b08a5e', '#8a8a8a', '#c9b8a0'] as const
const GEAR = ['#d9877a', '#6aa7c8', '#8fbf94', '#e0b865', '#a78fc4', '#d8d2c4', '#5d8f9c', '#c46f6f'] as const

function pickWeighted<T>(items: readonly T[], weights: readonly number[], h: number, k: number): T {
  let total = 0
  for (const w of weights) total += w
  let x = rnd(h, k) * total
  for (let i = 0; i < items.length; i++) {
    x -= weights[i]
    if (x <= 0) return items[i]
  }
  return items[items.length - 1]
}

function pick<T>(items: readonly T[], h: number, k: number): T {
  return items[Math.min(items.length - 1, Math.floor(rnd(h, k) * items.length))]
}

/** Seed shared by everything that varies per person: the id mixed with the variant. */
export function seedFor(id: string, variant: number): number {
  return ((hash32(id) ^ Math.imul(variant + 1, 0x85ebca6b)) >>> 0) || 1
}

/** Size factor of a person relative to the nominal body: 1 plus or minus 6 %. Pure function of the key. */
export function scaleFor(id: string, variant: number): number {
  return 1 + clamp(rndSoft(seedFor(id, variant), 11) * 0.04, -0.06, 0.06)
}

/** Crown height of a person, metres. Pure function of the key, so labels and the renderer agree to the millimetre. */
export function heightFor(id: string, variant: number): number {
  return STAND_CROWN * scaleFor(id, variant)
}

/**
 * The clothing class a person wears: an explicit class wins, otherwise patients wear gowns and visitors everyday clothes. R2: the 'theatre' outfit is scrubs
 * and a cap for anybody, the surgeon (a doctor, who otherwise wears a white coat) and you included.
 */
export function clothesOf(role: Role, outfit: Outfit | undefined): 'gown' | 'everyday' | 'uniform' | 'theatre' {
  if (outfit === 'theatre') return 'theatre'
  if (outfit === 'gown') return 'gown'
  if (outfit === 'everyday') return 'everyday'
  if (role === 'patient') return 'gown'
  if (role === 'visitor') return 'everyday'
  return 'uniform'
}

export function lookFor(key: LookKey): Look {
  const h = seedFor(key.id, key.variant)
  const scale = scaleFor(key.id, key.variant)
  const clothes = clothesOf(key.role, key.outfit)
  const old = key.role === 'patient' || (key.role === 'visitor' && rnd(h, 24) < 0.4)

  const skin = pickWeighted(SKIN, SKIN_WEIGHTS, h, 21)
  let hair: string = pickWeighted(HAIR, old ? HAIR_WEIGHTS_OLD : HAIR_WEIGHTS, h, 22)
  let hairStyle: HairStyle = pick(key.presentation === 'female' ? HAIR_STYLES_FEMALE : key.presentation === 'male' ? HAIR_STYLES_MALE : HAIR_STYLES, h, 23)
  // a man's everyday and smart clothes have trousers or shorts, never a skirt (the draw `r` is the same: only what it picks changes)
  const noSkirt = key.presentation === 'male'

  let top: string = pick(TOPS_SOFT, h, 31)
  let pants: string = pick(PANTS_LONG, h, 44)
  let legs: LegStyle = 'long'
  let overlay: Overlay = 'none'
  let coat: string | null = null
  let sleeves: SleeveStyle = rnd(h, 32) < 0.62 ? 'short' : 'long'
  let front: string | null = null
  let accent: string | null = null
  let shoes: string = pick(SHOES_EVERYDAY, h, 33)
  let lanyardOn = false
  let lanyard: string = TONE.badgeStrap
  let glasses = rnd(h, 34) < 0.22 && clothes !== 'uniform' && clothes !== 'theatre'
  const r = rnd(h, 35)
  // W1 close-up details
  let badge: string | null = null
  let stethoscope = false
  let dosimeter = false
  let apron = false

  if (clothes === 'gown') {
    top = TONE.gown
    sleeves = 'short'
    legs = 'bare'
    overlay = 'gown'
    coat = TONE.gown
    shoes = TONE.slipper
  } else if (clothes === 'theatre') {
    // R2: matching scrub top and trousers (a cool blue or a blue-teal), short sleeves, clean shoes, a cap over the hair; no coat, lanyard, stethoscope or badge in theatre
    const scrub = rnd(h, 36) < 0.62 ? TONE.theatreBlue : TONE.theatreTeal
    top = scrub
    pants = scrub
    sleeves = 'short'
    shoes = rnd(h, 38) < 0.6 ? TONE.white2 : TONE.dark
    glasses = rnd(h, 34) < 0.2
    hairStyle = 'theatreCap'
    hair = TONE.theatreCap
  } else if (clothes === 'everyday') {
    // shirt and trousers, shorts, or a skirt
    const bottom = r < 0.52 ? 'long' : r < 0.7 ? 'shorts' : noSkirt ? 'long' : 'skirt'
    if (bottom === 'long') {
      legs = 'long'
      pants = pick(PANTS_LONG, h, 44)
    } else if (bottom === 'shorts') {
      legs = 'shorts'
      pants = pick(PANTS_SHORT, h, 45)
    } else {
      legs = 'bare'
      overlay = 'skirt'
      pants = pick(SKIRTS, h, 46)
      coat = pants
    }
    // an older person wears long sleeves more often
    if (old) sleeves = rnd(h, 32) < 0.7 ? 'long' : 'short'
  } else {
    switch (key.role) {
      case 'doctor': {
        // white coat over teal or navy scrubs; the strap is the stethoscope's neck tubes (its tail and chest piece are geometry, staff.ts)
        const scrub = rnd(h, 36) < 0.55 ? TONE.scrubTeal : TONE.scrubNavy
        top = TONE.white
        front = scrub
        pants = scrub
        overlay = 'coat'
        coat = TONE.white
        sleeves = 'long'
        shoes = rnd(h, 38) < 0.55 ? TONE.white2 : TONE.dark
        lanyardOn = true
        lanyard = TONE.stethoscope
        glasses = rnd(h, 34) < 0.2
        badge = TONE.badgeDoctor
        stethoscope = true
        break
      }
      case 'pharmacist': {
        top = TONE.white
        front = TONE.scrubGreen
        pants = TONE.scrubGreen
        overlay = 'coat'
        coat = TONE.white
        sleeves = 'long'
        shoes = TONE.white2
        lanyardOn = true
        lanyard = TONE.badgeStrap
        glasses = rnd(h, 34) < 0.3
        badge = TONE.badgePharmacist
        break
      }
      case 'nurse': {
        top = rnd(h, 36) < 0.7 ? TONE.scrubBlue : TONE.scrubBlue2
        pants = top
        sleeves = rnd(h, 37) < 0.75 ? 'short' : 'long'
        shoes = rnd(h, 38) < 0.7 ? TONE.white2 : TONE.dark
        lanyardOn = true
        lanyard = TONE.badgeStrap
        badge = TONE.badgeNurse
        break
      }
      case 'porter': {
        top = TONE.porterTop
        pants = TONE.porterPants
        sleeves = rnd(h, 36) < 0.5 ? 'short' : 'long'
        shoes = TONE.dark
        lanyardOn = true
        lanyard = TONE.teal
        badge = TONE.badgePorter
        break
      }
      case 'cleaner': {
        top = TONE.cleanerTunic
        pants = TONE.cleanerPants
        sleeves = rnd(h, 36) < 0.6 ? 'short' : 'long'
        shoes = TONE.white2
        break
      }
      case 'receptionist': {
        // a navy blazer over a white shirt, a teal scarf, trousers or a skirt
        top = TONE.receptionNavy
        front = TONE.paper
        accent = TONE.scarf
        sleeves = 'long'
        if (r < 0.5 && !noSkirt) {
          legs = 'bare'
          overlay = 'skirt'
          pants = TONE.receptionNavy
          coat = TONE.receptionNavy
        } else pants = TONE.receptionNavy
        shoes = TONE.dark
        lanyardOn = true
        lanyard = TONE.teal
        badge = TONE.badgeReception
        break
      }
      case 'coordinator': {
        top = TONE.slate
        pants = rnd(h, 36) < 0.5 ? TONE.coordinatorPants : TONE.chino
        sleeves = rnd(h, 37) < 0.7 ? 'long' : 'short'
        shoes = rnd(h, 38) < 0.5 ? TONE.dark : TONE.white2
        lanyardOn = true
        lanyard = TONE.teal
        glasses = rnd(h, 34) < 0.3
        badge = TONE.badgeCoordinator
        break
      }
      case 'radiographer': {
        top = TONE.scrubWine
        pants = TONE.scrubNavy
        sleeves = 'short'
        shoes = TONE.white2
        lanyardOn = true
        lanyard = TONE.dosimeter
        glasses = rnd(h, 34) < 0.25
        badge = TONE.badgeRadiographer
        dosimeter = true
        break
      }
      case 'sonographer': {
        top = TONE.scrubNavy
        pants = TONE.scrubNavy
        sleeves = rnd(h, 37) < 0.6 ? 'short' : 'long'
        shoes = TONE.white2
        lanyardOn = true
        lanyard = TONE.badgeStrap
        badge = TONE.badgeSonographer
        break
      }
      case 'host': {
        // the ward host who serves meals with the MealBot: a soft green polo, short sleeves, a cream apron over dark trousers
        // (the skirt piece hangs from the pelvis like a long apron) and a peach lanyard, the MealBot's accent
        top = TONE.hostPolo
        pants = TONE.hostPants
        overlay = 'skirt'
        coat = TONE.hostApron
        sleeves = 'short'
        shoes = rnd(h, 38) < 0.6 ? TONE.white2 : TONE.dark
        lanyardOn = true
        lanyard = TONE.peach
        badge = TONE.badgeHost
        apron = true
        break
      }
      case 'paramedic': {
        top = TONE.paramedicGreen
        pants = TONE.paramedicPants
        accent = TONE.hiVis
        sleeves = 'long'
        shoes = TONE.dark
        lanyardOn = false
        break
      }
      default:
        break
    }
  }

  // without a jacket there is no shirt front or tie to show: those slots just repeat the top
  const frontC = front ?? top
  const accentC = accent ?? top
  // what the sleeves and trouser legs are made of (a short sleeve or a short leg is just skin)
  const sleeve = sleeves === 'long' ? top : skin
  const upperLeg = legs === 'bare' ? skin : pants
  const lowerLeg = legs === 'long' ? pants : skin
  // the player is "You": a gold badge on a doctor's coat
  const isPlayer = key.id === 'player'
  const badgeKind: BadgeKind = isPlayer ? BADGE.you : badge && lanyardOn ? BADGE.staff : BADGE.none
  if (isPlayer) badge = TONE.youGold

  return {
    seed: h,
    height: STAND_CROWN * scale,
    scale,
    build: 0.94 + rnd(h, 51) * 0.16,
    hairStyle,
    glassesOn: glasses,
    badgeKind,
    stethoscope,
    dosimeter,
    apron,
    legs,
    overlay,
    sleeves,
    lanyardOn,
    hand: rnd(h, 52) < 0.88 ? 1 : -1,
    skin,
    hair,
    top,
    pants,
    shoes,
    front: frontC,
    accent: accentC,
    sleeve,
    lowerLeg,
    lanyard: lanyardOn ? lanyard : top,
    upperLeg,
    glasses: glasses ? pick(FRAMES, h, 54) : skin,
    coat: coat ?? pants,
    gear: pick(GEAR, h, 53),
    badge: badge ?? top,
  }
}
