/**
 * Node tests only: a small software 2D canvas, so a painter's picture can be probed pixel by pixel (the CT slices, the anaesthesia monitor) without a
 * browser. It draws what the cryo painters draw: filled and stroked paths (lines, quadratic curves, arcs, ellipses, rects), `fillRect`, a rectangular
 * `clip`, `drawImage` of another raster surface (nearest sample), colours as `#rgb`, `#rrggbb`, `rgb()` and `rgba()`, `globalAlpha` and the transform.
 * Text is recorded, not drawn (`texts`). Dashes, gradients, blur and the 'lighter' blend are ignored. Anti-aliasing is off: a pixel is covered when its centre is.
 */
import type { Ctx2D, Env, Surface } from '@/scene/imaging/images/ctx'

export interface RasterSurface extends Surface {
  canvas: Surface['canvas'] & { data: Uint8ClampedArray }
  /** The RGBA of pixel (x, y). */
  at(x: number, y: number): [number, number, number, number]
  /** Every text drawn, in order. */
  texts: string[]
  /** The mean RGB of the (2r+1)^2 patch around (x, y). */
  mean(x: number, y: number, r?: number): [number, number, number]
}

type Pt = [number, number]

function parseColor(s: unknown): [number, number, number, number] | null {
  if (typeof s !== 'string') return null
  const t = s.trim().toLowerCase()
  let m = /^#([0-9a-f]{3})$/.exec(t)
  if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16), 1]
  m = /^#([0-9a-f]{6})$/.exec(t)
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1]
  m = /^rgba?\(([^)]*)\)$/.exec(t)
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v))
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
  }
  return null
}

/** A raster surface of w x h pixels (transparent black at first). */
export function rasterSurface(w: number, h: number, opts: { textBoxes?: boolean } = {}): RasterSurface {
  const data = new Uint8ClampedArray(w * h * 4)
  const canvas = { width: w, height: h, data }
  const texts: string[] = []

  let tf: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]
  let clip: [number, number, number, number] = [0, 0, w, h]
  const stack: { tf: typeof tf; clip: typeof clip; fillStyle: unknown; strokeStyle: unknown; lineWidth: number; globalAlpha: number }[] = []
  let path: { pts: Pt[]; closed: boolean }[] = []
  const state = { fillStyle: '#000000' as unknown, strokeStyle: '#000000' as unknown, lineWidth: 1, globalAlpha: 1 }

  const dev = (x: number, y: number): Pt => [tf[0] * x + tf[2] * y + tf[4], tf[1] * x + tf[3] * y + tf[5]]
  const scale = (): number => Math.sqrt(Math.abs(tf[0] * tf[3] - tf[1] * tf[2]))
  const cur = (): { pts: Pt[]; closed: boolean } => {
    if (path.length === 0) path.push({ pts: [], closed: false })
    return path[path.length - 1]
  }

  const blend = (x: number, y: number, c: [number, number, number, number], alpha: number): void => {
    if (x < clip[0] || y < clip[1] || x >= clip[2] || y >= clip[3] || x < 0 || y < 0 || x >= w || y >= h) return
    const a = Math.min(1, Math.max(0, c[3] * alpha))
    if (a <= 0) return
    const o = (y * w + x) * 4
    const da = data[o + 3] / 255
    const oa = a + da * (1 - a)
    for (let k = 0; k < 3; k++) data[o + k] = oa > 0 ? (c[k] * a + data[o + k] * da * (1 - a)) / oa : 0
    data[o + 3] = oa * 255
  }

  /** Fill closed polygons (device space), non-zero winding, by scanlines through the pixel centres. */
  const fillPolys = (polys: Pt[][], c: [number, number, number, number], alpha: number): void => {
    let y0 = Infinity
    let y1 = -Infinity
    for (const p of polys) for (const q of p) (y0 = Math.min(y0, q[1])), (y1 = Math.max(y1, q[1]))
    if (!(y1 >= y0)) return
    const ys = Math.max(0, Math.floor(y0 - 0.5), clip[1])
    const ye = Math.min(h - 1, Math.ceil(y1 + 0.5), clip[3] - 1)
    for (let y = ys; y <= ye; y++) {
      const cy = y + 0.5
      const xs: [number, number][] = []
      for (const p of polys) {
        for (let i = 0; i < p.length; i++) {
          const a = p[i]
          const b = p[(i + 1) % p.length]
          if (a[1] === b[1]) continue
          const lo = a[1] < b[1] ? a : b
          const hi = a[1] < b[1] ? b : a
          if (cy < lo[1] || cy >= hi[1]) continue
          xs.push([lo[0] + ((cy - lo[1]) / (hi[1] - lo[1])) * (hi[0] - lo[0]), a[1] < b[1] ? 1 : -1])
        }
      }
      xs.sort((p, q) => p[0] - q[0])
      let wind = 0
      for (let i = 0; i < xs.length - 1; i++) {
        wind += xs[i][1]
        if (wind === 0) continue
        const from = Math.max(0, Math.ceil(xs[i][0] - 0.5), clip[0])
        const to = Math.min(w - 1, Math.ceil(xs[i + 1][0] - 0.5) - 1, clip[2] - 1)
        for (let x = from; x <= to; x++) blend(x, y, c, alpha)
      }
    }
  }

  const strokePolys = (c: [number, number, number, number], alpha: number): void => {
    const half = (state.lineWidth * scale()) / 2
    const quads: Pt[][] = []
    for (const sp of path) {
      const pts = sp.closed && sp.pts.length > 1 ? [...sp.pts, sp.pts[0]] : sp.pts
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = pts[i]
        const [bx, by] = pts[i + 1]
        const dx = bx - ax
        const dy = by - ay
        const len = Math.hypot(dx, dy)
        if (len < 1e-9) continue
        const nx = (-dy / len) * half
        const ny = (dx / len) * half
        quads.push([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]])
      }
      for (const [x, y] of pts) {
        const disc: Pt[] = []
        for (let k = 0; k < 8; k++) disc.push([x + Math.cos((k / 8) * Math.PI * 2) * half, y + Math.sin((k / 8) * Math.PI * 2) * half])
        quads.push(disc)
      }
    }
    // each piece on its own so overlaps stay one coat (alpha blends once per piece, close enough for probes at alpha 1)
    for (const q of quads) fillPolys([q], c, alpha)
  }

  const ctx = {
    save() {
      stack.push({ tf: [...tf] as typeof tf, clip: [...clip] as typeof clip, ...state })
    },
    restore() {
      const s = stack.pop()
      if (!s) return
      tf = s.tf
      clip = s.clip
      state.fillStyle = s.fillStyle
      state.strokeStyle = s.strokeStyle
      state.lineWidth = s.lineWidth
      state.globalAlpha = s.globalAlpha
    },
    beginPath() {
      path = []
    },
    closePath() {
      if (path.length) path[path.length - 1].closed = true
    },
    moveTo(x: number, y: number) {
      path.push({ pts: [dev(x, y)], closed: false })
    },
    lineTo(x: number, y: number) {
      cur().pts.push(dev(x, y))
    },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      const sp = cur()
      const p0 = sp.pts.length ? sp.pts[sp.pts.length - 1] : dev(cx, cy)
      const c1 = dev(cx, cy)
      const p1 = dev(x, y)
      for (let i = 1; i <= 8; i++) {
        const t = i / 8
        sp.pts.push([(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * c1[0] + t * t * p1[0], (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * c1[1] + t * t * p1[1]])
      }
    },
    arc(x: number, y: number, r: number, a0: number, a1: number) {
      ;(ctx.ellipse as (...a: number[]) => void)(x, y, r, r, 0, a0, a1)
    },
    ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number) {
      const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-9
      const n = 48
      const pts: Pt[] = []
      const cr = Math.cos(rot)
      const sr = Math.sin(rot)
      for (let i = 0; i <= (full ? n - 1 : n); i++) {
        const a = a0 + ((a1 - a0) * i) / n
        const x = rx * Math.cos(a)
        const y = ry * Math.sin(a)
        pts.push(dev(cx + x * cr - y * sr, cy + x * sr + y * cr))
      }
      path.push({ pts, closed: full })
    },
    rect(x: number, y: number, rw: number, rh: number) {
      path.push({ pts: [dev(x, y), dev(x + rw, y), dev(x + rw, y + rh), dev(x, y + rh)], closed: true })
    },
    fill() {
      const c = parseColor(state.fillStyle)
      if (!c) return
      fillPolys(path.filter((s) => s.pts.length >= 3).map((s) => s.pts), c, state.globalAlpha)
    },
    stroke() {
      const c = parseColor(state.strokeStyle)
      if (!c) return
      strokePolys(c, state.globalAlpha)
    },
    clip() {
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const s of path) for (const [x, y] of s.pts) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y))
      clip = [Math.max(clip[0], Math.floor(x0 + 0.5)), Math.max(clip[1], Math.floor(y0 + 0.5)), Math.min(clip[2], Math.floor(x1 + 0.5)), Math.min(clip[3], Math.floor(y1 + 0.5))]
    },
    fillRect(x: number, y: number, rw: number, rh: number) {
      const c = parseColor(state.fillStyle)
      if (!c) return
      fillPolys([[dev(x, y), dev(x + rw, y), dev(x + rw, y + rh), dev(x, y + rh)]], c, state.globalAlpha)
    },
    strokeRect() {},
    clearRect(x: number, y: number, rw: number, rh: number) {
      const [ax, ay] = dev(x, y)
      const [bx, by] = dev(x + rw, y + rh)
      for (let yy = Math.max(0, Math.floor(ay)); yy < Math.min(h, Math.ceil(by)); yy++) for (let xx = Math.max(0, Math.floor(ax)); xx < Math.min(w, Math.ceil(bx)); xx++) data.fill(0, (yy * w + xx) * 4, (yy * w + xx) * 4 + 4)
    },
    translate(x: number, y: number) {
      tf = [tf[0], tf[1], tf[2], tf[3], tf[0] * x + tf[2] * y + tf[4], tf[1] * x + tf[3] * y + tf[5]]
    },
    rotate() {},
    scale(sx: number, sy: number) {
      tf = [tf[0] * sx, tf[1] * sx, tf[2] * sy, tf[3] * sy, tf[4], tf[5]]
    },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      tf = [a, b, c, d, e, f]
    },
    drawImage(src: { width: number; height: number; data?: Uint8ClampedArray }, dx: number, dy: number, dw: number, dh: number) {
      if (!src.data) return
      const corners = [dev(dx, dy), dev(dx + dw, dy), dev(dx + dw, dy + dh), dev(dx, dy + dh)]
      const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0]))))
      const x1 = Math.min(w - 1, Math.ceil(Math.max(...corners.map((p) => p[0]))))
      const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1]))))
      const y1 = Math.min(h - 1, Math.ceil(Math.max(...corners.map((p) => p[1]))))
      const det = tf[0] * tf[3] - tf[1] * tf[2]
      if (Math.abs(det) < 1e-12) return
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5 - tf[4]
          const py = y + 0.5 - tf[5]
          const lx = (tf[3] * px - tf[2] * py) / det
          const ly = (-tf[1] * px + tf[0] * py) / det
          if (lx < dx || lx >= dx + dw || ly < dy || ly >= dy + dh) continue
          const sx = Math.min(src.width - 1, Math.floor(((lx - dx) / dw) * src.width))
          const sy = Math.min(src.height - 1, Math.floor(((ly - dy) / dh) * src.height))
          const o = (sy * src.width + sx) * 4
          blend(x, y, [src.data[o], src.data[o + 1], src.data[o + 2], src.data[o + 3] / 255], state.globalAlpha)
        }
      }
    },
    fillText(s: string, x: number, y: number) {
      texts.push(s)
      // (a layout view: each text as a bar of about its width, so a picture shows where the words go)
      if (!opts.textBoxes) return
      const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(String(ctx.font))?.[1] ?? '12')
      const tw = s.length * size * 0.55
      const left = ctx.textAlign === 'center' ? x - tw / 2 : ctx.textAlign === 'right' || ctx.textAlign === 'end' ? x - tw : x
      const c = parseColor(state.fillStyle)
      if (c) fillPolys([[dev(left, y - size * 0.7), dev(left + tw, y - size * 0.7), dev(left + tw, y), dev(left, y)]], c, 0.55)
    },
    strokeText() {},
    measureText(s: string) {
      return { width: s.length * 6 }
    },
    createLinearGradient() {
      return { addColorStop() {} }
    },
    createRadialGradient() {
      return { addColorStop() {} }
    },
    createImageData() {
      return { data: new Uint8ClampedArray(4) }
    },
    putImageData() {},
    setLineDash() {},
    lineCap: 'butt',
    lineJoin: 'miter',
    globalCompositeOperation: 'source-over',
    filter: 'none',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
  } as Record<string, unknown>
  for (const key of ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha'] as const) {
    Object.defineProperty(ctx, key, { get: () => state[key], set: (v) => void (state[key] = v) })
  }

  const at = (x: number, y: number): [number, number, number, number] => {
    const o = (Math.floor(y) * w + Math.floor(x)) * 4
    return [data[o], data[o + 1], data[o + 2], data[o + 3]]
  }
  return {
    canvas,
    ctx: ctx as unknown as Ctx2D,
    at,
    texts,
    mean(x: number, y: number, r = 4) {
      let s0 = 0
      let s1 = 0
      let s2 = 0
      let n = 0
      for (let yy = Math.floor(y) - r; yy <= Math.floor(y) + r; yy++) {
        for (let xx = Math.floor(x) - r; xx <= Math.floor(x) + r; xx++) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const p = at(xx, yy)
          s0 += p[0]
          s1 += p[1]
          s2 += p[2]
          n++
        }
      }
      return [s0 / n, s1 / n, s2 / n]
    },
  } as unknown as RasterSurface
}

/** An `Env` whose surfaces are raster surfaces (`created` keeps them, in order). */
export function rasterEnv(): { env: Env; created: RasterSurface[] } {
  const created: RasterSurface[] = []
  return {
    env: {
      createSurface(w, h) {
        const s = rasterSurface(w, h)
        created.push(s)
        return s
      },
      supportsFilter: false,
    },
    created,
  }
}

/** Pixels that read as red (a strong red with little green and blue): blood, alarms. */
export function redPixels(s: RasterSurface): number {
  const { data, width, height } = s.canvas
  let n = 0
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    if (data[i * 4 + 3] > 0 && r >= 150 && r > 1.7 * g && r > 1.7 * b) n++
  }
  return n
}
