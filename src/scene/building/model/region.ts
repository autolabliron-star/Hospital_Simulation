/**
 * The pilot region (level 1) that the authored model replaces: sim x -62.5..-30, z -16.5..16.5. The procedural compilers take the predicates
 * below as an optional filter (undefined = nothing hidden), so the default build is byte-for-byte unchanged.
 */
import type { MatKey } from '@/scene/materials'

export const PILOT_REGION = { x0: -62.5, x1: -30, z0: -16.5, z1: 16.5 } as const

export const inPilotRegion = (x: number, z: number): boolean => x >= PILOT_REGION.x0 && x <= PILOT_REGION.x1 && z >= PILOT_REGION.z0 && z <= PILOT_REGION.z1

/** The static architecture materials the model replaces (floors, walls, glazing). Furniture, screens and frames stay procedural. */
const ARCHITECTURE: ReadonlySet<string> = new Set(['floorOak', 'floorTerrazzo', 'floorMint', 'floorCore', 'floorSlate', 'floorBlue', 'wall', 'wallCap', 'wallMint', 'glass'])

/** True for a layout prim (centre x, z; material) that the model replaces. */
export const hidesPrim = (mat: MatKey, x: number, z: number): boolean => ARCHITECTURE.has(mat) && inPilotRegion(x, z)

/** True for a walk-mode box or ceiling tile (its centre) that the model replaces: upper walls, glazing and ceilings; door frames and rails stay. */
export const hidesWalkPart = (mat: 'wall' | 'frame' | 'glass' | 'ceiling', x: number, z: number): boolean => mat !== 'frame' && inPilotRegion(x, z)
