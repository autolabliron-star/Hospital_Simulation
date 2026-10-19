/**
 * The health kiosks' screens as tiles of the shared W4 status atlas (src/scene/w4kit/tiles.ts): `kiosk0`/`kiosk1` (the touchscreens), `bp0`/`bp1` (the
 * blood-pressure units' displays) and `triage` (a results list placed 2 mm in front of the triage desk's static list display). A tile is an anchor in the
 * world, a version and a painter: the atlas layer (built by the lab agent) checks versions at 4 Hz, repaints only the tiles that changed and uploads the
 * canvas at most 2 Hz. Nothing here runs per frame.
 *
 * `kioskTiles(source)` is pure (tests pass a fake source and a mock canvas); `registerKioskTiles` registers them and returns the function that removes them.
 */
import type { BuildingLayout, Prim } from '@/scene/building/layout'
import { TILE } from '@/scene/building/layout/screenTiles'
import { W4_TILE, registerTile, type W4Tile } from '@/scene/w4kit/tiles'
import type { HealthKioskState } from '@/sim/types'
import { bpScreenView, kioskScreenView, triageRows, triageVersion, type TriageSim } from '@/ui/kioskView'
import { KIOSKS } from './layout'
import { paintBpScreen, paintKioskScreen, paintTriageScreen } from './screens'

/** What the tiles read of the running hospital (a live binding: a Jump swaps the sim, so these are functions). */
export interface TileSource {
  kiosks(): readonly HealthKioskState[]
  triage(): TriageSim | null
  /** Bumped on every Jump, so a new hospital's tile never matches an old version by chance. */
  generation(): number
}

export interface TilePair {
  index: number
  tile: W4Tile
}

/** The triage desk's static list display (a `quad` prim of the building layout showing atlas tile `TILE.list`), or null when there is none. */
export function listDisplay(layout: Pick<BuildingLayout, 'prims'>): Prim | null {
  return layout.prims.find((p) => p.shape === 'quad' && p.tile === TILE.list) ?? null
}

/**
 * The anchor of a tile 2 mm in front of a quad prim: its centre moved along its normal, its heading and tilt, and the quad's own size (the tile covers the
 * old picture completely; a 16:10 tile on a slightly squarer quad is a few percent taller, which nobody sees).
 */
export function overlayAnchor(p: Prim, lift = 0.002): W4Tile['anchor'] {
  const lean = -(p.rotationX ?? 0)
  const cl = Math.cos(lean)
  const nx = Math.sin(p.rotationY) * cl
  const ny = Math.sin(lean)
  const nz = Math.cos(p.rotationY) * cl
  return { at: { x: p.position[0] + nx * lift, y: p.position[1] + ny * lift, z: p.position[2] + nz * lift }, heading: p.rotationY, w: p.size[0], h: p.size[1], tilt: lean }
}

const mix = (generation: number, v: number): number => generation * 0x1000000 + v

export function kioskTiles(source: TileSource, layout: Pick<BuildingLayout, 'prims'>): TilePair[] {
  const out: TilePair[] = []
  const slots: [number, number][] = [
    [W4_TILE.kiosk0, W4_TILE.bp0],
    [W4_TILE.kiosk1, W4_TILE.bp1],
  ]
  KIOSKS.forEach((a, i) => {
    const state = (): HealthKioskState | undefined => source.kiosks()[i]
    out.push({
      index: slots[i][0],
      tile: {
        anchor: { at: a.screen.at, heading: a.screen.heading, w: a.screen.w, h: a.screen.h, tilt: a.screen.tilt },
        version: () => mix(source.generation(), state()?.version ?? 0),
        paint: (ctx, w, h) => {
          const k = state()
          if (k) paintKioskScreen(ctx, w, h, kioskScreenView(k))
        },
      },
    })
    out.push({
      index: slots[i][1],
      tile: {
        anchor: { at: a.bpScreen.at, heading: a.bpScreen.heading, w: a.bpScreen.w, h: a.bpScreen.h, tilt: a.bpScreen.tilt },
        // the cuff bar moves between the sim's once-a-second bumps: 16 steps of it are part of the version
        version: () => mix(source.generation(), (state()?.version ?? 0) * 32 + Math.round((state()?.cuff ?? 0) * 16)),
        paint: (ctx, w, h) => {
          const k = state()
          if (k) paintBpScreen(ctx, w, h, bpScreenView(k))
        },
      },
    })
  })
  const list = listDisplay(layout)
  if (list) {
    out.push({
      index: W4_TILE.triage,
      tile: {
        anchor: overlayAnchor(list),
        version: () => {
          const s = source.triage()
          return mix(source.generation(), s ? triageVersion(s) & 0xfffff : 0)
        },
        paint: (ctx, w, h) => {
          const s = source.triage()
          const { rows, total } = s ? triageRows(s) : { rows: [], total: 0 }
          paintTriageScreen(ctx, w, h, rows, total)
        },
      },
    })
  }
  return out
}

/** Register every kiosk tile; returns the function that removes them all. */
export function registerKioskTiles(source: TileSource, layout: Pick<BuildingLayout, 'prims'>): () => void {
  const undo = kioskTiles(source, layout).map(({ index, tile }) => registerTile(index, tile))
  return () => {
    for (const u of undo) u()
  }
}
