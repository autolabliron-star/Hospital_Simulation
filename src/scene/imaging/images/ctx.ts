/**
 * The slice of the 2D canvas API the image generators use, so the drawing code runs against a recording mock in node
 * (there is no canvas there) and against a real `CanvasRenderingContext2D` in the browser.
 */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'closePath'
  | 'moveTo'
  | 'lineTo'
  | 'quadraticCurveTo'
  | 'arc'
  | 'ellipse'
  | 'rect'
  | 'fill'
  | 'stroke'
  | 'clip'
  | 'fillRect'
  | 'strokeRect'
  | 'clearRect'
  | 'translate'
  | 'rotate'
  | 'scale'
  | 'setTransform'
  | 'drawImage'
  | 'fillText'
  | 'strokeText'
  | 'measureText'
  | 'createLinearGradient'
  | 'createRadialGradient'
  | 'createImageData'
  | 'putImageData'
  | 'setLineDash'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'globalAlpha'
  | 'globalCompositeOperation'
  | 'filter'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'imageSmoothingEnabled'
  | 'imageSmoothingQuality'
>

/** An offscreen drawing surface: a canvas (or anything `drawImage` accepts) and its 2D context. */
export interface Surface {
  canvas: CanvasImageSource & { width: number; height: number }
  ctx: Ctx2D
}

/** Where surfaces come from. The browser makes real canvases; tests inject a recorder. */
export interface Env {
  createSurface(width: number, height: number): Surface
  /** Does `ctx.filter = 'blur(..)'` work here? (Safari before 18 ignores it.) */
  supportsFilter: boolean
}

let domSupportsFilter: boolean | null = null

function detectFilter(): boolean {
  if (domSupportsFilter !== null) return domSupportsFilter
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 4
    const x = c.getContext('2d')
    domSupportsFilter = !!x && 'filter' in x && (x.filter = 'blur(1px)', x.filter === 'blur(1px)')
  } catch {
    domSupportsFilter = false
  }
  return domSupportsFilter
}

/** The browser environment: real canvases. */
export const domEnv: Env = {
  createSurface(width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('imaging: this browser has no 2D canvas')
    return { canvas, ctx }
  },
  get supportsFilter() {
    return detectFilter()
  },
}

/** `rgb(g,g,g)` strings for the 256 greys, so drawing does not format a colour per shape. */
export const GREY: readonly string[] = Array.from({ length: 256 }, (_, i) => `rgb(${i},${i},${i})`)

export const grey = (v: number): string => GREY[v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)]
