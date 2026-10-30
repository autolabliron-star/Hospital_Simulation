# Splat pilot: the lobby as a Gaussian splat (option A)

Option A of `real-simulation-engines.md`: render the lobby in Blender, train a Gaussian splat on those renders, and show it in the game with
Spark in place of the baked lobby model. Rounds 1 and 2 ran on 2026-10-29 and 2026-10-30. Machine: MacBook, Apple M4, 16 GB.

Result after round 2: **the splat is now as sharp as the Blender views, and much cleaner than round 1, but it still does not look better
than the baked lobby.** A see-through band on the oak wall, a fogged doorway and fading feet remain.

**Status: paused on 2026-10-30 by the owner after round 2.** The baked lobby stays the look. See "Paused" at the end for what stays in the
repo and how to pick it up again.

The sheets in `docs/screenshots/splat/`:
- `lobby-splat-round2.jpg`: the four presentation shots (`src/ui/present/shots.ts`), seed 7, side by side as baked / round 1 / round 2.
- `lobby-splat-round2-detail.jpg`: the splat alone at full resolution, the precision fix, and the coverage map.
- Round 1's own sheet and single shots: `lobby-splat-before-after.jpg`, `lobby-baked-N.jpg` and `lobby-splat-N.jpg`. Its splat shots were
  framed slightly wider than the baked ones, so use the round-2 sheet to compare.

## What was built

- **`tools/arch/splat_views.py`, called by `generate.py --views <dir>`:**
  - Renders seeded eye-level views of the zone's Cycles scene:
    - a 1.3 m grid over the zone's `HERO` rects;
    - 6 headings at each point;
    - eye heights 1.25–1.95 m;
    - pitch from −22° to +6°.
  - Writes their exact cameras to a Nerfstudio `transforms.json`, and a 400k-point seed cloud on the real surfaces to `points.ply`.
  - The views are opaque RGBA in the Standard view transform at exposure 0, which is linear radiance; the game's one AgX pass tone-maps
    them.
  - Cycles keeps its scene between views (`use_persistent_data`) and denoises on the GPU (OIDN with albedo and normal), so the 1920-px
    views at 16 samples cost about 11 s each.
- **Brush 0.3.0 trains the splat.** The trainer is a scratch download, not in the repo.
- **`tools/arch/splat-pack.mjs`** turns the trained `.ply` into the shipped `.spz` (Spark's `transcodeSpz`):
  - It keeps only the splats inside the zone's boxes, given in the game frame, and drops splats below 2% opacity.
  - It stores the centres relative to an origin (the middle of the boxes: the lobby's is −51, 1.5, 0) and writes that origin to
    `<zone>.json` next to the `.spz`.
- **`src/scene/building/splat/`** handles the runtime:
  - `?splat=lobby` loads the `.spz` and its `.json` behind the warm-up gate.
  - The splat shows while you walk on level 1; `runtime.ts` hides the baked lobby model meanwhile. People, robots and kiosks stay meshes.
  - The mesh sits at the origin and is turned −90° about x, from Blender's z-up frame to the game's y-up frame.
  - **`depth.ts`** draws a depth-only copy of the baked lobby after the splats, so the AO pass sees the real floor and walls.

## Reproduce (round 2)

```bash
Blender -b --factory-startup -P tools/arch/generate.py -- --zone lobby --no-bake --views <dir> --view-count 360 --view-res 1920 --view-samples 16
brush_app <dir>/lobby --total-steps 30000 --max-splats 1500000 --max-resolution 1920 --match-alpha-weight 0.5 --export-every 10000 --export-path <out> --seed 7
node tools/arch/splat-pack.mjs <out>/export_30000.ply public/assets/building/splats/lobby.spz --box -62.4,-39.6,-4,7,-6.4,6.4 --box -44.4,-39.6,-4,7,-22.4,22.4
```

Then open `/?splat=lobby` and walk into the lobby.

## Numbers

| | Round 1 | Round 2 |
|---|---|---|
| Views | 280 at 960×540, 64 samples; 5,319 s (19 s a view) | 360 at 1920×1080, 16 samples + GPU denoiser; 4,011 s (11 s a view) |
| Detail in the views | about 11 px per degree | about 21 px per degree (the game draws about 30 at 2560 px) |
| Training | 30k steps, up to 1M splats; about 40 min | 30k steps, up to 1.5M splats (growth stopped at 1.05M); 2 h 50 min (33, 48 and 90 min per 10k steps) |
| Shipped `.spz` | 700k splats; 15.5 MB | 791k splats (845k in the boxes, then the 2% opacity cut); 17.2 MB |
| Draw calls, shots 1–4 | baked 228 / 182 / 192 / 187; both splat rounds the same (the depth copy adds back what hiding the model saves) | |
| Triangles, shots 1–4 | baked 701k / 516k / 521k / 496k; round 1 about 1.9–2.1M | round 2 about 2.1–2.3M (Spark draws every splat as a quad; its real cost is fill and sorting) |
| Frame time | **Not measured.** The app window was not on screen, so the page ran throttled and its timers are not real. Measure with the window visible and `?probe=1`. | |
| Splat GPU memory | Not measured. Spark packs 16 bytes a splat (about 13 MB for round 2), plus the view-dependent colour. | |

## What went wrong on the way (keep these)

1. **Spark 2.3.1 `transcodeSpz({ transform })` rotates splats wrongly.** It moves the centres correctly but composes each splat's own
   rotation in the wrong order (q_splat·q_turn instead of q_turn·q_splat). Every flat splat ends up standing on edge, so the first packs
   showed fog and vertical streaks everywhere. Found by:
   - decoding the `.spz` by hand;
   - CPU-rendering it;
   - packing one rotated test splat.

   The packer no longer bakes the turn, and the runtime turns the mesh instead.
2. **Brush trains over black, with no alpha target in RGB images.** A faint splat with an over-bright colour then looks the same as a solid
   one. The views are now opaque RGBA, so Brush's alpha loss pushes towards full coverage. From a training camera, run 1 (RGB) covered 98% of
   the pixels and run 2 covered 100%.
3. **The zone boxes need room above and below the room.** The glossy terrazzo's reflections train as splats under the floor, and the ceiling
   uses a band above its surface. A box cut at the floor and ceiling (y −0.3 to 3.3) punched holes in both. The lobby uses y −4 to 7.
4. **Brush's "Vertical axis: y" export comment is wrong for this data.** The positions stay in the input (Blender, z-up) frame.
5. **Spark keeps each splat's centre as a 16-bit float on the GPU.** The `.spz` holds 0.24 mm, but the lobby sits at x −40 to −62, where a
   16-bit float steps 3.1 cm: coarser than the oak slats and their gaps, which broke into smeared bands. The packer now stores centres
   relative to the zone's middle (offsets under 11.4 m: steps of 0.4–0.8 cm), and the runtime places the mesh there. Spark's `extSplats`
   option (32-bit centres) is the alternative, at twice the memory.
6. **Splats write no depth, so the AO pass drew teal smudges** around feet and the desk. The depth-only copy of the baked lobby (`depth.ts`),
   drawn after the splats, fixed it (round-2 sheet, all shots).

## Why it is still not better than the baked lobby

- **See-through oak wall.** Over the right half of the slat wall (beside the treatment-room door) the splat covers only about 96% of the
  pixels from the desk shot: the gaps between slats are partly transparent. In the game, the bright treatment room behind that wall shows
  through as a glassy band with light streaks. The baked model at the same pose has none. The CPU check renders over black, which hides it.
  Fixes to try:
  - **Training:** a stronger alpha target (`--match-alpha-weight` 1–2), and views closer to the wall at grazing angles.
  - **Runtime:** draw the baked lobby's colour (no depth) behind the splat, so thin spots show the real wall instead of the room behind. This
    costs the lobby's draw calls a second time.
- **Fogged doorway.** Few views look through the treatment-room door, so the splats inside the box at the doorway hold a blur of the room
  beyond. Pull the box in at doorways, or add views through them.
- **Fading feet.** Moving people's lower legs fade into the floor in both splat rounds (the glazed-wall shot), though not in the baked
  version. Probably floor splats whose centre is nearer the camera than the foot drawing over it (Spark tests each splat at its centre's
  depth). Not confirmed.
- **Small artefacts:**
  - a faint blotch on the desk front where few views reach it;
  - the floor near the glazing is softer than the bake;
  - the game-side "Triage" sign disappears in splat mode (it belongs to the hidden baked model and is not in the Blender scene).
- **The ceiling on realism is the Blender scene itself.** The baked lightmaps already carry the same Cycles light. A splat of our own
  renders can match that scene, but not exceed it. Splats pay off most on real captured places (photos or video of a real lobby) and on
  what meshes do badly: foliage, glossy and glass reflections.

## Quest 3

791k splats is above Spark's suggested WebXR range (about 500–750k). Stereo doubles the rasterising, and the sort runs on the CPU worker. A
Quest pack would need about 400–500k splats (`--max-splats` lower, or Spark's LoD with `lodSplatCount`), and a measured frame time on the
headset.

## Next, if we continue

1. Fix the see-through spots: retrain with a stronger alpha target and grazing views of the slat wall (about 4 h of render and training),
   or add the colour backing pass.
2. Tighten the boxes at doorways.
3. Confirm the fading-feet cause.
4. Measure frame time with the window visible, at the default view and at the four shots.
5. A Quest-sized pack, measured in the headset.

## Paused (2026-10-30)

What stays, and what it costs the game:
- **The code stays, off by default.** Without `?splat=`, no splat code runs and nothing is fetched:
  - `src/scene/building/index.tsx` imports `SplatZone` lazily, so Spark (a 2.5 MB chunk) loads only with `?splat=lobby`, behind the
    warm-up. Before, it was in the main bundle for everyone: that bundle went from 4.9 MB to 1.8 MB.
  - `runtime.ts` builds the depth copy only for the flagged zone.
  - The `@sparkjsdev/spark` dependency stays in `package.json` for the lazy chunk and the packer.
- **The shipped splat is local only.** `public/assets/building/splats/lobby.spz` (17.2 MB) and `lobby.json` are not committed. Vite still
  copies them into every build, so remove them before a size-sensitive build, or keep them out of git.
- **The training data is in `/private/tmp`, which macOS clears on restart.**
  - Round 2's views, cameras and seed cloud: `/private/tmp/claude-501/hospital-splat2/lobby`.
  - Round 2's trained splat: `/private/tmp/claude-501/hospital-splat2/train/export_30000.ply`, 248 MB.
  - Once these are gone, resuming means rendering and training again (about 4 h). Repacking (boxes, opacity cut, origin) needs only the
    `.ply`.
  - Brush is a scratch download. Fetch it again through `docs/ASSETS-POLICY.md`.

To resume, start at "Next, if we continue". Option 1 is the oak wall.
