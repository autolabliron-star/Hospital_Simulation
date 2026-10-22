/** Types of tools/arch/proxy.mjs (plain ESM so `node tools/arch/proxy.mjs` needs no loader). */
import type { Document, Material, NodeIO } from '@gltf-transform/core'

export declare const PROXY: {
  minPart: number
  error: number
  texelsPerM2: number
  minAtlas: number
  maxAtlas: number
  minTile: number
  pad: number
  flatTile: number
  trisCap: number
  metalKeep: number
  flatLight: number
  foliageRatio: number
  foliageError: number
}
export type ProxyOptions = Partial<typeof PROXY>

export interface AtlasData {
  size: number
  /** Linear RGB, size x size x 3. */
  rgb: Float32Array
  /** 0 empty, 1 rasterised or dilated, 2 filled with the tile mean. */
  cov: Uint8Array
}
export interface Tile {
  x: number
  y: number
  s: number
  pad: number
}
export interface PartMesh {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}
export type Shade = (i0: number, i1: number, i2: number, w0: number, w1: number, w2: number, out: number[]) => void

export declare function srgbToLinear(byte: number): number
export declare function linearToSrgb8(v: number): number
export declare function dropSmallParts(positions: Float32Array, indices: Uint32Array, minPart: number): Uint32Array
export declare function simplifyPart(mesh: PartMesh, error: number, uvWeight: number, sloppy?: { ratio: number } | null): PartMesh
export declare function tileSizes(
  areas: number[],
  opts: { texelsPerM2: number; minTile: number; minAtlas: number; maxAtlas: number },
  extra?: number[],
): { sides: number[]; atlas: number }
export declare function packSquares(sides: number[], atlas: number): { x: number; y: number }[] | null
export declare function rasterTile(rgb: Float32Array, cov: Uint8Array, atlas: number, tile: Tile, uv1: Float32Array, indices: Uint32Array, shade: Shade): void
export declare function dilateTile(rgb: Float32Array, cov: Uint8Array, atlas: number, tile: Tile, passes: number): void
export declare function colourScale(rgb: Float32Array, cov: Uint8Array): number

export interface BuiltProxy {
  doc: Document
  material: Material
  atlas: AtlasData
  scale: number
  tris: number
  /** Per lightmap: its kept surface (m2) and its tile side (texels). */
  layout: { lightmap: string; m2: number; side: number }[]
  stats: { sourceTris: number; droppedSmall: number; glass: number; tiles: number }
}
export declare function buildProxyDoc(src: Document, lmDir: string, opts?: ProxyOptions): Promise<BuiltProxy>
export declare function atlasPng(atlas: AtlasData, scale: number): Promise<Buffer>
export declare function encodeProxy(io: NodeIO, built: BuiltProxy, texture: Uint8Array, mimeType?: string): Promise<Uint8Array>
export declare function buildProxy(args: {
  io: NodeIO
  srcGlb: string
  lmDir: string
  outFile: string
  ktxCreate: (png: string, ktx2: string, mode: string) => void
  opts?: ProxyOptions
}): Promise<{ atlasData: AtlasData; file: string; tris: number; atlas: number; mb: number; scale: number; bytes: number; stats: BuiltProxy['stats'] }>
