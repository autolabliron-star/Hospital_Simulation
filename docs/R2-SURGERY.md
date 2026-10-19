# R2: Robotic surgery on Level 2 (a da Vinci 5 suite stacked over the hospital)

The brief for the R2 agents. Read `CLAUDE.md` first, then this, then the contract files it names. The user approved the plan on 2026-10-19.

## What the user asked for
Research the da Vinci surgical robot, then add a room with that robot so the hospital can do surgeries, **on the second floor**. They chose:
- **Full robotic suite:** pre-op holding bays, one da Vinci operating room with a scrub sink and a viewing window, recovery (PACU) and sterile supply.
- **Real procedure times**, skippable with Jump.
- **You can watch and sit at a console:** through the viewing window, and at a teaching console with E (a simulated endoscope view, view only).
- **A da Vinci 5** (FDA 510(k) 14 March 2024): an Xi-style patient cart with 4 arms on an overhead rotating boom, plus force feedback, integrated insufflation and a new console.
- **A true stacked storey over the hospital**, with a Level 1 / Level 2 switch in the overview.

## Research (the numbers the build uses; sources in `src/sim/config.ts` `surgery`)

| Item | Numbers |
|---|---|
| Patient cart | About 0.98 × 1.49 m; 1.74 m stowed, 2.47 m with the boom up; 821 kg |
| Surgeon console | 0.97 × 0.86 m, 1.45–1.78 m tall |
| Vision cart | 0.68 × 0.93 m |

**Set-up and docking:**
1. The arms are draped before the patient comes in (about 5–6 min).
2. "Deploy for docking": the arms fold.
3. Drive the cart with the **laser crosshairs** to within 5 cm of the endoscope port.
4. Dock the endoscope arm.
5. **Targeting:** the boom turns and the other arms swing onto their ports.

Docking takes about 7–8 min.

**Console time:** cholecystectomy 15–30 min (60–90 min room time); hysterectomy about 2 h; prostatectomy 2–3 h.

**Team:** surgeon at the console, bedside assistant, scrub nurse, circulator, anaesthetist.

**Room:** about 56–60 m². Ours is 72 m².

## The approach: one flat sim, two levels on screen (`src/sim/levels.ts`)
- **Level 2 lives in its own strip of the 2D sim, `sim x = drawn x + 150`** (sim x 88..110, 40 m past the plinth).
  - The levels never overlap in 2D, and no query radius reaches across the gap. So areas, `isWalkable`, the nav graph, the crowd, seats, collision, the camera boom, sight lines, door sensing and audio all work per level **with no floor field**.
  - `levelOf(simX)` (level 2 at sim x ≥ 70), `l2(drawnX)` for authoring, `LEVEL2_FOOTPRINT` (drawn x -62..-40, z -22..22: over the lobby, triage, ER, the main corridor and both lift shafts).
- **The sim stays flat.** `groundHeightAt` is 0 everywhere, and sim y is floor-relative.
  - **Drawing is one rigid translation:** `toDisplayInto(simPos, out)` moves level 2 by (-150, +4.2, 0).
  - The level-2 scene is authored in sim coordinates inside ONE group at `position [-150, 4.2, 0]`.
  - Never feed a drawn position back into the sim, and never a sim position into a drawn one without the mapping.
- **Lifts are the only way between the levels** (`src/sim/lifts`).
  - `tryPlanRoute` returns null across levels.
  - `planRoute` returns `[from]` across levels: the walker stays put. A cross-level `goTo` is a bug: use a lift trip.
- **Seats:** `SeatRegistry.claim` with no `area`/`ids` in the filter stays on the level of `near` (level 1 without one).

## The contract (Wave 0, done by the orchestrator; re-read before use, ask for changes under "Change requests")
- **`src/sim/levels.ts`:** `LevelId`, `LEVEL_Y`, `LEVEL2_DX`, `LEVEL2_SPLIT_X`, `LEVEL2_FOOTPRINT`, `LEVEL2_STRIP`, `levelOf`, `levelDx`, `l2`, `toDisplayInto`, `toSimInto`, `underLevel2`, `rectLevel`.
- **`src/sim/places.ts`:**
  - areas `l2LiftA`, `l2LiftB`, `l2Corridor`, `l2PreOp`, `l2Staff`, `l2Sterile`, `l2Hall`, `l2Or`, `l2Pacu`, `l2Lounge`, and 9 doors (`l2LiftA/B`, `l2PreOp`, `l2Hall` (a 4 m opening), `l2Sterile`, `l2Staff` (swing), `l2Or` (auto 1.8), `l2Lounge`, `l2Pacu`);
  - `VIEW_WINDOWS` (the OR's corridor window: x = l2(-44), z 2.8..5.8);
  - `LIFTS[shaft][level]` (`door`, `stretcher` spot, `walkers` spots, `cars` spots);
  - `SURGERY` (table, ports by `PortLayout`, cart park and dock, consoles, vision cart, anaesthesia, back table, Mayo stand, circulator desk, staff spots, scrub sink, viewing spot);
  - `PREOP`, `PACU`, `THEATRE_BASE`.
- **`src/sim/types.ts`:**
  - `AnimState` `'console'`; `SeatKind` `'orTable' | 'surgeryBed'`; `Outfit` `'theatre'`;
  - events `surgeryArrived`, `preOpReady`, `theatreIn`, `robotDocked`, `consoleStart`, `instrumentExchange`, `robotUndocked`, `theatreOut`, `pacuOut`, `turnoverDone`;
  - state types `SurgeryProcedure`, `CasePhase`, `SurgeryCaseView`, `RobotPhase`, `RobotArmState`, `RobotState`, `TheatreKpis`, `TheatreState`, `SurgeryBayState`, `SurgeryState`, `LiftCarPhase`, `LiftCarState`, `LiftsState`;
  - `KeyMap.level` = `KeyL`.
- **`src/sim/config.ts`:** `surgery` and `lifts` (every number cited); Jump moment 8.5 ("Robotic surgery", `content/day.json`).
- **`src/content/staff.ts`:** `StaffPost 'theatre'`; `THEATRE_STAFF` (9, with `title`): `or-surgeon` (Dr. Elena), `or-assistant` (Dr. Amir), `or-anaes` (Dr. Keiko), `or-scrub` (Nurse Andreas), `or-circ` (Nurse Clara), `or-preop` (Nurse Fatima), `or-pacu` (Nurse Ben), `or-porter` (Porter Basil), `or-cleaner` (Cleaner Lina). No new `Role`.
- **Ports, frozen:** `src/sim/lifts/ports.ts` `LiftsPort` (`state`, `claimFade`, `releaseFade`, `playerRide`); `src/sim/surgery/ports.ts` `SurgeryPort` (`state`, `cases`, `setTeaching`). Skeletons: `LiftBank` and `Surgery` (`startDay`, `step`, `sync`, `warmStart`), wired in `Simulation.ts` (after the draw centre: lifts, then surgery) and on `world.lifts` / `world.surgery`.
- **Nav (`src/sim/nav/graph.ts`):**
  - the level-2 block: the corridor chain at x l2(-42), lift lobbies, the viewing anchor `l2:viewing`, door and in-nodes, the hall line along z 0, lattices (OR spacing 3), `l2:theatreBase`;
  - the sanity BFS roots: the entrance plus level-2 lift A;
  - the grids are widened: nav `GRID` 90 columns, crowd `COLS` 120, `SOLID_GRID` 196; the crowd `HALLS` include `l2Corridor`, `l2Hall`, `l2PreOp`, `l2Lounge`.
- **Scene glue:**
  - `FRAME_PRIORITY.levels` -9.5, `surgeryRig` -0.28, `surgeryScreens` -0.27;
  - `src/scene/levels/levelView.ts` (`levelView`, `shownAt(simX, simZ)`, `useOverviewLevel`);
  - layout `buildSurgerySuite` (stubs `rooms/surgery/shell.ts` B, `rooms/surgery/or.ts` O; `buildLayout({ level2: false })` leaves level 2 out);
  - panel routing `l2Or` → `OrBody`, `l2Pacu` → `PacuBody`, `l2PreOp` → `PreOpBody` (stubs);
  - `interact/surgery/surgeryRegs.ts` stub, concatenated in `registrations.ts`.

## Level-2 plan (drawn coordinates; sim x = +150)
```
x=-62        -53            -44  -40
z=-22 ┌──────────────────────┬────┐
      │ PRE-OP & ADMISSIONS   │LIFT│ 4 bays on the north windows (x -60.4,-57.6,-54.8,-52.0; z -20.4), desk (-45.6,-15)
z=-10 ├─────────┬─────────────┤ A  │
      │ STAFF   │ STERILE     │ T  │ theatre corridor x -44..-40 (east side glazed, faces outdoors)
z=-2  ├─────────┴─────────────┤ H  │
      │ THEATRE HALL [scrub sinks at (-49.4,1.6)]   │ opening 4 m at x -44
z=+2  ├─────────┬─────────────┤ A  │
      │ FAMILY & │ ROBOTIC OR ║ T  │ ║ viewing window z 2.8..5.8; viewing spot (-42.8, 4.3)
      │ DISCHARGE│ 9 x 8 m     │ R  │
z=+10 │ LOUNGE   ├─────────────┤ E  │
      │          │ PACU 3 bays │    │ bays x -51.3,-48.5,-45.7; z 20.5 (head south); island (-48.5, 15)
z=+22 └──────────┴─────────────┴LIFT┘
```
The OR (see `SURGERY`):
- the table at (-49.2, 5.9), head north, top 0.88 m;
- the cart parks at (-51.8, 8.7) and docks at (-51.05, 5.9), facing east;
- the vision cart at (-51.3, 3.6);
- anaesthesia at (-48.6, 3.1); the anaesthetist stands at (-49.2, 4.3), stool at (-48.5, 4.4);
- the surgeon console at (-45.55, 8.6) and the teaching console at (-45.55, 6.9), seats 0.9 m east of each;
- the back table at (-47.2, 7.3); the circulator desk at (-45.0, 2.35);
- the assistant at (-48.45, 6.1) and the scrub nurse at (-48.45, 7.1).

## What everyone must keep
- **Budget at the default view, shadow passes included:** ≤300 draw calls, ≤1.2 M triangles, ≤12 ms.
  - Overview Level 1: unchanged (~221).
  - Overview Level 2: ≤ ~250.
  - Walking on level 2: ~150–170.
- **No new shader programs after Enter:** 86–87, unchanged after a lift ride, a Jump and opening the console. Use existing materials (`MAT.tinted`, `MACHINE_BODY`, `MACHINE_GLOW`, the palette), the w4kit atlas program and the live-strip program. Mount level-2 content hidden so `gl.compile` warms it; add any new material sites to `warmup/manifest.ts`.
- **Frame loop:** no allocations in `useFrame`. Canvas screens repaint ≤2 Hz, or ≤10–12 Hz only for the focused live view.
- **Determinism:** seeded (`rng.fork`), no `Math.random` under `src/sim`. Slow state reaches zustand at ~4 Hz.
- **Content:** synthetic people and values only, with "Simulated" on panels. Copy lives in `src/content/*.json` with zod. **The endoscope view is stylised and never gory** (warm gradients, metal instrument tips, no blood, no incisions).
- **Machine rules:** vitest `--maxWorkers=1` in agents, only your own files. Never launch browsers or servers. npm: none needed.

## Wave 1: six owners, disjoint files, run in three pairs

### Pair 1
**S: surgery and lifts sim.** Owns `src/sim/surgery/**`, `src/sim/lifts/**`, and the lobby-gate calls in `src/sim/er/porter.ts` / `er/patient.ts` (`fadeAtLift`) and `src/sim/meals/*` (only the lift-lobby claim).

- **`LiftBank`:**
  - 2 cars per shaft (`CONFIG.lifts`).
  - Car cycle: idle → opening (3 s) → open (dwell) → closing (3 s) → moving (6 s per floor).
- **`LobbyGate` per lobby (shaft × level):**
  - At most one stretcher party and 4 walkers.
  - A party reserves its departure and arrival lobbies together, in a fixed order (A1 < A2 < B1 < B2), before boarding, so there are no deadlocks.
  - `claimFade` takes the stretcher slot for the ER "ward upstairs" fade and MealBot runs.
- **`LiftTrip`** (used by actors):
  1. Walk to the lobby's `stretcher` or `walkers` spot.
  2. Wait for a car and the arrival reservation.
  3. Board: walk to the car spot, `fadeOut(true)`.
  4. Ride.
  5. `place` at the same spot of the other level's lobby (rider follows pusher via `world.placeRiders`), `fadeIn`.
  6. Walk out.
- **`Surgery`:**
  - **`plan.ts`** (pure, seeded): a template from `CONFIG.surgery.templates`; each case's planned wheels-in (the first at `firstInHour`, the next after the previous room time plus turnover); arrival 60–90 min before. Phases are drawn and scaled so the room time and console time fall in their bands. Outcome (home or ward) is seeded by `homeShare`.
  - **Patient journey (`SurgicalPatient`, an `Actor` like `er/patient` or the imaging `Outpatient`):**
    1. Arrives at the entrance with a companion.
    2. Reception queue.
    3. Lift A up.
    4. Pre-op bay (`surgeryBed:preop:i`): curtain, outfit `gown`, then the nurse, anaesthetist and surgeon visits with `tablet`/`talk`.
    5. The theatre porter brings a stretcher.
    6. OR table (`orTable:0`) through the phases.
    7. Stretcher to PACU (`surgeryBed:pacu:i`).
    8. Then one of:
       - **home:** a lounge recliner (`l2Lounge` lounge seat), then lift A down with the companion, then the entrance;
       - **ward:** the porter takes the stretcher into lift B and they fade "to the surgical ward upstairs" (level 3: the fade story). The porter fades back in after 4–6 min.
  - **Theatre phases** set `state.theatre` (phase, `phaseSince`, `phaseEnds`, lights from induction to emergence, `surgeonAtConsole`).
  - **Robot FSM** (`state.robot`): `stowed` → `draping` (before wheels-in) → `draped` → `deploying` → `driving` (laser on; the cart moves from park to dock along a clear path) → `docking` → `targeting` (boom yaw, arms `engage` 0→1 onto `SURGERY.ports[layout]`) → `docked` (instrument exchanges at seeded times, `force` 0..1 seeded noise) → `undocking` → `returning` → `cleaning` (turnover) → redrape or stow. Write `motionSeed` per case.
  - **Team** (`THEATRE_STAFF`):
    - spawned at `THEATRE_BASE` at `teamFromHour` (by lift is not required: they start on level 2), leave at `teamToHour`;
    - spots per phase from `SURGERY.staff`;
    - outfit `'theatre'` for the OR team; the PACU and pre-op nurses wear `'role'`;
    - the cleaner does turnover.
  - **Other:** events with copy from `src/content/surgery.json` (copy agent: use placeholder strings until it lands); KPIs; `warmStart(hour)` places every case, the robot, the bays and the team from the plan; `startDay(t0)`.
- **Tests (node):**
  - determinism 07:30–20:00;
  - every case ends `done` (home or ward) for 50 seeds;
  - room and console times inside their bands;
  - robot phase order;
  - lift stress test: 60 random parties, no deadlock, every call served in under 3 min, never two stretchers in one lobby;
  - riders invisible (faded) while riding;
  - every level-2 seat approach reachable from the entrance by a `LiftTrip` plus a walk;
  - `warmStart` at every Jump moment;
  - nobody stands in a level-2 doorway for more than 2 s;
  - `population.integration` still green: re-baseline its people band (80 → ≤145 at 10:30) with a comment.

**B: level-2 building and light.** Owns `src/scene/building/**`, `src/scene/rooms/surgery/shell.ts`, `src/scene/lighting/**`, `src/scene/wayfinding/**`, a new roof-cap module (`src/scene/building/render/roofCap.ts` or similar), and `src/scene/player/boomProbe.ts` plus its test (wall boxes only).

- **Per-level compile:** `compile.ts` makes one merged mesh per material per level. Level-2 prims are recognised by `levelOf` and go under the level-2 group.
  - Provide `<Level2Building/>` (or extend `BuildingMeshes`) for the level-2 cut shell, and a level-2 walk building (upper walls, lintels, ceilings, signs, door leaves).
  - Door sensing stays in sim space; leaves are drawn in the group.
- **Walk chunks:** `walk/chunks.ts` `CHUNK_EDGES` must not throw level-2 prims into the atrium chunk.
- **`walls.ts`:**
  - `outline` against `BUILDING` or the level-2 strip;
  - `GLAZED_SHELL` for `l2PreOp`, `l2Lounge`, `l2Pacu`, `l2Staff`, `l2Corridor`;
  - `VIEW_WINDOWS` as breakpoints classed `glassFull`;
  - a `walkOnly` prim flag (mirror of `overviewOnly`).
- **`rooms/surgery/shell.ts`:**
  - pre-op bays with curtains and seats `surgeryBed:preop:i` (pose `lie`, height about 0.8), the desk, waiting chairs (`waiting`, area `l2PreOp`);
  - PACU bays with monitors, seats `surgeryBed:pacu:i`, the nurse island;
  - lounge recliners and sofas (`lounge`, area `l2Lounge`);
  - the staff room (`lounge`, area `l2Staff`);
  - sterile supply shelving;
  - the scrub sink in the hall (`SURGERY.scrubSink`);
  - lift lobby car fronts (as `serviceRooms.ts` `buildLifts` does, at x l2);
  - floor materials for the level-2 areas (`shell.ts floorMaterial`);
  - footprints 0.35 m clear of the nav routes.
- **Roof cap** (walking on level 2 only): one merged slab over `BUILDING` minus the footprint, plus a façade skirt (1.3–3.4 m), with a glass skylight over the atrium. 2 draw calls; it never casts.
- **Light volume:**
  - `VOLUME_GRID` ny 6 → 13 (0..7.8 m): layers 0–5 level 1 as today, 6 sky, 7–11 level 2 (baked from the level-2 areas, walls and panels shifted by -150), 12 sky.
  - `ceilingMap.ts` gets a second page; `FLOOR_MAIN` picks the ceiling plane and page by `vLvPos.y > 3.9` (a source change compiled behind the loading screen, no new program).
  - Level 2 and the cap never cast into the baked sun shadow.
- **Wayfinding:** floor labels and signs for level 2.
- **Fix:**
  - `walk.test` (door leaves, outline);
  - `walk.render.test` (swing doors: level 1 still 21, plus `l2Staff`);
  - `ceilingMap.test`;
  - `boomProbe.test`.
- **Budget tests:** level-1 static unchanged (`buildLayout({ level2: false })` ≤90 draw calls and ≤500k triangles); level 2 ≤25 draw calls and ≤150k triangles.

### Pair 2 (after pair 1 lands)
**L1: render boundary and people.** Owns `src/scene/levels/**` (except `levelView.ts`'s exported API), `src/scene/actors/crowd/**`, `src/scene/fx/**`, `src/scene/player/**` (except `boomProbe.ts`), `src/scene/World.tsx` level wrapping, and `src/scene/SimDriver.tsx` if needed.

- **Levels frame:** a callback at `FRAME_PRIORITY.levels` writes `levelView`:
  - walking: your level (`levelOf(sim.player.x)`), `overview` false;
  - overview: `useOverviewLevel`.
- **`<LevelGroup level>`** visibility, and the level-2 group at `[-150, 4.2, 0]`. Level-1 rigs (pharmacy core, robots, meals, drawers, imaging machines, W4 layers) hide while you walk on level 2.
- **Crowd (`actors/crowd/model.ts` `create`/`visit`):**
  - map every person by `toDisplayInto` (x + `levelDx`, y + `LEVEL_Y`); skip people for whom `shownAt` is false;
  - also map `lookAt` and the player drive's rest pose;
  - theatre outfit (scrubs and cap: `clothesOf`, `UNIFORM`, a `theatreCap` hair style);
  - the `console` pose (seated, forearms forward to the hand controllers, head forward into the viewer);
  - `orTable` / `surgeryBed` lying surfaces and blankets.
- **Emotes and bubbles:** `fx/emoteState.ts` maps, then hides other levels; `SpeechBubbles` tests sight in sim space (`walkCam.camera`), then maps `g.position`, hidden on other levels.
- **Player camera:** `player/system.ts` gets one `present()` after `chase.update` that adds `(levelDx, LEVEL_Y)` to `camera.position`. `walkCam.camera` stays in sim, so flights and `cameraState()` see drawn coordinates.
- **Fix:** `collision.test` ("to every door": per level, level 2 from its lift lobby); `solids.test` ("every doorway reachable from the spawn": per level).
- **Tests:** round trips of the mapping; a level-2 entity's instance at drawn coordinates; emotes and bubbles hidden on the other level; the chase camera at rest after a teleport between levels; `noAllocations`.

**O: OR, robot and console.** Owns `src/scene/rooms/surgery/or.ts`, `src/scene/surgery/**`, `src/scene/interact/surgery/**`, `src/ui/walk/ConsoleCard*`, `src/ui/{OrBody,PacuBody,PreOpBody}.tsx` plus their `*View.ts` and css, and `src/audio/devices/surgeryPatterns.ts`.

- **`or.ts`:**
  - the table (seat `orTable:0`), the two consoles (seats `console:or:surgeon`, `console:or:teach`), the vision cart, the anaesthesia machine and stool (`console:or:anaes`, pose sit), the back table and Mayo stand, the circulator desk;
  - booms, pendants and light heads (`walkOnly`);
  - footprints clear of the cart's drive path and 0.35 m of routes.
- **Robot rig (`scene/surgery/`):**
  - 3 instanced pools (rounded box and cylinder on `MAT.tinted`, glow on `MACHINE_GLOW`), about 55 instances;
  - `robotPose.ts` (pure): boom yaw and height; per arm a 2-link IK from the boom mount to the port, with the spar through the port; `tipMotion(arm, t, seed)`;
  - the laser crosshair while driving; drapes; LED rings; light faces glowing while `theatre.lights`;
  - matrices written at `FRAME_PRIORITY.surgeryRig`, only when level 2 is shown.
- **Screens** (at `FRAME_PRIORITY.surgeryScreens`):
  - a new 4×4 `surgeryKit` atlas (the w4kit program, ≤2 Hz): consoles, anaesthesia, the PACU and pre-op boards;
  - one shared 256×160 live texture (vision cart, wall monitor, console viewer): 2 Hz, or 10 Hz when you are in the OR or it is focused.
- **ConsoleCard (`ui/walk/ConsoleCard.tsx`, like `HealthCard`):**
  - E at the teaching console runs `sitAt` and `setTeaching(true)`, with anim `console`;
  - a DOM canvas at 384×240 and 12 Hz, only while open: a stylised endoscope view sharing `tipMotion`;
  - HUD: procedure, phase, console clock, per-arm instrument and force bar, 12 mmHg, "Teaching console · view only · Simulated";
  - a standby screen before docking; leave with E, Esc or a move key.
- **Panels:** `OrBody` (today's list, phase timeline, arms, team, KPIs, "Watch the endoscope view" opening the same card), `PacuBody`, `PreOpBody`.
- **Sound** (`surgeryPatterns.ts`): servos, the docking chime, the ventilator, soft monitor beeps.
- **Tests:**
  - IK reaches every port within 1 cm;
  - the cart's drive path clears every footprint;
  - the painter is deterministic and non-empty;
  - the atlas tiles;
  - `noAllocations`;
  - rig budget ≤3 draw calls.

### Pair 3
**L2: overview and navigation UI.** Owns `src/scene/camera/**`, `src/ui/LevelSwitch.tsx`, the minimap files (`ui/walk/minimap*`), `src/ui/goToModel.ts` and its test, `src/ui/LiftCover*` (or reuse the Jump cover), `src/scene/interact/lift.ts` and the lift registrations in `registrations.ts`, and `src/audio/ambience.ts` / `listener.ts`.

- **`LevelSwitch`:** a segmented control in the overview plus the `L` key, driving `useOverviewLevel`.
- **Camera:** `cameraApi` `presetFor` and `SHOTS` for level-2 areas (drawn coordinates; set the overview level); `roomFocus.focusRoom` switches the level.
- **Picking:** with Level 2 shown, hit y = 4.2 first inside the footprint and map to sim, else y = 0; the tint is lifted by `LEVEL_Y`.
- **Minimap:** a second plan for level 2 (sim x 86..112), chosen by your level.
- **Go-to:** a "Level 2 · Surgery" group (every `mapLabel` area exactly once; fix `goToModel.test`).
- **Lifts:**
  - E in all 4 lobbies: "Take the lift to Level 2 · Surgery" / "to Level 1";
  - the Jump-style cover: 400 ms out, about 700 ms with a ding and "Level 2 · Surgery", 500 ms in;
  - `placePlayer(LIFTS[shaft][to].walkers[0])`; `sim.lifts.playerRide`; your outfit `'theatre'` on level 2.
- **Audio:** `toneForArea` cases for level 2.

**Copy (haiku).** Owns `src/content/surgery.json` and `surgeryUi.json` with zod (`surgery.ts`, `surgeryUi.ts`) and tests:
- procedure names;
- phase labels;
- event lines (e.g. "{surgeon} docked the da Vinci for {patient}'s {procedure}.");
- instrument display names (generic: "Fenestrated bipolar forceps", "Monopolar curved scissors", "Large needle driver", "Endoscope 30°");
- panel and console copy, prompts, toasts;
- "Simulated" labels.

No real patients and no brand claims beyond "da Vinci 5 (simulated)".

## Final report (every agent)
- **Done:** the files you created or changed.
- **How to verify:** the commands.
- **Change requests:** edits needed in contract files.
- **Open questions / risks.**
