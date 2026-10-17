// W1 "Close-up people": the head the player sees at 1 to 4 m. New for the hospital (Waltz City's people never came this close).
/**
 * The close-up head. Only the high body (under about 24 m) has it; the mid body keeps its plain ellipsoid head.
 *
 * Everything is geometry in the head's frame (origin: the neck base, +Y up, +Z forward, nominal metres) and the vertex stage moves it:
 *
 *   skull      a loft with a jaw and a chin (HEAD_RINGS), 16 facets round, so the silhouette is round at 1.5 m
 *   eyes       a flat white dome (sclera) and a dark disc (iris) in front of it. The iris slides over the white towards the gaze (texel
 *              `face`, set from the head look-at in look.ts), the pair of eyes squashes shut in a blink
 *   brows      a tapered ribbon on each side. They lift a little when the person is happy and tilt their inner ends up when unwell
 *   mouth      one ribbon. The corners rise for a slight smile and fall for a small frown; it opens a little while the person talks
 *   nose, ears, glasses (a frame ribbon that is hidden on everybody who wears none)
 *
 * No textures: the brows take the person's hair colour, the mouth takes their skin, darker and redder (shaders.ts).
 *
 * The numbers here (FACE) are shared by the geometry and by the shader source, so what is built is what is moved. `faceZ` gives the skin's
 * depth at a point of the face for building things that sit on it; the shader keeps features on the skin with a constant slope per feature.
 */
import type { Builder, Ring } from './geometry'
import { FX, P, SLOT, fixedSlot } from './constants'
import { clamp, rnd } from './math'

/** The skull from the chin up: rings of the loft (t = height above the neck base). */
export const HEAD_RINGS: readonly Ring[] = [
  { t: 0.06, rx: 0, rz: 0, cz: 0.04 },
  { t: 0.066, rx: 0.024, rz: 0.036, cz: 0.044 },
  { t: 0.082, rx: 0.044, rz: 0.058, cz: 0.044 },
  { t: 0.104, rx: 0.062, rz: 0.076, cz: 0.038 },
  { t: 0.13, rx: 0.076, rz: 0.091, cz: 0.028 },
  { t: 0.158, rx: 0.085, rz: 0.1, cz: 0.021 },
  { t: 0.186, rx: 0.091, rz: 0.106, cz: 0.016 },
  { t: 0.212, rx: 0.0935, rz: 0.108, cz: 0.012 },
  { t: 0.24, rx: 0.088, rz: 0.102, cz: 0.006 },
  { t: 0.265, rx: 0.072, rz: 0.086, cz: 0 },
  { t: 0.284, rx: 0.042, rz: 0.052, cz: -0.002 },
  { t: 0.294, rx: 0, rz: 0, cz: -0.002 },
]

/** The neck under the head (the high body): it tapers up into the skull so no rim shows under the jaw. */
export const NECK_RINGS: readonly Ring[] = [
  { t: -0.035, rx: 0, rz: 0 },
  { t: -0.03, rx: 0.046, rz: 0.046 },
  { t: 0.03, rx: 0.041, rz: 0.042 },
  { t: 0.08, rx: 0.037, rz: 0.036, cz: -0.004 },
  { t: 0.12, rx: 0.03, rz: 0.03 },
]

export const FACE = {
  /** Eye centre: half the distance between the eyes, and height. */
  eyeX: 0.037,
  eyeY: 0.19,
  /** The white of the eye: half extents of its outline. */
  scleraX: 0.0148,
  scleraY: 0.0092,
  irisR: 0.0073,
  /** How far the iris travels at full gaze (metres), and the gaze angles (radians) that count as full. */
  gazeX: 0.0058,
  gazeY: 0.003,
  gazeYaw: 0.55,
  gazePitch: 0.45,
  /** Slope of the skin's depth across the eye (dz/dx at the eye's own side), so a sliding iris stays on the eyeball. */
  eyeSlope: 0.5,
  /** How far a blink squashes the eye (0.88: nearly shut). */
  blinkClose: 0.88,
  browY: 0.218,
  browIn: 0.016,
  browOut: 0.06,
  mouthY: 0.112,
  mouthHalf: 0.027,
  /** Corner lift of a full smile and drop of a full frown (metres), and how far the open mouth drops its lower edge. */
  smileLift: 0.0065,
  frownDrop: 0.0045,
  mouthOpen: 0.0065,
  /** Brow lift of a smile, inner-end lift of a frown (metres), and the slope of the skin's depth over the brow (dz/dy). */
  browLift: 0.0035,
  browWorry: 0.0075,
  browSlope: -0.4,
  /** The lines of the face (brows, mouth, glasses frames) melt into the skin between these camera distances (metres): under a pixel thick beyond. */
  fadeFrom: 4.5,
  fadeTo: 9,
} as const

const F = (i: number): number => fixedSlot(i)

/** Ring of the skull at height y: interpolated between the table's rings. */
export function headAt(y: number): { rx: number; rz: number; cz: number } {
  const r = HEAD_RINGS
  let i = 0
  while (i < r.length - 2 && r[i + 1].t < y) i++
  const a = r[i]
  const b = r[i + 1]
  const k = clamp((y - a.t) / (b.t - a.t), 0, 1)
  return { rx: a.rx + (b.rx - a.rx) * k, rz: a.rz + (b.rz - a.rz) * k, cz: (a.cz ?? 0) + ((b.cz ?? 0) - (a.cz ?? 0)) * k }
}

/** Depth (z) of the skin in front of the head at lateral position x and height y: the loft's ring ellipse at that height. */
export function faceZ(x: number, y: number): number {
  const h = headAt(y)
  const u = h.rx > 1e-6 ? x / h.rx : 0
  return h.cz + h.rz * Math.sqrt(Math.max(0, 1 - u * u))
}

/** The skull, the neck, ears, nose, eyes, brows and mouth, all in the head part. */
export function buildHead(b: Builder, seg: number): void {
  b.loft(P.head, 'y', [...NECK_RINGS], 6, SLOT.skin)
  b.loft(P.head, 'y', [...HEAD_RINGS], seg, SLOT.skin)
  const o: [number, number, number] = [0, 0.18, 0.01]
  // ears
  for (const sx of [-1, 1]) b.ellipsoid(P.head, SLOT.skin, [sx * 0.0915, 0.168, -0.003], [0.0115, 0.027, 0.0185], 6, 3)
  // nose: a short loft down the bridge, bulging at the tip
  const nose = (t: number, rx: number, rz: number, protrude: number): Ring => ({ t, rx, rz, cz: faceZ(0, t) + protrude - rz })
  b.loft(P.head, 'y', [{ t: 0.198, rx: 0, rz: 0, cz: faceZ(0, 0.198) + 0.002 }, nose(0.18, 0.0075, 0.0085, 0.006), nose(0.16, 0.0105, 0.0145, 0.0155), nose(0.146, 0.012, 0.013, 0.013), { t: 0.14, rx: 0, rz: 0, cz: faceZ(0, 0.14) + 0.008 }], 5, SLOT.skin)
  // eyes
  for (const sx of [-1, 1]) eye(b, sx)
  // brows
  for (const sx of [-1, 1]) brow(b, sx, o)
  mouth(b, o)
}

/** One eye: a white dome that follows the skin (so it sits right on the slanted side of the face) and an iris disc on it. */
function eye(b: Builder, side: number): void {
  const cx = side * FACE.eyeX
  const cy = FACE.eyeY
  const n = 8
  const o: [number, number, number] = [cx, cy, faceZ(cx, cy) - 0.02]
  const ringAt = (k: number, lift: number, slot: number): number[] => {
    const row: number[] = []
    for (let j = 0; j < n; j++) {
      const th = (j / n) * Math.PI * 2
      const x = cx + FACE.scleraX * k * Math.cos(th)
      const y = cy + FACE.scleraY * k * Math.sin(th)
      row.push(b.vertex(x, y, faceZ(x, y) + lift, P.head, slot))
    }
    return row
  }
  const slot = F(FX.sclera)
  const r0 = ringAt(1, 0.0006, slot)
  const r1 = ringAt(0.62, 0.003, slot)
  const top = b.vertex(cx, cy, faceZ(cx, cy) + 0.0038, P.head, slot)
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n
    b.tri(r0[j], r0[k], r1[j], o[0], o[1], o[2])
    b.tri(r0[k], r1[k], r1[j], o[0], o[1], o[2])
    b.tri(r1[j], r1[k], top, o[0], o[1], o[2])
  }
  // iris: a slightly domed disc in front of the white
  const ir = F(FX.eye)
  const lift = 0.0042
  const iris = b.vertex(cx, cy, faceZ(cx, cy) + lift + 0.0009, P.head, ir)
  const ring: number[] = []
  for (let j = 0; j < n; j++) {
    const th = (j / n) * Math.PI * 2
    const x = cx + FACE.irisR * Math.cos(th)
    const y = cy + FACE.irisR * Math.sin(th)
    ring.push(b.vertex(x, y, faceZ(x, y) + lift, P.head, ir))
  }
  for (let j = 0; j < n; j++) b.tri(iris, ring[j], ring[(j + 1) % n], o[0], o[1], o[2])
}

/** One brow: a ribbon from the inner end (browIn) to the outer end (browOut), arched and tapering. */
function brow(b: Builder, side: number, o: readonly [number, number, number]): void {
  const slot = F(FX.brow)
  const arch = [0, 0.0028, 0.0045, 0.0028, -0.0022]
  const half = [0.0039, 0.0037, 0.0035, 0.003, 0.0023]
  const up: number[] = []
  const dn: number[] = []
  for (let k = 0; k < 5; k++) {
    const x = side * (FACE.browIn + ((FACE.browOut - FACE.browIn) * k) / 4)
    const y = FACE.browY + arch[k]
    up.push(b.vertex(x, y + half[k], faceZ(x, y + half[k]) + 0.0028, P.head, slot))
    dn.push(b.vertex(x, y - half[k], faceZ(x, y - half[k]) + 0.0028, P.head, slot))
  }
  for (let k = 0; k < 4; k++) {
    b.tri(up[k], up[k + 1], dn[k], o[0], o[1], o[2])
    b.tri(up[k + 1], dn[k + 1], dn[k], o[0], o[1], o[2])
  }
}

/** The mouth: a ribbon, thicker in the middle, 8 segments so the shader can bend it into a smile. */
function mouth(b: Builder, o: readonly [number, number, number]): void {
  const slot = F(FX.mouth)
  const n = 8
  const up: number[] = []
  const dn: number[] = []
  for (let k = 0; k <= n; k++) {
    const u = (k / n) * 2 - 1
    const x = u * FACE.mouthHalf
    const h = 0.0016 + 0.0016 * (1 - u * u)
    up.push(b.vertex(x, FACE.mouthY + h, faceZ(x, FACE.mouthY + h) + 0.0022, P.head, slot))
    dn.push(b.vertex(x, FACE.mouthY - h, faceZ(x, FACE.mouthY - h) + 0.0022, P.head, slot))
  }
  for (let k = 0; k < n; k++) {
    b.tri(up[k], up[k + 1], dn[k], o[0], o[1], o[2])
    b.tri(up[k + 1], dn[k + 1], dn[k], o[0], o[1], o[2])
  }
}

/** Glasses: a frame ribbon round each eye, a bridge and two arms to the ears. Hidden by the vertex stage on everybody who wears none. */
export function buildGlasses(b: Builder): void {
  const slot = F(FX.frame)
  const o: [number, number, number] = [0, 0.19, 0.01]
  const n = 10
  const a = 0.0235
  const c = 0.0215
  const w = 0.0034
  const lift = 0.0078
  for (const sx of [-1, 1]) {
    const cx = sx * FACE.eyeX
    const cy = FACE.eyeY + 0.001
    const outer: number[] = []
    const inner: number[] = []
    for (let j = 0; j < n; j++) {
      const th = (j / n) * Math.PI * 2
      const co = Math.cos(th)
      const si = Math.sin(th)
      outer.push(b.vertex(cx + a * co, cy + c * si, faceZ(cx + a * co, cy + c * si) + lift, P.head, slot))
      inner.push(b.vertex(cx + (a - w) * co, cy + (c - w) * si, faceZ(cx + (a - w) * co, cy + (c - w) * si) + lift + 0.0008, P.head, slot))
    }
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n
      b.tri(outer[j], outer[k], inner[j], o[0], o[1], o[2])
      b.tri(outer[k], inner[k], inner[j], o[0], o[1], o[2])
    }
    // the arm: from the outer corner back along the side of the head to the ear
    const pts = [
      [sx * (FACE.eyeX + a - 0.001), cy + 0.004, faceZ(sx * (FACE.eyeX + a - 0.001), cy + 0.004) + lift],
      [sx * 0.0875, cy + 0.002, 0.05],
      [sx * 0.094, cy - 0.006, -0.004],
    ]
    for (let k = 0; k < 2; k++) {
      const p = pts[k]
      const q = pts[k + 1]
      b.quad(P.head, slot, [[p[0], p[1] + 0.0022, p[2]], [q[0], q[1] + 0.0022, q[2]], [q[0], q[1] - 0.0022, q[2]], [p[0], p[1] - 0.0022, p[2]]], o)
    }
  }
  // the bridge
  const bx = FACE.eyeX - a + w * 0.5
  const by = FACE.eyeY + 0.011
  const bz = faceZ(0, by) + lift + 0.001
  b.quad(P.head, slot, [[-bx, by + 0.0022, bz], [bx, by + 0.0022, bz], [bx, by - 0.0022, bz], [-bx, by - 0.0022, bz]], o)
}

// ---------------------------------------------------------------------------------------------------------------------
// The face in motion: pure functions of time and mood, written into the pose texture by the model (nothing here allocates).
// ---------------------------------------------------------------------------------------------------------------------

/** Blink: 0 open .. 1 shut. Every person blinks every 3 to 6 seconds on their own clock, for about 0.15 s. Deterministic from the seed and time. */
export function blinkAt(t: number, seed: number): number {
  const period = 3.2 + 2.8 * rnd(seed, 90)
  const dur = 0.16 / period
  const phase = (t / period + rnd(seed, 91)) % 1
  if (phase >= dur) return 0
  const x = phase / dur
  const s = Math.sin(Math.PI * x)
  return s * s
}

/** The expression the mouth and brows show: +1 a slight smile (mood happy), 0 neutral (neutral and waiting), -1 a small frown (unwell). */
export function expressionOf(happy: number, slump: number): number {
  return clamp(happy - slump, -1, 1)
}

/** How far the mouth is open: 0 shut, up to 1 while the person talks. `speaking` is the rig's 0..1 weight, `talk` 1 in a talk pose. */
export function mouthOpenAt(t: number, seed: number, talk: number, speaking: number): number {
  if (talk < 0.01) return 0
  const a = 0.5 + 0.5 * Math.sin(t * 9.1 + rnd(seed, 92) * 6.28)
  const b = 0.5 + 0.5 * Math.sin(t * 5.3 + rnd(seed, 93) * 6.28)
  return clamp(talk * speaking * (0.15 + 0.85 * a * (0.4 + 0.6 * b)), 0, 1)
}
