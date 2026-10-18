/**
 * The three walk-only materials that are not in the shared palette (src/scene/materials.ts is the orchestrator's; the palette
 * entries this wants are listed in the change requests): the ceiling (tiles plus glowing panels) and the sign atlas. Both are
 * singletons for the whole walk-mode building. Browser only (it paints canvases); the node tests use the pure parts.
 *
 * Emissive stays under the caps of the skill's "too-bright screens" pitfall: the panels at 1.3 (W3: the bloom starts at 1.0 with a 0.2 soft
 * knee, so a white-warm panel of 1.3 just catches it and glows softly, while the lit ceiling tiles around it never do; the panels are
 * walk-only and dim with the room lights at night, below the threshold, as a lamp at night should).
 */
import { CanvasTexture, Color, FrontSide, LinearMipmapLinearFilter, MeshBasicMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three'
import type { Tile } from '../../layout/walk/types'
import { patchMaterialLook } from '@/scene/lighting/palettePatch'
import { CEILING_PX, paintCeilingCell } from './ceilingTexture'
import { paintAtlas, type PackedAtlas, type Paint2D } from './signAtlas'

/** Emissive intensity of the ceiling light panels at full brightness (the daylight driver dims them with the room lights). */
export const CEILING_EMISSIVE = 1.3

export interface WalkMaterials {
  ceiling: MeshStandardMaterial
  signs: MeshBasicMaterial
  /** Every canvas texture, for the warm-up (`gl.initTexture`) and the disposal. */
  textures: CanvasTexture[]
  dispose(): void
}

function canvas(w: number, h: number): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const el = document.createElement('canvas')
  el.width = w
  el.height = h
  const ctx = el.getContext('2d')
  if (!ctx) throw new Error('walk materials: no 2D canvas')
  return { el, ctx }
}

function texture(el: HTMLCanvasElement, repeat: boolean): CanvasTexture {
  const t = new CanvasTexture(el)
  t.colorSpace = SRGBColorSpace
  t.generateMipmaps = true
  t.minFilter = LinearMipmapLinearFilter
  t.anisotropy = 8
  if (repeat) {
    t.wrapS = RepeatWrapping
    t.wrapT = RepeatWrapping
  }
  return t
}

export function createWalkMaterials(atlas: PackedAtlas, tiles: readonly Tile[]): WalkMaterials {
  const albedo = canvas(CEILING_PX, CEILING_PX)
  paintCeilingCell(albedo.ctx, false)
  const glowCanvas = canvas(CEILING_PX, CEILING_PX)
  paintCeilingCell(glowCanvas.ctx, true)
  const map = texture(albedo.el, true)
  const emissiveMap = texture(glowCanvas.el, true)
  const ceiling = new MeshStandardMaterial({
    color: new Color('#ffffff'),
    map,
    emissive: new Color('#fff1d9'),
    emissiveMap,
    emissiveIntensity: CEILING_EMISSIVE,
    roughness: 0.95,
    metalness: 0,
    side: FrontSide,
  })
  ceiling.name = 'walk-ceiling'
  // W3: the ceiling is not a palette material, so it picks up the baked light volume here (its tiles are lit by the panels around them)
  patchMaterialLook(ceiling, 'plain')

  const sign = canvas(atlas.width, atlas.height)
  paintAtlas(sign.ctx as unknown as Paint2D, atlas, tiles)
  const signMap = texture(sign.el, false)
  const signs = new MeshBasicMaterial({
    map: signMap,
    toneMapped: false,
    // the pictures sit a hair off their panels: keep them on top at any distance
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  signs.name = 'walk-signs'

  const textures = [map, emissiveMap, signMap]
  return {
    ceiling,
    signs,
    textures,
    dispose() {
      ceiling.dispose()
      signs.dispose()
      for (const t of textures) t.dispose()
    },
  }
}
