# Rollout draw calls: an overview proxy per zone, and LOD (report)

The authored building is 8 zones of 16-34 draws each (one per material). In the overview the whole storey is in view, so culling cannot help:
about 172 building draws on level 1 before people, devices and screens, over the Quest's 200 and close to the laptop's 300. Each zone now also
ships an **overview proxy**: one mesh, one unlit material, one texture holding the final baked colour. The runtime draws a zone's proxy in the
overview and whenever the zone is not near the camera, and its full model when you are in it or next to it.

## The pipeline (tools/arch/proxy.mjs, called by optimize.mjs for every zone it builds)

```
npm run arch:build -- --zone <id>|all        # zone glb + lightmaps (as before) + zones/<id>/<id>.proxy.glb, recorded as the zone's `proxy`
node tools/arch/proxy.mjs --zone <id> --out <dir> [--png]   # standalone, for experiments (--png also writes the atlas as a PNG)
npm run arch:build -- --zone <id> --no-proxy # skip it
```

Per zone, from the Blender export (`assets-src/arch/out/zones/<id>/<id>.glb` and its `lm_*.png`):

1. **Parts**: every opaque primitive in world coordinates. Baked parts (`extras.lightmap`) keep their lightmap UVs; emitters and kit nodes are
   flat (one colour); glass (alpha blend) is left out.
2. **Detail**: connected parts (welded by position, so UV seams do not split them) smaller than `minPart` = 0.3 m are dropped (knobs, wheels,
   cable clips, handles, the small bits of the kit and the pharmacy shelves' boxes), then meshoptimizer simplifies what is left with the lightmap
   UVs as attributes (absolute error 2 cm, isolated specks pruned). Foliage (double-sided materials: the leaves) is all small parts but must not
   vanish (the atrium's trees), so it is clustered by the sloppy simplifier instead (to 10 % of its triangles, 0.3 m error): a canopy becomes blobs.
3. **Atlas**: one power-of-two tile per lightmap, sized by the material's kept surface (256 texels per m2, about 16 a metre, allowing for the
   islands filling about 2/3 of a lightmap), the atlas the nearest power of two to that (1024 for every zone today; 512..2048), then the tiles
   with the fewest texels per m2 are doubled while there is room. Packed buddy-style (power-of-two squares, largest first, never a gap). Each
   tile is rasterised in lightmap-UV space over the FULL-detail triangles: a texel's colour is what the runtime's baked look draws there,
   `albedo x AO x lightmap (sRGB decoded) x lightmapScale` (lightmaps.ts), with albedo = base colour factor x the texture's mean, or the
   palette swatch under TEXCOORD_0 for palette textures (KitPlastic, Accent), metals keep 60 % of it (three draws them from the probe). Two
   texels of inset per tile, the gutters dilated, the rest of a tile takes its mean (so mips do not darken).
4. **Encoding**: linear colour / `scale` to sRGB 8 bit (`scale` = the 99.8th percentile of the brightest channel, at least 1, so sunlit floors keep
   their headroom), KTX2 UASTC sRGB with mips, **embedded** (KHR_texture_basisu: the proxy is one file); `KHR_materials_unlit`; the mesh node's
   extras carry `proxyScale`. Geometry meshopt-compressed (positions 16 bit, UVs 14 bit). gltf-validator 0 errors, or the proxy is not shipped.

A proxy that fails to build is a **warning**, never a failed build: the zone ships without one and the runtime draws its full model everywhere.

**Why node and not Blender.** Everything the colour transfer needs is already in the export: each baked node's TEXCOORD_1 is a unique unwrap of
that material, its lightmap PNG is beside it, TEXCOORD_0 and the material give the albedo. So the transfer is a plain software rasteriser over
the lightmap UVs (a few seconds a zone), with no Blender session, no lock, no re-bake, and it runs inside `arch:build` after every bake. A
Blender bake (Emit / Diffuse colour pass to a new UV) would also need a new unwrap of the merged mesh, a Cycles bake per zone through the lock
(minutes each) and would lose what the shipped lightmaps already hold. The node path reuses the lightmaps exactly as shipped.

**Manifest** (per zone, optional):

```jsonc
"proxy": { "glb": "zones/lobby/lobby.proxy.glb", "tris": 6948, "mb": 1.33, "atlas": 1024, "scale": 1.126, "kb": 514 }
```

`totals` gains `proxies`, `proxyTris`, `proxyMB` (and `textureMB` now counts the atlases). A proxy whose file is gone is dropped from the record.

## The runtime (src/scene/building/model/)

| file | what |
|---|---|
| `farModel.ts` | load one proxy (fetch + GLTFLoader: meshopt, the embedded KTX2 through the zone loader's KTX2 path), refuse anything but one mesh with a texture, and give it ONE kind of material: `MeshBasicMaterial({ map })` with `color = proxyScale`, the storey's clipping plane, front side, no shadows, static matrices |
| `manifest.ts` | `proxy: { glb, tris, mb, scale } \| null`; a malformed one warns and is null |
| `culling.ts` | the LOD: `zoneLodDistance`, `wantsFull` (hysteresis), `cullZones` writes `drawFull` / `drawFar` beside `visible` |
| `runtime.ts` | proxies load before Enter with the skeletons; mounting a proxy hides the zone's procedural cell; `cull` flips the two representations; `drawnCounts()` |
| `ZonesModel.tsx` | `?probe=1`: `window.__hospitalZones.drawn()` -> `{ full, far }`, `.zones()` -> per zone `{ id, state, proxy, full, far }` |

**When which.** A drawn zone (level rule, potential-visibility set and frustum as before) shows its full model when the camera is near it, its
proxy otherwise:

- **walking**: near = within `LOD_WALK_FULL_M` = 9 m of the zone's own zones.json rects, in plan (the zone you stand in and the ones you can nearly
  touch; the ER is 6 m from the lobby's middle, imaging 13 m);
- **any other view** (the overview, room shots, presentation shots): near = within `LOD_VIEW_FULL_M` = 24 m of the zone's box, in 3D. The default
  overview (about 115 m up) is all proxies; a room shot (9-40 m from its target at 52 degrees) brings the zone under it in full, its neighbours
  stay proxies;
- `LOD_HYSTERESIS_M` = 2 m: full stays full until 2 m further out, so a zone on the line does not flicker;
- the representation that is wanted but not ready gives way to the other: before a zone's full model has streamed in, a near zone shows its
  proxy (never its procedural cell, never a hole); a zone without a proxy (none in the manifest, or it failed to load) draws its full model
  at every distance, exactly as before.

**No hitches.** Every proxy loads before Enter (behind the `building-zones` gate, in parallel with the skeletons) and is mounted hidden, so the
warm-up compiles and uploads it; their materials and atlases are also in the `building-zones` warm source. All proxies share ONE program (map on
uv 0, one clipping plane, fog, tone mapping): the 1.3 m overview cut uses the storey's plane (`MODEL_CLIP` / `MODEL_CLIP_L2`), a uniform. The
full models stream as before (uploaded off-screen before their first frame). A switch only flips `visible`; both stay resident.

**Fallback rules.** A zone whose full model fails keeps its procedural region: its proxy is dropped too and the cell comes back (so a failed zone
looks exactly as it always did). A zone whose proxy fails keeps its full model everywhere. A zone with neither keeps its cell.

**Shadows.** The authored zones and the proxies never cast into the sun's shadow map (`castShadow = false`), and the map is static (re-rendered
for 4 frames only on `invalidateShadows`), so the shadow pass costs the building 0 draws a frame. What changed: the cell of every zone is
now hidden when its proxy mounts, behind the loading screen, so a full model that streams in after Enter changes no cell and **no longer
triggers a shadow re-render** (before: one 4-frame 4096 x 2048 re-render per streamed zone, a hitch on the Quest).

## Draw calls and triangles, before and after

Building only (the authored zones; computed from the manifest, the shipped proxies and the culling code with a 75 degree walking camera); add
the procedural remainder (about 50 draws on level 1 once every zone has a proxy or model, 14 on level 2: rollout-runtime.md) and people,
devices and screens.

DRAWCALL_TABLE

Before = every zone in view drawn in full (the shipped manifest's draws and triangles); after = full models near the camera + one draw per proxy.

## Cheap wins found (and what is left)

- **Shadow pass**: already 0 building draws a frame (see above); the streamed-zone shadow re-renders are gone.
- **Procedural cells**: with every zone covered by a proxy before Enter, the procedural building is at its 50-draw minimum from the first frame.
- **Small flat materials (not done, proposed)**: each zone has 7-11 untextured, lightmapped, opaque materials that differ only in colour and
  roughness (CeilingGrid, CrashRail, DoorFrame, Mullion, PowderWhite, Rubber, Screen, ShadowGap, Soil, SolidSurface, Steel). Merging them in
  `optimize.mjs` into one or two materials (base colour into COLOR_0, their lightmaps repacked into one lightmap with the proxy step's buddy
  packer, `lightmapScale` folded into the vertex colour, one glossy and one matte roughness) would save about 5-9 draws per FULL zone: walking in
  the lobby 51 -> about 37 full-model draws, in ward A's corridor 49 -> about 35. It changes the look slightly (one roughness per group, the
  screens' gloss) and the lightmap contract, so it needs the owner's eye; see Change requests.
- **Triangles that remain**: the atrium's leaves (110k of its 146k triangles; its proxy clusters them), the ER's and wards' kit plastic (60k a
  zone, half of it parts under 0.3 m). The proxies cut the overview from about 850k to about 250k building triangles.

## How to verify

```
npx tsc --noEmit -p .
/private/tmp/claude-501/hospital-vitest.sh src/scene/building src/scene/warmup src/scene/frameAllocations.test.ts tools/arch
npm run arch:build -- --zone all        # every zone + its proxy (only while no bake holds the Blender lock)
```

In the browser (orchestrator), `?probe=1`: the default overview: `__hospitalZones.drawn()` = `{ full: 0, far: 7 }`, building draws about 57;
walk into the lobby: `{ full: 2 (lobby, er), far: <in view> }`; walk towards imaging and back: it turns full under 9 m and back over 11 m with
no hitch; `__hospitalWarm.programs()` does not change after Enter (the proxies' program is compiled before it). Compare the overview look
with `?building=procedural`-free screenshots before this change: the colours of the proxies should match the full models (they are the same
lightmaps); small furniture (under 0.3 m) is gone in the overview, by design.

## Change requests

- **Lightmap / material merge** (tools/arch, the bake contract): the flat-material merge above, if the owner accepts one roughness per group.
- **src/scene/warmup/manifest.ts**: added `src/scene/building/model/farModel.ts` to `MATERIAL_SITES` (mounted, one site); required by
  materialCoverage.test.ts. Done here; the warm-up owner may want to reword it.

## Open questions / risks

- **Not seen in a browser yet** (no browsers for this agent): the colour match between proxy and full model is computed, not eyeballed. The
  proxy has no specular/reflections (floors do not mirror the probe) and averaged material textures; at 9+ m walking and in the overview this
  should read the same, but the switch line may be visible on glossy floors. `LOD_WALK_FULL_M` is the knob.
- The atlas is 1024 per zone (16 texels a metre nominal, about 10 effective); close room shots at 24 m are on full models, but walking views
  through long sight lines into a far zone show a soft proxy.
- GPU memory: +1.33 MB per zone (10.6 MB) and the proxies' geometry (about 1 MB each); download about +1 MB per zone, before Enter.
- The proxies freeze kit nodes in their exported pose (none are shipped today).
- Option, not done: the overview is fully covered by proxies before Enter, so the full models loaded before Enter (`priorityZones`: the start
  zone and its 4 neighbours) could be cut to the start zone and the ones within `LOD_WALK_FULL_M` of the spawn (lobby, ER) on the Quest,
  taking 3 zone loads (glb + lightmaps) off the loading screen; the others would stream in after Enter, drawn as proxies meanwhile.
