/**
 * Ultrasound as pure geometry. A live image is a sector "fan" whose structures move with the probe: `usScene` lists the blobs for a view
 * at a probe phase (0..1 along the sweep) and a time (breathing and hand tremor), in image units (x -0.5..0.5 across the picture, y 0..1 down
 * the picture, the apex of the fan at the top). The painter (`usPaint.ts`) turns the blobs into brightness, speckle and attenuation.
 */
import { mulberry32 } from '@/sim/rng'
import { clamp01, lerp, smooth } from './shapes'

export type UsView = 'liver' | 'gallbladder' | 'kidneyR' | 'kidneyL' | 'spleen' | 'bladder'

export const US_VIEWS: readonly UsView[] = ['liver', 'gallbladder', 'kidneyR', 'kidneyL', 'spleen', 'bladder'] as const

/** The view a sweep's name asks for ("Right kidney sweep" -> kidneyR). Falls back on the body part. */
export function usViewOf(sweepName: string, bodyPart?: string): UsView {
  const n = sweepName.toLowerCase()
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
}

export const US_MAX_BLOBS = 24
export const US_APEX_Y = 0.07
/** Half-angle of the fan in radians (30 degrees). */
export const US_HALF_ANGLE = Math.PI / 6

export function createUsScene(): UsScene {
  const blobs: UsBlob[] = []
  for (let i = 0; i < US_MAX_BLOBS; i++) blobs.push({ cx: 0, cy: 0, rx: 0, ry: 0, rot: 0, echo: 0, wall: 0, behind: 0 })
  return { count: 0, blobs, depthCm: 14, title: '' }
}

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
}
const DEPTH: Record<UsView, number> = { liver: 16, gallbladder: 12, kidneyR: 14, kidneyL: 14, spleen: 14, bladder: 12 }

/**
 * Fill `out` with the structures of `view` for this exam seed, probe phase and time. The structures glide sideways as the probe sweeps and
 * grow and shrink a little where the sweep cuts them through the middle; breathing moves everything up and down a few millimetres.
 */
export function usScene(out: UsScene, view: UsView, seed: number, phase: number, t: number): UsScene {
  const r = mulberry32((seed ^ 0x9e3779b1) >>> 0)
  const j = [r(), r(), r(), r()]
  const ph = clamp01(phase)
  const breathe = 0.014 * Math.sin((t / 4.6) * Math.PI * 2) + 0.004 * Math.sin(t * 2.3 + j[0] * 6)
  const sway = 0.003 * Math.sin(t * 1.7 + j[1] * 6)
  const sweep = (ph - 0.5) * 2 // -1..1
  out.count = 0
  out.depthCm = DEPTH[view]
  out.title = TITLES[view]
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
      if (j[2] < 0.35) {
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
        const a = (k / 7) * Math.PI * 2 + j[3]
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
    case 'bladder': {
      const w = lerp(0.3, 0.2, mid)
      put(out, sweep * 0.05, 0.44 + breathe, w, 0.2, 0, 0, 0.6, 0.9) // the bladder
      put(out, sweep * 0.05, 0.78 + breathe, 0.24, 0.1, 0, 0.55, 0, 0) // uterus or prostate behind it
      put(out, -0.4, 0.55 + breathe, 0.08, 0.12, 0.3, 0.45) // bowel loops to the side
      put(out, 0.4, 0.55 + breathe, 0.08, 0.12, -0.3, 0.45)
      break
    }
  }
  // tremor: everything shifts together by a hair
  for (let i = 0; i < out.count; i++) out.blobs[i].cx += sway
  return out
}
