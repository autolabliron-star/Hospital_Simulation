# The Ideal Hospital as a cancer centre: delivery plan for proton therapy, histotripsy and an MR-Linac

Planning date: 2026-11-01. The research behind it is dated 2026-10-31. This is a plan only: no code was changed and nothing was committed. Synthetic patients only: the simulation plays scripted cases, makes no clinical decisions, and nothing here is medical advice.

## How to read this document

**Sources.** Section numbers in square brackets point into the research documents:
- **[P n]**: `docs/research/proton-therapy.md`;
- **[H n]**: `docs/research/histotripsy.md`;
- **[ND n]**: `docs/research/new-devices.md`;
- **[PR n]**: `docs/research/procedures.md`.

Repository facts name their file. The clinical and regulatory facts are the reports' facts, with the reports' own confidence tags; they are not repeated here.

**Tags used in this plan:**
- **proposal:** a name, rectangle or spot that the orchestrator confirms or changes in the contract files;
- **estimate:** my sizing of work or cost. Sizes are as in [ND 5]: S = a day or two of agent work, M = about a week, L = two weeks or more;
- **target:** a size chosen for our own generic model, not a vendor specification (as in the reports).

---

## 0. Summary

**The goal.** The owner asked on 2026-10-31 for The Ideal Hospital to specialise in cancer. The first steps are two of the world's most advanced cancer machines: a compact proton therapy gantry and HistoSonics Edison-class histotripsy. An MR-Linac follows as a third machine. A few ordinary rooms make the building read as a cancer centre (section 9).

**The owner's decisions (2026-11-01), in full in section 1:**

| Question | Answer |
|---|---|
| Where does proton therapy go? | **A proton wing on the annex**: x 50..70, z -26..-2, with a raised roof over the gantry |
| Which machine first? | **Histotripsy first**, then proton therapy |
| Add an MR-Linac? | **Yes, after the two machines.** With the wing it goes in `atFlex` |

**Three findings that change the plan of 2026-10-22:**
1. **The annex is approved but not built.** `src/sim/places.ts` has no `at*` area, and `tools/arch/zones.json` has only the 8 existing zones. Every cancer machine needs the annex shell first, so the shell is the critical path (wave C1).
2. **The wing's east wall stands exactly on the level-2 line.** `levels.ts` treats any sim x of 70 or more as level 2 (`LEVEL2_SPLIT_X = 70`), and the annex and the wing both end at x 70. The split should move to about 79, halfway between the annex and the level-2 strip at x 88 (section 3). A separate pavilion east of the annex would not have been possible without moving the whole level-2 strip.
3. **The wing replaces the planned radiotherapy vault (`atRt`) and plant room (`atPlant`).** The MR-Linac therefore takes `atFlex`. RefleXion X1 (planned for `atRt`) and Akalux photoimmunotherapy (planned for `atFlex`) become device cards for now (section 2.7).

**Waves at a glance** (section 8 has owners, files and gates):

| Wave | Delivers | Size | Starts after |
|---|---|---|---|
| C0 | Contracts: annex and wing areas, spots, unions, config, frame priorities, the level-split move | S | R5 Wave 2's contract changes have landed |
| C1 | The annex shell (hall, histotripsy room, prep and recovery, MR suite shell, reserved `atFlex`), a hoarding where the wing will be, cancer-centre signage and naming | L | C0 |
| C2 | **Histotripsy**: device, rig, two watchable scripts (liver; kidney labelled investigational), screens, living day | L | C1, and R5 Wave 3 (the procedure engine has its cryo and ProSense adapters) |
| C3 | **Proton therapy**: the wing, gantry, couch, control room, two watchable scripts (adult head and neck; a child under anaesthetic), living day | L (two halves) | C2's engine pieces |
| C4 | Chemotherapy day unit (in the ward A family lounge), with a MedPod bringing each patient's sealed demo infusion bag | M | C1; runs beside C3 |
| C5 | **MR-Linac**: a research report first, then the vault in `atFlex`, the device and one adaptive script | L | C3 |
| C6 | Tumour board room and oncology clinic (in the ward B quiet room) | S-M | C4 |
| C7 | Integration: the full day, tour stops, Quest numbers, owner review | M | C5, C6 |

**Not in this plan:**
- carbon ions, FLASH and proton arc therapy, which stay investigational or out of scope [P 1];
- immune ("abscopal") effects of histotripsy, which are never shown as an outcome [H 1];
- Visualase and Exablate: they stay in the MR suite as planned on 2026-10-22, and their wave is unchanged.

---

## 1. The owner's decisions (2026-11-01)

| # | Question asked | Answer | What it means for the build |
|---|---|---|---|
| 1 | Proton wing, a separate pavilion, or an upright fixed beam in `atRt`? | **Proton wing** (the recommended option) | A 20 x 24 m block at x 50..70, z -26..-2, laid out in section 2.3. It contains a 14 x 14 m shielded vault split into a treatment room and a sealed gantry hall with a raised roof (about 9.5 m). It also has a sealed cyclotron room, a control room, two children's anaesthetic bays, a waiting and play room, and a maze. It replaces `atRt`, `atRtControl` and `atPlant` from [ND 6]. A rotating gantry is the most watchable part, so it stays. |
| 2 | Which machine first? | **Histotripsy first** (recommended) | Histotripsy fits the planned `atHisto` (10 x 10 m) at the normal 3.0 m storey. It needs no shielding, and it reuses the theatre props, the ultrasound painters and the WHO checklist steps of R5 [H 7.6]. It is the first cancer treatment visitors can watch in the annex. Protons follow in C3. |
| 3 | Add an MR-Linac? | **Yes, after the two machines** (recommended) | Wave C5. It gets its own research report first, in the same template as the two reports. The vault goes in `atFlex` (x 60..70, z 2..12): a 10 x 7.5 m vault behind a 10 x 2.5 m control room. Most cancer patients who have radiotherapy are treated with X-rays, so a modern X-ray machine is needed for the hospital to read as a real cancer centre [P 0]. |

**What these answers change in `new-devices.md` (its owner decisions of 2026-10-22 stand otherwise):**
- `atRt`, `atRtControl` and `atPlant` are not built. Their footprint becomes the proton wing.
- `atFlex` becomes the MR-Linac vault (`atLinac`) and its control room (`atLinacControl`).
- RefleXion X1 (rank 8, [ND 7.8]) and Akalux PIT (rank 7, [ND 7.7]) lose their rooms. They stay as device cards, and either can return later as a skin of the MR-Linac vault or as a procedure room (an open question at the end).
- The histotripsy corrections in [H 3.5] replace [ND] row 3 and section 7.3 (the 128-channel head, the 11 May 2026 kidney filing, 63.4 % against 90 % local control, and a coupling membrane rather than a tub).

---

## 2. Where each machine goes

### 2.1 The starting point

- **The building** is `x -62..40, z -22..22` (`BUILDING`). Level 2 stands over the west block and lives in a sim strip at x 88..110 (`levels.ts`).
- **The plinth** ends at x 48 (`exterior.ts` `PLINTH`), so the annex needs the plinth extended to about x 78.
- **The annex** was approved on 2026-10-22: x 40..70, z -12..12, joined to the atrium's east wall by a 4 m opening at (40, 0) [ND 6]. None of it exists yet.
- **The storey height** is 3.0 m (`WALL.height`), and the overview cuts walls at 1.3 m (`WALL.cutHeight`).
- **The sim has two levels**, so nothing can sit in a pit or a basement [ND 1].

### 2.2 The annex after this plan (proposal)

```
 z=-26          ┌──────────┬───────────────────────────┐
                │ atProton │ atProtonGantry (sealed)   │  gantry hall, raised roof about 9.5 m
                │ Cyclo    │ 14 x 7                    │
 z=-19          │ (sealed) ├───────────────────────────┤  ← face wall: gantry face plate and nozzle
                │ 6 x 14   │ atProton  treatment room  │
                │          │ 14 x 7, couch head north  │
 z=-12 ┌────────┼──────────┼─────────────────┬─────────┤  ← shielded sliding door at (68, -12)
       │ atMr   │ atProton │ atProtonControl │atProton │
       │        │ Wait     │ 10 x 5          │Maze     │
 z=-7  │        │ 6 x 10   ├─────────────────┤ 4 x 10  │
       ├────────┤ play,    │ atProtonAnaes   │         │
       │atMrCtrl│ cubicles │ 10 x 5, 2 bays  │         │
 z=-2  ├────────┴──────────┴─────────────────┴─────────┤
atrium ▶  atHall (corridor 30 x 4, seats at the east end)
 z=2   ├──────────┬─────────────────┬──────────────────┤
       │ atHisto  │ atPrep          │ atLinacControl   │  z 2..4.5
       │ 10 x 10  │ prep, 3 recovery├──────────────────┤
       │ Edison   │ bays            │ atLinac (vault)  │  z 4.5..12
 z=12  └──────────┴─────────────────┴──────────────────┘
       x=40       50                60                70
```

The MR suite (`atMr`, `atMrControl`) and the south rooms keep the rectangles of [ND 6]. Only `atFlex` is split.

### 2.3 The proton wing (proposal)

The wing covers x 50..70, z -26..-2 (480 m²). The report's footprint for it is "a shielded block about 14.5 x 13.5 m, a maze 3 x 8 m, a control room 6 x 4 m, two anaesthetic bays 6 x 4 m, a plant corner" [P 7.2].

**Why the vault is split.** In a real compact gantry room, the three-storey height belongs to the rotating drum behind the face wall. The patient's side of the wall is an ordinary room. The vault is therefore split into a walkable treatment room and a sealed gantry hall [P 2.3, 2.4]. The gantry turns about a north-south axis; the patient lies head north with the head at the isocentre, about 1.5 m in front of the face wall (target).

| AreaId (proposal) | Rect (x, z) | Size | Kind | Ceiling (walk mode) | Holds |
|---|---|---|---|---|---|
| `atProton` | 56..70, -19..-12 | 14 x 7 | clinical | 3.6 m (suspended; lasers, cameras) | Couch, gantry face plate and nozzle, moving floor, lasers, cameras, search panels A and B, red lamps |
| `atProtonGantry` | 56..70, -26..-19 | 14 x 7 | service, sealed (no door) | none (never walked) | The drum (about 9-10 m diameter) under a 9.5 m roof. Drawn as an exhibit in the overview's cut-away |
| `atProtonCyclo` | 50..56, -26..-12 | 6 x 14 | service, sealed | none | Cyclotron (drum about 3 m), beamline stub through the wall into the gantry hall, roof about 4.5 m |
| `atProtonControl` | 56..66, -12..-7 | 10 x 5 | staff | 3.0 m | Three desks, a camera wall (CCTV), the accelerator status panel, the child's repeated anaesthetic monitor |
| `atProtonAnaes` | 56..66, -7..-2 | 10 x 5 | clinical | 3.0 m | Induction bay and recovery bay (children), anaesthetic machine, monitor, trolley bay |
| `atProtonWait` | 50..56, -12..-2 | 6 x 10 | public | 3.0 m | Reception desk, waiting seats, play corner and table, two changing cubicles, the mask rack |
| `atProtonMaze` | 66..70, -12..-2 | 4 x 10 | clinical | 3.0 m | Dog-leg maze with one baffle; the shielded door at its north end |

**Doors (proposal):**

| Door | At | Width | Kind |
|---|---|---|---|
| hall to `atProtonWait` | (53, -2) | 1.6 | auto |
| hall to `atProtonAnaes` | (61, -2) | 1.6 | auto |
| hall to `atProtonMaze` | (68, -2) | 1.6 | swing |
| `atProtonMaze` to `atProtonAnaes` | (66, -4.5) | 1.6 | auto (the sleeping child's trolley) |
| `atProtonMaze` to `atProtonControl` | (66, -9.5) | 1.0 | swing |
| `atProtonMaze` to `atProton` | (68, -12) | 1.8 | shielded sliding door, about 15 s to open [P 2.4 target] |

`atProtonGantry` and `atProtonCyclo` have no doors. The nav graph derives from `AREAS` and `DOORS` [ND 6], so sealed rooms drop out on their own.

**The maze.** The maze is one area with a baffle wall drawn in Blender. If the nav graph needs the bend as real walls, it becomes two areas joined by an opening. That is the orchestrator's call in C0.

**Thick walls.** The sim keeps every wall at 0.2 m (`WALL.thickness`). Blender draws the vault and maze walls as 1.5 m concrete:
- the thickness goes inward into the sealed rooms and the maze baffle, so the treatment room keeps its walkable floor;
- the outer face stays at x 70 and z -26.

**The cyclotron.** There is no window into the cyclotron room: a real vault has none. It is seen in the overview's cut-away, on a painted camera view on the accelerator panel, and in the tour.

### 2.4 Histotripsy in `atHisto`

This follows [H 7.1] with one change.

- **Room:** `atHisto` at x 40..50, z 2..12 (10 x 10 m; at least about 7 x 7 m is needed, [H 7.2]). The door from the hall is at (45, 2), and recovery is in `atPrep`. There is no control room, no lead lining and no shielding.
- **Layout:** the table's long axis runs east-west, centred at (45.0, 7.0), head west. The patient's right is south, which is the cart side; the patient's left is north, the door side.
- **Spots:** the spots of [H 7.1] (`histo.table`, `anaesHead`, `cart`, `ir`, `cs`, `us`, `son`, `fluidics`, `tech`, `rn`, `backTable`, `stretcher`) become one `HISTO_SUITE` table in `places.ts`.
- **The change: keep the published right kidney.** [H 5.2] suggests mirroring to a left kidney so that the existing `obliqueLeftUp` pose can be reused. With the head west, a left-kidney patient's back faces north, so the cart, the ultrasound and the fluidics cart would all have to move to the door side.
  - A **right** kidney (the published UK case, [H 5.2]) lies on the left side with the back facing south, so one spot table serves both scripts.
  - The cost is a new position, `lateralRightUp`: the mirror of the existing oblique pose with a deeper roll, which is a sign flip in the crowd pose.

### 2.5 The MR-Linac in `atFlex`

| AreaId (proposal) | Rect | Notes |
|---|---|---|
| `atLinacControl` | 60..70, 2..4.5 | Door from the hall at (65, 2). Consoles face the vault wall; CCTV only |
| `atLinac` | 60..70, 4.5..12 | Shielded sliding door at (67, 4.5). A ring-gantry MR-Linac with its couch on the long axis |

A Unity-class vault is somewhat larger than a standard linac vault, and its real size was not researched (it is tagged [U] in [P 0]). The C5 research report must confirm that 10 x 7.5 m works, or propose taking 2 m from `atPrep` (recovery would drop to two bays).

### 2.6 Cancer-centre rooms in the existing building (proposal)

Levels 1 and 2 have no free rooms [ND 1]. Two public rooms are lightly used, and both open onto the atrium's ward corridors, which is the visitor's route to the annex:

| Room today | Becomes | Size | Why there |
|---|---|---|---|
| `loungeA`, the ward A family lounge (x 25..40, z -22..-16) | **Chemotherapy day unit**: 6 reclining chairs along the outer wall, infusion pumps on poles, a nurse base | 15 x 6 m | Next to the atrium garden. The pharmacy core is close for MedPod deliveries |
| `quietB`, the ward B quiet room (x 25..40, z 16..22) | **Oncology clinic and tumour board**: two consulting rooms (5 x 6 each) and a tumour board room (5 x 6) with a screen wall and a table for 10 | 15 x 6 m | Mirrors the chemo unit across the atrium; the oncologist's base |

**Cost of using these rooms:**
- **Visitor overflow moves.** These rooms hold the overflow visitor parties today (`population/director.ts`, `seats.ts` kind `lounge`, the nav graph's `loungeA` and `quietB` nodes). That overflow moves to the atrium seats and the annex hall seats.
- **Rebakes.** The ward A and ward B Blender zones need a rebake (`tools/arch/zones/wardA.py`, `wardB.py`).

### 2.7 Knock-on effects

| Effect | Handling |
|---|---|
| Level-2 line at x 70 | Move `LEVEL2_SPLIT_X` to 79, and add a test that every annex rect, door and spot is on level 1 (`levelOf`) |
| Overview framing | `VIEW` must frame x -62..70: centre x about 4, half-extent x about 67 (today -11 and 51). The default view moves about 30 % further out. Alternatively, keep today's default and add an "Annex" overview preset (an open question) |
| Plinth and lawns | `PLINTH.x1` 48 to 78. Lawns and the stone apron go round the annex; the wing's north face at z -26 leaves 6 m of lawn to the plinth edge at z -32 |
| X1 and Akalux | Device cards only (section 1) |
| The wing before C3 | C1 builds a closed hoarding along the wing's hall frontage (x 50..70 at z -2) with a sign, "Proton therapy: opening soon". The hall works while the wing is a hole in the model |
| Visitor overflow | Moves with C4 and C6 (section 2.6) |

---

## 3. Contract changes needed (list only)

The main session owns `src/sim/types.ts`, `src/sim/places.ts`, `src/sim/config.ts`, `src/sim/levels.ts`, `src/scene/camera/frameOrder.ts` and the registries. This plan edits none of them. Each item is a change request, marked with the wave that needs it. Names are proposals.

**`src/sim/types.ts`**

| Union or type | Add | Wave |
|---|---|---|
| `ProcMachine` | `'histotripsy'`, `'protonGantry'`; later `'mrLinac'` | C0; C5 |
| `ProcedureId` | `'histo-liver'`, `'histo-kidney'`, `'proton-headNeck'`, `'proton-paediatric'`; later the MR-Linac script ids | C0; C5 |
| `ProcRole` | Shared: `odp`, `recoveryNurse`. Histotripsy: `clinicalSpecialist`. Proton: `radiographer`, `radiographer2` (therapeutic; the orchestrator may prefix them `rt…` to keep them apart from `ctRadiographer`), `physicist`, `oncologist`, `playSpecialist`, `reception`, `parent` (a visitor entity in the child's case). `ir`, `anaesthetist`, `sonographer`, `circulator` and `scrub` already exist | C0 |
| `Role` (people) | `physicist`, `playSpecialist`, `oncologyNurse`. Or reuse `doctor`, `nurse` and `radiographer` with roster titles, since avatars are shared per role [ND 3] | C0 |
| `ProcAction` | Histotripsy: `fillCoupling`, `guideArm`, `drainCoupling` [H 7.6]. Proton: `fitMask`, `alignCouch`, `searchRoom`, `pressBeam`, `monitorChild`, `playWithChild` [P 7.6]. `operateConsole`, `positionPatient`, `transferPatient`, `intubate` and `checklist` already exist | C0 |
| `ToolKind` | Histotripsy: `couplingMembrane`, `bubbleBulb`, `inspectionMirror`, `spaceMouse`, `clippers`, `oilBottle`. Proton: `thermoplasticMask`, `slideSheet`, `pendant`, `softToy`, `doll`, `wipe`, `laryngealMask` | C0 |
| `ProcAnchor` | Histotripsy: `histoCart`, `histoIr`, `histoCs`, `histoUs`, `histoSon`, `histoFluidics`, `histoTech`, `histoRn`, `histoStretcher` (the existing `anaesHead`, `anaesStool` and `scrubBackTable` are remapped per room, as the cryo suite does). Proton: `couchHead`, `couchLeft`, `couchRight`, `couchFoot`, `consoleA`, `consoleB`, `cctvWall`, `doorInside`, `searchPanelA`, `searchPanelB`, `mazeBend`, `trolleyBay`, `inductionHead`, `recoveryBed`, `maskRack`, `playTable`, `reception`, `changeCubicle` [P 7.1] | C0 |
| `ProcTarget` | Histotripsy: `membrane`, `treatmentHead`, `uiScreen`, `usScreen`, `flank`. Proton: `mask`, `nozzle`, `couchTop`, `imagingArm`, `consoleScreen`, `cctvWall`, `searchPanel` | C0 |
| `FocusId` | Histotripsy: `coupling`, `histoScreens`, `treatmentHead`. Proton: `gantry`, `nozzle`, `protonConsole`, `couch`, `maze`, `playArea`, `anaesBay`. `controlRoom` and `usScreen` already exist | C0 |
| `PatientPosition` | `'lateralRightUp'` (section 2.4) | C0 |
| `PatientPoseView` | `mask: number` (0..1, the thermoplastic shell), and a table flex angle (`flexDeg`) for the kidney case. The flex may instead sit with the table's pose, as R5 put the OR table in `surgery/tablePose.ts` | C0 |
| `Airway` | `'laryngealMask'` (the child's airway device) | C0 |
| New room views | `HistoRoomView`: arm stage and progress, coupling fill 0..1, wheel lock, voltage 0..1, cloud on or off and its place in the volume, survey and test point k of 7, coverage 0..1, UI page, ultrasound view. `ProtonRoomView`: gantry angle, couch yaw, lift and six-axis shift, snout 0..1, range shifter, imaging arms 0..1, moving-floor offset, door 0..1, lamps (beam on, X-ray, warning), beam state, field k of n, layer i of N, spot fill, six interlock lamps. Both are pure functions of script, step, progress and seed, like `applyRobot` in `surgery/robot.ts` [ND 1] | C0 (shape); C2 and C3 (fill) |
| `SeatKind` | `histoTable`, `protonCouch`, `chemoChair`; later `linacCouch` | C0; C4; C5 |
| `SimEventType` | `histoStarted`, `histoDone`, `protonQaDone`, `fractionStarted`, `fractionDone`, `chemoStarted`, `chemoDone`, `tumourBoardMet` | C0, C4, C6 |

**`src/sim/places.ts`**
- `AreaId`, `AREAS` and `DOORS` rows for the annex [ND 6], **without** `atRt`, `atRtControl`, `atPlant` and `atFlex`, plus:
  - the proton wing's seven areas and six doors (section 2.3, C0);
  - `atLinac` and `atLinacControl` (section 2.5, C0 as reserved rooms; filled in C5).
- `ANNEX: Rect`, kept apart from `BUILDING` so the main shell's bake and tests do not change [ND 6]. Add a per-area exterior roof height for the raised gantry hall (9.5 m) and the cyclotron room (4.5 m).
- `ceilingHeight`: `atProton` 3.6 m; `atProtonGantry` and `atProtonCyclo` are never walked.
- Spot tables:
  - `HISTO_SUITE` ([H 7.1] and section 2.4);
  - `PROTON_SUITE`: couch base and isocentre, the face plate's centre, consoles, CCTV wall, search panels, maze bend, trolley bay, mask rack, play table, cubicles, reception, the two anaesthetic bays, the QA device's place on the couch;
  - later, `LINAC_SUITE` and `CHEMO_UNIT` (six chairs, nurse base, pump poles, the MedPod drop point).
- `VIEW` widened, or an annex preset (section 2.7).
- `SIGNS` for the annex and the cancer quarter round the atrium, and the minimap rectangle.
- `loungeA` and `quietB` relabelled; `quietB` may split into `oncClinic1`, `oncClinic2` and `tumourBoard` (C4, C6).
- The new seats in the seats registry.

**`src/sim/levels.ts`**: `LEVEL2_SPLIT_X` 70 to 79 (C0).

**`src/sim/config.ts`**
- `CONFIG.histotripsy`:
  - list hours 08:30-17:00 and cases per day (2);
  - the share of kidney "trial" cases (seeded, for example 1 day in 3);
  - room-time bands: liver 95-175 min, kidney 125-235 min [H 5.1, 5.2];
  - recovery 2-6 h; same-day or next-day discharge shares [H 4].
- `CONFIG.proton`:
  - daily QA at 07:00 for 10-20 min [P 2.6];
  - two children's slots under anaesthetic from 07:30 (they have fasted, so they go first [P 5b]);
  - adult slots every 30 min to 19:00;
  - session-time bands: adults 20-45 min, children up to 60 min [P 4, 5b];
  - the shared-beam wait (a short seeded pause before beam on [P 5a step 17]);
  - the field tables (gantry angle and couch yaw per field), for display only.
- `CONFIG.chemo` (C4) and `CONFIG.mrLinac` (C5).

**`src/scene/camera/frameOrder.ts`**: `histoRig`, `histoScreens`, `protonRig`, `protonScreens`, later `linacRig` and `linacScreens`. They slot beside `cryoRig` (-0.268) and `cryoScreens` (-0.265), for example -0.267, -0.266, -0.264 and -0.263. All negative (C0).

**Registries**

| Registry | Change |
|---|---|
| Interact | Console seats `console:histo:ir` (the cart) and `console:proton:rad` (the control room), later `console:linac:rad`. The maze door is an ordinary `door`. No new interactable kind |
| Seats | `histoTable`, `protonCouch`, the proton waiting seats and cubicles, `chemoChair` |
| Fx | Beam-on and X-ray lamps, the warning lamp outside the maze, the gantry bell and hum, the histotripsy crackle (kept low [H 7.4]) |
| Warm-up manifest (`src/scene/warmup/manifest.ts`) | The new glbs behind `registerWarmGate` |

**Not contract files, but blocked by the unions** (`src/content/procedures.ts` checks every union with a `Record<Union, true>` [P 7.6]):
- `MACHINE_CHECK`, `PROCEDURE_CHECK`, `UNITS` and `OPTIONAL_UNITS` rows;
- a `fields` array in the script schema for the proton field table, which repeats with per-field parameters (section 5.3).

**Outside `src/sim`:**
- `src/scene/landscape/exterior.ts`: `PLINTH` and the lawns;
- `tools/arch/zones.json`: new zones `annex` and `protonWing`;
- `tools/arch/export-plan.ts`: export the annex rects.

---

## 4. Blender modelling

### 4.1 Shared rules (from CLAUDE.md, [ND 7] and the rollout docs)

- **Pipeline.**
  - Architecture is a zone in `tools/arch/zones.json`, with its design module in `tools/arch/zones/<id>.py` built from the shared kit (`tools/arch/kit/`, `materials.json`).
  - A device is `tools/arch/devices/<id>.py`, with named nodes `dev:<id>/<part>`.
  - Export to glTF, then gltf-transform with meshopt and KTX2 (`tools/arch/optimize.mjs`). The validator must report 0 errors.
  - Blender runs only through the one-slot lock script.
- **Look.** The clean, clinical, modern style approved for the lobby: white and light grey, terrazzo, coloured wayfinding, minimal wood. No vendor logos and no vendor colours (`licence.logo: 'none'`, [ND 8]). Every screen carries a `SIMULATED DEMO` chip.
- **Light.** Architecture gets Cycles-baked lightmaps, one bake per zone. Devices get baked ambient occlusion in their atlas, blob shadows and emissive panels: no real lights.
- **Draw cost.** Static parts are merged by material, moving parts are separate nodes, and props are instanced. Each device has at most 6 materials, shared where possible. Each zone gets an overview proxy (one draw), as the 8 existing zones have.

### 4.2 Zone `annex` (C1)

- **Rooms:**
  - `atHall`: a corridor with waiting seats at its east end and the opening to the atrium;
  - the MR suite shell: `atMr` and `atMrControl`, without the magnet, which comes in its own wave;
  - `atHisto`, which reuses the theatre's ceiling, pendant and wall kit;
  - `atPrep`, with three recovery bays;
  - `atLinacControl` and `atLinac`, as an empty shielded shell with a closed door until C5;
  - the hoarding in front of the wing (section 2.7).
- **Exterior:** the façade continues the main building's, with a glazed east end to the hall. Plinth, lawns and apron follow `exterior.ts`.

### 4.3 Zone `protonWing` (C3)

- **Massing.** A separate zone, so the tall block bakes, streams and is culled on its own. The wing is 3.0 m high, with a raised block over `atProtonGantry` (9.5 m) and a lower one over `atProtonCyclo` (4.5 m). The roof reads as a concrete block [P 2.4].
- **Shielding.** The vault and maze walls are 1.5 m concrete, thickened inward (section 2.3). The maze baffle and the heavy sliding door are 1.8 x 2.3 m and 0.4 m thick [P 2.4 target]. There is a trefoil sign, and a red lamp over the door.
- **Treatment room.**
  - **Look:** a pale, quiet room with a curved gantry face (a 5 m circular plate) and a softly glowing ceiling panel [P 7.4].
  - **Fittings:** green and red laser lines crossing at the isocentre, two small wall cameras and an intercom grille.
  - **Floor:** the moving-floor plates in front of the face. In a real room the nozzle passes under the patient through a covered pit. Our floor stays at y 0, so the model hides the dive under the moving floor, inside the plinth's 0.7 m thickness. The Blender agent sets the depth so nothing pokes through the plinth's underside.
- **Children's rooms.** `atProtonWait` and `atProtonAnaes` use calm colours, a ceiling picture, soft toys on a shelf and a doll on the play table [P 7.4].
- **The overview's cut-away.** Walls are cut at 1.3 m, but the drum is shown whole as an exhibit. Screenshots of both versions go to the owner (an open question).

### 4.4 Device `histotripsy` (C2)

The sizes are the targets in [H 2.2]: cart 0.75 x 1.0 x 1.5 m; arm base at 1.15 m; head housing 0.22 m wide and 0.40 m tall; membrane pillow 0.35 m across; fluidics cart 0.55 x 0.75 x 1.0 m; ultrasound cart 0.6 x 0.9 x 1.5 m.

| Node | Notes |
|---|---|
| `dev:histo/cart`, `/cart/screen` | The screen face is a live canvas; two knobs, a stop button, brake pedals |
| `dev:histo/arm/base`, `/arm/upper`, `/arm/fore` | Three rigid groups (base and shoulder; upper arm; forearm and wrist), for 3-4 draws [H 7.7]. Joint rings are modelled, not jointed |
| `dev:histo/head12`, `/head14` | One is hidden. The white shell and dark bowl differ in depth |
| `dev:histo/support`, `/frame`, `/membrane` | The membrane is a soft dome in two states: filled (a tinted opaque inside with a thin alpha rim, no refraction) and limp. It is the only see-through object [H 7.7] |
| `dev:histo/fluidics`, `/fluidics/level`, `/hoses` | The water level moves with the coupling fill |
| `dev:histo/us`, `/us/screen` | A GE-class cart, live canvas |
| Props (instanced) | Bubble bulb, inspection mirror, space mouse, oil bottle, clippers |
| Table | 2.1 x 0.55 m, 0.9 m high, side rails, upper and lower tops on a flex hinge [H 2.2] |

The anaesthesia machine, monitor and back table are reused from the theatre props.

### 4.5 Device `protonGantry` (C3)

| Node | Notes |
|---|---|
| `dev:proton/face` | A 5 m plate that turns about the north-south axis through the isocentre |
| `dev:proton/nozzle`, `/snout`, `/rangeShifter` | The nozzle rides on the face. The snout slides 0.42 to 0.03 m from the head, and the 3 cm plate swings in [P 2.3] |
| `dev:proton/cbctA`, `/cbctB` | Two 1.5 m arms that stow inside the nozzle |
| `dev:proton/floor` | A moving-floor segment that follows the nozzle |
| `dev:proton/drum` | A merged proxy under 10k triangles in the sealed hall that turns with the face. Never model the bending magnets or the beamline [P 7.5] |
| `dev:proton/couch/base`, `/column`, `/top` | Base yaw, lift, and a small six-axis shift of the top. Top 0.5 x 2.1 m [P 2.3] |
| `dev:proton/door` | The sliding leaf |
| `dev:proton/lamps`, `/lasers` | Emissive only |
| `dev:proton/cyclotron`, `/beamline` | Static merged meshes (a drum about 3 m across) in the sealed room |
| Control room | Three desks with their screens (live faces, section 6), the camera wall, chairs (the existing console seat kit) |
| Props (instanced) | Mask (a pale shell) and base plate, head cushion, pendant, toys, doll, wipes, the QA device |

### 4.6 Device `mrLinac` (C5)

This waits for the C5 report. The likely nodes are:
- the magnet ring (bore 700 mm) and the linac head turning on its ring [P 0];
- the couch and its coils;
- the control room's MR and plan screens.

It reuses the vault patterns of 4.3 (door, lamps, lasers).

### 4.7 Ward rebakes (C4, C6)

- `wardA.py`: the chemotherapy day unit in `loungeA`. Six recliners and pump poles are instanced; there is a nurse base, and a window wall onto the lawn.
- `wardB.py`: the consulting rooms and the tumour board room in `quietB`. The board room's screen wall is one live canvas.

---

## 5. The sim scripts

### 5.1 From a report row to a script step

The R5 engine (`src/sim/procedure`, scripts as JSON in `src/content/procedures/`, zod loader `src/content/procedures.ts`) plays a script of 20-32 steps [P 7.6]. Each column of the reports' step tables maps to a field:

| Report column | Script field |
|---|---|
| # and Step | `id`; `caption` "Step k of n: ..." (at most 60 characters) |
| Why | `why` (at most 160) |
| Min | `realMinutes` band (the living day uses the band's middle, jittered by the seed) |
| Watch compression | `watchSeconds` |
| Who does what, and where | `roles.<role>.do` (a `ProcAction`) and `.at` (a `ProcAnchor`); `look` and `work` (a `ProcTarget`) |
| Hands (left / right) | `roles.<role>.left` and `.right` (`ToolKind`) |
| Patient state | `patient` changes: enums switch at the step's start, numbers ease over it |
| Machine state and screen view | The room view key the rig and screens read; `focus` for the watch camera |
| (feed lines) | `event` (3-6 per script); `checklist` on Sign In, Time Out and Sign Out |

**Copy rules (loader checks):**
- no graphic words;
- UK vocabulary ("theatre", "centre", "anaesthetic", "paediatric", never "OR" in capitals);
- one line per field.

Both reports say their captions and "why" lines are within the limits [P 7.6; H 5].

### 5.2 Histotripsy (`ProcMachine 'histotripsy'`, C2)

| Item | Liver (`histo-liver`, [H 5.1]) | Kidney (`histo-kidney`, [H 5.2]) |
|---|---|---|
| Status shown | Authorised (FDA De Novo 2023, CE 2026) [H 3.1] | **Investigational**: the chip and card text of [H 5.2]. The copy never says "approved" |
| Steps in the room script | 1-27 (27 steps, 720 s of watch time) | 1-29 (29 steps, 794 s) |
| After the room | Steps 28-29 (recovery and home, in `atPrep`) are case code, as theatre recovery (PACU) is for the da Vinci cases; a watch shows them as a camera cut with captions. Step 30 (shutdown) is the room's turnover | Steps 30-31 the same |
| Units, in order | `in` 1-2, `induction` 3-6, `positioning` 7-9, `coupling` 10-12, `planning` 13-16, `test` 17-18, `treat` 19-21, `finish` 22-24, `emergence` 25-26, `out` 27 | The same, with `treat` 19-23, `finish` 24-26, `emergence` 27-28, `out` 29 |
| Patient | `supine`, small right-side lift (`rollDeg`), `airway` tube, `marks` marked | `lateralRightUp`, table flex, otherwise the same |
| Repeat | None. `repeat` could later play a second volume for a larger tumour [H 7.6] | None |
| Events (feed) | Sign In; Time Out; "the first test cloud formed where planned"; "the planned volume is treated"; Sign Out [H 7.5] | The same |

**Roles and spots** (from [H 6]):

| Role | Spot | Main actions |
|---|---|---|
| `ir` | `histoIr` | `guideArm`, `operateConsole`, `markSkin`, `fillCoupling` (bulb and mirror) |
| `anaesthetist` | `anaesHead` | `injectIv`, `intubate`, `holdBreath` (the optional fusion sweep) |
| `odp` | `anaesHead`, south side | Hands equipment, `attachMonitors` |
| `sonographer` | `histoSon` | `operateConsole` at the ultrasound cart |
| `circulator` (RN) | `histoRn` | `checklist`, `chart`, clips and cleans |
| `scrub` (Tech) | `histoTech` | Clamps the support arm, `fillCoupling`, `drainCoupling` |
| `clinicalSpecialist` | `histoCs` | Watches the UI, calls its steps, ends the session |
| `recoveryNurse` | in `atPrep` | Case code |

**The machine view** (`HistoRoomView`) is set per step from [H 5.1]'s last column:
- **The arm:** folded at 1-11, over the frame then submerged at 12, surveying at 16, treating at 19-21, lifted and folded at 22.
- **The coupling:** fills over 11 and drains over 23.
- **The UI page:** patient list, localise, fusion, plan, test, treat, summary.
- **The ultrasound overlay:** the bright cloud from 17, the dark zone growing over 20-21, contour and margin rings from 15-16.

**The living day.**
- **The list:** two cases a day. In showcase mode one is warm-started mid-case at 07:30, through `warmInFlight`, as the other services do.
- **The patient's journey:** arrive at the main entrance, then `atPrep` (gown, drip, checks), then `atHisto` by stretcher, then back to `atPrep`, then home, or to a ward bed for the night by the seeded share.

### 5.3 Proton therapy (`ProcMachine 'protonGantry'`, C3)

| Item | Adult head and neck (`proton-headNeck`, [P 5a]) | Child under anaesthetic (`proton-paediatric`, [P 5b]) |
|---|---|---|
| Steps | 28 (673 s) | 28 (686 s) |
| Units, in order | `arrive` 1-3, `prep` 4-5, `position` 6-10, `search` 11, `image` 12-13, `correct` 14-15, `beam` 16-23, `unload` 24-25, `out` 26-28 | `arrive` 1, `prep` 2, `induction` 3-7, `position` 8-12, `search` 13, `image` 14-15, `correct` 16, `beam` 17-23, `unload` 24-25, `recovery` 26-27, `out` 28 |
| Optional units | `induction`, `recovery` (the adult has neither) | none |
| Repeat | The field run, a gantry turn then beam on (steps 18-19), played 3 times for fields 1-3. Each repeat reads its gantry angle and couch yaw from the script's `fields` array (40°, 180°, 320° plus 10° couch yaw [P 5a]), as the cryo script repeats per needle. The JSON holds 24 rows that play as 28 steps | The same (60°, 200°, 300° [P 5b]); 24 rows, 28 played |
| Patient | `supine`, arms out, `awake`, `mask` 0 to 1 at step 8, a small `rollDeg` at the couch correction | `asleep` from step 6, `airway` `laryngealMask` from 7, `mask` 0 to 1 at 10 |
| Events | "Daily checks signed"; "Position matched: six shifts applied"; "Field 1 delivered"; "Fraction 12 of 33 complete" | "Asleep, monitors on"; "Position matched"; "All three fields delivered"; "Awake in recovery" |

This refines the report's unit list [P 7.6] by adding `unload` (beam off, team in, mask off). Beam-off steps then stay apart from the child's recovery, and the adult and child scripts share one unit order.

**Roles and where they stand** (from [P 6]):

| Role | Spots | Main actions |
|---|---|---|
| `radiographer` (Rad1) | `couchHead`, `maskRack`, `searchPanelA`, `searchPanelB`, `doorInside`, `consoleB` | `fitMask`, `alignCouch` (pendant), `searchRoom` (last out) |
| `radiographer2` (Rad2) | `consoleA`, `couchLeft` | `operateConsole`, `pressBeam` |
| `reception` | `reception` | Check-in, the next appointment |
| `physicist`, `oncologist` | Off stage (phone) in the session; the physicist runs daily QA at 07:00 | `chart` |
| `anaesthetist`, `odp` (child) | `inductionHead`, `couchHead`, then `consoleB` at beam on | `injectIv`, airway, `monitorChild` |
| `playSpecialist`, `parent` (child) | `playTable`, `inductionHead`, `recoveryBed` | `playWithChild`, holding a hand |
| `recoveryNurse` (child) | `recoveryBed` | Watches the waking child |

**The beam-on rule.** At beam on the treatment room holds the patient and nobody else, and the control room holds two or three people, plus the child's anaesthetic team [P 6]. It is a node test (section 10).

**The machine view** (`ProtonRoomView`):
- **The gantry** parks at 0° and turns to each field angle over its step's watch time (28-30 s in 5a, [P 7.3]). The lamps go off while it moves.
- **The imaging arms** swing out and the gantry turns through about 200° during the cone-beam scan (step 12).
- **The couch** applies the six shifts over step 14; the residuals are shown at step 15.
- **The snout and range shifter** set at step 16.
- **The beam states** run WAITING FOR BEAM, READY, BEAM ON, PAUSED. Layer i of N counts up, and the spot map fills.
- **The numbers on screen** come from the script (for example 1.2, -0.8, 0.5 mm; 0.4, -0.6, 0.9°), never from patient data [P 5a].

**The living day.**
- **The list:**
  - QA at 07:00, with the physicist and the QA device on the couch;
  - two children from 07:30 under anaesthetic;
  - adults every 30 min until 19:00, 15-20 a day [P 4], with seeded fraction numbers and diagnosis labels.
- **The adult's journey** is a new outpatient radiotherapy journey: main entrance, atrium, `atProtonWait` (check in, change), the maze, `atProton`, back to the cubicles, out.
- **The child's journey:** the parent and child go to the play corner, then `atProtonAnaes`, the room, recovery in `atProtonAnaes`, home.

### 5.4 MR-Linac (`ProcMachine 'mrLinac'`, C5, outline)

**The report.** The C5 research report writes the step tables. It also confirms the vault size, the indications and status as of its date, the team, and the times of an adaptive session.

**The likely script.** An adaptive session (for example prostate or pancreas): arrive, change, position on the couch with coils, MR scan, the team re-draws the contours and re-plans the dose on the day while the patient waits, beam on with the MR image live, out.

**Reuse.** It reuses the proton units `arrive`, `prep`, `position`, `image`, `beam`, `unload` and `out`, adds one unit, `adapt`, and reuses the control-room painters.

### 5.5 The chemotherapy day unit and the tumour board (C4, C6)

These are not R5 scripts. They are small sim departments.

**Chemo journey (C4).** It ties together three things the hospital already does well:
1. The patient arrives and has bloods taken at the blood-draw robots (`DRAW_CENTRE`).
2. The patient waits in the atrium.
3. A chair in the day unit; a nurse fits the line and starts the pump.
4. A MedPod brings the sealed, labelled demo infusion bag from the pharmacy core to the unit's drawer. This is the hospital's original hero idea, "medicines come to the patient".
5. The infusion runs for 2-4 h (seeded); then the patient goes home.

The bags are synthetic ("Infusion A (demo)"). The medicine catalogue stays a fixed demo list (CLAUDE.md).

**Tumour board (C6).** A scripted meeting at 08:00 (daily in showcase mode):
- the oncologist, the IR, a radiologist, a physicist and a nurse sit at the table;
- the screen wall shows the day's synthetic cases and the machine each one is already booked on.

The booking comes from the day's seeded list, not from a decision.

---

## 6. The watch scripts

Each script has a "Watch step by step" button in its room panel. As in R5, it starts a case now (or follows the current one) and plays it in 10-15 minutes with a close camera and captions [PR 14; R5 plan].

| Script | Played steps | Watch time | Steps to film up close | Labels on screen |
|---|---|---|---|---|
| `histo-liver` | 27 (+ recovery coda) | about 720 s (778 s with the coda) [H 5.1] | Water filled and air chased out (11); the arm lowering the head (12); the survey (16); the first bright cloud on the ultrasound (17); the sweep (20) with nobody touching anything; the tube (6) [H 7.3] | `SIMULATED DEMO` on every screen |
| `histo-kidney` | 29 (+ coda) | about 794 s (834 s with the coda) [H 5.2] | The four-person turn (7); the water (11); the halfway check (21); the two halves of the sweep (20, 22) | **"Kidney use is investigational: FDA review pending (De Novo request, 11 May 2026). In the UK it is in a trial."** [H 5.2] |
| `proton-headNeck` | 28 | 673 s [P 5a] | The mask going on (8); the search and the red lamp (11); the cone-beam arms (12); the six numbers (13); the couch correcting itself (14); the gantry turns (18, 20, 22); beam on with the layer counter and spot map (19, 21, 23) [P 7.3] | `SIMULATED DEMO`; fraction n of N is synthetic |
| `proton-paediatric` | 28 | 686 s [P 5b] | Mask practice on the doll (2); falling asleep with a parent beside (6); the mask over the airway (10); the slide-sheet transfer (9); the control room with the child's monitor (13); the gantry turns and beam on; waking with the parent (26) | The same. Calm copy and no needles shown: the line is already in [P 5b] |
| MR-Linac (C5) | about 24-30 | 600-900 s | From the C5 report | From the C5 report |

**Camera.**
- **Close shots** use the R5 watch camera (`FocusId` per step).
- **The proton beam-on shots** cut between the control room (the console and the camera wall) and a wide room shot that shows only the patient and the turning gantry.
- **The histotripsy screen steps** (15-16) are screen close-ups [H 5.1].
- **The proton camera wall is painted:** stills of the three camera views with a live overlay (the patient's pose icon, the gantry angle). A second render of the scene would cost a full set of extra draw calls (section 7).

**Screens** (redraw only on change; at most 2 Hz; the focused imaging screen at 4 Hz, as CLAUDE.md allows):

| Screen | Machine | Rate | Built on |
|---|---|---|---|
| Ultrasound with the histotripsy overlay (cloud, dark zone, rings, readout) | histotripsy | 4 Hz when focused, else 2 Hz | `scene/imaging/images/usPaint.ts`, `US_VIEWS` `liver`, `kidneyR` [H 7.6] |
| Edison-class UI (three panes, the progress sphere) | histotripsy | 2 Hz | New painter, dark theme [H 2.4] |
| Treatment console (field table, beam status, interlocks) | proton | 2 Hz | New painter [P 2.5] |
| Beam's-eye spot map | proton | 2 Hz | New painter |
| Imaging registration (CT grey, CBCT colour, six shifts) | proton | 4 Hz when focused | New painter; synthetic head slice |
| Surface guidance (bedside tablet) | proton | 2 Hz | New painter |
| Accelerator status | proton | 1 Hz | Small canvas (256²) |
| Camera wall (painted) | proton | 2 Hz | Stills with a live overlay |
| Anaesthetic monitor (child, theatre) | both | 2 Hz | The existing patient-monitor painter |

---

## 7. Quest 3 budgets

**The budget (CLAUDE.md):**
- **Quest 3:** 72 Hz (90 recommended), 13.8 ms a frame, under 200 draw calls in stereo, under 1.5 M triangles, about 250 MB of GPU texture.
- **The laptop at the default view:** 300 draw calls or fewer, 1.2 M triangles or fewer, 12 ms a frame or less.

**Where we stand.** With the zone proxies, the building costs about 57 draws in the default overview and about 105 walking in the lobby (`docs/handover/rollout-drawcalls.md`). People, devices and screens come on top; the 260 measured in the lobby before the proxies included them. R5's own target for its theatre, CT and ultrasound close-ups is under 200 draws.

| Piece | Triangles | Draw calls | Texture | Source |
|---|---|---|---|---|
| Annex architecture (baked, merged), with its overview proxy | 60-80 k | 20-25 in the annex, 1 in the overview | about 12 MB lightmaps | [ND 10] |
| Histotripsy devices (cart and arm, head, coupling, fluidics, ultrasound cart, props) | 27-30 k | 11-12 | about 4 MB (one 1k atlas plus two 512² canvases) | [H 7.7] |
| Proton wing shell, maze, door (baked), with its overview proxy | 15-20 k | 5-6, 1 in the overview | in the wing bake, about 4 MB | [P 7.5] |
| Proton devices (face, nozzle, snout, floor, couch, imaging arms, control room, anaesthetic bay, props) | 45-50 k | about 18-19 | about 6 MB KTX2 | [P 7.5] |
| Proton screens | 0 | included | 6 MB or less: console, spot map and registration share one 1024 x 512 canvas; the others are 256² | estimate |
| MR-Linac vault and device | about 40 k | about 8 | about 4 MB | [ND 10] vault row; checked in C5 |
| Chemotherapy day unit (instanced chairs, pumps) | about 15 k | about 4 | in the ward A bake | estimate |
| Clinic and tumour board | about 10 k | about 3 | in the ward B bake; one canvas | estimate |

**Rules that keep the demo smooth:**
- **Visibility.** The annex draws in full only while the camera is in the annex or the atrium's east half; otherwise its proxy draws (one draw call). The wing draws in full only inside the wing or the annex hall, and each room inside the wing is culled by area. At most one machine room is in full view at a time.
- **Few live canvases.** At most four canvas textures update at once in any room; the rest keep their last frame.
- **No render targets.** The camera wall is painted, and the membrane is the only transparent object [H 7.7]. No glass or mirrors in the proton room [P 7.5].
- **Rigs.** Rigs are pure pose maths with one `useFrame` each, at the C0 priorities, with no allocations (each rig gets a `noAllocations` guard test).
- **Gates, measured with `?probe=1` on a frozen build:**
  - the overview gains at most +2 draws (two proxies);
  - the annex hall, the histotripsy close-up, the proton treatment room and the proton control room each stay under 200 draws with people;
  - triangles stay at 1.2 M or fewer.
  - A budget script fails if any glb exceeds its row's triangles, draws or materials [ND 10].
- **Texture total.** The new texture adds up to about 40-45 MB, well inside the Quest's 250 MB.

---

## 8. Waves and their order

**Rules:**
- **R5 first.** R5 continues first: Wave 2 is running, and Waves 3 and 4 follow. The cancer waves must not edit R5's files while R5 owns them: `src/sim/procedure/**`, `src/content/procedures*`, the crowd poses and drawing, `src/sim/surgery/**`, `src/scene/watch/**`.
- **Shared limits.** At most two heavy agents or processes at once, Blender through its one-slot lock, and vitest through its lock with `--maxWorkers=2`.
- **Gates.** Each wave ends with `npm run typecheck`, `npm test` and `npm run build` (into a scratch `--outDir`), then browser screenshots on the frozen check build, then the owner's look.

| Wave | Owner and agents | Files owned | Gate | Size |
|---|---|---|---|---|
| **C0 Contracts** | Main session (orchestrator) | Every item marked C0 in section 3 | Typecheck. Full suite green. The surgery and cryo plan goldens unchanged. A new reachability test passes for every annex and wing spot from the atrium; sealed rooms have no doors; every annex rect is on level 1 | S |
| **C1 Annex shell and signage** | One Blender agent (opus, design-heavy). One sonnet agent for the exterior, the culling and the overview proxy. Haiku for the signs and naming copy | `tools/arch/zones/annex.py`, `zones.json` entry, `public/assets/building/zones/annex/**`, `exterior.ts` (the annex part), `src/content/signs.json`, the wayfinding labels | Probe: overview +1 draw; annex hall under 200. Screenshots of the hall, `atHisto` (empty), `atPrep`, the hoarding and the atrium door | L |
| **C2 Histotripsy** | H-A (sonnet): the two scripts, the `histotripsy` units, the sim adapter (day list, warm start, watch). H-B (opus): the Blender device, the rig, the crowd poses (`fillCoupling`, `guideArm`, `drainCoupling`, `lateralRightUp`). H-C (sonnet): the two screen painters, the room panel, the watch button, the device card | `src/content/procedures/histo-*.json`, `src/sim/histotripsy/**`, `tools/arch/devices/histotripsy.py`, `src/scene/histotripsy/**`, `src/ui/histo/**`, and the crowd pose files by agreement with R5 | Node tests (section 10). Screenshots of every step. The owner watches both films | L |
| **C3a Proton wing and adult** | P-A (opus): the `protonWing` zone and bake. P-B (opus): the gantry device and the rig. P-C (sonnet): `proton-headNeck`, the units, the proton department (QA, adult list, outpatient journey, shared-beam wait) | `tools/arch/zones/protonWing.py`, `tools/arch/devices/protonGantry.py`, `src/scene/proton/**`, `src/sim/proton/**`, `src/content/procedures/proton-headNeck.json` | The beam-on rule test. Probe in the room and the control room. The film shown to the owner | L |
| **C3b Proton children** | P-C continues: `proton-paediatric`, the anaesthetic bays, play specialist, parent, laryngeal mask, recovery. P-D (sonnet): the control-room screens and the painted camera wall | `src/content/procedures/proton-paediatric.json`, `src/scene/proton/screens/**` | The same gates, plus "no needles shown" and the copy checks | M |
| **C4 Chemotherapy day unit** | One sonnet agent for `src/sim/chemo/**` (journey, chairs, the MedPod delivery). The Blender agent rebakes `wardA.py` between C3 bakes | `src/sim/chemo/**`, `src/content/chemo.json`, `wardA.py`, the visitor-overflow move (by change request to the orchestrator) | Every chemo patient terminates; pods deliver; no lost visitor seats | M |
| **C5 MR-Linac** | A research agent (sonnet, web) writes `docs/research/mr-linac.md` in the two reports' template, and the owner approves it. Then the Blender device, the rig and the script(s), as in C3 | `docs/research/mr-linac.md`, `tools/arch/devices/mrLinac.py`, `src/scene/linac/**`, `src/sim/linac/**` | As C2 | L |
| **C6 Tumour board and clinic** | One sonnet agent; the Blender agent rebakes `wardB.py` | `src/sim/oncology/**`, `wardB.py`, `src/content/oncology.json` | The meeting terminates daily; the screens follow the rules | S-M |
| **C7 Integration** | Main session with one haiku agent for docs | `docs/C-CANCER-CENTRE.md`, tour stops in the "Meet the device" tour [ND 9] | A full day from 06:30 to 20:00 with every machine; three watches in a row; Quest numbers; the owner reviews all scripts | M |

**Order check:**
- **C0 before everything:** the unions block every script file until they are listed [P 7.6].
- **C1 before C2 and C3:** both rooms live in the annex.
- **C2 before C3 (the owner's choice):** it also proves the annex, the new machine adapter and the room-view pattern on the cheaper machine.
- **C4 beside C3:** they use different files, and their Blender bakes take turns on the one slot.
- **C5 after C3:** it reuses the proton units, painters and vault patterns.
- **C6 after C4:** the ward B rebake follows the ward A rebake.

**Fitting round R5:**
- **C0** can land once R5 Wave 2's contract changes are in.
- **C1** can run during R5 Wave 3: its files are disjoint, and the two share only the Blender slot.
- **C2 starts after R5 Wave 3.** It is the first new machine on the procedure engine since cryo and ProSense, and it touches the crowd pose files that R5 owns until then.

---

## 9. What makes it read as a cancer centre

Each piece is scored 1-5 on four criteria: **reads as a cancer centre** (0.40), **watchable story** (0.25), **cost** (0.20; 5 = cheap) and **reuse** of what exists (0.15). The scores are my judgement.

| Piece | Reads | Story | Cost | Reuse | Score | Wave |
|---|---|---|---|---|---|---|
| Chemotherapy day unit | 5 | 4 | 3 | 4 (blood-draw robots, pharmacy core, MedPods, seats) | **4.20** | C4 |
| Histotripsy | 4 | 5 | 3 | 4 (theatre props, ultrasound painters, R5) | **4.05** | C2 |
| Proton therapy | 5 | 5 | 1 | 3 | **3.90** | C3 |
| Signage and naming ("The Ideal Hospital Cancer Centre"; wayfinding to proton therapy, histotripsy, the chemo unit, the clinic; a lobby directory) | 4 | 2 | 5 | 5 | **3.85** | C1 |
| MR-Linac | 4 | 4 | 2 | 4 (proton units and painters) | **3.60** | C5 |
| Tumour board room | 4 | 3 | 4 | 3 | **3.60** | C6 |
| Oncology clinic (consulting rooms) | 3 | 2 | 3 | 3 | **2.75** | C6 |

**What the ranking says:**
- **The chemo unit leads on "reads as a cancer centre".** Most cancer patients have drug treatment, and the unit links to the hospital's original medicine-delivery idea.
- **The machines lead on the owner's goal**, which is to show doctors the world's most advanced devices. That is why they come first.
- **Signage is cheap.** It rides along with C1, so the building announces itself as soon as the annex opens.
- **The clinic is the weakest piece.** It shares C6 with the tumour board, which gives the clinic its story: the board decides nothing, but it shows how a case reaches each machine.

---

## 10. Tests (all node tests, `--maxWorkers=2`)

- **Determinism:** the same seed gives the same trace hash for a whole day with the annex running, and a warm start equals a replay. The existing surgery and cryo goldens do not change.
- **Termination:**
  - every histotripsy and proton case reaches `out`;
  - every outpatient radiotherapy, day-case histotripsy and chemo journey ends at a legal spot;
  - no forced steps (zero safety-net teleports).
- **Reachability:** every new anchor is reachable from the atrium; sealed rooms have no doors; every annex rect, door and spot is on level 1.
- **No deadlock:** a stretcher and a walking adult pass in the 4 m maze, and a child's trolley and staff pass at the anaesthetic bay door; two watch requests queue; time skip at 10x and 30x never leaves a machine mid-step.
- **The beam-on rule:** at every proton step whose beam state is on, no staff entity is inside `atProton`.
- **Content:**
  - the script lengths, captions (60 characters or fewer) and "why" lines (160 or fewer);
  - the graphic-word and UK-vocabulary checks;
  - `histo-kidney` carries the investigational label, and no kidney line contains "approved";
  - glb node names match the device entries, and the validator reports 0 errors.
- **Rigs:** pure pose functions return finite poses for every progress, limits hold, and each rig has a `noAllocations` guard.
- **Screens:** at most 2 redraws a second in a 60 s run (4 when the imaging screen is focused); no redraw when the content is unchanged.
- **Budget:** per-glb triangles, draws and materials against section 7.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Collision with R5 (the procedure engine, the crowd poses, `procedures.ts`) | C2 starts after R5 Wave 3. Files are owned per agent, and pose files are changed by agreement with whoever owns them |
| The Blender lock has one slot | Bakes are scheduled in turn (C1, C2 device, C3 wing, C4 ward A rebake, C3 device, C6 ward B rebake) |
| The tall gantry block looks odd in the cut-away overview, and the wider view makes everything smaller | Before/after screenshots from the same camera poses; the owner chooses (open questions) |
| Medical accuracy | Kidney histotripsy is labelled investigational [H 5.2]. Proton evidence is mixed [P 3], so cards make no outcome claims. FLASH and arc therapy are not shown [P 1]. Immune effects are never shown [H 1]. Every [U] item is checked before it goes on a card [ND 11] |
| Trademarks | Generic models, no logos or vendor colours. Maker names appear only in card text (nominative use) [ND 11] |
| A child under anaesthetic is a sensitive scene | Calm copy; a parent is present until the child is asleep; no needles shown; the play specialist leads; nothing is graphic [P 5b] |
| Chemotherapy drug names | Synthetic labels only; the catalogue stays a fixed demo list (CLAUDE.md) |
| No real vendor drawings for the gantry room or the Edison cart [P 8; H 8] | Our own target sizes; a manufacturer's model can replace ours later by keeping the node names [ND 3] |
| The Quest budget | Culling by area, overview proxies, painted camera views, shared canvases, the budget test |
| The MR-Linac vault size is unknown | The C5 report confirms it; the fallback takes 2 m from `atPrep` |

---

## Done

- Created `docs/research/cancer-centre-plan.md` (this file).
- No code changed, no contract file touched, nothing committed, no browser and no npm.
- The owner's three decisions (2026-11-01) are recorded in sections 0 and 1, and the waves C0-C7 are ready for approval (section 8).

## How to verify

- Read sections 1, 2.3 and 8, and check that the decisions match the owner's answers: proton wing, histotripsy first, MR-Linac after the two.
- Check the repository facts the plan rests on:

```bash
grep -n "LEVEL2_SPLIT_X\|LEVEL2_DX" src/sim/levels.ts
```

```bash
grep -n "export const PLINTH" src/scene/landscape/exterior.ts
```

```bash
grep -c "atHall\|atHisto" src/sim/places.ts
```

  The last command prints 0, because the annex is not built yet.

- Check the copy rules the scripts must pass:

```bash
grep -n "GRAPHIC_WORDS\|US_WORDS\|MACHINE_CHECK\|UNITS" src/content/procedures.ts
```

## Change requests

Every item in section 3 goes to the main session, which owns the contract files. **The first batch (wave C0):**
1. **`types.ts`:**
   - `ProcMachine` += `histotripsy`, `protonGantry`;
   - `ProcedureId` += the four script ids;
   - the new `ProcRole`, `ProcAction`, `ToolKind`, `ProcAnchor`, `ProcTarget` and `FocusId` members;
   - `PatientPosition` += `lateralRightUp`; `PatientPoseView` += `mask` (and a table flex); `Airway` += `laryngealMask`;
   - the shapes of `HistoRoomView` and `ProtonRoomView`;
   - `SeatKind` and `SimEventType` additions.
2. **`places.ts`:**
   - the annex areas and doors [ND 6], **without** `atRt`, `atRtControl`, `atPlant` and `atFlex`;
   - the seven proton wing areas and six doors (section 2.3), and `atLinac` and `atLinacControl`;
   - `ANNEX` with the roof heights; `ceilingHeight`;
   - the `HISTO_SUITE` and `PROTON_SUITE` spot tables;
   - `VIEW` (or an annex preset), `SIGNS`, the minimap.
3. **`levels.ts`:** `LEVEL2_SPLIT_X` 70 to 79.
4. **`config.ts`:** the `CONFIG.histotripsy` and `CONFIG.proton` blocks.
5. **`frameOrder.ts`:** the `histoRig`, `histoScreens`, `protonRig` and `protonScreens` priorities.
6. **Registries:** the console seats, the new seats, the fx lamps and sounds, the warm-up gates.

**Later batches:** `mrLinac` (C5), `chemoChair` and `CHEMO_UNIT` (C4), and the `quietB` split (C6).

## Open questions / risks

1. **Overview framing:** widen the default `VIEW` to include the annex, or keep today's default and add an "Annex" preset? (I would widen it: the annex is now the hospital's specialty.)
2. **The gantry drum in the cut-away overview:** show it whole as an exhibit, or cut it at 1.3 m like the walls? I would decide from screenshots of both.
3. **The two lounges:** may the ward A family lounge become the chemotherapy day unit, and the ward B quiet room the clinic and tumour board? Visitor overflow then moves to the atrium and the annex hall.
4. **X1 and Akalux:** cards only, or should one return later (X1 as a skin of the MR-Linac vault; Akalux in a procedure room)?
5. **The name:** "The Ideal Hospital Cancer Centre", or a new name for the signs and the lobby directory?
6. **Kidney histotripsy in the living day:** play it as a seeded "trial case" with its label, or keep it to watch mode only?
7. **Risks:** listed in section 11. The largest are the collision with R5's files, the one Blender slot, and the overview look of the tall block.
