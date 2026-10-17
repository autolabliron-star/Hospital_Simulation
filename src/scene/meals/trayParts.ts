/**
 * The meal tray (L1): a grey tray with a plate, a cup and a napkin (`base`), and a silver cloche that covers the plate while the
 * meal is hot (`cloche`). Built once; the trays layer draws 16 on the over-bed tables and, on the MealBots' shelves, up to eight
 * per bot. Vertex colours, one material. Local frame: the origin is the middle of the tray's underside, the long axis runs along
 * x, y is up (so the matrix of an instance is just the anchor's).
 */
import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, SphereGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const TRAY_COLORS = {
  tray: '#d5dcdc',
  plate: '#f7f8f8',
  cup: '#ffffff',
  napkin: '#f7c3a8',
  cloche: '#cdd5d7',
  knob: '#8f9a9d',
} as const

/** Tray size and where the plate (and so the cloche) stands, in the tray's frame. */
export const TRAY = { l: 0.46, w: 0.32, h: 0.016, plate: { x: -0.07, z: 0, r: 0.11 }, clocheR: 0.115 } as const

function paint(g: BufferGeometry, hex: string): BufferGeometry {
  const c = new Color(hex)
  const n = g.getAttribute('position').count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r
    a[i * 3 + 1] = c.g
    a[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new Float32BufferAttribute(a, 3))
  return g
}

function merge(parts: BufferGeometry[], what: string): BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  for (const g of flat) for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name)
  const merged = mergeGeometries(flat, false)
  for (const g of parts) g.dispose()
  for (const g of flat) g.dispose()
  if (!merged) throw new Error(`tray: could not merge ${what}`)
  return merged
}

/** Tray, plate, cup with a saucer, and a napkin. */
export function trayBaseGeometry(): BufferGeometry {
  const { l, w, h, plate } = TRAY
  const parts = [
    paint(new BoxGeometry(l, h, w).translate(0, h / 2, 0), TRAY_COLORS.tray),
    paint(new CylinderGeometry(plate.r, plate.r * 0.86, 0.014, 14).translate(plate.x, h + 0.007, plate.z), TRAY_COLORS.plate),
    paint(new CylinderGeometry(0.05, 0.05, 0.006, 10).translate(0.13, h + 0.003, 0.07), TRAY_COLORS.plate),
    paint(new CylinderGeometry(0.034, 0.028, 0.06, 8).translate(0.13, h + 0.036, 0.07), TRAY_COLORS.cup),
    paint(new BoxGeometry(0.1, 0.004, 0.06).translate(0.14, h + 0.002, -0.085), TRAY_COLORS.napkin),
  ]
  return merge(parts, 'tray base')
}

/** The cloche: a dome over the plate with a knob. */
export function trayClocheGeometry(): BufferGeometry {
  const { plate, h, clocheR } = TRAY
  const y = h + 0.014
  const parts = [
    paint(new SphereGeometry(clocheR, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(plate.x, y, plate.z), TRAY_COLORS.cloche),
    paint(new SphereGeometry(0.016, 6, 4).translate(plate.x, y + clocheR, plate.z), TRAY_COLORS.knob),
  ]
  return merge(parts, 'tray cloche')
}
