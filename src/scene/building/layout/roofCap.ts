/**
 * The roof cap (R2), as plain boxes: what level 1 looks like from the windows of level 2. The overview's level 1 is the architect's section cut
 * (walls to 1.3 m, no roof), and the walk-mode building that closes it (upper walls, ceilings) is hidden while you walk on level 2, so without this
 * the hospital under the storey would be an open-topped model. The cap is one flat roof over BUILDING minus the level-2 footprint (the footprint is
 * covered by level 2's own floor slab), a parapet-high skirt round the outline from the top of the cut walls up to the roof, and a glass skylight in
 * the healing atrium (the atrium keeps its sky, so it gets a roof you see through). Two meshes in all: the body in `wallCap` (the building's own cap
 * grey, a program the building already has) and the skylight in `glass`. Drawn coordinates, no level group: it stands on level 1.
 *
 * It is shown only while you walk on level 2 (render/levelVisibility.ts) and never casts into the baked sun shadow.
 */
import { AREAS, BUILDING, WALL } from '@/sim/places'
import { LEVEL2_FOOTPRINT, LEVEL_Y } from '@/sim/levels'
import { SLAB } from '@/scene/rooms/surgery/shell'

export interface CapBox {
  mat: 'wallCap' | 'glass'
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
}

/** The roof deck's underside and top, the skirt's thickness (a hair thicker than the 0.2 m walls it stands on) and the parapet above the deck. */
export const CAP = { deckY0: 3.2, deckY1: 3.4, parapet: 0.15, skirt: 0.24, skylightY: 3.3, skylightGlass: 0.02 } as const

/** The skirt starts a hair below the top of the cut walls (so no sliver shows) and runs up past the deck. */
const SKIRT_Y0 = WALL.cutHeight - 0.02
const SKIRT_Y1 = CAP.deckY1 + CAP.parapet
/** Under the level-2 footprint the skirt stops at the underside of level 2's floor slab, which carries the outline up from there. */
const SKIRT_Y1_UNDER = LEVEL_Y[2] - SLAB.thickness - 0.02
/** Half the wall thickness, plus the skirt's extra: the outline of the roof is the outer faces of the walls. */
const OUT = WALL.thickness / 2 + (CAP.skirt - WALL.thickness) / 2

export function buildRoofCap(): CapBox[] {
  const out: CapBox[] = []
  const box = (mat: CapBox['mat'], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
    if (x1 - x0 > 1e-6 && z1 - z0 > 1e-6) out.push({ mat, x0, x1, y0, y1, z0, z1 })
  }
  const x0 = BUILDING.x0 - OUT
  const x1 = BUILDING.x1 + OUT
  const z0 = BUILDING.z0 - OUT
  const z1 = BUILDING.z1 + OUT

  // the deck: everything east of the level-2 footprint, with a hole over the atrium
  const atrium = AREAS.find((a) => a.id === 'atrium')!.rect
  const deckX0 = LEVEL2_FOOTPRINT.x1
  const dY0 = CAP.deckY0
  const dY1 = CAP.deckY1
  box('wallCap', deckX0, atrium.x0, dY0, dY1, z0, z1) // west of the atrium (the hospital proper)
  box('wallCap', atrium.x0, x1, dY0, dY1, z0, atrium.z0) // north of it
  box('wallCap', atrium.x0, x1, dY0, dY1, atrium.z1, z1) // south of it
  // the skirt round the outline, with a parapet over the deck; under the level-2 footprint (west of x = -40) it stops at the underside of the floor slab
  const fp = LEVEL2_FOOTPRINT.x1
  for (const [za, zb] of [
    [z0, z0 + CAP.skirt],
    [z1 - CAP.skirt, z1],
  ] as const) {
    box('wallCap', x0, fp, SKIRT_Y0, SKIRT_Y1_UNDER, za, zb)
    box('wallCap', fp, x1, SKIRT_Y0, SKIRT_Y1, za, zb)
  }
  box('wallCap', x0, x0 + CAP.skirt, SKIRT_Y0, SKIRT_Y1_UNDER, z0, z1)
  box('wallCap', x1 - CAP.skirt, x1, SKIRT_Y0, SKIRT_Y1, z0, z1)

  // the skylight over the atrium: one pane in a frame of four rails and a mullion every 4 m each way
  const g0 = CAP.skylightY - CAP.skylightGlass / 2
  const g1 = CAP.skylightY + CAP.skylightGlass / 2
  box('glass', atrium.x0, atrium.x1, g0, g1, atrium.z0, atrium.z1)
  const rail = 0.08
  const rY0 = CAP.skylightY - 0.06
  const rY1 = CAP.skylightY + 0.06
  for (const z of [atrium.z0, atrium.z1]) box('wallCap', atrium.x0, atrium.x1, rY0, rY1, z - rail / 2, z + rail / 2)
  for (const x of [atrium.x0, atrium.x1]) box('wallCap', x - rail / 2, x + rail / 2, rY0, rY1, atrium.z0, atrium.z1)
  for (let x = atrium.x0 + 4; x < atrium.x1 - 0.5; x += 4) box('wallCap', x - rail / 4, x + rail / 4, rY0, rY1, atrium.z0, atrium.z1)
  for (let z = atrium.z0 + 4; z < atrium.z1 - 0.5; z += 4) box('wallCap', atrium.x0, atrium.x1, rY0, rY1, z - rail / 4, z + rail / 4)
  return out
}

/** The deck covers the whole building outline except the level-2 footprint and the atrium (where the skylight is), as a check for the tests. */
export function capCoversXZ(boxes: readonly CapBox[], x: number, z: number): boolean {
  return boxes.some((b) => b.mat === 'wallCap' && b.y0 === CAP.deckY0 && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1)
}

