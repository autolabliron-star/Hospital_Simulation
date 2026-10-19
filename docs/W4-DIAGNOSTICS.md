# W4 "Smart diagnostics": entrance health kiosks, robot blood draws and an automated lab

## Context
You asked me to research the automatic machines that do blood tests, and the self-service kiosks at the entrances of Chinese hospitals that measure blood pressure and other vital signs, before building them.

**What the hospital has today:**
- **Two check-in kiosks** in the lobby. They measure nothing.
- **A "Blood draw" room** with two plain chairs: a patient sits for 60–90 s and nobody draws anything.
- **Results are a timer:** 120–240 s after the "draw", a result just appears.
- **No vital-signs data** (the triage monitors show a fixed picture), **no samples, no lab, and no lab staff**.

**Your choices:**
- **Build:** two entrance health kiosks, a smart blood-draw centre, and an automated lab with an overhead sample tube.
- **Who draws blood:** robots only. One supervising nurse covers up to 3 robots and does the manual draw for the ~6% of patients with no suitable vein.
- **Where the lab goes:** a compact lab next door, split from the ward-B supply room and fed by an overhead pneumatic tube.

## What the research found (the numbers the build uses)

**Entrance health stations (China 健康一体机 / 智能健康小屋)**

| Step | What happens |
|---|---|
| Log in | ID card, insurance card or WeChat QR |
| Height and weight | Stand on the platform; an ultrasonic sensor above the head measures height |
| Body fat | Grip the two side handles |
| SpO2 | Finger clip |
| Blood pressure | Sit and put the arm into a tunnel cuff; about 1 min |
| Temperature | Infrared, at the forehead |
| Report | Shown on screen, printed, or sent to the phone |

- The whole session takes **3–5 min**. A station sees **20–60 sessions a day**, with a morning peak, and one attendant helps elderly users.
- **Typical tower:** about 0.6×0.6×2.3 m with a 15.6″ screen. **Larger cabin models:** 1.8×0.6×2.45 m with two screens.
- Readings taken in the waiting area are 10–30 mmHg lower than in the consulting room (the white-coat effect). The usual rule: if two readings disagree, measure again after 3 min.
- In the UK, GP "health pods" write straight into the patient's record. Passing kiosk vitals to the doctor's screen is the ideal-hospital version of that.

**Blood-draw robots**

| Robot | Approval | Time per draw | Success |
|---|---|---|---|
| MagicNurse / 迈纳士 (Zhongshan Hospital, Shanghai) | China NMPA Class III, 2019 | 205 s for 4 tubes (52 s by hand) | 94.3% over 6,016 patients |
| Vitestro Aletta | EU CE mark, FDA 2026 | median 2 min 37 s | 94.5% first stick where a vein was found |

- **Aletta also:** about 6% of patients have no suitable vein and are sent to a person; haemolysis 0.3%; one supervisor runs 3 robots.
- **How a draw goes:**
  1. Scan the card.
  2. Arm into the tunnel or cradle.
  3. A cuff tightens as the tourniquet.
  4. Alcohol spray.
  5. Near-infrared and ultrasound find the vein.
  6. A hidden 21G needle goes in.
  7. The tubes fill in turn, each tipped 6–9 times to mix.
  8. Needle out, bandage on.
- If the arm moves during the draw, the needle detaches and staff are alerted.

**Smart blood-draw centre** (Guangdong, Taihu, Fudan Cancer)
- Workflow:
  1. Scan at the check-in kiosk and get a queue number (P for outpatients, V for priority).
  2. A big screen and a voice call send you to a station.
  3. The tube-prep machine (Techno Medica BC-ROBO, about 600×755×1180 mm) picks the right tube types, then prints and wraps the barcode labels in 10–12 s per patient.
  4. The draw.
  5. The tubes go into a pneumatic tube: single-tube, about 10 m/s, 1–3 min to the lab.
- Peak hours are 7:30–9:30.

**Automated lab** (Roche, Siemens, Abbott, Beckman, Mindray MT 8000, Sysmex)
- The line, in order:
  1. Sorter.
  2. Sample-quality camera.
  3. Centrifuge (5–10 min).
  4. Decapper.
  5. Analysers (blood count, chemistry, immunoassay).
  6. Recapper.
  7. Fridge archive at 4–8 °C.
- Tubes ride upright in pucks on a waist-high U or L conveyor.
- Turnaround times: blood count about 30 min, chemistry 40–60 min, immunoassay 60–120 min.

**Sources:**
- Robots and draw centres:
  - [MagicNurse at Zhongshan Hospital](https://pmc.ncbi.nlm.nih.gov/articles/PMC10512411/)
  - [Shanghai's first blood-draw robot](https://www.cn-healthcare.com/articlewm/20210918/content-1265348.html)
  - [Vitestro Aletta trial](https://clpmag.com/lab-essentials/lab-automation/autonomous-robotic-phlebotomy-system-multicenter-trial-results/)
  - [FDA clears the first standalone robotic blood-draw system](https://www.medscape.com/viewarticle/fda-clears-first-standalone-robotic-blood-draw-system-2026a1000xee)
  - [Techno Medica BC-ROBO](https://www.technomedica.co.jp/t01/EnglishPage/products/solution/2)
  - [Guangdong draw centre](https://m.mp.oeeee.com/a/BAAFRD000020220421674252.html)
  - [Guangdong Provincial People's Hospital draw guide](https://www.gdghospital.org.cn/OutpatientServices1/info_itemid_43226.html)
  - [Taihu County](https://www.thxyy.com/content/detail/684627312792eed279d9c2e9.html)
  - [Wenling pneumatic tube](https://pmc.ncbi.nlm.nih.gov/articles/PMC12929093/)
- Lab automation:
  - [Roche cobas](https://diagnostics.roche.com/us/en/products/systems/cobas-connection-modules-sys-364.html)
  - [Mindray MT 8000](https://www.mindray.com/en/products/laboratory-diagnostics/chemistry/large-test-volume/mt-8000)
  - [Sysmex XN-9100](https://www.sysmex.com/lab-solutions/hematology/xn-series/xn-9100)
- Health stations and blood-pressure kiosks:
  - [Health station, Nanjing](https://www.yangtse.com/news/jiangsu/nanjing/202610/t20261015_402952.html)
  - [Health stations, Shanghai](https://news.qq.com/rain/a/20231010A073FC00)
  - [Peking Union Medical College Hospital (PUMCH)](https://www.pumch.cn/detail/45038.html)
  - [Omron HBP-9020](https://www.omronhealthcare-ap.com/ph/product/92-hbp-9020/1)
  - [SiSU Health Station](https://www.sisuhealth.co.uk/the-sisu-health-station)
  - [Swansea Bay health pods](https://sbuhb.nhs.wales/news/swansea-bay-health-news/new-machines-help-patients-to-easily-monitor-their-health/)

---

## Step 0 (first, small): "stuck near walls", root cause found
**What you saw:** once the doctor touches a wall, he can't move forward or away.

**Reproduced in node with the real player system:**
- Backing away (S) from a plain corridor-A wall: **0.00 m in 2 s**.
- Approaching the triage back wall at 30°, then W: **0.00 m in 2 s**. A trolley may box this spot in, so it doesn't count as proof on its own.
- Turning away from a wall while walking: **0.65 m in 3 s** in triage, 0.80 m in 2 s in a ward room.
- Only walking parallel to a wall, or turning hard away along the corridor, works.

**Why:**
- `firstHit` (`src/scene/player/collision.ts:199`) asks the sweep functions (`sweepCircleBox`, `sweepCircleCircle` in `sweep.ts`) for the first hit.
- When the body sits at contact distance, or a hair inside it from floating-point rounding, the sweep reports a hit at **t = 0 for any motion**, including motion along the wall or away from it.
- `slidePiece` (`collision.ts:251-300`) then removes only the into-wall part. It re-sweeps from the same point, gets t = 0 again, and burns all 4 iterations without moving.
- The head-on rule in `body.ts:268` then zeroes the speed, and the body stays stuck.
- A1's slide tests started clear of the wall, so they never hit this case.

**Fix:**
- In the sweeps: at contact (start distance ≤ R + 1e-6), report a hit only if the motion goes into the surface (motion·n < −1e-9·|motion|). Motion along or away from it is free.
- After each hit, place the body at R + 1e-4 along the normal, so the next sweep starts cleanly outside.
- Overlap (start inside) keeps today's "can only leave" rule.

**Regression tests** (`src/scene/player/contact.test.ts`):
- For every real wall box and solid, at 10 points along each face, start the body at distances R − 1e-9, R, R + 1e-9 and R + 1e-4.
- Moving straight away gives at least 99% progress; moving along the face at least 99%; moving at 30° into it about 50% (sin 30°), within ±2%.
- Re-run my seven trials as `PlayerSystem` tests:
  - backing away goes at least 1.8 m in 2 s;
  - turning away gives at least 1.5 m;
  - the 30° slide: at least 0.9 m in 2 s where the slide path is clear; skip the boxed-in triage spot (or assert it is a corner).
- The whole player suite stays green.

## Step 0b: the ceiling robots
- **In the simulation they work.** From 11:24, all 10 pods moved and 36 orders went prescribed → verified → en route → in drawer → given in 24 min.
- **So the problem you saw is in what's drawn, not in the logic.** I couldn't see it: the browser pane was paused or throttled while your Chrome was in front.
- **Check, with the pane in view and muted:** in walk mode at 11:30, watch a pod leave the pharmacy, run along the corridor rail and lower into a drawer chute. Screenshot it in sequence.
- **What to fix:** whatever doesn't move. Suspects:
  - the pods' frame callback;
  - the W3 lighting patch on the pod materials;
  - the walk-mode ceiling hiding the pods.

---

## W4 "Smart diagnostics": the build

**Brief:** `docs/W4-DIAGNOSTICS.md`, written from this plan.

**Layout (the orchestrator reconciles the two designs' anchors):**
- **Health kiosks:** two stations in the lobby's free south-east strip (x −54.5..−51.2, z 3.4..5.5).
  - Each tower stands against the south wall at z ≈ 5.45 with the weighing platform in front (stand spot z ≈ 4.35, facing +z).
  - A blood-pressure wing with a stool and an arm tunnel sits beside each tower.
  - Users line up in one shared queue. The lobby walkway and the existing check-in kiosks stay as they are.
- **Robot blood-draw centre:** the existing "Blood draw" room (x −28..−22, z 2..12) gets:
  - 3 robot cabinets against the corridor wall (z ≈ 11.4), with patient chairs in front (seat ids `drawChair:robot:0..2`, facing the cabinet);
  - the tube-prep machine on the west wall;
  - a waiting bench;
  - a check-in kiosk and a queue screen by the door;
  - the MRI changing cubicles turned into real anchors (today they're made-up spots in the middle of the room).
- **Supervising nurse:** watches all three robots, carries each patient's labelled tray from the prep machine to the robot, and does the manual draw when needed (about 6%).
- **Pneumatic tube:**
  - Each robot sends its tubes up a riser into a clear overhead trunk at y = 2.85 along the room's south wall.
  - The trunk jogs into corridor B and crosses it at x = −29.9, 0.72 m or more from the pod rail's U-turn (the rule is 0.45 m).
  - It drops into the lab's receive station.
- **Compact lab:** `supplyB` shrinks to x −40..−31; the new `lab` area is x −31..−25, z 16..22, with a swing door at (−26.3, 16).
  - A one-way U track on a 0.86 m bench, with the modules on its outer side:
    1. Receive and sort.
    2. Sample-quality camera.
    3. 2 centrifuges.
    4. Decapper.
    5. Haematology analyser.
    6. Chemistry analyser.
    7. Immunoassay analyser.
    8. Coagulation analyser.
    9. Recapper.
    10. Fridge archive.
  - Plus a review terminal and a status totem.

### Contract (me, first)
- **`types.ts`:**
  - `Role` gains `'labScientist'`.
  - `SeatKind` gains `'healthSeat'` / `'kioskBp'`; `AnimState` gains `'grip' | 'finger' | 'armIn'`.
  - New events: `healthCheck`, `drawTicket`, `drawCalled`, `bloodDrawn`, `drawByNurse`, `samplesReceived`, `labResults`.
  - New state types: `VitalsReading`, `HealthKioskState`, `DrawTicket`, `DrawStationState` (phases from `cardScan` through `veinScan`/`needleIn`/`filling(tube i/n)` to `bandage`, plus `fallbackToNurse` and `armMoved`), `TubePrepState`, `Sample` (stages from `ordered` to `archived`), `LabOrder`, `LabTestResult`, `CentrifugeState`, `AnalyserState`, `LabState`.
  - The full field lists are in the sim design. All values are display-only: no flags, no decisions.
- **`places.ts`:**
  - `AreaId` gains `lab`; `AREAS` gets the lab and the smaller supplyB; the diagnostics label becomes "Blood draw centre".
  - New `DOORS` entry for the lab.
  - New anchors: `HEALTH_KIOSKS`, `HEALTH_LINE`, `HEALTH_GUIDE`, `DRAW_CENTRE` (stations, prep, check-in, screen, bench, cubicles, nurse spot), `PNEUMATIC` (trunk polyline plus each robot's riser), `LAB` (track U, modules, receiver, terminal, technician spots).
- **`config.ts`:**
  - `vitals`:
    - session parts: log-in 12-30 s, blood pressure 45-65 s per reading, two readings 60 s apart and a third after 180 s if the systolic differs by more than 10;
    - white-coat offset 0-30 mmHg;
    - walk-ups peak in the morning;
    - 35% of ER walk-ins with acuity ≥ 3 use a kiosk while waiting for triage;
    - triage is 0.8× as long for a patient who has kiosk vitals.
  - `blood`: draw steps summing to about 185-210 s for 4 tubes, between Aletta's 157 s and MagicNurse's 205 s; no-vein 6%, missed first stick 5.5%, arm moved 1.5%; manual draw 55-90 s; 3 robots per nurse; outpatients peak 07:30-09:30.
  - `lab`: tube at 8-10 m/s; centrifuge 5 min (urgent) or 7 min (routine, batched until full or 10 min); analyser speeds (a blood count about 100 per hour per analyser); 85% auto-verified; background ward samples arriving through the riser; target turnaround per analyser.
  - Every value comes with its source in a comment.
- **Content** (`src/content/lab.json` + `lab.ts`, with its own zod schema; the word "blood" is banned in some existing validators):
  - Tube kinds with cap colours and inversion counts, in CLSI order of draw.
  - Tests: CBC, BMP, CRP, creatinine, troponin, coag, lipids, HbA1c, TSH, glucose. Each analyte has a unit and a usual range, used for display only.
  - Panels for ER reasons, outpatients and pre-contrast creatinine.
  - Seeded vitals baselines by age, and event copy.
  - Copy for the kiosks and the draw centre.
  - `LAB_STAFF`, a separate list on site 24/7: 1 draw-centre nurse, 1 kiosk guide, 1-2 lab scientists. Their names go into `people.json`'s presentation lists.
- **Glue:**
  - `src/sim/samples.ts` (`SampleBook`) and frozen port interfaces (`vitals/ports.ts`, `blood/ports.ts`, `lab/ports.ts`), with no-op skeletons.
  - `Simulation.ts` construction, stepping and sync.
  - `world.ts` fields; queue ids `health` and `drawCheckIn`; nav anchors.
  - `src/sim/w4/stub.ts`: plausible cycling state, so the scene agents can work before the sim lands.
  - `frameOrder.ts` slots: `kiosks −0.24`, `drawCentre −0.23`, `lab −0.22`, `w4Screens −0.21`.
  - The `src/scene/w4kit/` status atlas: 4×4 tiles of 320×200, sharing the bedside screen program, repainted only on a version change, uploaded at most 2 Hz.
  - Instanced part pools on `MAT.tinted`.
  - `patchMaterialLook(MACHINE_BODY, 'plain')`, so the machines get the W3 light.
  - Wiring stubs in `layout/index.ts`, `registrations.ts`, `RoomPanel.tsx` and `cameraApi` shots.

### Agents (parallel, disjoint files, sonnet; copy on haiku)

| Agent | Owns | Builds |
|---|---|---|
| **V: vitals sim** | `src/sim/vitals/**` | Seeded per-person profile (height from the avatar, BMI, body fat by the Deurenberg formula, blood pressure by age, white-coat offset); the station script `login → height → weight → body fat → sit → SpO₂ → BP×2(+1) → temperature → report`; the shared line; walk-up health visitors; the guide helping the elderly; the player's session |
| **B: blood sim + ER wiring** | `src/sim/blood/**`, `er/{pathway.machine,patient,porter}.ts`, `imaging/sites.ts` | P/V tickets; the BC-ROBO prep job; the robot script with every failure branch (no vein → nurse; missed stick → retry, then nurse; arm moved → reassure and retry); outpatient blood visitors; ER blood patients (V ticket, porter wheelchair); `DRAW_DONE` and the real `REPORT_READY` replacing the fake timers, with the timer kept as a fallback; the ER kiosk detour; real cubicle anchors |
| **L: lab sim** | `src/sim/lab/**` | Orders → tubes; pneumatic flights (one tube at a time); the track with gaps and module diverts; batched centrifuges (urgent at once); decapper, analysers with aspiration slots, recapper, archive; seeded values; auto-verify, or the scientist at the terminal; background ward samples; `onOrderComplete` → the patient |
| **S1: kiosks and people** | `rooms/healthKiosks.ts`, `scene/kiosks/**`, crowd `blend.ts`/`pose.ts` (the new `grip`, `finger`, `sitArmIn` poses through the existing hand-reach IK), `interact/healthCheck.ts`, `ui/walk/HealthCard.tsx`, the lobby `KioskSection`, `audio/devices/kioskPatterns.ts` | Tower (2.06 m, 15.6″ screen, overhead ultrasonic height arm with a ping and beam, camera with IR thermometer, QR/ID reader, printer slot with the slip growing, SpO₂ clip with a pulsing LED, body-fat grips, weighing platform with LED digits, BP wing with an arm tunnel and a cuff ring going teal, amber, green, and a stool); you can use a kiosk with E and watch your own result card fill in; sounds |
| **S2: draw centre** | `rooms/bloodDraw.ts` (replacing `imaging.ts:403-479`), `scene/drawCentre/**`, `ui/DrawCentreBody.tsx`, `interact/w4/drawRegs.ts`, `audio/devices/{drawPatterns,speech}.ts` | Robot cabinet (enclosed arm tunnel with a clear top, NIR red glow on the cradle, scan-light chaser, robot head moving along the forearm, hidden needle, tourniquet ring, 2 red e-stops, status LED bar, 21″ screen with a live strip showing the NIR vein map, an ultrasound inset and needle progress at 10 Hz only in the focused room); BC-ROBO prep machine (glass hood, 8 cap-colour bins, gripper, label strip, tray); check-in kiosk with tickets; queue screen with a chime, plus a voice only from local voices; the draw-centre panel |
| **S3: lab, tube, samples** | `rooms/{lab,pneumatic}.ts`, `serviceRooms.ts` (supply room), `shell.ts` floor, `wayfinding/labels.ts`, `scene/lab/**`, `ui/LabBody.tsx`, `goToModel.ts`, `minimapModel.ts`, `audio/devices.ts` + `labPatterns.ts` + `DeviceSounds.tsx` | Clear overhead pipe with collars, clamps and hangers; the tube flying with a cap-colour trail at up to 10 m/s, with launch, whoosh and arrival sounds; the U track with instanced pucks, tubes and caps (blood turning to serum after the centrifuge); sorter gripper; camera arch flash; centrifuges with lid and rotor; decapper and recapper grippers; analysers with probes and status lights; fridge archive filling up; status screens; the lab panel (SVG track, turnaround times, samples, "Send a sample now"); minimap, Go-to and floor label |
| **Copy** (haiku) | `src/content/{healthCheck,bloodDraw,lab}.json` + zod + tests | Step prompts, units, event lines (e.g. "Robot 2 drew 4 tubes from {name}, first attempt."), the "Simulated" labels |

### Budget and rules
- **Added cost:** about 19 draw calls (kiosks 2, draw centre 7, lab 9, atlas 1) and about 118k triangles. In any one room you see about 10-12 of those calls.
- **No new shader programs after Enter.** Check with `__hospitalWarm.programs()` across a kiosk session, a draw, a tube flight, the centrifuge lid and a Jump.
- No allocations in any frame callback; each agent adds a `noAllocations` test.
- Screens repaint at most 2 Hz, or 10 Hz only for the live strip in the focused room.
- Synthetic people and values only, with "Simulated" on every panel.

### Tests (node)
- **Vitals:**
  - Same seed gives the same results.
  - Height matches the avatar within ±0.5 cm.
  - Over 200 people, triage systolic minus kiosk systolic averages 10-30 mmHg.
  - A full session takes 180-300 s.
  - The third reading appears only after a disagreement.
  - Abort frees the station; no double use; the line is first come, first served.
  - 20-90 sessions per station over 07:30-12:30.
- **Blood:**
  - 4-tube robot draw takes 150-240 s.
  - Order of draw respected; every tube drawn once.
  - Every failure branch covered.
  - Nurse share 4.5-8% over 2,000 plans.
  - In a morning run: no robot double-booked; every ticket done; every outpatient goes home; at least 60 draws by 10:30.
- **Lab:**
  - One tube in the pneumatic at a time; the route stays at least 0.45 m from the rail.
  - Pucks keep their gaps; EDTA tubes never spin; urgent samples spin at once.
  - Every sample is archived; at least 95% of results within the target turnaround.
  - Auto-verified share is 85% ± 5.
  - A constant value generator gives identical event times ("no clinical decisions").
- **Global:**
  - Determinism over 07:30-10:30.
  - The whole-morning population gate stays green.
  - Jumps to 10:30, 15:00 and 22:30 still finish every ER blood journey.
  - Layout clearances (routes 0.35 m, rail 0.45 m).
  - The budget tests.

### Risks
- **ER bays fill up.** Real results take about 18-25 min instead of the fake 2-4. The left-without-being-seen gate may fail; the fallback is a results lounge for low-acuity patients.
- **Busier hospital.** About +10 people at 10:30 and more time per step; re-baseline the gate band if needed.
- **Tight room.** The cubicle fix is required, because today's made-up cubicle spots sit where the robots go.
- **Lobby navigation.** A lobby nav node sits near the kiosks; the kiosk anchors must be added before the lattice.
- **Voice calls.** They need local voices, so the chime is the fallback.

## Verification
1. **Step 0:** the contact tests and the 7 trials, then a play-test of walking along, into and away from walls.
2. **Step 0b:** screenshots of a pod running the rail and lowering into a drawer in walk mode.
3. **W4 checks:**
   - `npm run typecheck`, `npm test`, and a build into the snapshot folder.
   - Muted browser checks with the pane in view:
     - a patient and you at a kiosk;
     - a robot draw sequence, including a nurse fallback;
     - a tube flying through the pipe;
     - the lab track running and a result arriving on the ER patient's card;
     - the probe draw-call and triangle numbers;
     - the shader count unchanged.
   - Screenshots sent to you, then your play-test, then a commit.

---

## Contract as built (orchestrator, before the agents)
- `src/sim/types.ts`: `Role` gains `labScientist`; `AnimState` gains `grip`, `finger`, `armIn`; `SeatKind` gains `kioskBp`; events `healthCheck`, `drawTicket`, `drawCalled`, `bloodDrawn`, `drawByNurse`, `samplesSent`, `samplesReceived`, `labResults`; the W4 state types at the end of the file.
- `src/sim/places.ts`: area `lab` (x −31..−25, z 16..22; `supplyB` is now x −40..−31), door `lab` (swing, (−26.3, 16), 1.4 m), `HEALTH_KIOSKS`, `HEALTH_LINE`, `HEALTH_GUIDE`, `DRAW_CENTRE`, `PNEUMATIC`, `LAB`.
- `src/sim/config.ts`: `vitals`, `blood`, `lab` blocks (sources in the comments).
- `src/content/lab.json` + `lab.ts`: tubes (order of draw), tests and analytes (display-only ranges), panels, ER reason → panel, outpatient panel weights, panel shifts, vitals baselines; `tubesFor`, `panelTests`, `erPanelFor`, `vitalsBaselineFor`.
- `src/sim/samples.ts` (`SampleBook`), `src/sim/pneumaticPath.ts` (paths per source, flight profile), `src/sim/labTrack.ts` (the closed loop, module stops).
- Frozen ports: `src/sim/vitals/ports.ts`, `src/sim/blood/ports.ts`, `src/sim/lab/ports.ts`; skeleton services in each folder's `index.ts`, built, stepped and synced by `Simulation.ts`, on `world.vitals` / `world.blood` / `world.lab`.
- Nav: the lab door and lattice (`src/sim/nav/graph.ts`).
- Scene: `FRAME_PRIORITY` `kiosks −0.24`, `drawCentre −0.23`, `lab −0.22`, `w4Screens −0.21`; the tile registry `src/scene/w4kit/tiles.ts`; stub builders `src/scene/rooms/{healthKiosks,bloodDraw,lab,pneumatic}.ts` called from the layout; stub layers mounted in `World.tsx`; `DeviceSounds` in `App.tsx`; interaction stubs `src/scene/interact/w4/*`; panel stubs `src/ui/{DrawCentreBody,LabBody,KioskSection}.tsx` routed by `RoomPanel.tsx`; camera shots for `diagnostics` and `lab`; `MACHINE_BODY` now gets the W3 light volume.
