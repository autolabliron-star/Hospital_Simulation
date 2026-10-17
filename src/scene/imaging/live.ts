/**
 * The live scan canvases and their textures: ONE canvas per modality, shared by the Scan viewer (it mounts the element in the DOM
 * while the panel is open) and by the control-room and cart monitors in 3D (a `CanvasTexture` on the very same canvas).
 * The screens (`images/screen.ts`) redraw only when their content changes and flag the texture for upload after each redraw.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'
import type { ImagingModality } from '@/sim/types'
import { getScreen } from './images/screens'
import { SCREEN_SIZE } from './images/screen'

export const LIVE_SIZE = SCREEN_SIZE

const textures = new Map<ImagingModality, CanvasTexture>()

export function getLiveCanvas(m: ImagingModality): HTMLCanvasElement {
  return getScreen(m).canvas as HTMLCanvasElement
}

/** The shared texture of a modality's live canvas (sRGB, linear filtering, no mipmaps). The screen flags `needsUpdate` after every redraw. */
export function getLiveTexture(m: ImagingModality): CanvasTexture {
  let t = textures.get(m)
  if (!t) {
    const screen = getScreen(m)
    const tex = new CanvasTexture(screen.canvas as HTMLCanvasElement)
    tex.colorSpace = SRGBColorSpace
    tex.minFilter = LinearFilter
    tex.magFilter = LinearFilter
    tex.generateMipmaps = false
    screen.onDraw = () => {
      tex.needsUpdate = true
    }
    tex.needsUpdate = true
    textures.set(m, tex)
    t = tex
  }
  return t
}
