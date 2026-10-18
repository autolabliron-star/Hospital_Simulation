// Template from Waltz City (src/scene/actors/crowd/lod.ts). Proven in production there; adjust the imports and names to your project.
/**
 * Level of detail by camera distance, cross-faded with dithered opacity so nothing pops.
 *
 * Three bodies draw the same skeleton:
 *   high  full segmented body up to 24 m, fading out over the next 8 m (about 2,000 triangles in the hospital: the W1 close-up
 *         head, hair, hands and staff details are for people the player walks among; at 30 m a person is 85 px tall at 1080p, and
 *         ears and fingers are below a pixel and no longer worth drawing).
 *   mid   the same segments with fewer facets (about 450 triangles) from 24 m out to 120 m. Every part
 *         is still there and still animated: this is the "full segmented body within 120 m".
 *   far   one rigid low-poly figure (about 60 triangles) beyond 120 m, cross-faded over 10 m.
 *
 * The cross-fade is not alpha blending (which would need sorting and break the depth buffer, shadows and
 * ambient occlusion). Each pixel of a person gets a stable noise value t in [0, 1); the pixel belongs to
 * the high body when t < c0, to the mid body when c0 <= t < c1 and to the far figure when c1 <= t < p,
 * where p is the person's presence (spawn and despawn fade) and c0 and c1 are the cumulative weights times
 * p. The three ranges tile [0, p) exactly, so at every pixel exactly one body is drawn: no holes, no
 * double coverage, and the coverage of each body follows its weight linearly with distance.
 */
export const LOD = {
  highEnd: 24,
  highBlend: 8,
  midEnd: 120,
  midBlend: 10,
} as const

/** The bands of one crowd's three bodies (LOD for the procedural bodies, AVATAR_LOD for the realistic people). */
export interface LodBands {
  readonly highEnd: number
  readonly highBlend: number
  readonly midEnd: number
  readonly midBlend: number
}

/**
 * W3 wave B: the realistic people (avatars.ts) switch to their 350-triangle far body from 60 m (cross-faded over 8 m), so the whole overview (the
 * camera is 80 to 110 m from the floor) draws one cheap skinned body per person. Their 4,000-triangle near body is for the people the player walks
 * among: out to 10 m, gone by 14 m (a person is about 150 px tall there at 1080p, and the 1,200-triangle mid body holds up from there on, faces
 * included), which keeps a crowded hall at eye level (200 people in the main building) within the 450k-triangle budget. The far body of an avatar is skinned and animated like the others (the procedural far
 * figure is a rigid statue, which is why the procedural bands keep their 120 m).
 */
export const AVATAR_LOD: LodBands = {
  highEnd: 10,
  highBlend: 4,
  midEnd: 60,
  midBlend: 8,
}

export interface LodWeights {
  high: number
  mid: number
  far: number
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Weights of the three bodies at camera distance `d` metres. They are in [0, 1], sum to 1 and are continuous in `d`. */
export function lodWeights(d: number, out: LodWeights = { high: 1, mid: 0, far: 0 }, bands: LodBands = LOD): LodWeights {
  const far = clamp01((d - bands.midEnd) / bands.midBlend)
  const high = 1 - clamp01((d - bands.highEnd) / bands.highBlend)
  out.high = high
  out.far = far
  out.mid = Math.max(0, 1 - high - far)
  return out
}

/**
 * The dither thresholds that go into the pose texture: [c0, c1, p]. The high body shows where t is in
 * [0, c0), the mid body in [c0, c1), the far figure in [c1, p).
 */
export function lodBounds(w: LodWeights, presence: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const p = clamp01(presence)
  out[0] = p * w.high
  out[1] = p * (w.high + w.mid)
  out[2] = p
  return out
}

/** The test the shaders apply per pixel: is the pixel with noise value `t` inside [lo, hi)? */
export function ditherVisible(t: number, lo: number, hi: number): boolean {
  return t >= lo && t < hi
}

/** Fraction of pixels each body covers, for a noise value that is uniform in [0, 1). */
export function coverage(bounds: readonly [number, number, number]): { high: number; mid: number; far: number } {
  return { high: bounds[0], mid: bounds[1] - bounds[0], far: bounds[2] - bounds[1] }
}

/**
 * Who casts into which sun-shadow cascade. The cascades are 0 to 30 m (2 cm texels), 30 to 100 m (8 cm) and
 * 100 m and beyond (26 cm), see SHADOW in fx/sky.ts. Drawing the visible bodies into all three would cost
 * three more passes over every person, so the shadow passes use their own two instanced lists (model.ts):
 *
 *   near  the mid body for people closer than `nearTo`, cascade 0 only. A person's shadow is a silhouette on
 *         the ground; the 450 triangle body is as good as the 1,200 triangle one at 2 cm texels.
 *   far   the 100 triangle figure for people farther than `farFrom`, cascades 1 and 2. At 8 cm texels a
 *         person is a dozen texels long, which that figure fills exactly.
 *
 * The ranges overlap (20 to 40 m) so the 12 % cross-fade between cascade 0 and 1 has a caster on both sides.
 */
export const SHADOW_RANGE = { nearTo: 40, farFrom: 20 } as const
