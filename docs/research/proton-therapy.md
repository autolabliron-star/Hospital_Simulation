# Proton therapy with pencil-beam scanning on a rotating gantry: the factual basis for a machine, a room and a watchable treatment

Research date: 2026-10-31. Written so that a later wave can model the machine and its room in Blender and script a step-by-step treatment in the R5 procedure engine, the way the surgeries and the cryo suite are scripted today. Synthetic patients only; educational; the simulation makes no clinical decisions and nothing here is medical advice. Companion to `docs/research/procedures.md` (style and structure copied from it) and `docs/research/new-devices.md` (the earlier device survey, row 10 of its table). Regulatory and market facts are "as of October 2026".

## 0. Summary and how to read this document

**Confidence tags** (the same as `new-devices.md`), plus a source number `[n]` that points into section 9:
- **[V]** read in a primary or trade source during this research (a regulator, a hospital page, a paper, a press release);
- **[C]** a company claim, or a single source or search excerpt I could not cross-check;
- **[U]** from background knowledge or common practice, not re-verified. Check it before it goes into content or a card.
- **target:** a size or number chosen for our own generic model. It is not a vendor specification.

**What it is.** A proton accelerator (a cyclotron or synchrocyclotron) makes a beam of protons. A beamline carries it to a rotating gantry, and a scanning nozzle paints the tumour with thousands of narrow beam spots, one energy layer after another. Protons stop at a set depth (the Bragg peak), so almost no dose leaves the far side of the tumour. The patient lies on a six-axis robotic couch in a thick-walled concrete room, held still by a mask or cushion and checked by X-ray and cone-beam CT before each beam [3][5][13][46].

**Why it is among the most advanced cancer machines.** It is one of the biggest machines in any hospital (a gantry three storeys tall, 100 tons in older designs) yet it aims its beam with a stated range accuracy of 0.1 g/cm² (about 1 mm of water, from the FDA summary of one system) [15][45]. It is also still being proved: randomised trials against the best photon radiotherapy are only now reporting, and the results are mixed (section 3) [30][31][32][33]. About 125-133 particle facilities were running worldwide by 2023-2025 [25][28], so it is rare, and a hospital that has one is a clear mark of a specialist cancer centre.

**Recommended base for our generic machine.** A **single-room compact gantry system modelled on the Varian ProBeam 360°**: a superconducting isochronous cyclotron next door, a short beamline, a full 360° isocentric gantry, a scanning nozzle with a retractable snout, a nozzle-mounted cone-beam CT arm and a six-axis robotic couch [13][43]. Reasons: both NHS national centres (The Christie, UCLH) run the ProBeam family, so the UK reference points match [7][8][9]; the FDA record for the 360° gives real parameters to copy (226 MeV, 25 x 25 cm field, six-axis couch with a 226 kg load, nozzle-mounted CBCT) [13]; the gantry turning between fields is the most watchable moment. **Compact fallback for the Quest budget:** the Mevion S250i style, where the whole accelerator rides on the gantry (13.6 t) so there is no separate cyclotron room or beamline [17]. **Not recommended as the base:** the Mevion S250-FIT with the Leo Cancer Care upright chair, because it has no rotating gantry (the patient turns instead). It is, however, the only proton type that fits our existing annex slot (section 2.4) [15][19].

**Footprint verdict.** `new-devices.md` judged a proton gantry room "not feasible in the pavilion (15 m or more across)". Checked against 2026 systems, that is half right:
- **Rotating gantry, compact single room:** no longer 15 m or more across, but still about **13 x 14 m in plan and about three storeys (9-10 m) high**, with concrete walls of 1-2.3 m (Mevion S250i at Mercy: vault 42 x 47 ft = 12.8 x 14.3 m, three storeys, walls 3-7.5 ft) [17][C]. A complete single-room addition with its support rooms is about **1,100 m²** (Penn Medicine Lancaster General, ProBeam 360°: 12,100 sq ft) [44]. A press estimate for the IBA Proteus ONE is about 15 x 29 m including shielding (49 x 95 ft) [55][C]. This does **not** fit the annex as drawn (`atRt` 12 x 7.5 m, or the 20 x 10 m north strip) and does not fit under our 3.0 m wall height.
- **Fixed beam with an upright seated patient (Mevion S250-FIT + Leo Marie):** fits a **standard linac vault of about 110 m²** (1,200 sq ft), proved at Stanford (unveiled 7 April 2026, first patient 4 June 2026) [15][16][19]. The planned `atRt` slot plus its control room is about 120 m², so it fits with small changes. There is no rotating gantry to film.
- **So:** either extend the annex by a "proton wing" (about 20 x 24 m with a raised roof, section 7.2) or build a separate pavilion of about 1,100 m². Both need contract changes.

**Comparison with the MR-Linac (Elekta Unity).** Unity is the alternative "most advanced" machine for the same hall. It joins a 1.5 T Philips MRI to a 7 MV flattening-filter-free photon linac on a ring gantry (700 mm bore) so the team sees soft tissue live and re-plans on the day [47][C]. It was cleared in 2018 (FDA and CE) and about 100 systems were installed by 2021 [47][C]. It uses X-rays, so it has no Bragg peak and cannot match proton conformity in a child's brain, but it sees moving soft tissue (pancreas, liver, prostate) that protons struggle with [U]. It is far cheaper (a linac-sized vault, no cyclotron), fits the existing 12 x 7.5 m `atRt` slot [U], and its story is "see and adapt" while the proton story is "stop exactly there". The two are complements, not rivals, and the annex plan could host both (Unity in `atRt`, protons in a proton wing).

## 1. How it kills cancer, in plain words

- **Photons and protons.** A normal radiotherapy beam (photons, which are X-rays) enters, loses strength slowly and leaves the far side. A proton beam deposits little dose on the way in, a large burst of dose at the very end of its path (the **Bragg peak**), and almost none beyond. The Christie's patient FAQ puts it the same way: protons release their energy at a set point, so there is little or no dose past the tumour [5].
- **Energy sets the depth.** The cyclotron makes one energy. A degrader (a wedge of carbon) and an energy selector lower it for each layer. Treatment energies run from about 70 MeV to 230-245 MeV, which is a depth of about 4 to 32-38 cm of water [20][21]. Typical patient treatments use only 1-2 nA of beam current (up to 10 nA at the nozzle) [20].
- **Pencil-beam scanning (PBS).** The beam is a pencil about 4-8 mm wide (sigma 4.0 mm at 245 MeV and 6.0 mm at 70 MeV in a commissioning report; the FDA summary for Mevion lists 5 mm or less at top energy and 15 mm at low energy) [20][15]. Scanning magnets move the pencil spot by spot across one **energy layer** (a slice at one depth). The machine then changes energy to move to the next layer. A change takes under 1 s (planned for the ProBeam; about 0.9 s reported for the Proteus ONE) and a whole field takes about 2-4 minutes of beam time [20][21][48][C].
- **Fields.** The tumour is treated from several gantry angles (three is typical for head and neck). Each angle is a **field**. The plan adds up thousands of spots into one shaped dose (intensity-modulated proton therapy, IMPT) [13][46].
- **Range uncertainty.** We know where a proton stops only to within a few per cent of its depth, because the CT scan is turned into "stopping power" by a model and the patient can change shape between days. Planners therefore use **robust optimisation**: the plan must still work if the range is 3.5 % longer or shorter and the patient sits a few millimetres out (13 scenarios in one protocol: the nominal plan plus six shifts, each at plus and minus 3.5 %) [41][C]. Planning also uses a fixed biological factor of 1.1 for protons compared with photons, a known simplification [41].
- **Why it matters for children and for tumours beside critical organs.** Less dose to healthy tissue means fewer late effects in growing children (hearing, hormones, thinking, second cancers) and a better chance of reaching a high dose in a tumour next to the brainstem, optic nerves or spinal cord. NHS England commissions it for children, teenagers and young adults on this basis, and adds that photons stay the choice where protons give no dose advantage (whole-brain, total-body, limbs) [2][35].
- **FLASH is investigational only.** FLASH delivers the dose in a fraction of a second. Only two small in-human proton trials exist (FAST-01 and FAST-02, 10 patients each, on a modified ProBeam). It is not an approved mode. Mevion lists a FLASH kit as research use only [36][16].
- **Proton arc therapy** (the gantry turns while the beam is on) is also not yet routine: IBA's DynamicARC awaits regulatory clearance, and a static version has treated a handful of patients at Trento [23][53][C].

## 2. The machine and the rooms

### 2.1 The parts, in the order the beam meets them

| Part | What it does | Real facts | Tag |
|---|---|---|---|
| Ion source | Makes protons from hydrogen gas by stripping the electron | Hydrogen gas, one electron removed | [V] [46] |
| Accelerator | A **cyclotron** (steady beam) or **synchrocyclotron** (pulsed beam), superconducting in all current compact designs | ProBeam 360°: isochronous, superconducting, 226 MeV. IBA S2C2 synchrocyclotron: 230 MeV, 1 kHz pulses of 10 microseconds. Mevion S250i: 230 MeV superconducting synchrocyclotron on the gantry | [V] [13][22][15] |
| Energy selection | Carbon wedge degrader and slits lower the energy (70 to 250 MeV) and lose 98-99.75 % of the beam doing so | Energy change between layers under 1 s (ProBeam, planned); Mevion HYPERSCAN says under 50 ms | [V] [20]; [C] [18] |
| Beamline | A vacuum pipe with bending and focusing magnets, hidden in walls and floor | In multi-room centres one beam is shared by all rooms, so a patient can wait for the beam | [V] [3][46] |
| Gantry | A rotating steel frame with bending magnets that points the beam at the patient from any angle | ProBeam 360°: 360°, source-to-isocentre 2.28 m (older ProBeam); Proteus ONE: 220° plus couch turn for 360° access; Hitachi PROBEAT-V: 190° half gantries | [V] [20][21]; [C] [29] |
| Nozzle and snout | Scanning magnets, two ionisation chambers (dose monitors) and a snout that slides toward the patient | Snout travel 3-42 cm from isocentre; range-shifter plates 5, 3 and 2 cm thick; field 25 x 25 cm (ProBeam 360°), 30 x 40 cm (older ProBeam), 20 x 24 cm (Proteus ONE) | [V] [20][13][21] |
| Robotic couch | Six axes (three moves, three turns) plus a turn of the whole couch about a vertical axis | ProBeam 360°: Leoni-based six-axis, 226 kg (500 lb) load. Mevion S250i: 400 lb; upright S250-FIT: 330 lb | [V] [13][15] |
| In-room imaging | Orthogonal kV X-ray pair, cone-beam CT (CBCT) and optical surface cameras | ProBeam 360°: nozzle-mounted 2D and 3D CBCT. Proteus ONE: floor and ceiling stereo kV plus a gantry-mounted retractable kV arm for CBCT. S250i: 2D X-ray. S250-FIT: integrated CT in the Leo chair | [V] [13][21][15] |
| Immobilisation and devices | Thermoplastic mask, vacuum bag, head rest, bite block, range shifter, aperture | Mask or cast made at the assessment visit; Christie uses MR-safe immobilisation | [V] [4][7] |
| Safety system | A hardwired interlock chain independent of software | Mevion lists a Hardwired Safety System as one of six subsystems | [V] [15] |

### 2.2 The makers and models in use in 2026

| Maker | Model and room type | Accelerator and gantry | Status, October 2026 | Tag |
|---|---|---|---|---|
| **Varian** (a Siemens Healthineers company) | ProBeam (multi-room) and ProBeam 360° (single room) | Isochronous superconducting cyclotron, 360° gantry, PBS, CBCT. Made in Troisdorf, Germany | 360°: FDA K221791, 1 Dec 2022. v2.0 multi-room K231863, Oct 2023. v3.0 K252815, cleared 23 Apr 2026. Both NHS centres run three clinical ProBeam gantries. FLASH trials ran on a modified ProBeam | [V] [13][14][9][7]; [C] v2.0 |
| **IBA** (Belgium) | Proteus ONE (compact, single room) and Proteus Plus (multi-room, [U]); Ichilov in Tel Aviv has two Proteus ONE under contract | S2C2 synchrocyclotron, 230 MeV, compact gantry 220°, PBS, six-axis couch | Ichilov: contract Sep 2023, expected to treat from 2026, not confirmed open. DynamicARC arc mode awaits clearance | [V] [21][22][23]; [C] status |
| **Mevion** (US) | S250i (gantry-mounted accelerator, supine) and S250-FIT (fixed beam, seated patient on the Leo Marie chair) | 230 MeV superconducting synchrocyclotron, HYPERSCAN scanning, Adaptive Aperture proton collimator. Named "250" but FDA lists 230 MeV | S250-FIT: FDA K250986, 12 Sep 2025; CE (MDR) announced 25 Feb 2026; first patient 4 Jun 2026 (a child); nine contracts signed. Mevion single-room systems have been in clinical use since 2013; an S250i has run at ZON-PTC in Maastricht since 2018 | [V] [15][16][19] |
| **Hitachi** (Japan) | PROBEAT-V (multi-room, 190° half gantries) and PROBEAT-RT (compact single room) | Accelerator type not confirmed in sources read | Order 30 Jun 2025 for Komagome Hospital, Tokyo: one accelerator, two rotating gantry rooms, start FY2030. "Over 120,000 patients" on Hitachi systems to Dec 2024 (company, from PTCOG data) | [V] [29]; [C] counts |
| **Leo Cancer Care** | Marie: upright positioner with a CT scanner | Used with the Mevion S250-FIT; no gantry | See above | [V] [15][19] |
| **P-Cure** (Israel) | Compact gantry-less system with an upright patient | Hadassah (Israel's first proton service, from June 2023) finished a first child cohort in Jan 2026 | Company and press only | [C] [24] |
| Sumitomo Heavy Industries, ProTom | Not researched for this document | | | [U] |

### 2.3 Modelling sizes and weights for our own generic model (targets, not vendor specs)

| Part | Target for the model | Real anchor |
|---|---|---|
| Gantry, rotating structure (hidden mostly) | drum about 9-10 m diameter, 9 m high, rotates 360° | Older gantries about 12 m (40 ft) across, 3 storeys, 100 t [45][46][V]; "conventional more than 13 m" (patent text, [C]); compact designs are smaller but no figure was found |
| Gantry face seen from the room | a flat circular wall plate about 5 m across that turns with the gantry, with a slot for the nozzle | Not in sources: design choice [U] |
| Nozzle with snout | body 0.7 m across; snout 0.45 m across, travels from 0.4 m to 0.03 m from the head (3-42 cm in the report) | Snout travel 3-42 cm [20][V] |
| Cone-beam CT arm and panel | two retractable arms, each about 1.5 m, swing out from the nozzle | [13][21][V] |
| Couch | six-axis robot base, lift column, top 0.5 x 2.1 m; turns about a vertical axis (265 to 95 degrees in one report) | [13][20][V] |
| Cyclotron (separate room) | drum about 3 m across and 3 m tall, 50-90 t | S2C2 55 t [C]; Christie 90 t [C]; UF older cyclotron 220 t [V] [45][10] |
| Accelerator on the gantry (fallback) | drum about 2.5 m across riding on the gantry ring | S250i accelerator 30,000 lb (13.6 t) [17][V] |
| Moving floor | a floor segment that moves with the nozzle so the patient-side floor stays flat | Sagentia describes a "moving floor structure" for the ProBeam 360° [43][V] |
| Consoles in the control room | three desks, each with two or three screens, plus a wall of camera and monitor screens | [U] |

### 2.4 The treatment room, shielding, maze, door and control room

| Tier | Example | Facts | Tag |
|---|---|---|---|
| Large multi-room centre | UF Health (5 rooms); The Christie; UCLH | Gantry 3 storeys, 40 ft (12 m) across, 100 t. Cyclotron room walls 18 ft (5.5 m) of high-density concrete. A five-room centre covers about a football field. Christie walls up to 6 m. UCLH: 44,000 m³ of concrete, walls typically 2 m and up to 5 m, 8,000 t of steel, built about 25 m below ground. Christie cost about £100m | [V] [45][46]; [C] [10][11] |
| Compact single room, rotating gantry | Mevion S250i at Mercy (St Louis); Proteus ONE; ProBeam 360°; PROBEAT-RT | Mercy: vault 42 x 47 ft (12.8 x 14.3 m), three storeys, walls 3-7.5 ft (0.9-2.3 m), roof 7.5 ft (2.3 m), in a 17,000 sq ft three-storey addition. It is not stated whether the vault size is inside or outside. Penn Lancaster General: 12,100 sq ft addition with a single-room vault. Proteus ONE: about 49 x 95 ft including shielding (2010 press). Varian says the 360° cut vault cost by about 25 % and footprint by 30 % compared with its earlier room | [V] [17][44]; [C] [55][44] |
| Fixed beam, upright patient | Mevion S250-FIT with Leo Marie | Installed in a standard 110 m² (1,200 sq ft) linac vault; Stanford checked leakage by simulation and the old walls were adequate. Leo says about 1,700 sq ft in all, against over 29,000 sq ft for a conventional proton centre | [V] [16][19]; [C] 1,700 sq ft |

- **Walls and roof.** Proton rooms are shielded against neutrons as well as the beam. Real thickness runs from about 1-2.3 m (compact) to 5-6 m (large centres) [17][45][10]. In the sim keep the wall at 0.2 m (`WALL.thickness`) and draw a baffle wall, a heavy door and a "concrete block" roof in Blender, as `new-devices.md` section 6 says for vaults [54].
- **Maze and door.** A maze (a dog-leg corridor) cuts the radiation that reaches the door. One design study (MD Anderson, Monte Carlo) dropped the maze and used massive concrete and steel doors, because a maze costs floor space. High-energy rooms also use borated polyethylene on the door to catch neutrons [42][C]. Target for the model: a sliding door leaf 1.8 x 2.3 m and 0.4 m thick, opening in about 15 s, at the end of a 3 x 8 m maze with one bend [U].
- **Height.** The gantry chambers take the full height of the building, almost three storeys [10][C]. In the sim the gantry could sit in a floor pit, but the level system is hard-coded to two levels (`docs/research/new-devices.md` section 1), so draw the gantry above the floor in a raised-roof block.
- **Sim comparison.** The annex plan has `atRt` 12 x 7.5 m (90 m²) plus a 12 x 2.5 m control room (30 m²), and `atPlant` 8 x 10 m. `WALL.height` is 3.0 m [54]. A gantry room needs about 13 x 14 m and 9-10 m of clear height. A fixed-beam upright room needs about 110 m² and normal height.
- **Control room.** A treatment control area sits outside the shielding and sees the room only by cameras. The NHS England specification requires a gantry that is remotely controllable from outside the room, and "full unhindered use of general anaesthesia within the treatment room" [1][V]. Inside the room: the couch hand pendant, two or three cameras, an intercom speaker and microphone, red beam-on lamps, search panels and an emergency-stop (the interlock sources do not all name them for protons) [49][C].
- **Patient flow rooms.** NHS England also lists separate adult and children's flow, consulting rooms, play and reception areas, induction and recovery rooms for anaesthesia, and patient and carer accommodation [1][V]. UCLH has a dedicated children's anaesthetic suite with induction rooms and recovery [12][C].

### 2.5 What each screen shows (all numbers on our screens must be synthetic, with a corner chip `SIMULATED DEMO`)

The layouts below are designed from patent, paper and hospital descriptions, not copied from a vendor console [56][38][C].

| Screen | Where | What it shows | Redraw |
|---|---|---|---|
| **Treatment console** | control room, desk 1 | Patient name and ID, plan name, fraction n of N, a field table (gantry angle, couch angles, snout position, range shifter, energy range, number of layers, number of spots), the selected field in a highlight, a beam status banner (WAITING FOR BEAM, READY, BEAM ON, PAUSED), a progress bar and "layer i of N", an interlock panel of green lamps (door closed, search complete, imaging arms stowed, couch still, accelerator ready, gantry at angle) [20][56][49] | 2 Hz |
| **Beam's-eye view** | beside the console | The spot map for the layer being delivered, redrawn when the energy changes: dots filling in, row by row, inside the target outline [56][C] | 2 Hz |
| **Imaging registration** | control room, desk 2 | The planning CT in grey with the day's CBCT overlaid in colour in three planes; a tolerance box on the bones; a table of six shifts (left-right, up-down, head-foot in mm; pitch, roll, yaw in degrees); an Accept and Apply button; later a second pair of images with smaller residuals [38][13] | 4 Hz while focused (allowed by CLAUDE.md), else 2 Hz |
| **Surface guidance** | bedside tablet and control room | A coloured map of the face compared with the planning scan, green inside plus or minus 4 mm and 3 degrees, red outside (one US institution's tolerance) [38][C] | 2 Hz |
| **Accelerator status** | engineers' room and a small panel in the control room | Source current, dee voltage, energy setpoint, beam current at the nozzle (a few nA), cyclotron "ready" [20][22] | 1 Hz |
| **CCTV wall** | control room | Three camera views (patient's face, couch and nozzle, gantry and door), and for children the anaesthetic monitor repeated (heart trace, oxygen level, end-tidal CO2, breathing rate) [37][3] | 2 Hz |
| **Patient monitor** | beside the couch (child cases) | Heart trace, oxygen level, CO2 trace, breathing rate, blood pressure | 2 Hz |

### 2.6 Daily quality assurance and the people

- **Before the first patient (daily QA).** The physicist and the engineer, with a radiographer, run a short check in each room. Output (about 1-3 %), range (the 90 % depth within 1 mm of baseline), spot position (1.5 mm) and spot size (10 %), plus the agreement of the X-ray and beam isocentres (1.5 mm), the couch and the interlocks. It takes about 10-20 minutes per room with a purpose-built device (Sun Nuclear DailyQA3, IBA Sphinx Compact or a home-made phantom). The guidance is AAPM Task Group 224 [39][C]. The record is signed before the console will start a treatment [U].
- **Each plan.** A patient-specific measurement in a water or detector phantom, in the room, takes about 17-65 minutes per complex plan, and some centres now use log-file checks instead [40][C].
- **Monthly and yearly.** Longer checks by the physics team, with engineers from the maker on call. Varian engineers give 24-hour on-site cover at The Christie [7][V].
- **Who.** Clinical oncologist (prescribes, approves the plan), therapeutic radiographers (treat), medical physicist (QA, plan check), dosimetrist (builds the plan), medical engineers, a keyworker, nurses, administrators; for children also an anaesthetist, an anaesthetic practitioner (ODP), a health play specialist and recovery staff [1][6][7].

## 3. Evidence and status

**Indications in current use.**
- **Children, teenagers and young adults (NHS England, policy of 2020):** malignant and non-malignant tumours that are curable, with an MDT agreeing that protons are an option, age from birth to about 25, no spread (with a few exceptions such as germinoma, rhabdomyosarcoma and Ewing sarcoma). Examples named: medulloblastoma, ependymoma, retinoblastoma. Photon radiotherapy stays for whole-brain, total-body and extremity sarcoma [2][V].
- **Adults (NHS England):** a published list of selected indications (the older adult policy covered rare tumours at the skull base or around the spine) [57][C]. Not routine: prostate [5][V]; breast (the policy found too little evidence) [57][C]. The current adult indications list and the NHS Wales policy CP147 (August 2026) were not read.
- **Elsewhere (US and Europe):** base-of-skull chordoma and chondrosarcoma, head and neck, oesophagus, liver, lung, brain and spine, paediatric cancers, ocular melanoma (a low-energy eye line, for example Clatterbridge at 62 MeV), re-irradiation [28][51][V].

**Key trials and registries (as of October 2026).**

| Study | What it found | Tag |
|---|---|---|
| **Frank et al., Lancet 2025 (407:174), oropharynx, 21 US centres** | 440 patients, 70 Gy in 33 fractions. IMPT met non-inferiority for 3-year progression-free survival (82.5 % against 83.0 %). Five-year overall survival 90.9 % against 81.0 % (secondary, interim). Less dysphagia, dry mouth and feeding-tube use after IMPT. Only 72 % and 62 % had the arm they were given. Part-funded by Hitachi America | [V] [30] |
| **TORPEdO (UK), oropharynx, ASTRO 2025** | 205 patients, 136 proton and 69 IMRT. No difference at 1 year in feeding-tube use, swallowing scores or quality of life; severe weight loss was more common with protons (18.2 % against 5.7 %). IMRT "performed better than expected" | [V] [31] |
| **PARTIQoL (US), prostate, ASTRO 2024** | 450 patients. No difference in bowel quality of life at 2 years (change -2.4 against -2.2). Five-year progression-free survival 93.4 % (protons) against 93.7 % (IMRT) | [C] [32] |
| **RADCOMP (US), breast** | 1,239 randomised. Quality of life and cosmetic scores equal at ASTRO 2025. The main endpoint (major cardiac events) is not reported; results are expected in 3-7 years | [C] [33] |
| **NRG-GI006, oesophagus (about 300 patients)**; **NRG-BN005, glioma** (closed Mar 2024, cognition endpoint); **PROTECT (Europe, 396)**; **PROTIEUS (UK, phase 2, 170)** | Designs and recruitment found, **no outcome results found** | [V] design [34] |
| **Children's CNS tumours** | No randomised trial exists and one is unlikely. A 59-child single-centre phase 2 study (Yock, Lancet Oncology 2016) had survival like photon history, 16 % grade 3-4 hearing loss at 5 years and a fall in IQ in the under-8s. A 2026 meta-analysis of ten cohorts (1,034 patients) reports equal survival and less hormone, thyroid, hearing and thinking harm | [C] [35] |
| **FLASH, FAST-01 and FAST-02** | FAST-01: 10 patients (JAMA Oncology 2022). FAST-02, thoracic bone metastases, published June 2026: 10 patients, one 8 Gy fraction at more than 40 Gy per second, 75 % with complete pain relief at 3 months, no serious effects. Investigational only | [C] [36]; FAST-01 [V] in `new-devices.md` |

**Regulatory status (as of October 2026).** Proton systems are US Class II devices (21 CFR 892.5050, product code LHN) cleared by 510(k), not PMA [13][15]. See section 2.2 for the ProBeam 360°, v2.0, v3.0 and S250-FIT clearances. The S250-FIT FDA wording limits the seated position to sites above the mid-chest or carina [15][V]. FLASH and arc delivery are investigational or awaiting clearance [36][53].

**Number of centres and rooms.**
- **Worldwide:** 125-133 facilities in clinical operation (the PTCOG mirror gives 128, 125 on the map with 110 proton and 15 carbon-ion for 2023 data, and a search excerpt gives 133 at May 2025). About 410,000 patients had been treated by the end of 2023, about 350,000 with protons [25][27][C]. A market page gives 89 centres for the start of 2023, which disagrees [28].
- **Europe:** 26 proton centres with 54 rooms across 31 countries in 2025, forecast to reach 43 centres and 77 rooms by 2030. Most rooms treat only 100-200 patients a year against a theoretical 300 [26][C].
- **US:** 41 centres at the start of 2023 (about 45 now) [28][C].
- **UK:** the PTCOG list (September 2025) names Clatterbridge (62 MeV eye line, 1989), The Christie (Manchester, first NHS patient December 2018: three clinical gantries and a fourth research room), UCLH (London, three gantries, opened 2021-2022) and three private Rutherford centres (Newport, Reading, Northumberland). **Rutherford Health went into liquidation in June 2022, so those three are probably not treating** [25][7][52][V]. The two NHS centres are the UK reference [7][8].
- **Israel:** the PTCOG list shows none as of September 2025. Hadassah treats with P-Cure's gantry-less system; Tel Aviv Sourasky (Ichilov) has two IBA Proteus ONE under contract, expected to start in 2026 and not confirmed [25][23][24][C].

**NHS reference numbers.** The Christie had treated 883 patients by the end of September 2022 [7][V]. Each NHS centre was planned for about 750 patients a year at full ramp-up [7][V], and the national service for 330 children and 220 teenagers and young adults a year [2][V]. The government put £250m into the two centres [50][C].

**Typical costs.** About £100m for The Christie building [10][C]; Varian's equipment contract for the two NHS centres was "up to £80m" [8][C]; UF Health: $125m for its original facility and $44m to add a fifth room [45][V]; a single room costs $25-40m at launch prices and over $50m in a 2023 press statement [55][28][24][C]. A cost per treatment course was not found (section 8).

## 4. The patient journey, with times

| Stage | What happens | Real time | Tag |
|---|---|---|---|
| Referral | The local clinical oncologist refers through the PBT portal; an expert panel decides. The Christie does not take self-referrals | days to a couple of weeks | [V] [5][7]; time [U] |
| Consultation | Doctor visit, consent form, side effects explained, a named keyworker | part of the assessment visit | [V] [4][5] |
| Assessment and simulation | **Mask or cast made, then planning CT, together about 1 h 30 min.** An **MRI** (about 1 h) is fused with the CT. Contrast by cannula or drink. Small tattoos on the skin or mask. Children also see anaesthesia and the play specialist. Assessment visits take up to 7 days | 1.5 h CT, 1 h MRI | [V] [4][7] |
| Planning | Oncologist contours the target and organs at risk; dosimetrist plans with **robust optimisation**; oncologist approves; physicist checks; patient-specific measurement in a phantom | **2-3 weeks on average** | [V] [4][41][40] |
| Day 0 | Radiographers do a "Day 0" simulation of the setup before the first beam | one visit | [V] [7] |
| The course | Monday to Friday, appointments 7 am to 9 pm; 3-7 weeks (FAQ), up to 8 weeks (approval page), up to 7 weeks (radiographer paper). Fractions: head and neck 70 Gy in 33; chordoma 74 Gy(RBE) in 37; medulloblastoma craniospinal 23.4 Gy in 13 (1.8 Gy each) then a boost to 54-55.8 Gy in 30; uveal melanoma 4 fractions of about 13-15 Gy (53-60 Gy in total) | 3-8 weeks | [V] [4][5][7][30][51] |
| Daily session | 20-90 minutes in the building, most of it positioning X-rays; beam-on only 2-4 minutes per field. Radiographers stay until beam start. A buzz is heard. Machine failures are made up on Saturdays or by two sessions at least 6 h apart | 20-45 (FAQ), 20-90 (guide) | [V] [3][5] |
| Review | Doctor review each week; a hotline for the first month | weekly | [V] [3][4] |
| Follow-up | At 6 weeks, 6 months, then yearly for 5 years; local team does scans. Children have a baseline thinking assessment when the brain is in the field | | [V] [3][12] |

Throughput hint: one planning filing assumed 30 minutes a patient in year one and 25 in year two, 24 treatments per patient [48][C]. A US vendor claims 15-20 patients per gantry per day [48][C].

## 5. Step tables for one treatment session

**Abbreviations.** Rad1, Rad2: therapeutic radiographers (UK: two in each room for set-up, both at the console for beam-on; the count is [U]; at The Christie "Band 6 proton senior radiographers run the gantries" [7]). Phys: medical physicist. Onc: clinical oncologist. Recep: proton support team member. Anaes: consultant paediatric anaesthetist. ODP: operating department practitioner (anaesthetic practitioner). Play: health play specialist. Nurse: recovery nurse. CR: control room. Room: the treatment room.

**Hands.** L / R as the actor's own left and right. "Pendant" is the couch hand controller.

**Numbers on screens are synthetic examples.** The gantry angles are illustrative [U].

### 5a. Adult head and neck (oropharynx), thermoplastic mask, fraction 12 of 33, three fields

Machine: compact gantry, nozzle-mounted CBCT, six-axis couch. Real time from check-in to leaving: 40-60 minutes; in the room 25-40.

| # | Step | Why | Min | Who does what, and where | Hands (left / right) | Patient state | Machine state and screen view |
|---|---|---|---|---|---|---|---|
| 1 | Arrive and check in at reception | The proton team confirms contact details and today's times [3]. | 3-5 | Recep: at the desk, gives the schedule; patient and a companion in the annex hall | Recep: L: schedule sheet / R: keyboard | Walking, own clothes, bag | CR: patient list shows the day; gantry parked at 0 degrees |
| 2 | Change into a gown in a cubicle | Metal and loose items stay out of the beam and the mask fits snugly [U]. | 3-5 | Patient alone in the cubicle; Rad1 waits in the corridor | L: bag / R: gown | Gown on; glasses, jewellery and hearing aids off | Rad2 in CR: loads today's plan and checks the morning checks are signed [39] |
| 3 | Radiographer calls the name; ID check | Name, birth date and one more detail are checked before anything else [U]. | 1-2 | Rad1: in the annex hall, with the patient | Rad1: L: tablet / R: - | Awake, answers aloud | Console: fraction 12 of 33, three fields |
| 4 | Mask taken from the labelled rack | The mask was made for this patient only [4]. | 1-2 | Rad1 and patient at the mask rack beside the room | Rad1: L: mask / R: base plate | Walking beside Rad1 | - |
| 5 | Control room: plan open, checks signed | The beam starts only with an approved plan and a signed daily check [39][1]. | 2-3 (in parallel) | Rad2: at console 1, CR | Rad2: L: mouse / R: keyboard | - | Console: field table shown; accelerator panel "ready"; interlocks amber |
| 6 | Through the maze; music is chosen | The heavy door and the bend keep radiation in; the patient picks music or an audiobook [3]. | 1-2 | Rad1 and Rad2 walk the patient through the maze; Rad2 slides the door | Rad1: L: guides / R: - | Walking | Door leaf slides open; CCTV on; music starts |
| 7 | Lie on the couch, head on the cushion | The head rest matches the planning scan so the head sits as before [4]. | 1-3 | Rad1 at head (patient's head end), Rad2 at patient's left; patient helped on | L: supports head / R: hand on shoulder | Supine, arms by sides | Couch low, at the loading position |
| 8 | Mask clicked on | The mask holds the head still to a millimetre or two [3][4]. | 2-3 | Rad1 at head, Rad2 at patient's left | Rad1: L: supports back of head / R: lowers and clicks mask; Rad2: L: holds shoulder strap / R: presses clips | Mask on, breathing through the mesh | - |
| 9 | Couch raised and shifted to the marks | Room lasers and the mask marks bring the head to the planned centre [38]. | 2-3 | Rad1 with pendant; Rad2 checks the lasers | Rad1: L: pendant / R: steadies couch edge | Still | Green and red lasers cross at the isocentre; couch rises |
| 10 | Surface check against the planning scan | A camera map of the face spots a poor fit before any X-ray [38]. | 1 | Rad2: bedside tablet; Rad1 beside the patient | Rad2: L: tablet / R: - | Still | Surface screen green within 4 mm and 3 degrees |
| 11 | Search the room; last person out | The search switches and the closed door stop a beam starting with someone inside [49]. | 1-2 | Rad1: walks round, looks behind the gantry face and under the couch, presses search panels A then B; Rad2 leaves first; Rad1 last | Rad1: L: door handle / R: search button | Alone, still, music playing | Warning lamp red outside the door; door interlock closes |
| 12 | Cone-beam scan | A quick 3D scan shows where the bones are today [13][21]. | 2-4 | Rad2 at console 2 starts the scan; Rad1 watches camera 1 and 2 and the intercom | Rad2: L: mouse / R: keyboard | Still | X-ray lamp; imaging arm swings out; gantry turns through about 200 degrees; image builds slice by slice |
| 13 | Scan matched to the plan: six shifts | The match says how far the head moves in three directions and three turns [38]. | 2-5 | Rad1 and Rad2 at the registration screen; Phys or Onc called by phone on early days [U] | Rad2: L: mouse / R: keyboard; Rad1 points | Still | Planning CT grey, CBCT in colour; table: 1.2, -0.8, 0.5 mm; 0.4, -0.6, 0.9 degrees; lamps green |
| 14 | Couch moves to correct the position | The six-axis couch applies the shifts from the console while cameras watch [13][38]. | 1-2 | Rad2: presses Apply and holds the move key; Rad1 watches camera 1 | Rad2: L: key / R: mouse | Unaware of the move | Couch top slides a few millimetres and tilts under a degree; "moving" lamp |
| 15 | Second picture after the move | A second look confirms the head is now where the plan needs it [20][38]. | 2-3 | Rad1 and Rad2 at console 2 | Rad2: L: mouse / R: keyboard | Still | Orthogonal X-ray pair; residual table under 1 mm and 1 degree [U]; Accept; new surface reference stored |
| 16 | Snout and range shifter set for field 1 | A close snout and a plate keep the spots small for a shallow target [20]. | 1-2 | Rad2 at console 1; Rad1 on camera 2 | - | Still | Snout slides in toward the head; a 3 cm plate swings in; clearance lamp green |
| 17 | Beam request; interlocks checked | The machine starts only when door, search, arms, couch and accelerator are green [15][49]. | 1 | Rad2: selects field 1, presses Prepare; Rad1 reads the interlock panel | Rad2: L: mouse / R: keyboard | Still | Console: field 1 highlighted; WAITING FOR BEAM; interlocks green; the beam is shared so a short wait is shown [3] |
| 18 | Gantry turns to field 1 | The gantry brings the beam in from the first planned angle. | 1-2 | Rad1 watches camera 2 (gantry and couch); Rad2 watches the angle readout | - | Still; hears the gantry hum | Gantry turns to 40 degrees; warning bell; moving floor shifts |
| 19 | Field 1: beam on | The beam delivers the planned spots layer by layer. | 2-4 | Rad2 watches beam status; Rad1 watches the camera and intercom; either can pause | Rad2: L: hand near stop key / R: mouse | Still; hears a buzz [3] | Red BEAM ON lamp over the door and on the nozzle; layer i of N counts up; spot map fills; beam current a few nA |
| 20 | Gantry turns to field 2 | The second angle spreads dose over different healthy tissue. | 1 | As step 18 | - | Still | Gantry turns to 180 degrees; lamps off while it moves |
| 21 | Field 2: beam on | As step 19 for the second angle. | 2-4 | As step 19 | As step 19 | Still | BEAM ON; layers and spot map as before |
| 22 | Gantry turns to field 3; couch turns a little | The third angle completes the plan; the couch may turn a few degrees [U]. | 1-2 | As step 18 | - | Still | Gantry to 320 degrees; couch yaw 10 degrees |
| 23 | Field 3: beam on | As step 19 for the third angle. | 2-4 | As step 19 | As step 19 | Still | BEAM ON; final layer; "field 3 complete" |
| 24 | Beam off; gantry parked | Staff go in only when the beam is off and the interlock is released [49]. | 1 | Rad2: ends the treatment on the console; Rad1 watches the lamps | Rad2: L: key / R: mouse | Still | BEAM ON lamps out; gantry returns to 0 degrees; snout retracts; door interlock released |
| 25 | Team returns; mask off; help up | The radiographers check the skin and help the patient sit up slowly [3]. | 2-3 | Rad1 at head, Rad2 at patient's left | Rad1: L: supports head / R: unclips mask; Rad2: L: arm support / R: pendant lowers couch | Sits up, mask off, may feel stiff | Couch lowered to loading height |
| 26 | Change; next appointment; advice | The patient leaves with tomorrow's time and the side-effects advice [3][4]. | 3-5 | Patient in cubicle, then Recep at the desk | Recep: L: appointment card / R: advice sheet | Dressed, walking out | - |
| 27 | Treatment record signed | The delivered dose for each field goes into the record before the next patient [U]. | 1-2 | Rad2: console 1 | Rad2: L: mouse / R: keyboard | - | Record shows fields 1-3 delivered, fraction 12 of 33 complete |
| 28 | Couch cleaned; next patient called | The turnaround is quick and the beam is shared between rooms [3][48]. | 3-5 | Rad1: wipes the couch and head rest, hangs the mask on its rack; Rad2 loads the next plan | Rad1: L: wipe / R: spray | - | Gantry parked; console shows the next patient |

**Watch compression (seconds per step).** 1: 22, 2: 14, 3: 18, 4: 14, 5: 20, 6: 22, 7: 20, 8: 40, 9: 20, 10: 16, 11: 30, 12: 28, 13: 45, 14: 28, 15: 18, 16: 14, 17: 20, 18: 30, 19: 42, 20: 28, 21: 36, 22: 28, 23: 36, 24: 14, 25: 24, 26: 16, 27: 14, 28: 16. Total: 673 s. The long visible steps are the mask (8), the search and last-out (11), the cone-beam scan and the six-shift match (12-13), the gantry turns (18, 20, 22) and the beam-on moments (19, 21, 23).

**Details that make it realistic.**
- **Mask:** a thermoplastic mask made at the assessment visit (mask and CT about 1 h 30 min together) and clipped to a base plate at every session; it is labelled for one person [4]. Some US centres use a minimal mask with surface guidance [38][C].
- **Cameras and intercom:** cameras give the radiographers a clear view all the time, they can stop the machine and come in at once, and they announce over the intercom when the beam is about to start. Patients choose music or an audiobook. Nothing is seen or felt, but a buzz is heard [3].
- **Shared beam:** one cyclotron serves three rooms, so a patient can wait with the mask on while another room has the beam [3][46].
- **Search and last person out:** the search switches inside the room must be pressed in order with the doors closed, and a klaxon sounds first at some proton centres; warning lamps show outside the door when the beam is on [49][C].
- **Surface guidance:** a surface map compared with the CT-sim map; if it drifts beyond 4 mm or 3 degrees the beam is paused, an X-ray is taken and the patient re-aligned (one US institution's practice) [38][C].
- **Registration:** a bone match on the skull base or neck, then a soft-tissue look; the shifts are applied from the console through the six-axis couch [13][38].
- **Faults:** a missed session is added to the end, or a second session is given the same day at least 6 h later, or a Saturday catch-up is used [3].
- **Weekly review:** a doctor review each week, shown as a caption only [3][4].

### 5b. Child with a brain tumour, daily general anaesthetic, play specialist, three fields

Real example of the course: a craniospinal or posterior-fossa plan of up to 30 sessions over 6-8 weeks, each lasting up to 60 minutes [37]. Fraction 8 of 30. Children are first in the day because they have fasted [7]. The anaesthetic is propofol-based, with the child breathing on their own through a small airway device (a laryngeal mask in 11 of 12 children in one series) [37]. In that series: awakening about 21 minutes after the beam (5-52), irradiation time about 29 minutes (14-75), time in the room about 40 minutes (25-79; the paper's text says 45, so the table and text differ) [37].

| # | Step | Why | Min | Who does what, and where | Hands (left / right) | Patient state | Machine state and screen view |
|---|---|---|---|---|---|---|---|
| 1 | Arrive fasted at the play area | Children who will be asleep have fasted, so they take the first slots [7][12]. | 3-5 | Recep and Play greet them; parent and child in the waiting and play area | Play: L: soft toy / R: sticker chart | Awake, in pyjamas, no food or drink since the fasting time [12] | CR: Rad2 loads the plan; anaesthetic suite prepared |
| 2 | Mask practice on a doll | Practising with a toy mask makes the real one less strange [12]. | 5-10 | Play and Rad1 (specialist paediatric radiographer) at the play table | Play: L: doll / R: toy mask; Rad1: L: real mask / R: - | Awake, calm, chooses a film or music | Gantry room empty, gantry parked |
| 3 | Fasting, weight and consent checked | The anaesthetist confirms last food and drink, health today, allergies and weight [12]. | 3-5 | Anaes and ODP in the anaesthetic suite; parent answers | Anaes: L: chart / R: thermometer | Awake, held by parent | CR: plan open, daily check signed |
| 4 | Parent and child walk to the anaesthetic room | One parent goes with the child and no siblings [12]. | 1-2 | Parent, child, Play and ODP | Parent: L: child's hand / R: comfort toy | Walking | - |
| 5 | Safety check before sleep medicine | A short pause names the child, the plan, allergies, the line and the equipment [U]. | 1-2 | Anaes reads; ODP and Rad1 answer; parent listens | Anaes: L: checklist / R: - | Awake | Console: fraction 8 of 30, fields 3 |
| 6 | Child falls asleep with a parent beside | Medicine goes in through the child's line (or by gas) and the parent stays until the child is asleep [37][12]. | 3-5 | Anaes at head, ODP at left, parent holds hand, Play soothes | Anaes: L: holds jaw / R: syringe; Parent: L: holds hand | Awake to asleep; propofol-based [37] | - |
| 7 | Airway device and monitors on | A small airway device and monitors let the anaesthetist watch breathing from outside the room [37]. | 2-4 | Anaes and ODP | Anaes: L: holds jaw / R: guides airway device; ODP: L: tape / R: cables | Asleep, breathing alone, airway in | Monitor: heart trace, oxygen level, CO2 trace, blood pressure |
| 8 | Sleeping child carried into the treatment room | The child goes on a trolley (or in arms) with the anaesthetist at the head [U]. | 2-3 | Anaes at head, ODP pushes trolley, Rad1 and Rad2 guide through the maze; Rad2 slides the door | Anaes: L: head and airway / R: monitor cable; ODP: L: trolley / R: drip pole | Asleep | Couch low at loading position; door open |
| 9 | Laid on the couch; monitors moved across | A slide sheet moves the child without lifting [U]. | 2-3 | Rad1 and Rad2 on the sheet; Anaes holds head; ODP the lines | Rad1: L: sheet / R: supports hip; Anaes: L: head | Supine, head on a child-size cushion | Monitor stand beside couch head; slave monitor lit in CR |
| 10 | Mask fitted over the airway | The mask has a gap for the airway and goes on only when the airway and monitors are in view [U]. | 2-4 | Rad1 at head, Rad2 clips, Anaes watches the airway | Rad1: L: lifts mask / R: clicks; Anaes: L: holds airway tubing / R: touches chest | Mask on, airway reachable | - |
| 11 | Lines and cables laid clear of the gantry | The gantry swings round the couch, so nothing may snag [U]. | 1-2 | ODP and Anaes; Rad1 checks the path by eye | ODP: L: cable loop / R: tape | Asleep | Clearance lamp amber, then green |
| 12 | Lasers and surface check | As for an adult, with a smaller field [38]. | 2-3 | Rad1 pendant, Rad2 tablet, Anaes watches the child | Rad1: L: pendant / R: steadies couch | Asleep, still | Lasers cross at the isocentre; surface map green |
| 13 | Search; team leaves; monitors checked from control | The anaesthetist and ODP sit in the control room where the child's monitor is repeated on screen [37]. | 2-3 | All leave; Rad1 searches and is last out; Anaes and ODP go to CR | Rad1: L: door / R: search button; Anaes: L: - / R: mouse | Alone in the room, asleep | Warning lamp red; CCTV shows face and chest; monitor repeated [37][3] |
| 14 | Cone-beam scan | A 3D scan at the couch shows where the head is today [13]. | 2-4 | Rad2 at console 2; Rad1 on cameras; Anaes on the monitor | Rad2: L: mouse / R: keyboard | Still | X-ray lamp; imaging arm out; gantry turns; image builds |
| 15 | Scan matched to the plan: six shifts | The match says how far to move; for children an oncologist may approve it on early days and for craniospinal plans [U]. | 3-6 | Rad1 and Rad2; Onc by phone if needed | Rad2: L: mouse / R: keyboard | Still | CT grey, CBCT colour; shifts 0.8, -0.5, 0.4 mm; 0.3, 0.2, -0.5 degrees |
| 16 | Couch moves; second picture | The couch applies the shifts, then a second image confirms them [13][38]. | 2-3 | Rad2 applies; Rad1 on camera; Anaes on the monitor | Rad2: L: key / R: mouse | Asleep, still | Couch moves; X-ray pair; residuals under 1 mm; Accept |
| 17 | Beam request; interlocks green | The machine starts only when every interlock is green [15][49]. | 1 | Rad2 selects field 1 and presses Prepare; Rad1 reads the panel | Rad2: L: mouse / R: keyboard | Still | WAITING FOR BEAM; snout and plate set |
| 18 | Gantry to field 1 | The gantry brings the beam in from the first planned angle. | 1-2 | Rad1 on camera 2, Anaes on the monitor | - | Asleep | Gantry turns to 60 degrees; bell |
| 19 | Field 1: beam on | Spots are delivered layer by layer. | 2-4 | Rad2 beam status; Rad1 camera and intercom; Anaes the monitor | Rad2: L: near stop key / R: mouse | Asleep, still | BEAM ON; layer i of N; spot map |
| 20 | Gantry to field 2 | A second angle spares different tissue. | 1 | As step 18 | - | Asleep | Gantry to 200 degrees |
| 21 | Field 2: beam on | As step 19. | 2-4 | As step 19 | As step 19 | Asleep | BEAM ON |
| 22 | Gantry to field 3 | The third angle completes the plan. | 1-2 | As step 18 | - | Asleep | Gantry to 300 degrees; couch yaw a few degrees |
| 23 | Field 3: beam on | As step 19. | 2-4 | As step 19 | As step 19 | Asleep | BEAM ON; "field 3 complete" |
| 24 | Beam off; staff and anaesthetist return | Staff go in only when the beam is off and the interlock is released [49]. | 1 | Rad2 ends treatment; Rad1, Anaes and ODP walk in | - | Asleep, breathing alone | Lamps out; gantry parked; door interlock released |
| 25 | Mask off; child moved to the recovery trolley | The mask comes off first and the child is moved with the airway still in place until waking [U]. | 2-4 | Rad1 and Rad2 lift with the slide sheet; Anaes at head; ODP lines | Rad1: L: unclips mask / R: supports head; Anaes: L: head / R: airway | Asleep | Couch lowered; monitor stand to trolley |
| 26 | Waking in recovery with the parent | Recovery staff watch the child until awake; the parent is beside them [12][37]. | 15-30 | Nurse at the bedside, parent, Play, ODP; Anaes hands over | Nurse: L: holds monitor lead / R: wrist; Parent: L: holds hand | Waking, drowsy, airway device out | - |
| 27 | Drink, sticker and home | A drink and a snack after fasting, and a small reward for the child [U]. | 10-20 | Nurse, Play and parent | Play: L: sticker / R: chart | Awake, dressed | - |
| 28 | Record, clean and reset the room | The treatment record and the anaesthetic chart are completed and the couch cleaned before the next child [U]. | 5-10 | Rad1 and Rad2 in the room; ODP restocks | Rad1: L: wipe / R: spray | - | Gantry parked; console shows the next patient |

**Watch compression (seconds per step).** 1: 20, 2: 24, 3: 18, 4: 14, 5: 18, 6: 30, 7: 26, 8: 24, 9: 20, 10: 36, 11: 14, 12: 18, 13: 28, 14: 26, 15: 40, 16: 28, 17: 16, 18: 26, 19: 38, 20: 24, 21: 34, 22: 24, 23: 34, 24: 16, 25: 28, 26: 30, 27: 18, 28: 14. Total: 686 s. The long visible steps are falling asleep (6), the mask over the airway (10), the six-shift match (15) and the beam-on moments (19, 21, 23). Waking (26) is short in watch time although it is the longest real step.

**Details that make it realistic.**
- **Fasting and early slots:** children who are fasted are treated in the morning [7][12].
- **Anaesthetic suite:** UCLH has a dedicated children's suite with induction rooms and recovery; one parent only goes into the anaesthetic room and no siblings [12][C].
- **Monitoring:** the treatment and control rooms are isolated like an MRI suite, so the monitor must be repeated outside and the CO2 trace and breathing rate watched; The Christie says imaging in the room lets the anaesthetic team monitor children closely [37][7][V].
- **Airway:** propofol with spontaneous breathing; a laryngeal mask in 11 of 12 children; no body movement or low oxygen was recorded in that series [37][V].
- **Age:** about 55-60 % of children aged 0-7 needed the anaesthetic and none aged 8-15 in one series; The Christie also says it is generally for very young children who cannot keep still [37][5].
- **Play specialist:** registered specialists work with doctors, nurses and radiographers to help the child understand each step; photo books and short films are used [12][6][C].
- **Daily line care:** the venous access device is used every day; centres must work out efficient flows to cut fasting time and clinic disruption [37][C].
- **Beam-on rules are the same as for adults:** search, last person out, red lamp, cameras and intercom [3][49]. There is nobody in the room at beam-on, parents included.

## 6. The team and where they stand

| Phase | In the treatment room | In the control room | Elsewhere |
|---|---|---|---|
| Morning QA | Physicist or engineer places the QA device on the couch | Rad2 or physicist at console 1 reads the numbers | Engineers' room: accelerator status [39] |
| Welcome, ID, changing | - | Rad2 loads the plan | Recep, Rad1, play specialist, patient in the annex hall |
| Child asleep (induction) | - | Rad2 | Anaes, ODP, parent, play specialist in the anaesthetic suite |
| Positioning and mask | Rad1, Rad2 (and Anaes, ODP for a child, at the head) | - | Parent in the play area |
| Surface and laser check | Rad1, Rad2 | - | - |
| Search and last person out | Rad1 only, then nobody | Rad2 | Anaes and ODP walk to the control room (child) |
| Imaging and registration | Nobody | Rad1, Rad2 (Anaes, ODP for a child) | Phys or Onc on the phone |
| Couch correction | Nobody | Rad2 applies, Rad1 on camera | - |
| Gantry turns, beam on | Nobody | Rad1 and Rad2 (Anaes, ODP for a child) | Engineers on call if a fault |
| Beam off | Rad1, Rad2 walk in (Anaes, ODP for a child) | - | - |
| Recovery (child) | - | - | Nurse, ODP, parent, play specialist in recovery |
| Weekly review | - | - | Onc and keyworker in a consulting room [3] |
| Fault | Engineers from the maker enter after the room is made safe | Radiographers pause the beam | 24-hour cover at The Christie [7] |

The rule for the sim: at beam-on the room holds one patient and nobody else, and the controls hold two or three people looking at screens, with a child's anaesthetic team added [3][49][37].

## 7. Notes for the simulation

### 7.1 New roles, rooms and spots

- **Roles (change request, `ProcRole` and `Role`):** `radiographer` (use `ctRadiographer` for Rad1 until added), `radiographer2`, `physicist`, `oncologist`, `playSpecialist`, `odp`, `recoveryNurse`, `reception`. `anaesthetist` exists. Avatars are shared per role (see `new-devices.md` section 3).
- **Rooms (`AreaId`):** `atProton` (treatment room), `atProtonMaze`, `atProtonControl`, `atProtonCyclo` (hidden or a sealed door, for the cyclotron), `atProtonAnaes` (induction and recovery, two bays), `atProtonPlay` (waiting and play), with changing cubicles and a mask rack in the annex hall.
- **Spots (anchors):** `couchHead`, `couchLeft`, `couchRight`, `couchFoot`, `consoleA`, `consoleB`, `cctvWall`, `doorInside`, `searchPanelA`, `searchPanelB`, `mazeBend`, `trolleyBay`, `anaesMonitor`, `maskRack`, `playTable`, `reception`, `changeCubicle`.
- **Patient pose (`PatientPoseView`):** `position` supine, `arms` out, `awareness` awake or asleep (exist). Add `mask` (0-1, a closed shell over the face), `airway` `laryngealMask` for children (existing: none, nasalCannula, oxygenMask, bagMask, tube) and a roll that the couch correction uses (a few degrees, existing `rollDeg`) [54].

### 7.2 Where the machine could go

| Option | Footprint | Verdict |
|---|---|---|
| **A. Proton wing on the annex** | `atRt` and `atPlant` merged and extended north: **x 50..70, z -26..-2 = 20 x 24 m (480 m²)**: a shielded block about 14.5 x 13.5 m with a raised roof (9-10 m), a maze 3 x 8 m, a control room 6 x 4 m, two anaesthetic bays 6 x 4 m, a plant corner. The annex hall (`atHall`) keeps the waiting and play area | Recommended. Needs `places.ts` changes and a taller annex roof. The annex stays separate from the baked main shell |
| **B. New pavilion** | about 40 x 30 m (1,100-1,200 m²), matching Penn Lancaster General's 12,100 sq ft (1,124 m²) [44] | Gives the full hall, cyclotron room and support rooms. Needs a new shell and plinth |
| **C. Fixed-beam upright in `atRt`** | 90 m² room plus 30 m² control, about the 110 m² linac vault [16] | Fits with small changes. No rotating gantry, so the gantry turns (5a steps 18, 20, 22) become a chair turn |

The cyclotron room can be a sealed box (door welded shut in the model) with a view-only window, so it adds a mesh but no walking space.

### 7.3 What to film up close

Step numbers are those of table 5a, with 5b in brackets where they differ.

- **The mask going on** (8; 5b: 10), the couch correcting itself (14; 5b: 16), the cone-beam arm sweeping round the head (12; 5b: 14), the six numbers on the registration screen (13; 5b: 15).
- **Gantry turns** (18, 20, 22): the nozzle and snout swing round the head, the moving floor shifts, a bell sounds. In 5a each turn is 28-30 s of watch time.
- **The search and the red lamp** (11; 5b: 13): the radiographer pressing two panels and the lamp turning red; then the **beam-on** (19, 21, 23): the lamp on the nozzle, the layer counter and the spot map filling.
- **The control room:** three desks, the CCTV wall, the child's monitor trace.
- **For children:** the play specialist and the doll, the parent holding a hand, the child going to sleep, the slide-sheet transfer, the waking.

### 7.4 Visual details for a realistic but clean look

- A pale, quiet room with a curved gantry face, a ceiling light panel that glows softly, two crossed laser lines (green and red), one couch with a pale cushion, two small wall cameras, a red lamp over the door and on the nozzle, a trefoil sign and a thick door. No people in the shot except staff and a covered patient.
- **No gore:** the patient is in a gown or pyjamas under a sheet, the mask is a pale shell, nothing is red except lamps. No real patient images: screens use a synthetic head slice.
- **For children:** calm colours, a ceiling picture, soft toys on a shelf, a doll on the play table [U].
- **Sound:** bell, buzz, gantry hum, intercom voice (caption only), music.

### 7.5 Quest 3 cost risks, and what can be baked

CLAUDE.md budgets: at most 300 draw calls and 1.2 M triangles on the laptop; on Quest 3 under 200 draw calls in stereo, 1.5 M triangles, about 250 MB texture. The measured baseline already reaches 122-228 draw calls (`new-devices.md` section 10), so the proton wing must be culled unless the viewer is in the annex.

| Piece | Triangles | Draw calls | Notes |
|---|---|---|---|
| Room shell, maze, door (baked light) | 15-20 k | 5-6 | Merge walls, floor and roof by material; lightmap the room |
| Gantry face, nozzle, snout, moving floor | 15-20 k | 4 | Four nodes: face (turns), nozzle, snout, floor segment. Turn by transform only, no skinning |
| Couch (base, column, top) | 6 k | 3 | Three nodes: base yaw, column, top |
| CBCT arms and panels | 3 k | 2 | Two nodes, hidden in the nozzle when stowed |
| Control room (desks, screens, CCTV wall) | 10 k | 4 | Three canvases at 2 Hz (imaging at 4 Hz when focused) |
| Anaesthetic bay, trolley, monitor | 5 k | 3 | One shared monitor canvas |
| Props (mask, cushion, toys, wipes) | 3 k | 2 | Instance them |
| **Total** | **about 60-70 k** | **about 23-25** | Textures about 10 MB in KTX2, canvases about 2 MB |

- **Must be merged or instanced:** everything static in the room (by material), the many bolts and magnets on the gantry face, the shelves and toys, the staff avatars (the crowd renderer is already instanced).
- **Never model:** the gantry's interior, the bending magnets and the beamline. They are hidden behind the face and the wall; a merged proxy under 10 k triangles is enough if a hatch shows them.
- **Can be baked:** all room light, the gantry's ambient shadow on the floor (a baked blob), and the building shadow. Use emissive panels, not real lights. Blob shadows under staff and the couch.
- **Cost risks:** the moving floor and the gantry face are large flat surfaces, so overdraw is cheap, but a 9-10 m high room breaks the 3.0 m wall height and the cut-away "architect's model" view (walls cut at `WALL.cutHeight` 1.3 m) [54]. A second child anaesthetic bay doubles the props. Keep glass and mirrors out of the room.

### 7.6 Which engine pieces can be reused (the R5 procedure engine)

The engine is `src/sim/procedure` with scripts as JSON in `src/content/procedures/` (zod loader `src/content/procedures.ts`): a script is 20-32 steps; each step has `unit`, `caption` (60), `why` (160), `realMinutes`, `watchSeconds`, `focus`, `roles` (`do`, `at`, `look`, `work`, `left`, `right`), `patient` changes, `event` and a `repeat` run [54].

| Needed | Reuse or change |
|---|---|
| A new machine key | `ProcMachine`: add `protonGantry` (existing `daVinci`, `cryoCt`, `prosense`) |
| Units | New: `arrive`, `prep`, `induction`, `position`, `search`, `image`, `correct`, `beam`, `recovery`, `out`; the `repeat` run is used for **the three fields** (gantry turn then beam on, three times) exactly as the cryo script repeats per needle |
| Roles | `anaesthetist` exists; add the roles in 7.1 |
| Anchors | New: the spots in 7.1 (existing `anaesHead`, `tableWest`, `tableFoot` can be remapped) |
| Targets | New: `mask`, `nozzle`, `couchTop`, `imagingArm`, `consoleScreen`, `cctvWall`, `searchPanel` |
| Tools (hands) | New: `thermoplasticMask`, `slideSheet`, `pendant`, `softToy`, `doll`, `wipe`; existing (used in the cholecystectomy script): `tablet`, `syringe`, `ecgLeads` |
| Focus | New: `gantry`, `nozzle`, `protonConsole`, `couch`; existing `controlRoom` |
| Actions | New: `fitMask`, `alignCouch`, `searchRoom`, `pressBeam`, `monitorChild`, `playWithChild` |
| Checklist | Reuse the WHO-style Sign In for the child (a short adapted pause) |
| Patient view | `mask` and `laryngealMask` additions; `awake`/`asleep` exist |
| Screens | Painters like `scene/imaging/live.ts` and the cryo console canvas |

Contract changes are orchestrator-owned: `src/sim/types.ts` (`ProcMachine`, `ProcedureId` += `proton-headNeck`, `proton-paediatric`, roles, anchors, targets, tools, focus, actions), `src/sim/places.ts` (`AreaId`, `AREAS`, `DOORS`, spots, `ceilingHeight`), `src/sim/config.ts` (proton block), and `src/scene/camera/frameOrder.ts` (a negative priority for the gantry rig). The unions are checked by `Record<Union, true>` in `procedures.ts`, so the script file fails the typecheck until they are listed [54].

**Re-check of the watch compression (section 5).** 5a: 28 steps, 673 s. 5b: 28 steps, 686 s. Both are inside the 600-900 s band. Every caption is 60 characters or fewer and every "why" is 160 or fewer (checked with a script).

## 8. Where sources disagree, and where they are thin

**Disagreements.**
1. **Footprint.** `new-devices.md` said a gantry room is "15 m or more across". Compact systems are about 13 x 14 m and three storeys [17], and a fixed-beam upright system fits a 110 m² linac vault [16]. A 2010 press estimate for Proteus ONE is 15 x 29 m [55]. The Mercy figure does not say whether 42 x 47 ft is inside or outside the walls [17].
2. **Facility counts.** PTCOG's mirror says 128 on one page and 125 (110 proton, 15 carbon, 2023) on the map; a search excerpt gives 133 at May 2025; a market page gives 89 in 2023 [25][28]. The PTCOG sites ptcog.site and ptcog.ch returned errors; a mirror (ptcog.online) was used.
3. **Room counts at the NHS centres.** The 2015 Varian contract said two three-room centres; The Christie has three clinical gantries plus a fourth research gantry; UCLH is also described with four rooms and three for patients [8][9][7].
4. **Machine weights.** Christie cyclotron 90 t [10], UF older cyclotron 220 t [45], S2C2 55 t [55], Mevion accelerator 30,000 lb (13.6 t) with a separate 72,000 lb figure for arms and counterweights whose meaning is unclear [17]. A 2016 Mevion abstract says under 15 t and above 10 T [18].
5. **Energy and field.** ProBeam 2014-era: 250 MeV and 30 x 40 cm, 245 MeV in the room [20]. ProBeam 360° FDA record: 226 MeV, treatment 69-218 MeV, 25 x 25 cm [13]. Mevion "S250" is 230 MeV in the FDA text [15].
6. **Session length.** Christie FAQ: 20-45 minutes [5]; the Christie patient guide: 20-90 minutes [3]; a US vendor: 10 minutes for two fields [48]; a planning filing: 25-30 minutes a patient [48].
7. **Oropharynx.** The US trial favours protons for overall survival [30]; the UK trial found no quality-of-life difference and more weight loss with protons [31]. The first is partly industry-funded and many of its patients did not get the arm they were given (72 % and 62 % did).
8. **UCLH opening.** UCLH says first patient 1 December 2021; a 2023 paper says opened 2022 [7][12].
9. **Rutherford.** Listed in PTCOG's September 2025 list, but the company was liquidated in June 2022 and NHS England said those sites did not meet the NHS specification [25][52].
10. **Fractions.** The sources give regimens, but no one source covers all indications; the medulloblastoma regimen is assembled from a dose of 23.4 Gy at 1.8 Gy per fraction and a boost to 54-55.8 Gy [51][C].
11. **S250-FIT dates.** Unveiled 7 April 2026; first patient 4 June 2026 [16][19].
12. **Course length.** The Christie FAQ says 3-7 weeks, its approval page says up to 8 weeks and the radiographer paper says up to 7 weeks [3][4][5][7].
13. **Gantry or not.** The brief asks for a rotating gantry; the one compact system that fits a linac vault (S250-FIT) has none [15][16].

**Thin or not found.**
- **Vendor drawings:** no vendor site-planning guide was readable (several returned 403); gantry diameters and vault drawings for ProBeam 360° and Proteus ONE were not found.
- **Control-room screens:** only patent and paper descriptions; no vendor console layout [56][C].
- **Staffing:** "two radiographers per room" was not confirmed; only that proton senior radiographers run the gantries [7].
- **Children's day:** one series gives GA times [37]; the UCLH and Christie pages describe the team but not minute-by-minute steps [6][12].
- **Israel:** Ichilov's opening was not confirmed; Hadassah's P-Cure cohort is company and press only [23][24].
- **Cost per course:** not found. Capital costs are mixed in year and currency [50][45][24].
- **Results not found:** NRG-GI006, NRG-BN005 and RADCOMP's main endpoint [33][34].
- **Not researched:** Sumitomo, ProTom, carbon-ion machines, NHS Wales CP147, the NHS England adult indications list.
- **Search excerpts only:** PARTIQoL, RADCOMP, the Europe paper, most shielding sources and the daily-QA papers (the AAPM TG-224 report itself was not read) [26][32][33][39][42].

## 9. Sources

Numbered as cited. "Read" means the page or paper text was read; "excerpt" means only a search excerpt or abstract. Titles are given as published (some keep US spellings).

1. NHS England. *Service Specification No. 1737: Proton Beam Therapy Service (All Ages)* (engagement proposition). Read (text layer): staff, anaesthesia, minimum two rooms, gantry remote control, couch six degrees of freedom, volumetric imaging, children's flow. https://www.engage.england.nhs.uk/consultation/proton-beam-therapy-service/user_uploads/proton-beam-therapy-service-spec-proposition.pdf
2. NHS England. *Clinical Commissioning Policy: Proton beam therapy for children, teenagers and young adults* (2020). Read (text layer): criteria, evidence, capacity. https://www.england.nhs.uk/wp-content/uploads/2020/10/proton-beam-therapy-clinical-commissioning-policy.pdf
3. The Christie. *Proton beam therapy: adult/young adult guide for patients and carers.* Read: daily session, cameras, intercom, 20-90 minutes, shared beam, follow-up. https://www.christie.nhs.uk/your-treatment-and-care/services/proton-beam-therapy/proton-beam-therapy-adultyoung-adult-tya-a-guide-for-patients-and-their-carers
4. The Christie. *What happens when you are approved for proton beam therapy.* Read: assessment, mask and CT 1 h 30 min, MRI 1 h, plan 2-3 weeks. https://www.christie.nhs.uk/your-treatment-and-care/services/proton-beam-therapy/what-happens-when-you-are-approved-for-proton-beam-therapy-at-the-christie
5. The Christie. *Proton beam therapy FAQs* (updated May 2025). Read. https://www.christie.nhs.uk/your-treatment-and-care/services/proton-beam-therapy/proton-beam-therapy-faqs
6. The Christie. *Paediatric team.* Read. https://www.christie.nhs.uk/your-treatment-and-care/services/proton-beam-therapy/meet-the-proton-beam-therapy-team/paediatric-team
7. Bailey R. Working in a UK national proton radiotherapy facility: the therapeutic radiographer perspective. *J Radiother Pract* 2023;22:e79. Read (page extract): three ProBeam gantries per site, 883 patients by Sept 2022, Day 0, fasting and morning slots, 15 radiographers, 24-hour cover. https://www.cambridge.org/core/product/E2B9AEE7EF54ABFDD17C92526F92186F/core-reader
8. Varian. *Varian Medical Systems selected to equip two national proton therapy centers in England* (March 2015). Excerpt: two three-room centres, up to £80m. https://www.varian.com/es/node/7726 ; contracts signed July 2015: https://www.1stoncology.com/blog/?p=19706
9. Varian. Major milestone for the UK's first high-energy proton therapy centre with Varian cyclotron installation (22 June 2017). Read: delivered from Troisdorf, four-room centre. https://www.biospace.com/varian-medical-systems-release-major-milestone-for-uk-s-first-high-energy-proton-therapy-center-with-varian-cyclotron-installation ; *Proton beam therapy: delivering a national service at The Christie*, RAD Magazine (four gantry rooms, three for NHS patients, a fourth research room; UCLH planned the same). Read. https://www.radmagazine.com/scientific-article/proton-beam-therapy-delivering-a-national-service-at-the-christie/
10. The Christie building facts: Tilbury Douglas https://www.tilburydouglas.co.uk/projects/the-christie-proton-beam-therapy-centre/ (walls up to 6 m); Constructing Excellence https://constructingexcellence.org.uk/the-christie-proton-beam-therapy-centre/ (90-ton cyclotron, £100m); Building https://building.co.uk/buildings/projects-the-nhs-first-high-energy-proton-beam-cancer-treatment-centre/5093014.article (almost three storeys). Excerpts.
11. UCLH building facts: Ridge https://ridge.co.uk/projects/uclh-proton-beam-therapy-centre/ ; Bouygues UK https://www.bouygues-uk.com/new-world-class-cancer-and-surgery-centre-for-university-college-london-hospital/ ; Healthcare Design https://healthcaredesignmagazine.com/projects/staying-grounded-university-college-london-hospitals-nhs-foundation-trust/ (44,000 m³ concrete, walls 2-5 m, 8,000 t steel, 25 m below ground). Excerpts.
12. UCLH. *Proton beam therapy centre opens* (first patient 1 December 2021, excerpt) https://www.uclh.nhs.uk/news/proton-beam-therapy-centre-opens ; *Proton beam therapy services for children and young people* and the paediatric anaesthesia information pages (suite, induction rooms, one parent, play specialists). Excerpts (the pages were too long to read in full). https://www.uclh.nhs.uk/our-services/find-service/cancer-services/proton-beam-therapy-pbt/proton-beam-therapy-services-children-and-young-people ; https://www.uclh.nhs.uk/patients-and-visitors/patient-information-pages/paediatric-information-series-no-13-anaesthesia-children-having-proton-beam-therapy
13. FDA 510(k) K221791, *ProBeam 360° Proton Therapy System* (Varian; decision 1 Dec 2022). Read (Innolitics mirror): 226 MeV superconducting isochronous cyclotron, 25 x 25 cm field, six-axis Leoni-based couch 226 kg, nozzle-mounted CBCT, single room. https://fda.innolitics.com/device/K221791
14. FDA 510(k) K252815, *ProBeam 360 v3.0* (cleared 23 Apr 2026): https://www.510kdatabase.net/k252815/ (classification only read). K231863 (v2.0 multi-room, Oct 2023): https://www.deviceclearance.com/510k/K231863/ (excerpt).
15. FDA 510(k) K250986, *MEVION S250-FIT* (12 Sep 2025; predicate S250i K172848). Read in full (text layer): 230 MeV synchrocyclotron, usable 30-230 MeV, range 0.8-32.2 g/cm², spot size, dose rate 2 Gy/min, upright six-axis positioner, hardwired safety system, indication limit for the seated position. https://www.accessdata.fda.gov/cdrh_docs/pdf25/K250986.pdf
16. Mevion S250-FIT: CE mark release (25 Feb 2026) https://www.biospace.com/press-releases/mevion-medical-systems-announces-ce-marking-of-the-mevion-s250-fit-proton-therapy-system-expanding-global-access-to-compact-proton-therapy ; HFM Magazine (4 May 2026) https://www.hfmmagazine.com/new-system-brings-proton-therapy-smaller-facilities ; launch release (19 May 2026) https://www.ansa.it/sito/notizie/economia/business_wire/2026/05/19/mevion-introduces-the-first-proton-therapy-system-designed-for-a-linac_1ff8f6f7-e098-4a03-877b-ff7a5dbd539e.html ; AuntMinnie (15 Sep 2025) https://www.auntminnie.com/clinical-news/radiation-oncology-therapy/news/15755454/fda-clears-mevions-s250fit-proton-therapy-system ; Mevion product page https://mevion.com/mevion-astro-2025. Read.
17. Mercy. *30,000-pound accelerator lifted into place for proton therapy centre* (22 Jul 2021): S250i, vault 42 x 47 ft, three storeys, walls 3-7.5 ft. Read. https://www.mercy.net/newsroom/2021-07-22/30-000-pound-accelerator-lifted-into-place-for-mercy-proton-ther/
18. Mevion. *Developing a modern, high-quality proton therapy medical device using a compact superconducting synchrocyclotron* (conference abstract, 2016). Excerpt: under 15 tons, above 10 T, layer switching under 50 ms. https://indico.cern.ch/event/537685/contributions/2189009
19. Leo Cancer Care and Stanford: first upright treatment 4 June 2026. Read. https://patientworthy.com/2026/06/10/stanford-medicine-achieves-first-clinical-use-of-compact-upright-proton-therapy/ ; https://www.appliedradiationoncology.com/articles/marie-by-leo-cancer-announces-pioneering-proton-therapy-advancement-at-stanford-medicine
20. Commissioning report for the Varian ProBeam at the Maryland Proton Treatment Center and Scripps Proton Therapy Center (title not captured; PMC5689862): 250 MeV cyclotron, 360° gantry, SAD 228 cm, 30 x 40 cm field, spot sigma 4-6 mm, layer switch under 1 s, snout 3-42 cm, 1-2 nA. Read. https://pmc.ncbi.nlm.nih.gov/articles/PMC5689862
21. Commissioning of the world's first compact pencil-beam scanning proton therapy system (IBA Proteus ONE, Willis-Knighton; PMC5768001): 220° gantry, 70-230 MeV, 20 x 24 cm, layer switch about 0.9 s, imaging. Read. https://pmc.ncbi.nlm.nih.gov/articles/PMC5768001/
22. Henrotin S, et al. *IBA S2C2 synchrocyclotron* (Cyclotrons 2016, TUP07): 230 MeV, 1 kHz, 10 µs. Read (text layer). https://proceedings.jacow.org/cyclotrons2016/papers/tup07.pdf
23. IBA: press release 7 May 2013 (Proteus ONE milestones); Ichilov contract 27 Sep 2023 (two Proteus ONE; DynamicARC after approval). Read. https://www.iba-worldwide.com/iba-finalizes-contract-medtechnica-ltd-two-proteusrone-proton-therapy-solutions-tel-aviv-sourasky
24. Hadassah press release (28 Jun 2023) https://www.hadassah.org/press-release/hadassah-is-first-medical-provider-in-israel-to-offer-proton-therapy (read); DOTmed, 15 Jan 2026, first child cohort on P-Cure's upright system (search excerpt; the exact URL was not captured).
25. PTCOG mirror: https://ptcog.online/facilities-world-map/ (128 or 125 facilities) and https://ptcog.online/facilities-in-clinical-operation-3/ (list updated Sept 2025). Read. The main PTCOG sites returned errors.
26. *Inequitable access to proton beam therapy in Europe*, Radiother Oncol 2026 (26 centres, 54 rooms in 2025). Excerpt only (the page returned 403). https://www.thegreenjournal.com/article/S0167-8140(26)00557-8/fulltext
27. PTCOG patient statistics to end 2023 (about 410,000; 350,000 protons): excerpt via https://ptcog.web.psi.ch/ptcentres.html
28. Wikipedia. *Proton therapy* (secondary): 41 US centres early 2023, 89 worldwide, costs. Read. https://en.wikipedia.org/wiki/Proton_therapy
29. Hitachi High-Tech, release 2 Jul 2025 (Komagome order; 120,000 patients) https://www.hitachi.com/en/press/articles/2025/07/0702b/ (read); PROBEAT-V at Mayo https://finchannel.com/hitachi-s-advanced-proton-beam-therapy-system-probeat-v-begins-treatments-at-mayo-clinic-in-rochester-m-n/49217/tech-2/2015/09/ and PROBEAT-RT https://www.global.hokudai.ac.jp/blog/62/index.htm (excerpts).
30. Frank SJ, et al. Proton versus photon radiotherapy for patients with oropharyngeal cancer in the USA. *Lancet* 2025;407:174-184. Abstract read. https://pubmed.ncbi.nlm.nih.gov/41391462/
31. TORPEdO, ASTRO 2025 (LBA 02), *The ASCO Post*, 10 Nov 2025. Read. https://ascopost.com/issues/november-10-2025/intensity-modulated-radiation-therapy-vs-proton-therapy-for-oropharyngeal-cancer/
32. PARTIQoL: *The ASCO Post*, April 2025. Excerpt only. https://ascopost.com/news/april-2025/proton-therapy-and-intensity-modulated-radiation-therapy-for-localized-prostate-cancer/
33. RADCOMP (NCT02603341): https://clinicaltrials.gov/study/NCT02603341 ; ASTRO 2025 quality-of-life report https://ecancer.org/en/news/27098-astro-2025-health-related-quality-of-life-analysis-shows-benefit-in-both-proton-and-photon-radiation-options-in-breast-cancer-patients . Excerpts.
34. NRG-GI006 https://www.nrgoncology.org/GI006 (read); NRG-BN005 https://www.nrgoncology.org/BN005 ; PROTECT QA https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11931855/ ; PROTIEUS protocol https://link.springer.com/article/10.1186/s12885-026-16424-1 (excerpts).
35. Children's CNS evidence: Yock et al., *Lancet Oncol* 2016 (news summary https://mdedge.com/content/proton-radiotherapy-effective-childhood-medulloblastoma ); Viani et al., *Radiother Oncol* 2026 meta-analysis https://www.brainlife.org/fulltext/2026/Viani_GA260111_RadiotherOncol.pdf . Excerpts.
36. FLASH: FAST-02 https://scienceblog.cincinnatichildrens.org/fast-02-clinical-trial-shows-pain-relief-after-treating-bone-metastases-in-chest/ and https://www.appliedradiationoncology.com/articles/proton-flash-radiotherapy-trial-demonstrates-pain-reduction-in-thoracic-bone-metastases (excerpts); FAST-01, JAMA Oncol 2022, https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9893728/ (cited in `new-devices.md`).
37. Age as a decisive factor in general anaesthesia use in paediatric proton beam therapy (PMC7493927) https://pmc.ncbi.nlm.nih.gov/articles/PMC7493927/ ; Propofol total intravenous anesthesia for pediatric proton radiotherapy (PMC12191059) https://pmc.ncbi.nlm.nih.gov/articles/PMC12191059/ . Read.
38. Surface guidance and setup: C-RAD and Mevion at Maastro https://c-rad.com/?p=1294 ; surface-guided brain and nasopharynx setup https://pmc.ncbi.nlm.nih.gov/articles/PMC8130230 ; Mayo SGRT slides (2026) https://sgrt.org/wp-content/uploads/2026/05/Erin-McCabe1.pdf . Excerpts.
39. AAPM Task Group 224, comprehensive proton therapy machine QA (*Med Phys* 2019, DOI 10.1002/mp.13622); daily QA: https://pmc.ncbi.nlm.nih.gov/articles/PMC11244688 ; https://tro.amegroups.org/article/view/7092/html . Excerpts.
40. Patient-specific QA: https://pmc.ncbi.nlm.nih.gov/articles/PMC4491675 and AAPM 2019-2020 abstracts. Excerpts.
41. Robust optimisation and RBE: https://pmc.ncbi.nlm.nih.gov/articles/PMC8270090 ; UPPROACH protocol https://cdn.clinicaltrials.gov/large-docs/00/NCT04527900/Prot_SAP_000.pdf . Excerpts.
42. Shielding: proton facility Monte Carlo design study https://pmc.ncbi.nlm.nih.gov/articles/PMC8491310 and AAPM presentation https://www.aapm.org/meetings/amos2/pdf/35-9056-67793-719.pdf . Excerpts only (maze omitted, borated polyethylene door).
43. Sagentia. *ProBeam 360° case study* (moving floor, smaller gantry). Read. https://sagentia.com/case-study/varian-a-siemens-healthineers-company-probeam-360-proton-therapy-system/
44. DLR Group. *Penn Medicine Lancaster General Health proton therapy addition* (12,100 SF). Excerpt. https://www.dlrgroup.com/work/penn-medicine-lancaster-general-health-proton-therapy-addition/ ; Varian, ProBeam 360° selected by Penn Medicine (Oct 2019): 30 % smaller footprint, about 25 % lower vault cost (company claim, excerpt) https://www.varian.com/de/node/6438
45. UF Health Proton Therapy Institute fact sheet (March 2025). Read (text layer): 100 t gantries, 220 t cyclotron, 18 ft walls, $125m. https://www.floridaproton.org/sites/default/files/press-kit/fact_sheet_rev_3.4.25.pdf
46. OncoLink. *Proton therapy: behind the scenes.* Read. https://www.oncolink.org/cancer-treatment/radiation/types-of-radiation-therapy/proton-therapy/overviews-of-proton-therapy/proton-therapy-behind-the-scenes
47. Elekta Unity: FDA K212114 https://fda.innolitics.com/device/K212114 ; 100th system https://cdn.auntminnie.com/clinical-news/mri/article/15628526/elekta-reaches-elekta-unity-milestone ; hardware papers (excerpts) https://pmc.ncbi.nlm.nih.gov/articles/PMC8364272
48. Throughput: Massachusetts determination of need filing https://www.mass.gov/doc/responses-to-don-questions-pdf-umass-memorial-health-care-inc-substantial/download ; Mevion success story https://mevion.com/success-story/unprecedented-clinical-go-live-robert-wood-johnson-university-hospital . Excerpts, vendor figures.
49. Safety interlocks: Minnesota rule https://www.revisor.mn.gov/rules/4731.4467/version/2014-01-18T05:53:38-06:00 ; Pennsylvania rule https://www.law.cornell.edu/regulations/pennsylvania/25-Pa-Code-SS-228-33a ; incident report https://relir.cepn.asso.fr/en/reports/medical-and-veterinary/radiotherapy/274-accidental-exposure-of-healthcare-aide-in-a-radiotherapy-department.html ; a proton facility page https://legacy-one.lluh.org/node/5936 . Excerpts.
50. Costs: UK government £250m https://www.gov.uk/government/news/government-commits-250-million-for-innovative-cancer-treatment-to-save-lives-and-reduce-side-effects ; https://www.fiercebiotech.com/medical-devices/u-k-s-nhs-commits-380m-to-build-two-proton-therapy-devices . Excerpts.
51. Dose and fractions: chordoma https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8270096/ ; medulloblastoma https://pmc.ncbi.nlm.nih.gov/articles/PMC3954470 ; uveal melanoma https://pmc.ncbi.nlm.nih.gov/articles/PMC3770228 . Excerpts.
52. Rutherford Health (liquidation June 2022): https://en.wikipedia.org/wiki/Rutherford_Health (read); UK Parliament petition https://petition.parliament.uk/petitions/644753 (excerpt).
53. Proton arc therapy: https://physicsworld.com/a/worlds-first-patient-treatments-delivered-with-proton-arc-therapy/ . Excerpt.
54. This repository: `docs/research/new-devices.md` (sections 0, 1, 2A, 6, 10), `docs/research/procedures.md`, `src/content/procedures/or-cholecystectomy.json`, `src/content/procedures.ts`, `src/sim/types.ts` (R5 unions), `src/sim/places.ts` (`WALL`, `ceilingHeight`, atrium). Read.
55. IBA Proteus ONE size and cost at launch (2010): https://www.fiercehealthcare.com/healthcare/iba-introduces-proteus-one-tm-a-smaller-more-cost-effective-proton-therapy-system (the page returned 403; figures from search excerpts: 49 x 95 ft including shielding, $25-30m) ; UF ProteusONE equipment page https://radonc.med.ufl.edu/2018/10/22/new-proton-therapy-equipment-heads-to-the-uf-health-proton-therapy-institute-in-jacksonville/ (certificate error; S2C2 55 t from a search excerpt). Excerpts only.
56. Console and beam's-eye-view descriptions (patent and control-system paper; excerpts): https://patents.justia.com/patent/10342997 ; https://jacow.org/icalepcs2017/papers/TUPHA056.pdf
57. NHS England adult proton policy (older, 2015) https://www.england.nhs.uk/commissioning/wp-content/uploads/sites/12/2015/10/b01-pd-prtn-bm-thrpy-adlts-oct15.pdf ; breast policy https://www.medicinesresources.nhs.uk/proton-beam-therapy-for-breast-cancer-all-ages-clinical-commissioning-policy-1.html . Excerpts.
