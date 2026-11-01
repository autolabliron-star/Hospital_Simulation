/**
 * R5: sterile attire (`Entity.attire`, ATTIRE in sim/types.ts: mask 1, gown 2, gloves 4, lead apron 8) on the crowd's people, with no draw of its own for
 * the gloves, the sleeves and the lead apron and one each for the masks and the gown skirts:
 *
 *   gown     the top, front, sleeve, accent and coat slots of the person's palette take the gown blue (writeAttire); the procedural body's skirt piece
 *            hangs to mid-calf (rig.ts SURGICAL_GOWN_OVERLAY); a realistic avatar's top garment and arms are repainted in it by its shader and the GOWN
 *            skirt mesh below (props material, kind GOWN_KIND) hangs from its skirt frame
 *   gloves   a realistic avatar's hands are tinted cream latex by its shader (FX.glove); the procedural body has no separate hand colour (gown only)
 *   mask     a realistic avatar wears the pleated MASK mesh below (props material, kind MASK_KIND) on its face fit (avatars.ts measureFaceFit), framed
 *            on the head by the model (MASK_FRAME); the procedural fallback body wears none
 *   lead     the procedural body's top and front slots take the lead apron's navy (the CT suite); a realistic avatar's shader paints the navy over the front of its
 *            torso (the apron wraps the front and a little of the sides), the scrubs keep their colour behind and in the sleeves. The gown wins over the lead apron.
 *
 * The attire bits ride the gear texel's z (TEX.gear) for the avatar shader. Nothing here allocates per frame: writeAttire runs only when a person's bits
 * change, and the colours are converted once.
 */
import { BufferGeometry, InstancedBufferGeometry } from 'three'
import { ATTIRE } from '@/sim/types'
import { FIXED_COLORS, FX, GOWN_KIND, MASK_KIND, ROW_FLOATS, SLOT, TEX, fixedSlot } from './constants'
import { Builder } from './geometry'
import type { Look } from './outfit'
import { MASK_BAND as FACE_BAND } from './avatars'

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const LINEAR = new Map<string, Float32Array>()
/** A colour's linear RGB (cached: converted once per colour). */
function linear(hex: string): Float32Array {
  let v = LINEAR.get(hex)
  if (!v) {
    const n = parseInt(hex.slice(1), 16)
    v = Float32Array.of(srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255))
    LINEAR.set(hex, v)
  }
  return v
}

/** The gown and the lead apron colours (sRGB hex). */
export const GOWN_COLOR = FIXED_COLORS[FX.gown]
export const LEAD_COLOR = FIXED_COLORS[FX.lead]
export const GLOVE_COLOR = FIXED_COLORS[FX.glove]

function putSlot(data: Float32Array, o: number, slot: number, hex: string): void {
  const c = linear(hex)
  const b = o + (TEX.palette + slot) * 4
  data[b] = c[0]
  data[b + 1] = c[1]
  data[b + 2] = c[2]
  data[b + 3] = 1
}

/**
 * Write a person's attire into their row of the pose texture: the palette slots the gown or the lead apron covers (or the look's own colours again when it
 * is taken off) and the attire bits (gear texel z). Call it when the bits change and after the look is rewritten. R5 wave 3: a realistic avatar's lead apron is drawn
 * by its shader over the FRONT of the torso only (in the navy it carries itself: the scrubs keep their colour at the back and in the sleeves), so for an avatar
 * (`avatar` true) the palette keeps the look's own top and front colours.
 */
export function writeAttire(data: Float32Array, row: number, look: Look, bits: number, avatar = false): void {
  const o = row * ROW_FLOATS
  const gown = (bits & ATTIRE.gown) !== 0
  const lead = !avatar && !gown && (bits & ATTIRE.lead) !== 0
  putSlot(data, o, SLOT.top, gown ? GOWN_COLOR : lead ? LEAD_COLOR : look.top)
  putSlot(data, o, SLOT.front, gown ? GOWN_COLOR : lead ? LEAD_COLOR : look.front)
  putSlot(data, o, SLOT.sleeve, gown ? GOWN_COLOR : look.sleeve)
  putSlot(data, o, SLOT.accent, gown ? GOWN_COLOR : look.accent)
  putSlot(data, o, SLOT.coat, gown ? GOWN_COLOR : look.coat)
  data[o + TEX.gear * 4 + 2] = bits
}

// ---------------------------------------------------------------------------------------------
// The mask: a pleated shell over the front of the unit sphere (the face fit maps it onto the face), with ties
// ---------------------------------------------------------------------------------------------

/**
 * The mask's extent on the unit sphere of the face fit: azimuth +-theta round the front (+Z), elevation +-phi (radians); the fit (avatars.ts measureFaceFit)
 * puts the band's top edge on the bridge of the nose, its bottom edge under the chin and its side edges on the cheeks.
 */
export const MASK_BAND = { theta: FACE_BAND.theta, phi: FACE_BAND.phi, phiLow: FACE_BAND.phiLow, top: FACE_BAND.top, cols: 8, rows: 6, pleat: 0.035, inner: 0.965 } as const

export interface AttireGeometry {
  geometry: InstancedBufferGeometry
  total: number
}

function toInstanced(src: BufferGeometry): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry()
  g.index = src.index
  g.setAttribute('position', src.getAttribute('position'))
  g.setAttribute('normal', src.getAttribute('normal'))
  g.setAttribute('aPart', src.getAttribute('aPart'))
  g.instanceCount = 0
  return g
}

/** The radius of the mask's shell at a row (1 on the face fit; the pleats stand out a little). */
export function maskRadius(row: number): number {
  return 1 + (row % 2 === 1 ? MASK_BAND.pleat : 0)
}

/** A point of the mask's outer shell (unit fit space) at a column and row of its grid. */
export function maskPoint(col: number, row: number, scale = 1): [number, number, number] {
  const th = -MASK_BAND.theta + (2 * MASK_BAND.theta * col) / MASK_BAND.cols
  const ph = -MASK_BAND.phiLow + ((MASK_BAND.phi + MASK_BAND.phiLow) * row) / MASK_BAND.rows
  const r = maskRadius(row) * scale
  // (the upper half is `top` times as tall: avatars.ts MASK_BAND)
  return [Math.sin(th) * Math.cos(ph) * r, Math.sin(ph) * r * (ph > 0 ? MASK_BAND.top : 1), Math.cos(th) * Math.cos(ph) * r]
}

function mask(b: Builder): void {
  const slot = fixedSlot(FX.mask)
  const { cols, rows } = MASK_BAND
  for (const shell of [1, MASK_BAND.inner]) {
    const grid: number[][] = []
    for (let i = 0; i <= rows; i++) {
      const row: number[] = []
      for (let j = 0; j <= cols; j++) {
        const p = maskPoint(j, i, shell)
        row.push(b.vertex(p[0], p[1], p[2], MASK_KIND, slot))
      }
      grid.push(row)
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = grid[i][j]
        const c = grid[i][j + 1]
        const d = grid[i + 1][j]
        const e = grid[i + 1][j + 1]
        if (shell === 1) {
          // the outer shell faces away from the centre
          b.tri(a, c, d, 0, 0, 0)
          b.tri(c, e, d, 0, 0, 0)
        } else {
          // the inner one faces the face: away from a point far out along its own direction
          const p = maskPoint(j + 0.5, i + 0.5, 4)
          b.tri(a, c, d, p[0], p[1], p[2])
          b.tri(c, e, d, p[0], p[1], p[2])
        }
      }
    }
  }
  // four short ties from the side edges back towards the ears (both faces; the fit's depth is about the face's, so they end by the cheeks)
  for (const sx of [-1, 1]) {
    for (const row of [1, rows - 1]) {
      const e = maskPoint(sx < 0 ? 0 : cols, row)
      const y = e[1]
      const w = 0.05
      const back: [number, number, number] = [sx * 1.04, y * 0.85, -0.45]
      const q = [
        b.vertex(e[0], y - w, e[2], MASK_KIND, slot),
        b.vertex(e[0], y + w, e[2], MASK_KIND, slot),
        b.vertex(back[0], back[1] + w, back[2], MASK_KIND, slot),
        b.vertex(back[0], back[1] - w, back[2], MASK_KIND, slot),
      ]
      b.tri(q[0], q[1], q[2], 0, 0, -0.8)
      b.tri(q[0], q[2], q[3], 0, 0, -0.8)
      b.tri(q[0], q[1], q[2], sx * 4, 0, -0.8)
      b.tri(q[0], q[2], q[3], sx * 4, 0, -0.8)
    }
  }
}

/** The surgical masks of the realistic people (kind MASK_KIND), for the mask mesh of crowdRig.ts attachPeople. */
export function buildMaskGeometry(): AttireGeometry {
  const b = new Builder()
  mask(b)
  return { geometry: toInstanced(b.build()), total: b.triangles }
}

// ---------------------------------------------------------------------------------------------
// The gown's skirt over a realistic avatar: a flared tube on the skirt frame (origin the pelvis centre; the rig scales it by SURGICAL_GOWN_OVERLAY)
// ---------------------------------------------------------------------------------------------

/** Its rings: height on the skirt frame (y = -0.38 is the hem at an overlay length of 1), half width (x), half depth (z). */
export const GOWN_RINGS: readonly (readonly [number, number, number])[] = [
  [0.07, 0.155, 0.12],
  [-0.1, 0.18, 0.145],
  [-0.26, 0.2, 0.175],
  [-0.38, 0.22, 0.2],
]
export const GOWN_SEG = 12

function gown(b: Builder): void {
  const slot = fixedSlot(FX.gown)
  for (const shell of [1, 0.97]) {
    const rows: number[][] = []
    for (const [t, rx, rz] of GOWN_RINGS) {
      const row: number[] = []
      for (let j = 0; j < GOWN_SEG; j++) {
        const th = (j / GOWN_SEG) * Math.PI * 2
        row.push(b.vertex(Math.cos(th) * rx * shell, t, Math.sin(th) * rz * shell, GOWN_KIND, slot))
      }
      rows.push(row)
    }
    for (let i = 0; i + 1 < rows.length; i++) {
      const y = (GOWN_RINGS[i][0] + GOWN_RINGS[i + 1][0]) / 2
      for (let j = 0; j < GOWN_SEG; j++) {
        const n = (j + 1) % GOWN_SEG
        if (shell === 1) {
          b.tri(rows[i][j], rows[i][n], rows[i + 1][j], 0, y, 0)
          b.tri(rows[i][n], rows[i + 1][n], rows[i + 1][j], 0, y, 0)
        } else {
          const th = ((j + 0.5) / GOWN_SEG) * Math.PI * 2
          const ox = Math.cos(th) * 3
          const oz = Math.sin(th) * 3
          b.tri(rows[i][j], rows[i][n], rows[i + 1][j], ox, y, oz)
          b.tri(rows[i][n], rows[i + 1][n], rows[i + 1][j], ox, y, oz)
        }
      }
    }
  }
}

/** The gown skirts of the realistic people (kind GOWN_KIND), for the gown mesh of crowdRig.ts attachPeople. */
export function buildGownGeometry(): AttireGeometry {
  const b = new Builder()
  gown(b)
  return { geometry: toInstanced(b.build()), total: b.triangles }
}
