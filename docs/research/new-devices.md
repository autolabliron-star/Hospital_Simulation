# New medical devices for The Ideal Hospital: research and delivery plan

Written 2026-10-22. Research only: no code was changed, nothing was committed. Regulatory facts are "as of October 2026" and come from the sources at the end. Each fact carries a confidence tag:

- **[V]** read in a primary or trade source during this research;
- **[C]** company claim, or a single source I could not cross-check;
- **[U]** from my background knowledge, not re-verified here. Check it before it goes into `devices.json`.

Nothing in this document is medical advice. The simulation runs scripted demos and makes no clinical decisions.

---

## 0. Summary

**What "a machine that kills cancer with lasers" most likely means.** Three real candidates, and the owner should say which one they had in mind:

1. **MRI-guided laser interstitial thermal therapy (LITT)**, for example Medtronic Visualase and Monteris NeuroBlate. A thin cooled laser fibre is placed in a tumour, and MRI shows the heat spreading live. This is the best fit for "with lasers", and it is real, cleared and in clinical use.
2. **Laser-activated photoimmunotherapy (PIT)**, Rakuten Medical's Akalux drug with the BioBlade laser. An antibody-dye drug sticks to the tumour and 690 nm red light switches it on, without heat. It is approved in Japan only (2020) and still in phase 3 elsewhere.
3. **Focal laser ablation of the prostate** (Avenda Health, Elesta, Clinical Laserthermia Systems). It is the same idea as LITT, used in urology.

Laser stories in the press that are *not* devices a hospital can buy (research on circulating tumour cells, femtosecond lasers, nanotube therapy) are left out.

**Top 8 to add first** (ranked by overall score, section 4; waves in section 5):

| Rank | Device | Maker (country) | Wave | One line |
|---|---|---|---|---|
| 1 | Visualase V2 laser ablation under MRI | Medtronic (US) | B | The owner's example: a laser fibre in a lesion, the live heat map growing on screen. |
| 2 | Exablate Neuro focused ultrasound | Insightec (Israel) | B | A helmet of 1,024 ultrasound elements treats deep brain targets through the intact skull, inside the same MR suite as #1. |
| 3 | Edison histotripsy | HistoSonics (US) | B | A robot arm over a water-coupled patient liquefies a liver tumour with a bubble cloud, no heat and no incision. |
| 4 | Swoop portable MRI | Hyperfine (US) | A | A 64 mT MRI (about 635 kg, cabinet-sized) wheeled to the bedside and plugged into a wall socket. |
| 5 | Aletta autonomous blood draw | Vitestro (Netherlands) | A | The first robot to draw blood on its own (CE 2024, FDA De Novo August 2026). Our blood-draw centre is half built for it. |
| 6 | Toumai telesurgery robot | MicroPort MedBot (China) | C | A surgeon at a console in one hospital operates on a patient in another, with the latency on screen. |
| 7 | Akalux photoimmunotherapy with the BioBlade laser | Rakuten Medical (Japan) | C | The second "laser kills cancer" reading: red light switching on a tumour-seeking drug. |
| 8 | X1 biology-guided radiotherapy | RefleXion (US) | C | A fast ring gantry that fires beams at the tumour's own PET signal, with a 0.35-0.4 s response. |

Bonus quick win, not in the top 8: **Naeotom Alpha photon-counting CT** (Siemens Healthineers, Germany). It reuses the existing CT room and sim, so it is about two days of work (a reskin and a new story).

**Where it goes.** Level 1 and Level 2 are fully allocated, so there is no free room for new departments. The atrium (28 x 24 m of garden and café) is the only large open space. The recommended answer is a new **Advanced Therapies pavilion** on the east side, built as an annex joined to the atrium's east wall (30 x 24 m, six rooms). It needs contract changes in `places.ts` (section 6). Wave A needs almost none.

**What makes the plan cheap.** One generic, content-driven **device demo engine** (`src/sim/devices`) that plays a scripted sequence for any device, plus one generic **Meet the device** tour. After the first device, a new one is mostly a Blender model with named nodes, a screen painter and a JSON entry.

---

## 1. What exists today (read-only audit)

The floor plan is `src/sim/places.ts`. The building is `x -62..40, z -22..22`. Nothing in it is unassigned.

| Zone | Rooms (AreaId) | Notes |
|---|---|---|
| West block L1 | lobby, triage (4 bays), er (6 bays), spine, liftA/B | the entrance and ER |
| Imaging hall | imagingHall, mri + mriControl, ct + ctControl, xray, ultrasound, diagnostics (blood draw, 3 robots) | one scanner per modality: `IMAGING: Record<ImagingModalityId, ScannerAnchors>` |
| Middle band | command, core (pharmacy), atrium | atrium = x 12..40, z -12..12, garden at (22,0), café at (34,3), opening doors at x=34 to both ward corridors, **no door in its east wall** |
| Wards | A and B, 8 rooms each, hubs, staffA, loungeA, supplyB, lab, quietB | lounges and quiet room: 15 x 6 m, public, lightly used |
| Level 2 | over x -62..-40 only: preOp, staff, sterile, hall, l2Or (9 x 8 m, da Vinci 5), pacu, l2Lounge (9 x 20 m) | its own sim strip, `l2(x) = x + 150` |

How a device is wired today (the pattern every new device should follow):

- **Sim.** A state machine owned by a department object. Imaging: `src/sim/imaging/scanner.ts` runs the steps `prep, positioning, tableIn, scanning, tableOut, cleanup`, with durations drawn once from the seeded `Rng` in `exam.ts` (`drawPlan`). Surgery: `src/sim/surgery/robot.ts` has pure `applyRobot(segment, t)` functions, so a warm start and a replay agree. Blood: `src/sim/blood`. Showcase placement of work already in progress goes through each service's `warmInFlight()` (docs/S1-SHOWCASE.md).
- **Scene.** A rig with pure pose maths (`motion.ts`), built from merged geometry, updated in one `useFrame` with no allocations (`scene/imaging/machines/{rig,motion}.ts`, `scene/surgery/rig.ts`, `scene/drawCentre/rig.ts`). Guard tests: `noAllocations.test.ts`.
- **Screens.** Canvas textures that redraw only when content changes and flag the texture afterwards (`scene/imaging/live.ts`, `images/screen.ts`, `drawCentre/liveTexture.ts`). The same canvas also feeds the DOM Scan viewer.
- **UI and interaction.** Room panel bodies (`ui/RoomPanel.tsx`, `OrBody.tsx`, `LabBody.tsx`), camera flights (`scene/camera/roomFocus.ts` `focusRoom`, `cameraApi.flyTo`), E interactions through `interact.store.ts` (kinds `door, seat, station, gate, prop, bedside, console, drawer`), and a seated "teaching console" mode (`scene/interact/surgery/teaching.ts`).
- **Content.** `src/content/*.json` with a zod loader (`schema.ts` helpers, a non-graphic-words check, a unique-id check, word counts), parsed at module load and covered by a test.
- **Vehicles.** The crowd already pushes carts: `VehicleKind` includes `cleaningCart` and `linenCart`, with footprints in `VEHICLE_HALF` / `VEHICLE_AHEAD`. A wheeled device can reuse this.

Free space, by suitability:

1. **East of the atrium, outside the shell.** The plinth ends at x=48 (`exterior.ts` `PLINTH`), so an annex needs the plinth extended. Best fit, no existing function lost.
2. **The atrium's east third (x 28..40).** 12 x 24 m. It holds two rooms and costs the café (`ATRIUM.cafe`). A fallback.
3. **Level 2 lounge** (9 x 20 m, `l2Lounge`): could host a second robotic OR, but its only door is from the theatre hall, so splitting it needs new doors.
4. **A basement level** (where real radiotherapy vaults sit). The best realism, but the level system hard-codes two levels (`levels.ts`). Not recommended now.

---

## 2. The long list: 27 devices

Rubric: **Sim** = effort to script its patient journey in our sim; **Model** = Blender modelling effort; **Wow** = 1-5 in a headset. Sizes are **modelling targets for our own generic model, not vendor specifications**; replace them from a datasheet before sign-off. Status is as of October 2026.

### A. Tumour destruction without open surgery

| # | Device | Maker, country | What it does | Status | Room | Look and modelling size | Demo story | Sim | Model | Wow |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Visualase V2 MRI-guided laser ablation** | Medtronic, US (Irish-domiciled plc) | A cooled laser fibre, placed through a small hole, heats tissue under live MR thermometry; the software estimates the damaged zone and can stop the laser at set temperature limits | FDA 510(k) for V2, 4 Jun 2025 (K250307): ablation of intracranial soft tissue, e.g. tumours, radiation necrosis, epileptic foci, ages 2+ [V]. Earlier versions cleared from 2008 (K081656) [V]. Thermal image refresh about every 5-7 s [V]. Laser wavelength "800-1064 nm" in the FDA summary, vendor material says 980 nm [C] | MR-guided suite | Cart about 0.6 x 0.7 x 1.3 m with laser, coolant pump and a tablet, plus a workstation in the MR control room; head holder and a thin fibre | Patient in the bore, fibre in the target, laser on: a yellow-to-red heat map grows around the lesion on three planes, the "damage estimate" contour fills, the laser stops at its limit | M | M | 5 |
| 1b | NeuroBlate | Monteris, US | Robotic MR-compatible probe driver with a cooled laser probe (a variant of 1) | FDA 510(k) [V]; FLAG glioblastoma feasibility trial (NCT02880410) [V]; LAANTERN registry of 787 patients in JCO [V] | same suite | Probe driver on the table frame | Same story, with the robot steering the probe | M | M | 4 |
| 2 | **Exablate Neuro (and Prime)** | Insightec, Israel (Haifa; offices in Miami, Dallas, Shanghai, Tokyo) | A hemispherical 650 kHz, 1,024-element helmet focuses ultrasound on a brain target through the skull; MR thermometry shows the focal heat; sonications of 5-60 s | FDA PMA: essential tremor 2016, tremor-dominant Parkinson's 2018, pallidotomy 2021, staged bilateral pallidothalamic tractotomy 8 Jul 2025 [V]. Prime: Health Canada 5 Feb 2026 [V], "previously FDA-approved" [C] | MR-guided suite (shares the MRI) | A white hemispherical helmet with a water membrane, on a table with a head frame; about 0.5 m across (est.) | A tremor patient draws a spiral, 6 short sonications heat a spot that appears on screen, the spiral is redrawn smoother | M | M | 4 |
| 3 | **Edison histotripsy** | HistoSonics, US | Short, strong ultrasound pulses make a cloud of microbubbles at a focus; a robot arm sweeps it over the tumour and liquefies it mechanically, with no heat and no incision. Guided by a bundled GE ultrasound unit | FDA De Novo liver Oct 2023 [V]; CE mark announced 13 Jul 2026 [V]; kidney De Novo request submitted 13 May 2026, not decided [V]; #HOPE4LIVER: 90% local control at 12 months (company) [C]. Parts: 64-channel amplifier, 6-DOF arm, therapy transducer, ultrasound probe, degassed-water coupling [V] | Interventional oncology room | Treatment cart with a 6-axis arm over the patient, a water-filled coupling bag or tub under the transducer, an ultrasound cart; about 1.2 x 1.0 m cart footprint (est.) | The bubble cloud appears as a bright spot on the live ultrasound image and sweeps across a dark lesion that turns to mush; the arm moves on cue | M | M | 5 |
| 4 | **Akalux photoimmunotherapy + BioBlade laser** | Rakuten Medical, Japan/US | An antibody-dye drug (cetuximab sarotalocan) binds tumour cells; 690 nm red light from fibres switches the dye on and bursts the cell without heat | Approved in Japan 2020 (drug plus BioBlade laser), on sale from 14 Dec 2020 / 1 Jan 2021 [V]. Investigational elsewhere: phase 3 NCT03769506 "active, not recruiting" since Jan 2025 [V]; combination phase 3 NCT06699212 enrolling, US filing later [C]; $100 M Series F Jan 2026 [C] | Flex suite (ENT) | Laser box on a cart (about 0.5 x 0.6 x 1.0 m), cylindrical diffusers on thin fibres | The room dims, red fibres glow inside a stylised tumour, a timer counts the light dose | M | L | 4 |
| 5 | **X1 biology-guided radiotherapy (SCINTIX)** | RefleXion, US | A fast ring linac with PET detectors; a tracer in the patient makes the tumour emit, and beamlets follow that signal | FDA clearance 2 Feb 2023 for lung and bone tumours with FDG [V]; the X1 was cleared earlier for IMRT, SRS, SBRT [V]. 6 MV FFF linac, kVCT and dual PET arcs, gantry 60 rpm, response about 350-400 ms [V] | Radiotherapy vault | Ring gantry about 2.5 m across (est.), couch, control room | PET glow on the tumour, beamlets flashing around the ring, a "latency 0.4 s" counter | M | M | 5 |
| 6 | Ethos / Halcyon with HyperSight | Varian (a Siemens Healthineers company), US/DE | O-ring linac with cone-beam CT in about 6 s; Ethos re-plans daily (adaptive) | FDA 510(k) and CE, Feb 2023 [V]; "Ethos 2.0" not found [V] | Vault | Enclosed ring, couch | Plan adapts overnight and the patient is treated on the new plan | M | M | 3 |
| 7 | Unity MR-Linac | Elekta, Sweden | A 1.5 T MRI fused with a linac: see the tumour during treatment, adapt online | CE and FDA 2018 [V]; motion management cleared Mar 2023 [V]; 100th system installed (undated), 14 countries [C]; first in Karnataka Aug 2026 [V] | Vault (needs shielding, large room) | MRI ring with a linac head, about the size of a 1.5 T scanner | Live MR movie of the moving tumour during treatment | H | H | 4 |
| 8 | TULSA-PRO | Profound Medical, Canada | A transurethral ultrasound applicator ablates the prostate inside an MR scanner, with live thermometry | FDA 510(k) [V]; CAPTAIN randomised trial against prostatectomy, early perioperative data announced [V]. Clearance year not retrieved [U] | MR suite | Table with applicator and endorectal cooling unit | Heat contour spreading in the prostate | M | M | 3 |
| 9 | CyberKnife S7 | Accuray, US | Linac on a robot arm for radiosurgery | NMPA China approval Jan 2025 (S7 and Radixact SynC) [V]; FDA date not retrieved [U] | Vault | Industrial robot arm + couch | Arm swings around the patient | M | M | 4 |
| 10 | Proton and FLASH therapy | Varian FLASHforward (US); proton vendors IBA (Belgium), Mevion (US) [U] | Protons stop in the tumour; FLASH delivers the dose in a fraction of a second | **Investigational**: FAST-01 trial, 10 patients, JAMA Oncology 2022, FDA IDE [V]. Not a cleared FLASH product | none (a gantry room is 15 m or more across) | Not feasible in the pavilion | Information panel only | - | H | 3 |
| 11 | Focal laser ablation of the prostate | Avenda Health (US), Elesta (Italy), Clinical Laserthermia Systems (Sweden) | MRI-guided laser fibre placed in a prostate lesion | FDA: Avenda 2020, Elesta 2023, CLS TRANBERG 2015 [V]. Insurer policies still call focal therapy investigational (Blue Shield CA, Feb 2025) [V] | MR suite | Same kit as Visualase | Reuses #1 | L | L | 3 |
| 12 | **Optune Gio / Lua / Pax (Tumor Treating Fields)** | Novocure, Jersey/Switzerland (operations in Israel [U]) | Wearable arrays on the skin deliver alternating electric fields that disturb cell division | Glioblastoma 2011 (recurrent) and 2015 (newly diagnosed) [V]; lung (Optune Lua) Oct 2024 [V]; pancreatic (Optune Pax) Feb 2026 [V]; newer head arrays Nov 2024 [V] | Ward room | Scalp arrays on a patient avatar plus a handbag-size battery; no room needed | Field lines animate over a head hologram | L | L | 3 |

### B. Imaging and diagnostics

| # | Device | Maker, country | What it does | Status | Room | Look and size | Demo story | Sim | Model | Wow |
|---|---|---|---|---|---|---|---|---|---|---|
| 13 | **Naeotom Alpha class photon-counting CT** | Siemens Healthineers, Germany | Cadmium-telluride detector converts each X-ray photon directly to a signal and measures its energy: finer detail (about 0.2 mm voxels) and spectral data in every scan | FDA cleared the "Alpha class" (Alpha.Peak, Pro, Prime) Mar 2025 [V]; first Naeotom Alpha cleared 2021 [U]; over 200 photon-counting units installed by Jun 2025 (company) [C]; vendor claim of up to 45% less dose for ultra-high-resolution scans [C] | CT room (swap) | Gantry like our CT (1.9 m wide, 2.0 m high) | Split screen: conventional against ultra-high-resolution of a stent or inner ear | L | L | 3 |
| 14 | MAGNETOM Flow (helium-light 1.5 T) | Siemens Healthineers, Germany | Sealed magnet with 0.7 L of helium, no quench pipe | Siemens press release Mar 2024 [V]; footprint about 25 m2 [V] | MRI room (swap) | MRI like ours | "No quench pipe" cutaway | L | L | 2 |
| 15 | **Swoop portable MRI** | Hyperfine, US | 64 mT permanent-magnet MRI that wheels to the bedside and runs from a wall outlet | Next-generation Swoop and Optive AI cleared 28 May and 2 Jun 2025, further Optive AI 20 Aug 2026 [V]; v2 sheet: about 57 x 32 x 57 in (1.45 x 0.81 x 1.45 m), peak about 950 W [V]; about 1,400 lb [V] | ER bay or ward room | White cabinet on wheels with a head coil and a tablet | A porter wheels it in, plugs in, the head is scanned at the bedside, the scan appears on a tablet | M | L | 4 |
| 16 | uMR Jupiter 5T | United Imaging, China (Shanghai) | The first 5 T whole-body MRI | FDA 510(k) 1 May 2024 [V] (company release) | MRI room (swap) | Large magnet, about the size of ours | Heart image at ultra-high field | L | L | 3 |
| 17 | AI-guided handheld ultrasound | Butterfly iQ3 (US) with Caption AI guidance | A novice is guided to a good cardiac image | Caption's guidance first authorised about 2020 [U]; iQ3 2024 [C]; a specific 2025 clearance not found | Ultrasound room / bedside | Probe on a phone | Colour arrows guide the probe | L | L | 2 |
| 18 | Digital pathology with AI | Paige Prostate (US) | AI helps pathologists find prostate cancer on scanned slides | FDA De Novo Sep 2021, the first AI pathology product [V]; scanner brands not verified | Lab (new bench) | Scanner on a bench + monitor | Slide scan then AI overlay | L | M | 2 |

### C. Surgery and procedures

| # | Device | Maker, country | What it does | Status | Room | Look | Demo story | Sim | Model | Wow |
|---|---|---|---|---|---|---|---|---|---|---|
| 19 | **Toumai tele-robotic surgery system** | MicroPort MedBot, China | Four-arm laparoscopic robot built for telesurgery over 5G, fibre and satellite | NMPA approval announced 20 May 2025 as the first tele-operated surgical robot for commercial use (company) [C]; FDA IDE (not marketing) with an Orlando-to-Angola prostatectomy Jun 2025 [V, company]; CE MDR for telesurgery 17 Jun 2026 [C]; latency under 50 ms inter-provincial and under 150 ms intercontinental (company) [C] | l2Or (skin swap) plus a remote console room | Patient cart with 4 arms, surgeon console | Two rooms: console here, robot there, latency on screen | M | H | 5 |
| 20 | Hugo | Medtronic, US/Ireland | Modular robot: independent arm carts | FDA 510(k) urology (prostatectomy, nephrectomy, cystectomy), Dec 2025 [V]; first US case Feb 2026 [V]; general and gynae filings Jun 2026 [C] | l2Or (skin swap) | Four separate arm carts + open console | Carts positioned freely around the table | M | H | 4 |
| 21 | Versius Plus | CMR Surgical, UK | Small modular arm carts | Versius De Novo Oct 2024; Versius Plus 510(k) (cholecystectomy) dated 16 Dec 2025; US launch 2026; over 40,000 procedures outside the US (company) [V/C] | l2Or (skin swap) | Light arm carts | Carts parked at the bedside | M | M | 3 |
| 22 | Hinotori | Medicaroid (Kawasaki + Sysmex), Japan | Japanese soft-tissue robot | Japan approved (company, date [U]); Singapore 2023, Malaysia 2024, Vietnam [V]; CE mark 7 Jul 2026 [V] | l2Or (skin swap) | Arm cart with a tall column | Skin swap of #19-21 | M | M | 3 |
| 23 | Robotic bronchoscopy: Ion and Monarch | Intuitive (US) and J&J MedTech (US) | A thin robotic catheter reaches small lung nodules (Ion by shape sensing, Monarch by electromagnetic navigation) | Both FDA-cleared [V]; Monarch's software update with AI planning [V]; no independent head-to-head found [V] | Flex suite | Console + cart + a catheter | Virtual bronchoscopy path to a nodule | M | M | 4 |
| 24 | XACT ACE needle robot | XACT Robotics, Israel | Robot inserts and steers needles under CT, and later ablation probes | Original FDA 2019 [V]; later clearances for ablation and remote control (years not retrieved) [V] | CT room | Compact mobile robot | Needle steered to a target on a CT slice | M | M | 3 |

### D. Ward and care

| # | Device | Maker, country | What it does | Status | Room | Look | Demo story | Sim | Model | Wow |
|---|---|---|---|---|---|---|---|---|---|---|
| 25 | **Aletta autonomous blood draw** | Vitestro, Netherlands | Finds a vein with near-infrared and Doppler ultrasound, then punctures, fills tubes and bandages | CE Aug 2024 [V]; FDA De Novo about 19-20 Aug 2026, adults, outpatients [V]; ADOPT trial about 95% first-stick success, 0.6% haemolysis (company) [C]; one phlebotomist may supervise up to three units [V] | Blood-draw centre (we have it) | Armrest cradle with a camera head | Arm in, scan, needle, tubes | L | L | 3 |
| 26 | Moxi | Diligent Robotics, US (acquired by Serve Robotics Jan 2026, single source) | A mobile robot with an arm that fetches and delivers supplies | Over 300,000 pharmacy deliveries by Jul 2025, a million fleet deliveries Feb 2025 (company) [C] | Wards | Mobile base, one arm, a "head" with eyes | Fetches a pack from the pharmacy and opens a door | M | M | 3 |
| 27 | Hilo band | Aktiia, Switzerland | Cuffless blood-pressure estimate from a wrist optical sensor | FDA 510(k) Jul 2025 as the first over-the-counter cuffless monitor; CE earlier; US availability 2026; still needs cuff calibration [V] | Ward / kiosk | Wrist band | Reading on the band and app | L | L | 2 |
| 28 | Rehabilitation exoskeletons | ReWalk ReStore (Israel, FDA 2019 [V]); Wandercraft Eve (France, FDA about Aug 2026, single source [C]); Angel Robotics Angel Legs M20 (Korea, MFDS class III, Malaysia/ASEAN 2025, no FDA clearance seen) [V]; Cyberdyne HAL (Japan) [U] | Powered walking aids for rehab | see left | Physio room (none today) | Patient avatar + frame | Walking on the corridor line | M | M | 4 |
| 29 | Deep TMS (H-coil) | BrainsWay, Israel (Jerusalem) | Magnetic pulses to the brain for depression and OCD | FDA depression 2013, OCD De Novo 2018 [V]; over 1,000 systems in 30 countries (profile) [C] | Outpatient | Chair + helmet coil | Helmet on a seated patient | L | L | 3 |

**Gaps to say plainly.** Korea is thin: only Angel Robotics was verified, and Lunit and Samsung Medison were not researched. Dates marked [U] are from memory. "Moxi" and EarlySense-style contactless monitors are logistics or monitoring products where regulatory status is less central; EarlySense's sources were old (2010-2013) so it is not on the list.

---

## 3. What the sim needs: one generic engine

All of the top 8 are "a patient (or a consenting synthetic guest), a few staff and a machine that plays a sequence". The sim should therefore get one small engine, not eight state machines.

```
src/sim/devices/
  types.ts          DeviceId, DevicePhase, DeviceState (contract: orchestrator)
  department.ts     DeviceDepartment: owns one DeviceRun per device, registered in Simulation like imaging/surgery/blood
  run.ts            DeviceRun: the script runner (steps, timers, Actor commands)
  plan.ts           drawPlan(device, rng): durations drawn once per run (like imaging/exam.ts)
  scripts/<id>.ts   per-device step lists (data first: most of it lives in devices.json `demo`)
  warm.ts           warmInFlight(): showcase placement at 07:30
```

**State** (`DeviceState`, read by the scene and the UI, published to zustand at 4 Hz):

```
{ id, phase: 'idle'|'prep'|'positioning'|'active'|'finish'|'cleanup',
  step, t, progress /* 0..1 of the active phase */, patient: id|null, operator: id|null }
```

**Script steps** use the same commands as `imaging/scanner.ts`: `meet, call, walk, sitOn, lieOn, wait(s), motion(name, from, to, s), screen(mode), say(captionKey)`. Everything random is drawn once at run start from `src/sim/rng.ts`. The demo patient is synthetic (the imaging department already has a "demo" patient mode with `wait (demo)`, no questions and no changing).

**No clinical decisions.** Every number on every screen (temperature, dose, success rate) is a pure function of `progress` and a seed, never of patient data. Each screen shows a corner chip `SIMULATED DEMO`.

**Triggering.** Two ways, both deterministic: (a) the schedule, a demo every N sim-minutes per device, only in showcase mode (`CONFIG.devices.schedule`); (b) on demand: `sim.devices.demo(id)` from the tour, queued per room so two demos never overlap. Time skip, 10x and 30x work for free, because the machine runs on the sim clock.

**Rigs** follow `scene/imaging/machines`: pure `motion.ts` returns node poses from `DeviceState`; one `useFrame` at a negative priority registered in `frameOrder.ts`; zero allocations. Blender models are glTF with **named nodes** (`dev:<id>/<part>`) listed in `devices.json`, so a manufacturer's model can replace ours by keeping the names (Wave 4 rule).

**Staff.** `Role` in `types.ts` already has radiographer, doctor, nurse and porter. New demos can reuse them with name tags and roster titles (neurosurgeon, interventional radiologist, radiation therapist, medical physicist). New roles are a `types.ts` change request; new avatars wait for Wave 5. The 14 Rocketbox avatars are shared per role (ROADMAP A1.6), so say that in the plan rather than promise distinct people.

---

## 4. Ranking and scoring

Score = 0.30 wow + 0.25 journey (can the sim show a clear patient story) + 0.20 verifiability + 0.15 build cost (5 = cheap) + 0.10 diversity (new country or new department). Scores are 1-5 judgments.

| Device | Wow | Journey | Verified | Cost | Diversity | Total |
|---|---|---|---|---|---|---|
| Visualase V2 | 5 | 5 | 5 | 3 | 4 | 4.60 |
| Exablate Neuro | 4 | 5 | 5 | 3 | 5 | 4.40 |
| Swoop | 4 | 5 | 5 | 4 | 3 | 4.35 |
| Aletta | 3 | 5 | 5 | 5 | 4 | 4.30 |
| Edison | 5 | 4 | 5 | 3 | 3 | 4.25 |
| Toumai (gallery lead) | 5 | 4 | 4 | 2 | 5 | 4.10 |
| Akalux PIT | 5 | 4 | 3 | 3 | 5 | 4.05 |
| X1 | 5 | 4 | 4 | 2 | 3 | 3.90 |
| Unity | 4 | 4 | 4 | 2 | 4 | 3.70 |
| Naeotom | 3 | 3 | 5 | 4 | 4 | 3.65 |
| Hugo | 3 | 4 | 5 | 3 | 3 | 3.65 |

The priority order in section 0 is the score order with one deliberate adjustment: Edison moves above Swoop and Aletta (4.25 against 4.35 and 4.30), because the three pavilion devices (Visualase, Exablate, Edison) carry the owner's theme of destroying tumours without surgery and share one wave. Akalux scores 4.05 because it is the other reading of the owner's example, but it is approved only in Japan, so its card says "approved in Japan, investigational elsewhere". If the owner meant photoimmunotherapy, move it to Wave B.

Countries covered by the top 8: US (4), Israel, Netherlands, China, Japan. Germany comes in with the Naeotom bonus. Korea and France need a Wave-C exoskeleton (row 28).

---

## 5. Delivery waves

Sizes: S = a day or two of agent work, M = about a week, L = two weeks or more. These are my estimates; they rely on the Wave-4 Blender device pipeline existing.

### Wave A: the platform and three quick wins (no pavilion)
**Goal:** prove the engine, the tour and the card on devices that live in existing rooms.

| Piece | Where | Contract change | Size |
|---|---|---|---|
| Devices platform: `devices.json`, card, in-world panel, "Meet the device" tour | new `src/content`, `src/ui`, `src/scene/devices` | additive: `DeviceId`/`DeviceState` in `types.ts`, `DEVICES` in `places.ts`, interact kind, frame priority | M |
| **Aletta** | one robot station in the blood-draw centre (`DRAW_CENTRE.robots`; the room is 6 x 10 m with 3 stations at 1.7 m, so no space for a fourth: swap the skin of one station) | none | S |
| **Swoop** | an ER bay (or a ward room reserved for the demo): porter pushes a device cart from the imaging hall | one new `VehicleKind` (`deviceCart`) and its `VEHICLE_HALF`/`VEHICLE_AHEAD` | M |
| Bonus **Naeotom** | CT room: new gantry skin on the existing `ct.ts` rig, new story | none | S |

### Wave B: the Advanced Therapies pavilion, first half
**Goal:** the owner's example, working, in a room that looks like a real interventional suite.

| Piece | Where | Size |
|---|---|---|
| Pavilion shell with the hall, prep and recovery, MR suite and its control room, interventional oncology room (annex, section 6) | `places.ts` and `tools/arch` | L |
| **Visualase V2** (1) and **Exablate Neuro** (2): one MR magnet instance, two kits swapped by tour mode or by the schedule | MR suite | L |
| **Edison** (3) | interventional oncology room | M |

### Wave C: radiotherapy, laser phototherapy, the robot gallery
| Piece | Where | Size |
|---|---|---|
| **X1** (8) | radiotherapy vault (annex) | L |
| **Akalux PIT** (7) | flex suite (annex), with an ENT patient chair | M |
| **Toumai-led robot gallery** (6): da Vinci stays; Hugo, Versius, Hinotori and Toumai are skins of the same `surgery/robot.ts` machine, swapped in tour mode; a remote console room is a skin of the existing teaching console | `l2Or` | L |
| Unity and Ethos as vault variants | vault | M |

Order check: A before B because B's tour mode reuses A's platform; B before C because the pavilion shell comes with B.

---

## 6. The Advanced Therapies pavilion: where it goes

### Recommendation: an annex east of the atrium
Join it to the atrium's east wall at x = 40 (today there is no door there). The annex is **x 40..70, z -12..12 (30 x 24 m)**, laid out like the imaging block (control rooms on the hall's north side):

```
 z=-12 ┌───────────┬─────────────────┬──────────┐
       │ atMr      │ atRt            │ atPlant  │  north: MR suite 10 x 7.5, vault 12 x 7.5, plant/second vault 8 x 10
       │ (MR suite)│ (radiotherapy)  │ (reserve)│
 z=-4.5├───────────┼─────────────────┤          │
       │ atMrCtrl  │ atRtCtrl        │          │  control rooms 2.5 deep
 z=-2  ├───────────┴─────────────────┴──────────┤
atrium ▶  atHall (corridor 30 x 4, seats at the east end)   │  z -2..2
 z=2   ├───────────┬─────────────────┬──────────┤
       │ atHisto   │ atPrep          │ atFlex   │  south: histotripsy 10 x 10, prep and recovery 3 bays, flex suite 10 x 10
       │ (IO room) │ (prep/recovery) │ (ENT/etc)│
 z=12  └───────────┴─────────────────┴──────────┘
       x=40        x=50              x=60     x=70
```

| New AreaId | Rect (x, z) | Kind | Hosts |
|---|---|---|---|
| `atHall` | 40..70, -2..2 | clinical | corridor, seats |
| `atMr` | 40..50, -12..-4.5 | clinical | Visualase and Exablate (one MR) |
| `atMrControl` | 40..50, -4.5..-2 | staff | consoles, workstation |
| `atRt` | 50..62, -12..-4.5 | clinical | X1 (Wave C), Unity or Ethos later |
| `atRtControl` | 50..62, -4.5..-2 | staff | consoles |
| `atPlant` | 62..70, -12..-2 | service | reserve |
| `atHisto` | 40..50, 2..12 | clinical | Edison |
| `atPrep` | 50..60, 2..12 | clinical | prep, three recovery bays |
| `atFlex` | 60..70, 2..12 | clinical | Akalux PIT, robotic bronchoscopy, a rehab exoskeleton later |

**Doors** (`DOORS`): atrium to hall `{center (40,0), width 4, wallAxis 'z', kind 'opening'}`; hall to `atMrControl` at (45,-2) 1.4 auto; `atMrControl` to `atMr` at (47,-4.5) 1.4 swing (zone III to zone IV, as MRI today); hall to `atRtControl` at (56,-2) 1.4 auto; `atRtControl` to `atRt` a shielded sliding door at (59,-4.5) 1.6; hall to `atHisto` (45,2) 1.6 auto; hall to `atPrep` (55,2) 1.6 auto; hall to `atFlex` (65,2) 1.6 auto.

Why the east side: the atrium is the hospital's public heart, so doctors reach the pavilion by walking through the garden; the annex touches the plinth and lawn only, so the existing shell, the two wards and the baked lightmaps stay unchanged.

### Fallbacks
- **Carve the atrium's east third** (x 28..40, 12 x 24 m): enough for the MR suite and the histotripsy room, no vault. It removes the café (`ATRIUM.cafe`, `ATRIUM.garden`).
- **No new space at all (Wave A only):** every top-8 device except the vault and the pavilion rooms can be shown as a *skin swap* in an existing room during the tour.

### Contract changes needed (all orchestrator-owned)
| File | Change |
|---|---|
| `src/sim/types.ts` | `DeviceId`, `DevicePhase`, `DeviceState`; `VehicleKind` += `deviceCart`; `SimEventType` += device events; `Role` extensions if needed |
| `src/sim/places.ts` | `AreaId` += the nine `at*` ids; `AREAS`, `DOORS` rows above; a `DEVICES` anchors table (like `IMAGING`: machine, table, operator, assist per device); `VIEW` widened to include x up to 70; `SIGNS` for the pavilion; `ceilingHeight`; minimap rect. `BUILDING` should stay as the main shell, with the annex a separate `ANNEX: Rect` so the shell's bake and tests do not change |
| `src/sim/config.ts` | `CONFIG.devices` (schedule, durations, warm-in-flight) |
| `src/scene/interact.store.ts` | `InteractableKind` += `'device'` (or reuse `'station'`) |
| `src/scene/camera/frameOrder.ts` | a `devices` priority, negative |
| `src/scene/landscape/exterior.ts` | `PLINTH.x1` 48 to about 78, lawns, apron, the daylight probe |
| `tools/arch/export-plan.ts`, `generate.py` | export and build the annex shell; new lightmaps for the annex rooms |
| `src/scene/warmup/manifest.ts` | the device glbs behind `registerWarmGate` |
| `src/sim/nav` | none expected: it derives the graph from `AREAS` and `DOORS` (the header comment in `places.ts` says so), but add a reachability test |

Rule check: `WALL.thickness` is 0.2 m for every wall. A real vault has 1-2 m concrete walls. Draw a baffle wall and a heavy door in Blender and keep the sim wall at 0.2 m.

---

## 7. Integration recipes for the top 8

Common to all eight (do not repeat per device):

- **Blender:** `tools/arch/devices/<id>.py` builds the model with named nodes `dev:<id>/<part>`; export, then gltf-transform with meshopt and KTX2 (`tools/arch/optimize.mjs`); the validator must report 0 errors. Moving parts are separate nodes; static parts are merged by material.
- **Materials:** at most 6 per device (shell, trim, glass or screen, glow, rubber, metal), shared across devices where possible so the warm-up programme count stays the same.
- **Screens:** a painter `scene/devices/screens/<id>.ts` returning a canvas (about 512 x 512), redrawn only when its content changes and never above 2 Hz; the same canvas feeds the card.
- **Content:** one entry in `src/content/devices.json`, section 8.
- **Tour stop:** section 9.
- **Tests:** section 10.
- **Interaction:** a priority-1 `device` station at the plinth; E opens the card.

### 7.1 Visualase V2 (rank 1, Wave B, `atMr`)
- **Model nodes:** `visualase.cart`, `visualase.cart.tablet`, `visualase.pump`, `visualase.fibre` (a thin tube, glow when lasing), `visualase.headholder`, `visualase.workstation` (control room), plus the shared `mr.magnet`, `mr.table`.
- **Sim:** `DeviceRun` script `visualase`: meet, change, screening talk (reuse the MRI safety script), walk to the MR room, lie on the table, `wait` (the surgeon places the fibre: a 20-45 s motion of the fibre node), table in, `active` (3-4 thermometry bursts, each with a rising `progress`), table out, cleanup. Durations are compressed and drawn from the seeded `Rng`.
- **Staff:** surgeon (doctor avatar), anaesthetist or nurse, radiographer at the MR console.
- **Screens:** `visualase` painter: three MR planes of the synthetic head (the parked `head.ts` region), a colour overlay of a heat map as a Gaussian blob growing with `progress`, a contour "estimated damage" and a temperature-limit marker, and a "laser power" bar. The MR-control and the card use the same canvas.
- **Tour stop:** camera to the head holder; the table moves in on cue; the heat map plays once; talking points (see 8).
- **Budget:** 12 draw calls, about 45 k triangles including the shared MR and table, 2 x 1 k KTX2 atlases (about 4 MB), 2 canvases (about 2 MB).
- **Test ideas:** a determinism trace hash per seed; the run reaches `idle` within its planned duration and the patient returns to the start spot; `progress` is monotone while `active`; `thermal screen` redraw count is 2 Hz or less in a 60 s run.

### 7.2 Exablate Neuro (rank 2, Wave B, shares `atMr`)
- **Model nodes:** `exablate.helmet`, `exablate.membrane`, `exablate.frame`, `exablate.console`; uses the same magnet and a table variant.
- **Sim:** script `exablate`: as above but "awake" tasks (the patient draws a spiral before and after, a 3-s pen animation), 5-6 sonications (`active` bursts, 5-60 s compressed), a rest between each.
- **Screens:** an axial MR thermometry slice with a hot spot rising green, yellow, red; a temperature-time curve; "sonication n of 6"; the tremor spiral before and after (pure function of a seed, never of data).
- **Schedule rule:** Visualase and Exablate share the MR; the department serialises them (a queue per room) and tour mode swaps kits with a 1.5 s fade.
- **Budget:** adds about 15 k triangles, 5 draw calls, 1 k KTX2 atlas.
- **Tests:** two demos queued in the same room never overlap; kit swap leaves exactly one kit visible; every run terminates.

### 7.3 Edison histotripsy (rank 3, Wave B, `atHisto`)
- **Model nodes:** `edison.cart`, `edison.arm.j1..j6`, `edison.head` (transducer plus probe), `edison.bag` (water coupling), `edison.usCart`, `edison.usCart.screen`.
- **Sim:** script `edison`: patient lies supine, the nurse positions the water coupling, the arm moves to the planned pose, `active` runs 6-8 "cloud positions" on a raster pattern (progress = fraction of positions), the arm retracts, recovery moves the patient to `atPrep`.
- **Screens:** B-mode ultrasound painter (speckle noise, a dark lesion, a bright bubble cloud), progress of "volume treated", an elapsed counter.
- **Budget:** about 40 k triangles, 10 draw calls (the arm joints are separate nodes: 6 extra, so cap them at 3 merged groups to stay inside it), 2 canvases.
- **Tests:** the arm's joint angles stay inside limits at every `progress` (pure `motion.ts` test); `noAllocations`; determinism.

### 7.4 Swoop (rank 4, Wave A)
- **Model nodes:** `swoop.body`, `swoop.wheel.fl/fr/rl/rr` (turn with travel), `swoop.coil`, `swoop.tablet`, `swoop.led`.
- **Sim:** a porter (existing `er/porter.ts` pattern) takes a `deviceCart` from a parking spot in the imaging hall to the bay: footprint `VEHICLE_HALF` about `[0.41, 0.73]`, `VEHICLE_AHEAD` about 1.1 m, then `setup` (unplug the cord, 10 s), `active` (a progress bar of about 8 min compressed), `finish`, and the porter returns it. It is a vehicle with a rider-less payload, like the linen cart.
- **Screens:** a tablet painter showing slices from the synthetic head; "scan 3 of 4".
- **Budget:** about 12 k triangles, 4 draw calls, one 1 k atlas.
- **Tests:** the route from the parking spot to the bay exists and no other actor blocks it for more than N s; the cart reaches its spot without the safety-net teleports (`imaging/scanner.ts` still teleports as a net, so the test must assert zero forced steps); every run terminates.

### 7.5 Aletta (rank 5, Wave A, existing blood-draw robot station)
- **Model nodes:** `aletta.cradle`, `aletta.head` (camera and needle), `aletta.screen`.
- **Sim:** reuse `blood/station.ts` and `RobotStation` states; Aletta is a skin and an info card on one station. If a fourth station is wanted later, `places.ts` must grow the room (a layout change).
- **Screens:** vein overlay with a needle track, "attempt 1: success", NIR image.
- **Budget:** 10 k triangles, 4 draw calls, no new texture memory beyond one atlas.
- **Tests:** the existing blood-centre tests stay green; a snapshot test that the skin swap does not change any `DrawCentre` state.

### 7.6 Toumai-led robot gallery (rank 6, Wave C, `l2Or` and a console room)
- **Model nodes:** `toumai.cart`, `toumai.arm1..4`, `toumai.console`, `toumai.screen.remote`; Hugo, Versius and Hinotori as alternate cart sets.
- **Sim:** the existing da Vinci state machine (`surgery/robot.ts`) drives it unchanged; only the skin differs. The remote console is a second seat registered through the registry (`console:or:remote`), reusing `teaching.ts`.
- **Screens:** the R3 endoscope picture on the console, plus a "link" strip: distance, latency (about 50-150 ms as company figures [C]), and a scripted jitter.
- **Budget:** about 40 k triangles (cart 20 k, console 15 k), 10 draw calls, one 512 canvas at 2 Hz.
- **Tests:** swapping skins never changes the surgery plan or its trace hash; the latency strip is a pure function of a seed.

### 7.7 Akalux PIT (rank 7, Wave C, `atFlex`)
- **Model nodes:** `bioblade.box`, `bioblade.fibre1..3` (glow when lighting), `bioblade.timer`.
- **Sim:** script `pit`: a seated "ENT" patient, an infusion step (a drip stand), a wait, the illumination (a progress of about 10 min compressed), a recovery.
- **Screens:** a stylised endoscopic view with a glowing red fibre; a "light dose" counter.
- **Card text:** investigational outside Japan; no efficacy claims.
- **Budget:** about 10 k triangles, 5 draw calls (the fibre glows via one emissive material).
- **Tests:** determinism and termination; the glow never exceeds an emissive limit (so it does not bloom badly on the Quest).

### 7.8 X1 (rank 8, Wave C, `atRt`)
- **Model nodes:** `x1.ring`, `x1.pet.arc1/arc2` (static), `x1.couch`, `x1.couch.top` (moves), `x1.control`.
- **Sim:** script `x1`: the radiation therapists position the patient, a kV CT (a 20-s rotation), a tracer injection and uptake wait (a caption), the beam delivery (the ring turns, beamlet flashes), done. The vault door is a sliding door that closes during beam-on (a safety interlock caption).
- **Screens:** a PET glow and beamlet fan; a "latency 0.4 s" counter.
- **Budget:** about 40 k triangles, 8 draw calls; the ring turns as one node (60 rpm is shown as a slower, blurred spin; a texture does the blur).
- **Tests:** the door is closed whenever the beam is on (an invariant over the state trace); every run terminates; determinism.

---

## 8. `src/content/devices.json` and its zod schema

Parsed at module load like the other loaders (`parseOrThrow`), with a test.

```ts
const Authority = z.enum(['FDA','CE','NMPA','PMDA','MFDS','HealthCanada','TGA','Other'])
const Pathway   = z.enum(['510k','DeNovo','PMA','CE-MDR','Approval','IDE','Investigational','Registered'])

const Device = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),                 // generic display name; the real brand only in `maker.model`
  maker: z.strictObject({ name: z.string(), country: z.string().length(2), city: z.string().optional(), model: z.string() }),
  category: z.enum(['imaging','radiotherapy','ablation','surgery','blood','ward','neuro','logistics']),
  summary: line.refine(wordsAtMost(40)),
  regulatory: z.array(z.strictObject({ authority: Authority, pathway: Pathway, year: z.number().int(), scope: line, asOf: z.string() /* YYYY-MM */ })).min(1),
  specs: z.array(z.strictObject({ label: line, value: line, source: z.number().int() /* index into sources */ })),
  story: z.array(z.strictObject({ phase: z.enum(['prep','positioning','active','finish']), caption: line, seconds: z.number().positive() })).min(3),
  talkingPoints: z.array(line.refine(wordsAtMost(25))).min(3).max(6),   // non-graphic check applies to every `line`
  media: z.strictObject({ poster: z.string().optional(), model: z.string() /* asset id through the pinned gate */ }),
  anchor: z.strictObject({ area: z.string() /* must exist in AREAS */, node: z.string() /* named node in the glb */ }),
  nodes: z.array(z.string()).min(1),        // every node name the rig needs (swap contract)
  shots: z.array(z.strictObject({ id: z.string(), from: Vec3, to: Vec3, fov: z.number() })).min(1),
  demo: z.strictObject({ script: z.string(), schedule: z.enum(['none','showcase']), room: z.string() }),
  licence: z.strictObject({ model: z.enum(['own-generic','manufacturer-supplied']), logo: z.enum(['none','licensed']), assetGate: z.string() }),
  simulated: z.strictObject({ motion: z.literal(true), images: z.literal(true), numbers: z.literal(true), patient: z.literal(true) }),
  review: z.strictObject({ role: z.string(), date: z.string() }).optional(),   // medical-accuracy sign-off; required before release builds
  sources: z.array(z.url()).min(1),
  confidence: z.enum(['verified','company','unverified']),
})
```

Checks (`devices.test.ts`): ids unique; `anchor.area` exists in `AREAS`; every `nodes` name exists in the built glb; all text passes the non-graphic regex and word counts; every `regulatory.asOf` is recent (warns after 6 months); `simulated.*` literally `true`; `licence.logo` is `'none'` unless `assetGate` points at a pinned licence entry; no field contains the words "cure", "kills", "guarantee" (marketing-claims list).

Human review is a separate field (`review`), and release builds fail if it is missing. The demo (dev) build does not.

---

## 9. The "Meet the device" tour (reuses existing code)

- **State:** a `devicesTour.store.ts` (zustand, slow state, 4 Hz) holds `{active, index, stopPhase}`; the order comes from `devices.json`, grouped by department.
- **Stop sequence:** (1) `focusRoom(area)` from `camera/roomFocus.ts` (it already switches level, opens the panel and flies in beside it); (2) `flyTo` the first `shots[]` entry, with the panel shift kept; (3) `sim.devices.demo(id)` starts the run, with `skip` allowed (the existing 10x / 30x and time skip work because the run is on the sim clock); (4) the card (a `DeviceBody` in `RoomPanel.tsx`, next to `OrBody`) lists the summary, the regulatory chips, the talking points one by one as the phases change; (5) the second and third shots follow the phases (the table moving in, the screen close-up); (6) `unfocus()` returns to the overview.
- **Walk mode:** a priority-1 `device` interactable at the plinth: E opens the same card and starts the demo without flying the camera.
- **Presenter controls:** next, previous, repeat, skip the run, "compare" (a later extension), and Esc. Reuse `ui/present/PresentationControls.tsx` and `glide.ts`.
- **Headset (Wave 6):** the card becomes a 3D panel pinned by the plinth. The tour logic stays the same: a controller ray replaces E.

---

## 10. Budgets and tests

### Quest 3 budget (from CLAUDE.md)
72 Hz minimum, under 200 draw calls in stereo, under 1.5 M triangles, about 250 MB of GPU texture, 13.8 ms a frame.

| Item | Triangles | Draw calls | Texture memory |
|---|---|---|---|
| Pavilion architecture (baked, merged) | 60-80 k | 20-25 | about 12 MB lightmaps |
| MR suite devices (MR, two kits) | 60 k | 12 | about 6 MB |
| Histotripsy room | 40 k | 10 | about 4 MB |
| Vault (X1) | 40 k | 8 | about 4 MB |
| Flex suite (PIT) | 10 k | 5 | about 2 MB |
| Other devices (Swoop, Aletta, Naeotom skin, Toumai skin) | about 80 k | 18 | about 8 MB |
| Live canvases (about 8 at 512 x 512, shared with the card) | - | included | about 16 MB |

**Warning.** The measured baseline already reaches 122-228 draw calls and 316-490 k triangles on the laptop, and the Quest limit is under 200 in stereo (ROADMAP-PLAN). The pavilion can only be added if each room is culled when out of sight (the existing level and region visibility code) and if the pavilion's rooms are visible only while the viewer is inside the atrium's east half or the pavilion. Gate this with `?probe=1`, and make the budget a test: a script that prints triangles and draw calls per glb and fails when a device exceeds its row.

### Test ideas (all node tests, `--maxWorkers=2`)
- **Determinism:** the same seed gives the same device trace hash for the whole day, and a warm start equals a replay.
- **Termination:** every `DeviceRun` reaches `idle`; every patient and porter returns to a legal spot; no forced steps (zero safety-net teleports).
- **No deadlock:** two demos in one room queue; a demo requested while the porter is busy waits and starts later; 10x and 30x skip never leaves a device mid-phase.
- **Reachability:** each `anchor`, `operator`, `assist`, and `table` spot is reachable from the atrium through the nav graph.
- **Rig:** pure `motion.ts` returns finite poses for every `progress`; limits hold; `noAllocations`.
- **Content:** section 8's checks; glb node names versus `nodes`; glb validator 0 errors; triangle and material budgets.
- **Tour:** each stop's shot lies inside its area; `unfocus` restores the overview; repeat and skip leave the sim consistent.
- **Screens:** redraw count at most 2 per second in a 60-s run; no draw when the content is unchanged.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| **Trademarks and logos.** Real brand names, logos and product shapes. | Use our own generic models; the maker and model name only in the info card text (nominative use); `licence.logo: 'none'` by default; a manufacturer's own model comes only through the pinned asset gate with a written licence. Ask legal before a public release. |
| **Medical accuracy.** A wrong indication or claim in front of doctors. | Every card has sources and an `asOf` date; a clinician reviews each card before release (`review` field); the wording avoids "cures" and "kills" and says "ablates", "treats" or "is cleared for"; statuses are copied from regulators or cited news only; all [U] items are checked first. |
| **Status changes.** Approvals move (Hugo's general-surgery filing, Edison's kidney request, Prime's FDA date). | A quarterly refresh task, the `asOf` field and a warning test. |
| **Investigational products shown as normal care.** PIT outside Japan, FLASH, brain-computer interfaces. | A visible "approved in Japan / investigational elsewhere" chip; no efficacy numbers on the card. |
| **Single-source facts.** Hugo's later filings, Moxi's acquisition, Wandercraft's clearance, the Toumai NMPA date. | Tagged [C]; do not use them on a card until a second source is found. |
| **Quest budget.** Section 10. | Culling, one shared MR magnet, merged materials, a budget test. |
| **Blender pipeline not ready.** All devices assume Wave-4 tooling. | Wave A can start with procedural geometry behind the same node names and swap later. |
| **Patient realism and consent.** Synthetic patients only, no real data; a scripted demo may look like a recommendation. | The `SIMULATED DEMO` chip on every screen; no real images; the card says the sim makes no clinical decisions. |
| **Scope.** Twenty-seven devices is a lot. | The engine is generic; only the top 8 get rigs. The rest are cards (text and a poster) in a "Wall of devices" panel. |

---

## 12. Open questions for the owner

1. Which "laser machine" did you mean: MR-guided laser ablation (Visualase, NeuroBlate), photoimmunotherapy (Akalux), or something else you saw? I would build Visualase first, and Akalux in Wave C unless you say it is the one.
2. Annex east of the atrium (recommended) or carve the atrium's east third?
3. Should investigational devices (FLASH, brain-computer interfaces) appear at all, as clearly labelled cards?
4. Are there Korean or other vendors that you want represented? Only Angel Robotics was verified.
5. Do you have contacts at any vendor? A manufacturer's model, or a quote for a card, changes the licence plan.
6. May the platform (Wave A) change `places.ts` additively now, even before the pavilion?

---

## Sources

Regulatory and product facts (all fetched or returned by search during this research, October 2026):

- Medtronic, Visualase V2 510(k): https://news.medtronic.com/Medtronic-receives-FDA-510-k-clearance-for-Visualase-TM-V2-MRI-Guided-Laser-Ablation-System ; K250307 summary: https://fda.innolitics.com/device/K250307 ; SW 3.4 summary (thermometry, shut-off): https://fda.innolitics.com/device/K211269 ; Medtronic brochure: https://www.medtronic.com/content/dam/medtronic-wide/public/united-states/products/surgical-energy/ablation/visualase-v2-brochure.pdf
- Monteris NeuroBlate: https://www.clinicaltrials.gov/study/NCT02880410 ; https://www.auntminnie.com/clinical-news/mri/article/15605885/monteris-nets-fda-ok-for-mri-guided-laser
- HistoSonics Edison: https://www.medicaleconomics.com/view/histosonics-wins-ce-mark-approval-for-edison-system-liver-tumor-device ; https://www.medicaleconomics.com/view/histosonics-seeks-fda-authorization-to-expand-focused-ultrasound-system-to-kidney-tumors ; https://510k.innolitics.com/device/K233466 ; https://510k.innolitics.com/device/K241902
- Insightec Exablate Neuro: https://insightec.com/news/insightec-announces-fda-approval-of-staged-bilateral-focused-ultrasound-treatment-for-parkinsons-disease/ ; Health Canada, Prime: https://insightec.com/news/insightec-secures-health-canada-approval-for-exablate-prime-system/ ; https://www.insightec.com/global/exablate-neuro/ ; arXiv hardware description: https://arxiv.org/pdf/2501.00179
- Rakuten Medical, Akalux and BioBlade: https://clinicaltrials.gov/study/NCT03769506 ; https://rakuten-med.com/us/news/press-releases/2026/07/30/8004/ ; https://pulse2.com/rakuten-medical-100-million-series-f/amp/ ; https://pmc.ncbi.nlm.nih.gov/articles/PMC7595598
- RefleXion X1 and SCINTIX: https://www.businesswire.com/news/home/20230130005765/en/RefleXion-Receives-FDA-Clearance-for-SCINTIX-Biology-Guided-Radiotherapy-Cutting-edge-Treatment-Applicable-for-Early-and-Late-stage-Cancers ; https://pmc.ncbi.nlm.nih.gov/articles/PMC8260396 ; https://physicsworld.com/a/first-in-human-study-reveals-potential-of-biology-guided-radiotherapy/
- Varian Ethos, Halcyon, HyperSight: https://www.businesswire.com/news/home/20250430039992/en/More-Impact-Together-Varian-and-Siemens-Healthineers-Portfolios-Highlight-More-Impact-Innovations-and-More-Breakthroughs-Throughout-Cancer-Care-Journey-at-ESTRO-2025 ; Varian FLASH, FAST-01: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9893728/ ; https://physicsworld.com/a/first-trial-in-humans-reveals-promise-of-flash-proton-therapy/
- Elekta Unity: https://www.indianpharmapost.com/healthcare/lite/hcg-begins-cancer-treatment-with-karnatakas-first-elekta-unity-mr-linac-21257 ; https://www.auntminnie.com/clinical-news/mri/article/15628526/elekta-reaches-elekta-unity-milestone ; https://www.bioworld.com/keywords/19496-mr-linac
- Profound TULSA-PRO: https://profoundmedical.com/510k-clearance-for-tulsa-pro/ ; https://ir.profoundmedical.com/news-events/press-releases/detail/92/profound-medical-announces-first-patients-treated-in-prospective-randomized-clinical-trial-comparing-the-tulsa-procedure-to-radical-prostatectomy
- Accuray: https://www.dotmed.com/legal/print/story.html?nid=64241
- Focal laser ablation, payer policy: https://medicalpolicy.bcbsil.com/content/dam/bcbs/medicalpolicy/pdf/surgery/SUR717.004_2026-01-01.pdf ; https://www.blueshieldca.com/content/dam/bsca/en/provider/docs/medical-policies/Focal-Treatments-Prostate-Cancer.pdf
- Novocure: https://www.novocure.com/novocure-reports-fourth-quarter-and-full-year-2025-financial-results-and-provides-company-update ; https://www.sec.gov/Archives/edgar/data/1645113/000164511326000017/nvcr-20251231.htm ; https://www.businesswire.com/news/home/20241121353761/en/FDA-Approves-Novocures-Innovative-HFE-Transducer-Arrays-for-Use-With-Optune-Gio-for-Glioblastoma ; https://ascopost.com/issues/october-25-2015/fda-approves-expanded-indication-for-medical-device-to-treat-newly-diagnosed-glioblastoma-multiforme
- Siemens Healthineers Naeotom Alpha class: https://auntminnie.com/clinical-news/ct/article/15739526/siemens-healthineers-fda-clears-siemens-naeotom-alpha-class-of-pcct-scanners ; https://siemens-healthineers.com/en-us/computed-tomography/photon-counting-ct-scanner/naeotom-alpha ; https://origin.digitalpr.jp/pdf.php?r=114605 ; MAGNETOM Flow: https://www.siemens-healthineers.com/en-uk/press-room/press-features/magnetom-flow
- Hyperfine Swoop: https://investors.hyperfine.io/news-releases/news-release-details/hyperfine-announces-fda-clearance-next-optive-aitm-software ; https://www.hyperfinemri.com/hyperfine-regulatory-clearances ; https://hyperfine.io/assets/files/Swoop_System_%28v2%29_Summary_Specifications_Sheet_-_LBL-003695_v1.pdf ; https://hyperfine.io/assets/files/Swoop_System_v2_Brochure_-_LBL-003648_v2.pdf
- United Imaging uMR Jupiter 5T: https://www.biospace.com/united-imaging-receives-fda-clearance-for-breakthrough-5t-mri-system ; https://www.diagnosticimaging.com/view/fda-clears-5t-whole-body-mri-system
- Medtronic Hugo: https://www.eweek.com/news/medtronic-hugo-robot-fda-approval/ ; https://www.urologytimes.com/view/hugo-robot-assisted-surgery-system-launches-on-us-market
- CMR Versius Plus: https://cmrsurgical.com/news/cmr-surgical-secures-510k-clearance-of-its-versius-plus-robotic-surgical-system ; https://www.medtechdive.com/news/CMR-Surgical-FDA-clearance-Versius-Plus-robot/808140/
- MicroPort Toumai: https://microport.com/news/toumai-tele-robotic-surgical-system-becomes-first-globally-approved-for-commercial-use ; https://microport.com/news/microport-medbot-s-toumai-completes-worlds-first-fda-ide-approved-usa-africa-robotic-telesurgery ; https://microport.com/news/toumai-surgical-robotic-system-receives-eu-ce-mdr-certification-for-robot-assisted-telesurgery ; https://bellvitgehospital.cat/index.php/en/news/news/first-public-hospital-in-spain-to-test-the-new-chinese-surgical-robot-toumai
- Medicaroid Hinotori: https://www.medtechdive.com/news/medicaroid-wins-europes-ce-mark-for-hinotori-surgical-robot/824959/ ; https://www.surgicalroboticstechnology.com/news/medicaroid-receives-regulatory-approval-for-hinotori-surgical-robot-system/
- Robotic bronchoscopy: https://www.medtechdive.com/news/JNJ-Monarch-FDA-clearance-Nvidia-GE-Healthcare/742370/ ; https://consultqd.clevelandclinic.org/novel-bronchoscopy-platforms-for-biopsy-of-peripheral-pulmonary-lesions
- XACT Robotics: https://www.fiercebiotech.com/medtech/xacts-needle-guiding-robot-scores-fda-clearance-ablation-procedures ; https://www.fiercebiotech.com/medtech/fda-clears-xact-s-hands-free-robotic-needle-surgery-system
- Vitestro Aletta: https://medtechinnovator.org/vitestro-achieves-ce-marking-for-autonomous-blood-drawing-device/ ; https://www.clinicaltrialsarena.com/news/vitestros-robotic-blood-drawing-device-meets-trial-endpoints/ ; https://clpmag.com/lab-essentials/lab-automation/fda-authorizes-robotic-blood-draw-device/ ; https://runtimewire.com/article/fda-authorized-vitestro-aletta-autonomous-blood-drawing-robot ; https://content.govdelivery.com/accounts/USFDA/bulletins/425bb55
- Diligent Moxi: https://www.healthcaredive.com/press-release/20250715-diligent-robotics-leads-us-adoption-of-hospital-pharmacy-robotics-redef/ ; https://www.therobotreport.com/diligent-robotics-hits-1m-picks-with-moxi-robot-in-healthcare-settings/
- Aktiia Hilo: https://www.biospace.com/press-releases/aktiias-hilo-band-becomes-first-cuffless-blood-pressure-monitor-cleared-by-fda-for-over-the-counter-use ; https://www.fiercebiotech.com/medtech/fda-clears-over-counter-cuffless-blood-pressure-monitor-hilo-bracelet
- Exoskeletons: https://www.biospace.com/fda-issues-clearance-for-the-restore-exo-suit-the-first-soft-robotic-system-for-stroke-therapy ; https://www.komachine.com/en/companies/angelrobotics ; https://recruit.angel-robotics.com/en/company/newsroom
- BrainsWay: https://spectrum.ieee.org/brain-stimulation-approved-ocd ; https://www.fiercebiotech.com/medtech/fda-clears-brainsways-deeper-neurostimulation-approach-depression-treatment
- Paige Prostate: https://www.biospace.com/paige-receives-first-ever-fda-approval-for-ai-product-in-digital-pathology
- Butterfly and Caption: https://www.businesswire.com/news/home/20220228005235/en/Butterfly-Network-Introduces-Butterfly-Blueprint-and-Worlds-First-FDA-Cleared-AI-Guidance-Interpretation-Software-to-Support-the-Practical-Application-of-Ultrasound-Information/
- The "laser kills cancer" press stories (research, not devices): https://www.weforum.org/stories/health-and-healthcare-systems/new-laser-zaps-and-destroys-cancer-cells-in-real-time/
- Synchron and Neuralink (investigational, not on the list): https://beyondtmrw.org/article/brain-computer-interface-clinical-trials-accelerate-in-2026

Project files read for the audit: `CLAUDE.md`, `docs/handover/ROADMAP-PLAN.md`, `docs/S1-SHOWCASE.md`, `docs/ASSETS-POLICY.md`, `src/sim/places.ts`, `src/sim/levels.ts`, `src/sim/imaging/{scanner,exam}.ts`, `src/sim/surgery/robot.ts`, `src/scene/imaging/{live.ts,machines/*}`, `src/scene/camera/roomFocus.ts`, `src/scene/interact.store.ts`, `src/scene/interact/surgery/teaching.ts`, `src/ui/RoomPanel.tsx`, `src/content/{schema,endoscopeUi}.ts`, `src/scene/landscape/exterior.ts`.

---

## Owner decisions (2026-10-22)
- **The laser device:** MRI-guided laser ablation (Medtronic Visualase V2) is the "laser that kills cancer". It stays #1, in Wave B, in the annex MR suite.
- **Placement:** build the new "Advanced Therapies" annex east of the atrium (x 40..70, z -12..12), with its contract changes in `places.ts`/`types.ts`/`config.ts`. Don't carve the atrium.
- **Regulatory status:** devices not yet approved in the US/EU may appear on the tour, clearly labelled "investigational / not approved in your region" on the device card.
