/**
 * Registers the draw centre's four screens on the shared status atlas (src/scene/w4kit/tiles.ts). The atlas repaints a tile only when its `version`
 * changes, at most 2 Hz, and never inside a frame callback; the painters are in tilePaint.ts. They read `sim.blood` at paint time, so a Jump
 * (which swaps `sim`) needs nothing here.
 */
import { W4_TILE, registerTile } from '@/scene/w4kit/tiles'
import { sim } from '@/sim'
import { TILE_ANCHORS } from './dims'
import { paintCheckIn, paintManualSend, paintPrep, paintQueue, prepViewOf, queueViewOf } from './tilePaint'

/** Register the four tiles; returns the function that takes them out again. */
export function registerDrawTiles(): () => void {
  const undo = [
    registerTile(W4_TILE.drawCheckIn, {
      anchor: TILE_ANCHORS.drawCheckIn(),
      version: () => sim.blood.version,
      paint: (c, w, h) => paintCheckIn(c, w, h, queueViewOf(sim.blood.calling, sim.blood.queue).waiting),
    }),
    registerTile(W4_TILE.drawQueue, {
      anchor: TILE_ANCHORS.drawQueue(),
      version: () => sim.blood.version,
      paint: (c, w, h) => paintQueue(c, w, h, queueViewOf(sim.blood.calling, sim.blood.queue)),
    }),
    registerTile(W4_TILE.tubePrep, {
      anchor: TILE_ANCHORS.tubePrep(),
      version: () => sim.blood.prep.version,
      paint: (c, w, h) => paintPrep(c, w, h, prepViewOf(sim.blood.prep)),
    }),
    registerTile(W4_TILE.manualSend, {
      anchor: TILE_ANCHORS.manualSend(),
      version: () => sim.blood.stats.nurseDraws,
      paint: (c, w, h) => paintManualSend(c, w, h, sim.blood.stats.nurseDraws),
    }),
  ]
  return () => {
    for (const u of undo) u()
  }
}
