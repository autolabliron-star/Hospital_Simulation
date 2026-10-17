# Plan: L1 "Living day & bed flow": beds that turn over, a real daily rhythm and meal robots

**Status:** approved with the defaults below on 2026-10-16. The contract work starts once R1 imaging and the staff door-dwell fix have landed.

## Context
Today the hospital is alive but frozen in one morning:
- The 16 ward patients never leave. Their rooms are fixed in `patients.json` (`patientInRoom`).
- Admitted ER patients (about 23 % of walk-ins) fade out at the lift "to a ward upstairs". Wards A and B never receive anyone.
- The day only covers about 07:30–13:30. Arrivals stop at 12:15 and visitors at 13:30. There are no shifts, no handovers, no meals and no night.
- Robots carry only medicine.

A real hospital runs on two loops: **the bed** (discharge → clean → assign → admit) and **the clock** (handover → breakfast → rounds → discharges → lunch → visiting → dinner → handover → night). L1 adds both, plus **MealBots**: the same robot idea as the MedPods, now carrying meals.

**Where we are:** M0–M3 done, R1 imaging in progress (machines & images agent running). M4/M5 (tour, follow camera, minimap, warm-up, quality ladder, presentation mode) are still to do. L1 does not depend on them. The tour should gain L1 beats when M4 is built.

**Defaults I chose (change any of them when you review):**
- The demo still starts at **07:30** by default, so the medicine story and the existing tests are unchanged. A new **"Jump to…"** menu moves the clock to a moment of the day.
- MealBots drive in the **people corridor**, not on the MedPod lanes, so medicine traffic is never slowed by meals.
- Admissions go to ward A or B **only when a bed is ready or nearly ready**. Otherwise the patient goes "to a ward upstairs", as today, so the ER can never jam.
- Discharges are **planned in the content** (a synthetic day plan). The sim makes no clinical decisions: a doctor "signs" a discharge that was already planned.
- New role: **ward host**, the hospitality staff member who serves meals with the MealBot.

---

## 1. What you'll see

### Bed flow
Each of the 16 rooms has a visible bed state, on the corridor door tile, on the bedside screen and on the command wall:

| State | Door tile | What is happening |
|---|---|---|
| `occupied` | white | A patient lives here |
| `dischargeSigned` | soft blue | The doctor signed today's planned discharge on rounds |
| `leaving` | soft blue, pulsing | Take-home medicines, family arriving, changing, walking out |
| `needsCleaning` | amber | Empty, waiting for a cleaner |
| `cleaning` | amber, pulsing | Cleaner with cart inside the room; porter brings fresh linen |
| `ready` | green | Clean bed, made up, screen says "Ready for the next patient" |
| `reserved` | teal | Assigned to a named patient who is on the way |

**A discharge, step by step** (about 5–6 per day, spread 10:00–16:00, at least 2 before 11:00: "discharge before noon" is an ideal-hospital target):
1. On rounds the doctor signs the planned discharge. *"Dr. Mendes signed Grace Adeyemi's discharge from A5."*
2. **Take-home medicines** are a MedPod order (source `discharge`) through the same pipeline: verify, pick, pod, drawer. The nurse explains them at the bedside (talk, about 40 s) and hands over a take-home bag. This is the hero idea again: the medicines come to the patient, even for going home.
3. Family arrives: a visitor party flagged `collecting`. The patient goes into the bathroom pod (fade at its door), comes out in everyday clothes and leaves with the family. Older or less mobile patients (a content flag) leave by wheelchair with a porter. *"Grace Adeyemi went home after 4 days."*
4. The room goes `needsCleaning`. A cleaner gets a **room-clean job** (after ER bays in priority), cleans inside for about 6–9 min, and a porter brings a linen cart. *"Room A5 is clean and ready."*

**An admission, step by step:**
1. An ER patient is admitted. The **coordinator in the command center becomes the bed manager**: she assigns a `ready` bed, or a bed that will be ready within 20 min (`reserved`, with the patient **boarding** in the ER bay, a visible timer). If neither exists, or 2 bays are already boarding, it falls back to "a ward upstairs" as today. *"Bed A5 assigned to Leo Park (ER bay 2)."*
2. A porter takes the patient by stretcher from the ER bay along the spine and the ward corridor into the room, and slides them into the bed (0.8 s transfer, never a pop).
3. A ward nurse does the admission check (wristband + tablet, about 60 s). The bedside screen changes to the new synthetic name and today's plan. *"Nurse Ava admitted Leo Park to A5."*
4. The ward doctor sees the new patient on the next round, and the first order sends the first pod to that room.

### The daily rhythm
| Time | What happens |
|---|---|
| 06:30–07:30 | Night calm ends; café opens at 07:00 |
| 07:00 | **Shift handover**: day nurses arrive by the entrance, go through the staff room, huddle at the nurse hub with the night nurses, then do a **bedside handover**: two nurses at each bed, with the patient, for about 20 s. The night nurses leave by the entrance |
| 07:30 | Demo default start. A 4-min **safety huddle** at each nurse hub (nurses and coordinator; doctors start rounds) |
| 07:45–08:30 | **Breakfast** (MealBots) |
| 08:00–11:00 | Ward rounds (as today), outpatient imaging, ER morning ramp |
| 10:00–16:00 | Discharges and admissions |
| 12:00, 18:00, 22:00 | **Scheduled dose waves**: 30 min before each dose time, an order for each occupied room's regular medicines. Pods stream out of the core in a visible wave |
| 12:00–12:45 | **Lunch** (MealBots); café and staff room busiest |
| 13:00–14:00 | **Quiet hour**: room lights soften, few visitors, calmer lobby |
| 14:00–20:00 | Visiting, peak 15:00–19:00 |
| 17:30–18:15 | **Dinner** (MealBots) |
| 19:00 | **Evening handover** (as at 07:00) |
| 20:30 | Visitors leave; at most one overnight companion per ward |
| 22:00–06:30 | **Night**: circadian lighting, one nurse per ward, a doctor on call for both wards, quiet nurse checks every 2 h (a 5 s look in from just inside each door), cleaners deep-clean the lobby and atrium, the ER runs at night rates, pods still deliver the 22:00 doses |

- **ER arrivals** follow a full-day curve: low at night, morning ramp, **evening peak 18:00–22:00**. Ambulances arrive all day.
- **Imaging outpatients** run 08:00–17:00 (the R1 appointments are extended into the afternoon).
- **Staff breaks**: idle staff take short coffee or lunch breaks in the staff room or café, never while a dose they own is due.

### MealBots
- 2 per ward plus 1 spare (≤ 6). Each is a white rounded cart robot about 0.7 × 1.1 × 1.25 m with a tray cabinet (8 shelves) behind a sliding door. It has the same light-ring language as the pods, with a **warm peach** accent so viewers never confuse meals with medicine.
- Patients chose their meal earlier on the bedside screen ("Lunch: chosen at 09:40"). Menus are a fixed demo list in `src/content/meals.json`, with no diet logic.
- **A meal run:**
  1. The bot comes up the service lift from the kitchen downstairs and fades in at the lift door, like admissions fade out today.
  2. It drives the spine and the ward corridor at about 0.8 m/s, keeping right and yielding to people.
  3. It stops at **meal stops** on the corridor centre line between two doors, never inside a crossing zone or doorway.
  4. The **ward host** walking with it takes a tray (`prop: 'tray'`) into each room and sets it on the over-bed table (a visible tray). The patient **reclines** (bed head raised) and gets a meal emote.
  5. About 40 min later a **collection run** takes the trays back down.
- Empty rooms and patients who are away (scan, discharge) are skipped. Nurses never serve meals, so medicine always comes first.

### Night and day light
- Sun colour and intensity, the sky/environment tint and the window glass follow a pure `lightAt(hour)`. **The sun direction stays fixed, so the baked building shadow stays valid and is never re-rendered.**
- Room ceiling panels go warm and dim at night. The corridors switch to low floor-level night lights, using emissive materials, not real lights. Bedside screens dim.
- Lighting updates at 1 Hz, lerped. No new lights, no shadow re-render, no material recompiles (only uniforms change).

### The show
- **"Jump to…"** (key `J`, and `?start=HH:MM`): 07:00 Handover · 07:45 Breakfast · 09:00 Rounds · 10:30 Discharges · 12:00 Lunch & dose wave · 15:00 Visiting · 18:00 Dinner · 19:00 Handover · 22:30 Night. The jump fades out for about 1 s, rebuilds the sim at that hour with the same seed (a warm start, see §2), and fades in.
- **Command wall "Beds" panel**: 16 tiles by state, boarding timers, today's discharges (and how many before noon), admissions, and a "predicted discharges today" line from the day plan (labelled *simulated*).
- **KPI card** additions: beds occupied/ready, discharges before noon, ER boarding (count and longest wait), meals served on time.
- **Room panel for ward rooms**: patient (synthetic), day of stay, today's plan (doses, meals, discharge), bed state.

---

## 2. How it's built

### Warm start (the key piece; Opus)
- `new Simulation(seed, { startHour })`. Each subsystem gets `warmStart(hour)` and places itself in a plausible mid-day state:
  - the staff of that shift at their posts
  - inpatients in bed according to the **bed book** at that hour
  - visitors already mid-visit
  - the ER partly filled
  - MealBots and trays in the right phase
- Then a hidden **pre-roll of about 60 sim s** behind the fade settles everyone (≤ 1.5 s wall time).
- `(seed, startHour)` gives an identical event log. Warm start is a plausible state, not a replay of the morning.
- **The bed book** (`src/sim/beds/bedBook.ts`, the pattern of `population/visitBook.ts`) is a pure function of the seed and the content:
  - which inpatients go home today and when
  - the pool of synthetic admission profiles
  - which rooms a warm start at hour H shows as discharged, cleaned or re-occupied
- Live ER admissions are dynamic on top of it.
- The default 07:30 start uses no warm start, so the existing tests and the medicine story are untouched.

### Contract changes (Opus, before any agent starts)
- `src/sim/types.ts`:
  - `Role` + `'host'`
  - `Order.source` + `'schedule' | 'discharge'`
  - `BedState` (the 7 states above)
  - `MealKind = 'breakfast' | 'lunch' | 'dinner'`
  - `RoomMeal = 'none' | 'served' | 'eaten'`
  - a `MealBot` interface (id, ward, position, heading, speed, state `offsite | toWard | serving | collecting | returning`, light, trays, fade, waitingFor)
  - `SeatPose` + `'recline'`
  - `Emote` + `'meal'`
  - `KeyMap.jump = 'KeyJ'`
  - events `dischargeSigned`, `wentHome`, `roomCleaned`, `bedAssigned`, `patientBoarding`, `admittedToWard`, `shiftHandover`, `mealServed`, `trayCollected`, `doseWave`
- `src/sim/places.ts`:
  - service-lift arrival spots for MealBots
  - one **meal stop** per pair of rooms, checked against the crossing rects
  - two bedside handover spots inside each room (`HANDOVER`), so a handover never stands in a zone or doorway
  - staff-room locker spots
  - a night-check spot just inside each door
- `src/sim/config.ts`: a `day` section (shift times, handover and huddle seconds, quiet hour, night staffing), `beds` (clean seconds, boarding limit 2 bays / 30 min, reserve window 20 min), `meals` (times, bot speed, serve seconds, collect delay), `doseWaves` (hours, lead time), and every arrival curve extended to 06:30–23:30.
- The medication core (`src/sim/meds/system.ts`): the `schedule` and `discharge` order sources, and the rule that a drawer only ever holds the **current occupant's** packs (an order for a patient who has left is cancelled before picking).

### Agents (at most 2 heavy at once; each runs targeted tests while working and the full suite once at the end; no leftover processes)
| Agent | Model | Owns | Builds |
|---|---|---|---|
| Content | haiku | `src/content/patients.json` (stay plans), `admissions.json`, `meals.json`, `staff.ts` shifts, `day.json` (Jump moments, event sentences) | Each of the 16 starting inpatients gets a `stay` (`goingHome` at an hour, or `staying`) and a `leavesBy` (`walk` or `wheelchair`). About 24 synthetic admission profiles keyed by ER reason (name pool, age, reason, usual meds from the catalogue). 3 meals × 6 dishes. Night nurses, 2 ward hosts, an on-call doctor. All with zod schemas |
| Bed flow | sonnet | `src/sim/beds/**`; wiring in `people.ts` (dynamic `Patient`, rounds over current occupants, nurse admission check and discharge teaching), `er/patient.ts` + `er/porter.ts` (admit to a room), `er/cleaner.ts` (room-clean jobs), `population/visitBook.ts` (visit current occupants; collecting families) | Bed board + bed manager, discharge machine (xstate), admission flow, boarding with the upstairs fallback, bed book, `warmStart` for beds; node tests |
| Day rhythm | sonnet | `src/sim/day/**`; edits in `population/schedule.ts`, `director.ts`, `ambient.ts`, `staffing.ts` | Shift roster, staff arriving and leaving via the staff room, handovers and huddles (always ≥ 1 nurse on each ward), quiet hour, night checks, breaks, full-day curves, dose-wave trigger (calls the meds API), `warmStart` for people; node tests |
| Meals | sonnet | `src/sim/meals/**` | MealBot movers on the people nav graph (wide, slow, crowd-aware, never on robot lanes or robot doors), meal runs and collection runs, ward host behaviour, room meal state, patient recline at meals and with visitors, `warmStart`; node tests |
| Look | sonnet | `src/scene/meals/**`, `src/scene/daylight/**`, door tiles and bedside screens in `src/scene/building/render/screens.ts`, tray + backrest props | Instanced MealBot mesh (≤ 6) and trays (16), instanced bed backrests that tilt with recline, `lightAt(hour)` driving the sun, environment, glass and emissive uniforms, host outfit + meal emote cell, bedside screens and door tiles redrawn **only when the occupant or state changes** |
| HUD & wall | sonnet | `src/ui/JumpMenu.tsx`, `src/ui/RoomPanel.tsx` ward section, KPI card additions, `src/scene/building/render/commandWall.ts` Beds panel | Jump menu + `?start=`, the fade during a jump, the Beds panel (≤ 2 Hz, on change), KPI additions from the event log |

**Order:**
1. Me: contract, the warm-start skeleton in `Simulation`, and the meds changes (`schedule`/`discharge` sources, occupant-only drawers).
2. In parallel: content (haiku), bed flow (sonnet) and day rhythm (sonnet).
3. Then meals (sonnet) and look (sonnet).
4. Then HUD & wall (sonnet).
5. Me: integration in `World`, `App` and the HUD, review, gates and screenshots.

### Budgets (the demo must still never stutter)
- L1 adds ≤ 12 draw calls and ≤ 60k triangles at the default view (MealBots, trays, backrests, door tiles).
- Sim step ≤ 0.6 ms with the full population at the busiest hour, now including the 18:00–20:00 overlap of dinner, visiting peak, ER evening peak and handover.
- Lighting: uniforms only, 1 Hz; zero shadow-map re-renders after mount.
- Canvases (bedside screens, door tiles, Beds panel) redraw only on change, ≤ 2 Hz.
- A jump (rebuild + pre-roll) ≤ 1.5 s, hidden behind the fade; no shader compiles during it.

---

## 3. Verification
- **Node tests** (each from a warm start, windows ≤ 2 h sim, the whole L1 set ≤ 90 s with `--maxWorkers=2`; an opt-in full-day soak `npm run soak` stays out of the default suite):
  - Determinism: the same `(seed, startHour)` gives an identical event log, for every Jump moment.
  - Beds:
    - every planned discharge ends with the patient gone home
    - every assigned bed receives its patient
    - no room is ever assigned twice
    - a room is always cleaned before reuse
    - no doctor rounds order goes to an empty room or to a patient who has left
    - a drawer only ever holds the current occupant's packs
    - boarding never exceeds 2 bays or 30 min (otherwise upstairs)
    - every ER patient still reaches a terminal state
  - Meals:
    - every occupied room gets each meal inside its window, and every tray is collected
    - MealBots never enter a robot lane, a robot door, a crossing zone or a doorway while stopped
    - no MealBot–person overlap (< 0.4 m)
  - Shifts:
    - every ward has ≥ 1 nurse present at all times, including during handover
    - every handover pair meets
    - every staff member who arrives also leaves
  - Medicines: the existing `Simulation.test.ts` and `src/sim/meds/*` tests stay green; every dose-wave order reaches `given`.
  - Light: `lightAt` is continuous and darker at night; a grep test shows the shadow map is only re-rendered at mount.
  - The existing suite stays green (512 tests today; the seat double-booking fix is in a separate session).
- **Browser** (`?probe=1`, built-in pane, closed afterwards):
  - Jump to 07:45: MealBots in the corridor, trays on tables, reclined patients.
  - Jump to 10:30: a family walking a patient out, a cleaner in a room, a green "ready" tile, the Beds panel.
  - Jump to 19:00: handover pairs at the doors.
  - Jump to 22:30: night lighting.
  - No console errors; draw calls, triangles and frame time within budget.
- **You:** one play-test. Watch one bed go round the whole loop: discharge → clean → ready → assigned → admitted, about 40 sim min at 4×.

## Open questions for you
1. Is "ward host" the right name for the meal role (other options: "meal assistant", "hospitality")?
2. Should the bedside screen show the patient choosing their meal (a short tap animation), or only the result?
3. Do you want ER boarding to be visible as a problem (a red timer on the wall when it passes 20 min)? It is a strong "aha" in demos, but it shows the hospital under strain.
