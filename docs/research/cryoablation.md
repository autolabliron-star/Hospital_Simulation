# Freezing cancer: cryoablation research and a plan for The Ideal Hospital

Research date: 2026-10-25. Companion to `docs/research/new-devices.md` (the laser device, Visualase, is item 1 there).

## 0. Summary

**Laser and freezing are two different machines.** A laser device (Visualase, already planned for the east annex) kills a tumour with
**heat**. The machine that kills a tumour by **freezing** it is a **cryoablation** system: a thin needle (cryoprobe) is pushed into the
tumour under ultrasound or CT, an extremely cold gas or liquid flows inside the needle tip, and an **ice ball** grows around it and
swallows the tumour. The frozen cells die; the body clears them over the following months. No cut, no stitches, often local anaesthetic only.

**Recommended for the hospital: IceCure ProSense** (Israel), liquid-nitrogen cryoablation.
- FDA marketing authorization in October 2025 for early-stage, low-risk breast cancer in women 70+ (with endocrine therapy). It is the
  first device the FDA has authorized for treating breast cancer itself, not just removing tissue.
- Office-based, ultrasound-guided, about 30-45 minutes, home the same day.
- It fits a room we already have: the **ultrasound room in imaging**, with its live ultrasound screen. No new building needed.

## 1. How cryoablation works (what the demo should show)

1. The patient lies on a couch; local anaesthetic.
2. The doctor guides a thin cryoprobe into the tumour, watching the needle on **ultrasound** (or CT for deep organs).
3. Freeze: the console sends the cryogen into the probe tip (liquid nitrogen in ProSense, about -170 C at the probe; argon gas in
   Boston Scientific's Visual-ICE). An ice ball grows round the tip, larger than the tumour, to leave a safety margin.
4. On ultrasound the ice ball shows as a **bright curved edge with a black shadow behind it**, growing outwards. The doctor watches it
   stays away from the skin and muscle; saline may be injected to push the skin away ("hydrodissection").
5. Thaw, then usually a second freeze: freeze-thaw-freeze kills more cells than one freeze.
6. Probe out, a small dressing, home the same day.

## 2. The real systems

| System | Company | Cold source | Guidance | Approved for | Notes |
|---|---|---|---|---|---|
| **ProSense** | IceCure Medical (Israel) | Liquid nitrogen | Ultrasound or CT | **FDA 2025: early low-risk breast cancer, women 70+, with endocrine therapy.** Also kidney and other tumours in several regions; China NMPA approval (Sept 2026) | Office-based; ICE3 trial: 5-year local recurrence 3.1 % in HR+/HER2- patients; FDA asked for a ~400-patient post-market study |
| **Visual-ICE** | Boston Scientific (US) | Argon gas to freeze, helium or an internal heater to thaw | CT, ultrasound or MRI (an MRI version exists) | FDA-cleared for prostate, kidney, liver metastases, bone metastasis pain, skin lesions, and more | A larger console: up to 10 channels / 20 needles at once for big tumours, 4 multi-point temperature sensors |
| Multimodal freeze-then-heat system | Shanghai Magic Medical (China) | Liquid nitrogen freeze, then radio-frequency heating of the same zone | CT | NMPA approval 2023 (China) | The "freeze to -180 C, then heat" reports from Pakistani hospitals describe this kind of system; the "patients are cancer-free" claims are political statements, not trial results |

**Honest limits:** cryoablation is for **small, early tumours** (the ProSense breast indication is 1.5 cm or less in most reports). It
does not cure cancer in general, and ProSense's breast authorization is for a narrow group (70+, low-risk, with hormone therapy).

## 3. Plan: where it goes and what the visitor sees

**Option A (recommended, quick win): ProSense in the existing ultrasound room** (`imaging:us`, src/scene/rooms, the live ultrasound
painter `src/scene/imaging/images/usPaint.ts`).
- **Model (Blender kit, brand-free):** a slim console on castors (about 0.45 x 0.6 x 1.1 m) with a touch screen, a liquid-nitrogen dewar
  inside, a hose to a pen-like cryoprobe holder; baked into the imaging zone, the probe a small live node.
- **Sim:** a `DeviceRun` script `cryo` (the generic engine planned in new-devices.md section 3): meet, change, lie on the couch, local
  anaesthetic (a `wait`), probe placement, **freeze 1** (`active`, rising `progress`), thaw, **freeze 2**, dressing, home. Durations
  compressed and seeded.
- **Screen:** extend the ultrasound painter with an ice ball: a bright arc growing with `progress`, a dark acoustic shadow behind it,
  the tumour (a dark oval) swallowed with a margin, a timer and a probe-temperature readout (-170 C). The console tablet shows the same
  freeze/thaw/freeze timeline. Redraw at 2 Hz or less (4 Hz only while it is the focused imaging screen, per CLAUDE.md).
- **Card ("Meet the device"):** what it does in one line, "FDA authorized 2025 for early breast cancer in women 70+", and that it is
  shown with a synthetic patient. Real product named on the card only, as with the other devices; the model stays brand-free.
- **Budget:** about 4-6 draw calls (mostly baked), under 15 k triangles, reuses the existing ultrasound canvas.

**Option B (later): Visual-ICE in the CT room or the annex**, CT-guided with several needles (kidney, liver, lung). The CT scanner and
its live images already exist; the screen would show a CT slice with needles and a dark-grey ice ball. Bigger work (multi-needle
placement, CT slice painter changes).

**Together with the laser:** the annex's "destroy tumours without surgery" story then shows heat (Visualase), sound (Edison
histotripsy, Exablate) and cold (cryoablation) side by side.

## 4. Open questions for the owner
- Did "laser ... freeze it" mean the laser device (Visualase, heat) or the freezing device (cryoablation)? They are different
  machines; both can be in the hospital.
- Option A in the current ultrasound room first, or wait for the annex?
- Breast cancer (ProSense's FDA story) or kidney (a more general demo, and the ultrasound room already shows a kidney)?

## Sources
- [FDA authorizes IceCure's ProSense cryoablation for early-stage breast cancer (Endovascular Today)](https://evtoday.com/news/fda-authorizes-icecures-prosense-cryoablation-for-early-stage-breast-cancer)
- [IceCure FDA marketing authorization announcement (Barchart)](https://www.barchart.com/story/news/35220838/icecure-medical-s-prosense-cryoablation-granted-fda-marketing-authorization-for-treatment-of-low-risk-breast-cancer-in-women-aged-70-and-above-significant-development-in-giving-women-with-breast-cancer-minimally-invasive-care)
- [AZFamily: FDA approval coverage](https://www.azfamily.com/2025/10/29/life-changing-minimally-invasive-breast-cancer-treatment-gets-fda-approval/?outputType=amp)
- [IceCure ProSense procedure page](https://www.icecure-medical.com/?p=10484) and [interventionalnews.com](https://interventionalnews.com/icecure-medical-receives-us-fda-approval-for-prosense-cryoablation-system/)
- [IceCure March 2026 filing (post-market study, Health Canada)](https://ir.icecure-medical.com/sec-filings/all-sec-filings/content/0001213900-26-028699/ea028191601ex99-1.htm)
- [ProSense approved in China (Endovascular Today)](https://evtoday.com/news/icecures-prosense-cryoablation-system-approved-in-china)
- [Boston Scientific Visual-ICE](https://bostonscientific.com/en-US/products/cryoablation/visual-ice.html) and [FDA K230551 summary](https://fda.innolitics.com/device/K230551)
- [NMPA notice: multimodal tumour treatment system (2023)](https://english.nmpa.gov.cn/2023-06/09/c_940347.htm)
- [Punjab cryoablation centre (Pakistan Observer)](https://pakobserver.net/first-outcome-of-cm-maryams-china-visit-as-punjab-launches-breakthrough-cancer-treatment/) and [Holy Family Hospital (ProPakistani)](https://propakistani.pk/2026/09/26/holy-family-hospital-starts-advanced-free-cancer-treatment/)
- [CBN: Israeli company destroys tumours by freezing them](https://www2.cbn.com/news/news/israeli-company-destroys-cancerous-tumors-freezing-them)

## 5. Option C (chosen 2026-10-26): the robot-guided CT cryoablation suite on level 2

The owner asked for the freezing machine that is "really big and accurate and does not depend on the hand movement". That is a
**robot-guided, CT-guided cryoablation suite**. In this setup, a robot aims the needles instead of the doctor's freehand skill:

1. **CT scanner.** It takes the planning scan and the check scans.
2. **Planning workstation.** The radiologist draws up to six needle paths on the CT slices.
3. **Needle-guidance robot.** It is a heavy cart (MAXIO by Perfint: 250 kg, about 131 x 78 x 85 cm, four castors) docked to a floor
   plate that calibrates it to the CT. Epione by Quantum Surgical is a floor-mounted arm of the same class. Its 5-axis arm turns a needle
   guide onto each planned path, and the doctor pushes the needle through the guide.
   - Accuracy reported by the makers: about 1-2 mm at the tip. XACT ACE reports 1.7 mm at first insertion.
4. **Cryo console.** A large argon console (Visual-ICE class) runs up to 20 needles at once, with temperature sensors. Several needles
   make one big ice ball for a 3-5 cm kidney, lung or liver tumour.

Evidence (honest status):
- **Royal Marsden, European Radiology, 2026.** Robot-assisted CT-guided cryoablation of lung metastases: 26 patients, 37 tumours.
  - 35 of 37 tumours were finished with no switch to freehand.
  - One major complication: a pneumothorax that needed drainage.
  - This is an early-stage, single-centre study.
- **Tianjin, China (NCT06581107).** A CT-guided robot for lung cryoablation, in a feasibility trial.
- **Regulatory status.** Epione is FDA-cleared for abdominal tumour ablation (2022-2023), and XACT ACE for CT-guided insertion of
  ablation probes (2022). Robot plus cryoablation remains an emerging combination, so the card says so.
- **MRI-guided alternative.** Liverpool Hospital, Australia (2026) has the country's first MRI-guided cryoablation. It is not built
  here.

**Placement:**
- The family lounge on level 2 is split in two. The lounge keeps the north half; the south half (9 x 12 m) becomes the suite: a CT scan
  room plus a control room, next to Recovery (PACU).
- The patient comes from level-2 pre-op and recovers in the PACU.
- The model stays brand-free. Real products are named on the "Meet the device" card only.

Sources:
- [Robot-assisted CT-guided cryoablation of pulmonary metastases (BIDMC summary of the IDEAL 2a study)](https://research.bidmc.org/oscar/publications/robot-assisted-ct-guided-cryoablation-pulmonary-metastases-ideal-stage-2a-prospective)
  and [Medscape](https://www.medscape.com/viewarticle/robot-assisted-ct-guided-cryoablation-shows-high-precision-2026a10004bm)
- [Starting CT-guided robotic interventional oncology at a UK centre (MAXIO, Royal Marsden)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10996412/)
- [CT-guided interventional robot in lung cryoablation (NCT06581107)](https://clinicaltrials.gov/study/NCT06581107)
- [Epione FDA clearance for abdominal cancers (Quantum Surgical)](https://www.quantumsurgical.com/news/fda-clears-quantum-surgicals-epione-robot-for-all-abdominal-cancers)
- [XACT ACE expanded clearance for ablation (The Robot Report)](https://www.therobotreport.com/fda-clearance-expands-indications-for-xact-robotics-ablation-system/)
- [Robotics in interventional oncology (Endovascular Today)](https://evtoday.com/articles/2023-oct/robotics-in-interventional-oncology-the-next-frontier-in-image-guided-interventions)
- [Australia's first MRI-guided cryoablation (Next Science, from ABC)](https://x.com/NextScience/status/2063698245713383769)
