# Rollout runtime: the authored building, zone by zone (report)

The runtime now loads the authored building from `public/assets/building/manifest.json` (tools/arch/optimize.mjs, docs/handover/rollout-pipeline.md),
zone by zone, and falls back to the pilot lobby (`assets/building/pilot-lobby.glb`) when there is no manifest. The authored building is the
default (`?building=procedural` opts out; node is always procedural). All code is in `src/scene/building/model/`.

## How it fits together

```
index.tsx ── startBuildingSource() at import ──► source.ts: fetch manifest.json ─┬─ ok ─► coverage = zoneCoverage(listed zones)  ─► 'zones'
                                                                                 └─ no ─► coverage = pilotCoverage()              ─► 'pilot'
          ── once decided, mounts: BuildingMeshes, WalkBuilding, Level2Building (compiled WITH the coverage: per-zone cell meshes)
                                   CellBinder (finds the `|cell=<id>` meshes)   + ZonesModel (zones) or BuildingModel (pilot)
```

| file | what |
|---|---|
| `zones.ts` | tools/arch/zones.json (contract, read-only) + the ownership rule, the same as the pipeline's `zoneOf` (a test compares them on a grid), neighbours, level-2 frame |
| `manifest.ts` | parse / validate the manifest (bad zones dropped with a warning, a bad top level = no manifest), paths, `probe` + `probeAt` |
| `source.ts` | the decision manifest vs pilot, the warm gate `building-source` (open until the model component has committed) |
| `region.ts` | the coverage: which procedural prim / walk part belongs to which zone CELL (pilot: the old PILOT_REGION rule, cell `pilot`) |
| `cells.ts` | the cell meshes per zone; `setCellReplaced(zone, true)` hides them in the same call the zone appears |
| `runtime.ts` | what loads when, warm-up registration, streaming, culling hook, failures |
| `zoneLoader.ts` | one zone: glb + its own lightmaps, all or nothing; `prepareZoneScene` (lightmaps, baked look, clip plane, static matrices; kit nodes stay live) |
| `sharedTextures.ts` | the shared material KTX2s, transcoded and uploaded once (a GLTFLoader plugin that takes over `KHR_texture_basisu` for external images) |
| `skeleton.ts` | proxies: a zone's glb JSON (Range request) -> skeleton glb -> the same materials through GLTFLoader, compiled before Enter |
| `uploader.ts` | streamed zones go on the GPU over several frames before they are first drawn |
| `culling.ts` | per-frame zone visibility (level, potential-visibility sets, frustum), allocation-free |
| `ZonesModel.tsx` | the component: loaders, warm source + gate, streaming after Enter, one `useFrame` at BUILDING_VISIBILITY_PRIORITY |
| `clip.ts` | `MODEL_CLIP` (level 1) and `MODEL_CLIP_L2` (4.2 + 1.3 m): the overview cut per storey |
| `lighting/env/lobbyProbe.ts` | per-zone reflection probes; the box projection follows the camera's zone (`setReflectionBox`) |

## Loading order

- **Before Enter** (gate `building-zones`): every shared material texture of `materials.files` (once; zones get the same Texture or a clone sharing
  its `source`, so one GPU upload); a **skeleton of every zone** (its glb's JSON chunk by `Range: bytes=0-262143`, a second exact ask if the JSON is
  longer; a server that ignores Range sends the whole glb, which is kept so the zone is not downloaded twice); the **priority zones** one after the
  other: the zone at the start point (the player, else the entrance plaza) and its neighbours (zones whose rects touch), or the listed zone nearest
  the start if none of those is listed. Each is mounted at once, so the warm-up compiles and uploads it.
- **After Enter** (`useWarmup.entered`): the remaining zones, one at a time (at most one zone transcoding), nearest to the camera first (its own
  level first). Load (meshopt decode on 2 workers, KTX2 on 2 workers) -> upload (`compileAsync`, then one `initTexture` a frame, then the geometry
  drawn once into a 4 x 4 target with the scene's lights and environment, at most 1.5 MB of buffers a frame, `xr.enabled` off for the pass, the
  shadow map untouched, the renderer's counters put back) -> mounted, cell hidden, same call. When every zone has settled: the proxies and skeletons
  are disposed and the transcoder pool freed.

**Programs.** The skeleton of a zone is its own nodes, meshes, extras and materials with every primitive one float triangle (same attribute names)
and every texture a 1 x 1 stand-in; GLTFLoader turns it into materials by the same code path as the real glb, and `prepareZoneScene` patches them
the same way, so every program a streamed zone will ask for is compiled before Enter (texture identity is not in a program key; presence and uv
channel are). Tested on fixtures and on the shipped lobby (`realManifest.test.ts`). The skeletons are mounted hidden (the warm-up reveals them) and
registered with `registerWarmSource('building-zones')` together with every loaded zone's materials, the shared textures, the lightmaps and the stub.

## Hiding the procedural building: cells

The coverage is chosen BEFORE the procedural building compiles (index.tsx mounts it only after the decision, a few ms). `compileLayout`'s hook now
returns a cell id (render/compile.ts: `true` = leave out, a string = compile into meshes keyed `...|cell=<id>`); WalkBuilding compiles each cell's
walk parts apart (one mesh per material per cell). A cell is DRAWN until its zone's model is drawn, then hidden in the same call; a zone that fails
or never loads keeps its cell. So there is never a hole (behind the loading screen or while a zone streams) and never a rebuild. Zones not in the
manifest get no cell at all (their prims stay in the shared merged meshes).

Ownership (zones): an area's floor and (walking) ceilings -> the zone that lists the area; door lines (jambs, lintels, frames) -> the zone of the
door's centre; a ward room's drawer chute (the walk fill above it) -> the zone of its centre; wall lines -> the piece's centre; outer glazing ->
each `glazingSpans` span to the zone of its centre. Signs, door plates, handrails and guards stand off the lines and stay procedural.

### `replaces`: the furniture a zone's design replaces (for the pipeline)

Per manifest zone, optional, a list of keys; without it the defaults apply (`lobby`: `["lobby"]`, others none):

- `"lobby"`: everything the procedural lobby builder emits (desk, seat rows, planters, side table) except the kiosks, screens and bezels (the pilot rule).
- `"footprint:<id>"` / `"footprint:<prefix>*"`: the prims standing inside that layout footprint (oriented rect + 0.1 m), e.g. `"footprint:er:bay*"`;
  ids as in plan.json `furniture.footprints`.
- Always kept: `quad` screens, `screen` material, `metalDark` above 1 m (bezels), the sim's seats, footprints and collision (data, never prims).
  Unknown keys warn once (`building manifest: unknown replaces keys`).

## Culling (per frame, allocation-free)

A zone is drawn when it is ready, on the shown level (overview of level 2 keeps level-1 zones around the slab, not lobby and ER under it; walking
on level 2 shows level 2 only), inside the camera's potential-visibility set when walking inside a zone that has one (`visibleFrom` in the
manifest; none today), and its manifest `bounds` (+0.5 m) intersect the view frustum (XR: `xr.getCamera()`, one frame old). The overview keeps the
1.3 m cut: `MODEL_CLIP` for level 1, `MODEL_CLIP_L2` (5.5 m) for the theatres; same programs (one plane each).

## Reflection probes

Each zone with `probe` (+ `probeAt`) has its own; the box it is projected onto is the zones.json rect holding the eye, floor to ceiling (the lobby:
x -62..-40, z -6..6, as before), unless the manifest gives `box`. `selectZoneProbe` (called through `lobbyEnvForCamera` by the daylight driver) picks
the camera zone's probe and moves the box uniforms when it changes. Today's Lighting.tsx loads ONE probe (`loadLobbyEnvironment` = the primary: the
lobby's), so only the lobby's probe is ever bound (see Change requests for per-zone binding). The `PRESENT_*` / `FLOOR_REFLECT` knobs are unchanged.

## Numbers (draw calls)

Procedural building at the default overview (level 1, measured in node): 56 draws. With cells it compiles to 69 (lobby only) / 92 (all 8 zones),
but a cell is drawn only while its zone is not, so once every listed zone is ready the procedural part is 56 (lobby only) / 50 (all 8).
Expected at the default views (building only; people, furniture and effects come on top as before). The shipped manifest (2026-10-22) has all 8
zones as drafts: lobby 24 draws (designed), er / imaging / wardA / wardB / theatres 9 each (shell), core 4, atrium 5: 78 draws, 228k triangles,
13.4 MB lightmaps + 15.3 MB shared material textures.

| view | shipped manifest (78 draws in all) | all 8 zones designed at ~24 draws (budget 40) |
|---|---|---|
| overview, level 1 (whole storey in frustum) | 50 + 69 = **~119** (procedural alone: 56) | 50 + 7 x 24 = **~218** (max 50 + 280) |
| overview, level 2 | 14 + 50 + 9 (theatres) + 36 (level 1 around the slab) = **~109** | **~200** |
| walking in the lobby looking east | 50 + lobby 24 + the zones ahead (9-35) = **~85-110** | **~120-170** |
| walking on level 2 | 14 + 9 + level-1 cut shell under the roof cap | 14 + 24 + ... |

Priority before Enter with this manifest: lobby, er, imaging, wardA, wardB (the plaza start); core, atrium and theatres stream after Enter.
The overview with every zone designed is the risk: about 160 more draws than the procedural building (see Open questions).

## How to verify

```
npx tsc --noEmit -p .
/private/tmp/claude-501/hospital-vitest.sh src/scene/building src/scene/lighting src/scene/daylight src/scene/frameAllocations.test.ts src/scene/warmup tools/arch
```
In the browser (orchestrator): default URL (zones path, lobby): walk in from the plaza; `?probe=1`: `__hospitalWarm.programs()` must not change after
Enter while core, atrium and theatres stream in; `?building=procedural` for the old building; rename manifest.json to see the pilot path.

## Change requests

- **Lighting.tsx (per-zone probe binding)**: replace the lobby-env effect's `loadLobbyEnvironment` by `loadZoneProbes(gl, BASE)` (register its
  `textures` in the `lighting` warm source, `dispose` on cleanup) and bind `liveLook.lobbyEnv ? zoneProbeTexture() ?? e.lobby : ...` in the swap.
  Until then only the primary (lobby) probe is bound, and only inside its zone. ~8 MB GPU for 8 probes (256 PMREM each).
- **tools/arch (pipeline)**: (a) optional `replaces` per zone (above) when a zone's design replaces procedural furniture; (b) optional `visibleFrom`
  lists once zones are walled off from each other (start with the wards: `wardA` sees `lobby`, `imaging`, `core`, `atrium`?); (c) no COLOR_0 with
  alpha or TANGENT attributes on zone meshes (the warm-up keeper meshes have neither; the skeletons do carry them, so it is only a safety note).

## Open questions / risks

- **Overview draw calls with all zones** (~220 building draws at the default view): needs an overview LOD per zone (one or two merged materials,
  lightmap baked into an atlas) or fewer materials per zone; the culling cannot help when the whole storey is in view.
- Zone glbs that reach outside the building (the lobby's canopy and forecourt, bounds x0 -76.5) draw over the procedural plinth's own canopy
  and paving: no cell covers 'outside'. Same as the pilot did; a `replaces` key for exterior pieces could follow.
- Pop-in after Enter: a streamed zone swaps from procedural to authored in one frame; in the overview that is visible. Upload cost per zone is
  spread (1.5 MB a frame) but not measured on the Quest; `UPLOAD_BYTES_PER_FRAME` is the knob.
- The uploader's off-screen pass assumes every light the main render uses is on layer 0 and visible (as today); a new light on another layer
  would make the pass compile a different program variant (a hitch, once).
- StrictMode: the zone runtime is a page singleton (`ZonesModel.tsx`), released a tick after its last user, so a double effect keeps the zones.
- The pilot files can be deleted once the orchestrator is happy with the zones path (the pipeline can no longer rebuild them).
