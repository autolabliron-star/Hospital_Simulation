# Demo readiness review: The Ideal Hospital (2026-10-22)

Scope: a read-only review of the working tree on `main` at `bd1f87f`, plus about 100 uncommitted files. It covers src/sim, src/scene, src/ui, src/app, src/content, the build, and the Blender asset path.
- `tools/arch/**`, `public/assets/building/**` and `src/scene/building/model/**` were being edited by other agents during the review. They were reviewed as they stood, and the findings about them are marked **(in flux)**.
- Nothing was run in a browser.

What was run:

| Command | Result |
|---|---|
| `npx tsc --noEmit` | Clean |
| `npx vite build --outDir <scratch>` | OK. Main chunk 2.09 MB (699 kB gzip). No runtime URLs to other hosts. The basis transcoder ships in `basis/`. |
| `vitest` on warmup, frameAllocations, ui/present and app | 121 passed, **1 failed** (finding F-11) |
| `vitest` on er/kiosk, blood/morning, drawerModel, wardRoomView, day/shifts, landscape and building/model | 80/80 passed. The failures that HANDOVER.md lists for these tests are fixed in the tree. |
| The full suite (about 30 min) | Not run (shared machine) |

Confidence labels:
- **confirmed**: I traced the mechanism in code, or a test showed it.
- **likely**: the mechanism is clear but the trigger was not reproduced.
- **possible**: a defensive concern.

---

## 1. Executive summary

**Verdict.** The code is built well, better than most demo codebases:
- The rules are followed: the simulation lives outside React, it is seeded, slow state goes to stores at 4 Hz, and the frame order is explicit.
- `src/sim` has no `Math.random` or `Date.now`.
- Listeners are cleaned up.
- The loading-screen guards are solid: gate timeouts, a 30 s watchdog, and the sim held paused until Enter.
- The step loop is capped, and the game clock is clamped to 0.1 s, so there is no catch-up spike after a tab switch.
- No CDN or runtime network use was found: the build is offline-safe.

But the build is **not yet safe for a live demo in front of doctors**, for four reasons:
1. **There is no failure containment at all.** A single exception in a sim step freezes the picture for good. A single render error in any panel blanks the whole page. There is no error boundary, and no try/catch in the frame loop.
2. **Normal presenting habits break it:**
   - The scene pauses whenever the browser window loses focus, which includes clicking Zoom, Teams or a notes window.
   - The advertised `M` mute key does not exist.
   - Hotkeys work invisibly behind the loading screen and inside presentation mode.
3. **Doctors will notice clinical nonsense within minutes:**
   - a robotic hysterectomy on a man, and a prostatectomy on a woman;
   - the ward round starting apixaban, levothyroxine or metformin at random;
   - 5 % of stroke patients sent home;
   - "a cannula" for sunburn;
   - monitors that look normal on a breathless priority-1 patient;
   - a prescribing tablet that "verifies" any drug for any patient.
4. **The day ends badly.** After 23:30 the hospital drains and never refills (no ER, doses, surgery or visitors). At 10x that is about 6 minutes after a Jump to 22:30. Also, "Start a scan now" on MRI or ultrasound after 18:00 hangs.

None of these needs a redesign. Almost all are S-effort fixes. With the work packages in section 10 (about 2 to 3 agent-days in parallel), the build is fit for a scripted laptop demo. It is **not** ready for Quest 3: the PowerLoop, the composer and the DOM UI are known Wave 6 blockers.

### Top 10 must-fix before the demo

| # | ID | One line |
|---|---|---|
| 1 | F-01 | Contain exceptions: try/catch in `SimLoop.frame` and `PowerLoop` tick, plus React error boundaries around the Canvas and each HUD group. Today one throw means a frozen or blank demo. |
| 2 | F-02 | Stop pausing on window blur (`power.ts:55-58`). Screen sharing or clicking another window freezes the hospital. |
| 3 | F-21 | Patient sex must match the procedure (`surgery/index.ts:158`): hysterectomy on male names, prostatectomy on female names. |
| 4 | F-22 | The ward round may only add safe symptomatic drugs (`people.ts:327-341`), not random apixaban, levothyroxine or metformin. |
| 5 | F-23 | Fix the admission chances (`config.ts:193`, `admissions.json`): stroke, fits and confusion are always admitted; neck bump, rash and ear pain almost never. |
| 6 | F-03 | Add the `M` mute key (it exists only in the keymap) and a visible mute state. Check the persisted `ideal-hospital.muted` in localStorage. |
| 7 | F-05 | Handle the end of the day: auto-Jump to a new morning, or pause with a banner, at 23:30. Never show the dead day 2. |
| 8 | F-06 | Make "Start a scan now" refuse when no operator is on duty (MRI and ultrasound after 18:00). Today the button hangs and a patient is parked forever. |
| 9 | F-10 | Turn off n8ao's transparency auto-detect (`Effects.tsx:151`). Today it re-renders the whole scene twice more per frame, and traverses and allocates every frame. |
| 10 | F-04 | Gate the HUD hotkeys: none before Enter, and no stacking under an open menu. In presentation mode, Space and the speed keys need a visible indicator or must be ignored. |

Close behind: vitals that match the complaint (F-24), credible copy on the prescribing tablet (F-25), the red warm-up coverage test (F-11), and a cue for presentation mode (F-08).

---

## 2. Findings table

Severity:
- **Blocker**: likely to break or embarrass a demo.
- **High**: visible and probable.
- **Medium**: visible under conditions.
- **Low**: polish, or a rare case.

Effort is S (≤ ½ day), M (1–2 days) or L.

| ID | Sev | Area | File:line | What goes wrong in the demo | Reproduce | Fix | Effort | Confidence |
|---|---|---|---|---|---|---|---|---|
| F-01 | Blocker | Crash | `src/sim/SimLoop.ts:40-71`, `src/app/PowerLoop.tsx:113-126`, `src/app/App.tsx:113-158`, `src/main.tsx` | A throw in `sim.step` skips the rest of `advance()`, including the composer, so the picture freezes with a console error every frame. A throw in any React panel unmounts the root, so the page goes blank. There is no `ErrorBoundary` in src. | Any of the throwing paths: `rng.pick([])` (`rng.ts:59`), `seats.ts:79,113,125,147`, `lifts/index.ts:143`, the `!` derefs in `er/staff.ts` and `surgery/case.ts` | try/catch around each step, `sync` and `publish`. Count failures; after N, pause and Jump to the current hour behind the veil. Boundaries per HUD group (fallback `null`) and around the Canvas (a "Reload" card). try/catch around `advance()`. | S–M | confirmed (mechanism) |
| F-02 | Blocker | Input/env | `src/app/power.ts:55-58`, `PowerLoop.tsx:50-52` | When the window loses focus, frames, sim and audio stop. On Zoom or Teams the shared picture freezes whenever the presenter clicks the meeting toolbar or a notes window. | Click outside the browser window | Pause on `document.hidden` only. Keep blur-pause behind a `?pauseOnBlur=1` flag. | S | confirmed |
| F-03 | High | Input/audio | `src/sim/types.ts:462` (`mute:'KeyM'` unused), `src/ui/ScanViewer.tsx:139` ("(M)" label), `src/audio/audio.store.ts:21-39` | HANDOVER says "press M after Enter", but nothing happens and ambience plays in front of the audience. Mute is persisted in localStorage, so a muted test session silently mutes the demo. | Press M | Handle `KeyM` in `Hud.tsx` `useHotkeys` (presentation mode included). Add a speaker pill outside the hideable HUD. Show the mute state on the loading screen. | S | confirmed |
| F-04 | High | Input | `src/ui/Hud.tsx:55-105`, `RoomKeys.tsx`, `PresentationControls.tsx` | Hotkeys are live before Enter: J opens and focuses the Jump menu under the loading screen, after which Enter triggers a Jump; digits set 30x before the day starts; `]` rebuilds during the warm-up. The keys ignore open menus, so G, P or `]` act under the Jump menu. | Press J or 3 on the loading screen | Return early while `!useWarmup.getState().entered`. Gate P, G, J, H, R, `]` and the digits on `!menuOpen()`. Make the HUD root `inert` while loading. | S | confirmed (no `entered` check), likely (focus theft) |
| F-05 | High | Sim | `population/schedule.ts:11-19`, `director.ts:77-83`, `config.ts:547-586`, `day/doseWaves.ts:66-79`, `surgery/index.ts:150-162,264-272`, `sim/index.ts:70` | Every arrival table is for day 1 only. After 23:30 there are no ER walk-ins, ambulances, visitors, dose waves, surgery or ward bloods, and the hospital looks dead. Only the skip is clamped. | J to 22:30, 10x, wait about 6 min | Watch `sim.t >= skipLimit()` and run the Jump flow to 07:00 ("a new day") behind the veil, or auto-pause with a caption. Real multi-day (`h % 24`) later. | S (guard) / L | confirmed |
| F-06 | High | Sim/UI | `imaging/department.ts:281-303`, `imaging/scanner.ts:154-156`, `day/roster.ts:20`, `ui/ScanViewer.tsx:177-196,251` | After 18:00 MRI and ultrasound have no operator. "Start a scan now" still books the scan and walks a demo patient to the hall. The scanner is never `free`, the button stays disabled ("waiting for patient") forever, and the patient stands there. | J to 18:00 or 19:00, open the MRI room, click Start | `startDemoScan` returns false when `!scanner.op`, and the viewer shows "No radiographer on duty". Or keep a demo operator. | S | confirmed |
| F-07 | High | Input | `Hud.tsx:61` (comment "Space and the speeds still are"), `WalkClock.tsx` | In presentation mode (or with H) the HUD is hidden, but Space pauses and 1/2/4/0/3 change speed with nothing on screen. A stray Space looks like a frozen bug. | `?view=present`, press Space | Ignore Space and the digits while presenting, or show a tiny always-on "Paused / 30x" pill outside the HUD. | S | confirmed |
| F-08 | Medium | Input | `PresentationControls.tsx:27`, `content/walk.json:58-63`, `player/system.ts:259,779` | Presentation mode has no on-screen cue and only C exits it. Esc and Tab do nothing, and the hint never mentions C or N. C pressed during the overview flight is silently undone. | Press C by accident | A 3 s toast on entry and exit ("Walkthrough: C to exit, N next shot"). Let Esc exit when the pointer is not locked. | S | confirmed |
| F-09 | Medium | Input | `src/styles/base.css` (no `overscroll-behavior`), `player/input.ts:135-139` | A two-finger horizontal swipe on a MacBook trackpad while a panel is open navigates back, and the live day is lost. Cmd+R or Cmd+W have the same result. | Open the tablet, swipe left | `html,body{overscroll-behavior:none}`, `touch-action:none` on the canvas wrapper, and `beforeunload` in demo builds | S | likely |
| F-10 | High | Perf | `src/scene/Effects.tsx:151-160`, `node_modules/n8ao/src/N8AOPostPass.js:307-319,381-420,641,677` | n8ao auto-detects any `transparent` material (glass `materials.ts:77`, blobs, labels, crowd), so it is always true here. Every frame it traverses the full scene at least 4 times, allocates a `Map` and 2 `Color`s, and renders the whole scene twice more into 2 full-res HalfFloat targets (about 70 MB). That means more draw calls, GC, and lower ladder headroom. | Any AO rung 0-4 | In the `aoRef` callback set `pass.configuration.transparencyAware = false`, which also disables auto-detect. Then re-measure with `?probe=1`. | S | confirmed (code path); cost unmeasured |
| F-11 | Medium | Perf/gate | `src/scene/warmup/manifest.ts:28-58` | `materialCoverage.test.ts` **fails today**: `src/scene/landscape/grounds/material.ts` is unlisted. The runtime is fine (mounted hidden plus a warm source), but the guard is red and `npm test` cannot pass. | `npx vitest run src/scene/warmup` | Add a `{count:2, via:'mounted'}` entry | S | confirmed (test run) |
| F-12 | Medium | Perf | `src/scene/warmup/run.ts` (compile and `initTexture` only), `building/render/walk/warm.ts:12-13` | Geometry and instance buffers upload on the first frame they are drawn. Expect a hitch at the first Tab into walk (the walk building, the 32 k-triangle exterior, the sky), at the first lift ride to Level 2, and the first time each avatar LOD appears. | Enter, then Tab | After the compile, one hidden-reveal render of the walk and Level 2 sets into a 1×1 viewport behind the loading screen, then restore | M | likely |
| F-13 | Medium | Sim | `config.ts:46-48`, `sim/index.ts:55-67,89-92` | A skip of more than 3 min (`]` is 15 min, Shift+`]` is 1 h) **rebuilds** the hospital. The presenter's pending order, the people mid-journey and the bed occupants are redrawn. "I just ordered paracetamol, where did it go?" | P, order, then `]` | Carry the presenter orders across `jumpTo`, or make `]` live up to 15 min. Say it in the demo script. | M | confirmed |
| F-14 | Medium | Sim | `imaging/scanner.ts:599-625`, `reactions.test.ts:705,1025` | The X-ray "stuck in gap" safety net fires during live days: the radiographer teleports. The tests filter this message out instead of failing. | A full day with X-ray traffic | Find the root cause, then remove the filter from the tests | M | confirmed (fires) |
| F-15 | Medium | Sim | `surgery/case.ts:395,534,951`, `beds/index.ts:182-186`, `director.ts:119-126`, `er/paramedic.ts:70-72,147` | Stuck nets that log but never recover. A surgery patient waits forever for the lift or the team. An ER patient is abandoned in a ward bed on a bed-book violation. One crew in `holding` with no timeout blocks every later ambulance. | Rare | Give each net a forced fallback (like the lift bank's 300 s), and a timeout on `holding` | M | possible |
| F-16 | Low | Sim | `SimLoop.ts:42` | `Math.min(NaN, 0.1)` gives NaN, which poisons `acc` and stops the sim for good. | Only if `dt` is ever non-finite | `if (!(dt > 0)) dt = 0` | S | possible |
| F-17 | Low | Sim | `lifts/index.ts:88,147` | `history` keeps every trip with full Person references, so the memory is never freed. Small per day; it grows across Jumps only as long as the old sim lives. | Hours | Cap at about 50, or store numbers only | S | confirmed |
| F-18 | Low | Sim | `sim/index.ts:49` | The sim is built at module import with no guard. A throw from content or `?start=` gives a white page. | A bad content edit | try/catch, falling back to the default seed and start | S | possible |
| F-19 | Low | Sim | `Simulation.ts:275-315`, `day/shifts.ts:287-290` | Splicing `people` while iterating means one person skips a step during a shift swap: a one-frame pop. | Shift change | Iterate a snapshot or defer removals | S | confirmed |
| F-20 | Medium | Docs/process | `docs/HANDOVER.md:56-66` | The handover is stale: the kiosk, morning-bloods and drawerModel tests pass now, and the `skipTalk` bug is fixed in the uncommitted tree (`shifts.ts:691-718` plus a test), with the `er/staff.ts` self-heal removed. Reverting one without the other brings the 22:00 ER-nurse stall back. Demoing from an uncommitted tree is a risk in itself. | — | Commit Waves 1–3 in the suggested split once the gates pass, then demo from a tag | S | confirmed |
| F-21 | Blocker | Clinical | `src/sim/surgery/index.ts:158`, `content/roster.ts:126` (`presentationOf`), `content/surgery.json:10-18` | Patient names are drawn without regard to the procedure, and the avatar's sex follows the first name. A surgeon will see a man in "Robotic hysterectomy" or a woman in "Robotic prostatectomy". | Watch the OR list | Draw the name from the female or male name pools by procedure, with a stable draw count | S–M | confirmed (code) |
| F-22 | High | Clinical | `src/sim/people.ts:327-341`, `config.ts` `round.changeChance 0.25` | 25 % of round visits add a PRN drug or **a random regular drug from the whole catalogue**: apixaban for sunburn, levothyroxine, metformin for a non-diabetic, bisoprolol for an asthmatic. It shows on the drawer card and the room panel. | Watch the 08:30–11:00 round | Restrict additions to a safe list (paracetamol, senna, macrogol, lactulose, omeprazole, ondansetron), or add `roundAdds` per profile | S | confirmed |
| F-23 | High | Clinical | `config.ts:193` (`[1,.95,.45,.1,.03]`), `content/admissions.json` | Priority-2 patients go home 5 % of the time, including "Sudden weakness down one side", "Fit that has now stopped" and "Confused and very drowsy". "Minor car bump, neck sore" is admitted 45 % of the time. Rash, ear pain and sore throat are admitted 10 % of the time. Admission ignores the results. | Watch the ER events | `admitChance: 1` for weakness, fit-confusion, collapse and chest pain; 0.05 for neck; split allergy and throat-ear | S | confirmed |
| F-24 | High | Clinical | `src/sim/vitals/model.ts:98-99`, `content/lab.json` `erPanels` | Vitals shift only for the 7 reasons in `erPanels`. "Breathless and struggling to speak", collapse, stroke, asthma and "Cough and fever" show near-normal vitals: a priority-1 breathless patient at SpO2 about 94 % and 36.6 °C. Everything is sinus rhythm and nothing alarms. | Open an ER monitor | A reason-to-vitals table for every acute reason. Optionally a caption "Display only, alarms off in this demo". | S (shifts) / M (alarms) | confirmed (code), likely (look) |
| F-25 | High | Clinical/UI | `src/sim/meds/system.ts:133-190`, `src/ui/Hud.tsx:375,384`, `config.ts` `verifySeconds: 8` | The presenter's tablet orders any of 18 drugs for any bed, with no dose, route or frequency, and skips the duplicate and interval checks. The "pharmacist verifies" step approves 5 paracetamols in a row, or ibuprofen for the apixaban or heart-failure bed. The UI shows "Sent as ord-12" and is labelled "Prescribe (developer panel)". | P, send twice | Hide the id and the "developer" label. Show the dose and frequency from the catalogue. Add a small content table of pharmacist queries (duplicate, NSAID with anticoagulant or HF) with "Queried: …". | M | confirmed |
| F-26 | Medium | Clinical | `src/sim/er/patient.ts:314` | "Nurse … is taking observations and a cannula from X" for every ER patient, including a cold, sunburn or a cut finger. | Watch ER events | Add the cannula only with bloods, contrast or acuity ≤ 3 | S | confirmed |
| F-27 | Medium | Clinical | `pathway.machine.ts`, `config.ts:180-189` | A stroke is scanned only after care plus the exam: door-to-CT about 35–60 min. A chest pain in the waiting room has no ECG while the bays are full. | Follow a stroke walk-in | Order the CT in parallel with care for priority 1–2 stroke and collapse; an ECG at triage for chest pain | M | likely |
| F-28 | Medium | Clinical | `content/medicines.json` dose hours, `CONFIG.doseWaves.hours` 8/12/14/18/22 | Apixaban BD at 08 and 18; ibuprofen TDS at 08, 12 and 18; levothyroxine with breakfast and the other morning drugs. | Read the drawer card | Add a 20:00 (and 06:00) wave. Apixaban [8,20], ibuprofen [8,14,22], levothyroxine at 06. | S–M | confirmed |
| F-29 | Medium | Clinical | `meals/plan.ts:35` | No diet logic: stroke work-up, "Confused and very drowsy" and "vomiting" patients are served lunch and say "Lunch was lovely". | Watch the 12:00 meals | `diet: 'nbm'` per profile; no tray and no bark | S–M | confirmed |
| F-30 | Medium | Clinical | `surgery.json` phases, `surgery/plan.ts` | There is no WHO sign-in, time-out or sign-out, and no PACU discharge criteria. A surgeon will ask. | Watch an OR case | Add content-only events at existing phase boundaries | S | confirmed |
| F-31 | Medium | Clinical | `content/outpatients.json` op-50, op-12, op-60; `imaging.json` ct-abdo, c-spine chance | A kidney stone gets a contrast dual-phase CT (should be non-contrast CT KUB). Nodule follow-up gets a contrast CT. "Pancreas check" uses an ultrasound protocol with no pancreas view. A neck bump gets a CT C-spine 90 % of the time. | Imaging list | Re-point the reasons to fitting protocols or add protocols; lower the c-spine chance | S | likely |
| F-32 | Low | Clinical | `day/roster.ts:129-138`, `config` visitors, `dischargeTeachSeconds` | The ER doctor and nurses work 24 h. One night nurse per ward. A visitor peak during lunch. Discharge teaching of 35–50 s. | — | Add a night ER set; shift the visitor curve; lengthen the teaching | M | confirmed |
| F-33 | Low | Clinical/copy | `er/patient.ts`, `meds/system.ts`, `imaging/*`, `Hud.tsx`; `signs.json` vs `bloodCopy.json`; `monitors.json` `rpm` | Copy outside `src/content` (against CLAUDE.md). UK and US mixed ("ER", "OR", "Command center" next to "centre", "theatre"). "tummy" in 3 reasons. Respiratory rate in "rpm". | — | A copy pass into content JSON, with one vocabulary (UK) | M | confirmed |
| F-34 | Low | Content | `content/lab.ts` (bare `.parse`), `content/staff.ts` (no schema) | A content error throws at import, with no file name and no fallback (see F-01). | Edit the JSON badly | `parseOrThrow` everywhere; a `staff.json` schema; a clinical sanity test (`low<mean<high`, SpO2 ≤ 100) | S | confirmed |
| F-35 | Medium | UI | `ui/walk/typing.ts:19-21`, `RealismToggle.tsx`, `ScanViewer.tsx` | After clicking a HUD button (the Realism pill, Sound), Space activates that button instead of pausing: realism flips mid-demo. | Click Realism, then press Space | Blur HUD buttons on pointerup | S | confirmed |
| F-36 | Low | UI | `JumpMenu.tsx:30-35` | J focuses the current moment, so J then Enter or Space is an unconfirmed full rebuild. | J, Enter | Focus the Close button on open | S | confirmed |
| F-37 | Low | UI | `scene/interact/keys.ts:45`, `typing.ts:14` | With the tablet's room `<select>` focused, Esc and P no longer close the tablet. | Change the room, press Esc | Blur on change, or handle Esc on a SELECT | S | confirmed |
| F-38 | Low | UI | `ui/walk/HealthCard.tsx:73-80` | A capture-phase Esc closes the health card and stops propagation, so a menu above it needs a second Esc. | — | Route it through `closeOverlays` | S | likely |
| F-39 | Low | UI | `player/input.ts:123,244-251` | Pointer lock is invisible: a click hides the cursor, and the HUD pills are unreachable until Esc. Chrome refuses to re-lock for about 1 s, and the refusal is swallowed. | Click the canvas | An "Esc releases the mouse" hint; retry the lock | S | confirmed |
| F-40 | Low | UI | `hud.css:57-66,558`, `walk.css` | Fixed 13 px text is tiny on 4K. At 1280×720 the KPI card and the tablet stack, and Send may fall off. The drawer, health and console cards share right:16, bottom:16. | A projector at 720p | Use `min-height:0; overflow:auto` and clamp() font sizes; test 1280×720 | S | possible |
| F-41 | Medium | Perf | `quality/ladder.ts:280-311`, `quality/dprDefer.ts:20` | The ladder steps down after one bad window, but up only after about 16 s of p95 ≤ 7.2 ms (hard with F-10), so it can settle at DPR 1 with AO off. A deferred DPR change still lands mid-walk after 6 s and reallocates the composer: a hitch. | A long walk in a crowd | Fix F-10 first. No up-steps while presenting. Re-tune `upWorkShare`. | S | possible |
| F-42 | Low | Perf | `scene/imaging/index.tsx:21`, `surgery/liveEndoscope.ts:22` | The focused imaging screen and the endoscope repaint and upload at 10 Hz, against CLAUDE.md's ≤ 2 Hz. | Open a scan | Write the exception into CLAUDE.md, or drop to 4 Hz | S | confirmed |
| F-43 | Low | Perf | `actors/crowd/crowdRig.ts:353-367` | The full pose texture (about 415 kB) and the blob buffers re-upload every frame, whatever the head count. | — | `addUpdateRange` for the live rows | S | likely |
| F-44 | Low | Robustness | no `webglcontextlost`/`restored` handler in src; `Lighting.tsx:73-114` | After a GPU reset (an external display plugged in mid-demo) the PMREM environments are lost: dark ambient and no reflections until reload. | Plug in the projector after load | Rebuild the environments on `webglcontextrestored`. Or rule: plug in before loading. | M | possible |
| F-45 | Medium | Assets (in flux) | `building/model/loader.ts:46,80-91`, `PilotModel.tsx:21` | With `?building=model`, one missing or corrupt `lm_*.ktx2` rejects `Promise.all`, so the whole model is null. Because the procedural lobby was already hidden, **the lobby has no walls**, with only a console warning. Files are being regenerated now (`lm_Skirting.ktx2` was deleted; today every referenced lightmap exists). | Delete one lightmap | `Promise.allSettled` per lightmap. On a null model, un-hide the procedural region. Add `.catch` in `PilotModel`. Add a test that every lightmap the glb names exists. | S | confirmed (code) |
| F-46 | Low | Assets | `building/model/loader.ts:80-85`, `PilotModel.tsx:17-20` | The warm gate resolves before React commits the model, so the model's programs may compile on the first lobby frame. | `?building=model` | Mount synchronously inside the gate, or resolve after the commit | S | possible |
| F-47 | Low | Assets | `actors/crowd/avatarLoader.ts:116-124`, `warmup/run.ts:150` (`gateMaxMs 10000`) | On a slow disk, avatars that arrive after the 10 s gate give-up compile their programs mid-demo. Failure falls back to procedural people, which is fine. | A cold start | Keep the procedural people until the next warm opportunity, or precompile the avatar material separately | S | possible |
| F-48 | Medium | Tests | `population.integration.test.ts:221,224,314`, `reactions.test.ts:698-705,1017-1025`, `opening.integration.test.ts:80-88`, `stepCost.test.ts` | The tests are too lenient to catch demo bugs. "Stuck" ignores the last 4.5–5 h. The ER clean-wait cap went from 5 to 45 min. X-ray stuck lines are filtered out. No test crosses 23:30, none does repeated Jumps, none contains a step throw, and there is no soak test. | — | See WP-8 | M | confirmed |
| F-49 | Low | Build | `vite.config.ts:9` (`chunkSizeWarningLimit 2500`), the build log | The main chunk is 2.09 MB (699 kB gzip). `imaging/index.tsx` has an ineffective dynamic import. The basis transcoder is bundled twice (in `assets/` and `basis/`, +585 kB). Load time only. | `vite build` | Split the content and sim chunks; drop the bundled transcoder | S | confirmed |
| F-50 | Info | Quest | `PowerLoop.tsx` (`frameloop="never"`), `Effects.tsx` (n8ao, MSAA ×4, LUT), DOM HUD, no HTTPS | The known Wave 6 blockers. The current composer cannot meet the Quest budget (< 200 draw calls, about 250 MB textures; the MSAA HalfFloat target alone is about 90 MB at DPR 1.5). | — | A separate XR render path (`setAnimationLoop`, no composer, in-world UI, HTTPS via `vite --https` with a local cert) | L | confirmed |

---

## 3. Crashes and unhandled errors (F-01, F-18, F-34, F-44 to F-47)

**No containment anywhere** (confirmed):
- `grep ErrorBoundary|componentDidCatch src` finds nothing.
- `SimLoop.frame` calls `sim.step` in a bare loop.
- `PowerLoop`'s tick re-arms rAF and then calls `advance()` unguarded.

R3F's `update()` (`node_modules/@react-three/fiber/dist/events-*.js:17400-17423`) runs the subscribers in order and then renders. The composer is a positive-priority subscriber, so when the sim (priority < 0) throws:
- nothing after it runs: no camera, no labels, no composer render;
- the canvas keeps the last image;
- the HUD (DOM) keeps updating at 4 Hz from the last publish, so the frozen 3D view looks like "the game hung".

The throw sites are real. `rng.pick` on an empty list, the unknown-seat checks in `seats.ts`, the duplicate lift owner, and `!` derefs on patients and staff. Wave 1 changed behaviour in all of these areas.

**What is good:**
- Warm gates are bounded: `gateMaxMs` is 10 s, a rejected gate counts as done, and the loading screen has a 30 s `GIVE_UP_MS` watchdog. The loading screen cannot hang.
- The lobby HDR probe resolves null on any failure.
- Avatar load failure falls back to procedural people.
- The imaging worker logs errors (`worker/client.ts:83`).
- Jump and skip rebuild first and swap last, inside try/catch (`jumpFlow.ts:95-123`), and the cover always has a timer backup (`jump.store.ts:16-30`).

**The recommended pattern** (WP-1):
1. Wrap each `sim.step` in try/catch.
2. On the first error, `console.error` once, set `useWorld.simError`, and keep stepping, because most throws are local to one entity.
3. After 3 consecutive failing frames, pause, then call `useJump.getState().jump(hourAt(sim.t))`. That is a rebuild at the same hour behind the veil, which the presenter sees as a normal fade.
4. Add React boundaries around: Canvas (show "Something went wrong, Reload"), Hud, RoomPanel, GoToMenu, JumpMenu, the walk cards, and LoadingScreen (fallback: the Enter button only).

---

## 4. Simulation robustness (F-05, F-06, F-13 to F-19)

Strong points, confirmed by reading:
- No `Math.random`, `Date.now` or `performance.now` in sim decisions. `performance.now` only caps steps per frame.
- Stable sorts with explicit tie-breaks.
- The lift grant is all-or-nothing.
- `ArrivalProcess` has an iteration guard.
- Meals use multi-day keys.
- `GameClock` clamps to 0.1 s; `maxStepsPerFrame` and `stepBudgetMs` drop the leftover, so there is no spiral of death at 30x.
- `jumpTo` builds before it swaps.
- `SimKeyed` remounts only the per-sim layers.

The weak point is **time beyond the day**:
- `rateAt` returns 0 after the last point of every curve.
- `DoseWaves` walks `CONFIG.doseWaves.hours` once.
- Surgery plans once.
- `teamLife` and the ward round compare unwrapped hours (`people.ts:123,229,232`: 32.5 on day 2).
- `shifts.reconcile` builds a single 24 h window.

At 1x this never matters (07:30 to 23:30 is 16 h of wall clock). At 10x after a Jump to 22:30 it takes about 6 minutes; at 30x from the opening about 32 minutes.

**Rebuild skips** (F-13): steps above `liveMaxSeconds` (180 s) call `skipRebuild`, which redraws the bed book for the new hour. A patient the presenter was following may vanish or change.

---

## 5. Rendering stutter and performance (F-10 to F-12, F-41 to F-43, F-49, F-50)

**Clean, by inspection and tests:**
- No per-frame allocation in the frame paths I read: crowd, monitors, surgery, lab, kiosks, drawers, pods, presentation glide.
- No per-frame zustand writes.
- The daylight driver writes only uniforms.
- The environment swaps keep the same PMREM layout, so there is no recompile.
- No runtime define or light changes.
- The exterior is 4 draws and about 32 k triangles.
- Frame priorities are negative, except the composer's.

**The confirmed cost is n8ao** (F-10):
- Its `detectTransparency()` traverses the whole scene **every frame**, with no early exit.
- Once it has found a transparent material (the glass material always exists), `renderTransparency()`:
  - allocates `new Map()` and `new Color()` twice,
  - traverses the scene 4 more times,
  - renders the whole scene twice into two full-resolution HalfFloat targets.

So every frame pays for 3 scene renders, plus thousands of `obj.visible` writes and their restore. This alone could explain a tight 12 ms budget and a ladder that never climbs back (F-41). The fix is one line; after it, measure `?probe=1` (calls, triangles, `workP95`) at the default view against CLAUDE.md (≤ 300 calls, ≤ 1.2 M triangles, ≤ 12 ms).

**Not measured:** the draw-call total at the default view. This needs `?probe=1` in a browser, which this review did not use. The overview building estimate is 56 of its 90.

**The warm-up compiles but does not upload geometry** (F-12). Expect one hitch of tens of ms at the first Tab and at the first ride to Level 2.

---

## 6. Input and UI traps (F-02 to F-04, F-07 to F-09, F-35 to F-40)

### Keyboard map (as built)

| Key | Handler | Active |
|---|---|---|
| Tab | `player/input.ts:102,186`, `system.ts:259` | Walk ⇄ overview. Ignored in presentation mode (default prevented). On the loading screen it is the browser's Tab (moves focus to the HUD behind). |
| WASD, arrows, Shift | `input.ts:281-283` | Walk. Any of them ends a presentation glide. |
| V, Q | `input.ts:190,194` | Walk; V not in presentation mode |
| E | `interact/keys.ts:86-94` | Walk, no overlay, not presenting |
| Esc | `interact/keys.ts:46,98`; `HealthCard.tsx:73-80`; `JumpMenu.tsx:40-56`; `GoToMenu.tsx:36`; `RoomKeys.tsx:23-32`; browser (pointer lock, fullscreen) | **Does not exit presentation mode** |
| Space | `Hud.tsx:64` | All modes, **including loading and presentation**. Skipped on a focused button. |
| 1, 2, 4, 0 (10x), 3 (30x) | `Hud.tsx:69-83` | All modes, **including loading and presentation** |
| `]`, Shift+`]` | `Hud.tsx:84` | Not in presentation mode; also during loading |
| P, J, R, H | `Hud.tsx:89-98` | Not in presentation mode; also during loading |
| G | `RoomKeys.tsx:35` | Not in presentation mode |
| L | `ui/levelKey.ts:35-46` | Overview, no menu open |
| C | `PresentationControls.tsx:27` | Always (not while typing) |
| N | `PresentationControls.tsx:30` | Presentation mode only |
| **M** | **none** (`types.ts:462` unused) | **Never** |
| T, F | in the keymap, unused | Never |

Listener cleanup is correct everywhere. Blur and visibility clear held keys (`input.ts:108-111`).

---

## 7. Clinical credibility (F-21 to F-33)

**Doctors will like these:**
- SI and UK lab units and ranges, the tube order of draw, real MRI TR/TE values, CT windows, the contrast CT 35–45 s phase gap, and MRI and X-ray safety checks.
- The "Simulated, not real patient data" mark on every screen.
- Barks are schema-guarded against doses and diagnoses.
- No MRN, NHS number or date-of-birth formats anywhere.
- Synthetic names only.

**They will catch these** (ordered by how fast):
1. The sex of the patient versus the procedure (F-21).
2. Random drug starts on the round (F-22).
3. Strokes and fits sent home, rashes admitted (F-23).
4. Normal-looking monitors on very sick patients (F-24).
5. A cannula for everyone (F-26).
6. The tablet that "verifies" anything (F-25).
7. Lunch for nil-by-mouth patients (F-29).
8. No WHO checklist (F-30).
9. Dose times (F-28).
10. Imaging protocols (F-31).

**Content-level gaps:**
- No treatments are shown (oxygen, nebulisers, aspirin, steroids).
- No VTE prophylaxis after the knee surgery.
- Amoxicillin for a UTI.
- No lactate or cultures in the fever bundle.
- BMI "usual" range up to 29.9 on the kiosk (`kioskUi.json:36`).

These are fine as "choreography" if the presenter says so up front. Put that line in the demo script (section 9).

---

## 8. Offline and demo environment

- **Offline: pass.** No `fetch` to other hosts. drei is used only for `CameraControls` and `Html` (no `Environment` or `Text` CDN fetches). No web fonts. The KTX2 transcoder comes from `public/basis`. The avatars and the people index load from `public/assets/people`. The build output has no external runtime URLs.
- **Build: pass** (`vite build`, 23 MB with assets).
- **WebXR (Wave 6):** it needs HTTPS (or localhost) on the headset, an XR-capable loop (`frameloop="never"` with a custom rAF does not drive `XRSession.requestAnimationFrame`), and a render path without the composer.
- **Uncommitted tree:** about 100 files, and other agents are editing the model. Demo only from a commit or tag, with a build made from it (F-20).

---

## 9. Demo-day checklist

### Before the day
1. Merge WP-1 to WP-4 (at least the Top 10). Run `npm run typecheck`, `npm test` and the build. Commit, and tag `demo-YYYYMMDD`.
2. Build the snapshot from the tag: `npx vite build --outDir /private/tmp/claude-501/hospital-snapshot`, then start the `hospital-snapshot` config (port 5174).
3. Rehearse once on the demo laptop with `?probe=1`:
   - Note the draw calls, triangles and `workP95` at the default view, after Tab, and on Level 2.
   - Check the quality rung after 5 min of walking.
4. Clear `localStorage` for the demo origin (the mute flag, prefs). Confirm the sound plays.

### Safe settings
- **URL:** `http://127.0.0.1:5174/?present=1`
  - The default seed 20261012 is the one most tests cover.
  - The default start is 07:30 with the showcase opening.
  - **Do not** add `?building=model` until F-45 is fixed and the lobby has been checked that day.
  - `?present=1` keeps the scene running when the window loses focus (the F-02 workaround until it is fixed).
- **Machine:**
  - Chrome on mains power (battery caps the overview at 30 fps).
  - Plug in the projector or display **before** loading the page (F-44).
  - Use a separate browser window. Turn notifications off (Do Not Disturb). Close DevTools.
  - Full screen with Ctrl+Cmd+F.
- **Speeds:** 1x for walking, 10x for showing flow. Use 30x only in short bursts.
- **Time:** stay between 07:30 and about 22:00. If you get near 23:00, press **J** and pick a morning moment.

### Avoid on stage (until fixed)
- Pressing keys on the loading screen. Press **Enter** only.
- **M** (does nothing). Mute through the OS if needed.
- "Start a scan now" on MRI or ultrasound after 18:00 (F-06).
- `]` or Shift+`]` while you are following a patient or an order you placed (F-13).
- The prescribing tablet (P) unless scripted: send one sensible drug once (F-25).
- Space or the digits in presentation mode (invisible pause or speed, F-07).
- Clicking the Realism pill, then Space (F-35).
- Swiping sideways on the trackpad (F-09).
- Pausing on an OR case before you have checked the patient's sex (F-21).

### Presenter's line for doctors
"Everything here is synthetic. The timings are real, but the clinical choices are choreography to show devices and flow. The sim makes no clinical decisions."

### Recovery
| Symptom | Do |
|---|---|
| The 3D view is frozen, the HUD clock still moves or stops | Press Space twice (it may simply be paused). If still frozen: **J**, then the current moment (a rebuild behind a fade). If that fails: Cmd+R, then Enter (about 10–20 s). |
| Blank page | Cmd+R, then Enter |
| No HUD and keys "dead" | Press **C** (presentation mode), then **H** (clean screen), then Esc (pointer lock) |
| Avatar keeps walking | Click the canvas, tap the stuck key; or Cmd+Tab away and back (blur clears keys) |
| Empty or quiet hospital late in the day | **J**, then 07:45 or 09:00 |
| Scan button stuck "waiting for patient" | Close the panel and Jump |
| Stutter after a while | Let it settle for 20 s; or reload (the quality ladder restarts) |

---

## 10. Fix plan: parallel work packages (disjoint files)

At most 2 heavy processes at a time. Each package runs its own targeted vitest with `--maxWorkers=2`, and the orchestrator runs the full gates at the end.
- **Contract-file edits** (`types.ts`, `config.ts`) are listed as change requests for the orchestrator.

### WP-1: Failure containment and power (sonnet)
**Files:** `src/sim/SimLoop.ts`, `src/app/PowerLoop.tsx`, `src/app/power.ts`, new `src/app/ErrorBoundary.tsx`, `src/app/App.tsx`, `src/main.tsx`, `src/sim/index.ts` (construction fallback only).

**Fixes:** F-01, F-02, F-16, F-18.

**Tests to add:**
- `SimLoop.test.ts`: a step that throws once is contained, and the loop keeps stepping; N consecutive throws call the recovery hook; NaN and negative `dt` are ignored.
- `power.test.ts`: blur without hidden does not pause; hidden pauses.
- `ErrorBoundary` render test (node and react-dom/server): a child that throws renders the fallback.

**Change request:** `config.ts` `sim.maxConsecutiveStepErrors`.

### WP-2: Presenter input and HUD (sonnet)
**Files:** `src/ui/Hud.tsx`, `src/ui/RoomKeys.tsx`, `src/ui/present/PresentationControls.tsx` (+ a toast), `src/ui/walk/typing.ts`, `src/ui/walk/RealismToggle.tsx`, `src/ui/JumpMenu.tsx`, `src/ui/walk/HealthCard.tsx`, `src/scene/interact/keys.ts`, `src/styles/*.css`, `src/content/walk.json` (hint copy), `src/audio/audio.store.ts`.

**Fixes:**
- F-03, F-04, F-07, F-08, F-09, F-35 to F-40.
- The tablet's display text from F-25: hide `ord-N`, rename "developer panel".

**Tests:**
- A pure `hotkeyAllowed(code, {entered, presenting, menuOpen, typing})` table test.
- M toggles mute in all modes.
- C or Esc exits presentation mode.
- The JumpMenu focus target is Close.

**Change request:** `types.ts` KeyMap entries for realism and present.

### WP-3: End of day and imaging demo (sonnet)
**Files:** new `src/ui/dayEnd.ts` (watcher: at `skipLimit()` it calls the Jump flow to 07:00 with a "A new day" caption), `src/ui/jump.store.ts`, `src/sim/imaging/department.ts`, `src/sim/imaging/scanner.ts` (X-ray gap root cause, F-14), `src/ui/ScanViewer.tsx`, `src/sim/lifts/index.ts` (F-17), `src/sim/Simulation.ts` (F-19).

**Fixes:** F-05 (guard), F-06, F-14, F-17, F-19.

**Tests:**
- `imaging/demo.test.ts`: `startDemoScan` at 19:00 on MRI returns false and spawns nobody.
- `dayEnd.test.ts` with fake timers.
- `lifts` history capped.
- A full-`Simulation` test from 22:30 to 23:40 with no throw, and the watcher fires.

### WP-4: Clinical behaviour A, the visible nonsense (sonnet)
**Files:** `src/sim/surgery/index.ts`, `src/sim/people.ts` (`maybeChange`), `src/content/admissions.json` (+ `admissions.test.ts`), `src/sim/er/patient.ts` (cannula), `src/sim/vitals/model.ts` plus a new `src/content/erVitals.json` (with its zod schema and test), `src/content/roster.ts` (name pools by presentation).

**Fixes:** F-21, F-22, F-23, F-24, F-26.

**Tests:**
- Every hysterectomy patient's presentation is female and every prostatectomy patient's is male, across 20 seeds.
- Round additions are always in the safe list.
- `admitChanceFor` returns 1 for stroke, fit and confusion; ≤ 0.05 for neck; 0 for rash and ear pain.
- Each acute reason shifts the vitals the right way (SpO2 down for breathless, temperature up for fever).
- SpO2 ≤ 100 everywhere.

**Change request:** `config.ts` `round.changeChance` comment and the safe list (or keep it in content).

### WP-5: Clinical behaviour B, prescribing credibility (sonnet, after WP-2 lands its Hud.tsx edits)
**Files:** `src/sim/meds/system.ts`, new `src/content/pharmacistQueries.json` (+ schema and test), `src/ui/rx/*` (move the tablet out of `Hud.tsx` in a one-line hand-off with WP-2).

**Fixes:** F-25.

**Tests:**
- A duplicate paracetamol is queried.
- NSAID plus apixaban is queried.
- A query is shown in the UI model and does not dispense until confirmed.

### WP-6: Rendering and warm-up (sonnet)
**Files:** `src/scene/Effects.tsx`, `src/scene/warmup/manifest.ts`, `src/scene/warmup/run.ts`, `src/scene/quality/ladder.ts`, `src/scene/quality/dprDefer.ts`, `src/scene/actors/crowd/crowdRig.ts`, `src/scene/imaging/index.tsx`, `src/scene/surgery/liveEndoscope.ts`, `src/scene/Lighting.tsx` (context restore), `src/scene/frameAllocations.test.ts`.

**Fixes:** F-10, F-11, F-12, F-41 to F-44.

**Tests:**
- `materialCoverage` green.
- An Effects config test that `transparencyAware` is false after the ref callback.
- Ladder: no up-step while presenting.
- Extend the allocation scan to `.map(`, `.filter(`, template literals and `toFixed` inside `useFrame` bodies and the named step functions.

**Verify by eye:** `?probe=1` numbers before and after the n8ao change.

### WP-7: Authored building safety (after the lobby agents finish; in flux)
**Files:** `src/scene/building/model/loader.ts`, `PilotModel.tsx`, `building/index.tsx` (un-hide on failure), `model.test.ts`.

**Fixes:** F-45, F-46.

**Tests:**
- Every lightmap named in the glb exists in `public/assets/building`.
- A null model leaves the procedural region visible.

### WP-8: Test hardening and docs (haiku for mechanical parts, sonnet for the soak test)
**Files:** `src/sim/population.integration.test.ts`, `src/sim/reactions.test.ts`, `src/sim/opening/opening.integration.test.ts`, new `src/sim/soak.test.ts`, `docs/HANDOVER.md`.

**Fixes:** F-48, F-20.

**Tests:**
- A soak test: 3 Jumps (07:45, then 18:00, then 22:30) and a run to 23:30 at the default seed, asserting:
  - no throw;
  - entity counts bounded;
  - `stuckFixes` bounded for every department;
  - no NaN positions.
- Restore the ER clean-wait cap to 10 min.
- Fail on X-ray stuck lines once WP-3 fixes them.
- Narrow the "arrived in the last 5 h" exclusion to 2 h.

### WP-9: Clinical content pass (later, sonnet plus a clinician's read)
**Files:** `src/content/medicines.json`, `outpatients.json`, `imaging.json`, `surgery.json`, `meals` plan, `signs.json`, `monitors.json`, `kioskUi.json`, `lab.json`, `day/roster.ts`; move the hard-coded copy into content.

**Fixes:** F-27 to F-34.

**Change request:** `config.ts` `doseWaves.hours` (+20:00, +06:00).

**Order:**
- In parallel: WP-1, WP-2, WP-3, WP-4, WP-6. Pairwise disjoint, except that WP-1 and WP-3 both import `jump.store`: WP-1 calls it, and only WP-3 edits it.
- Then WP-5 (after WP-2), WP-7 (after the lobby agents), WP-8 (after WP-3), and WP-9.
