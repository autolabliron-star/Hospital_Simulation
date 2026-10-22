# The Ideal Hospital: from prototype to a real-looking VR hospital

## Context
The goal: a hospital that looks and works like a real one, which doctors will one day walk through in 3D glasses to meet new medical
devices from around the world. Today it is a React Three Fiber prototype:
- a seeded 60 Hz simulation (`src/sim`);
- a procedural building and devices (`src/scene`);
- 14 Rocketbox avatars on a 20-part rig;
- live device screens (R3) and a showcase opening (S1).

The user asked for:
1. a search for the "reality bugs" in this prototype;
2. a plan to make it look like real life;
3. how to continue from here.

**Decisions (user, 2026-10-21):**
- **Headset:** Meta Quest 3 first, using WebXR in the Quest browser. Its limits become the binding budget for everything built from now on.
- **Look:** an architectural-quality model of our own "ideal" design. No real building.
- **Devices:** we model them ourselves, and swap in manufacturer models later.
- **Time:** real clinical durations. The existing skip ahead, 10×/30× and the showcase opening keep demos lively.
- **Order:** realism first, then the headset. Every new asset is still authored to the Quest 3 budget, so nothing has to be rebuilt.

**Quest 3 budget (Meta):**
- 72 Hz minimum, 90 Hz recommended;
- 13.8 ms per frame;
- under 200 draw calls;
- under 1.5 M triangles.

Today's measured walk-mode load is 122–228 draw calls and 316–490 k triangles, tuned for an M4 laptop.

---

## Part A: the reality-bug audit (what a doctor would notice)

### A1. How it looks (`src/scene/**`)
1. **Flat colour on every surface.**
   - 31 plain `MeshStandardMaterial`s (`src/scene/materials.ts`).
   - No texture, normal or roughness maps.
   - Boxes are stretched 0–1 UVs (`building/render/compile.ts`), so textures can't simply be added.
2. **No world outside.**
   - Flat background colour, no sky or fog (`World.tsx`, `daylight/lightAt.ts`).
   - The ground ends 10 m from the façade (`landscape/exterior.ts`).
   - Walking on level 1, the atrium has no roof or ceiling (`building/render/levelVisibility.ts`).
3. **Toy furniture and devices.**
   - Built from boxes and 10–18-sided cylinders.
   - Beds have no castors, rails or controls (`rooms/patientRoom.ts`).
   - The da Vinci is about 80 primitives (`surgery/rig.ts`).
   - Wheels never turn (`crowd/gear.ts`).
4. **Wrong sizes.**
   - Bathroom pod only 0.98 m tall (`patientRoom.ts`).
   - Curtain rails at 1.92–2.1 m instead of the ceiling (`rooms/triageEr.ts`, `rooms/surgery/shell.ts`).
   - Bed 0.95 × 2.0 m (real about 1.0 × 2.2).
   - ER bay 2.3 m deep (real about 3.6).
   - Waiting seat 0.37 m high (real about 0.45).
   - Trolley 0.44 m high.
   - All in `src/sim/places.ts`.
5. **Missing hospital things.**
   - Hand-wash sinks and gel dispensers.
   - Headwall gases and nurse call.
   - IV poles, glove and sharps boxes, clocks.
   - Exit signs, extinguishers, blinds.
   - Masks, gowns and gloves in the OR (the converter drops them, `crowd/avatars.ts`).
6. **People.**
   - About 200 people share 14 avatars. All male doctors are one avatar; nurses, pharmacists and cleaners share one.
   - Patients wear tinted street clothes, not gowns.
   - The rig is 20 rigid parts: no fingers, blinking, lips or gaze (`tools/convert-people.mjs`).
   - Blob shadows only, and visible dither at LOD fades.
7. **Flat light.**
   - The sun's shadow is baked from the 1.3 m cut model, so walk mode dims the sun to ×0.3 (`lighting/look.ts`).
   - The light volume is 0.5 m cells that know no furniture, so beds and desks float.
   - No reflections beyond an analytic ceiling.
8. **Game elements that break realism.**
   - Teal glow panels and a ceiling "sensor" disc.
   - Emote icons and speech bubbles in walk mode (`fx/EmoteLayer.tsx`).
   - The same 4×3 screen atlas on every desk.
   - Only 7 hanging signs.

### A2. How it works (`src/sim/**`)
1. **Medicine about every 11 minutes, around the clock.**
   - Each 22 s doctor visit writes a new order (`people.ts:64-175`).
   - `MedSystem.prescribe` never checks for a pending order (`meds/system.ts:131`).
   - Dose waves at 12/18/22 h give every usual medicine (`day/doseWaves.ts`): furosemide at 22:00, a statin three times a day.
   - No 08:00 round, and no dose times in `content/medicines.json`.
2. **Ward rounds of 22 s per bed, all night** (`config.ts:105-107`). Real rounds are 5–15 minutes, once each morning.
3. **The ER decides without tests.**
   - The exam lasts 90–180 s (real 10–20 min).
   - `testsChance` is 0.3, so 70% of strokes get no CT head (`config.ts:156-158`).
   - Admission is drawn when the exam starts (`er/pathway.machine.ts:152`).
   - No doctor reviews the results.
   - 10–20% of priority-1/2 patients go home.
4. **The ER is overfull for its size.**
   - Walk-ins peak at 48 an hour plus ambulances, into 6 bays with 2 doctors.
   - A bay turns over in 10–12 minutes (real 2–4 h).
   - This is why patients "go home 2–3 minutes after the reveal".
5. **Promised but not run.**
   - The 07:00 handover and night checks from the Jump captions (`content/day.json`).
   - `day/roster.ts:23` says ward staff are "not enacted".
   - `NIGHT_STAFF` is never spawned, so the day ward staff work 24 h.
6. **Critically ill walk-ins check themselves in at a kiosk** and chat cheerfully (`pathway.machine.ts:204`, `content/barks.json`).
7. **Care that is missing.**
   - ER bloods go to the outpatient robot centre instead of the bedside.
   - No nursing observations, cannula, ECG, oxygen or fluids.
   - No hand hygiene or PPE.
   - No consent, WHO time-out or count.
   - No code blue.
8. **Wrong durations, people and patterns.**
   - Admission check 60 s (real 30–60 min).
   - Room clean 6–9 min (real 30–60).
   - CT contrast phases 6–14 s apart (real 35–45).
   - ER CT report in 4–7 min (real 30–60).
   - Afternoon imaging slots are empty.
   - Visiting hours run from 07:45.
   - Sunburn or a cold can lead to admission.
   - An 88-year-old walks at 1.3 m/s.
   - Post-op patients walk out.
9. **Crowd quirks.**
   - NPCs walk through stretchers and wheelchairs, because the rider is a 5 cm disc (`er/actor.ts:35-38`).
   - Jam escapes and doorway yields shove people through (`nav/crowd.ts`).
   - Teleports are used as safety nets (`imaging/scanner.ts`, `surgery/case.ts`, `blood/nurse.ts`).
   - People pop in and out at the entrance and lifts.

### A3. Device fidelity today
- **High:** da Vinci 5 logic; robot blood draw; automated lab; health kiosks.
- **Medium–high:** MRI, X-ray, ultrasound, patient monitors.
- **Medium:** CT (no injector or cannula; a visible spinning rotor).
- **Stylised:** endoscope, MedVend, pods, MealBots, crash cart.
- **Imaging gap:** head and chest images (CT head, MRI brain, chest X-ray: the most common ER scans) are still vector pictures. The head and thorax regions are parked in the side-session notes folder, `parked-regions/`.

---

## Part B: the roadmap
Each wave runs as parallel agents with disjoint files, gated centrally with typecheck, the full suite, a scratch build and browser screenshots. Commits only on the user's word.

### Wave 1: "A real clinical day" (behaviour, real durations)
**Medicines**
- Give each medicine its dose times in `src/content/medicines.json` (zod schema in `content/medicines.ts` or its loader).
- A round writes orders once per patient per day: new or changed medicines only.
- `MedSystem.prescribe` skips anything already pending.
- Dose waves at 08/12/18/22 give only the medicines due (`day/doseWaves.ts`).

**Ward rounds and shifts**
- One morning round, 08:30–11:00, 6–10 min per bed with the nurse (`people.ts`, `config.ts`).
- Afternoon visits only for admissions; an on-call doctor at night.
- Wire the ward handover and night staff through the existing `day/shifts.ts` `ShiftManager`, `roster.ts` `NIGHT_STAFF`, `nightRounds` and `safetyHuddle` (built, tested, not run).
- Realistic shift lengths; a pool of paramedic crews (`population/director.ts`).

**ER**
- Exam 10–20 min.
- A test chance per reason, with bundles (chest pain: ECG + troponin + chest X-ray; stroke: CT head), in `content/imaging.json` `erTests`.
- Admission drawn after the results, plus a doctor review visit (`er/pathway.machine.ts`, `er/patient.ts`).
- Admit 1.0 / 0.95 for priority 1/2.
- Arrivals scaled to 6 bays (about 10–14 an hour at peak), with longer bay stays.
- Priority 1–2 walk-ins: wheelchair, straight to a bay, no kiosk, no cheerful barks.
- Bedside obs, cannula, ECG and bloods by the ER nurse; tubes leave by pneumatic tube.

**Durations and content (`config.ts`)**
- Triage 3–10 min; admission check 30 min; cleans 30–60 min.
- CT contrast phases 35–45 s apart; CT reports 30–60 min.
- Visiting 11:00/14:00–20:00.
- Outpatient imaging through 17:00 (`outpatients.json`).
- Fix admission profiles (`admissions.json`): no admission for sunburn or a cold; no apixaban without a CT.
- Slower walking for the old and for post-op patients; post-op patients leave by wheelchair.

**Crowd**
- Give a stretcher or wheelchair its real footprint for NPC avoidance (`er/actor.ts`, `nav/crowd.ts`, reuse `VEHICLE_HALF`).
- Draw curtains during exams; gowns for ER patients.

**Showcase**
- Re-place the S1 opening so it stays busy under real durations: ER bays mid-stay, not "waiting for a doctor" (`er/inFlight.ts`).

**Tests:** determinism and "every journey terminates" (CLAUDE.md), plus new checks:
- no patient gets the same medicine twice in its dosing interval;
- a doctor sees each bed once per morning;
- night staff are on site 22:00–07:00;
- ER bays are occupied ≥ 60 min;
- 100% of red-flag complaints get their test.

### Wave 2: "Real sizes and the things a hospital has" (in the contract, so the architecture follows it)
**Dimensions in `src/sim/places.ts` (orchestrator-owned contract)**
- Bed 1.0 × 2.2 m.
- ER bay 3.6 m deep.
- Seats 0.45 m; trolley height.
- Curtain tracks at ceiling height.
- A full-height en-suite with a door.
- Update the sim spots and tests that depend on these.

**Behaviour-linked fittings and props (data plus a sim hook)**
- Hand-rub at room entry and exit (a 3 s pose; dispensers registered as anchors).
- Sinks; headwall gases and nurse call.
- IV poles where patients need them.
- OR masks, gowns and gloves on the theatre team (an extended gear slot).

**A "realism mode" for walk mode**
- Hides emotes and speech bubbles, tones down the glow panels and the sensor disc, keeps the floor lines.
- It is the default in walk mode; the presenter can toggle it.

### Wave 3: "The architectural model" (the main look upgrade)
**Tools (local, offline)**
- Install Blender (free, LTS) and KTX-Software (`toktx`) for GPU-compressed textures.
- New scripts in `tools/arch/`, run headless from npm:
  1. `export-plan.ts` dumps `places.ts` (BUILDING, AREAS, DOORS, ROOMS, WALL constants, anchors) to JSON. The sim's floor plan stays the single truth.
  2. A Blender Python generator builds architecture to that plan:
     - walls with real thickness, skirting and corner guards;
     - door frames, with door leaves as separate named nodes for the existing door animation (`walk/doorBank.ts`);
     - suspended ceiling grids with light panels, windows with mullions and blinds;
     - a roof, parapet and the façade;
     - floor zones (vinyl, terrazzo, rubber).
  3. Materials from CC0 libraries that `docs/ASSETS-POLICY.md` already allows (Poly Haven, ambientCG), fetched through the asset gate (`tools/assets-lib.mjs`). The gate gets new kinds `textures`/`hdri`/`props` and types png/jpg/exr/glb, still pinned and sha256-checked.
  4. Bake the light in Blender Cycles (sun, sky and ceiling panels, with furniture contact shadows) into per-zone lightmaps on a second UV set.
  5. Export glTF, then optimise with gltf-transform (already a dependency): meshopt, KTX2 textures, LODs and a validator, following `tools/convert-people.mjs`.

**Runtime: a static model path (`src/scene/building/model/`)**
- Load behind `registerWarmGate`, with `MeshoptDecoder` and `KTX2Loader` served from `public/` (no CDN).
- Apply the lightmaps; keep the material count small and register the materials with warm-up.
- Keep `patchMaterialLook` only for live objects (people, devices); the baked architecture skips the light volume.
- Replace the static parts of `render/BuildingMeshes.tsx` and `render/walk/WalkBuilding.tsx`.
- Overview: a clipping plane at the cut height.
- Navigation, collision, the sun shadow for live objects and picking keep coming from `places.ts` (`sim/nav/layout.ts`, `player/solids.ts`, `blockers.ts`).
- A new consistency test checks that the model's walls and doors match `buildWallPieces()` within 2 cm.

**Exterior**
- An HDRI sky dome, distance fog.
- A ring of road, car park and low-poly neighbouring blocks.
- The roof always shown in walk mode.

**Pilot first:** the lobby, one ward room, one stretch of corridor A and the OR.
- Screenshots before and after.
- Measure draw calls, triangles, ms, shader programs and texture memory against the Quest budget.
- Only then roll out to the whole building.

**Rules (proposed edit to `CLAUDE.md` and `docs/ASSETS-POLICY.md`, needs the user's OK)**
- Replace "procedural, about 20 materials, no textures or models" with:
  - authored assets through the pinned gate;
  - KTX2 textures, a texture-memory cap (about 250 MB);
  - baked lighting for static geometry;
  - the Quest 3 budget as the target.

### Wave 4: "Real furniture and devices, and the device showcase"
**A furniture kit in Blender, as instanced glTF**
- Ward bed (castors, rails, controls, headwall), monitor arm, IV pole, chairs.
- Desks, cabinets, wheelchair, stretcher, carts.

**Devices re-modelled with named, animatable nodes that keep today's contracts**
- MRI, CT, X-ray and ultrasound: `imaging/machines/{mri,ct,xray,us}.ts`, `motion.ts`, `rig.ts`.
- da Vinci: `surgery/robotPose.ts`, `surgery/rig.ts`.
- Blood-draw robots: `drawCentre/rig.ts`.
- Kiosks: `kiosks/rig.ts`.
- The lab.
- Live screens keep their canvas textures (`imaging/live.ts`).

**The device showcase platform (the product's purpose)**
- `src/content/devices.json` (zod): maker, model, category, key specs, a short story, media, anchor, licence, "simulated" flags.
- An in-world info panel for each device.
- A "Meet the device" guided mode: fly to it, play its demo motion, show the talking points, then return. It reuses `interact.store.ts`, `camera/roomFocus.ts` and `ui/RoomPanel.tsx`.
- Built so a manufacturer's model can replace ours later by swapping one asset and keeping its node names.

**Imaging:** resume the parked head and thorax regions (`parked-regions/` in the side-session notes folder), so CT head, MRI brain and chest X-ray come from the synthetic body.

### Wave 5: "Real people"
- More Rocketbox avatars per role (already allowed by the gate).
- A patient gown asset; masks and gowns for the theatre team.
- Keep the hand and face bones: extend `PART_COUNT` beyond 20, or add a small skeleton path for close range, so hands grip and faces blink.
- Mocap clips for idles and gestures.
- Contact shadows for people near the camera.

### Wave 6: "Quest 3" (WebXR)
**XR session and frame loop**
- Add `@react-three/xr` (exact version, `npm install --ignore-scripts`, `npm audit`).
- An XR-aware frame loop: `src/app/PowerLoop.tsx` and `power.ts` must hand over to `renderer.setAnimationLoop` while presenting. Today `frameloop="never"` drops every XR frame. Don't pause on blur while in XR.

**Stereo-safe rendering**
- No EffectComposer in XR (`scene/Effects.tsx`).
- Renderer tone mapping Neutral, MSAA, foveation, `setFramebufferScaleFactor` instead of the pixel-ratio ladder (`quality/ladder.ts`).
- XR shader variants in warm-up (`warmup/*`).

**Camera and controls**
- An XR camera rig built from the first-person eye camera: player writes go to a dolly, with the level-2 offset (`player/system.ts`).
- Thumbstick locomotion through the pure `player/scheme.ts` `routeInput`, plus snap turn.
- A controller or hand ray for E interactions (`interact.store.ts`).

**In-headset UI**
- The room panel, Scan viewer (it already shares the live canvases) and HUD as 3D panels.
- An in-world Enter.

**Serving and checks**
- HTTPS on the LAN for the dev server (`vite.config.ts`).
- Local controller profiles (no CDN).
- A Quest probe and budget gate: 72/90 Hz, under 200 draw calls.

### Wave 7: AI content (Higgsfield and similar), around the product, not inside it
- Use Higgsfield for teaser and marketing videos, poster and signage art, and texture ideas (with the `product-teaser` skill for in-app recordings).
- World Labs Marble (Gaussian splats) only as an optional view outside the windows or for early concept previews. It is not accurate or walkable enough for the hospital itself.

---

## Verification (every wave)
1. `npm run typecheck`, `npx vitest run --maxWorkers=2`, `npx vite build --outDir /private/tmp/claude-501/hospital-snapshot`.
2. A muted browser check on our own port:
   - before/after screenshots in `docs/screenshots/<wave>-*.jpg`;
   - `__hospitalWarm.programs()` unchanged after Enter;
   - DevProbe draw calls, triangles and p95 ms.
3. From wave 3 on, also report the Quest budget numbers (stereo draw calls, triangles, texture MB). From wave 6, measure in the headset with Meta's WebXR performance workflow.
4. Wave 1 adds the clinical-realism tests above. Wave 3 adds the model-vs-plan consistency test.

## Risks
- **Rule changes** (procedural only → authored assets) need the user's sign-off. They come before wave 3.
- **Real durations** make the live demo slower. Keep the showcase opening and skip in step: every room shows mid-work at 07:30 and after a skip.
- **Blender automation** quality: start with the pilot rooms, and keep the procedural building as a fallback flag (`?building=procedural`) until the model covers everything.
- **Quest performance:** authoring to its budget from wave 3 avoids a rebuild. Splats and heavy post effects stay out of the headset.

## Sources
- [Meta Quest device optimization: 72/90 Hz, under 200 draw calls, under 1.5 M triangles](https://developers.meta.com/vr/resources/device-optimization-comparison/)
- [Meta WebXR performance workflow](https://developers.meta.com/horizon/documentation/web/webxr-perf-workflow/)
- [@react-three/xr (pmndrs)](https://pmnd.rs/blog/reintroducing-react-three-xr/)
- [visionOS 2 enables WebXR by default](https://roadtovr.com/visionos-2-webxr-support-vision-pro/)
- [Spark Gaussian splat renderer for three.js](https://sparkjs.dev/)
- [three.js r186 native splat renderer](https://radiancefields.com/three.js-merges-a-native-gaussian-splat-renderer-for-webgpu-in-r186)
- [World Labs Marble export formats](https://help.scenario.com/articles/4774055514-marble-by-world-labs-the-essentials)
- [Higgsfield Games 2.0](https://pasqualepillitteri.it/en/news/15065/higgsfield-games-2-gpt-6-astra-en)
- [That Open Company web-ifc (IFC/BIM in the browser)](https://github.com/ThatOpen/web-ifc-three)
- [Baking lightmaps for the web (Blender to three.js)](https://www.svilenkovic.com/3d/how-to-bake-lighting-for-web)
