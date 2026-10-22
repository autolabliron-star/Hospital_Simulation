/**
 * The three things that repeat (one InstancedMesh each): a tree, a car, a street light. Pure geometry in their own local frames
 * (a tree and a lamp on the ground at the origin; a car on the ground, its front toward local +x, its middle at the origin).
 *
 * Vertex colours carry the fixed parts (trunk, glass, wheels, the lamp's steel); the INSTANCE colour is the variable part:
 * a car's paint (the body is white in the template), a tree's slight tone (a multiplier near 1, so the trunk stays brown).
 */
import { mulberry32 } from '@/sim/rng'
import { hex, MeshBuilder, trianglesOf, type MeshData } from './meshBuilder'

export interface Inst {
  x: number
  z: number
  /** Heading about y (three's sign). */
  ry: number
  /** Uniform scale. */
  s: number
  /** Linear instance colour. */
  c: readonly [number, number, number]
}

const TRUNK = hex('#6b5342')
const LEAF = hex('#78a56c')
const LEAF_B = hex('#6a9a62')

/** A 6 m tree: a slim trunk and two jittered foliage blobs. */
export function treeTemplate(): MeshData {
  const b = new MeshBuilder()
  const rand = mulberry32(0x7ee5)
  b.prism(0, 0, 0, 0.15, 2.5, 6, TRUNK, false, 0.1)
  b.blob(0, 3.9, 0, 1.95, 1.75, 1.95, 1, LEAF, rand, 0.14)
  b.blob(0.75, 3.1, 0.45, 1.35, 1.15, 1.35, 0, LEAF_B, rand, 0.14)
  return b.build()
}

export const TREE_HEIGHT = 5.65

/** A hatchback, 4.4 x 1.8 x 1.45 m, front toward +x. */
export function carTemplate(): MeshData {
  const b = new MeshBuilder()
  const white = [1, 1, 1] as const
  const glass = hex('#222a2e')
  const tyre = hex('#15191b')
  b.box(-2.2, 0.32, -0.9, 2.2, 0.88, 0.9, white)
  b.frustum(-0.25, 0.88, 0, 2.75, 1.72, 1.43, 1.75, 1.5, glass, white)
  for (const sx of [-1.35, 1.35]) for (const sz of [-0.85, 0.85]) b.boxC(sx, 0.02, sz, 0.64, 0.62, 0.22, tyre)
  return b.build()
}

/** A 8 m street light: a tapering steel pole, a cantilever arm toward local +x and a lantern under its end. */
export function lampTemplate(): MeshData {
  const b = new MeshBuilder()
  const steel = hex('#6a727a')
  const head = hex('#e9e6dc')
  b.prism(0, 0, 0, 0.1, 8, 8, steel, true, 0.06)
  b.box(0, 7.82, -0.04, 1.75, 7.92, 0.04, steel)
  b.box(1.25, 7.72, -0.17, 1.95, 7.82, 0.17, head)
  return b.build()
}

export const TEMPLATE_TRIANGLES = (): { tree: number; car: number; lamp: number } => ({
  tree: trianglesOf(treeTemplate()),
  car: trianglesOf(carTemplate()),
  lamp: trianglesOf(lampTemplate()),
})
