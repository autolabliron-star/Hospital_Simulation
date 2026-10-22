# Rollout pipeline: every zone designed, baked and shipped like the lobby (report)

The owner approved the lobby's look (clean clinical modern; Blender-built, Cycles-baked, glTF + KTX2) as the style of the whole building. The
pipeline now builds, bakes and ships the hospital **zone by zone** (tools/arch/zones.json: 8 zones, the theatres on level 2), each as its own
glb + lightmaps, with the material textures shared by all zones, and a building manifest the runtime loads from.

## The flow

```
npm run arch:plan                                   # plan.json: the sim's plan + the owning zone of every area, wall piece, glazing span, door, anchor
npm run arch:bake -- --zone er --draft              # Blender (through the lock): shell + design, context, bake, probe, export (~1.5-4 min draft)
npm run arch:bake -- --zone er --draft --stills docs/screenshots --blend    # + docs/screenshots/zone-er-draft.jpg, + the .blend
npm run arch:build -- --zone er                     # optimize: meshopt, KTX2, shared materials, validator, budgets, manifest
npm run arch:zones:draft                            # all of it, every zone, draft;  npm run arch:zones = final quality
```

Other agents run Blender too: **always** go through the single-slot lock, e.g.
`/private/tmp/claude-501/hospital-blender.sh npm run arch:bake -- --zone er --draft`. `--zone all` builds every zone in one Blender process
(holds the lock for the whole run); a shell loop over the ids lets others in between.

Files: `tools/arch/generate.py` (entry), `zones/__init__.py` (the ctx API + the build order), `zones/<id>.py` (one design module per zone;
`zones/lobby.py` = the approved lobby, the others are shell-only stubs), `shell.py` (architecture to the plan + bake context), `bake.py`
(world, lamps, lightmaps, probe), `common.py` (frame, `Geo`), `optimize.mjs` (ship), `export-plan.ts` (plan + zone ownership),
`preview_lightmaps.py` (the runtime look offline). Owned by the kit agent and only imported here: `materials.py`, `materials.json` (library +
`roles`), `furniture.py`, `kit/**`.

## Who owns what (the coverage rule of the rollout)

Computed once in `tools/arch/export-plan.ts` (`zoneOf`, `zoneOfArea`) and written into `assets-src/arch/plan.json` as `zone` fields; Python
only reads them, and the runtime can import `zoneOf` / `ZONES` from `tools/arch/export-plan.ts` (or re-implement the 10 lines) to hide the
procedural shell zone by zone:

- an **area** belongs to the zone that lists it (`zones.json` `areas`; every area in exactly one zone, tested);
- a **wall piece**, **door** or **furniture anchor** belongs to `zoneOf(level, centre)`: the FIRST zone of that level, in zones.json order,
  whose rects contain the centre (borders included: the line between two zones goes to the one listed first, e.g. the spine's east wall at
  x = -40 is the lobby's, not imaging's), else the nearest zone of the level;
- a **span of outer glazing** (`glassCut` pieces are split at the partitions meeting them, `walls[].spans` = layout/shell.ts `glazingSpans`
  in the drawn frame) belongs to `zoneOf(level, span centre)`. Needed because the west façade piece z -22..-1.5 is the ER's but carries the
  lobby's curtain-wall span z -5.9..-1.5.
- every piece is built WHOLE by its owner (never clipped).

Tests (`tools/arch/export-plan.test.ts`): 8 unique zones, every area in exactly one zone on its own level, each level tiled by its zones'
rects, every wall / span / door owned by a zone of its level, the border cases above, furniture anchors carry level + zone.

## Building a zone (generate.py)

1. `shell.Plan(plan, zones, id)` + the design module's settings (`HERO`, `OWN_CEILINGS`, `FLOORS`, `SKIP_DOORS`, `skip_glazing`, `door_accent`).
2. The shell: floors, walls with the shadow-gap skirting, ribbon glazing / glass partitions, door lintels and profiled frames, 600 mm tegular
   ceilings with LED panels. Materials come from the library's **roles** (`floor.public` Terrazzo, `floor.clinical` SheetVinyl, `wall.hero`
   WallPaint, `wall` WallClinical, `ceiling.tile` AcousticTile, `ceiling.grid`, `ceiling.lightPanel`, `door.frame`, `glass`, `mullion`,
   `wall.shadowGap`), falling back to the old names if a role is missing.
3. `build(ctx)`: the design. `ctx` (zones/__init__.py has the full reference): `ctx.geo` (per-material accumulation, y = 0 at the level's floor,
   lifted on finalize), `ctx.pl`, `ctx.plan`, `ctx.zone`, `ctx.fur` (this zone's seats / footprints / stations from plan.json), the modules
   `ctx.shell / common / mt / fu / kit`, `ctx.Frame`, `ctx.downlight(x, z, ch, power)`, `ctx.light(fn)`, `ctx.draft`, `ctx.context`.
   Kit movable nodes (`kit.base.root(geo, f, node='bed:A1')`) are exported as named nodes (not lightmapped), kit anchors to
   `<id>.anchors.json`.
4. **Context, never exported** (so light and shadows at zone borders are right): every NEIGHBOUR zone (touching on the level, or over / under
   it) is built whole, shell + design + its lamps; every other zone as plain stand-ins (walls, glazing, lintels, floors, ceilings); a roof slab
   over each level's ceilinged areas (the atrium stays open to the sky) with a fascia on every wall line above the ceilings; the lawn and the
   forecourt hedges. The lobby is a neighbour of the ER, imaging, both wards and the theatres, so they see its curtain wall, forecourt and
   downlights.
5. Light: the CC0 HDRI with its sun replaced by a matching sun lamp (late afternoon, WSW, unchanged), the designs' downlight spots.
6. Lightmaps: one per material (= per draw call), Cycles DIFFUSE direct+indirect, OIDN, `lm_<Material>.png` (sRGB 8 bit, value x
   `lightmapScale` = linear radiance of a white diffuse surface: the runtime contract is unchanged). Size = the material's forced size
   (materials.json `lightmap`) or by area (`--density`, 400 texels/m2); then, while the zone is over its budget (16 MB GPU), the map with the most
   texels per m2, weighted down by its share inside the design's `HERO` rects, is halved (the lobby: the lift lobbies' vinyl, tiles and grid,
   the planters' concrete, the accents and the door frames went first; terrazzo 2048, walls / plaster / oak / desk 1024 kept). Tegular ceilings
   use one top-down projection, folded into bands for long zones (a ward corridor fills the square instead of a strip).
7. Probe: zones whose floor is glossy (roughness <= 0.3) or that set `PROBE` get `env_<id>.hdr` (1024 x 512 equirect Radiance, linear, same
   orientation as env_lobby.hdr: image centre looks east +x, right quarter south +z).
8. Export: only the zone's own meshes (+ kit nodes) to `<id>.glb`, both UV sets, node extras, scene extras `{ zone, level }`, and
   `<id>.meta.json` (sizes, cuts, bounds, timings).

### Draft vs final

| | draft (`--draft`) | final |
|---|---|---|
| bake samples | 64 | per material (materials.json `bakeSamples`, 512; 1024 on WallPaint, CeilingPlaster, DoorFrame) |
| lightmaps | half size (min 128) | full size (fitted to 16 MB) |
| probe / stills | 128 samples | 512 / 384 |
| time a zone | 5-54 s bake, 22 s-2 min with probe + still (measured 2026-10-22) | lobby ~20 min (the pilot's 18.3 min at the same settings; the zone's final run was interrupted, not yet measured) |

The manifest records `quality` per zone; `lightmapMB` is what ships (draft maps are a quarter of the final memory).

## Shipping (optimize.mjs)

- Zone glb `public/assets/building/zones/<id>/<id>.glb`: dedup, weld, prune (TEXCOORD_1 kept), reorder, EXT_meshopt_compression with
  KHR_mesh_quantization (positions are quantized and **the node transforms carry the dequantization**: use the node matrices). Kit nodes
  (`extras.kitNode`) keep a clean pivot: their mesh is moved to a child `<name>#mesh` before quantizing.
- Lightmaps `zones/<id>/lm_<Material>.ktx2` (UASTC, sRGB, mips), named by the node's `extras.lightmap` relative to the glb.
- **Shared material textures** `public/assets/building/materials/<stem>-<sha8>-<etc1s|linear>.ktx2` (base colour ETC1S sRGB; normal / ORM
  UASTC linear; sha of the source image, so one picture is one file whatever zone or material uses it). The zone glb references them as
  EXTERNAL images through KHR_texture_basisu: `images[i].uri = "../../materials/<file>"` (mimeType image/ktx2). Chosen because it is plain glTF
  that three's GLTFLoader + KTX2Loader load with no extra code (the loader resolves the uri against the glb's URL), any glTF viewer opens a
  zone on its own, and the validator checks the references. Files no zone uses any more are deleted on every build.
- The probe is copied beside the glb; `anchors.json` too when the design placed kit anchors.
- gltf-validator: 0 errors (warnings: image/ktx2 mimeType and the basisu / meshopt extensions are unknown to it, unused TEXCOORD_0 on some
  meshes). Budgets checked per zone (draws <= 40, tris <= 200k, lightmaps <= 16 MB) and the shared material textures (<= 48 MB, counted once):
  exit 1 when over, the files are still written and the zone is marked `withinBudget: false`.
- `public/assets/manifest.json`: derived records `arch-zone-<id>` (glb, lightmaps, probe, anchors) and `arch-building` (manifest.json + the
  shared material textures).

## For the runtime (src/scene/building/**): what to load

`public/assets/building/manifest.json` (paths relative to `assets/building/`):

```jsonc
{
  "version": 1,
  "generatedBy": "tools/arch/optimize.mjs",
  "frame": "plan metres AS DRAWN: x east, z south, y up; level 2 stands over the west block at y = 4.2 (its sim x = drawn x + 150)",
  "budgets": { "perZone": { "draws": 40, "tris": 200000, "lightmapMB": 16 }, "sharedMaterialTexturesMB": 48 },
  "zones": [
    {
      "id": "lobby", "level": 1, "label": "Entrance, lobby and spine", "status": "designed",
      "quality": "draft" | "final",
      "glb": "zones/lobby/lobby.glb",
      "lightmaps": ["zones/lobby/lm_Accent.ktx2", ...],          // every lightmap the glb's nodes name (preload / count)
      "materials": ["materials/Terrazzo_diff-601c8c77-etc1s.ktx2", ...],   // shared textures this zone references
      "bounds": { "x0": -76.5, "x1": -39.88, "z0": -24.5, "z1": 24.5, "y0": -0.06, "y1": 3.32 },   // drawn frame, metres, y absolute
      "draws": 24, "tris": 27982, "lightmapMB": 15.44,          // GPU MB (1 B/texel transcoded, x 4/3 mips)
      "probe": "zones/lobby/env_lobby.hdr",                     // optional: zones with a glossy floor
      "probeAt": [-53, 1.6, 0],                                 // optional: where it was rendered (y absolute), for box projection
      "anchors": "zones/<id>/anchors.json",                     // optional: kit anchors { zone, level, levelY, anchors: [{ name, p:[x,y,z], node, ... }] }
      "nodes": ["bed:A1", "bed:A1/backrest"],                   // kit movable nodes (named glTF nodes), may be empty
      "bakeSeconds": 76, "bakedAt": "...", "validator": { "errors": 0, "warnings": 41 }, "withinBudget": true
    }
  ],
  "materials": { "files": ["materials/...ktx2", ...], "mb": 14.0, "details": [{ "file", "w", "h", "mb", "encoding", "usedBy": [materials] }] },
  "totals": { "draws", "tris", "lightmapMB", "textureMB", "withinBudget" }
}
```

Zones appear in zones.json order; a zone is listed only when its glb exists.

**The glb.** A flat scene (scene extras `{ zone, level }`): one node per material `arch_<Material>` (vertices in world/drawn coordinates up
to the quantization transform on the node), one primitive each; POSITION, NORMAL, TEXCOORD_0 (material textures, world box projection),
TEXCOORD_1 (lightmap), indices. Baked nodes: extras `{ lightmap: "lm_<Material>.ktx2", lightmapScale, lightmapUv: 1 }`, exactly as the pilot
(`lightmaps.ts` works unchanged: intensity = lightmapScale x PI). No extras on the emitters (LEDLine, LightPanel: KHR_materials_emissive_strength)
and the glass (alpha blend). Kit nodes: named nodes with `extras.kitNode`, mesh on the child `<name>#mesh`, never lightmapped.

**Loading** (three's GLTFLoader + MeshoptDecoder + KTX2Loader with the Basis transcoder from public/, as now):

```ts
gltfLoader.load(`${BASE}assets/building/${zone.glb}`, ...)   // load by URL (or parse(buffer, dirOfTheGlb)) so "../../materials/x" resolves
```

GLTFLoader caches textures per file only, so N zones would upload a shared texture N times. Give it ONE KTX2Loader that shares by URL; three's
renderer uploads one GPU texture per `Texture.source`, and clones share it:

```ts
class SharedKTX2Loader extends KTX2Loader {
  private shared = new Map<string, Promise<CompressedTexture>>()
  load(url: string, onLoad: (t: CompressedTexture) => void, onProgress?: (e: ProgressEvent) => void, onError?: (e: unknown) => void) {
    const key = new URL(url, location.href).href            // "zones/a/../../materials/x" and "zones/b/../../materials/x" are one file
    let p = this.shared.get(key)
    if (!p) this.shared.set(key, (p = new Promise((res, rej) => super.load(url, res, onProgress, rej))))
    p.then((t) => onLoad(t.clone() as CompressedTexture), onError)   // the clone shares t.source: one upload for every zone
  }
}
```

Then per zone: `applyLightmaps` (resolve `lm_*.ktx2` against the zone's folder), the probe (`probe` / `probeAt`) as today's env_lobby.hdr, and
hide the procedural shell by the ownership rule above (plan.json `zone` fields, or `zoneOf`). Culling: one zone = one group with its `bounds`.

**The pilot files** (`public/assets/building/pilot-lobby.glb`, `lm_*.ktx2`, `env_lobby.hdr` directly in public/assets/building/, and the
`arch-pilot-lobby` record in public/assets/manifest.json) are untouched and still load; the generator can no longer rebuild them (the lobby
moved to zones/lobby.py). Delete them once the runtime loads `manifest.json` (list under "Open questions").
