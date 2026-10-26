# R4: the CT-guided, robot-assisted cryoablation suite on level 2

Owner decision (2026-10-26):
- **What:** the big, accurate freezing machine that does not depend on the doctor's hand. It is a CT scanner, a floor-docked
  needle-guidance robot (MAXIO/Epione class) and a multi-needle argon cryo console (Visual-ICE class).
- **Where:** level 2, in the south half of the old family lounge.
- **Background:** docs/research/cryoablation.md, section 5.

## 0. Integration: a small new module, `src/sim/cryoSuite`

Rejected:
- **(a) A 5th imaging modality.** Imaging staff and outpatients never use the lifts, so they cannot reach level 2. Adding it would also
  ripple through about 30 `Record<ImagingModality>` users.
- **(b) A case type in surgery.** The surgery module is built around one operating room (`case.ts` is 1417 lines).

Chosen: **(c) a new module**, reusing these pieces:
- **Actors:** `SurgicalPatient` (`loadOn`, `unloadTo`, `mounted`, `settled`) and `Staffer` from `src/sim/surgery/actors.ts`. The only
  change there is widening its `Title` union by 4 names.
- **Lift arrivals:** `world.lifts.claimFade('B', 2, id)` / `releaseFade`. The patient is an **inpatient from the surgical ward
  upstairs**, the same "level 3" fade story that surgery uses. A kidney cryoablation patient usually stays one night.
- **Recovery:** the PACU bays come from `world.surgery.sites` (`pacu[i]`, `claim`, `release`, `occupant`, `bedFoot`), plus
  `Surgery.bayChanged(...)`.
  - The new `guestBay` helper (below) shows the bay as taken on the boards.
  - Cryo prefers the highest free bay (index 2). Surgery takes the lowest.
- **CT table:** `Actor.rideTable(TableRef)` (er/actor.ts), with the suite state as `{ tablePos }`, as the imaging `Scanner` does.
- **Scene:** the world-space builders in `src/scene/imaging/machines/ct.ts`, reused with `rotateY(pi)` and a translate to
  `CRYO_SUITE.ct.machine`. No edit to `ct.ts`.
- **Base CT slice:** `images/torso.ts abdomenAxial()` and `paint.ts drawShapes()`.

**Living day:**
- Two seeded cases: wheels-in at about 10:06 and about 14:18 (`CONFIG.cryoSuite.listHours` 10.22 and 14.58, ±2 min).
- At the 10:30 Jump the robot is aiming or placing needles. At 15:00 the first freeze is running.
- The visitor's "Start a cryoablation now" demo jumps to the front of the list.
- **Kidney**, left side: the robot is docked by the patient's left flank.
- The model is brand-free. Real products are named only on the panel's "Meet the devices" card.
- The copy says "lying on the CT table" and never claims prone or supine.

## 1. Contracts (DONE by the orchestrator: re-read them before use)

- **`src/sim/places.ts`:**
  - `l2Lounge` is now drawn x -62..-53, z 2..10.
  - New areas:
    - `l2CryoControl`: z 10..13, kind `staff`. The observation glass is at z 13.
    - `l2Cryo`: z 13..22, kind `clinical`.
  - New doors:
    - `l2CryoControl` at (l2(-53), 11.0), width 1.0, from `l2Pacu`;
    - `l2Cryo` at (l2(-53), 16.8), width 1.8, from `l2Pacu`;
    - `l2CryoInner` at (l2(-54.2), 13), width 1.2, between the control room and the scan room.
  - The anchors are `CRYO_SUITE` (after `THEATRE_BASE`): CT machine and table, target, robot base and mount, console and its screen,
    cylinders, the 4 live screens, 2 control seats, staff spots, and the viewing spot.
- **`src/sim/types.ts`:**
  - New event types: `cryoArrived`, `cryoPlanned`, `cryoNeedle`, `cryoFreeze`, `cryoDone`.
  - `SurgeryBayState.guestName?`.
  - The R4 block: `CryoStep`, `CRYO_STEPS`, `CryoRobotPhase`, `CryoNeedleState`, `CryoCaseView`, `CryoSuiteState`.
- **`src/sim/config.ts`:** `cryoSuite` (team hours, list hours, needles, tumour mm, step minutes, turnover, PACU, aim error, temperatures,
  ice mm, `firstFreezeSize`, `thawKeep`, `demoArrivalSeconds`, `demoScale`).
- **`src/content/staff.ts`:** the `cryoSuite` post and `CRYO_STAFF`:

  | Id | Name | Role |
  |---|---|---|
  | `cryo-ir` | Dr. Mireille | ir |
  | `cryo-rad` | Radiographer Pavel | ctRadiographer |
  | `cryo-nurse` | Nurse Adaeze | sedation |
  | `cryo-porter` | Porter Lorcan | wardPorter |

- **`src/sim/cryoSuite/ports.ts`** (frozen): `CryoSuitePort { state, cases, startDemo(): 'started' | 'queued' | 'noTeam' | 'busy' }`.
- **Skeletons:** `src/sim/cryoSuite/index.ts` (`CryoSuite`, `emptyCryoState`). It is wired in `Simulation.ts` (constructed after
  surgery, with `startDay`, `warmStart`, `step` and `sync` after surgery's) and in `world.cryoSuite`.
- **`tools/arch/zones.json`:** the theatres zone gets `l2CryoControl` and `l2Cryo`.
- **`frameOrder.ts`:** `cryoRig` -0.268, `cryoScreens` -0.265.
- **Mounts:** `World.tsx` mounts `<CryoSuiteLayer/>` (skeleton `src/scene/cryoSuite/CryoSuiteLayer.tsx`). `registrations.ts` spreads
  `cryoSuiteRegs(host)` (skeleton `src/scene/interact/cryoSuite/cryoRegs.ts`).

Layout (drawn x, z; sim x = drawn + 150):
```
x=-62                -53         -44
z=2  ┌────────────────┬───────────┐
     │ FAMILY LOUNGE  │ ROBOTIC OR│
z=10 ├────────────────┼───────────┤
     │ CRYO CONTROL  ◄┤ door 11.0 │ PACU
z=13 ├══glass══[in]═══┤ (x -54.2) │
     │ CT CRYOABLATION│           │
     │ gantry(-60,17.4)◄ door 16.8│
z=22 └────────────────┴───────────┘
```
The CT bore runs along x. The gantry is at the west end and the table on its east side. The patient lies head west (heading +pi/2), with
the left flank to the north, where the robot is docked.

## 2. Interfaces between the agents

**Sim → scene and UI:**
- `sim.cryoSuite.state: CryoSuiteState` and `startDemo()`.
- The patient lies on seat `scanTable:cryo` and rides the table via `rideTable`. The crowd draws them at `lerp(out, in, tablePos)`.
- **Staff look:** outfit `'theatre'` (the radiographer uses `'role'`).
- **Staff animations:**

  | Animation | When |
  |---|---|
  | `tablet` | planning |
  | `give` / `talk` | sedation |
  | `clean` | turnover |
  | `push` | with the stretcher |

- **PACU guest:** `world.surgery.guestBay(seatId, patientId, name, t)` sets `guestName` and calls `bayChanged`.
- **State rules:**
  - The robot never shows `aiming` or `aligned` while `tablePos > 0`.
  - A needle's `inserted` stays 1 from its aim step until `needlesOut`.
  - `ice` never decreases during a freeze. It is multiplied by `thawKeep` in the thaw and goes slightly lower in `activeThaw`.
  - `iceMm` and `marginC` are display values.

**Scene ↔ Blender:**
- Blender reads the footprint ids and rects below, plus the `CRYO_SUITE` anchors (robot mount, screen faces, console screen).
- The live screen faces sit 3 mm proud of the baked bezel.
- Colours: white `#eef1f3`, graphite `#2b2f33`, teal glow (`kit/parts` WHITE, GRAPHITE).

**Content → UI:** `src/content/cryoSuite.ts` exports `CRYO_SUITE_COPY` and `fillCryo(template, vars)`:
- `steps: Record<CryoStep, string>`;
- `events`: `arrived`, `planned`, `needle`, `freeze`, `done`, with the `{patient}`, `{n}`, `{k}`, `{err}`, `{ir}` slots;
- `card`: `title`, `robot`, `console`, `honesty`;
- `panel`: `tag` ('Simulated'), `title`, `start`, `startNext`, `queued`, `noTeam`, `planning`, `live`, `needle`, `aligned`, `tip`,
  `margin`, `ice`, `timer`, `list`, `empty`;
- `prompts`: `glass`.

The scene agent may stub copy until the sim agent lands it.

**Footprint ids** (the scene agent creates them in `cryoRoom.ts`; drawn x, z):

| Id | x | z | Bake |
|---|---|---|---|
| `l2:cryo:ct:gantry` | -60.45..-59.55 | 16.45..18.35 | kept live, rect only |
| `l2:cryo:ct:table` | -58.8..-55.9 | 17.15..17.65 | kept live: pedestal plus cradle at `out`, rect only |
| `l2:cryo:robot` | -58.25..-56.95 | 15.85..16.65 | prims; baked |
| `l2:cryo:console` | -59.35..-58.65 | 14.1..15.1 | baked |
| `l2:cryo:cylinders` | -61.0..-60.2 | 14.1..14.7 | baked |
| `l2:cryo:cabinet` | -61.0..-58.6 | 21.4..21.95 | baked |
| `l2:cryo:boom` | (-57.4, 19.3) | | overhead marker |
| `l2:cryoctl:desk` | -61.4..-58.6 | 12.2..12.8 | baked |
| `l2:cryoctl:station` | -58.0..-56.6 | 12.2..12.8 | baked |

**Seats:**

| Seat | Area | Pose | Height | Notes |
|---|---|---|---|---|
| `scanTable:cryo` | `l2Cryo` | lie | 0.8 | heading pi/2; approach at the table foot (about -55.5, 17.4) |
| `console:cryo:ct` | | sit | 0.5 | |
| `console:cryo:robot` | | sit | 0.5 | |

## 3. Agent A: sim, content and tests

**Owns:**
- `src/sim/cryoSuite/**`, except `ports.ts`: `index.ts`, `plan.ts`, `case.ts`, `team.ts`, `sites.ts`, `derive.ts`, `testkit.ts`, tests.
- Small edits in surgery:
  - `src/sim/surgery/actors.ts`: `Title |= 'ir' | 'ctRadiographer' | 'sedation' | 'wardPorter'`.
  - `src/sim/surgery/index.ts`: `settle()` also resets `b.guestName = null`. Add
    `guestBay(seatId, patientId | null, name | null, t)`, which sets `guestName` and calls `bayChanged`.
  - `src/sim/surgery/sites.ts`: move `loungeStand` into the new lounge, e.g. `[-58.2,5.0] [-57.0,5.0] [-58.2,6.4] [-58.2,7.8]
    [-56.8,8.4] [-57.0,4.2]` (drawn x). Three of today's spots are now inside the suite.
- `src/sim/nav/graph.ts`:
  - door nodes for `l2CryoControl` and `l2Cryo` at x l2(-53), with PACU-side nodes at l2(-51.6) linked into the PACU group and inside
    nodes at l2(-54.6);
  - the inner door `l2CryoInner` at (l2(-54.2), 13), with nodes at z 11.9 and 14.2;
  - `lattice('l2Cryo','l2Cryo',3)`, `lattice('l2CryoControl','l2CryoControl',2)`, plus `linkGroup` for both.
  - **Note:** another agent is changing `src/sim/nav/crowd.ts`, `follower.ts` and the crowd renderer for walking quality. Make
    additive edits only in `graph.ts`. Do not touch `crowd.ts` or `follower.ts`.
- Content:
  - `src/content/cryoSuite.json` and `cryoSuite.ts` (zod) plus a test.
  - `src/content/signs.json`:
    - `destinations.l2Cryo`: {"CT cryoablation", "Robot-guided, CT-guided", accent "diagnostics"};
    - `destinations.l2CryoControl`;
    - `plates.doors` for `l2Cryo`, `l2CryoControl`, `l2CryoInner`.
- Tests: `src/sim/soak.test.ts` (the cryo stuck counters) and `src/sim/population.integration.test.ts` (re-check the ≤130 band at
  10:30: 4 more staff and 2 more people).

**Behaviour:**
- **`plan.ts`** (pure, seeded `rng.fork('plan')`):
  - cases from `listHours`, with jitter;
  - per case: needle count, tumour mm, step lengths, needle paths, error mm, PACU minutes, `motionSeed`, `imageSeed`;
  - the needle paths (entry, tip, dz) fan out so the ice union covers the tumour plus at least 5 mm;
  - the demo plan scales every step by `demoScale`.
- **`case.ts`**, a finite-state machine:
  1. The ward porter fades in at `LIFTS.B[2].stretcher` (`claimFade`, retried every step) with the patient mounted
     (`SurgicalPatient.loadOn`).
  2. The porter pushes to `staff.stretcherPark`. The patient goes `unloadTo(scanTable)` and `rideTable`. The porter fades out at lift B.
  3. Each step, with the staff tasks:

     | Step | What happens |
     |---|---|
     | sedation | the nurse at `sedation`; the IR talks at `insert` |
     | planningCt / checkCt / finalCt | the IR and radiographer at the control seats; `tablePos` → 1, rotor on, `scan` 0→1, then the table out |
     | planning | the IR at the robot station; robot `deploying` |
     | aim, once per needle | robot `aiming` (about 20 s), then `aligned` (`errorMm`); the IR at `insert` pushes `inserted` 0→1; robot `retracting` |
     | freeze1 / thaw / freeze2 / activeThaw | the IR at `atConsole`; `argon` or `heater` flags; `tempC` and `ice` curves |
     | needlesOut | `inserted` back to 0, one needle at a time |
     | dressing | the nurse pops a stretcher (`setVehicle('stretcher')`, the surgery precedent) and the patient is loaded |
     | out | to a guest PACU bay (bay 2 first, else any free; wait on the table if none); `guestBay(...)` |
     | turnover | the radiographer's `clean` round; robot `stowed` |

  4. After `pacuMinutes` the ward porter fades in at lift B, fetches the patient from the bay and fades out at lift B ("to the
     surgical ward upstairs"). Then `guestBay(seat, null, null, t)`.
- **`team.ts`:** the IR, radiographer and nurse spawn on level 2 at `staff.base` at `teamFromHour` and leave at `teamToHour`. The porter
  exists only during transfers.
- **Warm start:** `warmStart(hour)` places each case from the plan silently (the pure `stateAt(plan, t)` gives the room state).
- **`startDemo`** follows the port contract. The demo goes to the front of the list.
- **Events:** said through `world.say`, with copy from `CRYO_SUITE_COPY`.

**Tests** (node, `--maxWorkers=2`, through the lock script):
- determinism from 07:30 to 20:00 for 3 seeds;
- every case reaches `done` for 50 seeds, with zero stuck fixes;
- the step order;
- the robot is never aligned while `tablePos > 0`;
- `inserted > 0` only after that needle was aligned;
- the ice never decreases within a freeze;
- warm start at every `CONFIG.day.moments`;
- `startDemo` returns `started`, `queued`, `noTeam` and `busy` in the right cases;
- no PACU bay is ever held by two patients (surgery plus cryo, full Simulation from 07:00 to 20:00);
- the surgery tests still pass;
- nobody stands in a level-2 doorway for more than 2 s;
- every `CRYO_SUITE` spot and seat approach is reachable from `LIFTS.B[2]`;
- every `loungeStand` spot is inside `l2Lounge`.

## 4. Agent B: runtime scene, UI and layout

**Layout:**
- **New `src/scene/rooms/surgery/cryoRoom.ts`.** It holds the procedural fallback prims (robot base, console, cylinders, cabinet,
  desks, chairs, the boom marker) and all the footprints and seats above. It reuses existing material keys only, and
  `rooms/surgery/index.ts` calls it.
- **`src/scene/rooms/surgery/shell.ts`** (+ `shell.test.ts`). Re-lay the lounge inside z 2..10 and keep the ids, so that
  `footprint:l2:lounge:*` still matches:

  | Item | Position (drawn x, z) | Notes |
  |---|---|---|
  | recliners 0..2 | x -60.9, z 4.0 / 6.2 / 8.4 | heading -pi/2; side tables at z 5.1 and 7.3 |
  | recliner3 | (-58.4, 9.3) | heading pi |
  | sofa0 | (-53.7, 6.6) | heading -pi/2; table0 at (-55.5, 6.6) |
  | sofa1 | (-54.6, 2.55) | heading 0; table1 at (-54.6, 3.9) |
  | tea point | (-55.4, 9.55) | w 3.26 |
  | cooler | (-53.5, 8.6) | |
  | plantN, plantS | (-61.2, 2.7), (-61.2, 9.4) | |
  | rug | (-56.2, 6.6) | 3.0 x 3.6 |

  Also shorten the PACU supply cabinet to z 12.2..15.6, so that both new doors clear it.
- **`src/scene/building/layout/walls.ts`:** add `['l2CryoControl','l2Cryo']` to `OBSERVATION_PAIRS`.
- **`layout/shell.ts` `floorMaterial`:** `l2Cryo` gets `floorBlue`, `l2CryoControl` gets `floorMint`.
- **Fix `layout.test.ts`.** The level-2 budget is at most 25 draws and 150k triangles.

**Wayfinding and camera:**
- `wayfinding/labels.ts`: `{ id:'l2Cryo', text:'CT CRYOABLATION', x:-56.0, z:21.0, height:0.34, maxWidth:4.4 }`.
- `signsL2.ts`: `'l2Cryo'` in the `l2-corridor-south` points.
- **`src/scene/actors/crowd/head.ts`:** `['scanTable:cryo', CRYO_SUITE.ct.table.height]` in `IMAGING_SEAT_SURFACE`. Make this one
  additive edit only, because another agent is working in the crowd renderer.
- `src/scene/camera/cameraApi.ts` SHOTS: `l2Cryo`, with target (-57.5, UP+0.9, 17.4), pitch 48, yaw 90, box x -62..-53, z 13..22.
  Update `levelShots.test.ts`.
- `walk.test.ts` and `walk.level2.test.ts`: the level-2 auto-door lists gain `l2Cryo`, `l2CryoControl` and `l2CryoInner`. The player
  collision and solids "every door reachable" tests must pass.
- Fall back to `?? bay.guestName ?? ''` in `src/scene/monitors/occupancy.ts`, `src/scene/surgery/tiles.ts` (`bayPatient`),
  `src/ui/orView.ts`, `pacuView.ts` and `preOpView.ts`.

**Live layer (`src/scene/cryoSuite/**`):**
- **`CryoSuiteLayer.tsx`:** inside `<LevelGroup level={2}>`; mounted hidden so warm-up compiles it.
- **`rig.ts`:**
  - the CT static, rotor, cradle and glow, from the `ct.ts` builders, `rotateY(pi)` and translated to `CRYO_SUITE.ct.machine`;
  - a pool of instances for the arm;
  - a pool of instances for the joints and needles.
- **`pose.ts`** (pure):
  - the table x from `tablePos`;
  - the needle segments, relative to the patient;
  - 5-DOF IK from `robot.mount` to the guide pose, with the guide axis on the path at a 5 cm standoff;
  - the stow and standby poses.
- **`ctPaint.ts`** (pure, Ctx2D):

  | Function | What it draws |
  |---|---|
  | `paintPlanning` | the base slice, the tumour, and dashed numbered paths; the current one amber |
  | `paintLive` | bright needles with streak artefacts, the dark-grey ice union growing with `ice`, the scan sweep during scans |
  | `paintConsole` | °C per needle, argon/heater, the freeze timer, the margin sensor |
  | `paintRobotStation` | the path list and "aligned 1.2 mm" |

  - Every view carries "Simulated".
  - The base slice is `abdomenAxial(imageSeed, kidneyZ)` → `drawShapes`, cached once per `imageSeed`.
- **`screens.ts`:** one 1024×256 atlas canvas (4 tiles) and one merged geometry of 5 quads.
- **`src/audio/devices/cryoSuitePatterns.ts`:** argon hiss, servo chirps and a freeze-start beep, reusing the CT whir. Register it via
  the device registry, or ask the orchestrator first if that is a contract file.
- **`src/scene/warmup/manifest.ts`:** add the new material sites.

**Interaction:** `src/scene/interact/cryoSuite/cryoRegs.ts`, with stations `cryo:glass` at `CRYO_SUITE.viewing` and `cryo:door` near
the PACU door. Both call `openPanel('l2Cryo')`.

**UI:**
- **New files:** `src/ui/CryoSuiteBody.tsx`, `src/ui/cryoSuiteView.ts` (with a test and a render test) and `src/ui/cryoSuite.css`,
  modelled on `ScanViewer`. The body has:
  - a 384 px live canvas with a Planning/Live toggle;
  - a stepper, a needles table, the console readouts, and today's list;
  - a "Start a cryoablation now" button bound to `startDemo()`, with the queued and noTeam states;
  - a "Meet the devices" card: "a needle-guidance robot like Perfint MAXIO / Quantum Surgical Epione" and "an argon cryoablation
    system like Boston Scientific Visual-ICE", with the honest evidence line;
  - "Simulated" throughout.
- `src/ui/RoomPanel.tsx`: `l2Cryo` and `l2CryoControl` open `<CryoSuiteBody/>`.
- `src/ui/walk/minimapModel.ts`: `{ area:'l2Cryo', text:'Cryo CT' }`.
- `src/ui/goToModel.test.ts`: the expected list becomes `[...,'l2Lounge','l2Cryo']`.
- `src/audio/ambience.ts`: `l2Cryo` is `'machine'` and `l2CryoControl` is `'hum'`. Add both to `ambience.test`.

**Tests:**
- the IK reaches every planned path within 1 mm and 0.5°;
- the arm never enters the table or patient box at sampled phases;
- the painters are deterministic and never empty (`images/mockCanvas.ts`);
- the atlas UVs are right;
- the rig uses at most 7 draw calls;
- no allocations in the frame update;
- repaints are gated.

## 5. Agent C: Blender

**Owns:**
- `tools/arch/zones/theatres.py`;
- a new `tools/arch/kit/ctcryo.py`. (`kit/cryo.py` is the ProSense console; do not reuse that name.)
- `tools/arch/furniture-coverage.test.ts`;
- `assets-src/arch/out/zones/theatres/**`;
- `public/assets/building/zones/theatres/**` and its manifest entry, via `optimize.mjs`;
- `docs/screenshots/zone-theatres-*`.

**Kit (`ctcryo.py`):**

| Piece | Size (m) | Details |
|---|---|---|
| `robot_base(geo, f)` | 1.3 × 0.8 × 0.85 | a cart with a white solid-surface shell, graphite bumper, locking castors and a stainless floor-docking plate; a column stub up to `mount` y 1.05; E-stop, LightPanel status band, handle; **the arm is live, not baked** |
| `argon_console(geo, f)` | 0.7 × 1.0 × 1.35 | a 2×10 needle-socket panel and 4 sensor ports; a screen bezel on an arm, with a dark `Screen` face at `console.screen`; castors |
| `cylinder_cart(geo, f, n=4)` | | 3 argon cylinders and 1 helium, with chains, regulators and hoses to the console |
| `monitor_boom(geo, f)` | | ceiling mount, arm, and a dual bezel at `screens.roomPlan` / `roomLive` |
| `ct_desk`, `station_desk` | | bezels at the control-room screen anchors |

**`theatres.py`:**
- **Rooms:** `LOUNGE = (-62,-53,2,10)`, `CRYO = (-62,-53,13,22)`, `CRYOCTL = (-62,-53,10,13)`.
- **Zone settings:**
  - HERO is `[OR, LOUNGE, CRYO]`;
  - FLOORS gets `'l2Cryo':'TheatreFloor'`;
  - `OWN_CEILINGS` gets `'l2Cryo'`;
  - `DOOR_ACCENT['l2Cryo']='Accent:4'`.
- **Probe and poses:**
  - `PROBE = (-57.5, 1.6, 6.0)`. The old probe at z 12 would now sit in the control room.
  - POSES gains `((-53.8, 15.2), (-59.5, 18.0))` and `((-53.6, 11.2), (-58.5, 13.5))`.
- **Lounge and PACU:**
  - `lounge()` is re-laid from the new footprints, with the slat wall behind sofa0 and the downlights inside z 2..10.
  - `pacu()` puts the casework on the shortened cabinet footprint.
- **New `cryo_room(ctx)`:**
  - lead-lined door frames;
  - an "X-RAY in use" lamp over the scan-room door;
  - a lead-glass observation frame;
  - a plaster ceiling with panel lights;
  - the robot base, console, cylinders, boom and cabinet.
- **New `cryo_control(ctx)`:** desks and chairs.
- **REPLACES** gains `'footprint:l2:cryo:robot'`, `':console'`, `':cylinders'`, `':cabinet'`, `':boom'` and
  `'footprint:l2:cryoctl:*'`.
- **The CT gantry is not baked.** It stays live from `ct.ts`.

**`furniture-coverage.test.ts`:** set `KEPT_FOOTPRINTS['l2:cryo:ct']` to "the cryo suite CT: gantry, rotor and moving table are live
(src/scene/cryoSuite)".

**Bake (theatres zone only):**
- **When:** after B's layout (`cryoRoom.ts`, `shell.ts`) is in the tree. The contracts have already landed.
- **How:** through `/private/tmp/claude-501/hospital-blender.sh`, in this order:
  1. `npm run arch:plan`
  2. `npm run arch:bake -- --zone theatres --draft --stills docs/screenshots`
  3. Review the stills.
  4. The final bake (the same command without `--draft`).
  5. `npm run arch:build -- --zone theatres`
- C writes the kit and room code in parallel; only the bake waits.

## 6. Budget

**Live draw calls: 7.**

| Mesh | Material |
|---|---|
| CT static (gantry and pedestal) | `MACHINE_BODY` |
| CT rotor | `MACHINE_BODY` |
| CT cradle | `MACHINE_BODY` |
| CT glow (lasers and status) | `MACHINE_GLOW` |
| arm links: an instanced pool of about 6 rounded boxes | `MAT.tinted` |
| joints, needle guide and up to 6 needles: one instanced cylinder pool (16 or fewer) | `MAT.tinted` |
| screens: one merged 5-quad mesh on a 1024×256 `CanvasTexture` | the existing basic program |

- No new shader programs.
- No shadows cast from level 2.

**Baked (the theatres zone today):** 34/40 draws, 183k/200k triangles, 13.8/16 MB.
- **No new materials.** Reuse Stainless, SolidSurface, KitPlastic, Screen, LightPanel, Accent and TheatreFloor.
- **About 15k new triangles or fewer:**

  | Piece | Triangles |
  |---|---|
  | robot | ≤ 4k |
  | console | ≤ 4k |
  | cylinders | ≤ 2k |
  | boom | ≤ 2k |
  | desks | ≤ 3k |

**Screens:**
- Repaint only when one of these changes: `state.version`, the step, the ice (in 1 % steps) or the timer second.
- Repaint at most 2 Hz, or 4 Hz while the focus area is `l2Cryo` or `l2CryoControl`. Upload only on a repaint.
- Do nothing while level 2 is not shown.
- No allocations in `useFrame`.

## 7. Integration rule

Do not ship B's layout without C's re-bake. The old baked lounge furniture would be drawn inside the new rooms.
