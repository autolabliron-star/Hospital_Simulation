/**
 * The trees the building layout plants round the shell (instanced by the building renderer, shown in the overview and while walking).
 * Its own module so the real-place exterior (./grounds) can keep its trees clear of them without importing the layout builder.
 */
export interface LayoutTree {
  x: number
  z: number
  height: number
  tint: string
  seed: number
}

export const LAYOUT_TREES: readonly LayoutTree[] = [
  { x: -47, z: -27.2, height: 5.2, tint: '#a6d49a', seed: 0.05 },
  { x: -24, z: -27.6, height: 4.6, tint: '#b8dca4', seed: 0.35 },
  { x: 4, z: -27, height: 5.0, tint: '#a6d49a', seed: 0.6 },
  { x: 28, z: -27.5, height: 4.8, tint: '#b8dca4', seed: 0.9 },
  { x: -50, z: 29.0, height: 4.4, tint: '#b8dca4', seed: 0.2 },
  { x: -8, z: 29.4, height: 4.6, tint: '#a6d49a', seed: 0.5 },
  { x: 24, z: 29.0, height: 4.4, tint: '#b8dca4', seed: 0.75 },
  { x: 44.4, z: -12, height: 5.0, tint: '#a6d49a', seed: 0.15 },
  { x: 44.4, z: 12, height: 4.6, tint: '#b8dca4', seed: 0.45 },
  { x: -70, z: -12.5, height: 4.8, tint: '#a6d49a', seed: 0.65 },
  { x: -71, z: 26, height: 4.2, tint: '#b8dca4', seed: 0.3 },
]
