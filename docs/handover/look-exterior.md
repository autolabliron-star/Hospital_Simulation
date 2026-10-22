# Look: the exterior (what you see through the glazed entrance)

Goal: through the lobby's west glazing and around the building the hospital looks like a real place ("clean clinical modern"), not a model on a
slab. This adds a forecourt, a drop-off lay-by, a ring road, a car park with parked cars, street lights, trees, kerbs and hedges, the neighbouring
blocks on the horizon, and a ground that runs 250 m and dissolves into the sky's haze. All procedural, no downloads, no textures.

## Wire-up (one line, needs the orchestrator)

`src/scene/World.tsx`:

```tsx
import { Exterior } from './landscape/grounds'
...
      <Building />
      <Exterior />
```

Until that line exists, walk mode has NO ground at all outside the walls (the model's slab, lawns and apron are now overview-only, see below).
To revert instantly, set `OV` in `src/scene/landscape/exterior.ts` to `{}`.

## What is where

| File | Role |
|---|---|
| `landscape/grounds/plan.ts` | site constants: layer heights, forecourt, lay-by, ring road, car park, keep-clear rectangles (pure) |
| `landscape/grounds/meshBuilder.ts` | pure triangle-soup builder (flat shading, vertex colours, faces wound to a hint so none can be inside out) |
| `landscape/grounds/site.ts` | the whole exterior as data: one merged static mesh + tree, car and lamp instance lists + a `solids` ledger (pure, seeded) |
| `landscape/grounds/templates.ts` | the three repeating shapes: tree (112 tris), hatchback (60), street light (44) |
| `landscape/grounds/material.ts` | two vertex-coloured MeshStandardMaterials sharing one program, plus the horizon haze |
| `landscape/grounds/scene.ts` | three.js objects from the data (4 meshes) |
| `landscape/grounds/Exterior.tsx` | the mount; `visible` follows `isWalkMode` (one boolean a frame, nothing allocated) |
| `landscape/layoutTrees.ts` | the layout's own 11 trees (moved out of `exterior.ts` so the exterior can keep clear of them) |
| `landscape/exterior.ts` | edited: model base overview-only, the entrance canopy at 3.1 m with a notch for the authored porch |
| `landscape/grounds/site.test.ts` | 20 node tests (below) |

## What you see, west to east

Standing in the plaza or in the lobby looking out through the door (x = -62, z = 0), west:
1. Forecourt: 2.4 x 1.2 m porcelain slabs in running bond, seeded tone variation, 2.4 cm joints; a darker inlay band along the door's axis. Hedge in a
   planter on the plaza's north edge, a slim steel rail on posts on its west edge (these are what the collision fences there look like), a bench pair,
   long planters, bins, tree pits with grates, bollards along the kerb, four lamps.
2. Kerb (15 cm), then the lay-by (a widening of the ring road, tapered ends, broken edge line, bay ends, a hatched box in front of the doors, direction
   arrows, double yellow on the kerb) with two parked cars either side of the axis.
3. The ring road's west leg (9 m, graphite asphalt, dashed centre line, edge lines, narrow kerbs), the ring rounds its corners (R 14 m) and closes
   round the whole campus (x -92..70, z -48..48); lamps every 27 m on the inside.
4. A verge with a tree row (a gap on the axis) and a clipped hedge, then the car park (33 x 106 m, 4 rows of bays, two driveways, white bay lines,
   about 100 cars in 7 muted paints, lamps) and beyond it, 150 to 230 m out, low blocks (3 to 7 floors, some 9 to 13) with glazing bands and rooftop plant.
5. The ground is a 250 m disc; everything fades with exponential-squared haze to the sky's horizon colour (below).

North and south of the building (seen from the wards): the 2.4 m paving apron, mown-striped lawn, the ring road, trees outside it. East: the same.

## Material and light

- Two materials, both `vertexColors`, `roughness 0.92` (matte: ground, props, trees, lamps, blocks) and `0.34 / metalness 0.12` (the cars). One shader
  program serves both (same `customProgramCacheKey`); the instanced variants are separate programs. They are mounted hidden at start, so the warm-up's
  traversal compiles them behind the loading screen, and `registerWarmSource('exterior')` lists them too.
- Colours are scene-linear floats in the vertex colour attribute; instance colour is the car's paint or a tree's tone (a multiplier near 1, so the
  trunk stays brown).
- **Haze, not fog.** `scene.fog` would recompile the building. The materials instead mix their final colour toward the sky dome's horizon pixel with
  `1 - exp(-(d / 108 m)^2)`, `d = length(vViewPosition)`. The target is computed exactly as `SkyDome.tsx` computes its horizon, from the shared
  `skyUniforms` (`uSky`, `uHorizon`, `uDay`, `uBlend`), so ground, blocks and sky meet at every hour (blue day, peach dusk, deep blue-grey night)
  with no per-frame work. 63 % at 108 m, 97.5 % at the rim as seen from the plaza. Knob: `HAZE_DISTANCE` in `material.ts` (smaller = hazier).
- No lights, no shadow casting or receiving (the baked sun map holds the cut-height building, so a ground that received it would show a 1.3 m
  building's shadow).

## Budget (measured by the tests, `?probe=1` should confirm)

| | |
|---|---|
| Draw calls | **4** (ground+props merged, trees, cars, street lights), walk and presentation only; 0 in the overview |
| Triangles | **about 32 k** (static 6.5 k; about 168 trees x 112; 101 cars x 60; 21 lamps x 44) |
| Materials / textures / lights | 2 / 0 / 0 |
| Shadow passes | 0 added |
| Frame cost | the visibility flag; no allocation |

Overview side effect: the model base moved into overview-only merged meshes (`concrete`, `grass`, `stonePath`; `plinth` was already its own), which
adds **3 draw calls in the overview** (building estimate 53 -> 56 of its 90) and none while walking (the overview group is hidden then).

## The model base is overview-only now

`exterior.ts`: the plinth and its lip, the lawns, the apron, the forecourt paving carry `overviewOnly` (`OV`). The ambulance bay (pad, markings,
ambulance, its canopy), the layout's trees, the forecourt planters and the entrance canopy stay in both modes. The north, south and east apron and the
forecourt are thin boxes rather than `f.plane` because `Frame.plane` does not copy `overviewOnly` to its prim (Change request).

The entrance canopy now hangs at **3.1 m** (underside), the height of the authored porch slab (`tools/arch/lobby.py`: x -64.8..-62.1, z +-2.6,
3.1..3.32 m). With `?building=model` the procedural slab leaves exactly that rectangle out (`notch`) so there are no coplanar faces; without the flag
it is the full slab with its mint edges as before. The four columns, their collision footprints (`entrance:column0..3`) and the canopy's overhead
footprint are unchanged.

One test outside `landscape/` changed with it: `src/scene/building/layout/walk/walk.test.ts` ("leaves the overview layout untouched") asserted that
the room leaves are the only overview-only prims; it now ignores the model base's materials (`plinth`, `grass`, `stonePath`, `concrete`).

## Keep-clear (tested)

- Nothing of ours is above the ground inside the building rectangle, and no solid, tree, car or lamp is within 1.5 m of it.
- The walk from the door across the plaza (x -74..-62, z +-2.2), the plaza itself (x -74..-62, z +-9, where you walk) and the ambulance bay (x -76.2..-61.8,
  z 6.2..21.8) are free of every solid; the rail and hedge stand just outside the plaza's fences.
- No tree on a road, the car park, the forecourt, or within 3.9 m of a layout tree; no two cars closer than 1.9 m; every block clear of the campus
  and inside the 250 m disc.

## Tests (`npx vitest run src/scene/landscape --maxWorkers=2`)

Budget (draw calls <= 8, triangles <= 60 k, 2 materials, all static, no shadows), determinism (identical build twice; no `Math.random` anywhere under
`src/scene/landscape`), geometry soundness (every triangle faces its stored normal, closed solids face outward, nothing NaN, inside the disc), layer
spacing, keep-clear (building, walk, plaza, bay, trees, blocks, cars), the ring closing, the layout handing the ground over (`overviewOnly`, canopy
height), and the haze wiring (uniforms are the shared sky uniforms, one program key). Also run `src/scene/building/layout/layout.test.ts`: it still passes.

## Change requests

1. `src/scene/World.tsx`: the two lines above.
2. `src/scene/building/layout/builder.ts`: `Frame.plane` ignores `PrimOpts.overviewOnly` / `walkOnly` (it builds its prim by hand). One line each in
   its object literal would let `exterior.ts` use `plane` again. Not needed meanwhile.
3. `tools/arch` (the lobby agent): `shell.paving` tops out at -0.010, 5 mm above the exterior's slabs, so the model's paving wins where they overlap
   (x -76.5..-62.15, z +-24.5); that is intended. Its render-only context (`landscape()`: lawn, hedge, trees at x < -76) is not what the game shows
   beyond the paving; the baked skylight in the lobby therefore sees different ground. Harmless for lighting; if the owner wants the bake to see the
   real thing, mirror the car park / road / blocks there.

## Open questions / risks

- **Not seen by eye** (no browsers by rule). The colours, the haze distance (`HAZE_DISTANCE`), the tree and block density and the block heights are
  derived, not eyeballed. Top-down renders of the plan were rasterised offline from the same data to check the layout (lay-by tapers, ring, car park,
  forecourt furniture), nothing more. First thing to judge on screen: haze strength on the far blocks (they should read as pale silhouettes at
  100 to 200 m), the paving tone variation (7 %), and whether the lay-by cars should go.
- The shader patch (`#include <fog_fragment>` replaced, reading `vViewPosition`) is standard for three 0.186 but has not run on a GPU here. The
  warm-up compiles it behind the loading screen; if it failed, three would log a program error at that moment, not later.
- The lamps are not emissive (it is a day scene); at night they are dark poles. The cars and the lay-by are frozen, which reads fine in a still
  presentation shot and is odd if someone stares.
- Camera `near` is 1 m in the overview; walk mode may use less. The layers were spaced for 24-bit depth at near = 1 (3 cm and more far out, 4 to 6 mm
  only near). If a shimmer appears on the far asphalt, raise `Y.asphalt - Y.lawn`.
- `Exterior` is visible in every walk mode on both levels (level 2's windows look out over the same ground).
- Quest 3: 4 draw calls / 32 k triangles is well inside the 8 / 60 k allowance; instancing is hardware-instanced, nothing here needs multiview work.
