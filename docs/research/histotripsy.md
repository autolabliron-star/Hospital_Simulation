# Histotripsy: the HistoSonics Edison system, researched for a watchable cancer treatment

Research date: 2026-10-31. Regulatory and market facts are "as of October 2026". Written so that a later wave can model the machine and its room in Blender and script two step-by-step treatments in the R5 procedure engine, the way the hospital's surgeries are scripted today. Synthetic patients only; educational; the sim plays scripted demos and makes no clinical decisions. Nothing here is medical advice. Companion to `docs/research/procedures.md` (format), `docs/research/new-devices.md` (the device survey, where Edison is ranked #3) and `docs/research/cryoablation.md`.

## 0. Summary

### 0.1 How to read this document

Every fact carries `[n, T]`: `n` is the source number in section 9, `T` is a confidence tag, as in `new-devices.md`:
- **V** read in a primary source (FDA record or summary, peer-reviewed paper, trial registry, hospital page) during this research;
- **C** company claim (HistoSonics press, web or patent), or a single source or search excerpt I could not cross-check;
- **U** from background knowledge or common practice, not found in a source. Check before it goes on a card.

`sim` marks a choice for the simulation. Sizes in 2.2 are **modelling targets for our own generic model, not vendor specifications**.

Abbreviations in the step tables: **IR** interventional radiologist (or HPB surgeon: both lead cases, section 6); **Anaes** anaesthetist; **ODP** anaesthetic practitioner (UK operating department practitioner); **Son** sonographer or ultrasound radiographer at the ultrasound cart; **RN** circulating nurse; **Tech** scrub nurse or surgical technologist; **CS** company clinical specialist; **Porter**. **UI** is the Edison touch screen on its cart; **US** is the GE ultrasound screen. Positions are relative to the patient: head, patient's right, patient's left, foot. In the sim the head end is the room's west side (see 7.1).

### 0.2 What it is, in five lines

- Histotripsy is focused ultrasound that destroys tissue **mechanically**: very short, strong pulses make a cloud of tiny bubbles at one focus, and the bubbles tear the tissue there into a fluid-like remnant. No heat, no needle, no incision, no radiation [4, V][35, C].
- The **Edison** system (HistoSonics, Plymouth, Minnesota) puts a focused 128-element transducer (modelled as a bowl) and a coaxial ultrasound probe on a six-axis robot arm. The arm sweeps the bubble cloud (about 4 x 4 x 8 mm) through a planned volume up to 40 mm across, while the doctor watches the cloud live on ultrasound [4, V].
- The patient lies under general anaesthesia. The head sits in degassed water held in a disposable membrane on the abdomen or flank [4, V][7, V].
- It is the **first and only histotripsy platform authorised anywhere**: FDA De Novo DEN220087, granted 6 October 2023, for "non-invasive destruction of liver tumors, including unresectable liver tumors" [1, V]. The company's "first and only" wording is [20, C]. CE mark for liver announced 13 July 2026 [20, C].
- Everything outside the liver is **investigational as of October 2026**: kidney (FDA De Novo request announced 11 May 2026, undecided), pancreas, prostate (BPH) [18, 19, V][22, C].

### 0.3 Why it is among the most advanced cancer machines

- It is the only authorised way to destroy a tumour **through intact skin with neither heat nor ionising radiation**, with the effect visible as it happens on ordinary ultrasound [4, V]. "First and only" is the company's wording [20, C].
- The robot does the work a doctor does by hand with needles: it moves the focus point by point, with electronic micro-steering inside each point, so a 3 cm sphere takes a minimum of about 10-12 minutes [4, V].
- It is not affected by blood-vessel "heat sink", the cooling that leaves thermal ablation incomplete beside large vessels [30, V].
- Commercial and clinical pace: more than 2,000 patients and over 50 active centres by August 2025 (company) [21, C]; acquired at a $2.25 billion valuation in August 2025 and valued at $3.75 billion in June 2026 [21, 22, C]; FDA cleared a CT/MRI planning tool for it on 29 May 2026 [5, V].
- **The honest limit:** the evidence is single-arm. One-year local control was **63.4%** by the trial's primary assessment and **90%** only by a post hoc re-read [8, V]. Section 3.3.

### 0.4 How it differs from the hospital's other ablation machines

| | CT-guided argon cryoablation (Visual-ICE class, guidance robot) | ProSense (liquid nitrogen) | Visualase (planned, MRI laser) | **Edison histotripsy** |
|---|---|---|---|---|
| Kills with | freezing: two or three freeze-thaw cycles | freezing: one probe | heat from a laser fibre | **bubble cloud: mechanical, no heat** |
| Breaks the skin | several 17 G or 14 G needles | one probe through a stab | a thin fibre through a small hole | **no** |
| Guidance | CT; ice ball seen on CT | ultrasound; ice ball with a dark shadow | MRI heat map every few seconds | **ultrasound; the cloud is a bright spot** |
| Robot | aims the needle guide; the doctor pushes the needle | none | none | **the arm sweeps the focus through the volume** |
| Heat sink matters | less (cold) | less | yes (heat) | **no** |
| Anaesthesia | sedation or general | none | general | **general in practice** |
| Staff leave for scans | yes (CT) | no | no (U) | **no** (no radiation: U) |
| Room time | 80-135 min | 20-40 min | hours (U) | **1-3 hours** [35, C][37, V] |
| Organs | kidney, lung, liver | breast | brain | **liver (authorised); kidney, pancreas (trials)** |

Cryo and ProSense rows are from the repo's earlier research [44, V]; the Visualase row from `new-devices.md` [44, V].

## 1. How it kills cancer, in plain words

1. **A bowl of sound, aimed at one spot.** The therapy transducer is a focused array of 128 small elements (a bowl in our model: U). All send pulses of about 700 kHz so that they meet at one focus, at most 12 or 14 cm deep depending on the head [4, V][7, V]. The pulses are shorter than 20 microseconds [7, V].
2. **A pull strong enough to tear water-rich tissue.** In the "pull" half of each pulse the pressure drops far below zero. Above roughly 26-30 megapascals in water-rich soft tissue (a patent's figure for published measurements), tiny gas pockets inside the tissue open into a cluster of bubbles [32, C]. A review gives 15-25 MPa for multi-cycle pulses [33, V]. This is **cavitation**, and it is a threshold effect: no cloud forms below the threshold [4, V].
3. **The bubble cloud.** The cloud is about 4 x 4 x 8 mm on the newest software and appears only at the focus [4, V]. The bubbles grow and collapse within microseconds; a thin remnant cloud can last tens of milliseconds [33, V]. The repeated stretch and collapse breaks the cells. After "less than a few seconds" at each spot the tissue is an **acellular lysate**, a liquid-like remnant with no recognisable cells [4, V].
4. **No heat.** The pulses are very short and spaced apart so bubbles dissolve between them; the software adds cooling pauses (a "thermally safe" table) [4, V]. In one patent example the therapy runs 2.5 minutes, then cools 2.5 minutes [32, C]. Real Edison pulse rates were not found; the patent's examples are hundreds of hertz [32, C].
5. **The arm builds the volume.** The software places the cloud at point after point inside the doctor's planned volume. Treated tissue goes dark on ultrasound; the cloud itself is bright [33, V][32, C].
6. **Why vessels and bile ducts tend to survive.** Tissue that is denser, stronger and rich in collagen resists the cloud. In animal studies, large vessels and bile ducts stayed intact inside a fully broken-down liver zone [40, C]. This is a **tendency, not a guarantee**: the pivotal trial still had a sepsis in a patient with a bile-duct stent, a bile collection at day 188 and a portal vein clot [7, 8, 30, V].
7. **Why there is no heat sink.** Blood flow cannot carry the effect away because the effect is not heat [30, V].
8. **Afterwards.** The body clears the remnant over weeks to months. In the one published UK kidney case the zone shrank from 3.28 cm at 30 days to 2.0 cm at one year [13, V].

**Possible immune effects (research only).**
- In mice (melanoma and liver tumour models), treating one tumour shrank an untreated one; the treated tumour showed early release of danger signals and later T-cell entry, and the effect was strongest with a checkpoint drug (anti-CTLA-4). Groups were small and the authors have ties to HistoSonics [34, V].
- In people, the company says untreated tumours rarely shrink and it cannot be predicted [35, C]. A single case report and a University of Michigan summary claim an abscopal effect [41, C]. A 2026 Radiology review is said to call patient evidence "largely unestablished" (search excerpt only) [41, U].
- Trials of histotripsy plus the immunotherapy drug durvalumab in bile-duct cancer are registered (NCT07766187 at Wisconsin, phase 2, 12 patients, not yet enrolling; NCT07853690) [41, C].
- **Not a claim for any card.** Do not show an immune effect as an outcome.

## 2. The machine and the room

### 2.1 The parts

| Part | What it is | Source |
|---|---|---|
| **Treatment cart** (reusable) | Tall wheeled cart with wheel lock. Holds the 128-channel amplifier and generator, a high-voltage supply (10 A maximum, 3.5 A average), a power box, a 770 W battery backup (120 V US version) and the computer. On top: the **UI touch screen**, knobs (contour size, voltage), an emergency stop, a trackpad and a space mouse | [4, V][32, C] |
| **Treatment arm** | Six-axis robot arm with two encoders per joint. Moved by hand with "freedrive" buttons or the space mouse; the software then moves it on its own. A **resistance indicator** (yellow, orange, red) slows the arm to 50%, then 25%, and stops it at a force limit (50 N in the patent example) | [4, V][32, C] |
| **Treatment head** | Two versions, both 128-element: 12 cm and 14 cm maximum treatment depth. Inside the bowl, a coaxial GE probe (C1-6VN-D) that rotates plus or minus 180 degrees and slides 5 cm; live image all the time | [4, V] |
| **Water-coupling set** | A reusable **support arm** (three joints) with a 1-inch bed-rail clamp holds an upper and lower **frame**. A disposable clear **membrane** (SEBS plastic on a polypropylene frame) holds degassed water against the skin. Castor oil is the film between membrane and skin. Also: a silicone web cradle, a **bubble bulb** (moulded bulb and tube) and an **inspection mirror** | [4, V] |
| **Fluidics cart** | The "cart to create the medium": makes and circulates degassed water, can adjust temperature; the patent embodiment holds 10-20 litres in the frame | [35, C][30, V][32, C] |
| **Ultrasound system** | A GE LOGIQ E10s, supplied with every Edison; the head's probe feeds it | [4, V] |
| **Planning software (new)** | HistoSonics Planning Tool, FDA 510(k) K252947, 29 May 2026: imports CT and MRI, simulates head and water-reservoir placement, shows the sound path, flags rib or other blockage and set-up collisions; machine-learning outlines of liver, kidney, lungs and ribs. Runs on a laptop or cloud. It does not exchange data with Edison | [5, V] |
| **Fusion viewer (optional)** | IMFusion software: joins a live ultrasound sweep to the earlier CT or MRI | [4, V] |

Reusable: cart, support arm, frame, GE unit. Disposable: membrane and the set-up accessories [4, V]. The De Novo summary is said to state that the system and accessories need no sterilisation (search excerpt) [42, C].

### 2.2 Modelling sizes (targets for our own generic model)

| Item | Target size (our own) | Basis |
|---|---|---|
| Treatment cart | 0.75 w x 1.0 d x 1.5 m high, four wheels, brake pedals; screen about 0.55 x 0.33 m on a jointed arm | "about five feet tall" is a magazine search excerpt [42, U]; the rest is ours |
| Robot arm | base on the cart top at 1.15 m; upper arm 0.45 m, forearm 0.40 m, wrist 0.15 m; link diameter 0.10 m; joint rings visible | ours |
| Treatment head | housing 0.22 m wide, 0.40 m tall; dark bowl inside; probe tip at the centre; two sizes (12 and 14 cm depth) differ in bowl depth | ours; element count and depths from [4, V] |
| Water frame and membrane | soft clear pillow about 0.35 m across and 0.20 m deep (about 10-20 litres), rim sealed to the skin | volume from [32, C]; shape ours |
| Support arm | three joints, clamp on the bed rail, reaches from the rail to the frame (about 0.5 m) | [4, V]; size ours |
| Fluidics cart | 0.55 x 0.75 x 1.0 m, clear reservoir, two hoses to the frame, small display | ours |
| Ultrasound cart (GE class) | 0.6 x 0.9 x 1.5 m, monitor 0.55 m wide, one spare probe holder | ours |
| Treatment table | 2.1 x 0.55 m, 0.9 m high, side rails, flexes in the middle (kidney) | ours; rail and flex from [4, V][13, V] |
| Anaesthesia machine, monitor | reuse the theatre props | repo |
| Min clear floor | 1.2 m round the table; cart-to-table gap 1.3 m | ours |

### 2.3 What the room needs

- **Room type:** an operating theatre or an interventional suite. US centres use an operating room [10, V]; the Cambridge and Wellington cases run with theatre staff [23, V][27, V]; the first North Carolina case lists two RNs, two surgical technologists and three anaesthesiologists [38, V].
- **General anaesthesia:** used for all patients in the pivotal trial [7, V]; "most sites" use it, to control movement [35, C]; the kidney trial needs a patient who can tolerate it [18, V].
- **Breath control is the main anaesthetic task.** The focus must stay on the tumour while the liver or kidney moves with breathing. Options in published use: **one-lung ventilation**, mostly with a double-lumen tube (24 of 26 patients in a Hong Kong series), with a muscle relaxant, small tidal volumes (5-6 ml/kg) and desaturation in 29% managed with oxygen and PEEP [11, V]; **jet ventilation**, which cut the up-and-down stretch of the treated zone in pigs from 32.3 to 27.8 mm [12, V]; tuned tidal volume and PEEP in the UK kidney case [13, V]. Anaesthetist, radiologist and surgeon tune the ventilation together by watching the image [11, V].
- **Table:** a standard table with side rails (the support arm clamps to a 1-inch rail) [4, V]; wedges and padding; flexible in the middle for a kidney in the side position [13, V].
- **Power and water:** the cart carries its own battery backup [4, V]; degassed water comes from the fluidics cart [35, C]. Mains and drainage needs of the fluidics cart were not found [U].
- **No radiation and no shielding.** It is ultrasound only; nobody has to leave the room for a "scan" or a "shot" [U, inferred].
- **Space:** an operating theatre is 40-60 m2 [U]. The sim's `l2Or` is 9 x 8 m and `l2Cryo` 9 x 9 m [44, V]; the planned `atHisto` is 10 x 10 m [44, V]. Section 7.2.

### 2.4 What each screen shows

| Screen | Shows |
|---|---|
| **US** (GE, live) | Grey sector fan with speckle; liver or kidney with the tumour as a rounder, differently bright spot, vessels as dark tubes, the diaphragm as a bright curve deep down. During test pulses and treatment the **bubble cloud is a bright spot** at the focus; tissue already treated turns **darker** (liquefied tissue is dark) [33, V][32, C]. The cloud is also audible [2, C] |
| **UI, set-up and localise** | Head chosen, probe position, cross-hairs; a **resistance bar** (yellow, orange, red); "level the head" button; buoyancy value after submerging; patient orientation (one of two room set-ups, cart on the patient's right or left) [32, C] |
| **UI, optional fusion** | Breath-hold sweep (about 500 frames over plus or minus 30 degrees in the patent example), trim recording, registration points, fused CT or MRI beside the live image [4, V][32, C] |
| **UI, plan** | Three panes: axial, sagittal and a 3D model. A **contour** ring around the tumour (default 20 mm, plan range 15-40 mm any way, no more than 2:1) and a **margin** ring; **survey points** (seven in the patent: centre and the six ends of the axes) [4, V][32, C]. The plan is checked by surveying (arm walks the head round the plan without firing) and the muscle layer is marked [4, V] |
| **UI, test** | Voltage percent per survey point, a cavitation chip ("detected" or "sustained"), the cloud's centre on the cross-hair; a degassed-water reference of about 18-24% voltage [32, C] |
| **UI, treat** | A 3D **volume progress** picture filling point by point, "cloud detected" status, an estimated time before starting, stop and pause [32, C] |
| **Anaesthesia monitor** | Heart trace, oxygen, pressure, end-tidal CO2, ventilator curves (existing theatre props) |

The patent's screen details are embodiments, not the shipping screen: tag every UI detail C [32, C]. The required workflow in the FDA summary is V [4, V].

### 2.5 The workflow at the console (FDA 510(k) K241902) [4, V]

| Phase | Required steps |
|---|---|
| **System set-up** | Log in; position the treatment arm; attach or select the treatment head; position the imaging probe; submerge the head (in water, before the patient); calibrate the cross-hairs; register the patient |
| **Patient preparation (localise)** | Prepare the patient; couple the patient (membrane on skin); lock the wheels; calibrate resistance detection |
| **Plan** | Position the contours; verify set-up by surveying the plan so the resistance is acceptable; mark the muscle layer; verify the plan |
| **Treat** | Calibrate the cross-hairs in the patient; establish voltage settings; automated treatment |
| **Shutdown** | Remove the treatment head; move the arm to its storage position |
| Optional | Image fusion: breath hold and image sweep, review and trim, registration points, fuse, accept |

## 3. Evidence and status

### 3.1 What is authorised, as of October 2026

| Where | Status | Source |
|---|---|---|
| US, liver | **De Novo DEN220087**, granted 6 Oct 2023 (request received 2 Dec 2022); Class II, product code QGM, 21 CFR 878.4405, "focused ultrasound system for non-thermal, mechanical tissue ablation". Indication: non-invasive destruction of liver tumours, including unresectable ones | [1, V][2, V] |
| US, upgrades | 510(k) **K233466** (13 Mar 2024: 64-channel, cloud 3 x 3 x 11 mm, 13 min for a 3 cm sphere); **K241902** (30 Oct 2024: 128-channel, cloud 4 x 4 x 8 mm, 10-12 min); **K252947** HistoSonics Planning Tool (29 May 2026, software) | [3, V][4, V][5, V][6, V] |
| US, kidney | **Investigational.** De Novo request announced 11 May 2026 on #HOPE4KIDNEY data; **no decision found** by 31 Oct 2026 | [18, 19, V] |
| US, pancreas | Investigational (GANNON, Barcelona); company says an FDA submission is "anticipated" | [15, V][22, C] |
| US, prostate (BPH) | Investigational; first patients in a Hong Kong study (WOLVERINE) March 2026 | [41, C] |
| EU | **CE mark for liver tumours**, announced 13 Jul 2026; phased launch at selected centres. No other CE indication reported | [20, C] |
| UK | MHRA Unmet Clinical Need Authorisation, April 2025, under the Innovative Devices Access Pathway pilot. **No NICE guidance** (Cambridge page); **not commissioned by NHS England**, so places are limited and there is a waiting list. NHS site: Addenbrooke's, Cambridge (first NHS patient outside a trial, October 2025). Private: The Wellington Hospital, London (17 Feb 2026, "first private hospital in Europe"). Kidney: a trial (CAIN) at Leeds | [23, 24, 25, 26, V][13, V][41, C] |
| Israel | **No source found** for an Edison system in Israel by 31 Oct 2026. Israel can register CE-marked devices (AMAR) [U], but no Israeli site or registration was found | [U] |
| Elsewhere | UAE: SEHA Tawam Hospital, Abu Dhabi, announced as the first UAE provider on 10 Apr 2026, 21 patients treated. Hong Kong (gifted systems; package prices HK$256,000-310,000, roughly £25,000-30,000 by my conversion), Singapore (a 40-patient local trial planned), Taiwan (regulator approval May 2026, a free 50-patient programme) | [28, V][25, V][30, V][29, V][42, C] |

Do not confuse the numbers: `DEN230043` is an unrelated eye device [1, V].

### 3.2 Trials and registries

| Trial | What | Status | Source |
|---|---|---|---|
| **THERESA** (NCT03741088) | First in human; Spain; prototype; 8 patients, 11 tumours (1 primary, 10 metastases); technical success in all 8 | published 2022 | [9, C] |
| **#HOPE4LIVER** (NCT04572633 US, NCT04573881 EU/UK) | Pivotal single-arm; 14 sites; 44 patients treated (21 US, 23 EU/UK), up to three tumours each under 3 cm; 18 liver cancer, 26 metastases | published 2024, one-year update 2025 | [7, 8, V][17, C] |
| **BOOMBOX** master study (NCT06486454) | Real-world, observational, 5,000 patients planned; primary: technical success within 36 h; includes benign liver tumours; 33 US sites listed | recruiting; ends 2034-2039 | [16, V] |
| **#HOPE4KIDNEY** (NCT05820087) | Pivotal single-arm; 67 patients; one non-metastatic solid renal mass of 3 cm or less; 15 US sites; primary: tumours eliminated at 90 days on contrast MRI or CT; safety: no Clavien-Dindo grade 3+ complication to 30 days | enrolment ended 2025; primary completion 4 Sep 2025; results not published; submitted to FDA | [14, V] |
| **CAIN** (UK kidney) | 20 patients, biopsy-proven non-metastatic renal cancer, Leeds | feasibility reported at a meeting (search excerpt) | [41, C] |
| **GANNON** (NCT06282809) | Pancreatic adenocarcinoma stage 3 or limited stage 4; feasibility, safety first; tumour 2 cm or more, at least 1 cm from bowel; Barcelona; 50 planned | first patients Dec 2024; completion 2028 | [15, V] |
| Immune combinations | Durvalumab plus histotripsy (NCT07766187; NCT07853690) | not yet enrolling or early | [41, C] |

### 3.3 What the liver evidence says (and does not)

- **30-day pivotal results** (44 patients, 49 tumours): technical success **42 of 44 (95%)** against a goal above 70%; procedure-related major complications **3 of 44 (7%)** against a limit below 25%. Mean tumour 1.5 cm; mean treated zone **3.6 cm** (the margin effect). Treatment time 34 plus or minus 25 min per tumour; total procedure 221 plus or minus 64 min; all single sessions [7, V].
- **The three major complications:** sepsis with an indwelling bile-duct stent; pleuritic pain needing a 2-day stay; liver failure in a patient with innumerable breast metastases (death at day 37) [7, V].
- **Common effects:** abdominal pain 23%, procedural pain 20%, fever 14%, fatigue 11%, lung collapse patches 9% [7, V].
- **One-year update** (47 patients, 52 tumours, 14 sites): local control **63.4% by the primary assessment and 90% by the post hoc assessment** (made afterwards to allow for a learning curve in reading the new scan pattern); one-year survival 73.3% (liver cancer) and 48.6% (metastases); six serious device-related events within 30 days [8, V]. The "90%" headline is the company's [20, C].
- **What was not measured:** the trials measured destruction of the planned zone, not survival benefit against another treatment. No comparison trial exists [30, V][7, V].
- **Limits on who can be treated:** the tumour must be visible on ultrasound and reachable by the beam through a window between ribs, away from bowel gas. Favourable liver segments: 1, 2, 4a, 6; possible through the ribs: 3, 4b, 5; unlikely: 7, 8 and dome or deep caudate tumours [10, V]. Cambridge: ideally up to three tumours, each 3 cm or smaller [24, V]. Plan size on the machine: 15-40 mm [4, V]. Wellington: may be unsuitable above 5 cm [27, V].

### 3.4 Systems, patients and costs

- **Worldwide:** more than 2,000 patients and over 50 active centres in the US, UAE and Hong Kong by August 2025, with 50 new installs planned by year end (company) [21, C]; "over 2,000 patients" repeated by Cambridge in October 2025 [23, V]. **No newer count found**: treat 2,000 as a floor.
- **First commercial patients:** December 2023 (University of Rochester; Cleveland Clinic the same week) [41, C].
- **Europe:** first system at Addenbrooke's, a gift from the Li Ka Shing Foundation (which also gave three systems to Hong Kong, one to Singapore, one to Stanford) [25, V]; distribution partners in Central and Eastern Europe (search excerpt) [42, U].
- **Costs (all rough):**
  - US Medicare outpatient payment for liver histotripsy (CPT category III code 0686T): about **$17,500** in a hospital outpatient department and **$9,527** in an ambulatory centre; patient share about $1,676-1,878 [30, V]. Earlier rate: $12,500.50 for 2022 [31, V].
  - Consumables about **$6,000** a procedure; system capital cost up to SGD 2.7-4.0 million (about US$2.0-2.9 million at 1.36 SGD per dollar) [30, C].
  - A kidney code (category III) and a Medicare code C9790 are said to exist [42, U].
  - UK private price: **not published**. NHS: Addenbrooke's charity gave preliminary funding (the first 33 NHS patients, per a university summary) and NIHR is exploring a cost-effectiveness study [23, V][42, C].
  - A Singapore review put procedure cost at 3-9 times that of local thermal ablation [30, V].

### 3.5 Corrections to `new-devices.md` (row 3 and section 7.3)

| `new-devices.md` | Newer source |
|---|---|
| "64-channel amplifier" | That is K233466 (Mar 2024). Since K241902 (Oct 2024): 128-channel amplifier and heads [4, V] |
| "kidney De Novo request submitted 13 May 2026" | The company release and MedTech Dive are dated **11 May 2026** [19, V] |
| "#HOPE4LIVER 90% local control at 12 months (company)" | Peer-reviewed: 63.4% primary, 90% post hoc [8, V] |
| "a water-filled coupling bag or tub under the transducer" | The head is **inside** a membrane frame of degassed water on the patient, held by a bed-rail support arm [4, V] |
| "interventional oncology room" | Real cases run in an operating theatre or procedure room under general anaesthesia [10, 38, V] |
| De Novo number missing | DEN220087, 6 Oct 2023 [1, V] |
| not mentioned | CT/MRI Planning Tool K252947, 29 May 2026 [5, V] |

## 4. The patient journey

| Stage | What happens | Time | Source |
|---|---|---|---|
| **Referral** | A consultant refers (no self-referral). Local cancer team discusses the case; the treating centre's team reviews it again: IR, liver surgeons, oncologists, hepatologists, radiologists | days to weeks | [24, V] |
| **Tumour board decision** | Considered when surgery or standard ablation is unsuitable, for palliative control, or to bridge to transplant. Weekly board in one US centre | weekly | [10, V] |
| **Planning scans and the acoustic-window check** | CT or MRI within about a week (liver trial) to 30 days (kidney trial); blood tests (liver, kidney, clotting); a **sonographer's ultrasound** grades how well the tumour shows, its depth, whether the beam must go under or between the ribs, and at what angle. Some patients are ruled out here. Since May 2026 the Planning Tool can simulate the head and water reservoir on the CT or MRI and flag rib blockage | 1-2 visits | [7, 14, 10, 5, 24, V] |
| **Before the day** | Pacemaker and blood-thinner checks; possible antibiotics or bowel preparation; fasting about 8 hours (clear drinks until 2 hours before arrival at one centre); diabetes and weight-loss medicines adjusted; a responsible adult to take the patient home | 1 day | [24, 27, 36, V] |
| **Day of treatment** | Arrive; name and date of birth checked repeatedly; gown; drip; anaesthetist review; glucose check; walk or wheel into the room; general anaesthetic; **in the room 1-3 hours** (2-4 hours including set-up in one centre; pivotal trial mean 221 minutes) | 2-4 h | [36, 37, 10, 7, V][35, C] |
| **Recovery** | Recovery unit: heart, oxygen, pressure and temperature watched; oxygen; compression boots; drip out; many go home the **same day or the next**; imaging **right away or within 36 hours** | 2-6 h | [36, 37, 7, 23, V] |
| **Aftercare** | A short blood-thinner course if a large vessel was treated (two weeks at one centre); antibiotics in some centres; soreness for a few days; most resume normal life in 24-48 hours | days | [10, 37, V] |
| **Follow-up imaging** | Cambridge: day 0-3, 4 weeks, 3 months, then every 6 months. Cleveland: day 1, day 30, day 90. Wellington: scans at 1 and 3 months. The pivotal trial: 36 hours, 30 days, then yearly follow-up planned to 5 years | 1 d to 5 y | [24, 10, 27, 7, 30, V] |

## 5. Two treatments, step by step

Both tables follow the `procedures.md` layout. Captions are 60 characters or fewer; "Why" lines are 160 or fewer; no graphic words. "Time Out" and "Sign Out" are the WHO checklist pauses, adapted for a procedure with no cut: the Time Out comes before anything is fitted to the patient [39, V]. The WHO and NHS sheets are the source of the pause items; the adaptation to histotripsy is U. The sim's patient is synthetic; every number on screen is a pure function of progress and a seed (`new-devices.md`, section 3).

Settings both tables assume (`sim`): cart and support arm on the **patient's right** (south in the sim) for the liver case and on the **back side** for the kidney case; Edison head in the 14 cm version; system set-up (head chosen, probe positioned, head submerged in water, cross-hairs calibrated) **done before the patient arrives**; patient registration on the UI is the last set-up step in the FDA workflow [4, V] and is shown at Sign In (step 4) (sim).

### 5.1 (a) Liver metastasis, under general anaesthesia (the authorised indication)

**Background.** A 2 cm metastasis in the right lobe of a synthetic patient, seen through a right subcostal window, one planned volume. General anaesthesia with a muscle relaxant and controlled breathing. Real room time is about **95-175 minutes** (wheels in to wheels out), with 12-25 minutes of automated treatment; the published ranges are 1-3 hours [35, C], 2-3 hours [37, V], a Hong Kong median of 73 minutes for the procedure [11, V] and a trial mean of 221 minutes [7, V].

| # | Step | Why | Min | Who does what, and where | Hands (left / right) | Patient state | Machine state and screen view |
|---|---|---|---|---|---|---|---|
| 1 | Wheels in; team says hello | The team meets the patient and checks the room is ready. | 3-5 | Porter + RN: push the stretcher in; Anaes + ODP: at the head; IR: at the cart, reading the scan on the UI; CS: behind the IR; Tech: at the back table; Son: at the ultrasound cart | - | On the stretcher in gown, cap and ID band, drip in, fasted | Cart on, arm folded over the cart, head already in the water frame (set-up done) [4, V]; UI: patient list; US on standby |
| 2 | Move across to the treatment table | A slide sheet moves the patient across without lifting. | 2-4 | RN (patient's left) + Porter (patient's right): slide sheet; Anaes at head; ODP holds the drip | Both hands on the sheet | Flat on the back, head on a pillow | Table with side rails (the arm clamp needs a 1-inch rail) [4, V]; cart parked at the patient's right; US on standby |
| 3 | Monitors, drip and oxygen on | Heart trace, oxygen level and pressure are watched from here on. | 3-5 | ODP: at the head, leads, finger probe, cuff; RN (patient's left): temperature probe; Anaes: checks the drip | L: BP cuff / R: ECG leads (ODP) | Monitored; blood sugar checked [36, V] | Anaesthesia monitor shows heart trace and oxygen |
| 4 | Sign In: name, treatment, allergies | WHO check before any medicine: right patient, right treatment, allergies known. | 1-2 | Anaes + RN + IR at the head; patient answers aloud; IR confirms the scan is displayed and blood thinners were stopped [39, V] | RN holds the tablet | Awake; confirms name, birth date, consent, fasting | UI: patient registered; plan screen with the CT image |
| 5 | Anaesthetic given; patient falls asleep | Sleep medicine and a muscle relaxant keep the liver still later. | 4-6 | Anaes: at the head, mask and drip medicines; ODP hands equipment; RN stays at the left [11, V] | L: oxygen mask / R: drip syringe | Oxygen by mask, then asleep and relaxed | - |
| 6 | Breathing tube placed; ventilator set | The ventilator takes over so the liver moves very little; some centres rest one lung. | 5-10 | Anaes: at the head; ODP hands the tube; tube type varies (one-lung ventilation in 24 of 26 patients in one series: 21 with a double-lumen tube, 3 with a bronchial blocker) [11, V] | L: laryngoscope / R: breathing tube | Tube in and secured; eyes taped; warm blanket on; urine catheter optional [36, V] | Ventilator curves on the monitor |
| 7 | Lying flat, right side lifted and padded | Padding and a small lift set the patient so the beam can reach the liver. | 4-8 | IR + RN + ODP: pad pressure points, small wedge under the right side (U), right arm up on a board (U); Anaes at the head keeps the tube safe. Below the ribs: supine; through the ribs: "lazy lateral" [10, V] | Both hands fitting pads | Supine, right side slightly raised | - |
| 8 | Hair clipped; skin cleaned and marked | Hair traps tiny air pockets that block sound; a pen mark shows where the probe goes. | 3-5 | RN (patient's left): clips hair and cleans; IR (patient's right): marks the probe spot [32, C] | L: holds the skin / R: clippers, then marker | Right upper abdomen clean; pen mark | - |
| 9 | Time Out: everyone agrees the plan | Pause before anything is fitted: names, treatment, target, special risks. | 1 | All stop; IR states the plan and target; Anaes the airway and thinners; RN reads; CS confirms equipment; Son confirms the window check [39, V] | RN holds the checklist | Asleep | UI shows the plan screen |
| 10 | Bed-rail arm and water frame fitted | The support arm holds the water frame steady over the belly. | 3-5 | Tech (patient's right, foot side): clamps the support arm to the right rail, snaps in the frame and a new membrane; IR: sets the height; RN: wipes the skin dry and applies a thin oil film (who: U) [4, V] | L: holds the frame / R: arm clamp | Skin dry, oil film where the rim will sit | Frame open, hoses connected to the fluidics cart |
| 11 | Water coupling filled; air chased out | Degassed water carries the sound; any air would block it. | 5-10 | Tech: opens the water line on the fluidics cart; IR: fills the membrane to the minimum line and chases air bubbles to the edge with the bulb tool, checks with the mirror; CS watches the level [4, V][32, C] | L: holds the frame rim / R: bubble bulb | Clear water pillow on the abdomen, no air under it | Fluidics pump runs; level rises; US shows no air artefact once the head is in |
| 12 | Treatment head lowered into the water | The head must sit under the surface with no air on its face. | 4-8 | IR (patient's right, at the cart): guides the arm by hand, levels the head, lowers it until the tip touches, then submerges it above the fill line; RN or CS: locks the wheels; CS watches the resistance bar [4, V][32, C] | L: freedrive buttons / R: space mouse | Unchanged | Arm moves from folded to over-frame to submerged; resistance bar green; buoyancy stored; wheel lock on; UI "localise" |
| 13 | Live view found; breathing tuned to hold still | A clear, steady picture of the tumour is needed before anything is planned. | 4-8 | IR: turns and slides the probe (plus or minus 180 degrees, 5 cm); Son: sets depth and gain; Anaes: tunes tidal volume or rests one lung on the IR's calls [4, V][11, V] | IR: L freedrive / R space mouse; Son: keyboard | Asleep; breathing changed | US: liver fan, tumour spot, veins as dark tubes, diaphragm curve; UI localise |
| 14 | Breath-hold sweep joins the scan to the picture | A short sweep lines the live picture up with the earlier CT (optional step). | 4-8 | IR: starts the sweep; Anaes: pauses breathing for it; CS: guides trimming and the registration points [4, V][32, C] | IR: R trackpad | Breathing paused for seconds | The probe sweeps about plus or minus 30 degrees (patent example); UI: fused CT beside live view |
| 15 | Tumour outlined on the live picture | The doctor draws the exact target on two planes. | 3-6 | IR: places the contour on axial and sagittal views; CS prompts; Anaes watches the monitor [32, C] | L: size knob / R: trackpad | Asleep | UI: three panes; yellow contour ring (default 20 mm; limits 15-40 mm, no more than 2:1) [4, V] |
| 16 | Safety margin added; plan checked and accepted | A ring wider than the tumour makes sure none is missed; the check proves the arm can reach it. | 4-7 | IR: sets the margin, accepts; CS: starts the survey; the arm walks the head round the plan without firing; IR marks the muscle layer [4, V] | L: knob / R: trackpad | Asleep | UI: dashed margin ring, seven survey points, resistance bar stays green; "plan accepted" |
| 17 | First test pulses make a small bright cloud | Short test pulses prove the cloud forms exactly where the cross-hair says. | 3-6 | IR: enables voltage and turns the voltage knob up slowly; CS watches; RN calls "clear"; Anaes watches monitors [32, C] | L: voltage enable / R: voltage knob | Asleep | US: **bright spot** under the cross-hair; UI: cavitation chip "detected"; soft crackle sound [2, C] |
| 18 | More test points; settings stored | Power is checked at the edges so it is right across the whole volume. | 3-5 | Same people; the arm steps to each survey point and IR records the voltage [32, C] | Same | Asleep | US: cloud flashes at each point; UI: seven points tick off |
| 19 | Automated treatment starts at the deepest point | The sweep begins deepest and works toward the skin. | 3-5 | IR: presses start, hand near the voltage knob and stop; all others still [32, C] | L: stop / R: start | Asleep | UI: estimated time shown, volume picture empty; US: cloud at the deepest point |
| 20 | Cloud sweeps through the planned volume | Each spot needs only a few seconds, then the arm moves on. | 12-25 | IR + CS watch UI and US; Son keeps the picture; Anaes keeps breathing steady; RN charts [4, V] | Hands off the controls | Still; no pain under anaesthesia | Arm makes small moves; US: cloud steps and the picture darkens behind it; UI: sphere fills; cooling pauses [4, V][32, C] |
| 21 | Gaps checked and touched up | A last look makes sure the whole planned volume has gone dark. | 3-6 | IR: reviews the volume on US; adds points if a gap shows; CS notes the result [32, C] | L: knob / R: trackpad | Asleep | US: dark zone fills the margin ring; UI: coverage near complete (90-100% in the patent) |
| 22 | Treatment ends; head lifted out | Voltage is switched off before anything moves. | 2-4 | IR: voltage off, lifts the head out and parks the arm; CS: ends the session and saves comments [32, C] | L: freedrive / R: space mouse | Asleep | Arm lifts to over-frame, then folded; UI: session summary |
| 23 | Water drained; frame and membrane removed | The patient must be dry and free of the frame before waking. | 4-7 | Tech: drains through the fluidics cart; RN: lifts off the membrane and frame; IR: releases the support arm (how the water is drained: U) | Both hands on the frame | Oil film wiped off; skin dry | Membrane deflated into a bin |
| 24 | Skin wiped and checked; table flat | Minor skin marks are possible, so the skin is looked at before waking. | 2-3 | IR + RN: look at the skin under the rim [35, C]; ODP: removes the wedge | L: holds the drape / R: gauze | Skin checked; flat on the back | - |
| 25 | Sign Out: what was treated; recovery plan | WHO check before leaving: what was done, any equipment fault, thinners and scans planned. | 1-2 | IR + Anaes + RN + Tech + CS; RN reads [39, V] | RN holds the checklist | Asleep | UI shows the end screen |
| 26 | Patient wakes; breathing tube removed | The anaesthetist reverses the medicines and takes the tube out once breathing well. | 6-10 | Anaes: at the head; ODP: suction; RN: patient's left | L: holds the mask / R: draws the tube out | Awake, breathing, oxygen mask | - |
| 27 | Wheels out to recovery | A handover to the recovery nurse keeps care continuous. | 3-5 | Porter + RN: push; Anaes + ODP: walk at the head with oxygen and monitor | - | On the stretcher | Room doors; US and UI standby |
| 28 | Recovery: watched, scanned, fed | Recovery staff watch the patient; a scan checks the treated area. | 90-180 | Recovery nurse (new, in `atPrep`): checks signs and pain; CT or MRI later today or within 36 hours (some centres at once) [36, 37, 7, V] | - | Awake, comfortable, oxygen, compression boots, drip out | CT or MRI view of a dark treated zone (not shown in the room) |
| 29 | Leaves recovery: home today or bed overnight | Most go home the same day or the next; an adult takes them home. | 20-30 | Recovery nurse + RN: discharge talk; a relative or porter walks them out [23, 35, V] | - | Dressed, walking | - |
| 30 | System shut down; arm stowed | The head comes off and the cart is cleaned for the next case. | 10-15 | CS + Tech: remove head, move arm to storage, bin the membrane and accessories [4, V] | - | - | Arm stowed; UI at log-in |

**Watch compression (seconds per step).** 1: 20, 2: 14, 3: 12, 4: 20, 5: 18, 6: 28, 7: 22, 8: 20, 9: 16, 10: 24, 11: 40, 12: 36, 13: 28, 14: 26, 15: 30, 16: 34, 17: 40, 18: 24, 19: 34, 20: 70, 21: 26, 22: 22, 23: 30, 24: 22, 25: 18, 26: 30, 27: 16, 28: 24, 29: 18, 30: 16. **Total 778 s.** The water filling (11), the arm lowering the head (12), the test cloud (17) and the sweep (20) are the long visible steps; everything on the monitor in 15-16 is a screen close-up.

**Details that make it realistic (liver).**
- **Sizes and times:** planned volume 15-40 mm each way, no more than 2:1; cloud about 4 x 4 x 8 mm; minimum 10-12 minutes for a 3 cm sphere [4, V]. In the pivotal trial (older, smaller cloud) treatment took 34 plus or minus 25 minutes per tumour [7, V]; Cambridge says about 30 minutes of active treatment plus set-up and anaesthesia [24, V].
- **Water:** a clear SEBS membrane on a moulded frame, castor oil between membrane and skin, degassed water from a fluidics cart, a bulb tool to push air out, a small mirror to check underneath [4, V]; about 10-20 litres in the patent embodiment [32, C].
- **The arm:** moved by hand with freedrive buttons only while the head is placed; the doctor never needs to push it while treating. A force-sensing "resistance" bar goes yellow, orange, red; the arm slows and stops [32, C].
- **Calibration first in water, then in the patient:** cross-hairs are calibrated in a water bath at set-up (about 18-24% voltage in the patent), then again with the first cloud in the patient [4, V][32, C].
- **What the cloud looks like and sounds like:** bright on ultrasound, treated tissue dark behind it; audible [33, V][2, C].
- **Breathing:** the main anaesthetic task. Breath holds are used only for the optional fusion sweep [32, C]; during treatment the lungs are ventilated in a controlled way (double-lumen one-lung ventilation, jet ventilation or small tidal volumes) [11, 12, V].
- **Pauses:** Sign In before the anaesthetic, Time Out before anything is fitted to the patient, Sign Out before waking [39, V].
- **Extras seen in a centre's patient guide:** blood sugar checked before and after, a urine catheter in some cases, compression boots in recovery [36, V].
- **After:** soreness, abdominal pain in 23%, fever in 14% [7, V]; scans within 36 hours [7, V].
- **Team at one US centre:** one performing physician, two RNs, two surgical technologists and three anaesthesiologists are named [38, V].
- **Sterility:** the device is said to need no sterilisation [42, C]; no source on whether the arm is draped (U: check).

### 5.2 (b) Kidney tumour (INVESTIGATIONAL in the US: not FDA-authorised for kidney)

**Label to show on screen and card:** "Kidney use is investigational: FDA review pending (De Novo request, 11 May 2026). In the UK it is in a trial." [18, 19, V][13, V] The sim's copy must not say "approved" for the kidney.

**Background.** A synthetic patient with a 2.8 cm lower-pole renal mass, biopsy-proven, 14 days or more before. This follows the published UK case and the #HOPE4KIDNEY rules [13, 14, V]. The patient lies on their side (flank side up) with the table flexed to open the gap between the ribs and the hip bone [13, V]. The planned volume with margin is close to the 40 mm limit of the machine (the published case's zone reached 4.27 cm at 36 hours) [4, V][13, V]. Real room time is **about 125-235 minutes**; treatment about 40-75 minutes here, and **83 minutes** in the published case [13, V]. The real UK case was a right kidney; mirror for a left one. A left kidney reuses the existing `obliqueLeftUp` pose in the sim (7.6).

| # | Step | Why | Min | Who does what, and where | Hands (left / right) | Patient state | Machine state and screen view |
|---|---|---|---|---|---|---|---|
| 1 | Wheels in; team says hello | The team meets the patient and checks the room is ready. | 3-5 | Porter + RN: push the stretcher in; Anaes + ODP: at the head; IR: at the cart reading the plan; CS: behind the IR; Tech: back table; Son: ultrasound cart | - | On the stretcher, gown, ID band, drip in, fasted | Cart on; arm folded; head in the water frame (set-up done) [4, V] |
| 2 | Move across to the treatment table | A slide sheet moves the patient across without lifting. | 2-4 | RN + Porter: slide sheet; Anaes at head | Both hands on the sheet | Flat on the back | Table flat, side rails on; cart parked at the back side |
| 3 | Monitors, drip and oxygen on | Heart trace, oxygen level and pressure are watched from here on. | 3-5 | ODP: leads, probe, cuff; RN: temperature probe | L: cuff / R: leads | Monitored | Monitor on |
| 4 | Sign In: name, treatment, allergies | WHO check before any medicine, plus the trial and thinner checks. | 1-2 | Anaes + RN + IR; patient answers; IR confirms trial consent, kidney scan and that blood thinners, aspirin and anti-inflammatories were stopped 7 days ago [14, V][39, V] | RN holds the tablet | Awake; confirms name, birth date, consent, fasting | UI plan screen with CT |
| 5 | Anaesthetic given; patient falls asleep | Sleep medicine keeps the patient still; the kidney trial needs a patient who can have general anaesthesia. | 4-6 | Anaes: at the head; ODP; RN [18, V] | L: mask / R: drip syringe | Asleep and relaxed | - |
| 6 | Breathing tube placed; ventilator set | The ventilator takes over so the kidney moves less. | 5-10 | Anaes: at the head; ODP hands the tube | L: laryngoscope / R: tube | Tube in; eyes taped; warm blanket; urine catheter optional (U) | Ventilator curves |
| 7 | Turned onto the side; table flexed; padded | Lying on the side opens the flank to the beam; flexing the table widens the gap. | 8-15 | Four people turn together on the Anaes's call: Anaes holds head and tube; IR, RN, Tech turn and pad; ODP holds the drip; table "broken" (flexed) to open the flank [13, V] | All hands on the draw sheet | On the side, flank up, pillow between the knees, arm forward on a board, padded; bean bag or strap (U) | Table flexes; cart still parked |
| 8 | Hair clipped; flank cleaned and marked | Hair traps tiny air pockets; a pen mark shows where the probe goes. | 3-5 | RN: clips and cleans; IR: marks the probe spot [32, C] | L: holds the skin / R: marker | Flank clean; pen mark | - |
| 9 | Time Out: everyone agrees the plan | Pause before anything is fitted: side, tumour, trial rules. | 1 | All stop; IR states the side and target; Anaes the airway; RN reads [39, V] | RN holds the checklist | Asleep | UI plan screen |
| 10 | Bed-rail arm and water frame fitted at the back | The support arm holds the water frame steady against the flank. | 3-5 | Tech: clamps the support arm to the back-side rail, fits frame and membrane; RN: oil film on the skin; IR: sets the height [4, V] | L: frame / R: clamp | Skin dry with an oil film | Frame open; hoses on |
| 11 | Water coupling filled; air chased out | Degassed water carries the sound; air would block it. | 5-10 | Tech: opens the water line; IR: chases air with the bulb and checks with the mirror; CS watches the level [4, V] | L: frame rim / R: bulb | Water pillow on the flank | Fluidics pump runs; level rises |
| 12 | Treatment head lowered into the water | The head must sit under the surface with no air on its face. | 4-8 | IR guides the arm by hand, levels and lowers the head; RN or CS locks the wheels; CS watches the resistance bar [4, V] | L: freedrive / R: space mouse | Unchanged | Arm folded to submerged; resistance bar green; wheels locked |
| 13 | Kidney found between the ribs; breathing tuned | The beam must reach the kidney between the ribs and above the hip bone. | 5-10 | IR: turns and slides the probe; Son: depth and gain; Anaes: tunes tidal volume and PEEP (U: jet or one-lung options) [13, V][11, V] | IR: L freedrive / R space mouse | Asleep | US: kidney as a bean-shaped fan view, tumour at the lower pole, ribs as dark shadows; UI localise |
| 14 | Breath-hold sweep joins the scan to the picture | A short sweep lines the live picture up with the earlier scan (optional). | 4-8 | IR starts; Anaes pauses breathing; CS guides [4, V][32, C] | IR: R trackpad | Breathing paused for seconds | UI: fused CT beside live view |
| 15 | Kidney tumour outlined on the live picture | The doctor draws the target on two planes. | 3-6 | IR: contour; CS prompts [32, C] | L: knob / R: trackpad | Asleep | UI: axial, sagittal, 3D model; yellow contour ring |
| 16 | Safety margin added; plan checked and accepted | The margin makes sure none is missed; the check keeps the cloud off the kidney's central structures. | 4-7 | IR: margin; CS: survey (head walks the plan, no firing); IR marks the muscle layer; the volume stays within 40 mm [4, V] | L: knob / R: trackpad | Asleep | UI: dashed margin, seven survey points; trial rules exclude tumours that overlap the renal pelvis, main vessels or ureter [14, V] |
| 17 | First test pulses make a small bright cloud | Short test pulses prove the cloud forms exactly where the cross-hair says. | 3-6 | IR: voltage enable and knob; CS; RN calls "clear" [32, C] | L: enable / R: voltage knob | Asleep | US: bright spot; UI: cavitation chip |
| 18 | More test points; settings stored | Power is checked across the volume. | 3-5 | Same | Same | Asleep | US: flashes at each point |
| 19 | Automated treatment starts at the deepest point | The sweep begins deepest and works toward the skin. | 3-5 | IR: start, hand near stop [32, C] | L: stop / R: start | Asleep | UI: time estimate shown |
| 20 | First half: cloud sweeps through the volume | Each spot needs only a few seconds, then the arm moves on. | 20-35 | IR + CS watch UI and US; Anaes keeps breathing steady; Son keeps image; RN charts [4, V] | Hands off the controls | Still | Arm makes small moves; US: cloud steps and the picture darkens behind it; UI: sphere half full; cooling pauses [4, V] |
| 21 | Halfway check: the dark zone is growing | A pause to see that the cloud is still on target as the kidney moves with breathing. | 2-4 | IR + Anaes + CS: look at US; Anaes adjusts breathing if the target drifts [11, V] | Hands off | Asleep | US: dark zone at the deep half; UI: half-full sphere |
| 22 | Second half: cloud finishes the volume | The sweep moves up through the shallow half. | 15-30 | Same as step 20 | Hands off | Still | US: dark zone fills the margin ring; UI: sphere full |
| 23 | Gaps checked and touched up | A last look makes sure the whole planned volume has gone dark. | 3-6 | IR: reviews; adds points if needed; CS notes [32, C] | L: knob / R: trackpad | Asleep | US: coverage near complete |
| 24 | Treatment ends; head lifted out | Voltage is switched off before anything moves. | 2-4 | IR: voltage off, lifts the head, parks the arm; CS ends the session [32, C] | L: freedrive / R: space mouse | Asleep | Arm folded |
| 25 | Water drained; frame and membrane removed | The patient must be dry and free of the frame before turning. | 4-7 | Tech: drains; RN: lifts off the membrane and frame; IR: releases the support arm | Both on the frame | Oil film wiped off | Membrane in a bin |
| 26 | Skin wiped and checked; ultrasound look at the area | The skin is checked and a quick look confirms the treated zone. | 2-4 | IR + RN [35, C] | L: drape / R: gauze | Skin checked | - |
| 27 | Sign Out: what was treated; recovery plan | WHO check: what was done, equipment, urine, scans and thinners. | 1-2 | IR + Anaes + RN + Tech + CS; RN reads [39, V] | RN holds the checklist | Asleep | UI end screen |
| 28 | Turned onto the back; wakes; tube out | The patient is turned back and brought round before moving. | 8-15 | Four people turn together; Anaes brings the patient round and removes the tube [13, V] | All hands on the sheet; then L: mask / R: tube | Awake, breathing, oxygen | - |
| 29 | Wheels out to recovery | A handover to the recovery nurse keeps care continuous. | 3-5 | Porter + RN: push; Anaes + ODP at the head | - | On the stretcher | - |
| 30 | Recovery: watched, urine checked, scan booked | Staff watch for pain and for pink urine, and a scan is planned. | 60-240 | Recovery nurse: signs, pain, urine; CT at 36 hours, then 30, 90, 180 days and 1 year (published case) [13, V] | - | Awake, comfortable; mild flank soreness | CT view later (not shown in the room) |
| 31 | Leaves recovery: ward bed or home | The published case went home the next day. | 20-60 | Recovery nurse + porter [13, V] | - | Walking or on a bed | - |

**Watch compression (seconds per step).** 1: 18, 2: 14, 3: 12, 4: 20, 5: 18, 6: 26, 7: 44, 8: 20, 9: 16, 10: 24, 11: 38, 12: 34, 13: 32, 14: 24, 15: 30, 16: 34, 17: 36, 18: 22, 19: 30, 20: 70, 21: 24, 22: 50, 23: 24, 24: 20, 25: 26, 26: 20, 27: 18, 28: 36, 29: 14, 30: 24, 31: 16. **Total 834 s.** The four-person turn (7), the water (11) and the sweep (20, 22) are the long visible steps.

**Details that make it realistic (kidney).**
- **Status:** US pivotal trial #HOPE4KIDNEY, 67 patients at 15 US sites, enrolment ended 2025; results not published; FDA decision pending [14, 18, V]. Pivotal rules: one mass of 3 cm or less, biopsy at least 14 days before, kidney filter value (eGFR) at least 45, no blood thinners, a good ultrasound window, not touching the renal pelvis, main vessels or ureter, not a solitary kidney, no hereditary kidney cancer [14, V].
- **The published UK case:** an 80-year-old woman, right lower pole, 2.81 cm, side position with the table flexed; the anaesthetist tuned tidal volume and PEEP to limit motion; treatment took 83 minutes; zone 4.27 cm at 36 hours; visible blood in the urine on day 1 and abdominal pain and vomiting on day 2 (all grade 1); discharged next day; CT at 36 hours, 30, 90, 180 days and 1 year, with the zone shrinking 3.28, 2.82, 2.47, 2.0 cm and no tumour seen [13, V].
- **Head depth:** the 12 cm or 14 cm head is chosen from the planning ultrasound; a kidney is often deeper than a liver tumour [4, V][U].
- **Breathing:** the kidney moves with breathing too; one-lung ventilation and jet ventilation are liver-series practices that may carry over (U) [11, 12, V].
- **Check at the end (U):** the urine is looked at in recovery.
- **Do not show:** any pink urine or flank colour change on the avatar; the caption says "urine checked".

## 6. The team and where they stand

Phases follow 7.5. Positions are patient-relative (liver; for the kidney the cart side is the back). Time stays inside one room, because no radiation is used (U).

| Phase | IR (or HPB surgeon) | Anaes | ODP | Son | RN | Tech | CS |
|---|---|---|---|---|---|---|---|
| **in, induction** (1-6) | at the cart reading the plan | at the head; leads the induction | at the head, patient's right; hands equipment | at the ultrasound cart | patient's left; checklist | back table | behind the IR at the cart |
| **positioning** (7-9; kidney 7-9) | patient's right: pads and marks | at the head holding the tube; on a turn, calls it | at the head; holds the drip | at the ultrasound cart | patient's left: cleans, clips, reads the Time Out | back table; helps the turn | at the cart |
| **coupling** (10-12) | patient's right at the abdomen: arm, bulb, mirror | at the head; watches monitor | at the head | at the ultrasound cart; sets up the image | patient's left: oil film; wheel lock | patient's right, foot side, at the fluidics cart: frame and water | at the UI beside the IR |
| **planning and test** (13-18) | patient's right between the cart and table, facing the UI; hands on the knobs | at the head; tunes breathing on the IR's calls | at the head | at the ultrasound cart, screen turned to the IR | patient's left; charts | at the fluidics cart | behind the IR; calls the UI steps |
| **treat** (19-22; kidney 19-24) | at the UI; hand near the voltage knob and stop | at the head; steady breathing | at the head | at the ultrasound cart | patient's left | at the fluidics cart | beside the IR |
| **finish and wake** (23-27) | patient's right; lifts head | at the head; wakes the patient | suction; holds mask | packs up | patient's left; reads the Sign Out | removes membrane | ends session |
| **recovery** | - | handover | pushes with the Anaes | - | pushes | - | stows the arm |

Notes: the **operator** is an interventional radiologist at many sites (Cambridge [23, V]; the MSK and UVA guides name the IR doctor [36, 37, V]) and a surgeon at others (the Cleveland Clinic guide comes from its general surgery department [10, V]; the Wellington is led by an HPB surgeon [26, V]) (varies). The **company clinical specialist** supports launches, live cases and workflow; this is from company job postings and is not a clinical role [43, C]. A **sonographer** does the planning ultrasound before the day [10, V]; whether one stands at the ultrasound cart in the room is not described anywhere I found (varies; the IR can do it, U).

## 7. Notes for the simulation

### 7.1 New roles, room and spots (proposals for the orchestrator)

- **Room:** `atHisto` in the planned east annex, x 40..50, z 2..12 (10 x 10 m), door from the hall at (45, 2) [44, V]. Recovery in `atPrep` (50..60, 2..12; three bays) [44, V].
- **Layout:** table long axis east-west, centre (45.0, 7.0), **head west** (so the patient's right is south, the cart side; the patient's left is north, the door side) (sim).

| Spot (proposed id) | x, z | Notes |
|---|---|---|
| `histo.table` | 45.0, 7.0 | 2.1 x 0.55 m, 0.9 m high, head west; flexes for the kidney |
| `histo.anaesHead` | 43.0, 7.0 | machine and monitor; stool 43.2, 6.4 |
| `histo.cart` | 45.4, 8.7 | arm base 1.3 m from the table edge; screen toward the IR |
| `histo.ir` | 44.7, 7.9 | between cart and table, facing north |
| `histo.cs` | 44.3, 9.2 | behind the IR |
| `histo.us` | 46.7, 8.9 | ultrasound cart, screen turned to the IR; `histo.son` at 46.3, 8.3 |
| `histo.fluidics` | 43.9, 9.4 | hoses to the frame; `histo.tech` at 44.0, 8.6 |
| `histo.rn` | 45.0, 5.8 | patient's left |
| `histo.backTable` | 46.9, 4.4 | north-east corner |
| `histo.stretcher` | 48.4, 5.0 | stretcher park |

- **New staff roles:** anaesthetic practitioner (ODP), company clinical specialist (CS), and a recovery nurse; the IR can reuse the cryo `ir` role and the sonographer the ProSense `sonographer` role; the circulating nurse and scrub reuse `circulator` and `scrub` [44, V].
- **New props:** treatment cart with six-joint arm, treatment head, support arm, water frame with a membrane (two states: empty, filled), fluidics cart, ultrasound cart, bubble bulb, inspection mirror, space mouse, two knobs, oil bottle.
- **New patient states:** side-lying (see 7.6), a "water pillow on skin" prop, pen mark (`marks: 'marked'`), skin shine (oil).

### 7.2 Room size

A real procedure room for Edison is an operating theatre or IR suite. The planned **10 x 10 m is ample**. The minimum the cast needs is **about 7 x 7 m** (table, three carts, anaesthesia machine, back table, 1.2 m clear round the table, a stretcher park). It is safe to keep the planned size so the camera has room to orbit the table. No lead lining and no control room are needed, because there is no radiation (U). A control corner is not needed; the cart is the console.

### 7.3 What to film up close

1. **Water filled and air chased out (11)**: the clear pillow, the bulb tool, the mirror. The best "this is not like other machines" shot.
2. **The arm lowering the head into the water (12)**: slow, hand on the freedrive buttons, the resistance bar green.
3. **The survey (16)**: the arm walks the head round the plan without firing.
4. **The first bright cloud on the ultrasound (17)**: a white spot under a cross-hair.
5. **The sweep (20, 22)**: the arm's tiny moves, the dark zone growing, the sphere filling on the UI.
6. **The four-person turn (kidney 7)** and the **tube (6)**.
7. **Anaesthetist and radiologist tuning breathing (13)**: the picture steadies.
8. **A wide shot at step 20**: nobody touching anything; the whole room watching two screens.

### 7.4 Visual details for a realistic but clean look

- **Water coupling:** a clear, slightly blue soft pillow about 0.35 m across, sealed to the skin at the rim with a thin oil sheen; the head's white housing and dark bowl visible through the water; no air under it after step 11, a few small bubbles at step 11 that the bulb pushes to the rim; a gentle ripple only while the arm moves; deflated and limp at step 23.
- **Arm:** matte white and grey, six visible joint rings, a force-sensor ring at the wrist, two or three buttons on the handle, a cable bundle. **No vendor logo and no vendor colours** (`licence.logo: 'none'` rule, `new-devices.md` section 8).
- **Head:** white shell, dark bowl, the probe tip at its centre; the 12 and 14 cm heads differ in bowl depth.
- **Cart:** tall, narrow, large touch screen on a jointed arm, two knobs (contour size, voltage), a stop button, brake pedals.
- **Fluidics cart:** clear reservoir with a water level, two hoses, a pump hum.
- **Screens:** UI in a dark theme with three panes (axial, sagittal, 3D model); yellow contour ring, dashed margin ring, seven dots for survey points, a sphere that fills point by point, a chip "cavitation detected". US: grey fan with speckle; the cloud as a bright spot; treated tissue darker. Every screen carries a `SIMULATED DEMO` chip (`new-devices.md` section 3).
- **Patient:** draped to a window over the right upper abdomen or the flank (towels, not a full sterile field: U); a pen mark; **no incision, no wound, no blood**; the tissue "liquid" is never drawn, only the dark zone on the ultrasound.
- **Sound (optional):** a faint crackle while the cloud runs [2, C]; keep it low.

### 7.5 Step phases for the sim (proposed units for a new `histotripsy` machine)

| Unit | (a) liver | (b) kidney |
|---|---|---|
| `in` | 1-2 | 1-2 |
| `induction` | 3-6 | 3-6 |
| `positioning` | 7-9 | 7-9 |
| `coupling` | 10-12 | 10-12 |
| `planning` | 13-16 | 13-16 |
| `test` | 17-18 | 17-18 |
| `treat` | 19-21 | 19-23 |
| `finish` | 22-24 | 24-26 |
| `emergence` | 25-26 | 27-28 |
| `out` | 27-30 (28-29 in `atPrep`; 30 is cleanup) | 29-31 |

Events for the feed (3-6 per script): Sign In, Time Out, "the first test cloud formed where planned", "the planned volume is treated", Sign Out.

### 7.6 Which existing pieces can be reused, and what is new

| Existing piece | Reuse | New work (change requests) |
|---|---|---|
| **R5 procedure engine** (`src/sim/procedure`, `src/content/procedures.ts`: scripts of units and steps; `roles` with `do`, `at`, `look`, `work`, hands; `patient` pose; `focus`; `event`; `checklist`; `repeat`) | the whole format and the zod loader; `repeat` could play a second volume for a larger tumour | `ProcMachine` += `'histotripsy'`; `ProcedureId` += `histo-liver`, `histo-kidney`; the unit list in 7.5; `UNITS` and `OPTIONAL_UNITS` rows |
| `PatientPosition`, `PatientPoseView` | `supine`, `obliqueLeftUp` (a left kidney), `marks: 'marked'`, `airway: 'tube'`, `prep`, `drape` | a flank-up position for a right kidney (or a roll value on the existing pose); a flexed-table state; a "wedge" |
| `ProcRole` | `ir`, `anaesthetist`, `circulator`, `scrub`, `sonographer` | `odp`, `clinicalSpecialist`, `recoveryNurse` |
| `ProcAction` | `positionPatient`, `transferPatient`, `intubate`, `injectIv`, `checklist`, `holdBreath`, `scanProbe`, `talkPatient`, `chart` | `fillCoupling`, `guideArm`, `operateConsole`, `drainCoupling` |
| `ToolKind` | `usTransducer`, `tablet`, `mouse`, `dressing`, `gauze`, `marker` | `couplingMembrane`, `bubbleBulb`, `inspectionMirror`, `spaceMouse` |
| `ProcAnchor`, `ProcTarget`, `FocusId` | `anaesHead`, `anaesStool`, `circulator`, `scrubBackTable`, `abdomen`, `anaesMonitor`, `usScreen`, `room`, `head`, `stretcher` | `histoCart`, `histoIr`, `histoUs`, `histoFluidics`, `histoCs`; targets `membrane`, `treatmentHead`, `uiScreen`; focus `coupling`, `histoScreens`, `treatmentHead` |
| **Ultrasound painters** (`src/scene/imaging/images/usPaint.ts`, `ultrasound.ts`, `screen.ts`): sector fan, speckle tile, `US_VIEWS` `liver`, `kidneyR`, `kidneyL`, a cryo overlay (bright line and ice ball with shadow), a readout writer that does not allocate | the fan, speckle, views and the allocation-free readout pattern | a **histotripsy overlay**: a bright spot (the cloud), a growing dark zone (no shadow behind it), contour and margin rings, a progress readout; `ScanStep` or a new overlay mode |
| `LiveScreen` and canvas rules | redraw only on change; at most 2 Hz (4 Hz when the imaging screen is focused, `CLAUDE.md`) | a UI-screen painter (three panes, a progress sphere) at 2 Hz |
| Teaching console seat (`console:...` in the interact registry) | a first-person seat at the cart | `console:histo:ir` |
| `new-devices.md` "device engine" (`DeviceRun`) | superseded for scripted treatments by the R5 engine | none |
| Crowd poses and pushing carts (`cleaningCart`, `linenCart` vehicles) | stretcher and cart pushing | a `histoCart` parked prop (the arm is animated by the rig, not driven) |

### 7.7 Quest 3 cost notes

Budget target in `new-devices.md`: histotripsy room about 40 k triangles, 10 draw calls, about 4 MB of texture, two canvases [44, V]. A leaner plan:

| Item | Triangles | Draw calls | Texture |
|---|---|---|---|
| Treatment cart and arm (arm as three merged groups: base-and-shoulder, upper arm, forearm-and-wrist) | 10-12 k | 3-4 | one shared 1k atlas |
| Treatment head | 3 k | 1 | in the atlas |
| Support arm, frame and membrane (membrane as a static soft dome with two states) | 4 k | 2 | small |
| Fluidics cart | 3 k | 1 | atlas |
| Ultrasound cart | 5 k | 1 | atlas |
| Props (bulb, mirror, hoses, oil) | 2 k | 1 | atlas |
| Reused theatre table, anaesthesia machine, monitor, back table | already in budget | already | already |
| Two live canvases (US 512 x 512, UI 512 x 512) | - | 2 | about 2 MB |
| **Total new** | **about 27-30 k** | **about 11-12** | **about 4 MB** |

Rules: one small see-through object only (the membrane): draw the water as an opaque tinted interior with a thin alpha rim, no refraction; instance the stretcher and carts; blob shadows for live objects; no per-frame allocation in the rig; arm joints from pure pose maths; bake the room's light (`CLAUDE.md`). Gate the room's visibility so it renders only while the camera is in the annex or the atrium's east half.

## 8. Where sources disagree, and where they are thin

**Disagreements.**
1. **Local control at 12 months:** 63.4% (primary read) against 90% (post hoc) [8, V]; the company and the CE-mark coverage use 90% [20, C].
2. **Counts:** the 30-day paper says 44 patients and 49 tumours [7, V]; the one-year paper says 47 patients and 52 tumours, with 14 sites [8, V]; the De Novo summary says 44 subjects and 40 evaluable [2, V]. Complications: 3 of 44 major (6.8%) [7, V] against 6 serious device-related events in 47 (12.8%) [8, 30, V] and "4 of 44" in the De Novo summary [2, V].
3. **Device generations in the literature:** the pivotal trial's cloud was 3 x 3 x 6 mm [7, V]; K233466 3 x 3 x 11 mm, 13 minutes for a 3 cm sphere [3, V]; K241902 4 x 4 x 8 mm, 10-12 minutes [4, V]. Treatment times in papers (34 plus or minus 25 minutes, 83 minutes in the kidney case) are from older versions.
4. **How long it takes:** "as little as 30 minutes" (Cambridge, press) [23, V]; "1-3 hours" (company) [35, C]; "2-3 hours" (UVA) [37, V]; 221 plus or minus 64 minutes (trial) [7, V]; 73 minutes median (Hong Kong) [11, V].
5. **Frequency and pulse:** 700 kHz, under 20 microseconds (Edison paper) [7, V]; 1 MHz in the prototype pig study [12, V]; "typically near 1 MHz" in the review [33, V].
6. **Bubble life:** the company says microseconds [35, C]; a review reports remnant clouds of 30-50 ms [33, V]. Both are true: the bubble life is microseconds, the remnant lasts longer.
7. **Kidney submission date:** 11 May 2026 (company, MedTech Dive) [19, V] against 13 May in `new-devices.md` and one search summary.
8. **GANNON size:** "up to 30" in the 2024 press [41, C] against 50 on the registry [15, V].
9. **Vessel and duct sparing:** animal and company evidence says they survive [40, C][35, C]; patient series report duct and vein events [7, 8, V].
10. **Muscle relaxant and ventilation:** the pivotal paper reports only general anaesthesia [7, V]; Hong Kong used a relaxant and one-lung ventilation [11, V]; jet ventilation is pig data [12, V].
11. **Patients treated:** "over 2,000" repeated since August 2025 [21, 23, C]; no 2026 count. The August 2025 count already lists UAE sites, yet SEHA Tawam's April 2026 release calls itself the first UAE provider [28, V]; unresolved.
12. **FDA record:** the decision summary is a scanned image; its content was read through a mirror, and the openFDA listing is "unvalidated" [2, 6, V].

**Thin or missing.**
- **Real dimensions:** cart, arm reach, head size, fluidics cart and room-layout photos were not found; section 2.2 is ours. No vendor installation guide was available.
- **Positions of staff** are not described in any source read (6 is my reading of patents and a hospital team list, tagged C/U).
- **Screens:** only a patent describes them; no screenshot of the shipping UI was read [32, C].
- **Sterile practice:** whether the arm is draped, how the skin is prepared and how the water is drained were not found.
- **Kidney:** no #HOPE4KIDNEY results are public; the only paper is one case [13, V].
- **Pancreas:** feasibility only; small series (Barcelona; two Hong Kong cases in a search excerpt) [15, V][41, C].
- **Immune effects:** mouse data and one case; no patient cohort [34, V][41, C].
- **Israel, NICE and UK private pricing:** nothing found [U].
- **Pivotal trial inclusion rules** (Appendix S1) and exact segment numbers were not read.
- **Mechanical details:** real pulse rate, peak pressure and the cooling table are not published [32, C].

## 9. Sources

"Read" means the text was read in full or in part (noted). "Excerpt" means only a search excerpt or summary was available. Titles are as published.

1. US FDA. *De Novo database record DEN220087, Edison System* (decision 6 Oct 2023; product code QGM; 21 CFR 878.4405). Read. https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/denovo.cfm?id=DEN220087 . For contrast, DEN230043 is an unrelated eye device: https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/denovo.cfm?id=DEN230043
2. US FDA. *Decision summary DEN220087* (scanned image, not machine-readable here): https://www.accessdata.fda.gov/cdrh_docs/reviews/DEN220087.pdf . Content read through the mirror https://fda.innolitics.com/device/DEN220087 (study numbers, risks, "bubble cloud visible on B-mode and audible"). Mirror, read.
3. US FDA. *510(k) K233466, Edison System* (13 Mar 2024). Read through https://fda.innolitics.com/device/K233466
4. US FDA. *510(k) summary K241902, Edison System* (30 Oct 2024). Device description, required workflow, treatment heads, probe, accessories, plan limits, power. Read in full (text layer). https://www.accessdata.fda.gov/cdrh_docs/pdf24/K241902.pdf
5. US FDA. *510(k) K252947, HistoSonics Planning Tool* (decision 29 May 2026; received 15 Sep 2025; code QTZ, 21 CFR 892.2050). Read: https://fda.innolitics.com/device/K252947
6. openFDA. *510(k) listing for applicant HistoSonics* (DEN220087, K233466, K241902, K252947) and for product code QGM. Unvalidated data. Read: https://api.fda.gov/device/510k.json?search=applicant:%22HistoSonics%22&limit=20 ; https://api.fda.gov/device/510k.json?search=product_code:QGM&limit=20
7. Mendiratta-Lala M, et al. The #HOPE4LIVER single-arm pivotal trial for histotripsy of primary and metastatic liver tumors. *Radiology* 2024;312(3):e233051. PMID 39225612. Read in full. https://pmc.ncbi.nlm.nih.gov/articles/PMC11427859/
8. Ziemlewicz TJ, et al. The #HOPE4LIVER single-arm pivotal trial for histotripsy of primary and metastatic liver tumors: 1-year update of clinical outcomes. *Ann Surg* 2025 (9 Apr). PMID 40201962. Abstract read: https://www.themednet.org/publications/the-hope4liver-single-arm-pivotal-trial-for-histotripsy-of-primary-and-metastatic-liver-tumors-1-year-update-of-clinical-outcomes
9. Vidal-Jove J, et al. First-in-man histotripsy of hepatic tumors: the THERESA trial, a feasibility study. *Int J Hyperthermia* 2022;39(1):1115-1123. Abstract excerpt only. https://doi.org/10.1080/02656736.2022.2112309
10. Uysal M, et al. Histotripsy of liver tumors: patient selection, ethical discussions, and how we do it. *Cancers (Basel)* 2025;17(7):1100. Read (the figures were not readable). https://pmc.ncbi.nlm.nih.gov/articles/PMC11987918/
11. Chu MHM, Hui CYT, Wong HMK. Airway management and one-lung ventilation strategies during hepatic histotripsy: a retrospective service evaluation from a single institution in Hong Kong. *Anaesthesia Reports* 2026;14(2):e70092. Read. https://pmc.ncbi.nlm.nih.gov/articles/PMC13385519/
12. Winterholler JE, et al. Hepatic histotripsy: jet ventilation decreases the effect of respiratory motion in a porcine liver model. *Cardiovasc Intervent Radiol* 2025;48(8):1164-1173. Read. https://pmc.ncbi.nlm.nih.gov/articles/PMC12325549/
13. Wah TM, et al. Early clinical histotripsy treatment of renal cell carcinoma. *Cardiovasc Intervent Radiol* 2025;48(6):883-885. Read. https://pmc.ncbi.nlm.nih.gov/articles/PMC12170758/
14. ClinicalTrials.gov. *#HOPE4KIDNEY, NCT05820087* (record updated 23 Jun 2026). Read through the API: https://clinicaltrials.gov/api/v2/studies/NCT05820087
15. ClinicalTrials.gov. *GANNON, NCT06282809* (updated 9 Jul 2026). Read: https://clinicaltrials.gov/api/v2/studies/NCT06282809
16. ClinicalTrials.gov. *BOOMBOX master study, NCT06486454* (updated 11 Sep 2026). Read: https://clinicaltrials.gov/api/v2/studies/NCT06486454
17. ClinicalTrials.gov. *#HOPE4LIVER EU/UK, NCT04573881* (title seen in search; US trial NCT04572633 named in [7]): https://clinicaltrials.gov/study/NCT04573881
18. Urology Times. *Edison Histotripsy System submitted to FDA for kidney tumor indication* (11 May 2026). Read: https://www.urologytimes.com/view/edison-histotripsy-system-submitted-to-fda-for-kidney-tumor-indication . Company release: https://www.businesswire.com/news/home/20260511268688/en/HistoSonics-Moves-to-Advance-Additional-Histotripsy-Applications-Announcing-FDA-Submission-for-Kidney-Tumors (blocked; headline only)
19. MedTech Dive. *HistoSonics seeks FDA de novo authorization in kidney cancer* (11 May 2026). Read: https://www.medtechdive.com/news/histosonics-seeks-fda-de-novo-authorization-in-kidney-cancer/819931/
20. Focused Ultrasound Foundation. *Histotripsy for liver tumors earns regulatory approval in Europe* (30 Jul 2026), on HistoSonics' CE-mark release of 13 Jul 2026. Read: https://www.fusfoundation.org/posts/histotripsy-for-liver-tumors-earns-regulatory-approval-in-europe/ ; release (blocked): https://www.businesswire.com/news/home/20260713505048/en/HistoSonics-Receives-CE-Mark-Unlocking-Access-Across-Europe-and-Accelerating-Global-Commercialization-of-the-Edison-Histotripsy-Platform
21. Focused Ultrasound Foundation. *HistoSonics acquired for $2.25 billion* (7 Aug 2025). Read: https://www.fusfoundation.org/posts/transformational-milestone-reached-in-evolution-of-focused-ultrasound-histosonics-acquired-for-2-25-billion/
22. HistoSonics. *Financing with participation from Yosemite* (22 Jun 2026; $3.75 billion). Read through a copy: https://www.lumiraventures.com/news/histosonics-announces-financing-with-participation-from-yosemite-among-other-strategic-investors/
23. Cambridge University Hospitals. *Addenbrooke's begins innovative liver cancer treatment for first NHS patients in Europe* (22 Oct 2025). Read: https://www.cuh.nhs.uk/news/addenbrookes-begins-innovative-liver-cancer-treatment-for-first-nhs-patients-in-europe/
24. Cambridge University Hospitals. *Histotripsy for liver cancer* (patient page: eligibility, referral, journey, follow-up, status). Read: https://www.cuh.nhs.uk/our-services/imaging-radiology/histotripsy-for-liver-cancer/
25. HistoSonics and the University of Cambridge. *Europe's first Edison system, Li Ka Shing Foundation gift* (10 Jun 2025; MHRA expedited access, April 2025). Read through a copy: https://finance.yahoo.com/news/histosonics-cambridge-university-unveil-europe-070000189.html
26. HCA Healthcare UK. *Pioneering histotripsy treatment for liver cancer at The Wellington Hospital* (17 Feb 2026). Read: https://www.hcahealthcare.co.uk/about-us/news-and-press-releases/hca-uk-introduces-pioneering-histotripsy-treatment-for-liver-cancer
27. HCA Healthcare UK. *Histotripsy cancer treatment* (patient page). Read: https://www.hcahealthcare.co.uk/services/departments/cancer-care/treatment-and-care/histotripsy
28. Abu Dhabi Media Office. *SEHA introduces histotripsy* (10 Apr 2026). Read: https://www.mediaoffice.abudhabi/en/health/with-support-from-department-of-health-abu-dhabi-seha-introduces-groundbreaking-histotripsy-technology-for-non-invasive-liver-tumour-treatment/
29. The Standard (Hong Kong). *Taipei hospital debuts non-invasive histotripsy* (12 May 2026). Read: https://www.thestandard.com.hk/news/article/331833/Taipei-hospital-debuts-non-invasive-histotripsy-cancer-treatment-after-Li-Ka-shings-inspiration
30. Singapore Agency for Care Effectiveness. *ACE brief HSB-M 03/2025: Edison Histotripsy System for non-invasive destruction of liver tumours* (May 2025). Read (text extracted from the PDF): https://isomer-user-content.by.gov.sg/68/88bc48d8-1683-4e03-a64b-b9d1004c494a/Edison%20Histotripsy%20System%20(HistoSonics)%20for%20non-invasive%20destruction%20of%20liver%20tumours.pdf
31. Focused Ultrasound Foundation. *Focused ultrasound liver tumor treatment receives CMS reimbursement* (11 Nov 2021). Read: https://www.fusfoundation.org/posts/focused-ultrasound-liver-tumor-treatment-receives-cms-reimbursement/
32. HistoSonics. *Histotripsy systems and associated methods including user interfaces and workflows for treatment planning and therapy.* US patent 12,446,905 B2 (embodiments, not the shipping product). Read the first 200,000 of 479,000 characters: https://patents.google.com/patent/US12446905B2/en
33. Bader KB, Vlaisavljevich E, Maxwell AD. For whom the bubble grows: physical principles of bubble nucleation and dynamics in histotripsy ultrasound therapy. *Ultrasound Med Biol* 2019;45(5):1056-1080. Read the first 100,000 of 264,000 characters: https://pmc.ncbi.nlm.nih.gov/articles/PMC6524960
34. Pepple AL, et al. Spatiotemporal local and abscopal cell death and immune responses to histotripsy focused ultrasound tumor ablation. *Front Immunol* 2023. Read (most): https://pmc.ncbi.nlm.nih.gov/articles/PMC9900174
35. HistoSonics (company). Technology, science, patient procedure and FAQ pages: https://histosonics.com/our-technology/ ; https://histosonics.com/the-science/ ; https://myhistotripsy.com/histotripsy-procedure/ ; https://myhistotripsy.com/resources/faq/ . Read; company claims.
36. Memorial Sloan Kettering. *About your histotripsy procedure* (patient education). Read: https://www.mskcc.org/cancer-care/patient-education/about-your-histotripsy-procedure
37. UVA Radiology. *Histotripsy for liver tumors: what to expect.* Read: https://blog.radiology.virginia.edu/histotripsy-for-liver-tumors-what-to-expect/
38. ECU Health. *First procedure with the Edison histotripsy system* (14 May 2026; procedure 21 Apr 2026). Read: https://www.ecuhealth.org/ecu-health-medical-center-performs-its-first-procedure-with-edison-histotripsy-system/
39. WHO. *Surgical safety checklist* implementation manual (publication page): https://www.who.int/publications/i/item/9789241598590 ; NHS (Salisbury), *WHO Surgical Safety Checklist v7*: https://mg.salisbury.nhs.uk/media/3068/who-surgical-safety-checklist-version-7-may-2022a.pdf (as read for `procedures.md`, sources 3 and 4).
40. Excerpt only: vessel and bile-duct sparing, collagen and strength (Radiology: Imaging Cancer 2024 review, https://pubs.rsna.org/doi/10.1148/rycan.240403 ; blocked, search excerpt); porcine liver work of Smolock et al. 2018 (not opened).
41. Excerpt only (search summaries or blocked pages): CAIN kidney feasibility, Leeds (https://interventionalnews.com/first-in-human-cain-trial-demonstrates-feasibility-of-histotripsy-for-small-renal-tumours/); WOLVERINE BPH first patients, 30 Mar 2026 (https://www.businesswire.com/news/home/20260330349844/en/); first commercial patients, Dec 2023 (https://histosonics.com/worlds-first-patients-treated-with-novel-edison-histotripsy-system/); GANNON first patients, Dec 2024 (https://www.businesswire.com/news/home/20241216604376/en/); Hong Kong pancreas cases; immune trials NCT07766187 (https://clinicaltrials.gov/study/NCT07766187) and NCT07853690; Michigan abscopal summary (https://histotripsy.umich.edu/cancer); Radiology 2026 review (https://pubs.rsna.org/doi/abs/10.1148/radiol.254050).
42. Excerpt only: Hong Kong prices (https://www.hksh.com/histotripsy/en/ ; https://www.cuhkmc.hk/hospital-service/specialty-services/specialist-outpatient-centre/histotripsy); "five feet tall" (Fast Company, https://www.fastcompany.com/91270925/histosonics-most-innovative-companies-2025 , blocked); Central and Eastern European distributor (https://inwestycje.pl/biznes/system-edison-ktorego-dystrybutorem-jest-synektik-uzyskal-dopuszczenie-na-rynek-ue/); kidney billing codes; NIHR cost study; the Cambridge University summary naming the charity funding (https://www.cam.ac.uk/news/addenbrookes-begins-innovative-liver-cancer-treatment-for-first-patients-in-europe); the De Novo "no sterilisation requirements" line (search excerpt of the FDA summary, [2]).
43. HistoSonics job posting, *Clinical Specialist* (role description; company): https://www.builtinboston.com/job/clinical-specialist-nyc-ct/10839301 . Excerpt only.
44. This repository: `docs/research/procedures.md`, `docs/research/new-devices.md`, `docs/research/cryoablation.md`, `src/content/procedures/or-cholecystectomy.json`, `src/content/procedures.ts`, `src/sim/types.ts` (R5 types), `src/sim/places.ts` (`l2Or`, `CRYO_SUITE`), `src/scene/imaging/images/usPaint.ts`, `ultrasound.ts`, `CLAUDE.md`. Read.
