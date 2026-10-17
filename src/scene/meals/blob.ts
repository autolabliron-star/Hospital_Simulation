/** A soft radial blob (dark centre fading to nothing) on a quad: the MealBot's shadow, since moving things do not cast into the baked sun shadow. */
import { CanvasTexture, Color, MeshBasicMaterial, SRGBColorSpace } from 'three'

export function createBlobMaterial(): MeshBasicMaterial {
  let map: CanvasTexture | null = null
  if (typeof document !== 'undefined') {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)
      g.addColorStop(0, 'rgba(14, 34, 34, 0.5)')
      g.addColorStop(0.55, 'rgba(14, 34, 34, 0.24)')
      g.addColorStop(1, 'rgba(14, 34, 34, 0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, size, size)
      map = new CanvasTexture(canvas)
      map.colorSpace = SRGBColorSpace
    }
  }
  return new MeshBasicMaterial({
    map,
    color: new Color('#ffffff'),
    transparent: true,
    opacity: map ? 1 : 0.18,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
}
