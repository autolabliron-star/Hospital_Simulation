/**
 * R3 "Real screens": the near-infrared vein map of the blood-draw robot. Near-infrared light goes a few millimetres into the skin; the blood
 * in a vein absorbs it, so a vein shows as a soft dark band, darker when it is thick and shallow, fading as it dives. The picture looks
 * straight into the palm side of the forearm: for every pixel the ray's entry into the skin and its chords through the superficial veins
 * (the parts named `vein*`, body.ts / regions/forearm.ts) give the darkening; the skin keeps a faint mottle and darkens toward the arm's
 * edges, where it curves away from the camera; light scattered in the skin blurs it all a little. Pure and deterministic.
 */
import type { Phantom, V3 } from '../phantom/body'
import { gaussianBlur } from './filters'
import { value3 } from './noise'
import { memberChord } from './xray'

export interface NirRequest {
  /** Picture centre on the skin's plane, the picture's x and y directions, and the view into the arm (unit, LPS). */
  centre: V3
  xDir: V3
  yDir: V3
  view: V3
  /** Field (mm) and output size (px). */
  w: number
  h: number
  sizeW: number
  sizeH: number
  seed: number
}

export class NirRenderer {
  private img = new Float32Array(0)
  private tmp = new Float32Array(0)
  private out = new Float32Array(0)
  private grey = new Uint8Array(0)
  private readonly seg = [0, 0]

  render(ph: Phantom, req: NirRequest): Uint8Array {
    const W = req.sizeW
    const H = req.sizeH
    const n = W * H
    if (this.img.length !== n) {
      this.img = new Float32Array(n)
      this.tmp = new Float32Array(n)
      this.out = new Float32Array(n)
      this.grey = new Uint8Array(n)
    }
    const outline = ph.names.indexOf('armOutline')
    const veins: number[] = []
    ph.names.forEach((nm, i) => {
      if (nm.startsWith('vein') && !nm.endsWith('Wall')) veins.push(i)
    })
    const v = req.view
    let maxChord = 1
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = ((i + 0.5) / W - 0.5) * req.w
        const y = ((j + 0.5) / H - 0.5) * req.h
        const ox = req.centre[0] + req.xDir[0] * x + req.yDir[0] * y - v[0] * 120
        const oy = req.centre[1] + req.xDir[1] * x + req.yDir[1] * y - v[1] * 120
        const oz = req.centre[2] + req.xDir[2] * x + req.yDir[2] * y - v[2] * 120
        // the skin: where the ray enters the arm's outline, and how far it goes through (the arm's curvature)
        let skinT = -1
        let through = 0
        if (outline >= 0) {
          const m0 = ph.partM0[outline]
          for (let m = m0; m < m0 + ph.partMN[outline]; m++) {
            if (!memberChord(ph, m, ox, oy, oz, v[0], v[1], v[2], this.seg)) continue
            if (skinT < 0 || this.seg[0] < skinT) skinT = this.seg[0]
            through = Math.max(through, this.seg[1] - this.seg[0])
          }
        }
        const k = j * W + i
        if (skinT < 0) {
          this.img[k] = 0.04
          continue
        }
        if (through > maxChord) maxChord = through
        // the veins' absorption
        let a = 0
        for (const p of veins) {
          const m0 = ph.partM0[p]
          for (let m = m0; m < m0 + ph.partMN[p]; m++) {
            if (!memberChord(ph, m, ox, oy, oz, v[0], v[1], v[2], this.seg)) continue
            const depth = Math.max(0, this.seg[0] - skinT)
            a += (1 - Math.exp(-(this.seg[1] - this.seg[0]) / 1.4)) * Math.exp(-depth / 2.6)
          }
        }
        const sx = ox + v[0] * skinT
        const sy = oy + v[1] * skinT
        const sz = oz + v[2] * skinT
        const mottle = 1 + 0.07 * (value3(sx, sy, sz, 2.2, req.seed) - 0.5) + 0.04 * (value3(sx, sy, sz, 0.7, req.seed ^ 0x51) - 0.5)
        // `through` holds the chord for now; the shading needs the widest chord, so it is applied in a second pass
        this.img[k] = mottle * (1 - 0.82 * Math.min(1, a))
        this.tmp[k] = through
      }
    }
    // the arm curves away from the camera at its edges
    for (let k = 0; k < n; k++) if (this.img[k] > 0.05) this.img[k] *= 0.35 + 0.65 * Math.sqrt(Math.min(1, this.tmp[k] / maxChord))
    gaussianBlur(this.img, this.out, this.tmp, W, H, 1.1)
    const g = this.grey
    for (let k = 0; k < n; k++) {
      const val = this.out[k] * 0.92
      g[k] = val <= 0 ? 0 : val >= 1 ? 255 : Math.round(val * 255)
    }
    return g
  }
}
