# Eight procedures, step by step: the factual basis for the staff-character scenes

Research date: 2026-10-30. Written for the "Watch step by step" scenes: staff characters perform each procedure in 3D, with the right
instruments, positions and timing, compressed to 10-15 minutes with one caption per step. Synthetic patients only; educational; the
simulation makes no clinical decisions. Companion to `docs/R2-SURGERY.md`, `docs/R3-ENDOSCOPE.md`, `docs/R4-CRYO-SUITE.md` and
`docs/research/cryoablation.md`.

## 0. How to read this document

**Status of the evidence.** Every claim cluster carries a source number, written `[n]`, that points to the Sources list at the end.
Three marks are used:
- **varies:** centres or surgeons differ; the range is given.
- **CP:** common practice that is not stated in any source read for this document. It is usable for the scene but is not cited.
- **sim:** a choice already made in the sim (`src/sim/config.ts`, `docs/R2`, `docs/R4`). `[40]` is the group of repo documents.

**Not every source was read in full.** Sources behind a bot check (some journal sites) were read through the open full-text mirror at
Europe PMC; where only an abstract or search excerpt was available, the entry in Sources says so.

**Abbreviations in the step tables.**

| Code | Role | Sim person |
|---|---|---|
| Surg | surgeon (at the console after docking) | `or-surgeon` |
| BA | bedside assistant | `or-assistant` |
| Scrub | scrub nurse | `or-scrub` |
| Circ | circulating nurse | `or-circ` |
| Anaes | anaesthetist | `or-anaes` |
| IR | interventional radiologist (performs the cryoablation) | `cryo-ir` |
| Rad | CT radiographer | `cryo-rad` |
| SN | sedation nurse | `cryo-nurse` |
| BR | breast radiologist (performs the ProSense treatment) | new (see section 14.3) |
| Son | sonographer or assistant | new (see section 14.3) |
| Porter | theatre or ward porter | `or-porter`, `cryo-porter` |

**Where people stand.** All positions are relative to the patient, not the room: at the head, patient's right, patient's left, at the
foot (or between the legs), at the console, in the control room (CR). In the sim's theatre the table's head is north, so the patient's
left is east: the bedside assistant and scrub nurse stand east of the table, the cart docks from the west (patient's right) and the
surgeon's console is east, toward the foot `[40]`.

**Step-table columns.** `#` | step (caption, 60 characters or fewer) | why (one line, 160 or fewer) | real minutes (a range; the
duration of that step in a real case) | who does what and where | hands (left / right) | patient state change | robot arms or imaging
(what each instrument arm holds and what the endoscope or screen shows).

**Robot arm numbering.** The sim puts the endoscope on Arm 2 and the three instruments on Arms 1, 3 and 4 `[40]`. On a real da Vinci Xi
the scope can be on any of the four arms `[1]`; so the arm numbers here are the sim's, and the instrument assignments are typical
rather than fixed (varies).

**Style of the captions.** UK English; no graphic words in the caption or "why" columns; "Time Out", "Sign In" and "Sign Out" are the
WHO checklist pauses and are capitalised as in the checklist.

## 1. The three WHO pauses, where they occur in every procedure

The WHO Surgical Safety Checklist has three pauses, each read aloud by the whole team `[3][4]`:

| Pause | When | Main items (WHO checklist; summarised from the NHS version 7 sheet and a patient-facing summary) |
|---|---|---|
| **Sign In** | before anaesthesia or sedation starts | patient confirms name, date of birth, procedure and consent; site marked and matching the consent form; allergy check; airway and aspiration risk; fasting; risk of major blood loss and group-and-save sample; essential imaging displayed `[3][4]` |
| **Time Out** | before the first skin cut (or the first needle, nick or skin puncture) | team introduces itself by name and role; patient, procedure and site read back; antibiotics and other pre-procedure medicines confirmed given; surgeon, anaesthetist and nurse each name expected problems; equipment and implants confirmed available and sterile `[3][4][41]` |
| **Sign Out** | before the patient leaves the room | procedure performed is named; instrument, swab and sharps counts correct; specimens labelled; equipment problems noted; recovery handover, including positioning and pressure areas `[3][4][41]` |

- In theatre the Sign In is done with the patient awake, by the anaesthetist and a nurse or anaesthetic practitioner; the surgeon joins if present `[4]`.
- The original WHO checklist PDF could not be fetched (access refused); the item lists above come from the NHS adaptation `[4]` and a patient-facing summary `[41]`, with the three-pause structure confirmed on the WHO publication page `[3]`.
- The cryoablation suite and the breast room use the same three pauses in adapted form (varies by centre; the radiology adaptations
  were not read for this document, CP).
- The counts happen again at the end of the case; a first count is often made before the deep layer is closed (varies).

## 2. Robot facts shared by procedures 1-3 (da Vinci Xi-style cart)

- **Which robot:** the sim's machine is a da Vinci 5 with an Xi-style four-arm cart `[40]`. Every published workflow read here describes the Xi, X or Si; the da Vinci 5's own guided set-up screens were not researched, so the docking sequence below is the Xi one (varies, CP for the da Vinci 5).
- **Before the patient arrives:** the four arms are draped, about 5-6 minutes `[40]`.
- **Set-up sequence on the Xi** `[1][2]`:
  1. "Deploy for docking": the boom raises and the arms fold up.
  2. Select the anatomy and the side the cart will come from.
  3. Drive the cart toward the table by the laser cross-hairs, until the boom is over the endoscope port. In the sim: within 5 cm `[40]`.
  4. Dock the endoscope arm, then put the scope in so that the target anatomy is in view.
  5. Hold the targeting button: the boom turns and the other arms swing onto their ports.
  6. Dock the remaining arms and make manual arm adjustments.
- **Time:** docking takes 5-8 minutes (7.8 in the first 65 cases of one Xi series, about 5-7 after the learning curve) `[40]`.
- **The patient cannot be moved once docked.** Table tilt, leg position and the tube are fixed before docking; if resuscitation is
  needed the robot is detached first `[14]`. (The Xi "Table Motion" feature can move a compatible table while docked `[1]`; it is not used in the scenes.)
- **Port spacing:** 6-10 cm between robot ports (Intuitive Xi procedure guide) `[2]`; 8 cm in a gynaecology series `[12]`; at least
  7 cm between the assistant port and a robot port `[10]`. Robot cannulas are 8 mm; the assistant port is 5 or 12 mm (a 12 or 15 mm
  assistant port is shown in the Intuitive guide) `[2][14]`.
- **Instruments seen in the sources:** fenestrated bipolar forceps, Maryland bipolar forceps, monopolar curved scissors, monopolar
  hook, ProGrasp or Cadiere forceps (the fourth arm), large needle drivers (SutureCut), Vessel Sealer Extend, Force Bipolar, staplers
  and Firefly fluorescence imaging `[1][6][12]`. Clips are usually Hem-o-lok clips handled by the bedside assistant `[6][14][15]`; a robotic clip applier exists on some set-ups (varies, CP).
- **Instrument exchanges:** the bedside assistant removes one instrument and the scrub nurse hands the next (6-12 times an hour in the sim `[40]`).
- **Console etiquette:** the surgeon's head is in the viewer, hands in the two controllers, feet on the pedals (energy, camera, clutch). The hands that matter are on the controllers, not at the table.

## 3. Procedure 1: robotic cholecystectomy (benign gallstone disease)

**Background.** Removal of the gallbladder for symptomatic gallstones. General anaesthesia with a breathing tube and muscle relaxation.
The patient lies on their back with arms out or tucked; before docking the table is tilted head-up (reverse Trendelenburg, 15-20° in
one series, up to about 30° in others) with a tilt that raises the right side `[7]` (varies; 15-30°). Gas pressure 12-15 mmHg `[7]`.
Published robotic times (skin to skin, docking and undocking included): 60 ± 15 minutes for three robot ports plus one assistant port `[6]`; 101
minutes (three ports) and 151 minutes (four ports), 121 overall `[8]`; a single-site series reports 99 minutes with 50 minutes at the
console `[7]`. **Room time, wheels in to wheels out, is therefore about 80-150 minutes, with 22-55 minutes at the console** (the sim
uses 60-90 and 15-30; see section 14.4). Day-case discharge is common but varies by country (mean 2.65 days in one single-centre series
`[6]`; the sim sends 90 % home `[40]`).

**Team.**
- **Surg:** places the ports from the patient's side, then sits at the console.
- **BA:** patient's left throughout; places the assistant port, passes clips, uses suction, brings in the bag `[7]`.
- **Scrub:** patient's left, foot end, beside the back table; hands instruments, clips, bag, sutures.
- **Circ:** moves round the room; reads the checklist, runs the counts, fetches.
- **Anaes:** at the head; access to the face is limited once the cart is docked.

### Step table

| # | Step | Why | Min | Who does what, and where | Hands (left / right) | Patient state | Robot arms and scope view |
|---|---|---|---|---|---|---|---|
| 1 | Wheels in; team says hello | The team meets the patient and checks the room is ready. | 3-5 | Porter + Circ: push the stretcher in; Anaes: at head; Scrub: gowned at back table (patient's left, foot end); Surg: finishing the hand scrub in the hall | - | On the stretcher in gown, cap and ID band, drip in | Cart parked, arms already draped `[40]` |
| 2 | Move across to the operating table | A slide sheet moves the patient across without lifting. | 2-3 | Circ (patient's left) + Porter (patient's right): slide the sheet; Anaes: at head, holds head and drip | Both hands on the sheet | Flat on the back, head on a pillow | - |
| 3 | Monitors and drip connected | Heart trace, oxygen level and pressure are watched from here on. | 3-5 | Anaes: at head; Circ: patient's left, fits the return pad for the diathermy | L: BP cuff on arm / R: ECG leads (Anaes) | Heart trace, finger probe and BP cuff on; drip checked | - |
| 4 | Sign In: name, operation, allergies | WHO check before any medicine: right patient, right operation, allergies known. | 1-2 | Anaes + Circ at head; Surg joins if present; patient answers aloud `[3][4]` | Circ holds the checklist | Awake; confirms name, birth date, consent, site mark, fasting | - |
| 5 | Anaesthetic given; patient falls asleep | Sleep medicine and a muscle relaxant let the gas lift the belly wall later. | 3-5 | Anaes: at head, oxygen mask and drip medicines; Circ: stays at patient's left | L: holds mask / R: drip syringe | Oxygen by mask, then asleep and relaxed | - |
| 6 | Breathing tube placed; eyes protected | The tube lets the ventilator breathe for the patient while the abdomen holds gas. | 3-5 | Anaes: at head; Circ hands equipment | L: laryngoscope / R: breathing tube | Tube in and secured; eyes taped; warming blanket on; stomach tube optional | - |
| 7 | Arranged, padded and warmed | Padding and a strap keep the patient from slipping when the table tilts. | 3-6 | Circ (patient's left) + BA (patient's right): arms out on boards or tucked, foot board, thigh strap; Anaes: at head, checks the tube and gives the fluorescence dye into the drip (timing varies: at induction to 45 min before) `[7][9]` | Both hands fitting pads | Pressure points padded; strap over the thighs; dye given (2.5 mg is the usual dose) `[9]` | - |
| 8 | Skin cleaned; sterile drapes on | Clean skin and sterile drapes keep germs out of the port sites. | 4-6 | Surg + BA (patient's left, gowned): clean and drape; Scrub: foot end, passes drapes | L: holds drape / R: antiseptic sponge on forceps | Abdomen cleaned; drape with a window over the belly | - |
| 9 | Time Out: everyone agrees the plan | WHO check before the first small cut: names, roles, the operation, antibiotic given, what could go wrong. | 1 | All stop; Surg states the plan; Anaes and Scrub add theirs; Circ reads `[3][4]` | - | Asleep and draped; antibiotic confirmed | - |
| 10 | First port in; gas fills the abdomen | Gas lifts the belly wall off the organs so there is room to see. | 3-5 | Surg (patient's right): small cut at the navel, opens to the cavity (open "Hassan" entry or needle); BA (patient's left): connects the gas line | L: lifts the navel skin / R: first port | Gas to 12-15 mmHg `[7]`; scope in, all four areas of the abdomen looked over | Scope on a handheld camera only; nothing docked yet |
| 11 | Robot ports and assistant port placed | Each robot arm needs its own 8 mm port, spaced so the arms do not collide. | 4-8 | Surg (patient's right): 8 mm ports in a straight line across the belly, 6-10 cm apart `[2][8]`; BA (patient's left): 5 mm assistant port (12 mm if the large clip applier or bag needs it); Scrub passes ports; local anaesthetic at each port site | L: steadies the belly wall / R: pushes each port in under camera view | 3-4 robot ports plus 1 assistant port `[6][8]`; a three-port version lifts the fundus with a stitch `[8]` | Handheld scope view of the ports entering, from inside |
| 12 | Table tilts: head up, right side up | Tilting lets the bowel slide away from the gallbladder. | 1-2 | Circ: table remote; Anaes: at head, checks tube and monitors; Surg checks the view | Circ: table remote | Reverse Trendelenburg 15-30° and a left tilt (varies); fixed before docking `[7][14]` | - |
| 13 | Cart wheeled in with the laser guide | The laser cross-hairs show the driver where to stop. | 2-3 | BA (patient's right, at the cart handle): drives; Circ: spots the path; Scrub keeps the drapes clear | Both hands on the drive handle | Unchanged; area around the table kept clear | "Deploy for docking": boom up, arms folded; laser cross on the patient; stops about 5 cm from the scope port `[1][2][40]` |
| 14 | Camera arm docked; arms swing to ports | The camera goes first so the robot can aim at the target. | 3-5 | BA (patient's right): clicks the camera arm onto the camera port, holds the targeting button, then docks each arm; Scrub passes | L: steadies the port / R: arm release button | The patient can no longer be moved `[14]` | Boom turns; Arms 1, 3 and 4 swing onto their ports; scope on Arm 2 `[1][2]` |
| 15 | Instruments in; surgeon takes the console | The instruments go in while the camera is watched; then the surgeon sits down. | 1-2 | Scrub: passes instruments; BA (patient's left): inserts each through its cannula under camera view; Surg: leaves the table, sits at the console | Console: L / R controllers | - | Arm 1 fenestrated bipolar; Arm 3 monopolar hook; Arm 4 ProGrasp; view: liver edge with the gallbladder beneath `[6]` |
| 16 | Dye glow check of the bile ducts | A green glow outlines the ducts so none is mistaken for another. | 1-3 | Surg: at console, switches the scope to Firefly; Anaes: at head, watches the monitors | Controllers at rest | - | Firefly: ducts and gallbladder neck glow green on a dark picture; back to white light; used as an add-on, not alone `[1][9]` |
| 17 | Gallbladder lifted over the liver | Lifting shows the neck and the triangle where the duct and artery lie. | 1-2 | Surg: at console; BA (patient's left): suction and irrigation ready | L: Arm 4 grasper on the fundus / R: Arm 1 on the neck | - | Arm 4 holds the fundus up and to the right; view: liver underside, gallbladder, fat over the neck `[5][40]` |
| 18 | Calot's triangle cleared | Clearing the fat shows the duct and artery clearly before anything is cut. | 8-20 | Surg: at console; BA: suction and irrigation on request | L: Arm 1 fenestrated bipolar / R: Arm 3 hook | - | Arm 1 spreads and seals; Arm 3 hook cleans the tissue; Arm 4 keeps the fundus up; view: thin covering opened, duct and artery emerge `[5][6]` |
| 19 | Critical View of Safety confirmed | A pause to prove that two, and only two, structures enter the gallbladder before any clip. | 1-3 | Surg: at console, calls the pause; all stop; Circ and Anaes listen; pictures taken `[5]` | Same | - | View: triangle cleared of fat; lower third of the gallbladder lifted off the liver; two structures only; photos from front and back `[5]` |
| 20 | Clips placed on duct and artery | Clips seal the duct and artery before they are cut. | 2-4 | BA (patient's left): clip applier through the assistant port; Scrub: loads clips; Surg: holds the structure steady `[6][7]` | L: Arm 1 holds the duct / R: Arm 3 rests | - | Hem-o-lok clips by the BA (varies: a robotic clip applier on Arm 3); view: two clips on the patient side, one on the gallbladder side `[6][7]` |
| 21 | Duct and artery divided | Cutting between the clips frees the gallbladder neck. | 1-2 | Surg: at console; BA removes the hook and Scrub hands over the scissors (an instrument exchange) | R: Arm 3 now monopolar curved scissors | - | View: scissors divide the duct, then the artery, between the clips |
| 22 | Gallbladder freed from the liver | It is peeled off the liver surface with gentle heat. | 5-15 | Surg: at console; BA: suction | L: Arm 1 / R: Arm 3 hook | - | Arm 3 hook (swapped back); Arm 4 lifts; view: the pale layer between gallbladder and liver is swept with the hook, gallbladder comes free |
| 23 | Gallbladder placed in a bag | The bag keeps the gallbladder and any stones contained. | 1-2 | BA (patient's left): brings the bag in; Scrub passes it; Surg: guides from the console | L: Arm 1 / R: Arm 3 graspers | - | View: gallbladder slides into the bag; the string is pulled; bag parked by the liver `[6][7]` |
| 24 | Final check and rinse | One last look that the area is clean and tidy before leaving. | 2-4 | Surg: at console; BA: suction and irrigation; Circ: preparing the count | Controllers | Gas pressure lowered for a final look (varies, CP) | View: liver bed clean, clips in place, no fluid left |
| 25 | Arms released; cart wheeled away | The robot is moved out so the team can reach the patient. | 2-3 | Surg: leaves the console; BA + Scrub: detach each arm from its port, boom up; BA: drives the cart out | L: steadies the port / R: arm release | Tilt returned to flat (CP) | Arms retract; instruments withdrawn `[40]` |
| 26 | Gallbladder out; port sites closed | The bag leaves through the navel port site, and small stitches close the layers. | 6-12 | Surg (patient's left): draws the bag out, closes the deep layer with an absorbable stitch and the skin with a buried stitch `[7]`; BA: removes the ports under camera view and lets the gas out | L: forceps / R: needle holder | Port sites closed with stitches and glue; small dressings | - |
| 27 | Sign Out: counts and specimen label | WHO check before leaving: counts right, specimen labelled, recovery plan agreed. | 1-2 | Scrub + Circ: count instruments, swabs and sharps; Circ reads; Surg confirms the operation; Anaes `[3][4]` | - | Specimen labelled | - |
| 28 | Patient wakes; tube removed | The anaesthetist reverses the medicines and takes the tube out once breathing well. | 6-10 | Anaes: at head; Circ: patient's left | L: holds the mask / R: draws the tube out | Drapes off; tilt flat; awake and breathing | - |
| 29 | Wheels out to recovery | A handover to the recovery nurse keeps care continuous. | 3-5 | Porter + Circ: push; Anaes: at head with oxygen and monitor | - | On the stretcher with oxygen | - |

**Watch compression (seconds per step).** 1: 18, 2: 14, 3: 12, 4: 20, 5: 15, 6: 28, 7: 14, 8: 16, 9: 16, 10: 25, 11: 40, 12: 10, 13: 22, 14: 30, 15: 16, 16: 20, 17: 16, 18: 55, 19: 28, 20: 35, 21: 18, 22: 50, 23: 25, 24: 14, 25: 18, 26: 35, 27: 20, 28: 18, 29: 14. Total: 662 s. Ports (11), docking (13-14), clipping (20), the pause (19) and the tube (6) are the long visible steps; the dissection (18, 22) is passive for the scene and stays short.

**Details that make it realistic.**
- **Ports:** a typical Xi layout is 3-4 robot ports (8 mm) in a straight line across the lower abdomen and an assistant port; one series used three 8 mm ports (camera and two working arms) and a 5 mm assistant port about 6 cm lateral to the left-hand port `[6]`; another used three or four ports "arranged transversely and infra-umbilically" `[8]`. The Intuitive Xi guide gives 6-10 cm between ports `[2]` (varies by surgeon and body shape).
- **Gas pressure:** 12-15 mmHg `[7]`. The sim displays 12 mmHg `[40]`.
- **Docking:** laser cross-hairs, endoscope arm first, targeting, remaining arms `[1][2]` (section 2).
- **Critical View of Safety (SAGES):** (1) the hepatocystic triangle is cleared of fat and fibrous tissue; (2) the lower third of the gallbladder is separated from the liver to show the cystic plate; (3) two and only two structures are seen entering the gallbladder `[5]`. SAGES also suggests a brief "intra-operative pause" before any clip, imaging the bile ducts when unsure, and stopping before the zone of risk (a bail-out) `[5]`.
- **Firefly:** the dye (ICG) is given into the drip 30-45 minutes before the duct view (2.5 mg in most robotic series; some use 0.05 mg/kg at least 45 minutes before; a few give it at induction) `[7][9]`. Intuitive's labelling describes bile-duct imaging as an add-on to white light and, when indicated, to a duct X-ray, never alone `[1]`.
- **Specimen and closure:** gallbladder in a retrieval bag (5 mm bag in one series), out through the navel port site; deep layer closed with a continuous absorbable stitch and the skin with a buried stitch `[6][7]`.
- **Counts:** instrument, swab and sharps counts at the end (WHO Sign Out) `[3][4]`.
- **Table tilt before docking:** reverse Trendelenburg 15-20° then a 30° rotation of the table in one series `[7]`.

## 4. Procedure 2: robotic total hysterectomy (benign, e.g. fibroids)

**Background.** Removal of the uterus and cervix, leaving the ovaries unless there is a reason to remove them, for fibroids, heavy
periods or adenomyosis. General anaesthesia with a breathing tube and full muscle relaxation. The patient lies in the dorsal
lithotomy position (legs in padded stirrups, buttocks at the table edge, arms along the body with shoulder braces) `[10]`, then
the table goes steeply head-down: 25-30° for robotic work `[10]` (12-15° for conventional laparoscopy `[11]`). A bladder catheter and a uterine
manipulator (a rod with a cup that sits round the cervix) go in first `[10][11]`. Gas pressure 12-15 mmHg, lowered to 9 mmHg at the
end to check `[10]`. Published times: total 88 ± 33 minutes with 52 ± 23 at the console in a mixed benign robotic series (n = 106)
`[13]`; median skin-to-skin 125 minutes without and 148.5 with a manipulator `[12]`; conventional laparoscopic total hysterectomy
67 ± 18 minutes `[11]`. **Room time is about 105-195 minutes; console 46-96 minutes** (the table below adds up to this). The sim uses 120-180 and 75-110,
which sit in range `[40]`. Stay about two nights in one series (2.2) `[13]`; the sim sends half home the same day `[40]`.

**Team.**
- **Surg:** console after docking.
- **BA:** two jobs: between the patient's legs (at the foot) for the catheter, manipulator and, at the end, vaginal removal of the uterus; and at the patient's left for the 12 mm assistant port during console work (in a real list a second assistant often covers one of these).
- **Scrub:** patient's left, foot end, back table.
- **Circ:** round the room.
- **Anaes:** at the head; the head-down tilt makes face and eye checks important `[10]`.

### Step table

| # | Step | Why | Min | Who does what, and where | Hands (left / right) | Patient state | Robot arms and scope view |
|---|---|---|---|---|---|---|---|
| 1 | Wheels in; team says hello | The team meets the patient and checks the room is ready. | 3-5 | Porter + Circ: push the stretcher in; Anaes: at head; Scrub: gowned at back table; Surg: finishing the hand scrub | - | On the stretcher in gown, cap and ID band | Cart parked and draped `[40]` |
| 2 | Move across to the operating table | A slide sheet moves the patient across without lifting. | 2-3 | Circ (patient's left) + Porter (patient's right): slide sheet; Anaes: at head | Both hands on the sheet | Flat on the back | - |
| 3 | Monitors and drip connected | Heart trace, oxygen level and pressure are watched from here on. | 3-5 | Anaes: at head; Circ: patient's left, fits the return pad | L: BP cuff / R: ECG leads | Monitors and drip on | - |
| 4 | Sign In: name, operation, allergies | WHO check before any medicine: right patient, right operation, allergies known. | 1-2 | Anaes + Circ at head; Surg joins if present `[3][4]` | Circ holds the checklist | Awake; confirms the details | - |
| 5 | Anaesthetic given; patient falls asleep | Sleep medicine and a muscle relaxant allow the gas to lift the belly wall. | 3-5 | Anaes: at head; Circ: patient's left | L: holds mask / R: drip syringe | Asleep and relaxed `[14]` | - |
| 6 | Breathing tube placed; eyes protected | The tube lets the ventilator breathe for the patient through a long, head-down case. | 3-5 | Anaes: at head; Circ hands equipment | L: laryngoscope / R: tube | Tube secured; eyes taped; warming blanket | - |
| 7 | Legs into stirrups; arms tucked | Padded stirrups and braces keep the patient safe when the table tips head-down. | 5-8 | Circ (patient's left) + BA (patient's right): lift both legs together into padded stirrups, buttocks to the table edge, arms tucked along the body, shoulder braces `[10]`; Anaes: at head, checks the tube | Both hands under the legs | Dorsal lithotomy; arms tucked; shoulder braces on; pressure points padded | - |
| 8 | Skin and vagina cleaned; drapes on | Clean skin and sterile drapes keep germs out. | 4-6 | BA (at the foot) and Surg (patient's left), gowned: clean and drape; Scrub: passes drapes | L: holds drape / R: antiseptic sponge on forceps | Abdomen and vagina cleaned; leg drapes and belly drape on | - |
| 9 | Bladder catheter in; gentle check | A catheter empties the bladder so it stays out of the way; a gentle check shows how the uterus lies. | 2-3 | BA (at the foot, seated): catheter, gentle pelvic examination; Scrub: passes the set `[10]` | L: holds the lips apart / R: catheter | Bladder catheter in | - |
| 10 | Uterine manipulator fitted | The cup and rod let the team tilt the uterus and mark the cervix. | 2-4 | BA (at the foot, seated): speculum, steadies the cervix, passes the rod; Scrub: passes the manipulator; cup size chosen to fit `[10][11]` | L: holds the cervix instrument / R: manipulator rod | Manipulator in place with the cup round the cervix | - |
| 11 | Time Out: everyone agrees the plan | WHO check before the first small cut. | 1 | All stop; Surg states the plan; Circ reads `[3][4]` | - | Asleep and draped | - |
| 12 | First port in; gas fills the abdomen | Gas lifts the belly wall off the organs so there is room to see. | 3-5 | Surg (patient's right): small cut at or above the navel, needle or open entry; BA (patient's left): gas line | L: lifts the navel skin / R: first port | Gas to 12-15 mmHg `[10]` | Handheld scope; nothing docked |
| 13 | Robot ports and assistant port placed | Four robot ports 8 cm apart in a line, plus a 12 mm assistant port. | 4-8 | Surg (patient's right): four 8 mm ports in a horizontal line, camera port about 3 cm above the navel, 8 cm apart `[12]`; BA (patient's left): 12 mm assistant port more than 7 cm from the nearest robot port `[10]`; Scrub: passes ports | L: steadies the belly wall / R: pushes each port in | 4 × 8 mm + 1 × 12 mm in total `[10][12]` | Handheld scope view of the ports entering |
| 14 | Table tips steeply: head down | Head-down tilt moves the bowel up out of the pelvis. | 1-2 | Circ: table remote; Anaes: at head, checks the tube, face and eyes; Surg checks | Circ: table remote | Steep Trendelenburg 25-30° with legs still in stirrups `[10]` | - |
| 15 | Cart wheeled in with the laser guide | The laser cross-hairs show the driver where to stop. | 2-3 | BA: drives; Circ: spots; Scrub: keeps the drapes clear (the cart comes from the side, or between the legs: varies) | Both hands on the drive handle | Unchanged | "Deploy for docking"; cart stops about 5 cm from the scope port `[1][2]` |
| 16 | Camera arm docked; arms swing to ports | The camera goes first so the robot can aim at the pelvis. | 3-6 | BA: docks the camera arm, holds the targeting button, then docks each arm; Scrub passes | L: steadies the port / R: arm release | The patient can no longer be moved `[14]` | Boom turns; arms swing onto ports; scope on Arm 2 `[1][2]` |
| 17 | Instruments in; surgeon takes the console | Instruments go in under camera view; then the surgeon sits down. | 1-2 | Scrub: passes; BA: inserts; Surg: sits at the console | Console: L / R controllers | - | Arm 1 fenestrated bipolar; Arm 3 monopolar curved scissors; Arm 4 Cadiere or ProGrasp `[12]` |
| 18 | Bowel moved up; pelvis looked over | A clear pelvis lets the team see before any cut. | 3-5 | Surg: at console; BA (patient's left): suction and a long grasper | L: Arm 4 lifts the bowel / R: Arm 3 | - | View: uterus in the middle, round ligaments and tubes either side, sigmoid colon behind, bladder fold in front `[40]` |
| 19 | Top supports of the uterus divided | The round ligaments and the tube and ovarian ligaments are sealed and cut first. | 10-20 | Surg: at console; BA: suction | L: Arm 1 fenestrated bipolar (or sealer) / R: Arm 3 scissors | - | Arm 4 holds the uterus across; view: a round ligament lifted, sealed and cut; the sheet under it opened; ureter seen through the lining `[10]` |
| 20 | Bladder fold opened; bladder moved down | The bladder is pushed down so the cut can go safely below it. | 5-12 | Surg: at console; BA at the foot pushes the manipulator to tilt the uterus `[10]` | L: Arm 1 / R: Arm 3 scissors | - | View: fold opened, thin plane between bladder and uterus, bladder pushed down 2-3 cm `[10][11]` |
| 21 | Uterine vessels sealed and divided | Sealing the main supply frees the uterus; the ureter is checked first. | 6-12 | Surg: at console; BA: suction | L: Arm 1 vessel sealer / R: Arm 3 | - | View: vessels skeletonised at the level of the cervix, sealed, cut; ureter clear `[10][11]` |
| 22 | Cut made around the cervix | The cut follows the rim of the manipulator cup and separates the uterus from the vagina. | 6-12 | Surg: at console; BA (at the foot): pushes the manipulator up to show the cup rim | R: Arm 3 hook or scissors (monopolar) | - | View: cervix with the cup rim, tissue cut a little at a time all the way round `[10][11]` |
| 23 | Uterus delivered through the vagina | The uterus leaves by the natural route, so no extra cut is needed. | 2-6 | BA (at the foot): withdraws the manipulator with the uterus; Scrub holds a basin; larger uteri are divided (morcellated) first `[10][12]` | L: holds the vagina open / R: draws out the uterus | Uterus out; (the gas is kept in by a pack or glove: CP) | View: uterus leaves downward; open vaginal top visible |
| 24 | Top of the vagina closed with stitches | A secure closure helps the vaginal top heal firmly. | 12-25 | Surg: at console; Scrub: loads the suture; BA: suction, passes the needle | L: Arm 1 large needle driver / R: Arm 3 large needle driver | - | Continuous barbed or interrupted 0 absorbable stitches `[10][11][12]` (varies); view: the edges drawn together; suture line complete |
| 25 | Final check, rinse, lower the pressure | A last look at lower gas pressure confirms everything is dry and secure. | 2-4 | Surg: at console; BA: irrigation and suction | Controllers | Gas lowered to 9 mmHg `[10]` | View: pelvis clean, vaginal top intact, ureters visible |
| 26 | Arms released; cart wheeled away | The robot is moved out so the team can reach the patient. | 2-3 | Surg: leaves console; BA + Scrub: detach arms; BA drives the cart out | L: steadies port / R: arm release | - | Arms retract `[40]` |
| 27 | Ports out; small cuts closed | The port sites are closed with small stitches. | 4-8 | Surg (patient's left): closes the deep layer of the 12 mm port and the skin; BA: removes ports under camera view, lets gas out `[10][13]` | L: forceps / R: needle holder | Small stitches; dressings; catheter stays in | - |
| 28 | Sign Out: counts and specimen label | WHO check before leaving: counts right, specimen labelled. | 1-2 | Scrub + Circ: count instruments, swabs, sharps; Surg confirms `[3][4]` | - | Specimen labelled | - |
| 29 | Patient wakes; legs lowered; tube out | The legs come down together and the anaesthetist removes the tube once breathing well. | 6-10 | Circ + BA: lower both legs together; Anaes: at head | L: holds mask / R: draws tube | Stirrups down, drapes off, awake | - |
| 30 | Wheels out to recovery | A handover to the recovery nurse keeps care continuous. | 3-5 | Porter + Circ: push; Anaes: at head | - | Oxygen mask; catheter bag on the stretcher | - |

**Watch compression (seconds per step).** 1: 18, 2: 14, 3: 12, 4: 20, 5: 15, 6: 25, 7: 30, 8: 16, 9: 16, 10: 20, 11: 16, 12: 20, 13: 35, 14: 12, 15: 20, 16: 32, 17: 16, 18: 20, 19: 40, 20: 25, 21: 26, 22: 40, 23: 35, 24: 50, 25: 15, 26: 18, 27: 22, 28: 18, 29: 18, 30: 12. Total: 676 s. Long on the leg position (7), manipulator (10), ports (13), docking (15-17), colpotomy (22) and the vaginal delivery (23); short on the console dissection and the stitching.

**Details that make it realistic.**
- **Ports (Xi):** four 8 mm ports in a horizontal line, 8 cm apart, camera port 3 cm above the navel `[12]`; a 12 mm assistant port that also takes the smoke and gas device `[10]`; 8-10 cm between robot ports, more than 7 cm from the assistant port `[10]`.
- **Positioning:** lithotomy with padded stirrups, a slight bend in the hips and knees; arms by the sides with shoulder braces to stop sliding `[10]`; 25-30° head-down `[10]` (12-15° with a laparoscope alone `[11]`; one ERAS-type review quoted 28° as enough for most gynaecology; not read directly).
- **Manipulator:** a rod with a detachable cup, in three cup sizes chosen to the cervix `[10][11]`; some surgeons use the robot's fourth arm to move the uterus and skip the manipulator `[12]` (varies).
- **Sequence of the dissection:** round ligaments; tube and ovarian ligaments (or the large pelvic-funnel ligaments if the ovaries are removed); bladder fold and bladder; uterine vessels at the cervix; the supports behind and beside the cervix; cut round the cervix on the cup `[10][11]`. The ureter is identified before the vessels are sealed `[10]`.
- **Energy:** bipolar sealing (fenestrated bipolar or Vessel Sealer Extend) and monopolar scissors or hook `[10][12]`; the cut round the cervix is monopolar `[11]`.
- **Removal:** through the vagina when the uterus is under about 280 g; larger uteri are divided (morcellated) first `[10][12]`.
- **Closure of the vaginal top:** a single-layer continuous stitch with 0 braided or barbed suture `[10]`, a figure-of-eight stitch `[11]`, or interrupted 0 stitches `[12]` (varies). Port sites: deep layer of the larger ports, skin stitched under the surface `[13]`.
- **Fluorescence:** optional; sometimes used to show the ureters or the blood supply of the vaginal top (CP).
- **Counts:** instrument, swab and sharps counts at the end `[3][4]`.

## 5. Procedure 3: robotic radical prostatectomy (nerve-sparing)

**Background.** Removal of the prostate and seminal vesicles for localised prostate cancer. General anaesthesia with a breathing tube
and complete muscle relaxation `[14]`. Position: arms tucked with foam rolls and shoulder braces; legs in padded boots in low
lithotomy (a slight bend at the hip and knee); a gel-bead positioner holds the body so it does not slide; compression stockings on;
a stomach tube and a 20 Fr bladder catheter; then 20-25° Trendelenburg ("steep") `[14]`. Gas: the initial fill is up to 20 mmHg in one
series `[14]`; case pressures are lower, down to 8 mmHg with an AirSeal insufflator `[16]` (varies). Published times: median skin-to-skin
178 minutes (n = 520, Xi, 2026, with a limited node dissection in 11 %) `[16]`; 124 minutes with 88 at the console (n = 700, high-volume
surgeon, 2009) `[17]`; median 270 minutes on the Xi in a single-surgeon pathway series `[18]`. **Room time is about 140-270 minutes
(skin-to-skin plus 40-60 minutes of anaesthesia, positioning and waking); console 78-155 minutes.** The sim uses 120-180 and 95-130, which is the fast end (section 14.4). Hospital
stay is usually one night with the catheter left in (median 1 day in two series) `[16][17]`; catheter out after 4-10 days (day 4 in
one centre, about 7 days with a leak check in others) `[15][16][17]`; the sim sends 0 % home the same day `[40]`.

**Team** (this is the Montreal team: surgeon, assistant, circulating nurse, scrub nurse, anaesthetist and respiratory therapist `[14]`).
- **Surg:** console after docking.
- **BA:** patient's left for the whole console phase `[14]`; the 12 mm assistant port is on the patient's left (the text of one source says "right" once, but its landmarks and docking paragraph both put the assistant on the left `[14]`).
- **Scrub:** patient's left, foot end; passes clips, sutures; the scrub nurse also interlocks the two barbed sutures `[15]`.
- **Circ:** round the room.
- **Anaes:** at the head; fluids kept low (under 2 litres) so urine does not hide the field during the join `[14]`.

### Step table

| # | Step | Why | Min | Who does what, and where | Hands (left / right) | Patient state | Robot arms and scope view |
|---|---|---|---|---|---|---|---|
| 1 | Wheels in; team says hello | The team meets the patient and checks the room is ready. | 3-5 | Porter + Circ: push the stretcher in; Anaes: at head; Scrub: gowned at back table; Surg: finishing the hand scrub | - | On the stretcher in gown, cap, ID band | Cart parked and draped `[40]` |
| 2 | Move across; monitors and drip on | A slide sheet moves the patient; monitors are watched from here on. | 4-7 | Circ (patient's left) + Porter (patient's right): slide sheet; Anaes: at head, leads, probe, cuff; Circ fits the return pad | Both hands on the sheet; then L: BP cuff / R: ECG leads | Flat on the back; monitors and drip on | - |
| 3 | Sign In: name, operation, allergies | WHO check before any medicine; the antibiotic is given at induction `[14]`. | 1-2 | Anaes + Circ at head; Surg joins if present `[3][4]` | Circ holds the checklist | Awake; confirms the details | - |
| 4 | Anaesthetic given; patient falls asleep | Sleep medicine and complete muscle relaxation are needed for gas and steep tilt `[14]`. | 3-5 | Anaes: at head; Circ: patient's left | L: holds mask / R: drip syringe | Asleep, fully relaxed; antibiotic given | - |
| 5 | Breathing and stomach tubes placed | The tube is the lifeline in a head-down case; the stomach tube keeps the stomach empty. | 3-6 | Anaes: at head; Circ hands equipment | L: laryngoscope / R: tube | Tubes secured; eyes taped; warming on `[14]` | - |
| 6 | Arms tucked; legs in boots; positioner on | A gel positioner and braces stop the patient sliding during a long head-down case. | 6-12 | Circ (patient's left) + BA (patient's right): foam rolls in the hands, arms tucked, shoulder braces on, compression stockings, legs into padded boots (low lithotomy); Anaes: at head `[14]` | Both hands fitting pads | Low lithotomy; arms by the sides; positioner deflated round the body | - |
| 7 | Skin cleaned; drapes on; catheter in | Clean skin and a drained bladder keep germs out and the bladder small. | 5-8 | Surg + BA (both gowned; Surg patient's right, BA patient's left): clean belly and groin; Scrub (foot end): drapes; BA: 20 Fr catheter `[14]` | L: holds drape / R: antiseptic sponge on forceps | Belly and groin cleaned; catheter in and draining | - |
| 8 | Time Out: everyone agrees the plan | WHO check before the first small cut; the surgeon also confirms nerve-sparing on the plan. | 1 | All stop; Surg states the plan; Circ reads `[3][4]` | - | Asleep and draped | - |
| 9 | First port in; gas fills the abdomen | Gas lifts the belly wall off the organs. | 3-5 | Surg (patient's right): small cut just below the navel; needle then the camera port (12 mm on the Si, 8 mm on the Xi) `[14]`; BA: gas line | L: lifts the skin / R: needle then port | Gas started at 1-2 L/min up to 20 mmHg in one centre, then lowered `[14]` (varies 8-15 mmHg `[16]`) | Handheld scope view; first look for adhesions and bowel |
| 10 | Six ports placed under camera view | Each arm needs its own port; the assistant ports are on the patient's left. | 6-10 | Surg (patient's right): three 8 mm robot ports, one on each side about 10 cm from the camera port plus a fourth-arm port on the right (above the right hip bone) `[14]`; BA (patient's left): 12 mm assistant port above the left hip bone and a 5 mm suction port halfway between the left robot port and the camera port, local anaesthetic at each port; Scrub passes ports | L: steadies the belly wall / R: pushes each port in | Two 12 mm, three 8 mm and one 5 mm port `[14]` | Handheld scope view |
| 11 | Table tips steeply: head down | Head-down tilt moves the bowel up and out of the pelvis. | 1-3 | Circ: table remote; Anaes: at head, checks the tube, face and eyes `[14]`; Surg checks | Circ: table remote | Steep Trendelenburg 20-25° (set before docking) `[14]` | - |
| 12 | Cart wheeled in with the laser guide | The laser cross-hairs show the driver where to stop. | 2-3 | BA: drives with the Circ guiding by room markers; Scrub: keeps drapes clear `[14]` | Both hands on the drive handle | Unchanged | "Deploy for docking"; cart stops about 5 cm from the scope port `[1][2][14]` |
| 13 | Camera arm docked; arms swing to ports | The camera goes first; the fourth arm is docked on the patient's right. | 5-8 | BA (patient's left; the assistant's side): docks the camera arm, then the others; the fourth arm goes on the patient's right `[14]`; Scrub passes | L: steadies the port / R: arm release | The patient cannot be moved from now on `[14]` | Boom turns; arms swing onto ports; scope on Arm 2 `[1][2]` |
| 14 | Instruments in; surgeon takes the console | Instruments go in under camera view; then the surgeon sits down. | 1-2 | Scrub: passes; BA: inserts; Surg: sits at the console | Console: L / R controllers | - | Arm 1 bipolar (Maryland or fenestrated); Arm 3 monopolar scissors; Arm 4 ProGrasp `[14][19]` |
| 15 | Bladder dropped; space behind the pubic bone opened | Freeing the bladder gives access to the front of the prostate. | 8-15 | Surg: at console; BA (patient's left): suction | L: Arm 1 bipolar / R: Arm 3 scissors | - | Arm 4 pulls; view: the umbilical folds divided; the bladder lifted off the belly wall down to the pubic bone `[15][17]` |
| 16 | Fat and side fascia cleared off the prostate | Clearing the surface shows the ligaments, the vein bundle and the bladder neck. | 8-15 | Surg: at console; BA: suction | L: Arm 1 / R: Arm 3 | - | View: fat pad lifted off and kept for the lab; side fascia opened; ligaments exposed; prostate under fat, vein bundle under fascia `[15][40]` |
| 17 | Stitch placed around the vein bundle | A stitch round the vein bundle controls it before the prostate is freed. | 3-6 | Surg: at console; Scrub: loads the needle; BA: passes the needle in | L: Arm 1 large needle driver / R: Arm 3 large needle driver | - | 1-0 absorbable stitches (CTX needle) passed under the bundle and in front of the urethra; four knots `[15]` (varies: some cut without a stitch `[17]`) |
| 18 | Bladder neck opened | The junction of bladder and prostate is opened to reach the back. | 5-10 | Surg: at console; BA (patient's left): pulls on the catheter and lifts with the suction tip `[15]` | L: Arm 1 bipolar / R: Arm 3 scissors | Catheter balloon deflated | View: the bladder neck cut across until the catheter shows; the catheter tip lifts the prostate `[15]` |
| 19 | Sperm ducts and seminal vesicles freed | These sit behind the bladder and are taken out with the prostate. | 5-10 | Surg: at console; BA: lifts the ducts, suction down `[15]` | L: Arm 1 bipolar / R: Arm 3 scissors | - | View: the ducts divided; the seminal vesicles lifted out through the bladder neck `[15]` |
| 20 | Prostate separated from the rectum wall | A thin layer is cut so the prostate can be lifted away safely. | 5-10 | Surg: at console; BA: lifts | L: Arm 1 / R: Arm 3 | - | View: the layer behind the prostate opened with scissors, working toward the tip `[15][17]` |
| 21 | Side supports clipped and cut; nerves spared | Working without heat near the nerve bundles helps keep function. | 15-30 | Surg: at console; BA (patient's left): applies a 10 mm Hem-o-lok clip on each pedicle; Scrub: loads clips `[15]` | L: Arm 1 diamond-tip bipolar / R: Arm 3 scissors | - | Arm 4 lifts; view: pedicle isolated, clipped by the BA, cut between clips with cold scissors; the plane along the capsule peeled gently, no heat near the nerves `[15][16]` |
| 22 | Urethra divided; prostate freed | The vein bundle and urethra are cut at the tip, and the prostate is free. | 5-10 | Surg: at console; BA: withdraws the catheter tip when asked `[15]` | L: Arm 4 pulls up on the stitch / R: Arm 3 scissors | - | View: the vein bundle divided on the stitch; the urethra cut; the catheter pulled back; the prostate comes free `[15][17]` |
| 23 | Prostate placed in a bag | The bag keeps the specimen contained until the end. | 1-3 | BA (patient's left): brings the bag in; Scrub passes; Surg: guides | L: Arm 1 / R: Arm 3 | - | View: prostate with its fat slides into the bag; bag parked in the upper abdomen `[15]` |
| 24 | Back wall of the bladder rebuilt | A small rebuilt shelf behind the join helps it seal and speeds the return of control. | 5-10 | Surg: at console; Scrub: loads the 3-0 barbed suture; BA: passes it `[15][16]` | L: Arm 1 large needle driver / R: Arm 3 large needle driver | - | View: stitches through the bladder-side tissue and the back of the urethra; the bladder drawn down `[15][16]` |
| 25 | Bladder joined to the urethra | The new join lets urine pass through the catheter while it heals. | 15-30 | Surg: at console; BA: puts the catheter tip back so the right tissue is taken `[15]`; Scrub interlocked the two 6-inch barbed sutures | L: Arm 1 needle driver / R: Arm 3 needle driver | - | Two interlocked 3-0 barbed sutures, running 6 to 12 o'clock on each side `[15]`; or two 2-0 absorbable sutures tied at the ends `[17]` (varies); view: the stitches draw the bladder to the urethra |
| 26 | Water leak test | Filling the bladder shows whether the join is watertight. | 1-3 | Surg: at console; BA (patient's left): fills the bladder through the catheter | Controllers | About 300 mL saline instilled `[15]` | View: the join is dry; needles removed by the BA |
| 27 | Final check at lower pressure | A last look at lower gas pressure confirms everything is secure. | 2-4 | Surg: at console; BA: suction | Controllers | Gas lowered to under 10 mmHg `[15]` | View: pelvis clean, bowel unharmed; the bag string moved to the navel port `[15]` |
| 28 | Arms released; cart wheeled away | The robot is moved out so the team can reach the patient. | 2-3 | Surg: leaves console; BA + Scrub: detach arms; BA drives the cart out | L: steadies port / R: arm release | - | Arms retract `[40]` |
| 29 | Prostate out; port sites closed | The bag is drawn out through the lengthened navel port site and the layers are closed. | 8-15 | Surg (patient's left): extends the navel port site to 2.5-3.5 cm, draws out the bag, closes the deep layer (0 absorbable) and the skin (buried stitch and glue) `[15]`; BA: removes ports, lets the gas out; the 5 mm and 12 mm sites need no deep stitches `[15]` | L: forceps / R: needle holder | Port sites closed; catheter in place on a leg bag; a drain only if nodes were removed (CP) | - |
| 30 | Sign Out: counts and specimen label | WHO check before leaving: counts right, specimen labelled. | 1-2 | Scrub + Circ: count instruments, swabs, sharps; Surg confirms `[3][4]` | - | Specimen labelled | - |
| 31 | Patient wakes; tube removed | The anaesthetist reverses the medicines and takes the tube out once breathing well. | 6-10 | Anaes: at head; Circ: patient's left; Circ + BA lower the legs together | L: holds mask / R: draws tube | Legs down, drapes off, awake | - |
| 32 | Wheels out to recovery | A handover to the recovery nurse keeps care continuous. | 3-5 | Porter + Circ: push; Anaes: at head | - | Oxygen mask; catheter on a leg bag | - |

**Watch compression (seconds per step).** 1: 15, 2: 15, 3: 18, 4: 12, 5: 20, 6: 25, 7: 15, 8: 15, 9: 20, 10: 28, 11: 10, 12: 18, 13: 30, 14: 14, 15: 22, 16: 18, 17: 30, 18: 16, 19: 16, 20: 14, 21: 50, 22: 22, 23: 16, 24: 20, 25: 60, 26: 18, 27: 12, 28: 14, 29: 28, 30: 18, 31: 16, 32: 12. Total: 657 s. Long on positioning (6), ports (10), docking (12-13), the vein-bundle stitch (17), the clipping (21) and the join (25); the rest stays short.

**Details that make it realistic.**
- **Ports (six):** a 12 mm camera port (Si; 8 mm on the Xi) in the midline near the navel; three 8 mm robot ports (about 10 cm from the camera port, each side, and one more on the right for the fourth arm); a 12 mm assistant port 2-3 finger-breadths above and 1-2 finger-breadths in from the left hip bone; a 5 mm suction port halfway between the left robot port and the camera port `[14]`. An Xi series put the camera slightly above the navel, three 8 mm ports about 2 cm below it, a 5 mm assistant port between camera and right arm, and a far-right AirSeal port `[16]` (varies).
- **Docking:** camera arm first, then the others; the fourth arm on the patient's right; the bedside assistant on the left; cart base brakes tightened `[14]`.
- **Anaesthesia and safety:** general anaesthetic with complete muscle relaxation; one dose of antibiotic at induction; fluids kept under 2 L; positioning injuries in about 6.6 % of cases, mostly in cases over 5 hours `[14]`; glaucoma and long cases need extra thought in steep Trendelenburg `[14]`.
- **Order of the steps varies.** Montreal starts at the back (peritoneum over the bladder, the ducts and seminal vesicles first) and says so `[15]`; an anterior-first order (space behind the pubic bone, then the front of the bladder neck, then the back) is used by others `[17]`; another group opens the bladder neck through a front "hood" first `[16]`. The sim's picture of the prostate under a fat pad with the vein bundle (`docs/R3`) fits the anterior-first order, so the table follows it (steps 15-20) and the Montreal detail is used where it adds instrument and hand facts.
- **Nerve-sparing:** the Montreal series uses no heat near the bundles, isolates the pedicle with a diamond-tip bipolar, and the assistant puts a 10 mm Hem-o-lok on it `[15]`; a graded system (Tewari grade 1-4) describes how much tissue is left `[16]`. Nerve-sparing is done "when oncologically appropriate" `[16]`; a non-nerve-sparing wide cut uses wider clips or a sealer `[15]`.
- **Node dissection:** selective, extended template when the risk is high; 59 of 520 men (11.3 %), median 10 nodes `[16]`; if nodes are taken a drain is usually placed (CP). The scenes leave it out.
- **Join:** two 6-inch 3-0 barbed sutures interlocked by the scrub nurse, a posterior reconstruction first, a running stitch from 6 o'clock on each side, the surgeon's hands crossing at the front `[15]`; or two 2-0 absorbable sutures tied together at the ends (van Velthoven) `[17]`.
- **Specimen:** in a retrieval bag with the fat; out through the navel port site extended to 2.5-3.5 cm `[15]` (a small lower-right assistant-site cut in another series `[16]`).
- **Closure:** deep layer 0 absorbable; skin buried stitch and glue; 5 mm and 12 mm ports need no deep stitches `[15]`. Catheter stays; leak check or removal on day 4 to about day 7 `[15][16][17]`.
- **Counts:** instrument, swab and sharps counts at the end `[3][4]`.

## 6. Machine 2, shared facts: CT-guided cryoablation with a floor-docked guidance robot and an argon console

**What is in the room** (Quantum Surgical Epione and Perfint MAXIO class; Boston Scientific Visual-ICE class):
- **CT scanner** and a **control room** with a glass window. Staff leave the scan room for each scan unless the doctor is using live CT views (CP).
- **Needle-guidance robot.** MAXIO is a 250 kg cart on four wheels that docks to a floor plate fixed beside the scanner; the plate calibrates it to the CT. A five-axis arm turns a disposable plastic needle guide onto each planned path `[21]`. Epione is the same class, with a patient reference on the skin, an infrared camera and a breathing monitor `[22]`. The robot **only aims**: the doctor pushes the needle through the guide by hand `[20][21][22][23]`.
- **Planning workstation:** up to six needle paths on multi-plane views, with a preview of the ice zone; it also gives the table position for each insertion `[21]`.
- **Argon console (Visual-ICE class):** 10 channels and 20 needle ports, so several needles can freeze at once; 4 multi-point temperature sensors; needles 17 G (1.5 mm) or 14 G (2.1 mm), 17.5 or 23 cm long; argon freezes; helium or an internal heater thaws (some "CX" needles can also seal the needle track with a short heat pulse before removal) `[29]`.

**The robot workflow, as reported** `[20][21][22]`:
1. Patient positioned and held still: a vacuum mattress and tight straps (varies, most series).
2. A wide sterile field is prepared **before** the planning scan, so nobody touches the patient afterwards (the first two cases at one centre were disrupted by movement until skin prep moved ahead of the scan) `[21]`.
3. The robot is docked to its floor plate during sterile prep: about 5 minutes, in parallel `[20]`.
4. Planning CT (3 mm slices) `[21]`.
5. The doctor plans on the workstation: target, entry point, needle length; the software shows the ablation zone `[21][22]`.
6. The table moves to the position set for the first insertion; the arm turns the guide onto the path; a laser marks the entry point `[20][21]`.
7. Local anaesthetic through the guide, a small skin nick, and the doctor advances the needle by hand to the end stop in a single pass; for lung and liver this is done in a held breath (apnoea) `[20][21][22]`.
8. Grippers are released and the arm withdrawn, leaving the needle in place `[21]`.
9. A control CT is fused with the plan to measure path and tip deviation; if needed the doctor adjusts by hand and rescans `[21]`.
10. Repeat for each needle; then freeze, thaw and rescan; then needles out and a final CT.

**Team in published series** (Royal Marsden MAXIO): two interventional radiologists (plan, operate the robot, insert the needle), two radiographers (scanning and table movement), two nurses (sedation, watching patient movement, equipment), and for ablations an anaesthetist and an operating department practitioner `[21]`.

**Accuracy (what is reported).**
- Makers' figures for the guide: about 1-2 mm `[40]`.
- Clinical placement is looser: in 30 robot-guided lung cryoablations the first-probe tip error was 6.1 mm (middle half 2.9-9.7 mm) and the lateral path error 4.2 mm, with a median of 1 manual adjustment per needle `[20]`; in early MAXIO ablations of the liver and other organs the first-placement path error was 11 mm and tip error 20 mm, compared with 1 mm for biopsies `[21]`; Epione's liver pilot needed 0.4 adjustments per tumour on average `[22]`.

**Cryo rules of thumb.**
- Ice ball margin: at least 5 mm beyond the tumour (5-10 mm) `[19][24][27][30]`.
- CT monitoring during a freeze: a scan every 3-5 minutes in the SOLSTICE lung protocol `[19]`; "intermittent" spiral CT in the robotic lung series `[20]`.
- Skin and organ protection: fluid (or gas) is injected to push bowel, ureter or diaphragm away when the tumour is within about 0.5-1 cm `[24][25][26]`.

**Sim rule that matches the sources.** The robot never aims while the patient is in the bore: the table is moved to a set position beside the robot for each insertion and moved in for each scan `[21][40]`.

## 7. Procedure 4: kidney tumour (small renal mass), CT-guided with the robot

**Background.** A small kidney cancer (T1a, under 4 cm; mean 2.5 cm in a 363-tumour series `[24]`) in a patient who is not suited to surgery or prefers not to have it. Percutaneous cryoablation gives five-year recurrence-free survival above 90 % for T1a tumours `[25]`; technical success 97.8 % `[24]`. **Anaesthesia varies:** in an Italian multicentre series of 340 treatments, 68.8 % had conscious sedation, 22.3 % local anaesthetic only and 8.8 % general anaesthesia `[24]`; a UK centre prefers general anaesthesia "for optimal positioning and control of respiratory motion" `[26]`; the sim's moderate sedation by a nurse matches the first practice, not the second `[40]`. **Position:** prone oblique `[26]` or lateral decubitus; the sim places the patient with the left flank up (right side down), the robot beside the left flank `[40]`. Guidance is CT in 93.7 % `[24]`. **Needles:** 17 G, a mean of 2.48 per treatment (1-8) `[24]`, about 1 cm from the tumour edge and under 2 cm apart `[26]`. **Freeze protocol:** double freeze-thaw, 10-15 minutes freezing and 8-10 minutes thawing `[25]` (10-8-10 at the UK centre `[26]`). **Time:** about 90-120 minutes for the whole process `[26]`; with the robot, planning and rescans, the table adds up to about 70-105 minutes for one needle and 80-120 for three. **After:** usually one precautionary night in hospital `[24][26]`; contrast CT at about two weeks `[26]`.

**Team.**
- **IR:** patient's left, beside the robot for aiming and insertion; at the console for the freezes; in the control room during scans.
- **Rad:** control room for scans; in the room for positioning and table moves.
- **SN:** patient's right, head end, beside the monitor (the head end sits in the bore during scans, so the nurse works from the side, CP).
- **Porter:** brings and takes the stretcher.
- **Anaesthetist:** not in the room in the sim (sedation by the nurse); present in general-anaesthesia centres `[26]`.

### Step table

| # | Step | Why | Min | Who does what, and where | Hands (left / right) | Patient state | Robot and screens |
|---|---|---|---|---|---|---|---|
| 1 | Wheels in from the ward | The patient arrives from the ward and the team says hello. | 3-4 | Ward porter: pushes the stretcher to the scan room; SN: meets them; Rad: in the control room, opens the list | - | On the stretcher in gown and ID band, drip in, fasted | Robot stowed beside the table; screens on standby `[40]` |
| 2 | Onto the CT table, left side up | The kidney with the tumour must face up so the needles can go in from the flank. | 3-5 | SN (patient's right) + Porter (patient's left): slide board; Rad: lowers the table; IR: pads and straps | Both hands on the slide board | Lying on the right side with the left flank up (oblique), arms above the head; vacuum mattress shaped to the body; straps tight `[21][26]` (varies: prone oblique) | CT table out of the bore |
| 3 | Monitors, drip and oxygen on | A heart trace, oxygen level and pressure are watched throughout. | 2-3 | SN: patient's right, head end; fits leads, finger probe, cuff and oxygen tube | L: BP cuff / R: ECG leads | Monitored; oxygen on | - |
| 4 | Sign In: name, procedure, allergies | WHO-style check before sedation: right patient, right side, allergies, fasting. | 1-2 | SN + IR + Rad at the patient's side; the patient answers aloud `[3][4]` | - | Awake | Planning screen shows the name and "left kidney" |
| 5 | Sedation given | Medicine makes the patient relaxed and drowsy and keeps the procedure comfortable. | 4-6 | SN (patient's right, head end): small doses, watches breathing and the monitor `[24]` | L: holds the drip line / R: syringe | Drowsy but breathing alone, oxygen by nasal tube | - |
| 6 | Skin cleaned; wide drapes on; robot docks | A wide clean area means nobody touches the patient after the scan; the robot docks at the same time. | 4-6 | IR (patient's left) + SN: clean and drape; Rad: parks the robot on its floor plate (about 5 min, in parallel) `[20][21]` | L: holds the drape / R: antiseptic sponge | Left flank cleaned; wide sterile window | Robot docked to the floor plate by the left flank, arm folded `[20]` |
| 7 | Planning scan | A first scan shows the tumour and the organs around it. | 1.5-2.5 | Rad: control room, starts the scan; IR + SN step behind the shield | - | Table slides into the bore and out; patient lies still | Slice through the kidney with the tumour; 3 mm slices `[21]` |
| 8 | Needle paths drawn on the screen | The doctor draws the safest path to each needle position. | 3-5 | IR: planning workstation in the control room; Rad assists `[21]` | Mouse and keyboard | Patient waits on the table | Dashed numbered paths, current path amber; ice preview; table position set `[21]` |
| 9 | Table moves; robot aims at path 1 | The arm turns a guide onto the exact line the doctor planned. | 1-2 each needle | IR (patient's left, beside the robot): confirms and steps on the footswitch; Rad: moves the table `[20][22]` | IR: foot switch | Table out of the bore at the insertion position | Arm swings; laser spot on the skin; "guide aligned, about 1-2 mm" (clinical tip errors are larger `[20]`) |
| 10 | Time Out: everyone agrees the plan | WHO-style check before the first needle: names, roles, side, the number of needles. | 1 | All stop; IR states the plan; SN confirms sedation and allergies; Rad confirms the scan plan `[3][4]` | - | Drowsy | - |
| 11 | Numbing medicine and a tiny nick | The skin is numbed through the guide and a small nick lets the needle pass. | 1-2 each needle | IR (patient's left): local anaesthetic through the guide, then scalpel nick `[21]` | L: holds the guide / R: syringe, then scalpel | Skin numb; small nick at the entry point | Guide stays aimed |
| 12 | Needle pushed in; robot steps back | The doctor pushes the needle by hand along the guide; the robot only aims. | 1-2 each needle | IR (patient's left): advances the cryoprobe by hand to the end stop in one pass; grippers released, arm withdrawn `[20][21][22]` | L: steadies the guide / R: pushes the needle | Needle in the flank, tip near the tumour | Arm steps back; the needle stays |
| 13 | Check scan of the needle tip | A scan confirms the tip is where it was planned. | 1-1.5 | Rad: control room scans; IR + SN behind the shield `[21]` | - | Table into the bore and out | Bright needle with streaks; planned and actual tip compared; adjusted by hand if needed `[21]` |
| 14 | Fluid moved in to keep bowel away | Fluid pushes the bowel (or the ureter) away from the cold zone. | 3-6 | IR (patient's left): thin needle under CT; Rad checks; SN watches `[24][25][26]` | L: holds the thin needle / R: syringe | Fluid tinted with contrast round the kidney; only when bowel is within about 0.5-1 cm `[24][25]` | Scan shows a gap opening between kidney and bowel |
| 15 | Freeze 1: the ice ball grows | Cold gas freezes the tumour and a margin around it. | 10-15 | IR: at the cryo console (patient's left), starts the argon; Rad: control room, scans every 3-5 min `[19]`; SN: watches the monitor | R: start on the console | Patient still | Console: needle temperatures falling, timer; scan: a dark-grey ice ball growing, margin at least 5 mm `[19][24]` |
| 16 | Thaw: the ice melts on its own | A full thaw before the second freeze makes the treatment more thorough. | 8-10 | IR + SN wait; Rad rescans once `[25][26]` | - | - | Ice shrinks a little (the sim keeps 90 %) `[40]` |
| 17 | Freeze 2: the ice ball grows again | The second freeze finishes the job. | 10-15 | As step 15 | - | - | Ice grows past the first ball; scan at about 5 min |
| 18 | Active thaw: needles warmed free | Warming loosens the needles so they come out easily. | 3-4 | IR: starts the heater or helium on the console `[29]` | R: console | - | Ice shrinking; needle temperatures rising |
| 19 | Needles out, one by one | Each needle is drawn straight out after the thaw. | 2-3 | IR (patient's left): withdraws each needle; SN: presses on each site | L: holds the skin / R: draws the needle | Small nicks; pressure held | Console shows each channel closing |
| 20 | Final scan of the treated area | The last scan checks the treated area and the organs around it. | 1-1.5 | Rad: scans; IR + SN behind the shield `[19][40]` | - | Table into the bore and out | Final scan; no problem seen (CP) |
| 21 | Dressings on; pressure on the nicks | Small dressings protect the nick sites. | 3-4 | SN + IR: dress; Porter brings the stretcher | L: holds the dressing / R: presses | Dressings on | Robot stowed `[40]` |
| 22 | Sign Out: counts and handover | WHO-style check: what was done, counts, instructions for recovery. | 1-2 | SN + IR + Rad `[3][4]` | - | Awake and comfortable | - |
| 23 | Onto the stretcher; wheels out to recovery | The patient moves to recovery and, usually, a ward bed for one night. | 1.5-2.5 | SN + Porter + Rad: slide board; Porter pushes `[24][26]` | - | On the stretcher, oxygen | - |

**Watch compression (seconds per step; for a three-needle case show needle 1 in full, steps 9-13, and needles 2 and 3 as fast repeats of 20 s each).** 1: 18, 2: 25, 3: 12, 4: 18, 5: 20, 6: 25, 7: 30, 8: 40, 9: 35, 10: 16, 11: 25, 12: 45, 13: 30, 14: 25, 15: 55, 16: 30, 17: 50, 18: 18, 19: 25, 20: 22, 21: 15, 22: 12, 23: 14. Total with the two repeats: 645 s. Needle insertion (12), the robot aiming (9) and the ice ball (15, 17) are the long visible steps; the thaw is a short cut.

**Details that make it realistic.**
- **Needles and margin:** 17 G cryoprobes (Galil or Visual-ICE class), mean 2.48 per treatment (1-8), about 1 cm from the tumour edge and under 2 cm apart `[24][26]`; an ice ball at least 5 mm beyond the tumour `[24]`.
- **Freeze-thaw-freeze:** 10-15 minutes freeze, 8-10 minutes thaw, a second freeze of 10-15 minutes `[25]`; 10-8-10 at a UK centre `[26]`; then an active thaw to free the needles (argon freezes, helium or the needle's heater thaws `[29]`).
- **CT:** planning scan, a check scan after each needle, scans during each freeze (at least one in the middle), a final scan `[19][21]`.
- **Protecting neighbours:** contrast-tinted fluid (or gas) through a thin needle when the tumour is within about 0.5-1 cm of bowel `[24][25][26]`; once frozen to the needles a tumour can be levered away from the ureter `[26]`.
- **After:** dressings; one precautionary night is usual `[24][26]`; contrast CT at about two weeks and later `[26]`; imaging every 6 months to two years `[25]`.
- **Safety record:** any complication 18.4 % (mostly minor), Clavien-Dindo grade above 1 in 3.8 % `[24]`.
- **Time:** 90-120 minutes for the whole process at a UK centre `[26]`.

## 8. Procedure 5: lung tumour (new), CT-guided with the robot

**Background.** A small lung tumour or lung metastasis (SOLSTICE allowed up to six tumours of 3.5 cm or less; 128 patients, 224 tumours `[19]`; the Royal Marsden robot series had a median size of 9.8 mm `[20]`). **Anaesthesia:** in SOLSTICE 69 % general anaesthesia, 29 % conscious sedation, 2 % local `[19]`; the robot-guided series used general anaesthesia with high-frequency jet ventilation to keep the lung still `[20][21]`. **Breathing:** with jet ventilation the lung is nearly still; with a robot such as Epione the ventilator is paused (apnoea) for the planning CT and for needle insertion `[22]` (varies). **Position:** chosen by where the tumour is (supine, prone or on the side); a vacuum mattress holds the patient `[20]`; the sim's prone position with arms above the head suits a tumour in the back of the lung (CP). **Needles:** 14 G (IceForce) or 17 G (IceRod, IceSphere); one or two probes per tumour, often as a parallel pair ("chopsticks", 46 % of tumours); up to seven probes in three large lesions `[20]`; in SOLSTICE 36 % of tumours had one probe and the mean was 1.5 needles for 0.5-1.0 cm tumours up to 3.0 for 3.1 cm and over `[19]`. **Freeze protocol:** a triple freeze `[19][20]`; see the box below. **Pneumothorax** (air between the lung and the chest wall) is the main risk: 23 % of SOLSTICE procedures needed a pleural catheter `[19]`; in the robot series 18 of 30 procedures (60 %) had a pneumothorax, 11 needed a drain, two appeared during needle insertion and 16 after the probes were removed `[20]`. **Time:** procedure 66.5 minutes (middle half 56.6-92.8), of which targeting 21 minutes `[20]`; with anaesthesia, turning and waking, the table adds up to about 80-120 minutes for one needle and 90-135 for three (early MAXIO ablations ran a median 194 minutes door to door `[21]`). **After:** median one night in hospital `[20]` (US median 1 day, Europe 3 days in SOLSTICE `[19]`).

> **The freeze protocol, as published.** The brief for this scene suggested "3-3-10-10-10". The papers read here say something close but not identical:
> - **SOLSTICE** (Boston Scientific summary of the *J Thorac Oncol* 2020 paper): at least three freeze-thaw cycles: 3 min freeze, 3 min passive thaw, 7-12 min freeze, 5 min passive thaw, 7-12 min freeze, then an active thaw `[19]`.
> - **Royal Marsden, MAXIO, 30 procedures** (*Eur Radiol* 2026): 3 min freeze, 3-4 min thaw, 7 min freeze, 3-5 min thaw, 10 min freeze, then a passive thaw until the probes were removed `[20]`.
> - **Suggested for the scene:** freeze 3, thaw 3, freeze 10, thaw 5, freeze 10, active thaw 3-4 minutes ("3-3-10-5-10") `[19][20]`.

**Team.**
- **IR:** patient's side next to the robot; control room for scans.
- **Anaes:** at the head (or at the side of the head, outside the bore); gives the anaesthetic, places the tube, runs the jet ventilator, and pauses breathing for the planning scan and each insertion `[22]`. There is no anaesthetist in the sim's cryo staff: a new post or the theatre anaesthetist `or-anaes` is needed (section 14.3).
- **Rad:** control room; positions and table moves.
- **SN:** patient's side; assists the anaesthetist, watches the monitor, positions.
- **Porter:** transfers.

### Step table

| # | Step | Why | Min | Who does what, and where | Hands (left / right) | Patient state | Robot and screens |
|---|---|---|---|---|---|---|---|
| 1 | Wheels in from the ward | The patient arrives from the ward and the team says hello. | 3-4 | Ward porter: pushes the stretcher in; SN: meets them; Anaes: at the head end of the room; Rad: control room | - | On the stretcher in gown, ID band, drip in, fasted | Robot stowed; screens on standby |
| 2 | Onto the CT table | The patient is moved to the scan table for the first time. | 3-5 | SN (patient's right) + Porter (patient's left): slide board; Rad: lowers the table | Both hands on the board | Lying on the back | CT table out of the bore |
| 3 | Monitors, drip and oxygen on | A heart trace, oxygen level and pressure are watched throughout. | 2-3 | Anaes: at the head; SN: patient's right, fits leads, probe, cuff | L: BP cuff / R: ECG leads | Monitored | - |
| 4 | Sign In: name, procedure, allergies | WHO-style check before any medicine. | 1-2 | Anaes + SN + IR + Rad at the patient's side; the patient answers `[3][4]` | - | Awake | Planning screen shows the name and the tumour side |
| 5 | Anaesthetic given; breathing tube placed | A sleeping patient and a ventilator keep the lung still and the patient comfortable. | 6-10 | Anaes: at the head, gives the anaesthetic and passes the tube; SN: assists and hands equipment | L: laryngoscope / R: breathing tube | Asleep; tube in and secured; eyes taped; jet ventilation set up `[19][20]` | - |
| 6 | Turned onto the front, arms up | Lying on the front gives the needles a short path through the back. | 4-8 | Anaes: at the head, holds the head and tube; IR, Rad, SN and Porter: roll the patient together on the Anaes's call (CP) | All hands on the draw sheet | Prone, face turned and padded, arms above the head | CT table out of the bore |
| 7 | Vacuum mattress and straps | The mattress is shaped to the body so it cannot move between scan and needle. | 3-5 | SN (patient's right) + Rad (patient's left): draw the air out of the mattress and tighten straps `[20][21]` | Both hands shaping the mattress | Held firmly in the mattress | - |
| 8 | Skin cleaned; wide drapes on; robot docks | A wide clean area means nobody touches the patient after the scan; the robot docks at the same time. | 4-6 | IR (patient's left) + SN: clean and drape; Rad: parks the robot on its floor plate (about 5 min, in parallel) `[20][21]` | L: holds the drape / R: antiseptic sponge | Back cleaned; wide sterile window | Robot docked beside the table `[20]` |
| 9 | Planning scan with a held breath | A first scan shows the tumour and the lung around it. | 1.5-2.5 | Rad: control room starts the scan; Anaes: pauses breathing for the scan, behind the shield `[22]` | - | Breath held for each scan (ventilation paused) | Chest slice with the tumour; 3 mm slices `[21]` |
| 10 | Needle paths drawn on the screen | The doctor plans a path that avoids crossing more lung than needed. | 3-5 | IR: planning workstation in the control room; Rad assists | Mouse and keyboard | Patient waits, ventilated | Dashed numbered paths, one or two per tumour; ice preview `[20][21]` |
| 11 | Time Out: everyone agrees the plan | WHO-style check before the first needle. | 1 | All stop; IR states the plan; Anaes the airway; SN and Rad add `[3][4]` | - | Asleep | - |
| 12 | Table moves; robot aims at path 1 | The arm turns a guide onto the exact line the doctor planned. | 1-2 each needle | IR (patient's left, by the robot): confirms; Rad: moves the table `[20][22]` | IR: foot switch | Table out of the bore at the insertion position | Arm swings; laser spot on the skin; "guide aligned" |
| 13 | Numbing medicine and a tiny nick | The skin is numbed through the guide and a small nick lets the needle pass. | 1 each needle | IR: local anaesthetic through the guide, scalpel nick `[20][21]` | L: holds the guide / R: syringe, then scalpel | Skin numb; small nick | - |
| 14 | Breath held: needle pushed in | The ventilator pauses so the lung is still during the push; the robot only aims. | 1-2 each needle | Anaes: pauses breathing on the IR's call; IR (patient's left): pushes the probe by hand to the end stop in one pass; arm withdrawn `[20][22]` | L: steadies the guide / R: pushes the needle | Breath held for a few seconds, then breathing resumes | Arm steps back; the probe stays in |
| 15 | Check scan of the needle tip | A scan confirms the tip is in place; any air at the lung edge is looked for. | 1-1.5 | Rad: scans; Anaes: pauses breathing; IR + SN behind the shield `[21]` | - | Breath held | Probe tip and line shown; adjusted by hand if needed `[21]` |
| 16 | Freeze 1: short (3 min) | A short first freeze makes the first ice that later cycles build on. | 3 | IR: at the cryo console, starts the argon; Rad scans at 3-5 min `[19][20]` | R: start on the console | Ventilated | Ice ball appears as a ground-glass shadow around the tip `[20]` |
| 17 | Thaw 1 | The ice melts on its own before the next freeze. | 3-4 | IR + Anaes + SN wait `[19][20]` | - | - | Shadow shrinks |
| 18 | Freeze 2 (about 7-10 min) | The main freeze, with a scan midway. | 7-10 | As step 16; Rad scans at 3-5 min `[19]` | - | - | Ice grows past the first ball; margin at least 5 mm `[19]` |
| 19 | Thaw 2 | A second melt before the last freeze. | 3-5 | As step 17 | - | - | Shadow shrinks |
| 20 | Freeze 3 (10 min) | The last freeze completes the treated zone. | 10 | As step 16; Rad scans | - | - | Final ice zone; margin check |
| 21 | Active thaw: needles warmed free | Warming frees the needles so they come out easily. | 3-4 | IR: heater or helium on the console `[19][29]` | R: console | - | Temperatures rising |
| 22 | Needles out, one by one | Each needle is drawn straight out. | 2-3 | IR: withdraws each needle; SN: presses on each site | L: holds the skin / R: draws the needle | Small nicks, pressure | - |
| 23 | Final scan: lung edge checked for air | Air between the lung and chest wall is the main risk and often appears after the needles are out. | 1-1.5 | Rad: scans; Anaes: pauses breathing; IR + SN behind the shield `[19][20]` | - | Breath held | Final scan: treated area and lung edge; a small drain would be placed if needed (CP) |
| 24 | Dressings on | Small dressings protect the nick sites. | 3-4 | SN + IR: dress; Porter brings the stretcher | L: holds the dressing / R: presses | Dressings on | Robot stowed |
| 25 | Sign Out: counts and handover | WHO-style check: what was done, counts, instructions for recovery. | 1-2 | Anaes + SN + IR + Rad `[3][4]` | - | Asleep | - |
| 26 | Turned onto the back; wakes; tube out | The anaesthetist ends the anaesthetic and removes the tube once breathing well. | 8-12 | Anaes: at the head; IR, Rad, SN and Porter: turn the patient on the Anaes's call (CP) | L: holds mask / R: draws the tube | On the back; awake; oxygen mask | - |
| 27 | Onto the stretcher; wheels out to recovery | A chest X-ray or scan later checks the lung (CP). | 2-3 | SN + Porter + Rad: slide board; Porter pushes | - | On the stretcher | - |

**Watch compression (seconds per step; three-needle case: show needle 1 in full, steps 12-15; needles 2 and 3 as fast repeats of 20 s each).** 1: 15, 2: 15, 3: 10, 4: 15, 5: 40, 6: 40, 7: 20, 8: 25, 9: 20, 10: 35, 11: 15, 12: 35, 13: 20, 14: 45, 15: 25, 16: 25, 17: 10, 18: 30, 19: 10, 20: 35, 21: 15, 22: 22, 23: 25, 24: 12, 25: 12, 26: 30, 27: 12. Total with the repeats: 653 s. The tube (5), the turn onto the front (6), the held-breath needle push (14) and the three short freezes are the visible highlights.

**Details that make it realistic.**
- **Needles:** 14 G IceForce or 17 G IceRod and IceSphere (Boston Scientific); one or two probes per tumour; "chopstick" pairs in 46 % of tumours; up to seven 17 G probes in three lesions; no coaxial needles in the robot series `[20]`.
- **Ice margin:** at least 5 mm beyond the tumour `[19]`; the ice shows as ground-glass change on CT `[20]`; a planned isotherm of -20 °C with a 5-10 mm margin is used with liquid-nitrogen systems `[30]`.
- **CT in the freeze:** a non-contrast scan every 3-5 minutes during freezing; after the needles are out, CT for the ablation zone and any complication `[19]`.
- **Breath control:** jet ventilation (a fast, tiny-volume breathing pattern) keeps the lung nearly still `[20][21]`; Epione's workflow records the apnoea level and shows a gating band on the screen `[22]`.
- **Positioning:** supine, prone or on the side, by tumour site; ipsilateral-down favoured when the risk of fluid or air is higher `[20]` (varies). The prone, arms-up position of the sim is common for a tumour in the back of the lung (CP).
- **Complications:** pneumothorax 23 % needing a pleural catheter (SOLSTICE) `[19]`; 60 % any pneumothorax and 37 % drained (robot series) `[20]`; 22 % pneumothorax with a liquid-nitrogen system (n = 18) `[30]`; grade 3 events 4.7 % in SOLSTICE `[19]`.
- **Accuracy:** tip error 6.1 mm, path error 4.2 mm, median 1 adjustment per needle; no switch to freehand in 35 of 37 tumours `[20]`.
- **Time:** procedure 66.5 minutes; targeting 21 minutes `[20]`.

## 9. Procedure 6: liver tumour (new), CT-guided with the robot

**Background.** A small liver tumour (liver metastasis or primary liver cancer), best under about 5 cm `[28]`. **Anaesthesia varies a lot:** local anaesthetic only `[27]`, conscious sedation `[28]`, general anaesthesia with controlled breathing for the robot-guided ablations at the Royal Marsden `[21]` and in Epione's liver pilot `[22]`. The sim plan of deep sedation by an anaesthetist is a reasonable middle choice and is not directly reported in the sources read. **Position:** the Royal Marsden used a vacuum mattress and a left lateral oblique position to reach the right posterior liver `[21]`; supine and prone are used for other segments (CP); the position follows the needle path. **Breath control:** apnoea for the planning CT and needle insertion in the Epione pilot `[22]`; jet ventilation at the Royal Marsden `[21]`. **Needles:** probes of 2.1-2.4 mm, one to three, in a CT-guided series `[27]`; with 3 mm probes, one for tumours under 3 cm, two or three for 3-5 cm, three or four above `[28]`; Visual-ICE 17 G and 14 G needles `[29]`. **Margin:** 5 mm "wherever feasible" `[28]`; 5-10 mm may lower local progression `[27]`; probes placed at least 1 cm from neighbouring organs `[27]`. **Freeze protocol:** 10 min freeze, 8 min thaw, 10 min freeze `[27]`; or 20-10-15 with larger probes `[28]`: the sim plan of 10-15 / thaw / 10-15 is inside the published range. **Liver-specific points:** liver tissue can crack on freezing and bleed, and a "cryoshock" reaction was seen in 6 of 300 patients in an older series `[28]`; needle tracks are sealed (with a short heat pulse on "CX" needles `[29]`, or by packing the track `[28]`). **Time:** 66-74 minutes for robot-guided procedures (Epione liver pilot: mean 73.8 min; MAXIO lung: 66.5 min); the Royal Marsden's median door-to-door for MAXIO ablations was 194 minutes in an early series `[20][21][22]`. The table adds up to about 80-125 minutes for one needle and 90-135 for three. **After:** overnight observation `[28]`.

**Team.**
- **IR:** patient's side by the robot; control room for scans.
- **Anaes:** at the head; deep sedation or general anaesthetic; pauses breathing for scan and insertion.
- **Rad:** control room; table moves.
- **SN:** patient's side; assists.
- **Porter:** transfers.

### Step table

| # | Step | Why | Min | Who does what, and where | Hands (left / right) | Patient state | Robot and screens |
|---|---|---|---|---|---|---|---|
| 1 | Wheels in from the ward | The patient arrives from the ward and the team says hello. | 3-4 | Ward porter: pushes the stretcher in; SN: meets them; Anaes: at the head end of the room; Rad: control room | - | On the stretcher in gown, ID band, drip in, fasted | Robot stowed; screens on standby |
| 2 | Onto the CT table | The patient is moved to the scan table. | 3-5 | SN (patient's right) + Porter (patient's left): slide board; Rad: lowers the table | Both hands on the board | Lying on the back | CT table out of the bore |
| 3 | Monitors, drip and oxygen on | A heart trace, oxygen level and pressure are watched throughout. | 2-3 | Anaes: at the head; SN: patient's right, leads, probe, cuff | L: BP cuff / R: ECG leads | Monitored | - |
| 4 | Sign In: name, procedure, allergies | WHO-style check before any medicine. | 1-2 | Anaes + SN + IR + Rad at the patient's side; the patient answers `[3][4]` | - | Awake | Planning screen shows the name and "liver" |
| 5 | Deep sedation given | The patient sleeps deeply and breathes with the anaesthetist's help. | 5-8 | Anaes: at the head, gives the medicines, supports the airway; SN assists `[21][22]` | L: holds mask or airway / R: drip syringe | Asleep; airway supported (a tube if general anaesthesia is chosen: varies) | - |
| 6 | Turned to the right position and held | The tumour must lie on the side the needles can reach. | 4-8 | Anaes: holds head and airway; SN, Rad, Porter and IR: turn and pad (left lateral oblique for a right-back tumour `[21]`; prone or supine for other sites: CP) | All hands on the draw sheet | Lying oblique, arms above the head; vacuum mattress shaped; straps tight `[21]` | CT table out of the bore |
| 7 | Skin cleaned; wide drapes on; robot docks | A wide clean area means nobody touches the patient after the scan; the robot docks at the same time. | 4-6 | IR + SN: clean and drape; Rad: parks the robot on its floor plate (about 5 min) `[20][21]` | L: holds the drape / R: antiseptic sponge | Right side cleaned; wide sterile window | Robot docked beside the table |
| 8 | Planning scan with a held breath | A first scan shows the tumour and nearby organs. | 1.5-2.5 | Rad: starts the scan; Anaes: pauses breathing for the scan `[22]` | - | Breath held for each scan | Slice through the liver with the tumour; 3 mm slices `[21]` |
| 9 | Needle paths drawn on the screen | The doctor plans paths that keep the ice ball at least 5 mm beyond the tumour. | 3-5 | IR: planning workstation; Rad assists `[21]` | Mouse and keyboard | Patient waits | Dashed numbered paths; ice preview |
| 10 | Time Out: everyone agrees the plan | WHO-style check before the first needle. | 1 | All stop; IR states the plan; Anaes the airway `[3][4]` | - | Asleep | - |
| 11 | Table moves; robot aims at path 1 | The arm turns a guide onto the exact line the doctor planned. | 1-2 each needle | IR (by the robot): confirms; Rad: moves the table `[20][22]` | IR: foot switch | Table out of the bore at the insertion position | Arm swings; laser spot on the skin; "guide aligned" |
| 12 | Numbing medicine and a tiny nick | The skin is numbed through the guide and a small nick lets the needle pass. | 1 each needle | IR: local anaesthetic through the guide, scalpel nick `[21]` | L: holds the guide / R: syringe, then scalpel | Skin numb; small nick | - |
| 13 | Breath held: needle pushed in | The ventilator pauses so the liver is still during the push; the robot only aims. | 1-2 each needle | Anaes: pauses breathing on the IR's call; IR: pushes the probe by hand to the end stop; arm withdrawn `[22]` | L: steadies the guide / R: pushes the needle | Breath held for a few seconds | Arm steps back; the probe stays in |
| 14 | Check scan of the needle tips | A scan confirms the tips are where they were planned. | 1-1.5 | Rad: scans; Anaes: pauses breathing; IR + SN behind the shield `[21]` | - | Breath held | Probe tips compared with the plan |
| 15 | Fluid moved in to protect neighbours | Fluid or gas pushes the diaphragm or bowel away from the cold zone. | 3-6 | IR: thin needle under CT; Rad checks `[25][26]` | L: holds the thin needle / R: syringe | Fluid round the liver edge when needed (CP) | Scan shows the gap opening |
| 16 | Freeze 1: the ice ball grows | Cold gas freezes the tumour and a margin around it. | 10-15 | IR: at the cryo console, starts the argon; Rad: scans every 3-5 min `[19]`; Anaes: monitors | R: start on the console | Patient still | Console timer; dark-grey ice ball growing; margin at least 5 mm `[27][28]` |
| 17 | Thaw: the ice melts on its own | A full thaw makes the second freeze more effective. | 8-10 | IR + Anaes + SN wait `[27]` | - | - | Ice shrinks a little |
| 18 | Freeze 2: the ice ball grows again | The second freeze finishes the job. | 10-15 | As step 16 | - | - | Ice grows past the first ball |
| 19 | Active thaw and needle tracks sealed | Warming frees the needles; a short heat pulse can seal each needle track. | 3-4 | IR: heater or helium on the console, track seal on "CX" needles if used `[28][29]` | R: console | - | Temperatures rising |
| 20 | Needles out, one by one | Each needle is drawn straight out. | 2-3 | IR: withdraws each needle; SN: presses on each site | L: holds the skin / R: draws the needle | Small nicks, pressure | - |
| 21 | Final scan of the treated area | The last scan checks the treated area and the organs around it. | 1-1.5 | Rad: scans; Anaes: pauses breathing `[19]` | - | Breath held | Final scan; no problem seen (CP) |
| 22 | Dressings on | Small dressings protect the nick sites. | 3-4 | SN + IR: dress; Porter brings the stretcher | L: holds the dressing / R: presses | Dressings on | Robot stowed |
| 23 | Sign Out: counts and handover | WHO-style check: what was done, counts, instructions for recovery. | 1-2 | Anaes + SN + IR + Rad `[3][4]` | - | Asleep or drowsy | - |
| 24 | Wakes; onto the stretcher | The anaesthetist brings the patient round before moving. | 5-8 | Anaes: at the head; SN + Porter + Rad: slide board | L: holds mask / R: drip | Awake; oxygen mask | - |
| 25 | Wheels out to recovery | The patient goes to recovery, then usually a ward bed overnight. | 2-3 | Porter pushes; SN walks alongside `[28]` | - | On the stretcher | - |

**Watch compression (seconds per step; three-needle case: show needle 1 in full, steps 11-14; needles 2 and 3 as fast repeats of 20 s each).** 1: 15, 2: 15, 3: 10, 4: 15, 5: 30, 6: 40, 7: 25, 8: 25, 9: 35, 10: 15, 11: 30, 12: 20, 13: 45, 14: 25, 15: 20, 16: 50, 17: 30, 18: 40, 19: 45, 20: 22, 21: 20, 22: 12, 23: 12, 24: 18, 25: 12. Total with the repeats: 666 s. The turn and the vacuum mattress (6), the held-breath push (13) and the ice ball (16, 18) are the long visible steps.

**Details that make it realistic.**
- **Needles:** 2.1-2.4 mm probes, one to three (CT-guided HCC series, argon) `[27]`; 3 mm probes: one for tumours under 3 cm, two or three for 3-5 cm, three or four above `[28]`; Visual-ICE 17 G or 14 G `[29]`.
- **Margin:** 5 mm where feasible `[28]`; 5-10 mm may lower local progression `[27]`; probes at least 1 cm from neighbouring organs `[27]`.
- **Freeze-thaw-freeze:** 10-8-10 minutes with argon `[27]`; 20-10-15 minutes in an ultrasound-guided series, probe at about -135 °C within a minute `[28]`.
- **Breath control and the robot:** general anaesthesia, apnoea for the baseline CT and for the needle push (Epione) `[22]`; jet ventilation (MAXIO, Royal Marsden) `[21]`.
- **Positioning:** left lateral oblique with a vacuum mattress and straps for the right posterior liver `[21]`.
- **Problems specific to the liver:** tract bleeding, which is controlled by packing the track after the probe is out `[28]`; "cryoshock" `[28]`; a track seal on CX needles `[29]`.
- **Time:** Epione liver pilot, mean 73.8 minutes (all with general anaesthesia; microwave, not cryo) `[22]`.
- **After:** overnight observation `[28]`.

## 10. Machine 3, shared facts: IceCure ProSense (liquid nitrogen, one probe, ultrasound-guided)

- **What it is:** a slim console that sends liquid nitrogen (about -170 °C at the probe) to one needle-like cryoprobe; the probe is placed under live ultrasound; the doctor watches the ice ball grow as a bright curved edge with a dark shadow behind it `[38][40]`.
- **Probes** (as used in a fibroadenoma series): 3.4 mm (10 G) 127 or 140 mm, spherical or elliptical ice ball; 2.4 mm (13 G) 134 mm, elliptical ice ball `[35]`. ICE3 used a 140 mm, 10 G probe `[31]`. One probe can be moved ("relocated") up to three times in one procedure `[36]`.
- **Setting:** an outpatient room, local anaesthetic, no sedation, the patient goes home the same day `[31]`.
- **Current FDA status (confirmed against the FDA order).**
  - **Breast cancer:** FDA De Novo classification order DEN220077, dated 3 October 2025 and corrected on 20 March 2026 (the corrections concern post-market study wording) `[32]`. The device type is new: "cryoablation device for local treatment of low-risk breast cancer", Class II `[32]`.
  - **Indication, verbatim in substance:** local treatment of breast cancer in patients **70 years or older** with biologically low-risk tumours **1.5 cm or smaller**, treated with **adjuvant endocrine therapy**, including patients not suitable for surgery. "Low-risk" means one tumour, 1.5 cm or less, ER-positive, PR-positive, HER2-negative, Ki-67 under 15 % and/or a genomic test showing low risk, infiltrating ductal carcinoma (no lobular, no extensive intraductal component, no lymphovascular invasion) and clinically negative lymph nodes `[32]`.
  - **Labelling:** must give training, instructions for reaching the right ice ball size, and a clinical summary with the treatment parameters; a post-market study is required `[32]`.
  - **ICE3 population (the trial):** women aged 60 or older (a few sites enrolled from 50: 4 patients), one ultrasound-visible invasive ductal cancer of 1.5 cm or less, grade 1-2, ER and/or PR positive, HER2 negative, node-negative; mean age 74.9 and mean tumour size about 7-8 mm `[31]`. So the trial population is wider than the FDA indication.
  - **Fibroadenoma:** IceCure states that ProSense has FDA clearance for fibroadenomas (company release, March 2026; no clearance number was found) `[36]`; an older argon system, Visica, has been cleared for fibroadenoma ablation since 2002 `[39]`.

## 11. Procedure 7: early-stage breast cancer (ICE3 population), ultrasound-guided

**Background.** Freezing a small, low-risk breast cancer in place instead of cutting it out, in an older woman who also takes endocrine (hormone) tablets. **Anaesthesia:** local only, in an office `[31]`. **Position:** supine on a couch with the treated-side arm raised, the body rolled slightly toward the other side (CP; ICE3 does not describe it). **Probe path:** a small skin nick; the probe goes along the longest axis of the lesion, parallel to the chest wall `[31]`. **Skin protection:** saline injected under ultrasound between the skin and the front of the ice ball; the probe is gently lifted away from the chest wall during freezing; extra care in small breasts `[31]`. **Freeze protocol in ICE3:** one session, two freezes: **9 minutes freeze, 8 minutes passive thaw, 9 minutes freeze** as the default; each freeze up to 12 minutes; the investigator may adjust `[31]`. **Ice ball targets:** at least 35 mm at the end of the first freeze and 40 mm at the end of the second `[31][38]`. **Time:** 20-40 minutes in total in ICE3 `[31]`; note that the default 9-8-9 cycle alone is 26 minutes, so the shorter cases must have used shorter freezes (varies). **After:** home the same day; back to normal activity in a mean of 1.7 ± 1.5 days, 82.9 % by 48 hours `[31]`. **Results:** five-year recurrence in the same breast 4.3 % (95 % CI 2.1-8.7 %) in the 194 per-protocol patients; 3.7 % among the 124 on endocrine therapy alone (Kaplan-Meier); disease-free survival 92.8 %; breast-cancer survival 96.7 %; cosmetic satisfaction 100 % by patients and doctors; no serious device-related events and 187 non-serious events, 88.2 % mild `[31]`. **FDA's own analysis** of the same trial gave 6.2 % (95 % CI 3.2-11.7 %) for the 194, 8.7 % for all 206 treated, and 2.3 % (0.6-9.0 %) for the 120 who fit the indication closest `[33]`.

**Team.**
- **BR (performs):** at the patient's side of the treated breast, seated on a stool; holds the ultrasound probe in one hand and the cryoprobe in the other (CP).
- **Son (sonographer or assistant):** at the console and the supplies, across the couch from the BR or at the head; sets and watches the timer, draws up saline and anaesthetic, passes items, logs measurements (CP).
- The ultrasound screen sits across the couch so the BR and the patient can both see it; the console and nitrogen are on the BR's side (CP).

### Step table

| # | Step | Why | Min | Who does what, and where | Hands (left / right) | Patient state | Ultrasound and console view |
|---|---|---|---|---|---|---|---|
| 1 | Console and probe checked | The nitrogen console and sterile probe are tested before the patient comes in. | 5-10 | Son: at the console, connects the probe and hose, checks the nitrogen and the timer (CP); BR: checks the ultrasound | L: holds the hose / R: touch screen | Patient not yet in the room | Console screen: ready, probe connected (CP) |
| 2 | Patient arrives; plan and consent checked | Everyone confirms who is being treated and that the plan fits the approved use. | 3-5 | BR: at the door, checks identity, scans, biopsy result and that the plan fits: age 70 or over, 1.5 cm or less, hormone-positive, hormone tablets planned `[32]`; Son: seats the patient | - | Patient walks in, seated | - |
| 3 | Lies on the couch, arm raised | An arm above the head flattens the breast and brings the lump closer to the skin. | 2-3 | Son (patient's right): helps the patient lie down and places the arm on a pillow; BR: patient's side of the treated breast (CP) | Both hands steadying | Lying on the back, a little toward the other side, treated-side arm raised (CP) | - |
| 4 | Ultrasound survey; skin marks drawn | The lump's size and depth are measured, and the path of the probe is planned. | 3-5 | BR: ultrasound probe on the breast; Son: types the measurements, passes the pen | L: ultrasound probe / R: marker pen | Marks drawn on the skin | Dark oval lump; measurements; planned path along its long axis, parallel to the chest wall `[31]` |
| 5 | Skin cleaned; sterile drape on | Clean skin and a sterile drape keep germs out. | 3-4 | BR + Son: gowned and gloved; clean the breast and drape | L: holds the drape / R: antiseptic sponge on forceps | Breast cleaned; drape with a window; ultrasound probe in a sterile cover | - |
| 6 | Time Out: patient, side, plan | A short pause before the first needle, in the style of the WHO check. | 1 | BR states the plan; Son confirms the consent and the side `[3][4]` | - | Awake and relaxed | - |
| 7 | Numbing medicine around the lump | Local anaesthetic numbs the skin and the path so the patient feels little. | 2-3 | BR: injects under ultrasound along the path and round the lump `[31]` | L: ultrasound probe / R: syringe | Breast numb | Needle seen as a bright line near the lump |
| 8 | Small nick in the skin | A tiny nick lets the probe pass. | 0.5-1 | BR: nick with a scalpel `[31]` | L: ultrasound probe / R: scalpel | Small nick, a few millimetres | - |
| 9 | Probe guided to the lump under ultrasound | The probe goes along the long axis so the ice ball covers the whole lump. | 2-4 | BR: advances the probe under live ultrasound; Son: keeps the hose clear `[31]` | L: ultrasound probe / R: cryoprobe | Probe in the lump along its long axis, parallel to the chest wall `[31]` | Bright probe line entering the dark lump; tip placed along its long axis `[31]` |
| 10 | Saline injected to protect the skin | Saline lifts the skin away from the cold ice ball. | 2-3 | BR: injects saline between the skin and the front of the lump under ultrasound; Son: passes syringes `[31]` | L: ultrasound probe / R: syringe | A layer of saline lifts the skin off the lump `[31]` | Dark fluid layer between skin and lump |
| 11 | Freeze programme set on the console | The freeze and thaw times are chosen from the size of the lump. | 1 | Son: touch screen; BR confirms `[31]` | - | - | Console: 9-8-9 minutes, each freeze limited to 12 `[31]` |
| 12 | Freeze 1: the ice ball grows | Liquid nitrogen at the tip freezes the lump and a margin round it. | 9 (up to 12) | BR: starts the freeze; watches the ultrasound and gently lifts the probe away from the chest wall `[31]`; Son: watches the timer and temperature | L: ultrasound probe / R: holds the probe steady | Patient lies still | Bright curved edge with a dark shadow behind it, growing; probe at about -170 °C `[38]` |
| 13 | Ice ball measured: at least 35 mm | The doctor checks the ice ball is big enough to cover the lump with a margin. | 1 | BR: measures on the screen; Son: logs it `[31]` | L: ultrasound probe / R: calipers | - | Ice ball 35 mm or more `[31]` |
| 14 | Thaw: the ice melts on its own | A full thaw before the second freeze makes the treatment more thorough. | 8 | BR + Son wait; BR keeps the ultrasound on the skin and checks the saline layer `[31]` | - | - | Shadow fades; ice ball shrinks |
| 15 | Freeze 2: the ice ball grows again | The second freeze finishes the job. | 9 (up to 12) | As step 12 | - | - | Ice ball grows past the first |
| 16 | Ice ball measured: at least 40 mm | Final check that the lump is well covered. | 1 | BR measures; Son logs `[31]` | L: ultrasound probe / R: calipers | - | Ice ball 40 mm or more `[31]` |
| 17 | Thaw until the probe frees itself | The probe comes free once the ice around the tip has melted. | 2-4 | BR + Son wait; BR checks the skin | - | - | Ice shrinks; probe loosens |
| 18 | Probe out | A gentle withdrawal after the thaw. | 1 | BR: draws the probe out | L: steadies the skin / R: draws the probe | Small nick at the entry | - |
| 19 | Pressure and a small dressing | A few minutes of pressure and a small dressing protect the nick. | 2-3 | Son: presses with gauze, then a small dressing; BR checks the skin | L: holds the gauze / R: dressing | Small dressing; a cold pack is common (varies; not in the ICE3 paper, CP) | Ultrasound shows the treated area |
| 20 | Sign Out and aftercare talk | The team confirms what was done and explains what to expect, the hormone tablets and the follow-up scan. | 1-2 | BR + Son: speak with the patient `[3][4][32]` | - | Sitting up | - |
| 21 | Rest, then walk out | The patient goes home the same day; most return to normal activity within about two days. | 5-10 | Son: walks with the patient to the door; BR writes notes `[31]` | - | Dressed, walks out | Console off; probe discarded (CP) |

**Watch compression (seconds per step).** 1: 20, 2: 20, 3: 15, 4: 40, 5: 25, 6: 18, 7: 30, 8: 20, 9: 50, 10: 30, 11: 20, 12: 70, 13: 20, 14: 45, 15: 70, 16: 20, 17: 30, 18: 20, 19: 25, 20: 25, 21: 25. Total: 638 s. The probe insertion (9), the saline (10), the two freezes (12, 15) and the ice-ball checks are the visible highlights; the thaws stay short.

**Details that make it realistic.**
- **Probe and nick:** a 140 mm, 10 G (3.4 mm) ProSense cryoprobe through a small skin nick, along the lesion's longest axis, parallel to the chest wall; for tip placement the ICE3 text, as summarised for this document, gives about 20 mm from the middle of the lesion; the exact meaning was not verified and the scene does not depend on it `[31]`.
- **Ultrasound planes:** the probe is followed in the long axis (a bright line); the ice ball is measured in two planes against the 35 mm and 40 mm targets `[31]` (the choice of planes is CP).
- **Skin and chest wall:** saline between the skin and the ice ball, the probe lifted gently off the chest wall during each freeze, extra care in small breasts `[31]`; skin burns are rare and were treated with warming pads in a fibroadenoma series `[35]`.
- **Freeze protocol:** 9-8-9 minutes by default, each freeze up to 12 minutes, targets of 35 and 40 mm `[31]`. The liquid-nitrogen probe reaches about -170 °C `[38]`.
- **Pre-treatment checks:** one small invasive ductal cancer, ER/PR positive, HER2 negative, Ki-67 under 15 % or low-risk genomic test, no lobular or lymphovascular features, nodes negative, patient 70 or over and on hormone tablets `[32]`; a lump about 1 cm or more from the skin is ideal `[37]`.
- **After:** the patient goes home; most return to normal activity in about 1.7 days; the treated tissue is absorbed over months; follow-up ultrasound and mammography (the interval was not read) `[31]`.
- **Counts and a Sign Out:** instrument counts are minimal in an office room; the Sign Out is mostly a handover and aftercare check (varies, CP).

## 12. Procedure 8: benign breast fibroadenoma, ultrasound-guided

**Background.** A fibroadenoma is a common, harmless breast lump, usually in younger women; treatment is optional (size, symptoms, patient choice). Freezing it under local anaesthetic avoids surgery. **Anaesthesia:** local, 1 % lidocaine 10 mL in a recent series `[35]`. **Position:** supine on a couch, arm raised (CP). **Probe:** ProSense 3.4 mm (10 G) or 2.4 mm (13 G) `[35]`. **Freeze protocol:** freeze-thaw-freeze with times chosen by the doctor from the size, number, depth and position of the lump; examples given are 8-8-8, 8-6-6 and 4-4-4 minutes; one freeze-thaw-freeze cycle was enough in 76 % of the 119 lumps; the probe was moved between cycles when the ice ball did not cover the lump `[35]`. **Skin protection:** saline injected (10-50 mL) when the lump is about 1 cm or less from the skin `[35]`. **Time:** mean cryoablation time 13.0 ± 10.4 minutes (median 9, middle half 6-15; range 3.3-56) `[35]`; the paper does not say whether the thaw is counted. **Size:** 7-80 mm in that series; larger lumps need probe relocation `[35]`. **After:** same-day discharge `[35]`; follow-up ultrasound at 1, 3, 6 and 12 months `[35]`; the lump shrinks over time: median volume reduction 80.6 % at six months and 92.9 % at one year `[35]`. **Safety:** one minor event (a skin burn that settled with warming pads) in 123 procedures `[35]`. **Regulation:** company release states FDA clearance for fibroadenomas `[36]`; the older Visica system was cleared for fibroadenoma ablation in 2002 and again in 2006 (K061510) `[39]`. **Room time for the scene:** the table adds up to about 45-85 minutes, including 5-10 minutes of console set-up before the patient comes in.

**Team.** The same as procedure 7: BR (performs) and Son (console, supplies, timer). In most centres the sonographer holds the ultrasound probe while the doctor places the cryoprobe (varies, CP).

### Step table

| # | Step | Why | Min | Who does what, and where | Hands (left / right) | Patient state | Ultrasound and console view |
|---|---|---|---|---|---|---|---|
| 1 | Console and probe checked | The nitrogen console and sterile probe are tested before the patient comes in. | 5-10 | Son: at the console, connects the probe and hose, checks nitrogen and timer (CP); BR: checks the ultrasound | L: holds the hose / R: touch screen | Patient not yet in the room | Console screen: ready (CP) |
| 2 | Patient arrives; biopsy report and consent checked | Everyone confirms the lump is a proven fibroadenoma and the patient agrees. | 3-5 | BR: checks identity, scans and the biopsy result (benign, as proven before treatment); Son: seats the patient | - | Patient walks in, seated | - |
| 3 | Lies on the couch, arm raised | An arm above the head flattens the breast and brings the lump closer to the skin. | 2-3 | Son (patient's right): helps the patient lie down and places the arm on a pillow; BR: patient's side of the treated breast (CP) | Both hands steadying | Lying on the back, treated-side arm raised (CP) | - |
| 4 | Ultrasound survey; skin marks drawn | The lump's size, depth and distance from the skin are measured. | 3-5 | BR: ultrasound probe; Son: types the measurements, passes the pen | L: ultrasound probe / R: marker pen | Marks on the skin | Smooth oval lump; measurements; probe path planned `[35]` |
| 5 | Skin cleaned; sterile drape on | Clean skin and a sterile drape keep germs out. | 3-4 | BR + Son: gowned and gloved; clean and drape | L: holds the drape / R: antiseptic sponge | Breast cleaned; drape; probe in a sterile cover | - |
| 6 | Time Out: patient, side, plan | A short pause before the first needle, in the style of the WHO check. | 1 | BR states the plan; Son confirms the consent and side `[3][4]` | - | Awake | - |
| 7 | Numbing medicine around the lump | Local anaesthetic (1 % lidocaine, 10 mL in one series) numbs the skin and the lump area. | 2-3 | BR: injects under ultrasound `[35]` | L: ultrasound probe / R: syringe | Breast numb | Needle as a bright line near the lump |
| 8 | Small nick in the skin | A tiny nick lets the probe pass. | 0.5-1 | BR: nick with a scalpel (CP: a nick is used in ICE3 `[31]`; not stated for fibroadenoma) | L: ultrasound probe / R: scalpel | Small nick | - |
| 9 | Probe guided into the lump under ultrasound | Live ultrasound keeps the probe in the middle of the lump. | 1-3 | BR: advances a 3.4 mm (10 G) or 2.4 mm (13 G) probe `[35]` | L: ultrasound probe / R: cryoprobe | Probe in the lump | Bright probe line entering the lump |
| 10 | Saline injected if the lump is near the skin | Saline lifts the skin away from the cold ice ball when the lump is about 1 cm or less from the skin. | 1-3 | BR: injects 10-50 mL saline; Son: passes syringes `[35]` | L: ultrasound probe / R: syringe | A saline layer lifts the skin (when needed) | Dark fluid layer between skin and lump |
| 11 | Freeze programme chosen for the lump size | The times are set from the size, number and depth of the lump. | 1 | Son: touch screen; BR confirms `[35]` | - | - | Console: e.g. 8-8-8 minutes (examples 8-8-8, 8-6-6, 4-4-4) `[35]` |
| 12 | Freeze 1: the ice ball grows over the lump | The ice ball must cover the whole lump. | 4-8 | BR: starts the freeze, watches the ultrasound; Son: watches the timer `[35]` | L: ultrasound probe / R: holds the probe | Patient lies still | Bright edge and shadow growing over the lump |
| 13 | Ice ball checked on ultrasound | The doctor checks the lump is fully inside the ice ball. | 1 | BR: looks and measures `[35]` | L: ultrasound probe / R: calipers | - | Lump fully inside the ice ball (the aim, no numeric target `[35]`) |
| 14 | Thaw: the ice melts on its own | The thaw before the second freeze makes the treatment more thorough. | 4-8 | BR + Son wait `[35]` | - | - | Shadow fades |
| 15 | Freeze 2: the ice ball grows again | The second freeze finishes the job. | 4-8 | As step 12 | - | - | Ice grows again |
| 16 | Probe moved to cover a larger lump | A larger lump needs the probe moved so the ice covers every part. | 2-6 | BR: repositions the probe under ultrasound; repeat the freeze (a probe can be moved up to three times) `[35][36]` | L: ultrasound probe / R: cryoprobe | Only for a lump bigger than one ice ball (24 % of lumps needed more than one cycle) `[35]` | Probe at a new spot in the lump |
| 17 | Probe out | A gentle withdrawal after the thaw. | 1 | BR: draws the probe out | L: steadies the skin / R: draws the probe | Small nick at the entry | - |
| 18 | Pressure and a small dressing | A few minutes of pressure and a small dressing protect the nick. | 2-3 | Son: presses with gauze, dressing; BR checks the skin | L: holds the gauze / R: dressing | Small dressing; cold pack common (not in the papers read, CP) | Ultrasound shows the treated lump |
| 19 | Sign Out and aftercare talk | The team confirms what was done and explains what to expect and the follow-up scans. | 1-2 | BR + Son: speak with the patient `[3][4][35]` | - | Sitting up | - |
| 20 | Rest, then walk out | The patient goes home the same day and may return to normal activity. | 5-10 | Son: walks with the patient to the door `[35]` | - | Dressed, walks out | Console off |

**Watch compression (seconds per step).** 1: 20, 2: 20, 3: 15, 4: 50, 5: 25, 6: 18, 7: 30, 8: 20, 9: 60, 10: 30, 11: 15, 12: 65, 13: 25, 14: 55, 15: 65, 16: 30, 17: 20, 18: 25, 19: 25, 20: 25. Total: 638 s. Highlights: the probe in (9), the saline (10), the freeze (12), the ice ball on the screen (13) and the repositioning (16).

**Details that make it realistic.**
- **Lesion size and probes:** 7-80 mm (mean 25 mm); 3.4 mm (10 G) probe in 90 % of procedures, 2.4 mm (13 G) in 10 % `[35]`.
- **Freeze-thaw-freeze:** 8-8-8, 8-6-6 or 4-4-4 minutes in the example cycles; the choice is the doctor's, from size, number and position; the ice ball is judged by eye on ultrasound rather than measured to a set size `[35]`.
- **Relocation:** the probe is moved between cycles when the ice ball does not cover the lump, 1-5 relocations in the series, and also for several lumps; the maker says up to three per procedure `[35][36]`.
- **Skin protection:** saline 10-50 mL when the lump is about 1 cm or less from the skin; one skin burn in the series, treated with warming pads `[35]`.
- **Outcomes:** volume reduction 80.6 % at about six months and 92.9 % at one year; complete treatment in 97.6 % `[35]`.
- **Older evidence:** with an argon system (Visica, 2.4-2.7 mm probe), double freeze-thaw cycles set by lump size, lumps up to 4 cm, most cases in an office with local anaesthetic only `[39]` (search excerpts only; see Sources).

## 13. Sources

Numbered as cited in the text. "Read in full" means the page or paper text was read; "excerpt" means only a search excerpt or abstract was available. Titles are given as published, so some keep US spellings; the copy for the app should use UK spelling.

1. Intuitive. *da Vinci Xi system brochure.* Intuitive Surgical, no date. Laser cross-hairs, guided set-up, targeting button, Firefly (bile duct use as an add-on only), scope on any arm, Integrated Table Motion, Vessel Sealer Extend, Force Bipolar. Read in full (text layer). https://www.intuitive.com/en-us/-/media/ISI/Intuitive/Pdf/da-vinci-xi-system-brochure.pdf
2. Intuitive. *da Vinci Xi clinical specialty guide: lobectomy* (PN 1042555 rev A, 12/2017). The Xi set-up sequence ("Deploy for docking", select anatomy and cart side, drive the cart to the endoscope port, target, manual arm adjustments); 6-10 cm port spacing; 12 or 15 mm assistant port. Thoracic, used here for the generic set-up only. Read in full. https://www.intuitive.com/en-us/-/media/ISI/Intuitive/Pdf/lobectomy-da-vinci-Xi-procedure-guide-thoracic-1042555.pdf
3. World Health Organization. *Implementation manual: WHO surgical safety checklist (first edition), Safe surgery saves lives.* WHO, 2009. Publication page read; the three-pause structure. https://www.who.int/publications/i/item/9789241598590
4. NHS (Salisbury). *WHO Surgical Safety Checklist, version 7 (May 2022).* An NHS adaptation of the WHO checklist; Sign In, Time Out and Sign Out items as printed. Read in full. https://mg.salisbury.nhs.uk/media/3068/who-surgical-safety-checklist-version-7-may-2022a.pdf
5. SAGES. *Safe Cholecystectomy Program.* Society of American Gastrointestinal and Endoscopic Surgeons. The Critical View of Safety (three criteria) and six suggested strategies. Read in full. https://www.sages.org/safe-cholecystectomy-program/
6. Gantschnigg A, Koch OO, Singhartinger F, Tschann P, Hitzl W, Emmanuel K, Presl J. Short-term outcomes and costs analysis of robotic-assisted versus laparoscopic cholecystectomy: a retrospective single-centre analysis. *Langenbecks Arch Surg* 2023;408:299. https://pmc.ncbi.nlm.nih.gov/articles/PMC10409838/
7. Jung MJ, et al. Single-site robotic cholecystectomy: reverse-port technique. *Medicine (Baltimore)* 2015;94(42):e1871. Single-site, not multiport; used for positioning, gas pressure, dye timing and closure. https://pmc.ncbi.nlm.nih.gov/articles/PMC4620793/
8. Corzo MP, et al. Feasibility of robotic cholecystectomy at an academic center with a young robotic surgery program: a retrospective cohort study with umbrella review. *J Robot Surg* 2024;18(1):93. https://pmc.ncbi.nlm.nih.gov/articles/PMC10899271/
9. Potharazu AV, et al. Indocyanine green (ICG) fluorescence in robotic hepatobiliary surgery: a systematic review. *Int J Med Robot* 2023;19(1):e2485. (Doses and timings: 2.5 mg 30-45 minutes before surgery in most series.) https://pmc.ncbi.nlm.nih.gov/articles/PMC10078519/
10. Bratila P, Manta A, Paun A, Bratila E. Robotically assisted hysterectomy. In: *Hysterectomy Matters.* IntechOpen, 2023. DOI 10.5772/intechopen.112144. https://www.intechopen.com/chapters/87791
11. Lampé R, Margitai N, Török P, Lukács L, Orosz M. A stepwise anatomy-based protocol for total laparoscopic hysterectomy: educational tool with broad clinical utility. *Diagnostics (Basel)* 2025;15(14):1736. Conventional laparoscopy; used for the order of the dissection and the cuff. https://pmc.ncbi.nlm.nih.gov/articles/PMC12293941/
12. Kawamura S, Ota K, et al. Identifying key predictors for uterine manipulator use in robotic simple hysterectomy: a retrospective cohort analysis. *Front Med (Lausanne)* 2024;11:1462632. Xi ports and arm assignments. https://pmc.ncbi.nlm.nih.gov/articles/PMC11422147/
13. Oujjat L, Rothmund R, Aghayev E, Tsaousidis C, Mueller M. Robotic-assisted surgery in benign gynecology: single-center experience with 106 patients. *Front Med (Lausanne)* 2025;12:1677721. https://pmc.ncbi.nlm.nih.gov/articles/PMC12695731/
14. Valdivieso RF, Hueber P-A, Zorn KC. Robot assisted radical prostatectomy: how I do it. Part I: patient preparation and positioning. *Can J Urol* 2013;20(5):6957-6961. Read in full (text layer). https://mail.canjurol.com/html/free-articles/V20I5_17F_DrValdivieso.pdf
15. Valdivieso RF, Hueber P-A, Zorn KC. Robot assisted radical prostatectomy: how I do it. Part II: surgical technique. *Can J Urol* 2013;20(6):7073-7078. Read in full (text layer). https://canjurol.com/html/free-articles/V20I6_16F_DrValdivieso.pdf
16. Hawlina S, et al. Robot-assisted radical prostatectomy as the institutional standard: transition and outcomes at a European centre (da Vinci Xi, transperitoneal, 520 patients). *J Clin Med* 2026. https://pmc.ncbi.nlm.nih.gov/articles/PMC13301688/
17. Carlucci JR, Nabizada-Pace F, Samadi DB. Robot-assisted laparoscopic radical prostatectomy: technique and outcomes of 700 cases. *Int J Biomed Sci* 2009;5(3):201-208. https://pmc.ncbi.nlm.nih.gov/articles/PMC3614793/
18. Francavilla S, et al. Radical prostatectomy technique in the robotic evolution: from da Vinci standard to single port, a single surgeon pathway. *J Robot Surg* 2022;16(1):21-27. (Xi median operative time 270.5 minutes.) https://pmc.ncbi.nlm.nih.gov/articles/PMC8863749/
19. Callstrom MR, et al. Multicenter study of metastatic lung tumors targeted by interventional cryoablation evaluation (SOLSTICE). *J Thorac Oncol* 2020 (epub 7 March 2020); Boston Scientific publication summary (PI-821304-AA), read in full: https://www.bostonscientific.com/content/dam/bostonscientific/pi/ablation-solutions/pdfs/publication-summary-lung.pdf ; registry entry: https://clinicaltrials.gov/study/NCT01957787
20. Fotiadis N, Kc S, Farooq S, Basso J, Cunningham D, Koh D-M, Goldberg SN, Johnston EW. Robot-assisted CT-guided cryoablation of pulmonary metastases: an IDEAL stage 2a prospective development study. *Eur Radiol* 2026. DOI 10.1007/s00330-026-12335-8. https://pmc.ncbi.nlm.nih.gov/articles/PMC13282352/
21. Johnston EW, et al. Starting CT-guided robotic interventional oncology at a UK centre. *Br J Radiol* 2022;95(1134):20220217. https://pmc.ncbi.nlm.nih.gov/articles/PMC10996412/
22. Evaluation of a new CT-guided robotic system for percutaneous needle insertion for thermal ablation of liver tumors: a prospective pilot study (Epione). *Cardiovasc Intervent Radiol* 2022;45(11):1701-1709. https://pmc.ncbi.nlm.nih.gov/articles/PMC9626422/
23. Robotics in interventional oncology: the next frontier in image-guided interventions. *Endovascular Today*, October 2023. https://evtoday.com/articles/2023-oct/robotics-in-interventional-oncology-the-next-frontier-in-image-guided-interventions
24. Stacul F, Sachs C, Giudici F, et al. Cryoablation of renal tumors: long-term follow-up from a multicenter experience. *Abdom Radiol (NY)* 2021;46(9):4476-4488. https://pmc.ncbi.nlm.nih.gov/articles/PMC8346457/
25. Park BK, Shen SH, Fujimori M, Wang Y. Thermal ablation for renal cell carcinoma: expert consensus from the Asian Conference on Tumor Ablation. *Korean J Radiol* 2021;22(9):1490-1496. https://pmc.ncbi.nlm.nih.gov/articles/PMC8390817/
26. Image-guided renal cryoablation (UK centre feature). *Urology News* (UK), undated. Read in full. https://www.urologynews.uk.com/features/features/post/image-guided-renal-cryoablation
27. Hu J, Chen S, Wang X, Lin N, Yang J, Wu S. Image-guided percutaneous microwave ablation versus cryoablation for hepatocellular carcinoma in high-risk locations: intermediate-term results. *Cancer Manag Res* 2019;11:9801-9811. https://pmc.ncbi.nlm.nih.gov/articles/PMC6873974/
28. Yang Y, et al. Outcomes of ultrasound-guided percutaneous argon-helium cryoablation of hepatocellular carcinoma. *J Hepatobiliary Pancreat Sci* 2012;19(6). https://pmc.ncbi.nlm.nih.gov/articles/PMC3501181/
29. Boston Scientific. *Visual-ICE cryoablation system* (product page). Channels, needle ports, needle gauges and lengths, sensors, CX needles. https://www.bostonscientific.com/en-US/products/cryoablation/visual-ice.html
30. Orsi F, Hamiddin AS, Sattin C, et al. Liquid nitrogen-based cryoablation: complication rates for lung, bone and soft tissue tumours. *Br J Radiol* 2024;97(1163). DOI 10.1093/bjr/tqae171. https://pmc.ncbi.nlm.nih.gov/articles/PMC11491613/
31. Fine RE, et al. Cryoablation without excision for early-stage breast cancer: ICE3 trial 5-year follow-up on ipsilateral breast tumor recurrence. *Ann Surg Oncol* 2024;31:7273-7283. https://pmc.ncbi.nlm.nih.gov/articles/PMC11452421/
32. US Food and Drug Administration. *De Novo classification order DEN220077, ProSense Cryoablation System* (order dated 3 October 2025; letter corrected 20 March 2026). Read in full (text layer). https://www.accessdata.fda.gov/cdrh_docs/pdf22/DEN220077.pdf
33. US Food and Drug Administration. *Discussion questions for the General and Plastic Surgery Devices Advisory Panel, 7 November 2024: ProSense, ICE3 data.* Read in full (text layer). https://www.fda.gov/media/183318/download
34. Fine RE, et al. Cryoablation without excision for low-risk early-stage breast cancer: 3-year interim analysis of ipsilateral breast tumor recurrence in the ICE3 trial. *Ann Surg Oncol* 2021;28(10):5525-5534. DOI 10.1245/s10434-021-10501-4. Abstract only (search excerpt). https://doi.org/10.1245/s10434-021-10501-4
35. Filipov T, Teutsch B, Vass D, Budinszki B, Hegyi P, Doros A, Forrai G, Deák PA. Cryoablation for fibroadenoma with liquid nitrogen based system: a retrospective analysis of prospectively collected data. *PLoS One* 2026;21(1):e0340969. https://pmc.ncbi.nlm.nih.gov/articles/PMC12829868/
36. IceCure Medical. Press release on the PLOS One fibroadenoma study (March 2026; states FDA clearance for fibroadenomas): https://ir.icecure-medical.com/sec-filings/all-sec-filings/content/0001213900-26-022018/ea027750201ex99-1_icecure.htm ; and the ProSense procedure page (probe relocation up to three times): https://www.icecure-medical.com/?p=10484 . Company sources.
37. Mokbel K, et al. The evolving role of cryosurgery in breast cancer management: a comprehensive review. *Cancers (Basel)* 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC10486449/
38. Xing Y, et al. Cryoablation in the treatment of early breast cancer: a comprehensive analysis. *Front Oncol* 2025. (ICE3 at -170 °C, ice ball 35-40 mm, stab incision.) https://pmc.ncbi.nlm.nih.gov/articles/PMC12130041/
39. FDA 510(k) K061510 (Sanarus Visica, fibroadenoma ablation). Summary via search excerpts only. https://510k.innolitics.com/device/K061510
40. This repository: `docs/R2-SURGERY.md`, `docs/R3-ENDOSCOPE.md`, `docs/R4-CRYO-SUITE.md`, `docs/research/cryoablation.md`, `src/sim/config.ts` (`surgery`, `cryoSuite`), `src/sim/places.ts` (`SURGERY`, `CRYO_SUITE`), `src/sim/types.ts` (`CasePhase`, `CRYO_STEPS`).
41. American Academy of Orthopaedic Surgeons, OrthoInfo. *Surgical safety checklist* (patient-facing summary of the Sign In, Time Out and Sign Out items). Read in full. https://www.orthoinfo.org/treatment/surgical-safety-checklist/

## 14. Notes for the simulation

### 14.1 What to film up close, and what the 3D scene must respect

**1. Robotic cholecystectomy**
- **Highlights:** breathing tube (6); the 8 mm ports going in (11); the cart driving in on the laser guide and docking (13-14); the green dye glow (16); the Critical View of Safety pause (19); clips (20); the bag (23).
- **Scene facts:**
  - The BA stays on the **patient's left** from the ports to the end `[7]`; the cart docks from the **patient's right**.
  - Table tilt (head up, right side up) is set before docking and not changed after.
  - The surgeon leaves the table for the console after the instruments go in (15) and comes back at undocking (25).
  - One **instrument exchange** is shown at 21 (hook to scissors).
  - The specimen leaves through the navel port site at 26.

**2. Robotic total hysterectomy**
- **Highlights:** legs into stirrups (7); the manipulator going in (10); steep head-down tilt (14); docking (15-16); the cut round the cervix (22); the uterus delivered **vaginally by the BA at the foot** (23); the stitching (24).
- **Scene facts:**
  - The BA needs two positions: **between the legs** (steps 8-10, 20, 22-23) and the patient's left at the 12 mm port (the rest).
  - The cart is side-docked (varies: between the legs).
  - Tilt and leg position are fixed before docking.

**3. Robotic radical prostatectomy**
- **Highlights:** the positioner and boots (6); six ports (10); docking (12-13); the vein-bundle stitch (17); the clipped side supports (21); the bag (23); the join of bladder to urethra (25).
- **Scene facts:**
  - The BA stays on the **patient's left**; the fourth arm is on the patient's right.
  - Low lithotomy with arms tucked, 20-25° head-down before docking.
  - Specimen leaves through the lengthened navel port site; the catheter stays in.
  - Patients go to the ward (the sim sets 0 % home).

**4-6. CT cryoablation (kidney, lung, liver)**
- **Highlights:** the robot arm turning the guide onto the path (kidney 9, lung 12, liver 11); **the doctor pushing the needle by hand** (kidney 12, lung 14, liver 13); the scanner table sliding into the bore; the ice ball growing on the scan; the timer; needles out one at a time.
- **Scene facts:**
  - The robot never aims while the table is in the bore.
  - **Staff leave the scan room for each scan** (IR, SN and anaesthetist stand behind the shield; Rad is in the control room).
  - Sterile prep and drapes come before the planning scan, and the robot docks to its floor plate during the prep.
  - Lung and liver: an **anaesthetist at the head**, a **held breath** at planning, insertion and check scans; lung: tube, **prone with arms up**, a turn with 4-5 people.
  - Kidney: sedation by the nurse, left side up.
  - Lung needs **three freezes** (3-3-10-5-10, then an active thaw); kidney and liver need two (10-8-10 or 10-15 / 8-10 / 10-15, then an active thaw).

**7-8. ProSense (breast cancer and fibroadenoma)**
- **Highlights:** the probe going in along the lump under ultrasound; the saline layer; the ice ball growing on the ultrasound screen (bright arc, dark shadow); the two ice-ball measurements (35 mm and 40 mm in cancer); the freeze timer; the probe coming out.
- **Scene facts:**
  - **No sedation and no robot:** one doctor, the BR, holds the ultrasound probe in one hand and the cryoprobe in the other; the Son runs the console and the saline.
  - The room is the ultrasound room (`imaging:us`); the patient walks in and walks out.
  - Breast cancer: two freezes of 9 min with an 8 min thaw; fibroadenoma: shorter, doctor-chosen times, one cycle in most cases.

### 14.2 Step phases for the sim

**Theatre procedures** (`CasePhase`) by step number:

| Phase | 1 Chole | 2 Hyst | 3 Prost |
|---|---|---|---|
| `in` | 1-2 | 1-2 | 1-2 |
| `induction` | 3-6 | 3-6 | 3-5 |
| `positioning` | 7-9 (+ 12 tilt) | 7-11 (+ 14 tilt) | 6-8 (+ 11 tilt) |
| `ports` | 10-11 | 12-13 | 9-10 |
| `docking` | 13-15 | 15-17 | 12-14 |
| `console` | 16-24 | 18-25 | 15-27 |
| `undocking` | 25 | 26 | 28 |
| `closing` | 26-27 | 27-28 | 29-30 |
| `emergence` | 28 | 29 | 31 |
| `out` | 29 | 30 | 32 |

**Cryo procedures** (`CryoStep`, proposed additions marked new):

| `CryoStep` | 4 Kidney | 5 Lung | 6 Liver |
|---|---|---|---|
| `arrive` | 1-2 | 1-2 | 1-2 |
| `sedation` | 3-5 | 3-7 | 3-6 |
| prep and robot docks (new: `prep`) | 6 | 8 | 7 |
| `planningCt` | 7 | 9 | 8 |
| `planning` | 8 | 10 | 9 |
| `aim` (each needle) | 9, 11-12 | 12-14 | 11-13 |
| `checkCt` (each needle) | 13 | 15 | 14 |
| fluid for bowel (new: `hydro`) | 14 | - | 15 |
| `freeze1` | 15 | 16 (3 min) | 16 |
| `thaw` | 16 | 17 | 17 |
| `freeze2` | 17 | 18 | 18 |
| second thaw (new: `thaw2`) | - | 19 | - |
| third freeze (new: `freeze3`) | - | 20 | - |
| `activeThaw` | 18 | 21 | 19 |
| `needlesOut` | 19 | 22 | 20 |
| `finalCt` | 20 | 23 | 21 |
| `dressing` | 21 | 24 | 22 |
| `out` | 22-23 | 25-27 | 23-25 |

**ProSense:** a new, short device script (`DeviceRun` style, as planned in `docs/research/cryoablation.md`) with the steps in the two tables; no lift trip, the patient walks in.

### 14.3 New roles and places this needs

- **Anaesthetist in the cryo suite** (lung and liver, and kidney if general anaesthesia is chosen): a new `CRYO_STAFF` entry (for example `cryo-anaes`) or a loan of `or-anaes` for those cases; a spot at the head of the CT table outside the bore, with a ventilator or jet-ventilator cart and a monitor.
- **Breast radiologist (BR) and sonographer or assistant (Son):** two new staff in the ultrasound room, plus a ProSense console spot beside the couch (a 0.45 × 0.6 × 1.1 m cart, `docs/research/cryoablation.md`) and a sterile tray.
- **Prone positioning for the CT table** (lung, sometimes liver or kidney): a `pose` for lying face down with arms above the head, and a vacuum mattress prop.
- **A held-breath state** (an apnoea marker) shown on the monitor and on the anaesthetist.
- **Change requests for the orchestrator** (contract files): add `prep`, `hydro`, `thaw2` and `freeze3` to `CRYO_STEPS`; add per-procedure freeze protocols to `CONFIG.cryoSuite`; a procedure type (kidney, lung, liver) in the case view so the copy and the protocols can differ.

### 14.4 Where the sources disagree with the sim (`src/sim/config.ts` and the docs)

1. **Cholecystectomy times.** Config: room 60-90 min, console 15-30 min. Sources: skin to skin 60 ± 15 min (three robot ports plus an assistant port, Xi) `[6]`, 101-151 min (3-4 ports) `[8]`, console 50 min in a single-site series `[7]`. Built-up room time 77-150 min; console 22-55 min. The 15.1-minute console figure behind the config is at the fast end.
2. **Prostatectomy times.** Config: room 120-180 min, console 95-130 min. Sources: median skin to skin 178 min (n = 520) `[16]`, 124 min (n = 700, high volume) `[17]`, 270 min on the Xi `[18]`. Room time is skin to skin plus 40-60 min, so 140-270 min (about 3.5-4.5 hours typical). The room band is at the fast end and does not match the comment above it in `config.ts` (console 180-198 min, operative 222-295 min).
3. **Hysterectomy.** Config console 75-110 min vs published 52 ± 23 min (mixed benign robotic) `[13]` and skin to skin 125-148 min `[12]`: inside the range; no change needed.
4. **Cryo thaw time.** Config thaw 5-6 min. The sources read use **8-10 minutes** (10-8-10 `[26][27]`; 10-15 / 8-10 `[25]`); active thaw 3-4 min is plausible.
5. **Lung freeze protocol.** "3-3-10-10-10" is not what SOLSTICE or the Royal Marsden series report: SOLSTICE 3 / 3 / 7-12 / 5 / 7-12 then active thaw `[19]`; Royal Marsden 3 / 3-4 / 7 / 3-5 / 10 then passive thaw `[20]`. Closest simple script: **3-3-10-5-10 plus an active thaw.**
6. **Robot accuracy wording.** Config `aimErrorMm` 0.6-1.8 mm is the guide alignment (the makers' 1-2 mm). Reported tip errors after hand insertion are larger: 6.1 mm median (middle half 2.9-9.7) in robot-guided lung cryoablation `[20]`; 11 mm path and 20 mm tip in early MAXIO ablations `[21]`. The caption should say "guide aligned", not "needle placed within 2 mm".
7. **Order in the cryo room.** R4 runs sedation, then planning CT. In the reported workflows, skin prep and draping come **before** the planning scan and the robot docks to its floor plate during that prep `[20][21]`.
8. **Sedation and anaesthesia.** The sim's nurse-led moderate sedation matches 69 % of treatments in an Italian kidney series `[24]`; the UK kidney centre and the robot-guided lung and liver series read here use general anaesthesia `[20][21][22][26]`. Lung and liver need an anaesthetist.
9. **ICE3 recurrence figure.** `docs/research/cryoablation.md` quotes 3.1 % at five years. That is IceCure's figure for patients on endocrine therapy; the peer-reviewed paper gives **4.3 %** (all 194, 95 % CI 2.1-8.7 %) and 3.7 % (endocrine alone) `[31]`, and the FDA's own analysis gives 6.2 % for the same 194 and 2.3 % for the 120 who fit the indication `[33]`. The FDA indication is **70 or older**; the ICE3 population was 60 or older.
10. **ProSense time.** `cryoablation.md` says about 30-45 minutes; ICE3 reports 20-40 minutes in total `[31]` (the default 9-8-9 cycle alone is 26 min).
11. **The ice pack.** An ice or cold pack after ProSense is not described in the ICE3 paper or the fibroadenoma paper (only warming pads for a skin burn); keep it as an optional, unsourced touch `[31][35]`.
12. **Insufflation pressure.** The sim shows 12 mmHg. Sources give 12-15 mmHg (cholecystectomy, hysterectomy) `[7][10]`, 15 mmHg for a conventional laparoscope `[11]`, 8 mmHg with an AirSeal system for prostatectomy `[16]`, and 20 mmHg briefly in one prostatectomy centre `[14]`: 12 sits inside the range.

### 14.5 Where the sources are thin

- **Liver cryoablation with a robot:** no published robot-guided cryoablation of the liver was found; the workflow is taken from robot-guided microwave ablation (Epione pilot, MAXIO) `[21][22]` and the freeze protocols from two argon series `[27][28]`. The position (prone or supine) and the deep-sedation choice are not reported (CP).
- **Cholecystectomy:** Xi multiport technique papers with arm-by-arm instruments were not found in open text; port and instrument details come from a single-centre series `[6]`, a single-site paper `[7]` and a retrospective cohort `[8]`; the Critical View of Safety and Firefly rules are well sourced `[1][5][9]`.
- **ProSense breast cancer:** the FDA indication and the ICE3 protocol are strong `[31][32][33]`; the room layout, positions and the dressing are not described anywhere read (CP).
- **Kidney robot-guided cryoablation:** only the robot workflow `[20][21][22]` and non-robot kidney protocols `[24][25][26]` were found; no paper reports both together.
- **Hysterectomy arm-by-arm instruments** come from one Japanese Xi series `[12]` and an overview chapter `[10]` that disagree slightly on arm numbering; the sim's numbering (scope on Arm 2) is used.
