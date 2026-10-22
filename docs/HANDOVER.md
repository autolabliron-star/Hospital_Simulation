# Handover: where The Ideal Hospital stands (2026-10-22, evening)

Start here when continuing in a new session or account. Read `CLAUDE.md` (the rules) first, then this file, then
`docs/handover/ROADMAP-PLAN.md` (the approved plan: the reality-bug audit in Part A and the 7 waves in Part B) and
`docs/review/demo-readiness.md` (the demo-readiness review, its findings F-01 to F-48 and work packages WP-1 to WP-9).

## The goal
A hospital that looks and works like a real one. Doctors will later walk it in a **Meta Quest 3** headset (WebXR) to meet new medical
devices from around the world.

Decisions made by the owner:
- **Look:** an architectural model of our own design, built in Blender. No real building.
- **Devices:** we model them ourselves; manufacturer models can be swapped in later. The research is in `docs/research/new-devices.md`
  (top 8 devices, a delivery plan; the owner still has to say which "laser against cancer" device they meant: MRI-guided LITT is the
  best fit).
- **Time:** real clinical durations, with skip ahead / 10x / 30x and the 07:30 showcase opening to keep demos lively.
- **Order:** realism first, then the headset. Every new asset must still fit the Quest 3 budget: 72/90 Hz, 13.8 ms a frame,
  under 200 draw calls, under 1.5 M triangles, about 250 MB of GPU texture memory.

## Owner's standing rules
- **Never commit without the owner's explicit OK.** Never `git checkout` or `git stash` over other agents' work.
- The game's ambience plays by default now (the mute flag is no longer remembered, F-03). For browser checks open the page with
  `?mute=1`, or press `M`.
- Port 5174 is the owner's demo port. Use 5181 for your own checks (`hospital-check`, `hospital-dev-r3imaging`), and stop servers you start.
- The owner likes many agents working in parallel, each on its own files. At most 2 heavy processes at once.
- **Tests go through the 2-slot lock script:** `/private/tmp/claude-501/hospital-vitest.sh <files or -t filters>` (it runs
  `npx vitest run --maxWorkers=2` once a slot is free; add `--silent=false` to see the `[M3]`, `[W1]` and `[soak]` log lines). It lives
  in `/private/tmp`, so recreate it if the machine was rebooted: the loop is `mkdir /private/tmp/claude-501/hospital-vitest.slot{1,2}`
  as the lock, `trap rmdir` on exit.
- Show browser screenshots as proof.
- No `Math.random` under `src/sim`. Synthetic people only.

## Committed history (main)
| Commit | What |
|---|---|
| `d497293` | Lobby as an arch-viz space (Blender v2), exterior grounds, presentation mode, and the first demo-readiness fixes |
| `bd1f87f` | Waves 1 to 3 and the lobby look work in progress: the clinical day, realism mode, the Blender pipeline |
| `edac900` | R3 leftovers: CT/MRI/X-ray chrome, every exam planned, the vein scanner, limb regions |
| `eea1f06` | A normal human walk and run, one free kiosk to demo, floor lines on Level 2 |
| `d9a1a00` | S1: hospital already at work at 07:30, skip ahead, 10x and 30x |
| `cc72e62` | R3: real screens (live imaging, the da Vinci endoscope, patient monitors) |

## Uncommitted work in the tree (check `git status`): commit only after the gates pass and the owner says yes
Roughly what is there: the demo-readiness fixes WP-1 to WP-9 (listed below), the Blender look match, the patient record, and the
test hardening. Suggested commits: (1) the review fixes and tests, (2) the look match (`src/scene/lighting/**`, `Effects.tsx`,
`reference` screenshots), (3) the patient record (`src/sim/records/**`, `src/ui/rx/**`, `patientHistory.*`). Demo from a commit or a
tag, never from the dirty tree (F-20): the 22:00 ER-nurse fix needs `shifts.ts` and its test together, and a half-reverted tree
brings the stall back.

- **Demo-readiness review fixes** (`docs/review/demo-readiness.md`, one section per work package):
  - WP-1 failure containment and power: a step that throws is contained (`SimLoop`, `stepSnapshot.test.ts`), an `ErrorBoundary`,
    the picture keeps running when the window loses focus, a fallback if building the hospital fails.
  - WP-2 presenter input: `hotkeyAllowed` table (`src/ui/hotkeys.ts`), M mute, the HUD hotkeys gated, Esc leaves the walkthrough.
  - WP-3 end of day and imaging: `src/ui/dayEnd.ts` (at 23:30 the app runs a Jump to 07:00 with "A new day"), imaging demo scans
    checked for the operator and the hour (`imaging/demo.test.ts`), the lifts history capped, a step snapshot in `Simulation.ts`.
    The X-ray "stuck in gap" watchdog could not be reproduced, and its log line now says what was in the gap (see "Open items").
  - WP-4 and WP-9 clinical content: surgery patient sex, admission chances by complaint, ER vitals by complaint
    (`content/erVitals.json`), `content/erEvents.json`, imaging and pharmacist-query content, `doseWaves.hours` (20:00 and 06:00).
  - WP-5 prescribing: pharmacist queries on duplicate and conflicting orders (allergy, NSAID with apixaban) in `meds/system.ts`
    and `content/pharmacistQueries.json`.
  - WP-6 rendering: the n8ao transparency fix, geometry upload in warm-up, the quality ladder never steps up while presenting.
  - WP-7 authored building safety: a failed model load falls back to the procedural lobby.
  - WP-8 test hardening: `src/sim/soak.test.ts`, tighter ER tests (see "Tests and gates").
- **Look match (in progress):** `src/scene/lighting/agxBlenderLut.ts`, `presentToneMapping.ts` (AgX matched to the Blender render),
  `src/scene/building/model/reflections.ts`, `src/scene/wayfinding/presentLines.ts`; screenshots `docs/screenshots/lobby-2-compare.jpg`
  and `lobby-match-2.jpg`.
- **Patient record (in progress), `docs/handover/patient-record.md`:** a **Record** tab on the prescribing tablet (E at a bedside, or
  P in the overview): banner with allergies, summary with NEWS2 (display only), the stay timeline, history. Content in
  `src/content/patientHistory.json`, logic in `src/sim/records/`, UI in `src/ui/rx/`. The demo path is room A2 (a pinned penicillin
  allergy): prescribing Amoxicillin raises the pharmacist's allergy query.

## What the committed lobby work is
- **Lobby v2 from Blender** (`tools/arch/`, split into modules): terrazzo floor, plaster ceiling with LED slots, a full-height glazed
  entrance, an oak slat wall, the reception desk, benches and planters, a Cycles bake with CC0 Poly Haven textures through the pinned
  gate, and a lobby reflection probe. 24 draw calls, 59k triangles, 34.5 MB of lightmaps and textures. Notes in
  `docs/handover/look-lobby.md` and `look-textures.md`.
- **Exterior grounds:** forecourt, lay-by, ring road, car park, trees and horizon blocks (4 draw calls), `docs/handover/look-exterior.md`.
- **Presentation mode,** `docs/handover/look-presentation.md`: first person at eye level, slow and smooth, no HUD or avatar, AgX tone
  mapping, a sky dome and a four-shot lobby glide.
- **The authored model is behind `?building=model`** and is off by default. A failed load falls back to the procedural lobby, but
  the demo has not been rehearsed with it on, so do not add it on stage unless it was checked that day.
- **The pipeline is `npm run arch:pilot`** (about 3.5 min, one Blender process): `arch:plan` writes `assets-src/arch/plan.json` from
  `src/sim/places.ts`, `arch:bake` builds and bakes in Blender, `arch:build` applies meshopt and KTX2 and checks the budget. Blender
  4.5.14 is at `~/Applications/Blender.app` and KTX-Software 4.4.2 at `~/.local/ktx-software-4.4.2/bin`, both pinned in
  `docs/ASSETS-POLICY.md`. Output: `public/assets/building/*.glb` plus `lm_*.ktx2`; runtime loader in `src/scene/building/model/`.

## The simulation, in short (Wave 1, `docs/handover/wave1-*.md`)
- Real durations: contrast CT phases 35 to 45 s apart, reports take minutes, 64 outpatient slots to 16:45, older people walk slower,
  stretchers and wheelchairs have a footprint in the crowd.
- Medicines have dose times, dose waves at 08/12/14/18/20/22/06, one morning round 08:30 to 11:00, night staff, handovers at 07:00 and
  19:00, a 07:33 huddle.
- The ER: test bundles per complaint, care then results then the doctor's review (admission decided there), the bedside nurse and the
  pneumatic tube, wheelchair walk-ins for priority 1 and 2, about 6.5 arrivals an hour at the peak, 5 paramedic crews.
- Arrival tables are for one day (06:30 to 23:30). The app ends the day with the new-day Jump (WP-3), so day 2 is never dead.
- Pharmacists and hosts still work around the clock; only ward nurses and doctors run on shifts. `visitingOpen()` in `day/roster.ts`
  stays at 07:30 (moving it to 11:00 would need the opening's early visitors to become overnight companions, `Director.seedOpening`).

## Tests and gates
- `npx tsc --noEmit`, `npm test` (the full suite takes about 30 min: run it in the background, through the lock script),
  `npx vite build --outDir /private/tmp/claude-501/<scratch>`, then a muted browser check on port 5181.
- Long integration tests (minutes each): `src/sim/population.integration.test.ts` (about 10 min), `reactions.test.ts`,
  `opening.integration.test.ts`, `day/wardDay.test.ts` (about 3.5 min).
- **Soak test `src/sim/soak.test.ts`** (about 40 s): Jumps to 07:45, 18:00 and 22:30 (each a fresh hospital, as the app builds it), a run
  to 23:30, then the new-day Jump to 07:00. Asserts no throw, finite positions, a bounded headcount (30 to 180; seen 48 to 106) and every
  department's `stuckFixes` at most 2 per leg (seen 0).
- ER tests are tighter than before: "stuck" now means arrived more than 2 h before the end of the run (it was 4 to 5 h), and the bay
  clean wait is capped at 30 min. That is the time from the patient leaving to the bay being ready: the clean itself takes 5 to 10 min
  (`config.ts` `cleanSeconds`), so the old 5 min cap (10 min was proposed) cannot hold; the longest measured is about 24 min.
- The X-ray "stuck in gap" filter is gone from the reactions tests: any imaging stuck line now fails them.

## Open items
- **X-ray "stuck in gap" watchdog (F-14):** it fired in earlier full-day runs but WP-3 could not reproduce it, and the two reactions
  morning tests now pass with no filter. If a line shows up, `imaging.stuckLog` has the new detailed text (the step, the gap and who was
  in it): start from `src/sim/imaging/scanner.ts`.
- `opening.integration.test.ts` still stops at 20:00; the soak test covers 22:30 to 23:30 and the day end.
- The full suite has not been run on the final tree; the owner's gates above are still to run before any tag.
- Patient record and the Blender look match are unfinished (see above); the look match needs the owner's eye.
- Decide whether the demo uses `?building=model` (needs a rehearsal), and tag the build that is shown.

## Owner feedback and the recommended next step
"It doesn't look like real architectural demos; the hospital still looks game-like." The lobby v2, the exterior and presentation mode
answer the first two points for the lobby. The rest of the building is still the procedural game pieces, furniture and people
included. Recommended: show the owner the lobby in presentation mode, get the look-match sign-off, and only then roll the pipeline out
to the whole building (the full Wave 3 build).

## Later waves (see ROADMAP-PLAN.md)
- **Wave 2:** real sizes in `places.ts` (bed 1.0 x 2.2 m, ER bay 3.6 m deep, seats 0.45 m), and hand hygiene and fittings.
- **Wave 4:** furniture and devices, and the "Meet the device" showcase (`devices.json`, from `docs/research/new-devices.md`). Resume
  the parked head and thorax imaging (`docs/handover/parked-regions/`).
- **Wave 5:** more avatars, gowns, hands and faces.
- **Wave 6:** Quest 3 WebXR. Blockers: PowerLoop `frameloop="never"`, the mono-only EffectComposer, DOM UI, and no HTTPS.
- **Wave 7:** AI marketing content.

## Useful commands and keys
- **Launch configs (`.claude/launch.json`):** `hospital-dev` (5173), `hospital-snapshot` (5174, the demo build from
  `/private/tmp/claude-501/hospital-snapshot`), `hospital-check` (5181, a preview of `/private/tmp/claude-501/hospital-check`, the one
  to use for a checked build), `hospital-dev-r3imaging` (5181, dev server), `hospital-before` (5181, an older preview).
- **Demo build:** `npx vite build --outDir /private/tmp/claude-501/hospital-snapshot`, then start `hospital-snapshot`.
- **URL options:** `?seed=` replays a day (default 20261012), `?start=<hour>` warm start, `?opening=quiet` an empty 07:30, `?mute=1`
  starts muted, `?pauseOnBlur=1` pauses when the window loses focus (off by default, so screen sharing never freezes the picture),
  `?view=present` starts in presentation mode, `?building=model` the authored building, `?probe=1` draw calls and triangles plus
  `__hospitalCam.view(x, y, z, dist, pitch, yaw)` and `__hospitalPresent`.
- **Keys** (the table is `hotkeyAllowed` in `src/ui/hotkeys.ts`; nothing but `Enter` works on the loading screen except `M`):
  - `Tab` walk, `V` first person, `E` interact (at a bedside it opens the tablet), `P` prescribe tablet, `F` follow, `T` tour, `G` go to,
    `L` level, `J` jump, `]` skip, `H` clean screen, `R` realism, `Space` pause, `1 2 4 0 3` speeds (1x to 30x).
  - `M` toggles mute in every mode (also while presenting), except while typing in a field.
  - `C` toggles presentation mode, `N` the next shot while presenting, `Esc` leaves presentation mode, closes menus and returns to the
    overview (it always works).
  - While presenting, `P J H R G ]` do nothing (no UI to show them); `Space`, the speed keys, `C`, `N`, `M` and `Esc` still work.
- The browser pane in the desktop app can render at about 7 fps; that is the pane, not the game (one sim second costs 2 ms; a step
  about 30 to 150 us).
