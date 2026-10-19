/**
 * How tall a person is drawn, and as a woman or a man: the same pure functions of the id the crowd renderer uses
 * (src/scene/actors/crowd/outfit.ts `heightFor`, avatars.ts `drawnFemale`), so a kiosk's ultrasonic height reading matches the body on the platform.
 *
 * The sim never imports scene code (the crowd modules pull in the pose rig), so the few lines are copied here. `body.test.ts` imports the real ones and
 * proves the copies agree to the last bit for many ids, so a change in the renderer fails a test here instead of showing a wrong number on a screen.
 */
import { presentationOf } from '@/content/roster'

/** The crown height of a relaxed standing nominal body: constants.ts STAND_CROWN from BODY (ankle, thigh + shin x LEG_RELAXED, hipDrop, waist, neck, crown). */
export const STAND_CROWN_M = 0.075 + (0.42 + 0.4) * 0.985 + 0.05 + 0.1 + 0.42 + 0.295

/** FNV-1a 32 bit hash of a string (crowd/math.ts hash32, also person.ts hashId). */
export function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Uniform [0, 1) value number `k` of the stream seeded by `h` (crowd/math.ts rnd). */
function rnd(h: number, k: number): number {
  let x = (h ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

/** Gaussian-ish value, mean 0, within [-1.5, 1.5] (crowd/math.ts rndSoft). */
function rndSoft(h: number, k: number): number {
  return rnd(h, k) + rnd(h, k + 977) + rnd(h, k + 1951) - 1.5
}

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)

/** The entity variant of an id (person.ts newEntity: hashId(id) % 1000). Every entity is built this way. */
export function variantOf(id: string): number {
  return hash32(id) % 1000
}

/** The crowd's seed of a person (outfit.ts seedFor). */
export function seedFor(id: string, variant: number): number {
  return ((hash32(id) ^ Math.imul(variant + 1, 0x85ebca6b)) >>> 0) || 1
}

/** Crown height in metres (outfit.ts heightFor): the nominal body scaled by 1 plus or minus 6 %. */
export function avatarCrownM(id: string, variant: number = variantOf(id)): number {
  const scale = 1 + clamp(rndSoft(seedFor(id, variant), 11) * 0.04, -0.06, 0.06)
  return STAND_CROWN_M * scale
}

/** Probability that a person of this crown height is drawn as a woman (avatars.ts femaleShare). */
function femaleShare(height: number): number {
  return clamp((1.84 - height) / 0.18, 0.08, 0.92)
}

/**
 * Is the person drawn as a woman (avatars.ts drawnFemale)? The given name decides when it reads one way; otherwise the seeded draw by height.
 * You ('player') wear PLAYER_AVATAR, a man.
 */
export function avatarIsFemale(id: string, name: string, variant: number = variantOf(id)): boolean {
  if (id === 'player') return false
  const presentation = presentationOf(name)
  if (presentation === 'female') return true
  if (presentation === 'male') return false
  return rnd(seedFor(id, variant), 82) < femaleShare(avatarCrownM(id, variant))
}
