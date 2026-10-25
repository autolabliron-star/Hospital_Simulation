# Realism step 2: live objects lit by the bake, with soft contact shadows (report)

Goal (owner, 2026-10-25): the hospital must look like a real place. The static building is lit by Cycles lightmaps; everything that moves (people,
pods, meal bots, imaging machines, the movable kit) was lit by the old live rig (sun x0.3 through a shadow map with no ceilings, hemisphere,
the PMREM'd probe at the driver's environment intensity, the light volume's panel light) and had weak or no floor contact. Measured: a white
shirt facing up in the lobby reflected about 0.96 (hemisphere 0.22 + probe 0.17 + volume panels 0.41 + sun 0.17), where the bake gives a white
surface 0.65; in the core (command centre) the bake gives 0.12, so people there were about 8x brighter than the room around them.

## Done

### 1. Bake-matched ambient (src/scene/lighting/bake/)
- `sh.ts`: each zone probe (`env_<zone>.hdr`, Cycles radiance, the lightmaps' units) is projected to SH9 on the CPU when it loads
  (lobbyProbe.ts `loadProbe`, from the HDR's half floats before the PMREM; three's basis and equirect orientation). `shIrradiance` is three's
  own `shGetIrradianceAt`, which the shader calls. No exposure fudge: E / PI of a white surface is what the bake stores for one, and the tone
  mapping (AgX, presentation's Blender LUT, any exposure) sees both the same way.
- `field.ts`: the probes' SH over the plan, per storey: 110 x 52 cells (1 m) x 14 slices, RGBA16F 3D texture (0.64 MB GPU), 27 coefficients +
  a weight per cell, premultiplied, zones grown by one cell then blurred [1 2 1] (a door between zones blends over about 2 m, a facade keeps
  full weight to the glass). Weight 1 in every zone the manifest lists, 0 outside the building and in unlisted zones. A listed zone without a
  probe borrows the nearest probe on its storey (`imaging<-lobby` today). Level 2's page repeats level 1 outside the level-2 footprint.
  Built once in the `zone-probes` warm gate (Lighting.tsx), so it is uploaded before Enter.
- Shader: `BAKE_MAIN` in src/scene/lighting/volume/glsl.ts, part of the light-volume chunk (`applyLightVolume`), so every material that
  already had it gets it with no new program: the whole palette (pods, MedVend, beds/trolleys/kiosks drawn with MAT, signs, procedural
  furniture still standing in zones), the crowd (bodies, avatars, props, vehicles), the imaging machines, meal bots and trays, and now the kit.
  Per fragment: one fetch (the weight); where it is above 0, six more, then by that weight: hemisphere, ambient and the volume's panel/sky light
  go, the environment's diffuse becomes the zone's SH irradiance at the normal (x `BAKE_LIGHT.gain`, darkened by `ao` x the volume's AO), the
  sun keeps `key` (0), and the environment's specular takes the baked materials' own gain (`uBkSpec` IS reflections.ts `uReflGain`, one shared
  uniform: live and baked things reflect the probe alike in walk and in presentation).
- Uniforms only (`bakeUniforms`): the daylight driver writes `uBkOn` = the indoor blend once the field is ready, so the overview, `?look=model`,
  `?bakelight=0` and `?building=procedural` (no field) keep the live light exactly. Knobs: look.ts `BAKE_LIGHT = { gain 1, key 0, ao 0.5 }`.

SH sanity (what a white surface reflects, E / PI, luminance; `shDigest`; 17-45 ms per probe to project in node, field build 16 ms):

| zone | up | sides | down | note |
|---|---|---|---|---|
| lobby | 0.654 | 0.377 | 0.338 | -x (curtain wall, WSW sun) 0.44 > +x 0.40 |
| er | 0.575 | 0.387 | 0.302 | |
| wardA / wardB | 0.544 | 0.264 | 0.220 | the two probes agree to 3 decimals |
| core | 0.123 | 0.145 | 0.124 | dim and even, as its bake (shot 8's floor reads ~0.55 display through AgX) |
| atrium | 0.433 | 0.354 | 0.313 | bluish from above (sky), -x side 0.58 |
| theatres | 0.603 | 0.323 | 0.290 | |
| imaging | = lobby | | | no env_imaging.hdr shipped |

Unit check in the test: the lobby floor's radiance seen by the probe divided by its E_up / PI gives the floor albedo, 0.5 (light terrazzo).

### 2. Soft contact shadows (src/scene/lighting/contact/)
- `material.ts`: one material and ONE program for every floor shadow: an analytic rounded box in metres (footprint half extents, corner
  radius, penumbra from `aShape`), alpha 1 under the footprint falling with a squared smoothstep to 0 one penumbra out, black with normal
  blending (multiplies the floor's linear radiance: an occlusion, as dark in the lobby as in a ward). No texture.
- People (crowd model.ts/crowdRig.ts/shaders.ts): the blob is now the feet's footprint (0.12 x 0.15 m half, round) + 0.33 m penumbra, x the
  person's scale, 0.54 dark under the feet; vehicles (wheelchair, stretcher, carts) their footprint inset 0.92 + 0.28 m. Same single draw.
- Meal bots (meals/botsRig.ts): their shadow mesh uses the same material (0.6 x 1.1 m body + 0.17 m penumbra); `meals/blob.ts` is gone.
- `registry.ts` + `ContactShadows.tsx`: a registry of sources and ONE instanced layer (256 max) mounted by `<Lighting />`; sources write each
  frame into a preallocated buffer, only written rows upload, nothing allocates; a hidden source (its level not shown) writes nothing.
  Sources today: the imaging machines (imaging/machines/index.tsx: footprints of the MRI/CT/X-ray/ultrasound static meshes found by
  `footprints.ts`, i.e. plinths, pedestals, console desk legs) and the zones' movable kit.
- Pods: none (they hang from the rail about 2 m up; under diffuse ceiling light their floor occlusion is ~2 %).

### 3. The movable kit in zone glbs (building/model/zoneLoader.ts, lightmaps.ts)
`prepareZoneScene`: meshes under an `extras.kitNode` get a live clone of their material (no lightmap, light-volume patched: lit by the bake
field like the people; one clone per source material, compiled through the skeletons before Enter like the rest), `applyLightmaps` skips them,
`lightmapFiles` no longer loads kit-only lightmaps, and every kit node standing on its storey's floor (not `door:`, `leaf:`, `backrest:`,
`blind:`, `curtain:`) gets contact footprints in its own frame (`kit`); `loadZone` registers them (`zone-kit:<id>`), drawn while the zone is,
following the node's matrix. The shipped glbs have no kit nodes yet (manifest `nodes: []`), so this is exercised by a node fixture only.

### Numbers
- Draw calls: +1 at most (the contact layer; 0 when no registered source is shown). Crowd blobs and meal-bot shadows stay one each.
- Programs: the crowd blob's and the meal-bot shadow's programs became the one contact program (net -1); every light-volume program keeps its
  count (its source changed); the kit clones share `std+lv0` programs, compiled with the skeletons. Nothing new compiles after Enter.
- GPU: 0.64 MB field texture; per fragment of live materials: 1 extra 3D fetch while walking, 7 inside the authored building, 0 in the overview.
- CPU per frame: the contact buffer (a few dozen numbers per source); the driver writes 4 uniforms on change only.

### Files
New: src/scene/lighting/bake/{sh,field,uniforms,probe}.ts (+ sh.test.ts, field.test.ts, bakeDriver.test.ts),
src/scene/lighting/contact/{material,registry,footprints}.ts, ContactShadows.tsx (+ contact.test.ts), src/scene/building/model/kitLight.test.ts.
Changed: src/scene/lighting/volume/glsl.ts, volumeChunk.ts, env/lobbyProbe.ts, flags.ts (`?bakelight=0`), look.ts (BAKE_LIGHT), look.test.ts;
src/scene/Lighting.tsx; src/scene/daylight/driver.ts; src/scene/actors/crowd/{model,crowdRig,shaders}.ts, shaders.test.ts;
src/scene/meals/botsRig.ts (blob.ts deleted); src/scene/imaging/machines/index.tsx; src/scene/building/model/{zoneLoader,lightmaps}.ts;
src/scene/warmup/manifest.ts (material sites: shaders.ts 6 -> 5, meals/blob.ts removed, lighting/contact/material.ts added).

## How to verify
```
npx tsc --noEmit -p .
/private/tmp/claude-501/hospital-vitest.sh src/scene/lighting src/scene/daylight src/scene/building/model src/scene/actors src/scene/meals \
  src/scene/imaging/machines src/scene/warmup src/scene/robots src/scene/frameAllocations.test.ts
npx vite build --outDir /private/tmp/claude-501/hospital-step2-check
```
(All pass here; `actors/crowd/budget.test.ts`'s CPU timing failed once at load average 23 and passes alone.)

In the browser (default URL, authored building), shots from docs/screenshots/realism/shots.js (`__baGo(i)`):
- Shot 7 (lobby desk) and 5 (imaging): people as bright as the walls and desk next to them, softly lit from above, no SSE sun key; a soft dark
  contact under each person's feet. Shot 8 (command, the core): people clearly dimmer than before, matching the room.
- `?probe=1`: `__hospitalBakeLight.state()` -> `ready: true`, sources `lobby, er, wardA, wardB, core, atrium, theatres, imaging<-lobby`;
  `.at(-48.5, 1, 1.5)` -> weight 1, up ~0.65; `.at(-70, 1, 0)` -> weight 0 (forecourt). A/B without reload: `.force(0)` (old live light on
  people), `.force(1)`, `.force(null)`. Reload with `?bakelight=0` for the old light everywhere.
- `__hospitalWarm.programs()` before and after Enter and while core/atrium/theatres stream: unchanged. Draw calls at the default view: +1 at most.
- Contact shadows under wheelchairs/stretchers, the MRI/CT/X-ray tables and the ultrasound cart, meal bots; none left floating when the
  overview shows level 2. The overview and `?building=procedural`: people lit exactly as before.
- Console at load: no THREE.WebGLProgram errors (the new GLSL was assembled and checked in node, not compiled by a GPU here).

## Change requests
- `src/scene/camera/frameOrder.ts` (orchestrator): list `contactShadows: -0.05` (`CONTACT_SHADOW_PRIORITY` in ContactShadows.tsx), after the
  device layers (-0.25..-0.1), before labels.
- `src/scene/building/model/reflections.ts` / Effects.tsx (building owner): while WALKING the baked materials read the probe's specular at the
  driver's environment intensity (~0.26 of its radiance at noon; true radiance only while presenting). That makes glossy baked kit (stainless,
  plastic rails) read matte. Consider the physical gain in walk too (`uReflGain = FLOOR_REFLECT.gain / envIntensity` whenever a zone probe is
  bound, keeping `uBoxMix` for presentation): live objects follow automatically (shared uniform).
- Pipeline (tools/arch): ship `env_imaging.hdr` (imaging borrows the lobby's probe now). Kit nodes: name doors/leaves/backrests/blinds/curtains
  with those prefixes (no shadow); the runtime no longer uses kit lightmaps, so they need not be baked, and a kit piece's own floor shadow should
  not be baked into the floor (the live contact shadow moves with it).
- Other device layers (surgery robot cart, health kiosks, lab, draw centre, MedVend): register floor footprints with `registerContactSource`
  (pattern: imaging/machines/index.tsx + `floorFootprints`). warmup/manifest.ts was edited for the material sites (please confirm).

## Open questions / risks
- The GLSL ran through node checks only (assembled, every identifier declared before use, balanced) - first browser load must show no program
  errors. The chunk is compiled into every light-volume material regardless of `?bakelight=0` (that flag only turns it off by uniform).
- One probe per zone: no variation inside a zone (the lobby's glazing side vs the spine; the ward corridor vs a room). The field takes several
  sources per zone if the pipeline ships more probes (first containing source wins today; a nearest-probe split inside a zone is a small change).
- People walking through a baked sun patch do not brighten (`key` 0); 0.1-0.2 brings back a faint key from the fixed SSE sun if they look flat.
- Until a streamed zone arrives after Enter, its procedural cell's palette walls are lit by the field too (flat probe light for a few seconds);
  a zone that fails to load keeps that look.
- SH projection is ~20-45 ms per probe on the main thread behind the loading screen (~200 ms for 7 probes); the float field copy (1.3 MB CPU)
  is kept for the probe hook's `at()`.

## Follow-up (2026-10-25): physical reflections while walking, device shadows

- **Reflections** (src/scene/building/model/reflections.ts): `uReflGain` is now `WALK_REFLECT.gain / environmentIntensity` (1.0 = the probe's true
  radiance) whenever a zone probe is bound, walking too (presentation: `FLOOR_REFLECT.gain`, unchanged); box projection and the floors'
  roughness scale stay presentation-only; the overview, other environments and `?building=procedural` keep gain 1. Uniform only, no program
  change. Live objects follow (shared uniform). Highlight check in node (probes blurred like a roughness 0.2-0.4 PMREM): LED-line peaks 3.2 / 1.5
  radiance (lobby, sigma 0.1 / 0.2 rad), ward and theatre the same, core 0.24; reflected: 0.13 face-on on a dielectric, ~1-1.5 at grazing,
  ~2.5 on stainless: AgX at the walk exposure 1.31 puts those at 0.85-0.93 display (soft, not clipped); the walk bloom (threshold 1.0) adds a
  faint glow to grazing floor reflections of the LED lines, as presentation shows. Knob: `WALK_REFLECT.gain` (lower if the floors glare).
- **Device contact shadows** (src/scene/lighting/contact/layoutShadows.ts: shadows from the layout's furniture footprints, anchored on the
  layer's root): health kiosks (`lobby:kiosk*`), blood-draw centre (`draw:robot*|prep|checkin|send`; chairs and bench are baked), the lab
  (`lab:*`, 16), the theatre (`l2:or:table|console:surgeon|console:teach|vision|anaesthesia`; chairs, stool, back table, Mayo, desk baked) plus
  the robot's patient cart following its pose (box instance 0), the MedVend island (12 x 2.4 m). All through the one contact layer (no new draw).
