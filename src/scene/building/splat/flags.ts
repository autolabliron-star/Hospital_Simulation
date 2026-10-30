/**
 * The Gaussian-splat pilot (docs/research/real-simulation-engines.md, option A): `?splat=<zone>` draws that zone's static building as a splat
 * trained from its own Cycles views (tools/arch/splat_views.py), in place of its baked model, while you walk. Off by default. Pure, so node can
 * test it.
 */
const SPLAT_ZONES: readonly string[] = ['lobby']

export function parseSplatFlag(search: string): string | null {
  try {
    const z = new URLSearchParams(search).get('splat')
    return z !== null && SPLAT_ZONES.includes(z) ? z : null
  } catch {
    return null
  }
}

/** This page's splat zone, read once (none in node). */
export const SPLAT_ZONE: string | null = typeof window === 'undefined' ? null : parseSplatFlag(window.location.search)

/**
 * Which zone's baked model the splat stands in for, and whether it does this frame (walking on its level, splat loaded). Written by
 * SplatZone's frame callback before the building's culling reads it (FRAME_PRIORITY.splatSwap < BUILDING_VISIBILITY_PRIORITY).
 */
export const splatSwap: { zone: string | null; shown: boolean } = { zone: null, shown: false }
