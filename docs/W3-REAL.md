# W3 "Real": a solid world, a smooth walk, real people and real light

## Context
After play-testing the M5 build, the user had two complaints: "the character moves through doors and walls", and "his walk is still not smooth enough". They asked me to research what makes games feel realistic and to bring the hospital up to that standard. They chose every realism layer: real human models, camera and body feel, and realistic lighting.

**What the code maps found (2026-10-18)**
- **Walls mostly hold, but much of what you see is not solid.**
  - Player collision (`src/scene/player/collision.ts`) asks one question, `walkableAt`, of the NPC nav model (`src/sim/nav/layout.ts`).
  - That model lets anyone near a "station" pass through its furniture (`solidBlocksPoint` ends with `return !nearStation(...)`). So you walk through the reception desk, café counter, hub desks, kiosks and chairs.
  - The pharmacist desks, canopy columns and planters are not in the model at all. MealBots are not either, and seated or riding people are skipped.
  - Door openings are always open in the model:
    - swing-door leaves stand on walkable floor;
    - the glass pharmacist doors never sense you, so you walk through them shut.
  - Corners clip by up to 0.10 m at 6 spots.
- **The walk is not smooth, for these reasons in rank order:**
  1. Speed changes are near-instant: linear 0.15 s starts and 0.1 s stops, and braking from a run is 42 m/s². The procedural legs cannot keep up, so they scramble and lunge.
  2. The legs are planned from a speed measured afterwards with a 0.1 s lag (`model.ts` `trackMotion`), not from your real velocity. So stops overshoot and need extra steps, walking backwards shuffles, and turning on the spot twists the legs up to 80°.
  3. The camera boom snaps in at walls, doors and the 7 hanging signs, then drifts back out. The shoulder offset snaps too, and the yaw-lag clamp kinks in running turns.
  4. 30 fps on battery outside `?present=1`.
  5. The quality ladder changes the DPR mid-walk, which causes a hitch and a sharpness pop.
  6. Sliding along walls at fixed angles makes the speed jitter.
- **The body is a mannequin:** 19 rigid parts with no skin, so knees and elbows show overlapping pieces.

**What the research says makes a game feel real** (engine docs, GDC and SIGGRAPH locomotion talks, three.js community):
- **A kinematic collide-and-slide controller.** The capsule never enters geometry and keeps its speed along walls (the consensus of the major engines).
- **Doors that physically block until they're open.**
- **Momentum:**
  - eased starts and stops;
  - turn speed that ramps up;
  - leaning into acceleration and curves;
  - the head turning before the body.
- **Feet planted by distance travelled, never sliding,** with the last step landing under the body when you stop.
- **Render interpolation and frame-rate-independent smoothing** that settles exactly.
- **A spring-arm camera:**
  - a shape sweep, not a ray;
  - pulls in quickly but not in one frame, and lets out slowly;
  - lags on position, not aim;
  - a subtle sway, and a wider view when running.
- **Realistic skinned people with varied looks.** NPCs that react to you: glances, stepping aside.
- **Indoor realism comes from bounce light and reflections:**
  - an environment map, or light probes, so every material picks up the room;
  - ambient occlusion;
  - restrained, well-tuned real-time lights;
  - colour grading.
  It does not come from piling on lights.

Sources:
- [character controller consensus](https://www.skills.sh/firzus/agent-skills/character-controller)
- [plane-solver collide-and-slide](https://gamedev.net/forums/topic/693816-character-solver/5364515/)
- [fixed-timestep interpolation](https://gamedev.net/blogs/entry/2265460-fixing-your-timestep-and-evaluating-godot/)
- [distance-matched gait](https://github.com/danieltalbert/gradientfall/pull/5)
- [Johansen locomotion thesis](https://runevision.com/thesis/rune_skovbo_johansen_thesis.pdf)
- [SIGGRAPH "The Right Foot in the Wrong Place"](https://history.siggraph.org/wp-content/uploads/2022/06/2021-Talks-Heuvel_The-Right-Foot-in-the-Wrong-Place.pdf)
- [locomotion start, stop and pivot](https://mocaponline.com/blogs/mocap-news/locomotion-system-design-guide)
- [Unreal spring arm](https://docs.unrealengine.com/4.27/InteractiveExperiences/UsingCameras/SpringArmComponents)
- [Godot spring arm](https://docs.godotengine.org/it/4.5/tutorials/3d/spring_arm.html)
- [open-world NPC believability](https://www.gamedeveloper.com/business/5-tips-for-making-more-believable-open-world-cities)
- [three.js interior realism](https://discourse.threejs.org/t/achieving-realistic-ambience-in-architectural-three-js-scenes/89753)
- [three.js environment maps](https://sbcode.net/threejs/environment-maps/)
- [Rocketbox library](https://github.com/microsoft/Microsoft-Rocketbox)

The Waltz reference already ships most of this:
- capsule collide-and-slide with blocking door leaves;
- `smoothDamp` cameras;
- 12 Rocketbox avatars skinned onto its procedural crowd rig, including the converter and the asset gate.

Rocketbox (MIT) has 8 medical outfits: `Medical_Female_01..03` and `Medical_Male_01..05`.

## Approach: wave W3 "Real", in two waves
The new brief is `docs/W3-REAL.md`. Wave A fixes your two complaints and adds the light. Wave B puts real people on the same animation system.

They are two waves because the people work and the gait work both touch the crowd rig (`rig.ts`, `model.ts`, `crowdRig.ts`). Wave A also needs no downloads, so you can play-test and commit it first.

### Decisions (with reasons)
- **Collision: our own 2D collide-and-slide, not Rapier.**
  - The floor is flat, it keeps the sim deterministic, it needs no WASM, and it can be tested in node.
  - The body is a circle of radius 0.3 m. It meets an exact swept test against oriented boxes and circles, up to 4 iterations, with a 1 cm skin. Whatever motion is left after a hit slides along the wall, so the speed stays smooth.
  - NPC navigation is untouched.
- **Doors physically block until their leaves are open.** You sense doors 0.6 s ahead along your velocity, so a running doctor meets an open door, not a closed one.
- **Speed and turning:**
  - Speed changes follow a critically damped spring. Starting takes 0.35 s, stopping 0.28 s, and switching walk↔run 0.45 s.
  - Only the speed is springed, not the direction, so the doctor never walks crabwise.
  - Turning eases in and out.
- **The legs get the real velocity and your intent,** not a lagged measurement. When you stop, the last step lands under the body. Walking backwards takes real steps. Turning on the spot alternates feet.
- **The new look:**
  - The realistic light becomes the walk-mode look.
  - The overview keeps the clean model look.
  - Tab crossfades between them through the existing indoor blend, so nothing recompiles.
  - `?look=model` gives the old look back, for comparison.
- **Lighting:**
  - No HDRI download and no extra real-time lights.
  - Realism comes from a light volume baked at load, a hospital environment map, ceiling-panel reflections on the floor, and a colour grade.
  - None of these add a draw call.
- **The frame rate:** walk mode keeps 60 fps on battery. The quality ladder never changes the DPR while you're walking.

---

## Wave A: solid, smooth, lit (4 agents in parallel, sonnet)

### Contract changes I make first
- **`src/sim/config.ts`, `CONFIG.player`:** add `startSeconds 0.35`, `stopSeconds 0.28`, `shiftSeconds 0.45`, `bodySkin 0.01` and `doorLeadSeconds 0.6`. `accelSeconds` and `brakeSeconds` stay until the cleanup step.
- **`src/sim/places.ts`:** `VEHICLE_HALF` per vehicle kind (wheelchair, stretcher, carts), matching `gear.ts:284`.
- **`src/scene/player/state.ts`:** a `walkBody` record that is never reallocated. It holds:
  - position;
  - the velocity actually achieved;
  - the velocity your keys ask for;
  - the spring's acceleration;
  - the turn rate;
  - whether you are stopping;
  - the point where you will stop;
  - how long you have been still.
- **New registry `src/scene/blockers.ts`:** door leaves as oriented floor boxes in a flat `Float64Array` (`registerBlockers` / `blockerSources`).
- **`src/scene/camera/frameOrder.ts`:** `doors: -11`. Doors sense and step before the player moves.
- **`src/scene/lighting/volumeChunk.ts`:** a stub, `applyLightVolume(shader)` plus `LIGHT_VOLUME_KEY`.
- **Warm-up:**
  - `registerWarmGate(name, promise)` in `src/scene/warmup/registry.ts`, awaited in `run.ts` `settle()` (10 s cap);
  - an `'offline'` path in `manifest.ts`, for the environment material that is rendered once.

### Agent A1: body and collision
**Owns:**
- `src/scene/player/{collision,motion,scheme,system}.ts`
- New: `solids.ts`, `sweep.ts`, `body.ts`
- Their tests
- `src/scene/landscape/exterior.ts` (footprints only)

**What it builds:**
- **One static solid set**, with a 1 m grid. It contains:
  - floor-standing wall boxes: `buildWallBoxes().filter(y0===0)` from `boomProbe.ts:44`;
  - every `SOLIDS` entry from `nav/layout.ts:228`, without the station exemption;
  - the pharmacist `DESKS` and `ISLAND` (`pharmacy/layout.ts`);
  - new footprints for the canopy columns and planters;
  - fences on three sides of the plaza and inside the pharmacist zones.
- **Dynamic shapes each frame:**
  - door leaves, read through `blockerSources()`;
  - standing NPCs;
  - pushed wheelchairs and stretchers;
  - riders;
  - MealBots.
  These replace the second push-pass `moveBody`.
- **The collide-and-slide `moveBody`.** A body that starts inside a seat can only move out of it, so sitting still works. The old `isWalkable` stays as a backstop (margin 0.18).
- **The new speed, in `motion.ts` and `scheme.ts`:**
  - the speed spring;
  - one signed speed along your heading in the easy scheme;
  - no turn kick: the turn rate eases in over 0.07 s.
- **In `system.ts`:**
  - the velocity overwrite goes, except when you are blocked head-on;
  - it publishes `walkBody` every frame;
  - a pure `BodyMover` for tests.

**Tests:**
- **Never inside anything.** On every frame of the sampled walks, the body never overlaps a solid or a door leaf. The walks are:
  - every corridor;
  - hugging walls at 3° and 10°;
  - every door, open and shut, at walk and run speed, at frame rates of 20, 30, 60 and 144 fps, from 3 approach angles.
- **Walk-through holes are closed:** reception, the café, the hub desks, kiosks, chairs, the pharmacist desks, the planters and the columns.
- **Sliding along a wall:** at least 98% of the speed along the wall is kept, and the speed changes by no more than 0.01 m/s per frame.
- **Seats:** you can walk out of every seat with no pop.
- **Motion:**
  - 95% of walk speed at 0.35 s;
  - stops in 0.2-0.3 m from a walk and 0.4-0.6 m from a run;
  - the same walk ends within 2 cm at every frame rate.

### Agent A2: the legs and body feel (render only)
**Owns:**
- `src/scene/actors/crowd/{gait,rig,model,crowdRig,look}.ts`
- `gait.test.ts`, plus a new `playerGait.test.ts`
- The footstep part of `src/audio/ambience.ts`

**What it builds:**
- **The player's slot is driven by `walkBody`** (true velocity and intent) instead of `trackMotion`. Every other slot stays bit-identical, and a test proves it.
- **Footfall planner, with intent:**
  - the first step starts on the first frame of input;
  - strides follow the direction of motion, so walking backwards works;
  - stopping steps land at the stop point, at most one step per foot;
  - turning on the spot re-plants at 0.45 rad, alternating feet.
- **Body feel:**
  - the run and brisk blends follow without the 0.2 s lag;
  - you lean into acceleration (up to 7°) and roll into curves;
  - the head turns before the body;
  - NPCs within 4 m glance at you as you pass;
  - footsteps sound on each heel strike.

**Tests:**
- **Start:** no emergency steps; pelvis drop at most 6 cm walking and 9 cm running (today 11 and 17 cm).
- **Stop:** at most 2 footfalls, with the feet settled under the body in 0.35 s.
- **Switching walk↔run:** at most 1 emergency step (today 8).
- **Backing up:** 0 emergency steps, with every landing behind the last.
- **Turning on the spot, 90° and 180°:** the feet alternate.
- **Lean:** within its range for acceleration, braking and curves.

### Agent A3: camera, doors and frame pacing
**Owns:**
- `src/scene/player/{chaseCamera,chaseMath,boomProbe,tuning}.ts` and their tests
- `src/scene/building/render/walk/{doorBank,doorMatrices,WalkBuilding}.ts(x)`
- `src/scene/building/layout/walk/doors.ts`
- `src/scene/pharmacy/PharmacistDoors.tsx`, plus a new `coreDoors.ts`
- `src/app/{power.ts,PowerLoop.tsx}` and the power test

**What it builds:**
- **Doors:**
  - door stepping moves to its own `useFrame` at `doors: -11`;
  - doors sense you along your 0.6 s lead path;
  - `writeLeafBlockers` publishes each leaf as a box;
  - the pharmacist glass doors sense you, keep running while the game is paused, and block you when shut.
  - (added after the end-to-end door test) swing doors are double-acting: a shut door swings away from whoever opens it and keeps that way until it has shut again, so its open leaf never traps you against the wall on the hinge side.
- **Camera:**
  - The boom springs in over 0.08 s, not in one frame.
  - A hard clamp at a 0.13 m near-plane radius stops the camera from ever entering a wall.
  - Hanging signs are tested only at that hard radius, so the camera no longer dips under them.
  - The shoulder offset is smoothed.
  - The yaw lag saturates softly, with no kink.
  - When you run, the view widens a little (FOV +4°) and the camera bobs gently with your footfalls (at most 1.5 cm).
- **Pacing:** `frameCap(..., walking)` keeps walk mode at 60 fps on battery.

**Tests:**
- **The boom:**
  - it changes by at most 3 m/s outside hard-clamp frames;
  - it stays at least 99% of its length under every sign;
  - it is never inside a wall or a sign.
- **The yaw:** its rate never jumps by more than 2 rad/s.
- **Doors:**
  - every door is at least 98% open when you are 0.6 m from it, at walk and run speed;
  - the leaf boxes match the drawn leaves within 1 mm;
  - the pharmacist doors open for you.

### Agent A4: realistic light and materials
**Owns:**
- New `src/scene/lighting/**`
- `src/scene/{Lighting,Effects}.tsx`
- `src/scene/daylight/**`
- `src/scene/quality/**`, including the DPR deferral
- `src/scene/materials.ts` (values plus one `applyPaletteLook` hook)
- `walkMaterials.ts` (`CEILING_EMISSIVE` only)

**What it builds:**
- **A look table** blended by the existing indoor blend: 0 is today's look exactly, 1 is the realistic walk look.
- **A colour grade:** a procedural 32³ LUT with warm highlights and cool shadows, plus a vignette, both driven through refs. Tone mapping stays Neutral.
- **A procedural hospital environment** turned into a PMREM, for walk mode.
- **A light volume baked at load** into an RGBA8 3D texture of about 430 KB:
  - R: light from the ceiling panels, with no leaking through walls;
  - G: window light;
  - B and A: AO with and without the ceiling.
  It follows the time of day, and it is patched into the palette and into the crowd's material.
- **Floors and glass:**
  - floors reflect the ceiling panels analytically, with roughness about 0.3;
  - glass catches more light at grazing angles;
  - the panels just catch the bloom.
- **Retuning:** the indoor preset and the walk AO, so nothing is darkened twice.
- **The quality ladder:**
  - a new `fx-lite` rung that drops the effects before AO goes;
  - DPR changes wait until you stop, leave walk mode, or 6 s have passed;
  - debug flags `?look=model`, `?lv=0` and `?refl=0`.

**Tests:**
- **The bake:**
  - it is deterministic;
  - it is brighter under a panel;
  - light through a wall drops by at least 80%;
  - it takes at most 150 ms.
- **The look table:** at blend 0 it equals today exactly.
- **Patching:** every palette material is patched exactly once, with unique program keys.
- **The grade:** strength 0 is the identity.
- **Ladder order** and **no allocations per frame.**

### After Wave A
1. A short pass driving `DoorBank` + `writeLeafBlockers` together with `BodyMover` through every door at run speed: no overlap, no stall.
2. I delete the old `accelSeconds`/`brakeSeconds`.
3. I update `materialCoverage.test.ts`.
4. I run the full checks.
5. The browser check below, and your play-test.
6. A commit on `main`.

---

## Wave B: real people (1 agent, sonnet, after Wave A is committed)

### Before it starts
**Downloads need your go-ahead, and I'll ask right before fetching:**
- **What:** the 8 Rocketbox medical avatars (FBX + TGA) from `raw.githubusercontent.com/microsoft/Microsoft-Rocketbox`, pinned to commit `0943055d`, about 330 MB.
- **Where to:** the gitignored `assets-src/`.
- **Reused:** 6 adult avatars imported through the gate from Waltz's already-verified copies (same SHA-256).
- **What ships:** about 5 MB in `public/assets/people`.

**Contract changes I make:**
- `docs/ASSETS-POLICY.md` gets the Rocketbox section from Waltz.
- Dev dependencies at Waltz's exact pins: `@gltf-transform/{core,extensions,functions}@4.5.1`, `gltf-validator@2.0.0-dev.3.10`, `meshoptimizer@1.3.0` and `sharp@0.35.5`. Installed with `--ignore-scripts`, then `npm audit`.
- `.gitignore` gets `assets-src/`.
- `manifest.ts` gets the crowd avatar material.

### Agent B1: people
**Owns:**
- `tools/**`
- `public/assets/**`
- `src/scene/actors/**`
- `docs/CREDITS.md`

**What it builds:**
- **A port from Waltz:**
  - `tools/{assets-lib,fetch-assets}.mjs`;
  - `tools/people-lib.ts`, with a new `fitLyingPelvis` and garment tint masks;
  - `tools/convert-people.mjs`, set to 14 avatars and LODs of 4000, 1200 and 350 triangles;
  - `crowd/{avatars,avatarLoader}.ts`, the avatar shader (one program, no shadow materials) and the per-avatar instanced meshes.
- **The rig gets per-avatar body sizes** (`BodyDims`, 20 places in `rig.ts`).
- **Who wears what:**
  - you: `Medical_Male_01`, the all-white coat, worn by no one else;
  - doctors: `Medical_Male_03` and `Female_02`;
  - nurses: `Female_01` and `Male_04`;
  - radiographers: `Male_05`;
  - paramedics: `Male_02` and `Female_03`;
  - porters, visitors and patients: the 6 adults.
- **Colours:** a tint mask keeps each role's scrub colour readable from the overview.
- **Distance:** the mid-distance band moves to 60 m.
- **Loading and failure:** the people load behind the loading screen through a warm gate. If loading fails, the procedural people stay.
- **The "You" badge** comes back as a gear piece.

**Tests:**
- every file matches its hash;
- every role and clothing class maps to an avatar;
- skin weights sum to 1;
- every avatar fits standing, walking, seated and lying, with the feet within 2 cm of the floor;
- one shader program;
- the crowd costs at most 24 draw calls and 120k triangles at the overview, and at most 46 draw calls and 450k triangles at eye level.

**Risks:**
- **Draw calls.** If they go over: drop to 12 avatars, then switch to `BatchedMesh`.
- **Masks on `Male_04` and `Male_05`.** If the converter can't drop them, use those two for imaging roles only.
- **Coat skirts may stretch** when running. Fix by blending them toward the pelvis.

---

## Verification
- **Gates, per wave:**
  - `npm run typecheck`;
  - `npm test` (vitest with `--maxWorkers=2`; agents run only their targeted tests);
  - `npx vite build --outDir /private/tmp/claude-501/hospital-snapshot`.
- **Browser check** (a snapshot build in the `hospital-snapshot` preview, built-in pane):
  - Screenshots of you stopped at the reception desk, the café counter, a closed glass pharmacist door and a swing door, instead of walking through them.
  - Side-on frame sequences of start, walk, run, stop, backing up and turning on the spot.
  - The camera passing under a sign.
  - Overview and walk-mode views of the new light, and in Wave B, the people.
- **Program count** (`__hospitalWarm.programs()`) unchanged across Tab, V, a door, a MealBot, a scan and a Jump.
- **The budget at `?probe=1`:** at most 300 draw calls, 1.2 M triangles and 12 ms, at the overview and at eye level. Measured with `?lv=0`, `?refl=0`, `?look=model` and `?people=0` to see what each feature costs. The pane throttles the frame rate when it is hidden, so the final MacBook numbers are yours: `npm run show`, then Chrome at `/?present=1&probe=1`.
- **Your play-test, then a commit,** once per wave.
