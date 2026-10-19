/**
 * The robots' live strip as a three.js texture and material (browser only: created lazily, because `document` does not exist in node).
 * The material copies the imaging monitors' settings (a map, `toneMapped: false`, vertex colours) so the shader program is shared.
 */
import { CanvasTexture, LinearFilter, MeshBasicMaterial, SRGBColorSpace } from 'three'
import { domEnv } from '@/scene/imaging/images/ctx'
import { LiveStrip } from './liveStrip'

let strip: LiveStrip | null = null
let texture: CanvasTexture | null = null
let material: MeshBasicMaterial | null = null

/** The one live strip (created on first use). */
export function getStrip(): LiveStrip {
  strip ??= new LiveStrip(domEnv)
  return strip
}

/** The strip's texture: sRGB, linear filtering, no mipmaps; the strip flags it for upload after every redraw. */
export function getStripTexture(): CanvasTexture {
  if (!texture) {
    const s = getStrip()
    const tex = new CanvasTexture(s.canvas as HTMLCanvasElement)
    tex.colorSpace = SRGBColorSpace
    tex.minFilter = LinearFilter
    tex.magFilter = LinearFilter
    tex.generateMipmaps = false
    s.onDraw = () => {
      tex.needsUpdate = true
    }
    tex.needsUpdate = true
    texture = tex
  }
  return texture
}

/** The screens' material (single sided: the back of a screen stays dark; `vertexColors` like the imaging monitors). */
export function stripMaterial(): MeshBasicMaterial {
  material ??= new MeshBasicMaterial({ map: getStripTexture(), toneMapped: false, vertexColors: true })
  return material
}
