# Look textures: CC0 sources for the clean clinical lobby

Fetched through the asset gate (`node tools/fetch-assets.mjs`, host `dl.polyhaven.org` only, rule in `docs/ASSETS-POLICY.md`). Everything is **CC0 1.0**
(Poly Haven). These are SOURCE files for `tools/arch/generate.py`: they live in `assets-src/` (gitignored, never `public/`) and reach the page only as KTX2
inside the baked glTF files. 24.4 MB in all (budget ~60 MB). Every file is pinned in `tools/assets.manifest.json` (exact `bytes` + `sha256`; Poly Haven files
have no commit and no git blob id) and the Poly Haven API md5 was cross-checked by hand for every file that has one in its manifest `notes`.

## Material role -> Poly Haven asset

Maps per texture (all JPEG): `diff` = sRGB colour, `nor_gl` = OpenGL (+Y up, the glTF/three convention) tangent normal, **linear**; `arm` = packed
**R = ambient occlusion, G = roughness, B = metalness**, **linear** (the glTF `occlusionRoughnessMetallic` layout: R is AO, G roughness, B metallic, so it can
be used as `metallicRoughnessTexture` and `occlusionTexture` directly). 1k = 1024 px, 2k = 2048 px.

| Role | Poly Haven id | Install folder (`assets-src/textures/<id>/`) | Res | Bytes (diff / nor_gl / arm) | Real-world size of one tile (metres) | Looks like |
|---|---|---|---|---|---|---|
| Floor, light stone (use as is) | `floor_tiles_02` | `<id>_diff_2k.jpg`, `_nor_gl_2k.jpg`, `_arm_2k.jpg` | 2k | 1,381,118 / 540,151 / 686,577 | **4.0 x 4.0** (the repeat holds many mixed-size slabs, roughly 0.5 m) | warm light grey stone slabs, soft joints |
| Floor, terrazzo (tint it) | `terrazzo_tiles` | `<id>_diff_2k.jpg`, `_nor_gl_2k.jpg`, `_arm_2k.jpg` | 2k | 4,554,044 / 509,402 / 2,023,471 | **2.0 x 2.0** (8 x 8 tiles of 0.25 m) | real terrazzo speckle but **brown/terracotta**: pull saturation to ~0.1 and value up in Blender for light grey |
| Walls and ceiling | `painted_plaster_wall` | `<id>_diff_1k.jpg`, `_nor_gl_1k.jpg`, `_arm_1k.jpg` | 1k | 686,726 / 900,461 / 511,105 | **2.0 x 2.0** | light grey painted plaster, mottled; lift value towards white, keep the normal weak (the API tags it weathered) |
| Feature wood (slats, desk front) | `ash_veneer` | `<id>_diff_1k.jpg`, `_nor_gl_1k.jpg`, `_arm_1k.jpg` | 1k | 592,273 / 397,524 / 847,935 | **1.0 x 1.0**, grain runs along U (horizontal): rotate UVs 90 degrees for vertical slats | pale ash, fine straight grain, neutral beige |
| Upholstery, neutral | `poly_wool_herringbone` | `<id>_diff_1k.jpg`, `_nor_gl_1k.jpg`, `_arm_1k.jpg` | 1k | 942,966 / 1,045,151 / 1,223,522 | **0.27 x 0.276** (the image is 1024 x 1045, not square) | grey woven herringbone wool; at 0.27 m the weave is real size, 0.5 m reads softer |
| Concrete for planters | `concrete_wall_004` | `<id>_diff_1k.jpg`, `_nor_gl_1k.jpg`, `_arm_1k.jpg` | 1k | 531,968 / 993,350 / 855,862 | **2.0 x 2.0** | grey-olive board-formed concrete with panel joints (rows about 0.5 m high): tint towards light grey |
| Daylight sky | `kloofendal_38d_partly_cloudy` | `assets-src/hdri/kloofendal_38d_partly_cloudy_2k.hdr` | 2k (2048 x 1024) | 6,397,400 | n/a | bright midday, partly cloudy, sun about 38 degrees up, grass and rock on the horizon, white balance 5319 K. Equirectangular Radiance HDR, linear |

Dimensions come from Poly Haven's `dimensions` field (millimetres, the physical size of one tile of the seamless image): 4000, 2000, 2000, 1000, 270 x 276,
2000. All of these textures are seamless.

## Not found, and what to do

- **Brushed metal / steel**: Poly Haven's `metal` category (25 textures, read from the API on 2026-10-22) has only rusty, painted, galvanised or corrugated
  sheets, none brushed or stainless. Nothing was fetched for it. Use a procedural material in Blender (metallic 1.0, roughness 0.3 to 0.4, anisotropic
  streaks from a noise texture) or ask for an ambientCG pick (also on the allow-list, but the gate does not carry that host yet: it needs a gate change first).
- **Light terrazzo**: Poly Haven has one terrazzo texture (`terrazzo_tiles`, brown) and no white one. The generator should recolour it (HSV node on `diff`)
  or use `floor_tiles_02` as is. Stone candidates checked and rejected for being dark, brown or green: `grey_cartago_01/03`, `granite_tile_03`,
  `floor_tiles_04/08`, `interior_tiles`, `stone_embedded_tiles`, `painted_concrete`, `concrete_floor_painted`, `rectangular_facade_tiles_02`.
- **Ceiling**: reuses `painted_plaster_wall` (fine plaster at 1k); no extra download.
- **Coloured wayfinding accents**: flat emissive/diffuse colours in the generator, no texture needed.
- All `diff` maps carry some warm or green cast (Poly Haven photographs). Expect to neutralise them in Blender before baking.

## Using them

- Colour space: `diff` sRGB, `nor_gl` and `arm` Non-Color. Do not invert the green channel of `nor_gl` (it is already OpenGL).
- Texture memory at KTX2 (UASTC/ETC1S, with mips): well below the ~250 MB Quest budget; the 2k floor maps are the biggest.
- Dropped after a first pass because they looked wrong once opened: `concrete_wall_001` (panel lines, chips) and `oak_veneer_02` (peach), both removed from the manifest and from `assets-src/`.

## Commands

```
node tools/fetch-assets.mjs --strict --verify        # offline re-hash of everything, fails on an unpinned entry
node tools/fetch-assets.mjs --only <ids> --dry-run    # origin + HEAD size check, writes nothing
npx vitest run --maxWorkers=2 tools/fetch-assets.test.ts tools/people-gate.test.ts
```

Manifest ids: `ph-<asset-id-with-dashes>-<map>-<res>`, for example `ph-floor-tiles-02-diff-2k`; the sky is `ph-kloofendal-38d-partly-cloudy-hdr-2k`.
