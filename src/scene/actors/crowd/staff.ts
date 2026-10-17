// W1 "Close-up people": what staff wear on the chest, readable at 2 m. New for the hospital.
/**
 * Staff details of the close-up body, all decals that follow the chest's surface (the chest part, origin at the waist joint):
 *
 *   lanyard strap   a V of ribbon from the neck to the badge (the strap colour is the person's `lanyard`; it is invisible on people with none)
 *   badge           a card that hangs from the strap: a role-coloured band, a photo patch; on the player a bigger gold card with a dark "Y"
 *   stethoscope     (doctors) a tube that leaves the strap and a chest piece, dangling on the right of the chest
 *   dosimeter       (radiographers) an amber tag high on the right of the chest
 *   apron bib       (the ward host) the bib and neck straps of the apron, whose skirt hangs from the pelvis
 *
 * Every person carries all of them; the vertex stage hides the ones the person does not wear (their slot is a feature slot, see
 * FEATURE_FIRST in constants.ts and the bits of `texel gear` below), so the instancing stays one draw. No text is drawn: a badge is
 * colour (the role's) and shape; the player's is gold and large, with a "Y".
 */
import type { Builder } from './geometry'
import { FX, P, fixedSlot } from './constants'

/** Bits of the `flags` channel of the gear texel. */
export const GEAR_BIT = { stethoscope: 1, dosimeter: 2, bib: 4, glasses: 8 } as const

/** What the badge is. */
export const BADGE = { none: 0, staff: 1, you: 2 } as const
export type BadgeKind = (typeof BADGE)[keyof typeof BADGE]

/** A point on the chest surface: height above the waist joint, lateral fraction in [-1, 1], lift off the surface (metres). */
export type ChestAt = (y: number, u: number, lift: number) => number[]

/** Where the badge hangs (the top edge of the card), and the point the player's larger badge grows from. */
export const BADGE_TOP = 0.2
const F = (i: number): number => fixedSlot(i)

/** A quad on the chest between two heights; each edge has its own lateral range, `nu` columns so it follows the curve of the chest. */
function patch(b: Builder, at: ChestAt, slot: number, yb: number, ub: number, yt: number, ut: number, nu: number, lift: number, o: readonly [number, number, number], ubL = -ub, utL = -ut): void {
  for (let k = 0; k < nu; k++) {
    const f0 = k / nu
    const f1 = (k + 1) / nu
    const p0 = at(yb, ubL + (ub - ubL) * f0, lift)
    const p1 = at(yb, ubL + (ub - ubL) * f1, lift)
    const p2 = at(yt, utL + (ut - utL) * f1, lift)
    const p3 = at(yt, utL + (ut - utL) * f0, lift)
    b.quad(P.chest, slot, [p0, p1, p2, p3], o)
  }
}

/** A ribbon along a path of (height, lateral) points, `du` wide each side in lateral units. */
function ribbon(b: Builder, at: ChestAt, slot: number, path: readonly (readonly [number, number])[], du: number, lift: number, o: readonly [number, number, number]): void {
  for (let k = 0; k + 1 < path.length; k++) {
    const [y0, u0] = path[k]
    const [y1, u1] = path[k + 1]
    b.quad(P.chest, slot, [at(y0, u0 - du, lift), at(y1, u1 - du, lift), at(y1, u1 + du, lift), at(y0, u0 + du, lift)], o)
  }
}

export function buildStaffGear(b: Builder, at: ChestAt, strapSlot: number): void {
  const o: [number, number, number] = [0, 0.2, 0]
  // lanyard strap
  for (const sgn of [-1, 1]) {
    ribbon(b, at, strapSlot, [[0.41, sgn * 0.36], [0.355, sgn * 0.28], [0.285, sgn * 0.17], [BADGE_TOP + 0.005, sgn * 0.035]], 0.05, 0.0085, o)
  }
  // badge: card, band, photo, and the player's mark
  const top = BADGE_TOP
  const bottom = BADGE_TOP - 0.07
  const half = 0.15
  patch(b, at, F(FX.badgeCard), bottom, half, top, half, 1, 0.0095, o)
  patch(b, at, F(FX.badgeBand), top - 0.016, half, top, half, 1, 0.0102, o)
  patch(b, at, F(FX.badgePhoto), top - 0.056, 0.02, top - 0.024, 0.02, 1, 0.0102, o, -0.125, -0.125)
  // the "Y": two arms and a stem, in the ink colour
  const mark = F(FX.badgeMark)
  const arm = 0.03
  b.quad(P.chest, mark, [at(top - 0.021, -0.125, 0.0105), at(top - 0.021, -0.125 + arm, 0.0105), at(top - 0.039, arm * 0.5, 0.0105), at(top - 0.039, -arm * 0.5, 0.0105)], o)
  b.quad(P.chest, mark, [at(top - 0.021, 0.125 - arm, 0.0105), at(top - 0.021, 0.125, 0.0105), at(top - 0.039, arm * 0.5, 0.0105), at(top - 0.039, -arm * 0.5, 0.0105)], o)
  b.quad(P.chest, mark, [at(top - 0.039, -arm * 0.5, 0.0105), at(top - 0.039, arm * 0.5, 0.0105), at(top - 0.061, arm * 0.5, 0.0105), at(top - 0.061, -arm * 0.5, 0.0105)], o)

  // stethoscope: a tube from the left strand (the wearer's right) down to a chest piece
  ribbon(b, at, F(FX.stethTube), [[0.28, -0.2], [0.23, -0.34], [0.185, -0.44], [0.155, -0.46]], 0.032, 0.0088, o)
  {
    const cy = 0.128
    const cu = -0.46
    const r = 0.024
    const rx = at(cy, cu, 0.011)
    const ring: number[] = []
    for (let j = 0; j < 10; j++) {
      const th = (j / 10) * Math.PI * 2
      const p = at(cy + r * Math.sin(th), cu + (r * Math.cos(th)) / 0.17, 0.0105)
      ring.push(b.vertex(p[0], p[1], p[2], P.chest, F(FX.stethPiece)))
    }
    const c = b.vertex(rx[0], rx[1], rx[2], P.chest, F(FX.stethPiece))
    for (let j = 0; j < 10; j++) b.tri(c, ring[j], ring[(j + 1) % 10], o[0], o[1], o[2])
  }

  // dosimeter: a tag high on the wearer's right
  patch(b, at, F(FX.dosimeter), 0.258, -0.36, 0.313, -0.36, 1, 0.0088, o, -0.6, -0.6)

  // apron bib and its neck straps
  patch(b, at, F(FX.bib), 0.012, 0.6, 0.3, 0.4, 6, 0.0062, o)
  for (const sgn of [-1, 1]) ribbon(b, at, F(FX.bib), [[0.3, sgn * 0.37], [0.41, sgn * 0.3]], 0.04, 0.0066, o)
}
