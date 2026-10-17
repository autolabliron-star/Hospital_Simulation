/**
 * The bedside-screen atlas: ONE canvas texture with a 320 x 200 tile per room. A tile is painted once at mount and again ONLY when
 * its room's `RoomStatus.version` changes (the sim bumps it on every change a screen shows); the texture is re-uploaded at most
 * twice a second. Browser only (it makes a canvas); the words and the drawing live in building/render/screens.ts.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import { paintBedsideDefault, paintBedsideScreen, type BedsideInfo } from '@/scene/building/render/screens'
import { BEDSIDE_ATLAS, atlasCell } from './wardParts'

export interface BedsideAtlas {
  texture: CanvasTexture
  /** Paint tile `i` for the room (or the static default look when `info` is null). */
  draw(i: number, info: BedsideInfo | null): void
}

export function createBedsideAtlas(): BedsideAtlas | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = BEDSIDE_ATLAS.tileW * BEDSIDE_ATLAS.cols
  canvas.height = BEDSIDE_ATLAS.tileH * BEDSIDE_ATLAS.rows
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 8
  return {
    texture,
    draw(i, info) {
      const { col, row } = atlasCell(i)
      ctx.save()
      ctx.translate(col * BEDSIDE_ATLAS.tileW, row * BEDSIDE_ATLAS.tileH)
      ctx.beginPath()
      ctx.rect(0, 0, BEDSIDE_ATLAS.tileW, BEDSIDE_ATLAS.tileH)
      ctx.clip()
      if (info) paintBedsideScreen(ctx, BEDSIDE_ATLAS.tileW, BEDSIDE_ATLAS.tileH, info)
      else paintBedsideDefault(ctx, BEDSIDE_ATLAS.tileW, BEDSIDE_ATLAS.tileH)
      ctx.restore()
    },
  }
}
