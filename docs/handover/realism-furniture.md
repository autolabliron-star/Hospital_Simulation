# Realism step 1: the static furniture in the bake (report)

Goal (owner, 2026-10-25): the hospital must look like a real place. One suspected cause: static procedural game furniture drawn on top of
the baked building, lit only by live lights, without contact shadows. This step moves what is left of it into the Blender bake, zone by
zone, hides the procedural copies through the zones' `replaces` keys, and fixes what reads as fake in the bake itself.

## 1. Inventory: what was still procedural (before)

Measured in node against the shipped `public/assets/building/manifest.json` (2026-10-24 final bakes): every layout prim inside a zone's
areas that no `replaces` key and no shell rule covers, minus what the runtime always keeps (`quad` screens, `screen`, `metalDark` above 1 m =
live bezels). Script: `/private/tmp/claude-501/-Users-lironhagbi-3D-Hospital/3566c724-1697-47e6-a4e5-4fc53fbc3f3d/scratchpad/furniture/inventory.ts`
(`npx tsx --tsconfig tsconfig.json <it> [zone] [--prims]`); the regression test is `tools/arch/furniture-coverage.test.ts`.

**Finding: almost all static furniture was already baked.** The rollout designs (er, wardA, wardB, theatres, imaging, core, atrium, lobby)
already model the beds, ER trolleys, curtains, monitor arms, headwalls, IV poles with pumps, lockers, over-bed tables, recliners, chairs,
desks, cabinets, sinks and dispensers with the kit, and list their footprints in REPLACES. The bed / trolley / curtain / IV pole the owner's
shots show are the BAKED kit pieces; what makes them read "game" is how they are lit and shaded at runtime (the other agent's work) and, for
the curtains, a broken lightmap (section 2). What was still procedural, per zone (prims, grouped):

| zone | still procedural (static furniture) | still procedural (devices / live / not furniture) |
|---|---|---|
| er | the procedural exterior's old ambulance-door frame standing in the designed west glazing (3 frame boxes, z 11.9..16.1) | floor disc |
| wardA | none | overview-only door leaves in the corridor, floor lines |
| wardB | none | the lab (16 groups: benches, analysers, robots; kept by design), the pneumatic station, overview door leaves |
| theatres | **OR: back table (15), Mayo stand (6), anaesthetist's stool (4), both console chairs + the consoles' foot pedals (2 x 12), circulator's desk (6)** | OR table, consoles, vision cart, anaesthesia machine, light heads / pendant / boom, lift panels, slab |
| imaging | **MRI and CT operators' chairs (2 x 4), the three blood-draw chairs (3 x 8), the changing cubicles' 4 partitions** | blood-draw robots, prep machine, check-in, send station (~140 prims), X-ray table + detector, signs |
| core | none (the video wall's plinths: part of the live wall) | slab under the floor |
| atrium | none | |
| lobby | the spine's 2 benches and 4 planters (`spine:*`) | W4 health kiosks, self check-in kiosks, lift panels |

Not layout prims at all (React layers, live by design, the other agent lights them): the ward beds' live backrest + pillow, meal trays,
bedside screens, MedDrawer cabinets, monitor faces, imaging machines, the surgical robot, lab / pharmacy / meal robots, people and their gear
(the teal blankets on lying patients in the ER shot are the crowd's).

## 2. What changed

### The curtains' lightmap (every zone with curtains: er, wardA, wardB, theatres)
The owner's "blotchy / grey" curtains were a broken lightmap, not lighting. `bake.py unwrap('sheet')` cut a seam at every edge sharper than
80 degrees; a gathered curtain's pleats fold more than that, so each curtain fell into ~25 cm x 2.4 m islands which the packer laid 6 texels
tall (ER: 714 islands, 41 x 6 px for 1 m2 each). Mipmaps and bilinear filtering bled neighbouring strips into each other: horizontal bands
and smudges. Now:
- `unwrap` 'sheet': per connected piece, a curtain (a tall, all-upright ribbon) gets seams only on its horizontal sharp edges (sheet vs hem
  and top) and round its 8 mm end caps, so each side of a curtain unfolds as ONE exact strip (ER: 101 islands); everything else on the
  Curtain material (blankets, drapes, covers) keeps the old 80-degree rule.
- `materials.json` Curtain: `lightmap: 1024` (a 3.5 cm pleat face gets ~2 texels instead of 0.6, so the folds' light and shade resolve
  instead of aliasing), `bakeSamples: 1024`, and the new `lightmapBlur: 0.75` (texels; `bake.py smooth_lightmap`: a gaussian inside the
  baked texels only, after the denoiser).
- `bake.py smooth_lightmap` / `materials.py lightmap_blur_of` / `generate.py`: the new option, off for every other material.
- Wall tints (WallTintBlue / Sage / Sand / Lilac): `bakeSamples: 1024` (the ward bed-head wall's grain).

### theatres: the OR's static furniture (`zones/theatres.py or_furniture`)
On the procedural room's own footprints and seats: the draped back table (kit `theatre.instrument_table`, 1.5 x 0.72, top 0.9), the Mayo
stand (kit, tray 0.95 over the table's foot), the anaesthetist's stool (seat 0.55, low back), the two console operators' chairs (seat 0.45)
and the consoles' foot-pedal trays (they stand inside the chairs' footprints), the circulator's standing desk (carcass, drawers, oak top,
phone, tray; its monitor, stand and keyboard stay live). New kit item `support.pedestal_chair` (round weighted base, gas lift, seat at the
sim seat's height, optional back and arms); `support.office_chair` got `seat_h` / `arms` (defaults unchanged: identical geometry).
REPLACES += `footprint:l2:or:{backtable,mayo,stool,desk}`, `footprint:l2:or:console:{surgeon,teach}:chair`.

### imaging: seating and partitions (`zones/imaging.py seating`)
The MRI and CT operators' chairs on `console:mri` / `console:ct` (pedestal chairs, seat 0.48), the three phlebotomy chairs on
`drawChair:robot:<i>` (seat 0.45, padded arms 0.13 above it), the four changing-cubicle partitions (compact-laminate panels raised 150 mm on
stainless posts). REPLACES += `footprint:imaging:cubicles:part*` and rects round the five chairs (they have no footprint, or share it with
the robots' arm cradles, which stay).

### er
REPLACES += `rect:-62.15,-61.85,11.8,16.2`: the procedural exterior's obsolete ambulance-door frame (two 1.3 m posts and a rail in the
designed glazing; the real ambulance doors are at z 9.2..11.6).

## 3. Per zone: budgets before / after
(filled in as each zone is baked and built)

| zone | draws before -> after | tris before -> after | lightmaps MB before -> after | what changed | baked |
|---|---|---|---|---|---|
| er | 27 -> 27 | 168 148 -> 168 148 | 10.00 -> 11.00 | curtain lightmap (1024, one strip per side), tint samples, REPLACES + ambulance-door frame rect | final, 2026-10-25 11:20 (679 s) |
| wardA | 31 -> 31 | 194 162 -> 194 162 | 12.33 -> 13.33 | curtain lightmap (1024, one strip per side), tint samples 1024 (bed-head wall grain) | final, 2026-10-25 11:50 (843 s) |
| wardB | 28 -> 28 | 198 294 -> 198 294 | 12.08 -> 13.08 | curtain lightmap (1024, one strip per side), tint samples 1024 | final, 2026-10-25 12:05 (821 s) |
| theatres | 34 -> 34 | 175 326 -> 183 302 | 13.77 -> 13.77 | OR furniture baked (back table, Mayo, stool, 2 console chairs + pedals, circulator desk) + 6 REPLACES keys; curtain unwrap fix (the budget fitter keeps Curtain at 512 here: Soil, DoorFrame, Curtain, SolidSurface, Terrazzo were halved as before) | final, 2026-10-25 12:20 (781 s) |
| imaging | 28 -> 28 | 63 420 -> 68 964 | 10.08 -> 10.08 | MRI/CT operators' chairs, 3 phlebotomy chairs, 4 cubicle partitions baked + REPLACES (1 footprint family, 5 rects); tint samples 1024 | final, 2026-10-25 12:29 (531 s) |
| lobby | 24 -> 24 | 27 982 -> 34 166 | 15.44 -> 15.25 | the spine's 2 benches (oak, with backs) and 4 planters baked + REPLACES ['lobby', 'footprint:spine:*']; new design hint LIGHTMAP_DENSITY 1600 so the hero keeps its approved maps (a first rebake at the default 400 came out at 8.25 MB: Terrazzo 1024, desk 256; now Terrazzo 2048, walls / plaster / oak 1024, the desk's SolidSurface 512 instead of 1024) | final, 2026-10-25 12:58 (974 s) |

Totals after (optimize.mjs): 8 zones, 208 building draws (unchanged), 1 097 162 triangles (+19.7k), lightmaps 94.6 MB + shared materials
19.5 MB + proxies 10.6 MB = 124.8 MB GPU, every zone within its Quest 3 slice. core and atrium were not touched (nothing static left).

Inventory after (same script): er 2 prims left (floor marks), wardA 22 and wardB 150 (overview door leaves, lab, pneumatic station), theatres
115 (the OR's devices, light heads, lift panels), imaging 195 (the blood-draw robots and machines, X-ray table / bucky, signs), lobby 126
(health kiosks, check-in kiosks, lift panels), core 12 (video wall plinths, slab). Every one of them is a live device, a lift panel, a floor
mark or a non-furniture part, as `tools/arch/furniture-coverage.test.ts` asserts (with the reason for each).

### Kit
- `support.pedestal_chair` (new), `support.office_chair(seat_h, arms)` (defaults: unchanged geometry); `kit/selftest.py` covers both:
  pedestal chair 936 tris / 3 mats, stool 540 / 3, office chair at 0.45 1428 / 4, 0 winding flips.

## 4. How to verify
```
npm run arch:plan
npx tsc --noEmit -p .                                                                  # passes
/private/tmp/claude-501/hospital-vitest.sh tools/arch src/scene/building/model src/scene/rooms   # 23 files, 288 tests pass (incl. furniture-coverage)
npx vite build --outDir /private/tmp/claude-501/hospital-step1-check                   # builds
B=~/Applications/Blender.app/Contents/MacOS/Blender
/private/tmp/claude-501/hospital-blender.sh $B -b --factory-startup -P tools/arch/kit/selftest.py
# the runtime look offline (lightmap x albedo, no live lights), from each zone's saved .blend:
/private/tmp/claude-501/hospital-blender.sh $B -b assets-src/arch/out/zones/wardA/wardA.blend -P tools/arch/preview_lightmaps.py -- --zone wardA --out /tmp/x
```
Runtime-look previews of the new bakes: `/private/tmp/claude-501/-Users-lironhagbi-3D-Hospital/3566c724-1697-47e6-a4e5-4fc53fbc3f3d/scratchpad/furniture/after/lightmap-preview-<zone>-<i>.jpg`
(before: `.../scratchpad/furniture/prev/`); Cycles drafts of the new OR and imaging furniture: `.../scratchpad/furniture/stills/`.

Browser poses (sim x, z -> look x, z; level 2 is drawn x + 150), the best view of each zone's change:
- er: (-49.6, 6.7) -> (-55.5, 20.5) (the owner's shot 1: the bay curtains); close: (-59.3, 17.0) -> (-60.7, 21.4)
- wardA: (-13.9, -16.4) -> (-12.0, -21.5) (shot 3: the room's curtain); wardB: (-13.9, 16.4) -> (-12.0, 21.5)
- theatres: (104.0, 3.0) -> (101.5, 8.5) (inside the OR door: back table, Mayo stand, stool, console chairs); recovery curtains: (105.1, 13.4) -> (99.0, 21.2)
- imaging: (-27.3, 3.0) -> (-23.4, 10.6) (blood-draw chairs and cubicle partitions); MRI control chair: (-32.1, -2.6) -> (-37.4, -5.2)
- lobby: (-42.0, -1.0) -> (-40.6, -8.0) (the spine's bench and planters)
- core, atrium: unchanged

## 5. Change requests
- **Runtime (src/scene/building/model/region.ts, other agent):** the live bezels (`metalDark` above 1 m) can never be replaced, so every
  monitor keeps a procedural dark frame on top of the baked arm / stand. A key such as `bezels:<rect>` (take the bezels in a rect, keep
  only the `quad` / `screen` faces) would let a zone bake the monitor housings. Not needed for anything in this step.
- No contract file (`src/sim/*`, zones.json) changes; no collision markers were needed (every baked piece stands on an existing footprint
  or seat).

## 6. Open questions / risks
- Pipeline drift: plan_lightmaps' per-material caps (added after the lobby's approved bake) gave the lobby half its lightmap memory on a
  plain rebake. The lobby now sets `LIGHTMAP_DENSITY = 1600`; other zones still use 400 texels/m2 and stay at 10-14 MB of their 16 MB:
  raising their density (furniture contact shadows are 5 cm texels) is a cheap next step for realism.
- theatres: the budget fitter keeps Curtain at 512 (the unwrap fix and smoothing still apply); the ward bed-head tint wall keeps a slight
  grain (the plaster texture under a 512 map); stainless reads dark in the offline preview (no specular there; the runtime probe adds it).
- The OR's operating table, consoles, carts and the blood-draw robots stay procedural (devices); baking their static shells would need the
  bezel change above and care around animated parts.
- The lab (ward B) stays procedural by design; ward B is at 198k of 200k triangles.
