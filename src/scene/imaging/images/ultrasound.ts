/**
 * Ultrasound as pure geometry. A live image is a sector "fan" whose structures move with the probe: `usScene` lists the blobs for a view
 * at a probe phase (0..1 along the sweep) and a time (breathing and hand tremor), in image units (x -0.5..0.5 across the picture, y 0..1 down
 * the picture, the apex of the fan at the top). The painter (`usPaint.ts`) turns the blobs into brightness, speckle and attenuation.
 */
import { clamp01, lerp, smooth } from './shapes'

export type UsView = 'liver' | 'gallbladder' | 'kidneyR' | 'kidneyL' | 'spleen' | 'bladder' | 'pancreas' | 'breast'

export const US_VIEWS: readonly UsView[] = ['liver', 'gallbladder', 'kidneyR', 'kidneyL', 'spleen', 'bladder', 'pancreas', 'breast'] as const

/** The view a sweep's name asks for ("Right kidney sweep" -> kidneyR). Falls back on the body part. */
export function usViewOf(sweepName: string, bodyPart?: string): UsView {
  const n = sweepName.toLowerCase()
  if (bodyPart === 'breast' || n.includes('breast')) return 'breast'
  if (n.includes('pancreas')) return 'pancreas'
  if (n.includes('gallbladder')) return 'gallbladder'
  if (n.includes('bladder')) return 'bladder'
  if (n.includes('spleen')) return 'spleen'
  if (n.includes('left') && n.includes('kidney')) return 'kidneyL'
  if (n.includes('kidney')) return 'kidneyR'
  if (n.includes('liver')) return 'liver'
  return bodyPart === 'kidneys' ? 'kidneyR' : 'liver'
}

export interface UsBlob {
  cx: number
  cy: number
  rx: number
  ry: number
  rot: number
  /** Echo brightness 0 (fluid: black) .. 1 (bone, gas, fat planes). */
  echo: number
  /** Brightness of the thin bright wall round it (0 for none). */
  wall: number
  /** Posterior acoustic enhancement behind a fluid-filled structure (0..1), or a negative value for an acoustic shadow. */
  behind: number
}

export interface UsScene {
  count: number
  blobs: UsBlob[]
  /** The image depth in centimetres (for the ruler). */
  depthCm: number
  /** Short label of the view ("Liver, long axis"). */
  title: string
  /** A linear (rectangular) image from a high-frequency probe instead of the curved array's fan (the breast). */
  linear: boolean
  /** Image units per millimetre of depth (the picture's depth spans US_APEX_Y..US_BOTTOM). */
  mm: number
  /** The lesion a procedure aims at (the breast tumour): centre and radius in image units; tr 0 when there is none. */
  tx: number
  ty: number
  tr: number
}

export const US_MAX_BLOBS = 24
export const US_APEX_Y = 0.07
/** Half-angle of the fan in radians (30 degrees). */
export const US_HALF_ANGLE = Math.PI / 6

export function createUsScene(): UsScene {
  const blobs: UsBlob[] = []
  for (let i = 0; i < US_MAX_BLOBS; i++) blobs.push({ cx: 0, cy: 0, rx: 0, ry: 0, rot: 0, echo: 0, wall: 0, behind: 0 })
  return { count: 0, blobs, depthCm: 14, title: '', linear: false, mm: 0, tx: 0, ty: 0, tr: 0 }
}

/** Where the fan's depth ends, as a fraction of the picture height (usPaint draws down to here). */
export const US_DEPTH_END = 0.94

function put(s: UsScene, cx: number, cy: number, rx: number, ry: number, rot: number, echo: number, wall = 0, behind = 0): void {
  if (s.count >= US_MAX_BLOBS) return
  const b = s.blobs[s.count++]
  b.cx = cx
  b.cy = cy
  b.rx = rx
  b.ry = ry
  b.rot = rot
  b.echo = echo
  b.wall = wall
  b.behind = behind
}

const TITLES: Record<UsView, string> = {
  liver: 'Liver',
  gallbladder: 'Gallbladder',
  kidneyR: 'Right kidney',
  kidneyL: 'Left kidney',
  spleen: 'Spleen',
  bladder: 'Bladder',
  pancreas: 'Pancreas',
  breast: 'Breast',
}
const DEPTH: Record<UsView, number> = { liver: 16, gallbladder: 12, kidneyR: 14, kidneyL: 14, spleen: 14, bladder: 12, pancreas: 13, breast: 5 }

/** The breast tumour: diameter range (mm) and the depth of its centre under the skin (mm). Early, small, low-risk: about 1.2 cm. */
export const BREAST_TUMOUR_MM: readonly [number, number] = [11, 13]
/** How far the tumour's lobulated edge reaches, as a multiple of its core radius (UsScene.tr is the core radius times this). */
export const TUMOUR_EXTENT = 1.1
const BREAST_TUMOUR_DEPTH_MM: readonly [number, number] = [19, 22]

/**
 * Fill `out` with the structures of `view` for this exam seed, probe phase and time. The structures glide sideways as the probe sweeps and
 * grow and shrink a little where the sweep cuts them through the middle; breathing moves everything up and down a few millimetres.
 */
export function usScene(out: UsScene, view: UsView, seed: number, phase: number, t: number): UsScene {
  const sd = (seed ^ 0x9e3779b1) >>> 0
  // the seeded numbers, without a generator or an array per frame (nthRandom k = the (k+1)-th draw of mulberry32(sd))
  const j0 = nthRandom(sd, 0)
  const j1 = nthRandom(sd, 1)
  const j2 = nthRandom(sd, 2)
  const j3 = nthRandom(sd, 3)
  const ph = clamp01(phase)
  let breathe = 0.014 * Math.sin((t / 4.6) * Math.PI * 2) + 0.004 * Math.sin(t * 2.3 + j0 * 6)
  const sway = 0.003 * Math.sin(t * 1.7 + j1 * 6)
  const sweep = (ph - 0.5) * 2 // -1..1
  out.count = 0
  out.depthCm = DEPTH[view]
  out.title = TITLES[view]
  out.linear = view === 'breast'
  out.mm = (US_DEPTH_END - US_APEX_Y) / (out.depthCm * 10)
  out.tx = 0
  out.ty = 0
  out.tr = 0
  let tumour = -1
  let tumourR = 0
  const mid = 1 - Math.abs(sweep) // 1 when the sweep cuts the structure through its middle

  switch (view) {
    case 'liver': {
      const sh = -sweep * 0.16
      put(out, 0 + sh * 0.3, 0.5 + breathe, 0.62, 0.36, 0, 0.5) // the liver
      // hepatic veins: dark branches converging on the IVC, and bright-walled portal branches
      for (let k = 0; k < 3; k++) {
        const a = -0.9 + k * 0.9
        put(out, sh + (k - 1) * 0.16, 0.4 + 0.03 * k + breathe, 0.02, 0.15, a, 0.02, 0.45)
      }
      put(out, sh + 0.06, 0.52 + breathe, 0.05, 0.022, 0.1, 0.02, 0.8)
      put(out, sh - 0.2, 0.55 + breathe, 0.035, 0.02, -0.2, 0.02, 0.8)
      put(out, sh + 0.2, 0.43 + breathe, 0.03, 0.03, 0, 0.02, 0.5) // the IVC
      // the right kidney's upper pole drifts in from the side, the diaphragm curves across the bottom
      put(out, 0.42 - sweep * 0.1, 0.78 + breathe, 0.16 * smooth(0.5, 1, ph), 0.1 * smooth(0.5, 1, ph), 0.2, 0.3, 0.7)
      put(out, 0.0 + sh * 0.2, 0.9 + breathe, 0.6, 0.02, 0, 0.95)
      break
    }
    case 'gallbladder': {
      const g = lerp(-0.22, 0.22, ph)
      put(out, -0.05, 0.5 + breathe, 0.62, 0.38, 0, 0.5) // liver all round
      put(out, g, 0.5 + breathe, 0.07 + 0.02 * mid, 0.16 + 0.03 * mid, 0.3, 0, 0.7, 0.9) // the gallbladder
      put(out, g - 0.18, 0.36 + breathe, 0.035, 0.03, 0, 0.02, 0.7) // portal vein
      put(out, g - 0.1, 0.45 + breathe, 0.016, 0.1, 0.2, 0.55, 0.8) // the main lobar fissure
      if (j2 < 0.35) {
        // one small stone with its shadow
        put(out, g + 0.015, 0.6 + breathe, 0.012, 0.01, 0, 1, 0, 0)
        put(out, g + 0.015, 0.76 + breathe, 0.012, 0.15, 0, 0.0, 0, -1)
      }
      put(out, 0, 0.92 + breathe, 0.6, 0.02, 0, 0.9)
      break
    }
    case 'kidneyR':
    case 'kidneyL': {
      const side = view === 'kidneyR' ? 1 : -1
      const cx = lerp(-0.2, 0.2, ph) * side * -1
      const s = 0.72 + 0.28 * mid
      put(out, -side * 0.34, 0.38 + breathe, 0.3, 0.26, 0.2, 0.46) // liver (right) or spleen (left) beside it
      put(out, cx, 0.54 + breathe, 0.2 * s, 0.33 * s, 0.25 * side, 0.82, 0, 0) // fat and capsule
      put(out, cx, 0.54 + breathe, 0.175 * s, 0.305 * s, 0.25 * side, 0.3, 0, 0) // the cortex
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + j3
        put(out, cx + Math.cos(a) * 0.1 * s, 0.54 + breathe + Math.sin(a) * 0.19 * s, 0.026 * s, 0.04 * s, a, 0.07, 0, 0) // pyramids
      }
      put(out, cx, 0.54 + breathe, 0.055 * s, 0.14 * s, 0.25 * side, 0.96, 0, 0) // the central sinus
      put(out, 0, 0.93 + breathe, 0.6, 0.02, 0, 0.8) // the back
      break
    }
    case 'spleen': {
      const sx = lerp(-0.1, 0.1, ph)
      put(out, sx, 0.45 + breathe, 0.5, 0.26, 0.15, 0.46)
      put(out, sx + 0.05, 0.5 + breathe, 0.022, 0.1, 0.3, 0.02, 0.7) // hilar vessels
      put(out, sx + 0.1, 0.45 + breathe, 0.016, 0.07, -0.3, 0.02, 0.7)
      put(out, sx - 0.18, 0.78 + breathe, 0.2, 0.05, 0.3, 0.95) // gas in the stomach and bowel
      put(out, 0, 0.94 + breathe, 0.6, 0.02, 0, 0.9)
      break
    }
    case 'pancreas': {
      // the epigastric transverse view: the left lobe of the liver in front, the gland as a slightly bright band, the splenic vein running
      // along its back, the SMV and SMA below the neck, the aorta and IVC behind them and the spine casting its shadow at the bottom
      const sh = sweep * 0.1
      put(out, -0.2, 0.26 + breathe, 0.36, 0.13, 0.12, 0.5) // the left lobe of the liver
      put(out, 0.3, 0.27 + breathe, 0.12, 0.05, 0.3, 0.95) // gas in the stomach
      put(out, sh * 0.4, 0.46 + breathe, 0.34, 0.07, -0.06, 0.64) // the pancreas: head, neck, body
      put(out, sh * 0.4 + 0.02, 0.54 + breathe, 0.26, 0.015, -0.06, 0.02, 0.6) // the splenic vein
      put(out, sh * 0.4 - 0.02, 0.58 + breathe, 0.034, 0.03, 0, 0.02, 0.7) // the SMV
      put(out, sh * 0.4 - 0.09, 0.6 + breathe, 0.02, 0.02, 0, 0.02, 0.95) // the SMA, with its bright wall
      put(out, -0.07, 0.72 + breathe, 0.04, 0.04, 0, 0.02, 0.8) // the aorta
      put(out, 0.1, 0.71 + breathe, 0.05, 0.035, 0, 0.02, 0.5) // the IVC
      put(out, 0, 0.9 + breathe, 0.2, 0.05, 0, 1, 0, -1) // the spine, with its shadow
      break
    }
    case 'bladder': {
      const w = lerp(0.3, 0.2, mid)
      put(out, sweep * 0.05, 0.44 + breathe, w, 0.2, 0, 0, 0.6, 0.9) // the bladder
      put(out, sweep * 0.05, 0.78 + breathe, 0.24, 0.1, 0, 0.55, 0, 0) // uterus or prostate behind it
      put(out, -0.4, 0.55 + breathe, 0.08, 0.12, 0.3, 0.45) // bowel loops to the side
      put(out, 0.4, 0.55 + breathe, 0.08, 0.12, -0.3, 0.45)
      break
    }
    case 'breast': {
      // a linear probe, 5 cm deep: skin, subcutaneous fat lobules (mid-grey) crossed by Cooper's ligaments, the fibroglandular layer
      // (brighter) with fat islands in it, the retromammary fat, the pectoral muscle with its bright fascia, then the ribs and their shadows.
      // The tumour sits in the gland at about 2 cm: small, dark (hypoechoic), its edge a little lobulated. The chest wall barely breathes.
      breathe *= 0.3
      const mm = out.mm
      const y0 = US_APEX_Y
      const sh = -sweep * 0.07
      put(out, sh * 0.6, y0 + 0.33 + breathe, 0.62, 0.16, 0.02 * (j0 - 0.5), 0.6) // the fibroglandular layer
      for (let k = 0; k < 3; k++) {
        // fat islands within the gland
        const x = sh + (k - 1) * 0.24 + (nthRandom(sd, 4 + k) - 0.5) * 0.08
        put(out, x, y0 + 0.31 + (nthRandom(sd, 4 + k + 10) - 0.5) * 0.08 + breathe, 0.06 + 0.03 * nthRandom(sd, 4 + k + 20), 0.028, 0.15 * (nthRandom(sd, 4 + k + 30) - 0.5), 0.3)
      }
      for (let k = 0; k < 5; k++) {
        // subcutaneous fat lobules
        const x = sh * 1.3 + (k - 2) * 0.16 + (nthRandom(sd, 4 + k + 40) - 0.5) * 0.05
        put(out, x, y0 + 0.095 + 0.03 * nthRandom(sd, 4 + k + 50) + breathe, 0.065 + 0.02 * nthRandom(sd, 4 + k + 60), 0.034, 0.2 * (nthRandom(sd, 4 + k + 70) - 0.5), 0.32)
      }
      for (let k = 0; k < 3; k++) {
        // Cooper's ligaments: thin bright curved strands rising from the gland toward the skin
        const x = sh * 1.2 + (k - 1) * 0.2 + 0.08 + (nthRandom(sd, 4 + k + 80) - 0.5) * 0.06
        put(out, x, y0 + 0.11 + breathe, 0.006, 0.07, 0.5 * (nthRandom(sd, 4 + k + 90) - 0.5), 0.9)
      }
      put(out, sh * 0.4, y0 + 0.555 + breathe, 0.64, 0.035, 0, 0.3) // the retromammary fat
      put(out, sh * 0.3, y0 + 0.64 + breathe, 0.66, 0.05, 0, 0.42, 0.55) // the pectoral muscle, its fascia bright
      for (let k = 0; k < 2; k++) {
        // ribs: a bright curved top and a black shadow below
        put(out, sh * 0.2 + (k === 0 ? -0.2 : 0.18) + (j3 - 0.5) * 0.06, y0 + 0.76 + breathe, 0.09, 0.022, 0, 1, 0, -1)
      }
      put(out, sh * 0.2, y0 + 0.8 + breathe, 0.62, 0.006, 0, 0.95) // the pleura, a bright line between the ribs
      // the tumour: in the middle at about 2 cm, its centre held still while the probe is (phase 0.5), lobulated by three small bulges
      const dMm = BREAST_TUMOUR_MM[0] + (BREAST_TUMOUR_MM[1] - BREAST_TUMOUR_MM[0]) * j2
      const tr = (dMm / 2) * mm * (0.55 + 0.45 * mid)
      const tx = sweep * 0.12 + (j1 - 0.5) * 0.08
      const ty = y0 + lerp(BREAST_TUMOUR_DEPTH_MM[0], BREAST_TUMOUR_DEPTH_MM[1], j0) * mm + breathe
      tumour = out.count
      tumourR = tr * TUMOUR_EXTENT
      put(out, tx, ty, tr * 1.04, tr * 0.94, 0.25 * (j3 - 0.5), 0.07)
      for (let k = 0; k < 4; k++) {
        // small bulges at uneven angles: a slightly irregular, microlobulated edge
        const a = ((k + 0.6 * nthRandom(sd, 110 + k)) / 4) * Math.PI * 2
        const br = tr * (0.3 + 0.1 * nthRandom(sd, 120 + k))
        put(out, tx + Math.cos(a) * (tumourR - br), ty + Math.sin(a) * (tumourR - br) * 0.92, br, br * 0.8, a, 0.07)
      }
      break
    }
  }
  // tremor: everything shifts together by a hair
  for (let i = 0; i < out.count; i++) out.blobs[i].cx += sway
  if (tumour >= 0) {
    const b = out.blobs[tumour]
    out.tx = b.cx
    out.ty = b.cy
    out.tr = tumourR
  }
  return out
}

/** The (k+1)-th number mulberry32(seed) would draw, computed directly (src/sim/rng.ts: the same numbers, no closure). */
export function nthRandom(seed: number, k: number): number {
  let t = (seed + Math.imul(k + 1, 0x6d2b79f5)) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
