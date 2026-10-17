# Plan: a much more realistic hospital, starting with live MRI, CT, X-ray and ultrasound

## Context
You want the hospital to feel real. Example: you click into the MRI room while a patient is being scanned, and you *see the scan happen*. The table slides into the bore, the technologist works the console behind the glass, the machine knocks and hums, and the images build up slice by slice. The same goes for CT, X-ray and ultrasound.

After imaging you asked for three more realism areas:
- live patient monitors
- an operating theatre
- a lab that actually runs

**Where we are:** M0–M3 are done.
- Medicine robots, the building, about 100 people at the busy hour.
- 401 tests pass; the busy-hour frame work is about 2 ms.
- Today "Lab & imaging" is one 12 × 24 m hall with a lab counter, one generic scanner prop and two blood-draw chairs. ER "tests" only means sitting in a blood-draw chair.

**Your choices:**
- Click a room → the camera flies in and a side panel opens.
- Images are simulated but realistic-looking, labelled "Simulated, not real patient data". No real scans: the project uses synthetic data only.
- MRI, CT, ultrasound **and X-ray**, with **scanner sounds** and **scheduled outpatients**, so a scan is almost always running.
- Then live monitors, an OR and the lab.

This is three realism waves:
- **R1 Imaging** (this plan, in detail)
- **R2 Surgery & Lab wing**
- **R3 Live monitors**

R2 and R3 are outlined here and get their own detailed brief when R1 is done.

---

## R1: the imaging suite (what you'll see)

**Floor plan.** The command center gives up 6 m: it becomes x −22…−12, 10 m wide, with the video wall moved with it. The imaging block becomes x −40…−22 by z −12…12 (18 × 24 m):
```
            x=-40                 -31                  -22
   z=-12 ┌──────────────────────┬────────────────────┐
         │   MRI scan room      │   CT scan room     │   magnet / CT gantry, table, laser lines
         │   (zone IV, 7.5 m)   │                    │
   z=-4.5├──────[window]────────┼─────[window]───────┤
         │   MRI control room   │   CT control room  │   radiographer at the console, live images on the monitors
   z=-2  ├──door───────────────────────door──────────┤
  spine ▶│   imaging corridor + waiting seats (4 m)  │   entered from the existing spine door at (-40, 0)
   z=+2  ├──door────────door──────────door───────────┤
         │ X-ray room │ Ultrasound  │ Changing +     │   X-ray: ceiling tube on rails, wall detector, lead-glass booth
         │ + booth    │ room        │ blood draw     │   US: couch, cart, sonographer with probe
   z=+12 └────────────┴─────────────┴────────────────┘
```
- All the new doors are west of the robot lanes' end (x = −28.3) or on the spine, so no new robot crossings.
- The command-center doors move to x = −17, still on the inner lane.
- The crossing-zone code is changed to derive the command zone from `DOORS`, not a hard-coded x.

**The machines** (procedural, like the rest of the building):

| Machine | What it looks like and how it moves |
|---|---|
| **MRI** | A big rounded white magnet with a 0.7 m bore, a blue LED ring and a padded table with a head or knee coil. The table slides the patient into the bore. A "zone IV" floor marking, warning signs, and a door that stays closed during the scan. |
| **CT** | A slimmer ring gantry with a visible rotor. It spins up, about 2 turns per second when visual, during acquisition. The table steps or glides through, with red laser positioning lines while setting up. |
| **X-ray** | A ceiling tube on rails that moves over the table or to the wall detector, a collimator light square on the body, and a lead-glass booth. The radiographer steps behind the booth to expose; there is a short "exposure" light. |
| **Ultrasound** | A couch and a cart with a monitor. The sonographer sits on a stool and moves the probe over the abdomen or neck: a hand animation driven by the scan phase. |

**The scan process** (real steps, demo-friendly timing):
1. **MRI** (about 12–18 min)
   1. Change into a gown in a cubicle.
   2. MRI safety check ("metal screening ✓").
   3. Positioning with a coil and ear protection.
   4. The table goes in.
   5. Sequences run, for example lumbar spine: localiser → T2 sagittal → T1 sagittal → T2 axial; brain: T1, T2, FLAIR, diffusion.
   6. The table comes out and the patient leaves.
2. **CT** (about 4–8 min, mostly positioning)
   1. Scout (topogram).
   2. A helical acquisition of about 10 s.
   3. Contrast phases for an abdomen: arterial, then portal venous.
3. **X-ray** (about 3–5 min)
   1. Two views (AP and lateral), with the radiographer stepping out for each exposure.
4. **Ultrasound** (about 10–15 min)
   1. Gel.
   2. Live sweeps through standard views: liver, gallbladder, kidneys or other.
   3. Image captures.
5. **Then the report:** images are "sent", and a little later a *"Report ready"* event appears. This is a concept touch: an AI pre-read confirmed by a radiologist. The ER doctor then makes the decision.

**Who scans whom.** Each ER reason gets a plausible test:
- twisted ankle or fall on the wrist → **X-ray**
- severe headache, confusion after a fall or one-sided weakness → **CT head** (MRI brain later for some)
- back pain with leg symptoms → **MRI lumbar spine**
- severe abdominal pain → **ultrasound** or **CT abdomen**
- fever or chest pain → **blood tests**, at the draw chair as today

**Outpatients:** synthetic people booked for scans all day. They arrive at the entrance, check in, sit in the imaging waiting area, are scanned and go home. The four scanners stay busy about 60–80 % of the day.

**Entering a room** (the start of M4's camera work):
- Click any room (the floor under the cursor → `areaAt`), or use a **"Go to…"** menu, and the camera **flies in** to a preset shot for that room. Esc returns to the overview.
- A **Room panel** opens on the right. For imaging rooms it is the **Scan viewer**:
  - the big live image building up slice by slice
  - the series thumbnails
  - the modality, body part and sequence name
  - a progress bar with time left
  - the patient (synthetic) and the technologist
  - "Simulated image, not real patient data"
- The **control-room monitors in 3D** show the same live image, as a shared canvas texture.
- A **"Start a scan now"** button in the panel brings in an outpatient for that scanner straight away, so the demo moment is guaranteed.
- Other rooms get a simple panel for now (who is there, what's happening). R2 and R3 fill those in.

**The images** (generated live in code, offline, deterministic per patient and series):
- **MRI:**
  - grayscale anatomical cross-sections of the brain (skull, grey and white matter, ventricles), the lumbar spine (vertebrae, discs, cord, CSF) and the knee
  - T1/T2/FLAIR contrast rules: fluid dark in T1, bright in T2
  - Rician-style noise; slices change smoothly through the volume
- **CT:** head, chest and abdomen axial slices with real windowing (bone bright, air black, lungs with vessels, liver, kidneys and spine).
- **X-ray:** ankle, wrist or chest radiographs, with bones bright on a dark background and soft-tissue gradients.
- **Ultrasound:** a live sector "fan" with moving speckle, anechoic structures (gallbladder, bladder, vessels), depth markers, and a picture that shifts as the probe moves.
- Built as canvas-2D generators (shapes + gradients + blur + a noise layer), about 384 px, redrawn at about 10 Hz **only while you're in that room**. Otherwise the in-world monitor updates at 1 Hz.

**Sounds** (Web Audio, synthesized, no files):
- MRI: rhythmic gradient knocking and buzzing that changes with each sequence, plus the helium-pump hum.
- CT: the rotor whir rising and falling.
- X-ray: the exposure beep.
- They play only while you're in that room and the machine is running. There is a mute toggle, audio starts after your first click (browser rule), and it suspends when the tab is hidden.

---

## How R1 is built (agents, ownership, budgets)

**I (Opus) own the contract and the integration:**
- `src/sim/places.ts`: the new areas and doors, the command-center move, and the anchors for scanners and consoles.
- `src/sim/types.ts`:
  - `ImagingModality = 'mri' | 'ct' | 'xray' | 'us'`
  - the `Scanner` state (`idle | prep | positioning | tableIn | scanning | tableOut | cleanup`, with `tablePos` 0–1, `rotor`, `sequence`, `progress`, `remaining`)
  - roles `radiographer` and `sonographer`
  - seat kinds `scanTable`, `usCouch`, `xrayTable`, `drawChair`
  - events `scanStarted`, `scanSequence`, `scanDone`, `reportReady`, `outpatientArrived`
- `src/sim/config.ts`: timings.
- The crossing-zone change in `src/sim/meds/circuit.ts`.
- Mounting everything in `World`, the HUD and `App`.
- Reviewing the work and taking screenshots.

**Agents** (at most 3 at once; each runs targeted tests while working and the full suite once at the end; no leftover processes):

| Agent | Model | Owns | Builds |
|---|---|---|---|
| Content | haiku | `src/content/imaging.json`, `outpatients.json`, the staff additions | Protocols (modality × body part → sequences with durations); a test per ER reason; 40 synthetic outpatient appointments; 3 radiographers and 1 sonographer |
| Imaging building | sonnet | `src/scene/rooms/imaging.ts` (replaces `diagnostics.ts`), the command-center layout move | The rooms, glass windows, doors, consoles, changing cubicles, waiting seats and seat exports. The static parts of the machines are merged. |
| Imaging sim | sonnet | `src/sim/imaging/**`, wiring in `people.ts` / `Simulation.ts` / `er/patient.ts` / `er/porter.ts` | Scanner state machines; per-modality booking queues (ER requests + outpatients); radiographer and sonographer behaviour; the outpatient flow; porter trips to imaging; moving the patient with the table; `startDemoScan(modality)`; node tests |
| Machines & images | sonnet | `src/scene/imaging/**` | The animated machines (MRI table, CT rotor and lasers, X-ray tube and collimator, US probe hand), the procedural scan-image generators and the shared canvas textures |
| Room focus & panel | sonnet | `src/scene/camera/roomFocus.ts`, `src/ui/RoomPanel.tsx`, `src/ui/ScanViewer.tsx`, `src/ui/GoToMenu.tsx` | Click-a-room plus the "Go to…" menu, the camera flights, the panel, the Scan viewer and the Start-a-scan button |
| Sounds | haiku | `src/audio/scanners.ts` | The Web Audio MRI/CT/X-ray sounds with a mute toggle and power-aware suspend |

**Order:**
1. Me: the contract.
2. In parallel: content (haiku), the imaging building (sonnet) and the imaging sim (sonnet).
3. Then the machines & images agent and the room-focus agent (both sonnet).
4. Sounds (haiku) last.

**Budgets** (the demo must still never stutter):
- R1 adds ≤ 25 draw calls and ≤ 120k triangles.
- Scan-image drawing costs ≤ 1.5 ms when it updates, only in the focused room.
- The busy-hour frame work stays ≤ 4 ms p95; it is about 2 ms today.

**Clinical plausibility:** the protocols, the ER-reason→test mapping and the image look get a review pass, so a doctor watching sees nothing odd. For example, no MRI for an ankle sprain, and CT for head trauma.

---

## R2 and R3 (outline: detailed briefs after R1)
- **R2: the Surgery & Lab wing.**
  - A new **east wing** at x 40…62 (the building becomes symmetric about x = 0), joined to both ward corridors and the atrium. It holds:
    - **2 operating theatres** (surgical lights, anaesthesia machine, team in scrubs and caps; a non-graphic, draped procedure)
    - a scrub room and **recovery bays**
    - the **central lab**: analysers with sample racks moving, and a **pneumatic-tube station** that samples arrive through
  - Scheduled surgeries: the porter brings the patient from the lifts, through pre-op, the OR and recovery.
  - Blood samples travel from the ER and the wards by tube, results appear and doctors act on them.
  - The plinth, the camera framing and the shadow box all grow.
- **R3: live patient monitors.**
  - Bedside monitors in ward rooms, ER bays, recovery and the OR, with moving ECG, SpO₂ and arterial-pressure waveforms and numbers from a per-patient synthetic vitals model (slow, plausible drift).
  - In 3D they are small screens; in the Room panel they appear as a large live monitor.
  - Nurses glance at them during rounds.
  - Drawn on one shared atlas, updated at full rate only for the focused room.

---

## Verification (R1)
- **Node tests:**
  - every scan finishes and every outpatient goes home
  - no scanner or seat is double-booked
  - ER patients sent to imaging finish the pathway
  - modality choice follows the mapping
  - the table position and the patient stay together
  - `startDemoScan` starts within 30 s
  - the image generators are deterministic and non-empty (pure geometry functions)
  - the existing 401 tests stay green, including the whole-morning gate and the medicine story
- **Browser** (`?probe=1`, built-in pane):
  - fly into the MRI room during a scan: screenshot the 3D (table in the bore, tech at the console) and the Scan viewer building up
  - the same for CT (rotor spinning), X-ray (exposure) and ultrasound (live fan)
  - no console errors
  - draw calls, triangles and frame-work ms within the budgets
- **You:** one play-test. Click into each scanner room and listen to the sounds; the Start-a-scan button guarantees a scan.
