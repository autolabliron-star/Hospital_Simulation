/**
 * Where a drei <Html> label goes on screen, in whole device pixels.
 *
 * drei's default places the label at the exact projected position, a fraction of a pixel. A label is its own
 * compositor layer, so it is drawn at that fraction and its text is resampled: while the camera creeps, the glyphs
 * shimmer by a fraction of a pixel and look soft. Snapped to a device pixel the text is crisp and, once the camera is
 * at rest, does not change at all: no style write, no repaint.
 *
 * Pass it as `<Html calculatePosition={snappedLabelPosition}>`.
 */
import { Vector3, type Camera, type Object3D } from 'three'

const projected = new Vector3()

/** `v` CSS pixels snapped to a whole number of device pixels (`dpr` device pixels per CSS pixel). */
export function snapToDevicePixel(v: number, dpr: number = typeof window !== 'undefined' ? window.devicePixelRatio : 1): number {
  const r = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  return Math.round(v * r) / r
}

/** drei's default label position, snapped to device pixels. */
export function snappedLabelPosition(
  el: Object3D,
  camera: Camera,
  size: { width: number; height: number },
  dpr?: number,
): [number, number] {
  projected.setFromMatrixPosition(el.matrixWorld).project(camera)
  const hw = size.width / 2
  const hh = size.height / 2
  return [snapToDevicePixel(projected.x * hw + hw, dpr), snapToDevicePixel(-(projected.y * hh) + hh, dpr)]
}
