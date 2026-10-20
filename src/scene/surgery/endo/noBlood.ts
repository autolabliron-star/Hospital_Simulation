/**
 * R3 (endoscope): the "no blood" guarantee. The endoscope picture is realistic but clean: tissue, fat, fascia and glistening serosa, never blood and never
 * a cut. Three things make that checkable:
 *
 *   tiers        a colour is tier A ("blood": a saturated red) or tier B ("deep red": a red that could read as blood in a small dark patch) or neither.
 *   safeTissue   runs on EVERY plate pixel as it is baked (plates.ts): it lifts a too-red colour's green and blue toward its red with a soft knee, so a
 *                plate pixel can never be tier A, and is not tier B either (green stays above 0.52 of red, with room for 8-bit rounding).
 *   bloodStats   measures an RGBA image: tier A and tier B counts, the tier-B blobs (4-connected) and the "slits" (thin, elongated dark-red blobs: what a
 *                cut would look like). The node tests run it on every baked plate; the browser probe runs it on the live picture.
 *
 * The thresholds are ratios to the red channel (a darker copy of the same colour is the same tier) above a floor of red 48, under which a pixel reads as
 * black-brown, not red.
 */

/** Below this red value a pixel reads as near black, whatever its hue. */
export const RED_FLOOR = 48

/** Tier A, blood: a saturated red. */
export function isTierA(r: number, g: number, b: number): boolean {
  return r >= RED_FLOOR && g < 0.4 * r && b < 0.45 * r
}

/** Tier B, deep red: a red that could read as blood in a small dark patch (and is not already tier A). */
export function isTierB(r: number, g: number, b: number): boolean {
  return r >= RED_FLOOR && g < 0.5 * r && b < 0.55 * r && !isTierA(r, g, b)
}

/** The old R2 painter rule, still kept for every colour a painter uses: strong red with little green and blue. */
export function isRedSaturated(r: number, g: number, b: number): boolean {
  return r > 110 && g < r * 0.4 && b < r * 0.4
}

/** The ratios safeTissue keeps green and blue above (of red), and where its soft knee starts. */
export const SAFE = { g: 0.52, gKnee: 0.6, gFrom: 0.36, b: 0.47, bKnee: 0.55, bFrom: 0.3 } as const

/** A colour, 0..255 floats. */
export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * Make a tissue colour safe, in place: a red's green is lifted to at least 0.52 of its red and its blue to at least 0.47, with a soft knee (a ratio above
 * the knee is left alone, one below is compressed toward the floor), so reds turn brown, salmon or mauve instead of blood red. A colour whose green is
 * already 0.6 of its red or more (yellow, pink, white) passes unchanged.
 */
export function safeTissue(c: Rgb): Rgb {
  const r = c.r
  if (r <= 0) return c
  const kg = c.g / r
  // only a red (green well under red) is touched: yellows, pinks and whites keep their blue
  if (kg >= SAFE.gKnee) return c
  c.g = r * (kg <= SAFE.gFrom ? SAFE.g : SAFE.g + ((kg - SAFE.gFrom) / (SAFE.gKnee - SAFE.gFrom)) * (SAFE.gKnee - SAFE.g))
  const kb = c.b / r
  if (kb < SAFE.bKnee) c.b = r * (kb <= SAFE.bFrom ? SAFE.b : SAFE.b + ((kb - SAFE.bFrom) / (SAFE.bKnee - SAFE.bFrom)) * (SAFE.bKnee - SAFE.b))
  return c
}

export interface BloodStats {
  pixels: number
  tierA: number
  tierB: number
  /** tierB / pixels. */
  tierBShare: number
  /** 4-connected tier-B blobs, and the biggest one's size in pixels. */
  blobs: number
  biggestBlob: number
  /** Thin elongated dark-red blobs (tier A or B, darker than `DARK`): length at least `SLIT.length` px and at least `SLIT.elongation` times its width. */
  slits: number
}

/** A dark red: its luminance (0..255) is under this. */
export const DARK = 110
export const SLIT = { length: 8, elongation: 4 } as const

/** Measure an RGBA image (alpha is ignored: the plates are opaque). */
export function bloodStats(rgba: ArrayLike<number>, w: number, h: number): BloodStats {
  const n = w * h
  const maskB = new Uint8Array(n)
  const maskDark = new Uint8Array(n)
  let tierA = 0
  let tierB = 0
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    const a = isTierA(r, g, b)
    const bb = isTierB(r, g, b)
    if (a) tierA++
    if (bb) {
      tierB++
      maskB[i] = 1
    }
    if ((a || bb) && 0.299 * r + 0.587 * g + 0.114 * b < DARK) maskDark[i] = 1
  }
  const blobsB = components(maskB, w, h)
  const dark = components(maskDark, w, h)
  return { pixels: n, tierA, tierB, tierBShare: tierB / n, blobs: blobsB.count, biggestBlob: blobsB.biggest, slits: dark.slits }
}

/** 4-connected components of a mask: how many, the biggest, and how many are slits (second moments: the long axis over the short one). */
export function components(mask: Uint8Array, w: number, h: number): { count: number; biggest: number; slits: number } {
  const seen = new Uint8Array(mask.length)
  const stack = new Int32Array(mask.length)
  let count = 0
  let biggest = 0
  let slits = 0
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    count++
    let top = 0
    stack[top++] = start
    seen[start] = 1
    let area = 0
    let sx = 0
    let sy = 0
    let sxx = 0
    let syy = 0
    let sxy = 0
    while (top > 0) {
      const i = stack[--top]
      const x = i % w
      const y = (i - x) / w
      area++
      sx += x
      sy += y
      sxx += x * x
      syy += y * y
      sxy += x * y
      if (x > 0 && mask[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), (stack[top++] = i - 1)
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), (stack[top++] = i + 1)
      if (y > 0 && mask[i - w] && !seen[i - w]) (seen[i - w] = 1), (stack[top++] = i - w)
      if (y < h - 1 && mask[i + w] && !seen[i + w]) (seen[i + w] = 1), (stack[top++] = i + w)
    }
    if (area > biggest) biggest = area
    if (area >= 4) {
      const mx = sx / area
      const my = sy / area
      // the covariance of a pixel blob (+1/12 per axis for the pixel's own extent)
      const cxx = sxx / area - mx * mx + 1 / 12
      const cyy = syy / area - my * my + 1 / 12
      const cxy = sxy / area - mx * my
      const tr = cxx + cyy
      const det = cxx * cyy - cxy * cxy
      const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
      const l1 = tr / 2 + disc
      const l2 = Math.max(1e-6, tr / 2 - disc)
      // a uniform bar of length L has variance L^2 / 12 along it
      const length = Math.sqrt(12 * l1)
      if (length >= SLIT.length && Math.sqrt(l1 / l2) >= SLIT.elongation) slits++
    }
  }
  return { count, biggest, slits }
}
