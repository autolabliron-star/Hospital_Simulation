/**
 * A small software 2D context for node tests (a test helper: the app never imports it): just enough of the canvas API (affine `drawImage`, `fillRect`,
 * strokes, source-over and 'lighter' blending, `putImageData`) to run the endoscope painter on real pixels, so a test can measure the composited picture
 * (src/scene/surgery/endo/noBlood.test.ts) and not only the pieces it is made of. Text and path fills are not drawn (the HUD's chips and words are left
 * out); everything else is composited as a browser would, to within the sampling.
 */
import type { Env, Surface } from '@/scene/imaging/images/ctx'

export interface RCanvas {
  width: number
  height: number
  /** RGBA, 0..255 floats, straight (not premultiplied) alpha 0..255. */
  data: Float32Array
}

function parseColour(s: string): [number, number, number, number] {
  let m = /^#([0-9a-f]{6})$/i.exec(s)
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1]
  m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16), 1]
  const r = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?/.exec(s)
  if (r) return [Number(r[1]), Number(r[2]), Number(r[3]), r[4] === undefined ? 1 : Number(r[4])]
  return [255, 0, 255, 1]
}

export function makeSurface(w: number, h: number): { canvas: RCanvas; ctx: any } {
  const canvas: RCanvas = { width: w, height: h, data: new Float32Array(w * h * 4) }
  let tf = [1, 0, 0, 1, 0, 0]
  const st: Record<string, any> = { globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1 }
  let path: [number, number][][] = []

  const blend = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return
    const o = (y * w + x) * 4
    const d = canvas.data
    if (st.globalCompositeOperation === 'lighter') {
      d[o] = Math.min(255, d[o] + r * a)
      d[o + 1] = Math.min(255, d[o + 1] + g * a)
      d[o + 2] = Math.min(255, d[o + 2] + b * a)
      d[o + 3] = Math.max(d[o + 3], a * 255)
      return
    }
    const da = d[o + 3] / 255
    const oa = a + da * (1 - a)
    if (oa <= 0) return
    d[o] = (r * a + d[o] * da * (1 - a)) / oa
    d[o + 1] = (g * a + d[o + 1] * da * (1 - a)) / oa
    d[o + 2] = (b * a + d[o + 2] * da * (1 - a)) / oa
    d[o + 3] = oa * 255
  }
  const inv = () => {
    const [a, b, c, d, e, f] = tf
    const det = a * d - b * c
    return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
  }
  const sample = (src: RCanvas, u: number, v: number): [number, number, number, number] => {
    const x = Math.min(src.width - 1.001, Math.max(0, u - 0.5))
    const y = Math.min(src.height - 1.001, Math.max(0, v - 0.5))
    const x0 = Math.floor(x), y0 = Math.floor(y)
    const fx = x - x0, fy = y - y0
    const out: [number, number, number, number] = [0, 0, 0, 0]
    let wa = 0
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const wgt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy)
      const o = ((y0 + j) * src.width + x0 + i) * 4
      const a = src.data[o + 3] / 255
      out[0] += src.data[o] * a * wgt
      out[1] += src.data[o + 1] * a * wgt
      out[2] += src.data[o + 2] * a * wgt
      wa += a * wgt
    }
    if (wa > 0) { out[0] /= wa; out[1] /= wa; out[2] /= wa }
    out[3] = wa
    return out
  }
  const box = (pts: [number, number][]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
    return [Math.max(0, Math.floor(x0)), Math.max(0, Math.floor(y0)), Math.min(w - 1, Math.ceil(x1)), Math.min(h - 1, Math.ceil(y1))]
  }
  const T = (x: number, y: number): [number, number] => [tf[0] * x + tf[2] * y + tf[4], tf[1] * x + tf[3] * y + tf[5]]

  const api: Record<string, any> = {
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void (tf = [a, b, c, d, e, f]),
    drawImage(img: RCanvas, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
      const corners: [number, number][] = [T(dx, dy), T(dx + dw, dy), T(dx, dy + dh), T(dx + dw, dy + dh)]
      const [x0, y0, x1, y1] = box(corners)
      const [ia, ib, ic, id, ie, iff] = inv()
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        let r = 0, g = 0, b = 0, a = 0, n = 0
        for (const [jx, jy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          const X = px + jx, Y = py + jy
          const lx = ia * X + ic * Y + ie, ly = ib * X + id * Y + iff
          n++
          if (lx < dx || lx > dx + dw || ly < dy || ly > dy + dh) continue
          const s = sample(img, sx + ((lx - dx) / dw) * sw, sy + ((ly - dy) / dh) * sh)
          r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3]
        }
        if (a > 0) blend(px, py, r / a, g / a, b / a, (a / n) * st.globalAlpha)
      }
    },
    fillRect(x: number, y: number, rw: number, rh: number) {
      const corners: [number, number][] = [T(x, y), T(x + rw, y), T(x, y + rh), T(x + rw, y + rh)]
      const [x0, y0, x1, y1] = box(corners)
      const [ia, ib, ic, id, ie, iff] = inv()
      const [r, g, b, ca] = parseColour(String(st.fillStyle))
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        let cov = 0
        for (const [jx, jy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          const X = px + jx, Y = py + jy
          const lx = ia * X + ic * Y + ie, ly = ib * X + id * Y + iff
          if (lx >= x && lx <= x + rw && ly >= y && ly <= y + rh) cov += 0.25
        }
        if (cov > 0) blend(px, py, r, g, b, cov * ca * st.globalAlpha)
      }
    },
    beginPath: () => void (path = []),
    closePath: () => undefined,
    moveTo: (x: number, y: number) => void path.push([T(x, y)]),
    lineTo: (x: number, y: number) => {
      if (path.length === 0) path.push([])
      path[path.length - 1].push(T(x, y))
    },
    quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) => {
      if (path.length === 0) path.push([])
      path[path.length - 1].push(T(x, y))
    },
    ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number) {
      const pts: [number, number][] = []
      const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * 24))
      for (let i = 0; i <= n; i++) {
        const t = a0 + ((a1 - a0) * i) / n
        const x = Math.cos(t) * rx, y = Math.sin(t) * ry
        pts.push(T(cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)))
      }
      path.push(pts)
    },
    arc(cx: number, cy: number, r: number, a0: number, a1: number) { api.ellipse(cx, cy, r, r, 0, a0, a1) },
    stroke() {
      const [cr, cg, cb, ca] = parseColour(String(st.strokeStyle))
      const half = Math.max(0.5, st.lineWidth / 2)
      for (const pts of path) {
        for (let i = 0; i + 1 < pts.length || (pts.length === 1 && i === 0); i++) {
          const p = pts[i], q = pts[i + 1] ?? pts[i]
          const [x0, y0, x1, y1] = box([[p[0] - half - 1, p[1] - half - 1], [q[0] + half + 1, q[1] + half + 1], [q[0] - half - 1, q[1] - half - 1], [p[0] + half + 1, p[1] + half + 1]])
          const dx = q[0] - p[0], dy = q[1] - p[1]
          const l2 = dx * dx + dy * dy
          for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
            const X = px + 0.5, Y = py + 0.5
            const t = l2 > 0 ? Math.max(0, Math.min(1, ((X - p[0]) * dx + (Y - p[1]) * dy) / l2)) : 0
            const d = Math.hypot(X - (p[0] + dx * t), Y - (p[1] + dy * t))
            const cov = Math.max(0, Math.min(1, half + 0.5 - d))
            if (cov > 0) blend(px, py, cr, cg, cb, cov * ca * st.globalAlpha)
          }
        }
      }
    },
    fill: () => undefined,
    fillText: () => undefined,
    strokeText: () => undefined,
    measureText: (t: string) => ({ width: t.length * 5 }),
    createImageData: (cw: number, ch: number) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
    putImageData(img: { width: number; height: number; data: Uint8ClampedArray }, ox: number, oy: number) {
      for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) {
        const s = (j * img.width + i) * 4, o = ((oy + j) * w + ox + i) * 4
        for (let c = 0; c < 4; c++) canvas.data[o + c] = img.data[s + c]
      }
    },
    save: () => undefined,
    restore: () => undefined,
    clip: () => undefined,
    clearRect: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
    rect: () => undefined,
    strokeRect: () => undefined,
    setLineDash: () => undefined,
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
  }
  const ctx = new Proxy(st, {
    get: (t, k: string) => (k in api ? api[k] : t[k]),
    set: (t, k: string, v) => ((t[k] = v), true),
  })
  return { canvas, ctx }
}



/** An environment whose surfaces are real pixels (for `bakeEndoPlatesNow` and the like). */
export const rasterEnv: Env = { supportsFilter: true, createSurface: (w, h) => makeSurface(w, h) as unknown as Surface }

/** The surface's pixels as an RGBA byte array (alpha 255 where the picture is opaque). */
export function rgbaOf(c: RCanvas): Uint8ClampedArray {
  const out = new Uint8ClampedArray(c.width * c.height * 4)
  for (let i = 0; i < out.length; i++) out[i] = c.data[i]
  return out
}
