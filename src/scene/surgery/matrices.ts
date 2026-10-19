/**
 * R2 (agent O): writing instance matrices straight into an InstancedMesh's Float32Array, with no Matrix4, Vector3 or Quaternion in sight, so the rig's frame
 * callback allocates nothing. Every function takes the array and the instance index; sizes are the unit geometry's scale (a unit box 1 x 1 x 1, a unit
 * cylinder of diameter 1 and height 1 along y).
 */

/** Collapse instance `i`: an all-zero matrix draws nothing. */
export function hideInstance(a: Float32Array, i: number): void {
  a.fill(0, i * 16, i * 16 + 16)
}

/** Write a matrix from three column vectors (already scaled) and a translation. */
function put(a: Float32Array, i: number, xx: number, xy: number, xz: number, yx: number, yy: number, yz: number, zx: number, zy: number, zz: number, px: number, py: number, pz: number): void {
  const o = i * 16
  a[o] = xx
  a[o + 1] = xy
  a[o + 2] = xz
  a[o + 3] = 0
  a[o + 4] = yx
  a[o + 5] = yy
  a[o + 6] = yz
  a[o + 7] = 0
  a[o + 8] = zx
  a[o + 9] = zy
  a[o + 10] = zz
  a[o + 11] = 0
  a[o + 12] = px
  a[o + 13] = py
  a[o + 14] = pz
  a[o + 15] = 1
}

/** A box (or cylinder) centred at (x, y, z), turned `h` about y (0 faces +z), with sizes `sx` (its left), `sy` (up) and `sz` (ahead). */
export function putYawed(a: Float32Array, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, h: number): void {
  const c = Math.cos(h)
  const s = Math.sin(h)
  // local +x -> (cos, 0, -sin), +y -> up, +z -> (sin, 0, cos)
  put(a, i, c * sx, 0, -s * sx, 0, sy, 0, s * sz, 0, c * sz, x, y, z)
}

/**
 * A segment from A to B: the shape's local y runs from A to B (its length is |AB|), its local x is as near to the hint (hx, hy, hz) as it can be, and its
 * two other sizes are `sx` (along the hint) and `sz`. A degenerate segment hides the instance. For a cylinder (turned about its own axis the same
 * either way) the hint only has to be any direction that is not along AB.
 */
export function putSegment(a: Float32Array, i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, sx: number, sz: number, hx: number, hy: number, hz: number): void {
  let dx = bx - ax
  let dy = by - ay
  let dz = bz - az
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (len < 1e-5) {
    hideInstance(a, i)
    return
  }
  dx /= len
  dy /= len
  dz /= len
  // x = hint minus its part along the axis
  let kx = hx - (hx * dx + hy * dy + hz * dz) * dx
  let ky = hy - (hx * dx + hy * dy + hz * dz) * dy
  let kz = hz - (hx * dx + hy * dy + hz * dz) * dz
  let kl = Math.sqrt(kx * kx + ky * ky + kz * kz)
  if (kl < 1e-4) {
    // the hint ran along the axis: any perpendicular will do
    kx = dy
    ky = -dx
    kz = 0
    kl = Math.sqrt(kx * kx + ky * ky)
    if (kl < 1e-4) {
      kx = 1
      ky = 0
      kz = 0
      kl = 1
    }
  }
  kx /= kl
  ky /= kl
  kz /= kl
  // z = x cross y, so the three are a right-handed set
  const zx = ky * dz - kz * dy
  const zy = kz * dx - kx * dz
  const zz = kx * dy - ky * dx
  put(a, i, kx * sx, ky * sx, kz * sx, dx * len, dy * len, dz * len, zx * sz, zy * sz, zz * sz, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
}

/** The same, for the part of a segment from A that reaches `k` (0..1) of the way to B (a drape sleeve sliding over a link); k <= 0 hides it. */
export function putSegmentPart(a: Float32Array, i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, k: number, sx: number, sz: number, hx: number, hy: number, hz: number): void {
  if (k <= 0.001) {
    hideInstance(a, i)
    return
  }
  const u = k > 1 ? 1 : k
  putSegment(a, i, ax, ay, az, ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u, sx, sz, hx, hy, hz)
}
