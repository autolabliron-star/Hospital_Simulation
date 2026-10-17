/**
 * Floor labels: every name and room number is drawn ONCE into a single canvas atlas with the system font (drei's <Text>
 * would fetch its default font from a CDN, which breaks the offline demo) and lies on the floor as one merged mesh.
 * Thin strokes, wide letter spacing, soft teal-grey ink: elegant rather than loud.
 */
import { BufferGeometry, CanvasTexture, LinearMipmapLinearFilter, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { LabelSpec } from '../layout/types'

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const WEIGHT = { light: 300, regular: 400, medium: 600 } as const
const PX = 96
const PAD = 10
const ATLAS_W = 2048
/** Height of a capital letter as a share of the font size. */
const CAP = 0.72
export const LABEL_Y = 0.03

const ceilPow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)))

interface Measured {
  w: number
  h: number
  widths: number[]
}

export function buildLabelMesh(specs: LabelSpec[]): { geometry: BufferGeometry; material: MeshBasicMaterial; texture: CanvasTexture } | null {
  if (specs.length === 0) return null
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) return null

  // 1. measure each label, char by char (letter spacing is drawn by hand: ctx.letterSpacing is not everywhere)
  const boxes: Measured[] = specs.map((s) => {
    probe.font = `${WEIGHT[s.weight]} ${PX}px ${FONT}`
    const widths = [...s.text].map((ch) => probe.measureText(ch).width)
    const gap = s.spacing * PX
    const w = Math.ceil(widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1))
    return { w, h: Math.ceil(PX * 1.25), widths }
  })

  // 2. shelf-pack, tallest first
  const order = specs.map((_, i) => i).sort((i, j) => boxes[j].h - boxes[i].h || boxes[j].w - boxes[i].w)
  const place: { x: number; y: number }[] = new Array(specs.length)
  let cx = 0
  let cy = 0
  let rowH = 0
  for (const i of order) {
    const cw = boxes[i].w + PAD * 2
    const ch = boxes[i].h + PAD * 2
    if (cx + cw > ATLAS_W) {
      cx = 0
      cy += rowH
      rowH = 0
    }
    place[i] = { x: cx, y: cy }
    cx += cw
    rowH = Math.max(rowH, ch)
  }
  const atlasH = ceilPow2(cy + rowH)

  // 3. draw
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_W
  canvas.height = atlasH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  specs.forEach((s, i) => {
    ctx.font = `${WEIGHT[s.weight]} ${PX}px ${FONT}`
    ctx.fillStyle = s.color
    const gap = s.spacing * PX
    let x = place[i].x + PAD
    const y = place[i].y + PAD + boxes[i].h / 2
    ;[...s.text].forEach((ch, k) => {
      ctx.fillText(ch, x, y)
      x += boxes[i].widths[k] + gap
    })
  })

  // 4. one quad per label lying flat, north up the screen, UVs pointing at its cell
  const quads = specs.map((s, i) => {
    const { w, h } = boxes[i]
    const aspect = w / h
    // `height` is the capital letter height in metres; the cell is `h / PX` em tall and a capital is CAP em
    let hm = (s.height / CAP) * (h / PX)
    if (hm * aspect > s.maxWidth) hm = s.maxWidth / aspect
    const g = new PlaneGeometry(hm * aspect, hm).rotateX(-Math.PI / 2).translate(s.x, LABEL_Y, s.z)
    const u0 = (place[i].x + PAD) / ATLAS_W
    const u1 = (place[i].x + PAD + w) / ATLAS_W
    const v1 = 1 - (place[i].y + PAD) / atlasH
    const v0 = 1 - (place[i].y + PAD + h) / atlasH
    const uv = g.getAttribute('uv')
    for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0))
    return g
  })
  const merged = mergeGeometries(quads, false)
  for (const g of quads) g.dispose()
  if (!merged) return null

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 8
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  return { geometry: merged, material, texture }
}
