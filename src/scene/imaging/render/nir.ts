/**
 * R3 "Real screens": the near-infrared vein map of the blood-draw robot. Near-infrared light goes a few millimetres into the skin; the blood
 * in a vein absorbs it, so a vein shows as a soft dark band, darker when it is thick and shallow, fading as it dives. The picture looks
 * straight into the palm side of the forearm: for every pixel the ray's entry into the skin and its chords through the superficial veins
 * (the parts named `vein*`, body.ts / regions/forearm.ts) give the darkening; the skin keeps a faint mottle and darkens toward the arm's
 * edges, where it curves away from the camera; light scattered in the skin blurs it all a little. Pure and deterministic.
 */
import { partNormal, partSdf, type Phantom, type V3 } from '../phantom/body'
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
  private bg = new Float32Array(0)
  private grey = new Uint8Array(0)
  private readonly seg = [0, 0]
  private readonly nrm = [0, 0, 0]

  render(ph: Phantom, req: NirRequest): Uint8Array {
    const W = req.sizeW
    const H = req.sizeH
    const n = W * H
    if (this.img.length !== n) {
      this.img = new Float32Array(n)
      this.tmp = new Float32Array(n)
      this.out = new Float32Array(n)
      this.bg = new Float32Array(n)
      this.grey = new Uint8Array(n)
    }
    const outline = ph.names.indexOf('armOutline')
    const veins: number[] = []
    ph.names.forEach((nm, i) => {
      if (nm.startsWith('vein') && !nm.endsWith('Wall')) veins.push(i)
    })
    const v = req.view
    // light scattered in the skin spreads a vein's shadow over about a millimetre and a half
    const pxPerMm = W / req.w
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = ((i + 0.5) / W - 0.5) * req.w
        const y = ((j + 0.5) / H - 0.5) * req.h
        const ox = req.centre[0] + req.xDir[0] * x + req.yDir[0] * y - v[0] * 120
        const oy = req.centre[1] + req.xDir[1] * x + req.yDir[1] * y - v[1] * 120
        const oz = req.centre[2] + req.xDir[2] * x + req.yDir[2] * y - v[2] * 120
        // the skin: where the ray enters the arm's outline (the chord's estimate, then a few steps onto the true surface)
        let skinT = -1
        if (outline >= 0) {
          const m0 = ph.partM0[outline]
          for (let m = m0; m < m0 + ph.partMN[outline]; m++) {
            if (!memberChord(ph, m, ox, oy, oz, v[0], v[1], v[2], this.seg)) continue
            if (skinT < 0 || this.seg[0] < skinT) skinT = this.seg[0]
          }
        }
        const k = j * W + i
        if (skinT < 0) {
          this.img[k] = 0.04
          this.tmp[k] = 0
          continue
        }
        for (let it = 0; it < 4; it++) skinT += partSdf(ph, outline, ox + v[0] * skinT, oy + v[1] * skinT, oz + v[2] * skinT)
        // the veins' absorption
        let a = 0
        for (const p of veins) {
          const m0 = ph.partM0[p]
          for (let m = m0; m < m0 + ph.partMN[p]; m++) {
            if (!memberChord(ph, m, ox, oy, oz, v[0], v[1], v[2], this.seg)) continue
            const depth = Math.max(0, this.seg[0] - skinT)
            // the strongest absorber on the ray (a vein's segments overlap at their joints: summing would bead them)
            const ab = (1 - Math.exp(-(this.seg[1] - this.seg[0]) / 1.6)) * Math.exp(-depth / 4.5)
            if (ab > a) a = ab
          }
        }
        const sx = ox + v[0] * skinT
        const sy = oy + v[1] * skinT
        const sz = oz + v[2] * skinT
        const mottle = 1 + 0.07 * (value3(sx, sy, sz, 2.2, req.seed) - 0.5) + 0.04 * (value3(sx, sy, sz, 0.7, req.seed ^ 0x51) - 0.5)
        // the arm curves away from the camera at its edges: the skin's slope to the view
        partNormal(ph, outline, sx, sy, sz, this.nrm)
        const facing = Math.max(0, -(this.nrm[0] * v[0] + this.nrm[1] * v[1] + this.nrm[2] * v[2]))
        this.img[k] = mottle * (1 - 0.78 * Math.min(1, a)) * (0.3 + 0.7 * Math.sqrt(facing))
      }
    }
    gaussianBlur(this.img, this.out, this.tmp, W, H, Math.max(1.1, 1.5 * pxPerMm))
    // the camera's local contrast enhancement (what makes the veins stand out on a vein viewer): each pixel against its neighbourhood
    gaussianBlur(this.out, this.bg, this.tmp, W, H, 9 * pxPerMm)
    const g = this.grey
    for (let k = 0; k < n; k++) {
      const b = this.bg[k]
      const val = b > 0.06 ? Math.sqrt(b) * (0.8 + 2.1 * (this.out[k] / b - 1)) : this.out[k]
      g[k] = val <= 0 ? 0 : val >= 1 ? 255 : Math.round(val * 255)
    }
    return g
  }
}
