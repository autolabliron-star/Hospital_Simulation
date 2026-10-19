/**
 * The roof cap (R2): one deck over the hospital east of the level-2 footprint with a skylight where the atrium is, a skirt round the outline up from the top of
 * the cut walls, two draw calls, never casting, and shown only while you walk on level 2.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEVEL2_FOOTPRINT } from '@/sim/levels'
import { AREAS, BUILDING, WALL } from '@/sim/places'
import { CAP, buildRoofCap, capCoversXZ } from '../layout/roofCap'
import {
  BUILDING_VISIBILITY_PRIORITY,
  level1WalkVisible,
  level2OverviewVisible,
  level2Visible,
  level2WalkVisible,
  roofCapVisible,
} from './levelVisibility'
import { compileRoofCap, estimateCapBudget } from './roofCap'

const boxes = buildRoofCap()
const atrium = AREAS.find((a) => a.id === 'atrium')!.rect

describe('the roof cap layout', () => {
  it('is a deck at 3.2 to 3.4 m over BUILDING minus the level-2 footprint, with a hole over the atrium', () => {
    expect(CAP.deckY0).toBe(3.2)
    expect(CAP.deckY1).toBe(3.4)
    // covered: the hospital proper, both strips beside the atrium
    for (const [x, z] of [[-39, 0], [-20, -21], [0, 21], [20, -18], [35, 18], [-10, 5]] as const) expect(capCoversXZ(boxes, x, z), `(${x}, ${z})`).toBe(true)
    // not covered: the level-2 footprint (its own floor slab is there) and the atrium
    for (const [x, z] of [[-55, 0], [-50, -15], [-42, 10]] as const) expect(capCoversXZ(boxes, x, z), `(${x}, ${z})`).toBe(false)
    for (const [x, z] of [[atrium.x0 + 3, 0], [(atrium.x0 + atrium.x1) / 2, 6], [atrium.x1 - 1, -10]] as const) expect(capCoversXZ(boxes, x, z), `atrium (${x}, ${z})`).toBe(false)
  })

  it('has a glass skylight over exactly the atrium, in a frame of rails', () => {
    const glass = boxes.filter((b) => b.mat === 'glass')
    expect(glass).toHaveLength(1)
    expect(glass[0].x0).toBe(atrium.x0)
    expect(glass[0].x1).toBe(atrium.x1)
    expect(glass[0].z0).toBe(atrium.z0)
    expect(glass[0].z1).toBe(atrium.z1)
    const rails = boxes.filter((b) => b.mat === 'wallCap' && b.y0 < CAP.skylightY && b.y1 > CAP.skylightY && b.x0 >= atrium.x0 - 0.1 && b.x1 <= atrium.x1 + 0.1)
    expect(rails.length).toBeGreaterThanOrEqual(6)
  })

  it('has a skirt round the outline from the top of the cut walls up past the deck, a hair thicker than the walls, and stops under the level-2 slab', () => {
    const skirt = boxes.filter((b) => b.mat === 'wallCap' && b.y0 < WALL.cutHeight)
    expect(skirt.length).toBeGreaterThanOrEqual(6)
    for (const b of skirt) expect(b.y0).toBeLessThan(WALL.cutHeight)
    // the east skirt reaches the parapet; the part under the footprint stops at the slab's underside (3.0 m)
    expect(Math.max(...skirt.map((b) => b.y1))).toBeCloseTo(CAP.deckY1 + CAP.parapet, 9)
    for (const b of skirt.filter((q) => q.x1 <= LEVEL2_FOOTPRINT.x1 + 1e-9)) expect(b.y1).toBeLessThanOrEqual(3.0 + 1e-9)
    // the outline: every skirt box lies on the outer faces of BUILDING
    for (const b of skirt) {
      expect(b.x0).toBeGreaterThanOrEqual(BUILDING.x0 - 0.13)
      expect(b.x1).toBeLessThanOrEqual(BUILDING.x1 + 0.13)
      expect(b.z0).toBeGreaterThanOrEqual(BUILDING.z0 - 0.13)
      expect(b.z1).toBeLessThanOrEqual(BUILDING.z1 + 0.13)
    }
  })

  it('is deterministic', () => {
    expect(JSON.stringify(buildRoofCap())).toBe(JSON.stringify(boxes))
  })
})

describe('the roof cap meshes', () => {
  const compiled = compileRoofCap()
  const budget = estimateCapBudget(compiled)

  it('is two draw calls (the body and the skylight) and a few hundred triangles', () => {
    expect(compiled.body).not.toBeNull()
    expect(compiled.glass).not.toBeNull()
    expect(budget.drawCalls).toBe(2)
    expect(budget.triangles).toBeLessThan(2000)
  })

  it('the component never casts and never asks for a re-bake of the sun shadow, and uses palette materials only', () => {
    const src = readFileSync(join(process.cwd(), 'src/scene/building/render/RoofCapLayer.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src).toMatch(/castShadow = false/)
    expect(src).not.toMatch(/castShadow = true/)
    expect(src).not.toMatch(/invalidateShadows|shadowMap/)
    expect(src).not.toMatch(/new \w*Material\(/)
    expect(src).toMatch(/MAT\.wallCap/)
    expect(src).toMatch(/MAT\.glass/)
  })
})

describe('what is shown when (the level frame decides, these rules read it)', () => {
  it('the roof cap is hidden except while walking on level 2', () => {
    expect(roofCapVisible(true, 2)).toBe(true)
    expect(roofCapVisible(false, 2)).toBe(false) // the overview's Level 2 wants the model open
    expect(roofCapVisible(true, 1)).toBe(false)
    expect(roofCapVisible(false, 1)).toBe(false)
  })

  it('the level-2 group is shown whenever level 2 is: the overview\'s Level 2 and walking on level 2, never otherwise', () => {
    expect(level2Visible(2)).toBe(true)
    expect(level2Visible(1)).toBe(false)
  })

  it('level 2\'s overview-only parts show in the overview\'s Level 2, its walk-only parts and walk building while walking on level 2', () => {
    expect(level2OverviewVisible(false, 2)).toBe(true)
    expect(level2OverviewVisible(true, 2)).toBe(false)
    expect(level2OverviewVisible(false, 1)).toBe(false)
    expect(level2WalkVisible(true, 2)).toBe(true)
    expect(level2WalkVisible(false, 2)).toBe(false)
    expect(level2WalkVisible(true, 1)).toBe(false)
  })

  it('level 1\'s walk building shows only while walking on level 1 (on level 2 the cap stands in for the roof)', () => {
    expect(level1WalkVisible(true, 1)).toBe(true)
    expect(level1WalkVisible(true, 2)).toBe(false)
    expect(level1WalkVisible(false, 1)).toBe(false)
    // exactly one of the two walk buildings, or none, at any time
    for (const walking of [true, false]) for (const shown of [1, 2] as const) expect(Number(level1WalkVisible(walking, shown)) + Number(level2WalkVisible(walking, shown))).toBeLessThanOrEqual(1)
  })

  it('the visibility callbacks run after the levels frame (-9.5) and before the labels', () => {
    expect(BUILDING_VISIBILITY_PRIORITY).toBeGreaterThan(-9.5)
    expect(BUILDING_VISIBILITY_PRIORITY).toBeLessThan(0)
  })
})
