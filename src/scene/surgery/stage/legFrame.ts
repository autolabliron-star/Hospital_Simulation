/**
 * R5 wave 2 (agent H): the frame of a leg-sleeve ring. A ring's plane is perpendicular to the leg's axis `T` = (tx, th, td) (the table's x, h and d). Its two in-plane axes:
 * `u` the horizontal one that points across (+x, outward, for an axis that runs toward the feet) and `v = T x u` (up for such an axis), so (u, v, T) turn the same way as
 * (x, h, d) and a ring of a straight leg along +d is the plane of constant d, bin 0 pointing outward, bin 4 of 16 up. `stage.generate.test.ts` (which measures the radii in these
 * frames), legs.ts (which builds the rings in them) and the tests share this one function.
 */

/** Write `u` (out[0..2]) and `v` (out[3..5]) for the axis (tx, th, td), in (x, h, d) order. The axis must not run straight up or down. */
export function ringFrameInto(tx: number, th: number, td: number, out: Float64Array): void {
  const n = Math.sqrt(td * td + tx * tx)
  const ux = td / n
  const ud = -tx / n
  out[0] = ux
  out[1] = 0
  out[2] = ud
  // v = T x u
  out[3] = th * ud - td * 0
  out[4] = td * ux - tx * ud
  out[5] = tx * 0 - th * ux
}
