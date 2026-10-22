# Look pass: the lobby as a real architectural space (report)

Owner feedback: "it doesn't look like real architectural demos, the hospital still looks game-like". The lobby (and the spine it opens into) is
now designed, modelled and lit offline in Blender 4.5 like an arch-viz interior, "clean clinical modern", and shipped as glTF + KTX2 inside the
Quest 3 budget. Review stills (path traced, the target look): `docs/screenshots/lobby-blender-{1..4}.jpg`.

## Done

**Design (tools/arch/lobby.py, furniture.py)**
- Large-format light terrazzo (the CC0 `terrazzo_tiles` photo recoloured to a warm light grey, its 0.25 m joints removed so it reads as 1 m
  slabs, low contrast aggregate, roughness ~0.2: the floor reflects the glazing and the LED lines).
- Smooth white plaster ceiling (no T-grid in the lobby or spine): three recessed 50 mm LED slots east-west across the lobby, one north-south down
  the spine, a plaster bulkhead over the lobby / spine threshold, a 20 mm perimeter shadow gap, 12 wall-washing downlights (trim ring + lens +
  a spot lamp in the bake), concealed sprinkler plates on a 3 m grid, smoke detectors, two linear slot air diffusers along the glazing.
- West façade of the lobby: a full-height glazed curtain wall (deep 50 x 160 mm graphite mullions at ~1.5 m, sill and head profiles, a transom at
  door height), the automatic entrance's heavy jambs and operator header, glass and a mullion over it, the sliding-door floor track, a recessed
  entrance matting well, and outside a slim white canopy on two columns with downlights.
- One light-oak vertical slat feature wall (42 x 30 mm slats at 70 mm on dark acoustic felt, floor to ceiling) on the north wall behind the
  reception, from the waiting bench to the triage door's architrave.
- Walls: white eggshell plaster (the CC0 plaster lifted to white, weak normal; the walls bounding the lobby and spine are their own material,
  `WallPaint`, with a dense, high-sample lightmap, the rest of the region `WallClinical`), a recessed 20 x 12 mm shadow-gap skirting on every wall, 6 mm
  bevels with hardened normals, walls running 60 mm past the ceiling so its shadow gap looks into the wall.
- Door frames with real profiles on every door: a lining centred on the opening's edge (the procedural leaves still fit), 70 mm architraves on
  both faces, a head and a stop. Wayfinding, restrained and in the floor lines' colours: the triage and ER linings in the emergency red, the
  imaging door's in the diagnostics purple, a door-head sign over triage and ER, a directory panel with the five line colours on the spine's
  east wall facing the entrance, a hung exit sign, hand-rub dispensers beside the clinical doors.
- Reception: a 3 m white solid-surface desk on the reception station's footprint (receptionist at LOBBY.reception), standing height with a
  lowered accessible counter at the north end, oak transaction tops overhanging the visitor side by 50 mm with a soft LED line under the lip, a
  recessed black kick plinth, returns, a work shelf behind. The procedural reception screens stand on its top (kept).
- Waiting: modular beam benches on the exact seat rows (seat points from the layout: same x, z, heading, hip 0.37 m; cushion top 15 mm above it),
  upholstered seat and back pads (CC0 herringbone wool; the 4-seat rows warm grey, the 3-seat rows a petrol-blue accent), slim graphite T-legs and
  beam, an arm with an oak pad between every two seats. Board-formed concrete planters with procedural fiddle-leaf figs (three stems, ~45 broad
  folded leaves each, no alpha). A round oak side table on a steel pedestal.
- Everything static is joined by material: 24 meshes = 24 draw calls.

**Pipeline**
- `tools/arch/export-plan.ts` (+ test): a `furniture` section for the pilot region (seats with id/x/z/heading/height/pose, footprints with
  id/centre/size/rotation, stations = footprints that are a nav node's destination). places.ts untouched.
- `tools/arch/generate.py` is the entry point (same CLI, plus `--stills`, `--probe`, `--exposure`, `--bake-only`, per-material bake samples); the
  modules: `common.py` (plan frame, per-material bmesh accumulation, boxes, oriented boxes, cylinders, rings), `materials.py` + `materials.json`
  (the PBR library, texture processing, world box UV projection), `shell.py` (architecture to the plan, the coverage rule, context stand-ins and
  the lawn, never exported), `lobby.py` (the hero design), `furniture.py` (parametric pieces), `bake.py` (world, sun, lamps, lightmaps, probe).
  `preview_lightmaps.py` renders the baked result the way the game shades it (albedo x lightmap x scale), to catch leaks and blotches offline.
- UVs: TEXCOORD_0 = world-space box projection at each material's real tile size (terrazzo 2 m with 1 m slabs, plaster 2 m, oak 1 m with the
  grain turned vertical on the slats, wool 0.36 m, concrete 1.4 m, paving 4 m); TEXCOORD_1 = the lightmap (Smart UV + average scale + re-pack;
  the lay-in ceiling tiles and T-bars use one top-down projection, an island per tile came out black).
- Materials: Principled BSDF with image textures wired the way the glTF exporter reads them (Base Color image; ARM -> Separate Color -> G
  roughness / B metallic, R -> `glTF Material Output`.Occlusion; Normal Map node strength = normalTexture.scale). The procedural noise ramps are
  gone. Flat fallback colour when a texture set is missing. Textures are recoloured and downscaled once in Blender (numpy) into
  `assets-src/arch/out/tex/` (cached by source size and settings).
- Light: the CC0 HDRI `kloofendal_38d_partly_cloudy` as the world, turned so its sun comes from the west-south-west (late afternoon through the
  curtain wall); its sun disc is clamped out of the HDRI and replaced by a sun lamp of the same irradiance and colour (crisp sun patches without
  fireflies). Glass is a Fresnel-weighted transparent + glossy mix that passes shadow rays (Principled glass at 43 degrees went to total internal
  reflection and blocked the sun). LED slots and lenses are a separate emitter (`LEDLine`, strength 22) from the clinical lay-in panels
  (`LightPanel`, 4.5). Cycles GPU (Metal), DIFFUSE direct+indirect bake, OIDN, encoding range = min(p99.5, 14 x median) per mesh.
- Reflection probe: `public/assets/building/env_lobby.hdr`, 1024 x 512 equirectangular Radiance HDR from (-53, 1.6, 0), linear (Standard view, no
  look, exposure 0), oriented for three.js with no rotation: the image centre looks east (+x), the right quarter south (+z), up at the top.
  Recorded as a derived file in `public/assets/manifest.json` (asset `arch-pilot-lobby`).
- `tools/arch/optimize.mjs`: budgets now <= 60 draw calls, <= 300k triangles, <= 40 MB GPU texture memory (lightmaps + material textures); copies
  and records the probe. Kept: TEXCOORD_1, KTX2 by role (colour ETC1S sRGB, normal/ARM UASTC linear), the manifest records.
- `package.json`: `arch:bake` (now also `--probe` and `--blend`, per-material samples), new `arch:stills` (the four review stills).
- Runtime filter (`src/scene/building/model/region.ts`, rewritten; same signatures, so BuildingMeshes / WalkBuilding are untouched): the coverage
  rule (an area, wall piece or door is the model's when its centre is in the region; the model draws it whole). Hidden: the exact shell prims
  (floors of covered areas, everything centred on a covered wall or door line: walls, caps, glazing, mullions, jambs) and the lobby furniture the
  model designs (desk, seat rows, planters, side table), matched by `mat|x|z` keys precomputed once from `buildFloors`/`buildWalls`/`buildLobby`.
  Walk mode: ceilings of covered areas, and walls / glazing / lintels / frames centred on covered lines (sign plates stand off the line and stay).
  **Bug fixed**: furniture that only shares an architecture material (triage dividers and desk panel `wallMint`, the imaging glass partition,
  supply cabinet doors) is no longer hidden. Kept: sim seats, footprints/collision, both kinds of kiosk, the screens and their bezels,
  KioskLayer, StatusScreens, signage, floor lines, people.
- Tests: `model.test.ts` (+5: architecture hidden, furniture kept, lobby furniture hidden but kiosks/screens/seats kept, walk-mode parts, triangle
  winding vs normals since the materials are single-sided now); the existing UV1, baked-look and 2 cm plan checks still pass.

## Numbers (`npm run arch:pilot`)

`npm run arch:pilot`: 20.5 min wall clock on this laptop (plan 1 s, Blender build 1 s + bake 18.3 min + probe ~1.5 min, optimize ~0.5 min).
`npm run arch:stills`: 6.7 min (four 1280 x 720 stills at 384 samples + OIDN).

| | value | budget |
|---|---|---|
| draw calls | **24** (one node, one primitive per material) | <= 60 |
| triangles | **58,976** | <= 300,000 |
| GPU texture memory | **34.5 MB** (lightmaps 20.5 + material textures 14.0, 1 B/px x 4/3 mips) | <= 40 MB |
| gltf-validator | 0 errors, 41 warnings (KTX2 mime type / basisu and meshopt not known to the validator, unused texcoord accessors, tangents left to the runtime) | 0 errors |
| model vs plan | every solid wall within 2 cm (model.test) | 2 cm |
| files | pilot-lobby.glb 4.6 MB (textures embedded as KTX2), 21 lightmaps 6.0 MB on disk, env_lobby.hdr 1.3 MB | |

Lightmaps (KTX2 UASTC sRGB + mips; GPU MB): Terrazzo 2048 (5.33); WallPaint (hero walls), WallClinical, CeilingPlaster, CeilingTile, DoorFrame,
SolidSurface, Oak, Accent, Vinyl 1024 (1.33 each); CeilingGrid, Concrete, Fabric, FabricAccent, Leaf, Mullion, Paving, ShadowGap, Steel 512
(0.33 each); Matting, Soil 256 (0.08 each).
Material textures (embedded KTX2; ETC1S colour, UASTC normal/ARM): Terrazzo diff 2048 (5.33), nor 1024 (1.33), ARM 512 (0.33); plaster diff +
nor 1024 (2 x 1.33, shared by WallPaint, WallClinical, CeilingPlaster); Oak diff 1024 (1.33), nor + ARM 512; Fabric diff + nor 512, FabricAccent
diff 512; Concrete diff + nor 512; Matting diff 512; Paving diff 512; Accent palette 64 x 16.
Bake samples: 1024 for WallPaint, CeilingPlaster, DoorFrame (dim, large hero surfaces: at 256 they came out blotchy above the doors), 384 for
WallClinical, 512 for the rest; the runtime-look check (`tools/arch/preview_lightmaps.py`) of this bake is `docs/screenshots/lobby-blender-lightmaps.jpg`.

## How to verify
```
npx vitest run --maxWorkers=2 tools/arch src/scene/building/model     # plan export, region filter, glb: plan within 2 cm, uv1, winding
npx tsc --noEmit -p .
npm run arch:pilot        # plan -> Blender bake (~20 min) -> optimize: prints the budget, validator 0 errors
npm run arch:stills       # docs/screenshots/lobby-blender-{1..4}.jpg (~8 min)
# the runtime look offline (albedo x lightmap, no browser):
~/Applications/Blender.app/Contents/MacOS/Blender -b assets-src/arch/out/pilot-lobby.blend -P tools/arch/preview_lightmaps.py -- \
    --lightmaps assets-src/arch/out --out /tmp/lm-preview
```
In the browser (orchestrator): `?building=model`, walk into the lobby from the entrance; compare with the four stills.

## Change requests
- **Runtime (loader / lightmaps owner)**: the model now carries material textures (KHR_texture_basisu, ETC1S colour + UASTC normal/ARM, on
  TEXCOORD_0, no tangents: three derives them) and is single-sided except the leaves; `env_lobby.hdr` is ready: load it with three's HDR loader
  (RGBELoader / HDRLoader), PMREM it and set it as `envMap` on the model's materials (or as the lobby's environment), no rotation needed. The
  emitters use KHR_materials_emissive_strength (LED lines 22, lay-in panels 4.5): check the bloom threshold. The stills are AgX Base Contrast at
  +1.2 EV over the lightmaps' radiance (sun irradiance 2.6 in HDRI units): a matching tone mapping exposure in three is about 2.3.
- **Overview cut**: the model's walls are hollow boxes, so the overview's clipping plane at 1.3 m shows them as thin shells; the procedural
  `wallCap` prims on covered lines are hidden (they would flicker inside the model's walls when walking). A cap for the cut (stencil cap, or an
  overview-only cap mesh) belongs to whoever owns the overview.
- No contract file changes needed.

## Open questions / risks
- The bake takes 18 minutes at the per-material samples (1024 for the dim, large hero surfaces: walls, ceiling plaster, door frames; 512 for
  the rest). `--bake-samples 128` gives a usable look in ~4 min for iteration (blotchier on dim walls).
- The lightmaps are baked for one sun (late afternoon, WSW). The runtime's day cycle will not move the sun patches in the lobby.
- Outside the glazing the stills show a lawn and hedge (render-only context) and the HDRI; the game shows its own grounds there.
- The furniture outside the lobby (triage bays, imaging, the ER) stays procedural; the region's other rooms got the new shell (walls, frames,
  tegular ceilings) but no designed furniture.
- Texture memory 36-38 MB of the 40 MB slice: the next hero space needs its own budget or shared texture sets (the plaster set is already
  shared by four materials through gltf-transform's dedup).
