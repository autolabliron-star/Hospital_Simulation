// Ported from Waltz City (src/scene/actors/crowd/avatars.ts, wave 10b): the index types, the bind maths (invertRigid, applyBinds, skinPoint) and
// femaleShare. New for the hospital (W3 wave B): the cast is chosen by role and clothing class (the uniform table below), the player always wears
// medical_male_01, garment tint masks keep each role's scrub colour, the LODs are 4,000 / 1,200 / 350 triangles and there is one 1K atlas.
/**
 * Realistic people: which Microsoft Rocketbox avatar a person wears and the bind maths that lets the existing 20-part rig drive a skinned,
 * textured mesh. Pure, no three.js, unit tested.
 *
 * How the pieces fit:
 *   - tools/convert-people.mjs turns each avatar into three glbs (LOD 0/1/2) whose vertices are skinned to the crowd's parts (P in constants.ts,
 *     up to 4 per vertex), one 1024 x 1536 texture atlas (body, head, hair and the stethoscope where there is one) and
 *     public/assets/people/index.json (this file's PeopleIndex): per avatar its skeleton (BodyDims), the bind frames of its parts, the reference
 *     luminance of its garments for the tint, where its atlas regions are and where a badge sits on its chest.
 *   - The rig (rig.ts) poses the person with the avatar's own proportions and writes the part matrices M_p into the pose texture as before. For a
 *     person wearing an avatar the model then replaces each skinned part's matrix by M_p * B_p^-1 (`applyBinds`), B_p being where that part sat in
 *     the mesh. The vertex shader does plain linear-blend skinning with those rows; props keep their raw matrix.
 *   - Who wears what is a pure function of the person (`avatarFor`): the player wears medical_male_01 (and nobody else does); everybody else picks
 *     from the wardrobe of their role and clothing class (UNIFORM, GOWN, EVERYDAY). A woman's or a man's body follows the person's given name
 *     (content/people.json `presentation`: "Grace" is drawn as a woman, "Callum" as a man); a name that reads either way ("Noa", a surname)
 *     leaves it to a seeded draw in proportion to the height (heights stay what `heightFor` says, so head positions are unchanged).
 *   - Tint (the overview reads roles by colour, outfit.ts): the atlas alpha of the body and head regions is a garment mask (255 untinted, 170 top
 *     garment, 85 bottom garment). A wardrobe asks for its top and/or bottom garment to take the person's palette colour (SLOT.top, SLOT.pants) at
 *     the garment's own shading (colour x luminance / the avatar's reference luminance). A garment whose reference luminance is under
 *     TINT_MIN_REF is too dark to carry a colour and keeps its own.
 */
import type { Presentation } from '@/content/roster'
import type { Outfit, Role } from '@/sim/types'
import { P, PART_COUNT, type BodyDims } from './constants'
import { clamp, rnd } from './math'
import { clothesOf } from './outfit'

export type AvatarGender = 'female' | 'male'

/** One level of detail of one avatar: a glb under public/assets/people/. */
export interface AvatarLodFile {
  file: string
  triangles: number
  vertices: number
  bytes: number
}

export interface AvatarTextureFile {
  file: string
  width: number
  height: number
  bytes: number
}

/** Representative colours (sRGB hex) sampled from the atlas, for anything that draws the person without the atlas (a far figure). */
export interface AvatarPalette {
  skin: string
  hair: string
  top: string
  sleeve: string
  pants: string
  upperLeg: string
  lowerLeg: string
  shoes: string
}

/** A rectangle of the atlas in UV units: [u, v, width, height], v measured down from the top (glTF). */
export type AtlasRect = [number, number, number, number]

/** Where each source texture sits in the avatar's atlas. `hair` (alpha = opacity) is the only region that is alpha tested. */
export interface AvatarAtlas {
  body: AtlasRect
  head: AtlasRect
  hair: AtlasRect | null
  /** The stethoscope of medical_female_02 and medical_male_03; null for everyone else. */
  extra: AtlasRect | null
}

export interface AvatarEntry {
  /** e.g. `medical_female_01`. */
  id: string
  /** Folder in the Rocketbox repository, e.g. `Professions/Medical_Female_01`. */
  source: string
  gender: AvatarGender
  /** Crown height of the source mesh, metres, and the factor it was divided by to stand STAND_CROWN tall. */
  sourceHeight: number
  k: number
  /** The avatar's skeleton at nominal size (the rig uses it instead of NOMINAL_BODY). */
  body: BodyDims
  /** B_p^-1 for every part, PART_COUNT x 12 floats (row-major 3x4); identity for parts the mesh does not use. */
  bindInverse: number[]
  palette: AvatarPalette
  /** Mean LINEAR luminance of the masked top and bottom garments (0 when the avatar has none): the tint's reference (the shader works in linear). */
  tintRef: { top: number; bottom: number }
  atlas: AvatarAtlas
  /** A point on the front of the chest (wearer's left, pocket height), nominal bind space: where the player's "You" badge is pinned. */
  badge: [number, number, number]
  /** Source materials the converter left out, and why (the glasses; the surgical cap and mask). */
  dropped: string[]
  /** LOD 0, 1, 2. */
  lods: AvatarLodFile[]
  texture: AvatarTextureFile
}

export interface PeopleIndex {
  version: 1
  generatedBy: string
  source: { repo: string; commit: string; licence: string }
  avatars: AvatarEntry[]
}

/** URL of the index, relative to the site base. */
export const PEOPLE_DIR = 'assets/people/'
export const PEOPLE_INDEX = `${PEOPLE_DIR}index.json`

/** Triangle targets of the three LODs the converter writes. */
export const LOD_TRIANGLES = [4000, 1200, 350] as const

/** Parts a skinned avatar mesh is weighted to. The others (hair pieces, the coat piece, the prop frame) keep raw matrices. */
export const SKINNED_PARTS: readonly number[] = [
  P.pelvis, P.chest, P.head, P.armL, P.foreL, P.handL, P.armR, P.foreR, P.handR, P.thighL, P.shinL, P.footL, P.thighR, P.shinR, P.footR,
]

// ---------------------------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------------------------

/** Tint bits (TEX.size.z of the pose texture): the top garment takes SLOT.top, the bottom garment SLOT.pants. */
export const TINT = { none: 0, top: 1, bottom: 2, both: 3 } as const
/**
 * A garment darker than this keeps its own colour: dividing by a tiny reference would only amplify the noise of its texels. The threshold is on
 * the reference's perceptual (sRGB-encoded) luminance: 0.15 leaves out only near-black cloth (a black skirt, black trousers), while the saturated
 * blues and greens of the paramedic and surgical uniforms (linear luminance 0.06 to 0.14, perceptually 0.27 to 0.41) take their role's colour.
 */
export const TINT_MIN_REF = 0.15
/** The most a texel's shading may brighten the tint colour (luminance / reference), so a dark garment's highlights do not blow out. */
export const TINT_MAX_GAIN = 1.6

/**
 * How much of a garment's own shading the tint keeps: the texel's luminance ratio to the reference is raised to this power. A light garment keeps
 * all of it (1); a dark one (denim, a dark suit) keeps about half (0.5), because its small luminances carry relatively more weave and compression
 * noise, which a bright tint colour would show as glitter.
 */
export function tintContrast(ref: number): number {
  const t = clamp((ref - 0.02) / (0.25 - 0.02), 0, 1)
  return 0.5 + 0.5 * t * t * (3 - 2 * t)
}

/** Linear luminance -> its perceptual (sRGB-encoded) value. */
export function perceptual(linear: number): number {
  const c = clamp(linear, 0, 1)
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

/** The entity id of the player, and the avatar only they wear: the all-white coat. */
export const PLAYER_ID = 'player'
export const PLAYER_AVATAR = 'medical_male_01'

/** What a role or clothing class wears: candidate avatars by gender, and which garments take the person's colours. */
export interface Wardrobe {
  female: readonly string[]
  male: readonly string[]
  tint: number
}

const EVERYDAY_F = ['female_adult_15', 'female_adult_17', 'business_female_02'] as const
const EVERYDAY_M = ['male_adult_08', 'male_adult_12', 'male_adult_13'] as const

/** Patients in a gown: the gown is the tint of an everyday outfit (top and bottom in the gown's pale blue). */
export const GOWN: Wardrobe = Object.freeze({ female: ['business_female_02', 'female_adult_15'], male: ['male_adult_13', 'male_adult_12'], tint: TINT.both })
/** Patients in everyday clothes and visitors: the six adults in their own clothes. */
export const EVERYDAY: Wardrobe = Object.freeze({ female: EVERYDAY_F, male: EVERYDAY_M, tint: TINT.none })
/**
 * R2: everybody in the 'theatre' outfit (level 2's clinical side, and you behind the lift cover): the surgical-scrubs avatars, top and trousers both taking the
 * theatre blue or teal of the person's palette (outfit.ts). The converter dropped these avatars' own surgical caps and masks (AvatarEntry.dropped), so the cap
 * of the procedural body (hair.ts theatreCap) has no counterpart here.
 */
export const THEATRE: Wardrobe = Object.freeze({ female: ['medical_female_01'], male: ['medical_male_04'], tint: TINT.both })

/**
 * Staff uniforms by role (the clothing class 'uniform'). The tints keep the design rule of outfit.ts (the colour of the scrubs is the role, read
 * from the overview): nurses blue, pharmacists green trousers, radiographers wine over navy, sonographers navy, paramedics green (their reflective
 * bands are not in the mask and stay white), porters grey, cleaners purple, the ward host's polo green. Doctors wear their own white coats.
 * 'patient' and 'visitor' never wear a uniform (clothesOf gives them a gown or everyday clothes); their rows are the gown and everyday wardrobes.
 */
export const UNIFORM: Readonly<Record<Role, Wardrobe>> = Object.freeze({
  doctor: { female: ['medical_female_02'], male: ['medical_male_03'], tint: TINT.none },
  nurse: { female: ['medical_female_01'], male: ['medical_male_04'], tint: TINT.both },
  pharmacist: { female: ['medical_female_01'], male: ['medical_male_04'], tint: TINT.bottom },
  radiographer: { female: ['medical_female_01'], male: ['medical_male_05'], tint: TINT.both },
  sonographer: { female: ['medical_female_01'], male: ['medical_male_04'], tint: TINT.both },
  paramedic: { female: ['medical_female_03'], male: ['medical_male_02'], tint: TINT.both },
  porter: { female: ['female_adult_17'], male: ['male_adult_08', 'male_adult_12'], tint: TINT.both },
  cleaner: { female: ['medical_female_01'], male: ['male_adult_12'], tint: TINT.both },
  receptionist: { female: ['business_female_02', 'female_adult_15'], male: ['male_adult_08'], tint: TINT.none },
  coordinator: { female: ['business_female_02', 'female_adult_15'], male: ['male_adult_08'], tint: TINT.none },
  host: { female: ['female_adult_17'], male: ['male_adult_12'], tint: TINT.top },
  // W4: lab coat over lavender scrubs
  labScientist: { female: ['medical_female_01'], male: ['medical_male_05'], tint: TINT.both },
  patient: GOWN,
  visitor: EVERYDAY,
})

/** The wardrobe of a person: their clothing class decides (outfit.ts clothesOf), then the role for a uniform. */
export function wardrobeFor(role: Role, outfit: Outfit | undefined): Wardrobe {
  const clothes = clothesOf(role, outfit)
  if (clothes === 'theatre') return THEATRE
  if (clothes === 'gown') return GOWN
  if (clothes === 'everyday') return EVERYDAY
  return UNIFORM[role]
}

/** Probability that a person of this crown height is drawn as a woman (taller people are more often men). */
export function femaleShare(height: number): number {
  return clamp((1.84 - height) / 0.18, 0.08, 0.92)
}

export interface AvatarKey {
  /** Entity id ('player' is the player). */
  id: string
  role: Role
  outfit?: Outfit
  /** The person's seed (outfit.ts seedFor(id, variant)) and crown height (heightFor). */
  seed: number
  height: number
  /**
   * How the person's given name reads (content/roster.ts `presentationOf`): 'female' and 'male' decide the body, 'either' (or nothing) leaves it to the
   * seeded draw.
   */
  presentation?: Presentation
}

/** What a person wears: the index into the loaded avatars (-1: the procedural body) and the tint bits that apply (TINT). */
export interface AvatarChoice {
  index: number
  tint: number
}

/**
 * The tint bits a wardrobe asks for that the avatar can carry: a garment it has (a reference luminance) that is not too dark (TINT_MIN_REF,
 * perceptual).
 */
export function tintFor(want: number, entry: Pick<AvatarEntry, 'tintRef'>): number {
  let t = 0
  if (want & TINT.top && entry.tintRef.top > 0 && perceptual(entry.tintRef.top) >= TINT_MIN_REF) t |= TINT.top
  if (want & TINT.bottom && entry.tintRef.bottom > 0 && perceptual(entry.tintRef.bottom) >= TINT_MIN_REF) t |= TINT.bottom
  return t
}

/**
 * Whether a person is drawn as a woman: their name decides when it reads one way, else the seeded draw by height (femaleShare). The draw is made
 * either way (`rnd(seed, 82)`), so a person keeps every other pick when only the name changes.
 */
export function drawnFemale(key: Pick<AvatarKey, 'seed' | 'height' | 'presentation'>): boolean {
  const draw = rnd(key.seed, 82) < femaleShare(key.height)
  return key.presentation === 'female' ? true : key.presentation === 'male' ? false : draw
}

/**
 * The avatar a person wears, deterministic in the key. The player wears PLAYER_AVATAR; everybody else draws from their wardrobe: gender by the given
 * name (`presentation`), or by height (femaleShare) when the name reads either way, then one of that gender's candidates. A candidate that is not
 * loaded is skipped; with none left, a person whose name decided keeps their gender (any loaded avatar of it, but the player's) before the other
 * gender's wardrobe is tried, and a person drawn by chance tries the other gender's wardrobe first. Nobody but the player ever wears PLAYER_AVATAR (and the
 * player wears it in every outfit but 'theatre').
 */
export function avatarFor(key: AvatarKey, avatars: readonly Pick<AvatarEntry, 'id' | 'gender' | 'tintRef'>[], out: AvatarChoice = { index: -1, tint: 0 }): AvatarChoice {
  out.index = -1
  out.tint = 0
  if (avatars.length === 0) return out
  const isPlayer = key.id === PLAYER_ID
  // you wear the all-white coat, except behind the lift cover on level 2: then the theatre scrubs (a man's, as your coat is)
  if (isPlayer && key.outfit !== 'theatre') {
    const i = avatars.findIndex((a) => a.id === PLAYER_AVATAR)
    if (i >= 0) {
      out.index = i
      return out
    }
  }
  const w = wardrobeFor(key.role, key.outfit)
  const female = isPlayer ? false : drawnFemale(key)
  const named = key.presentation === 'female' || key.presentation === 'male'
  const pick = (ids: readonly string[]): number => {
    let n = 0
    for (const id of ids) if (id !== PLAYER_AVATAR && avatars.some((a) => a.id === id)) n++
    if (n === 0) return -1
    let k = Math.min(n - 1, Math.floor(rnd(key.seed, 83) * n))
    for (const id of ids) {
      if (id === PLAYER_AVATAR) continue
      const i = avatars.findIndex((a) => a.id === id)
      if (i < 0) continue
      if (k-- === 0) return i
    }
    return -1
  }
  const sameGender = (): number => pick(avatars.filter((a) => a.gender === (female ? 'female' : 'male')).map((a) => a.id))
  let i = pick(female ? w.female : w.male)
  if (i < 0 && named) i = sameGender()
  if (i < 0) i = pick(female ? w.male : w.female)
  if (i < 0) i = sameGender()
  if (i < 0) i = pick(avatars.map((a) => a.id))
  if (i < 0) return out
  out.index = i
  out.tint = tintFor(w.tint, avatars[i])
  return out
}

/** Width factor of a person wearing an avatar: the mesh has its own build, so only a little variety (0.97 to 1.03). */
export function avatarBuild(seed: number): number {
  return 0.97 + rnd(seed, 84) * 0.06
}

// ---------------------------------------------------------------------------------------------
// Bind maths (3x4 row-major affine matrices, as in math.ts)
// ---------------------------------------------------------------------------------------------

/** Inverse of a rigid 3x4 matrix (rotation + translation): [R^T | -R^T t]. */
export function invertRigid(m: ArrayLike<number>, mo: number, out: Float64Array | Float32Array | number[], o: number): void {
  const r00 = m[mo]
  const r01 = m[mo + 1]
  const r02 = m[mo + 2]
  const tx = m[mo + 3]
  const r10 = m[mo + 4]
  const r11 = m[mo + 5]
  const r12 = m[mo + 6]
  const ty = m[mo + 7]
  const r20 = m[mo + 8]
  const r21 = m[mo + 9]
  const r22 = m[mo + 10]
  const tz = m[mo + 11]
  out[o] = r00
  out[o + 1] = r10
  out[o + 2] = r20
  out[o + 3] = -(r00 * tx + r10 * ty + r20 * tz)
  out[o + 4] = r01
  out[o + 5] = r11
  out[o + 6] = r21
  out[o + 7] = -(r01 * tx + r11 * ty + r21 * tz)
  out[o + 8] = r02
  out[o + 9] = r12
  out[o + 10] = r22
  out[o + 11] = -(r02 * tx + r12 * ty + r22 * tz)
}

const T = new Float64Array(12)

/**
 * For a person wearing an avatar: every skinned part's matrix in the pose row becomes M_p * B_p^-1, so the shader's linear-blend skinning
 * sum(w_p * row_p * v) moves the avatar's bind-pose vertex v with the part. `parts` is the part-matrix block of the row (PART_COUNT x 12 floats
 * at `o`), `bindInverse` the avatar's PART_COUNT x 12 floats. Allocates nothing.
 */
export function applyBinds(parts: Float32Array, o: number, bindInverse: ArrayLike<number>): void {
  for (let s = 0; s < SKINNED_PARTS.length; s++) {
    const p = SKINNED_PARTS[s]
    const a = o + p * 12
    const b = p * 12
    const a00 = parts[a]
    const a01 = parts[a + 1]
    const a02 = parts[a + 2]
    const a10 = parts[a + 4]
    const a11 = parts[a + 5]
    const a12 = parts[a + 6]
    const a20 = parts[a + 8]
    const a21 = parts[a + 9]
    const a22 = parts[a + 10]
    for (let c = 0; c < 4; c++) {
      const b0 = bindInverse[b + c]
      const b1 = bindInverse[b + 4 + c]
      const b2 = bindInverse[b + 8 + c]
      T[c] = a00 * b0 + a01 * b1 + a02 * b2
      T[4 + c] = a10 * b0 + a11 * b1 + a12 * b2
      T[8 + c] = a20 * b0 + a21 * b1 + a22 * b2
    }
    T[3] += parts[a + 3]
    T[7] += parts[a + 7]
    T[11] += parts[a + 11]
    for (let i = 0; i < 12; i++) parts[a + i] = T[i]
  }
}

/**
 * What the vertex shader does, on the CPU (for tests and the converter): blend the rows of up to four parts by weight and transform the point.
 * `rows` is a PART_COUNT x 12 block (already through applyBinds).
 */
export function skinPoint(rows: ArrayLike<number>, joints: ArrayLike<number>, weights: ArrayLike<number>, x: number, y: number, z: number, out: number[] = [0, 0, 0]): number[] {
  let ox = 0
  let oy = 0
  let oz = 0
  for (let i = 0; i < 4; i++) {
    const w = weights[i]
    if (!(w > 0)) continue
    const p = joints[i]
    if (p < 0 || p >= PART_COUNT) continue
    const r = p * 12
    ox += w * (rows[r] * x + rows[r + 1] * y + rows[r + 2] * z + rows[r + 3])
    oy += w * (rows[r + 4] * x + rows[r + 5] * y + rows[r + 6] * z + rows[r + 7])
    oz += w * (rows[r + 8] * x + rows[r + 9] * y + rows[r + 10] * z + rows[r + 11])
  }
  out[0] = ox
  out[1] = oy
  out[2] = oz
  return out
}
