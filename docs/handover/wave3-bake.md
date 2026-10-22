# B3: Wave 3 pilot bake + export (report)

**Done**
- tools/arch/generate.py: `--bake <dir>`, `--export <glb>`, `--bake-samples N` (default 64; arch:bake uses 128), `--density` (texels/m2, default 400), `--max-lightmap` (2048), `--no-denoise`. Joins the architecture into one mesh per material (node `arch_<Material>`, vertices in world coordinates, node at the origin), drops floor undersides, adds UV set `Lightmap` (Smart UV project), bakes Cycles DIFFUSE direct+indirect (no colour, metals baked as matt, sun/sky/panel lighting unchanged) per mesh, denoises with OIDN via the compositor, writes `lm_<Material>.png` (sRGB 8 bit). Glass is exported as alpha 0.18 blend (no transmission).
- tools/arch/optimize.mjs (+ `npm run arch:build`): dedup, weld, prune, reorder, EXT_meshopt_compression (positions stay float32), lightmaps -> KTX2 UASTC sRGB with mips via `ktx create` beside the glb, extras rewritten to the .ktx2 name, any embedded texture -> ETC1S, gltf-validator, numbers, budget gate (exit 1).
- package.json: `arch:bake`, `arch:build`, `arch:pilot` (= arch:plan -> arch:bake -> arch:build). Full run about 3.5 min on this laptop.

**Numbers (pilot lobby)**: 11 meshes / 11 draw calls (budget < 40), 9,718 triangles (< 150k), lightmap GPU memory 15.5 MB (< 24; 1x 2048 ceiling, 1x 2048 walls, 4x 1024, rest <= 512), glb 99 KB, KTX2 files 4.1 MB on disk. Validator 0 errors, 0 warnings. `npx vitest run --maxWorkers=2 src/scene/building/model`: 9 passed (plan check within 2 cm).

**glTF layout the loader should expect** (public/assets/building/pilot-lobby.glb, KTX2 files in the same folder)
- Flat scene, 11 nodes at the origin with no transform, names `arch_Terrazzo, arch_Vinyl, arch_Paving, arch_WallPaint, arch_Skirting, arch_CeilingTile, arch_CeilingGrid, arch_DoorFrame, arch_Mullion, arch_LightPanel, arch_Glass`. +Y up, plan metres (Blender (x,-z,y) -> plan (x,y,z)).
- One primitive per mesh: POSITION (float), NORMAL, TEXCOORD_0 (a meaningless default unwrap, unused), TEXCOORD_1 = lightmap UV, indices. EXT_meshopt_compression used (needs MeshoptDecoder). No textures inside the glb, so no KTX2 on materials; materials are base colour / roughness / metallic only (the procedural terrazzo/vinyl speckle is not exported yet), `doubleSided: true`.
- Node extras on the 9 baked meshes: `{ "lightmap": "lm_<Material>.ktx2", "lightmapScale": <number>, "lightmapUv": 1 }`. `arch_LightPanel` (emissive, KHR_materials_emissive_strength) and `arch_Glass` (alpha blend) have NO extras and no lightmap.
- Lightmap files: KTX2 UASTC, sRGB, full mip chain. Decoded linear value x `lightmapScale` = outgoing radiance of a WHITE diffuse surface (what Cycles bakes). Scale per mesh: about 3 to 36, because the ceiling panels (strength 18) are bright; it is p97 of lit texels, hot sun patches clip.

**Change requests**
- Loader (src/scene/building/model/lightmaps.ts): it sets `lightMapIntensity = 1`, so the rooms will look dark. Read `userData.lightmapScale` and set `lightMapIntensity = lightmapScale` (three multiplies the lightmap by albedo/PI in physical lighting, so try `lightmapScale * Math.PI` and judge by eye / tone mapping), and tune one global exposure. If you prefer lightmapScale = 1 everywhere, say so and I will normalise the bake (panel strength) instead.
- Texture channel 1, colour space sRGB (KTX2 carries it).

**Open questions / risks**
- Materials are flat colours: terrazzo/vinyl speckle needs baked albedo or CC0 textures through the asset gate (next step).
- Bake noise: 128 samples + OIDN is smooth; at 16 to 32 samples it is fine for iteration only. Sun patches clip at the per-mesh scale.
- Smart UV unwrap gives lots of small islands (1 px bleed margin 10 px); ceiling and walls use 2048 maps, could be 1024 to save 8 MB if the headset budget needs it (`--max-lightmap 1024`).
- Door leaves are not in this glb (separate named nodes planned for the next step). Smart UV on bigger regions may need a longer bake.
- assets-src/arch/out is gitignored; public/assets/building/* is new output, not committed.
