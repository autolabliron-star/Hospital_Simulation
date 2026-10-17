import { PerspectiveCamera, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { snapToDevicePixel, snappedLabelPosition } from './labelSnap'

describe('label snapping', () => {
  it('snaps to whole device pixels', () => {
    expect(snapToDevicePixel(412.37, 1)).toBe(412)
    expect(snapToDevicePixel(412.37, 2)).toBe(412.5)
    expect(snapToDevicePixel(412.74, 2)).toBe(412.5)
    expect(snapToDevicePixel(412.8, 2)).toBe(413)
    expect(snapToDevicePixel(412.37, 0)).toBe(412) // a nonsense ratio falls back to 1
    expect(snapToDevicePixel(412.37, Number.NaN)).toBe(412)
  })

  it('projects a point to the centre of the screen when it is straight ahead, in device pixels', () => {
    const cam = new PerspectiveCamera(35, 2, 1, 500)
    cam.position.set(0, 0, 10)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld(true)
    const label = new Object3D()
    label.position.set(0, 0, 0)
    label.updateMatrixWorld(true)
    const [x, y] = snappedLabelPosition(label, cam, { width: 1000, height: 500 }, 1)
    expect(x).toBe(500)
    expect(y).toBe(250)
    // moving the label a tiny bit does not change the snapped position
    label.position.set(0.0003, 0, 0)
    label.updateMatrixWorld(true)
    expect(snappedLabelPosition(label, cam, { width: 1000, height: 500 }, 1)).toEqual([x, y])
  })
})
