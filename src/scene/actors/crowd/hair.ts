// W1 "Close-up people": the hair shapes. Waltz City's people had a tilted half ellipsoid for every style; these have a hairline.
/**
 * Hair is three rigid pieces on the head (the rig scales and places them, per style):
 *
 *   cap    a dome over the skull whose lower edge rides high on the forehead and low at the nape (`buildHairCap`), so there is a hairline
 *          above the brows and the ears show below it. The same dome serves the mid body (with fewer facets).
 *   back   a whole ellipsoid behind and beside the head: the nape of a short cut, a bob, long hair, a ponytail, a puff of curls
 *   front  a flattened ellipsoid on the forehead (the close-up body only): a straight fringe, a swept side lock, a few curls
 *
 * Six shapes (`HAIR_STYLES` in outfit.ts picks one per person from their id and variant, so a person never changes their hair):
 * crop, swept, bob, long, ponytail and curly. The colour comes from the person's palette (a handful of natural tones plus grey).
 *
 * Each entry is [rx, ry, rz, x, y, z, pitch, roll]: radii of the piece, its centre in the head's frame (origin: neck base), then a tilt
 * about X (positive nods forward) and about Z, all nominal metres and radians.
 */
import type { Builder } from './geometry'

export type HairStyle = 'crop' | 'swept' | 'bob' | 'long' | 'ponytail' | 'curly'
export const HAIR_SHAPES: readonly HairStyle[] = ['crop', 'swept', 'bob', 'long', 'ponytail', 'curly']

export type HairPiece = readonly [number, number, number, number, number, number, number, number]

export const HAIR_CAP: Record<HairStyle, HairPiece> = {
  // short cuts: a squatter dome set higher, so its edge runs above the ears and well up the back of the head
  crop: [0.104, 0.108, 0.125, 0, 0.2, 0.004, 0, 0],
  swept: [0.108, 0.115, 0.125, 0, 0.198, 0.004, 0, 0],
  // the dome tipped forward: its front edge comes down to the brows (a straight fringe) and its back edge rises off the nape
  bob: [0.11, 0.122, 0.126, 0, 0.19, 0.002, 0.24, 0],
  long: [0.11, 0.122, 0.126, 0, 0.19, 0.002, 0.24, 0],
  ponytail: [0.106, 0.112, 0.124, 0, 0.198, 0.004, 0, 0],
  curly: [0.125, 0.133, 0.131, 0, 0.2, 0, -0.1, 0],
}

export const HAIR_BACK: Record<HairStyle, HairPiece | null> = {
  crop: null,
  swept: [0.082, 0.06, 0.06, 0, 0.125, -0.055, 0, 0],
  bob: [0.12, 0.1, 0.1, 0, 0.115, -0.03, 0, 0],
  long: [0.12, 0.19, 0.09, 0, 0.04, -0.045, 0, 0],
  ponytail: [0.034, 0.11, 0.034, 0, 0.18, -0.115, 0.55, 0],
  curly: [0.125, 0.12, 0.11, 0, 0.15, -0.045, 0, 0],
}

export const HAIR_FRONT: Record<HairStyle, HairPiece | null> = {
  crop: null,
  swept: [0.072, 0.024, 0.022, 0.024, 0.256, 0.092, 0.25, -0.35],
  bob: null,
  long: null,
  ponytail: [0.06, 0.018, 0.018, 0.02, 0.262, 0.094, 0.2, -0.25],
  curly: [0.09, 0.028, 0.03, 0, 0.262, 0.09, 0.15, 0],
}

/**
 * The scalp dome: the upper part of a unit sphere in `rings` bands round `seg` facets. Its lower rim is at latitude
 * `-0.05 + 0.6 sin(theta)` in front and `-0.05 + 0.4 sin(theta)` behind: +0.55 rad over the forehead (theta = 90 degrees, +Z), -0.05 at
 * the ears, -0.45 at the nape.
 */
export function buildHairCap(b: Builder, part: number, slot: number, seg: number, rings: number): void {
  const rows: number[][] = []
  for (let i = 0; i < rings; i++) {
    const row: number[] = []
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2
      const sn = Math.sin(th)
      const rim = -0.05 + (sn > 0 ? 0.6 : 0.4) * sn
      const lat = rim + ((Math.PI / 2 - rim) * i) / rings
      const cl = Math.cos(lat)
      row.push(b.vertex(cl * Math.cos(th), Math.sin(lat), cl * Math.sin(th), part, slot))
    }
    rows.push(row)
  }
  const pole = b.vertex(0, 1, 0, part, slot)
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j < seg; j++) {
      const k = (j + 1) % seg
      b.tri(rows[i][j], rows[i][k], rows[i + 1][j], 0, 0, 0)
      b.tri(rows[i][k], rows[i + 1][k], rows[i + 1][j], 0, 0, 0)
    }
  }
  const top = rows[rows.length - 1]
  for (let j = 0; j < seg; j++) b.tri(top[j], top[(j + 1) % seg], pole, 0, 0, 0)
}
