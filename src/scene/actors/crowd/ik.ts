// Ported from Waltz City (src/scene/actors/crowd/ik.ts), unchanged.
/**
 * Two-bone leg IK. Given the hip joint and a target for the ankle it finds where the knee goes and
 * builds the thigh and shin matrices directly (no Euler angles, so no gimbal trouble and no blending of
 * rotations): the legs always reach exactly the planted foot, whatever the pelvis is doing.
 *
 * Part geometry convention: a thigh or shin hangs along -Y from its joint at the origin, so a matrix is
 * built from the limb's own frame: Y' = -(limb direction), X' = the knee hinge axis, Z' = X' x Y'.
 * The knee bends towards the "pole" (the direction the toes point): the shin swings backwards relative
 * to the thigh, as in a person.
 */
import { clamp, setRotYXZ, type Mat } from './math'

export interface LegResult {
  kneeX: number
  kneeY: number
  kneeZ: number
  /** The ankle the leg actually reaches (the target, unless it was out of reach). */
  ankleX: number
  ankleY: number
  ankleZ: number
  /** Hip-to-ankle distance over the fully stretched length: 1 means locked straight. */
  stretch: number
}

export function createLegResult(): LegResult {
  return { kneeX: 0, kneeY: 0, kneeZ: 0, ankleX: 0, ankleY: 0, ankleZ: 0, stretch: 0 }
}

/**
 * Solve one leg. Writes the thigh matrix at `out[o..o+12)` and the shin matrix at `out[o+12..o+24)`.
 * All points are in the same frame (the root frame of the person).
 * @param thigh thigh length, @param shin shin length
 * @param poleX,poleZ horizontal direction the knee points (need not be normalised)
 */
export function solveLeg(
  out: Mat,
  o: number,
  hx: number,
  hy: number,
  hz: number,
  ax: number,
  ay: number,
  az: number,
  poleX: number,
  poleZ: number,
  thigh: number,
  shin: number,
  res: LegResult,
): void {
  let dx = ax - hx
  let dy = ay - hy
  let dz = az - hz
  let len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (len < 1e-6) {
    dx = 0
    dy = -1
    dz = 0
    len = 1e-6
  }
  const ux = dx / len
  const uy = dy / len
  const uz = dz / len
  const reachMax = (thigh + shin) * 0.9995
  const reachMin = Math.abs(thigh - shin) + 1e-3
  const lc = clamp(len, reachMin, reachMax)
  const cosA = clamp((thigh * thigh + lc * lc - shin * shin) / (2 * thigh * lc), -1, 1)
  const sinA = Math.sqrt(1 - cosA * cosA)

  // pole direction made perpendicular to the hip-ankle line
  let px = poleX
  let py = 0
  let pz = poleZ
  let d = px * ux + py * uy + pz * uz
  px -= d * ux
  py -= d * uy
  pz -= d * uz
  let pl = Math.sqrt(px * px + py * py + pz * pz)
  if (pl < 1e-4) {
    // the leg points along the pole (straight forward kick): fall back to forward, then sideways
    px = 0
    py = 0
    pz = 1
    d = uz
    px -= d * ux
    py -= d * uy
    pz -= d * uz
    pl = Math.sqrt(px * px + py * py + pz * pz)
    if (pl < 1e-4) {
      px = 1
      py = 0
      pz = 0
      d = ux
      px -= d * ux
      py -= d * uy
      pz -= d * uz
      pl = Math.sqrt(px * px + py * py + pz * pz) || 1
    }
  }
  px /= pl
  py /= pl
  pz /= pl

  const kx = hx + thigh * (ux * cosA + px * sinA)
  const ky = hy + thigh * (uy * cosA + py * sinA)
  const kz = hz + thigh * (uz * cosA + pz * sinA)
  const tx = hx + ux * lc
  const ty = hy + uy * lc
  const tz = hz + uz * lc

  // limb directions
  const t0x = (kx - hx) / thigh
  const t0y = (ky - hy) / thigh
  const t0z = (kz - hz) / thigh
  const s0x = (tx - kx) / shin
  const s0y = (ty - ky) / shin
  const s0z = (tz - kz) / shin

  // knee hinge axis = pole x u (normalised): +X (the left) for a leg pointing down with the knee forward
  let xx = py * uz - pz * uy
  let xy = pz * ux - px * uz
  let xz = px * uy - py * ux
  const xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1
  xx /= xl
  xy /= xl
  xz /= xl

  writeLimb(out, o, xx, xy, xz, -t0x, -t0y, -t0z, hx, hy, hz)
  writeLimb(out, o + 12, xx, xy, xz, -s0x, -s0y, -s0z, kx, ky, kz)

  res.kneeX = kx
  res.kneeY = ky
  res.kneeZ = kz
  res.ankleX = tx
  res.ankleY = ty
  res.ankleZ = tz
  res.stretch = lc / (thigh + shin)
}

/** Matrix with columns X', Y', Z' = X' x Y' and translation (px, py, pz). */
function writeLimb(out: Mat, o: number, xx: number, xy: number, xz: number, yx: number, yy: number, yz: number, px: number, py: number, pz: number): void {
  const zx = xy * yz - xz * yy
  const zy = xz * yx - xx * yz
  const zz = xx * yy - xy * yx
  out[o] = xx
  out[o + 1] = yx
  out[o + 2] = zx
  out[o + 3] = px
  out[o + 4] = xy
  out[o + 5] = yy
  out[o + 6] = zy
  out[o + 7] = py
  out[o + 8] = xz
  out[o + 9] = yz
  out[o + 10] = zz
  out[o + 11] = pz
}

/** Foot matrix: origin at the ankle, heading `yaw` (in the same frame), toes pitched up by `pitch`. */
export function setFootMatrix(out: Mat, o: number, ax: number, ay: number, az: number, yaw: number, pitch: number): void {
  setRotYXZ(out, o, yaw, -pitch, 0)
  out[o + 3] = ax
  out[o + 7] = ay
  out[o + 11] = az
}
