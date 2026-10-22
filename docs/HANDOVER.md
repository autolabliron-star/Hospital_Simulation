# Handover: where The Ideal Hospital stands (2026-10-22)

Start here when continuing in a new session or account. Read `CLAUDE.md` (the rules) first, then this file, then
`docs/handover/ROADMAP-PLAN.md` (the approved plan, with the reality-bug audit in Part A and the 7 waves in Part B).

## The goal
A hospital that looks and works like a real one. Doctors will later walk it in a **Meta Quest 3** headset (WebXR) to meet new medical
devices from around the world.

Decisions made by the owner:
- **Look:** an architectural model of our own design, built in Blender. No real building.
- **Devices:** we model them ourselves; manufacturer models can be swapped in later.
- **Time:** real clinical durations, with skip ahead / 10x / 30x and the 07:30 showcase opening to keep demos lively.
- **Order:** realism first, then the headset. Every new asset must still fit the Quest 3 budget: 72/90 Hz, 13.8 ms a frame,
  under 200 draw calls, under 1.5 M triangles, about 250 MB of GPU texture memory.

## Owner's standing rules
- **Never commit without the owner's explicit OK.**
- Keep the game muted in browser checks (press `M` after Enter).
- Port 5174 is the owner's demo port. Use another port (5181, `hospital-dev-r3imaging` in `.claude/launch.json`) for your own checks,
  and stop servers you start.
- The owner likes many agents working in parallel, each on its own files. The machine allows at most about 2 heavy processes at once
  (vitest, Blender, builds).
- Show browser screenshots as proof.
- No `Math.random` under `src/sim`. Synthetic people only.

## Committed history (main)
| Commit | What |
|---|---|
| `edac900` | R3 leftovers: CT/MRI/X-ray chrome, every exam planned, the vein scanner, limb regions |
| `eea1f06` | A normal human walk and run, one free kiosk to demo, floor lines on Level 2 |
| `d9a1a00` | S1: hospital already at work at 07:30, skip ahead, 10x and 30x |
| `cc72e62` | R3: real screens (live imaging, the da Vinci endoscope, patient monitors) |

## Uncommitted work in the tree (about 100 files): commit only after the gates below pass and the owner says yes
Suggested split into commits: (1) Wave 1, (2) Wave 2 realism mode, (3) Wave 3 pipeline and pilot, (4) rule changes and docs.

### Wave 1: "A real clinical day" (simulation, `src/sim/**`, `src/content/**`). Three agents' reports are in `docs/handover/wave1-*.md`.
- **D: durations, imaging and crowd.** Finished.
  - The contrast CT's phases are 35–45 s apart, and reports take real minutes.
  - 64 outpatient slots run until 16:45.
  - No admission for minor complaints (`admitChance: 0`), and no apixaban for a stroke workup.
  - Older people walk slower (`population/age.ts`).
  - Post-op day cases leave in a wheelchair.
  - Stretchers and wheelchairs have a real footprint in the crowd (`nav/crowd.ts`).
- **W: medicines, rounds and shifts.** Finished.
  - Each medicine has dose times, and dose waves run at 08/12/14/18/22.
  - No duplicate orders.
  - One morning round 08:30–11:00, 6–10 min a bed.
  - Night staff, the 07:00/19:00 handovers, the 07:33 huddle and night checks.
  - New `day/wardDay.test.ts`, about 3.5 min.
- **E: the emergency department.** Stopped on purpose to save tokens; its report is `docs/handover/wave1-E.md`. Typecheck is clean.
  - Test bundles per complaint (`content/imaging.json` `erTests`); red flags always get their tests.
  - New bay states: care, then results, then the doctor's review. Admission is decided at the review and uses `admitChanceFor`.
  - The ER nurse does observations, cannula, ECG and bloods at the bedside, and sends the tubes by pneumatic tube (`er/bedside.ts`).
  - Priority 1–2 walk-ins go by wheelchair straight to a bay, with urgent barks (`reactions.ts`).
  - Arrivals peak at about 6.5 an hour.
  - 5 paramedic crews (`er/crews.ts`).
  - Older ER patients walk slower.
  - The S1 opening places 5 bays mid-stay.
  - **Still to fix or check:**
    - `er/kiosk.test.ts` "kiosk that never finishes": its window is too short for the 3–7 min triage.
    - `blood/morning.test.ts` expects ER bloods at the draw centre, so it fails by design. Update it.
    - E's new "ER at real durations" block in `population.integration.test.ts` was not re-run after its last tuning.
    - Bug in `day/shifts.ts`: `skipTalk` leaves the host's `retiring` flag set, so an ER nurse stopped working at 22:00. There is a
      20-minute self-heal in `er/staff.ts`; fix it properly in `shifts.ts`.
    - Run `reactions.test`, `opening.integration`, `warmStart`, `Simulation` and `skip.integration`.
- **Orchestrator edits:**
  - `src/sim/config.ts` holds the Wave 1 contract. `opening.medsAt` was removed: the 08:00 dose wave goes out at 07:30 instead.
  - `src/sim/opening/script.ts` and its test now only seed visitors.
  - The content tests are split into `imaging.test.ts`, `erTests.test.ts` and `outpatients.test.ts`.
- **Known open items:**
  - `population.integration.test.ts` had about 6 ER failures before E's last changes (see E's items above).
  - `src/ui/walk/drawerModel.test.ts` expects the old medicine list (W changed medicines.json). Update the expectation.
  - Decide whether `visitingOpen()` in `day/roster.ts` moves from 07:30 to 11:00. If it does, the opening's early visitors must become
    overnight companions (`Director.seedOpening`), or they are sent home at once.
  - Pharmacists and hosts still work around the clock; only ward nurses and doctors run on shifts.
- **The gates, still to run:**
  - `npx tsc --noEmit`
  - `npx vitest run --maxWorkers=2` (the full suite takes about 30 min: run it in the background)
  - `npx vite build --outDir /private/tmp/claude-501/hospital-snapshot`
  - then a muted browser check on port 5181.

### Wave 2: realism mode (`docs/handover/wave2-realism.md`)
- It is on by default in walk mode and toggled with `R` or the pill at the bottom left.
- It hides the emotes and speech bubbles, dims the teal glow to 0.4x, and turns the ceiling sensor disc into a plain white puck.
- Files: `src/ui/walk/realism.store.ts`, `RealismToggle.tsx`, `src/scene/fx/*`, `src/scene/daylight/*`, and the `sensorDisc` material in
  `src/scene/materials.ts`.
- Check that `sensorDisc` doesn't add draw calls (`?probe=1`).

### Wave 3: the architectural model pipeline (`docs/handover/wave3-bake.md`, `wave3-loader.md`)
- **Tools are installed locally,** checked against their published sha256 and pinned in `docs/ASSETS-POLICY.md`:
  - Blender 4.5.14 LTS at `~/Applications/Blender.app`;
  - KTX-Software 4.4.2 at `~/.local/ktx-software-4.4.2/bin`.
- **The pipeline is `npm run arch:pilot`** (about 3.5 min):
  1. `arch:plan`: `tools/arch/export-plan.ts` writes `assets-src/arch/plan.json` from `src/sim/places.ts`.
  2. `arch:bake`: `tools/arch/generate.py` builds the region in Blender, bakes Cycles lightmaps and exports glTF.
  3. `arch:build`: `tools/arch/optimize.mjs` applies meshopt, KTX2 lightmaps and the validator, and checks the budget.
- **Output:** `public/assets/building/pilot-lobby.glb` plus `lm_*.ktx2`. The pilot is 11 draw calls, 9.7k triangles and 15.5 MB of
  lightmaps.
- **Runtime:** `src/scene/building/model/` holds the loader (KTX2 transcoder in `public/basis/`, from `npm run copy-basis`), the
  lightmaps (intensity = `lightmapScale` × π), the overview cut (a clipping plane at 1.3 m, `clip.ts`) and the model-vs-plan test
  (within 2 cm). It is behind `?building=model` and off by default.
- **Rules:** `CLAUDE.md` and `docs/ASSETS-POLICY.md` now allow authored Blender assets through the pinned gate (CC0 textures, glTF,
  meshopt, KTX2, baked light).
- **Screenshots:** `docs/screenshots/wave3-pilot-lobby.jpg` (the Blender render) and `wave3-pilot-ingame.jpg` (in the game).

## Owner feedback (latest) and the recommended next step
"It doesn't look like real architectural demos; the hospital still looks game-like." The reasons:
1. The design is a bare white box: no materials, furniture, plants or daylight. The Blender render is plain too.
2. Only the lobby's shell is new; the furniture, people and the rest of the hospital are still the procedural game pieces.
3. The framing is a game's: a third-person avatar, a HUD and a minimap, and runtime lighting that flattens the bake.

**Recommended next step:** take one hero space, the lobby, to architectural-walkthrough quality before rolling out:
- **A real interior design:** a wood-slat ceiling, stone floor, a feature reception desk, designer seating, planters, and a glazed
  atrium with daylight.
- **CC0 PBR textures** (Poly Haven, ambientCG), fetched through the asset gate. Extend `tools/assets-lib.mjs` with
  textures/hdri/props, pinned and sha256-checked.
- **Furniture modelled in Blender** (Wave 4 kit).
- **A "presentation" mode:** a first-person, slow eye-level camera, no HUD, no avatar, AgX/Neutral tone mapping matched to Blender,
  reflections from an environment map.

Then show the owner one room that looks real, and only after that roll out to the whole building (Wave 3 full build).

## Later waves (see ROADMAP-PLAN.md)
- **Wave 2:** real sizes in `places.ts` (bed 1.0×2.2 m, ER bay 3.6 m deep, seats 0.45 m), and hand hygiene and fittings.
- **Wave 4:** furniture and devices, and the "Meet the device" showcase (`devices.json`). Resume the parked head and thorax imaging
  (`docs/handover/parked-regions/`).
- **Wave 5:** more avatars, gowns, hands and faces.
- **Wave 6:** Quest 3 WebXR. Blockers: PowerLoop `frameloop="never"`, the mono-only EffectComposer, DOM UI, and no HTTPS.
- **Wave 7:** AI marketing content.

## Useful commands
- Dev check: start `hospital-dev-r3imaging` (port 5181), then open `/?building=model&probe=1`. `probe=1` shows draw calls and
  triangles and exposes `__hospitalCam.view(x, y, z, dist, pitch, yaw)`.
- Demo: `npx vite build --outDir /private/tmp/claude-501/hospital-snapshot`, then start the `hospital-snapshot` config (port 5174).
- Keys: `Tab` walk, `Esc` overview, `V` first person, `H` clean screen, `M` mute, `R` realism, `J` jump, `]` skip.
- The browser pane in the desktop app can render at about 7 fps; that is the pane, not the game (one sim second costs 2 ms).
