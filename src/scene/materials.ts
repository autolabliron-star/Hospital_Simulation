/**
 * The shared material palette: the "architect's model" look in about twenty materials. Every layer uses
 * these instances (never `new MeshStandardMaterial` per mesh), so the whole hospital compiles a handful
 * of shader programs and batches well. Per-object tint comes from instance colours or vertex colours,
 * not from new materials. Owned by the orchestrator; ask before adding a key.
 *
 * Emissive caps (skill pitfall "too-bright screens"): status lights ≤ 2.5, screens ≤ 1.2, lane lines ≤ 0.6.
 */
import { Color, DoubleSide, MeshStandardMaterial, type Material } from 'three'

export type MatKey =
  // floors
  | 'floorOak'
  | 'floorTerrazzo'
  | 'floorMint'
  | 'floorCore'
  | 'floorSlate'
  | 'floorBlue'
  | 'grass'
  | 'stonePath'
  | 'plinth'
  // walls and structure
  | 'wall'
  | 'wallCap'
  | 'wallMint'
  | 'glass'
  | 'frame'
  | 'metalDark'
  // objects
  | 'whitePlastic'
  | 'fabricSage'
  | 'fabricTeal'
  | 'linen'
  | 'woodOak'
  | 'leaf'
  | 'leafDark'
  | 'trunk'
  | 'concrete'
  | 'screen'
  | 'rubber'
  // light
  | 'glowTeal'
  | 'glowWarm'
  | 'laneLine'
  // white base for instanced or vertex-coloured meshes (tint comes from the instance)
  | 'tinted'
  | 'tintedGlow'

function std(color: string, roughness: number, metalness = 0, extra: Partial<MeshStandardMaterial> = {}): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: new Color(color), roughness, metalness })
  Object.assign(m, extra)
  return m
}

function glow(color: string, intensity: number): MeshStandardMaterial {
  return std(color, 0.4, 0, { emissive: new Color(color), emissiveIntensity: intensity, toneMapped: true })
}

export const MAT: Record<MatKey, MeshStandardMaterial> = {
  floorOak: std('#eadcc4', 0.72),
  floorTerrazzo: std('#f3f1ec', 0.55),
  floorMint: std('#e2efe8', 0.6),
  floorCore: std('#e3f3f0', 0.28),
  // command center: a soft blue-grey, dark enough for the screens to glow, light enough not to read as a hole
  floorSlate: std('#8a9799', 0.6),
  floorBlue: std('#e3ebf1', 0.6),
  grass: std('#a8c897', 0.95),
  stonePath: std('#dcd6cc', 0.8),
  plinth: std('#d5dcda', 0.9),

  wall: std('#fbfbf8', 0.86),
  wallCap: std('#cfd6d4', 0.7),
  wallMint: std('#bfe3d9', 0.8),
  // No transmission (it re-renders the scene): a thin transparent sheet with environment reflections.
  glass: std('#d6efec', 0.06, 0, { transparent: true, opacity: 0.2, depthWrite: false, side: DoubleSide, envMapIntensity: 1.4 }),
  frame: std('#c6cdcf', 0.35, 0.6),
  metalDark: std('#3a4245', 0.45, 0.5),

  whitePlastic: std('#f5f6f6', 0.34),
  fabricSage: std('#a7bdab', 0.92),
  fabricTeal: std('#5ea89c', 0.9),
  linen: std('#ffffff', 0.9),
  woodOak: std('#c9a678', 0.6),
  leaf: std('#6fa86c', 0.85),
  leafDark: std('#4d8659', 0.85),
  trunk: std('#8a6a4c', 0.9),
  concrete: std('#c9c5be', 0.9),
  screen: std('#1c2527', 0.35, 0.2),
  rubber: std('#2b3133', 0.8),

  glowTeal: glow('#1fb5ad', 2.2),
  glowWarm: glow('#fff1d6', 1.2),
  laneLine: glow('#22a89f', 0.5),

  tinted: std('#ffffff', 0.6),
  tintedGlow: std('#ffffff', 0.4, 0, { emissive: new Color('#ffffff'), emissiveIntensity: 0.9 }),
}

/**
 * In three the emissive term is not multiplied by the instance (or vertex) colour, so a white emissive would wash
 * every tint out to white. Patch `tintedGlow` once so its glow follows the instance colour (colours above 1 bloom).
 * The flag lets src/scene/robots/tintGlow.ts (which did this first, at runtime) see it is already done.
 */
;(function emissiveFollowsInstanceColour(m: MeshStandardMaterial) {
  const target = 'vec3 totalEmissiveRadiance = emissive;'
  m.userData.emissiveTint = true
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      target,
      `${target}
	#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
		totalEmissiveRadiance *= vColor.rgb;
	#endif`,
    )
  }
  m.customProgramCacheKey = () => 'tintedGlow:emissive-tint'
})(MAT.tintedGlow)

/** Every palette material, for the shader warm-up. */
export const ALL_MATERIALS: Material[] = Object.values(MAT)

/** Status colours shared by pods, drawers and the HUD. */
export const STATUS = {
  idle: '#f5f7f7',
  teal: '#19a6a0',
  amber: '#f0a33a',
  green: '#3ccf6e',
  off: '#9aa6a8',
} as const

/** Wayfinding line colours ("follow the blue line to Ward A"). */
export const WAYFINDING = {
  wardA: '#3f7fd1',
  wardB: '#2f9e6e',
  emergency: '#e05a4f',
  atrium: '#e0a03a',
  diagnostics: '#8a6bd1',
} as const
