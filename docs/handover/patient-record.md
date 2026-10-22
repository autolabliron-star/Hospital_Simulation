# Patient record on the bedside tablet

The owner asked for "a function on the tablet next to the patient" that shows what doctors and nurses need to know about the
patient's whole stay, plus important history (allergies, past procedures). It is now a **Record** tab on the prescribing tablet,
next to **Prescribe**. It is built like an EHR summary (Epic or Cerner "Storyboard" plus "Summary").

## How to open it
- **Walk mode:** go to a bedside, press **E** (the tablet opens), then click **Record**. The tablet remembers the tab you used
  last, so walking from bed to bed with E keeps you on Record.
- **Overview:** press **P** (or click the Prescribe pill), click **Record**, and pick a room in the Room list.
- **Esc** or **P** closes the tablet as before. There are no new hotkeys. The section and filter buttons are ordinary buttons
  (Tab, Enter), and each one gives focus back after a click, so Space still pauses.
- **Demo path for the allergy check:** open room **A2** (Bruno Varga, pinned penicillin allergy). The banner shows a red
  ALLERGIES badge. On Prescribe, Amoxicillin carries an "Allergy" tag. Tick it and Send: a red "Allergy alert: pharmacist query"
  card appears, the order is held, and nothing is dispensed until you click Confirm or Cancel.

## What it shows
- **Banner:** synthetic name, age and sex, a synthetic MRN (`SYN-123-4567`), room and ward, day of stay, admission date and
  time, team and doctor, code status, isolation, weight and height (from the vitals profile), and an ALLERGIES badge (or "No
  known drug allergies").
- **Summary:** alerts (allergies with reaction and severity, an open pharmacist query, falls risk, anticoagulant, isolation,
  DNACPR); the latest observations with a sparkline and trend arrow for each sign, plus a NEWS2 badge marked "Display only"
  (marked partial when RR or ACVPU was not recorded); active problems; current medicines with the next dose (due now, next
  hh:mm, held, or as needed with the last dose); pending results; and today's plan (planned discharge, discharge signed,
  ward round expected).
- **This stay:** a timeline, newest first, with filter chips (All, Meds, Obs, Results, Imaging, Notes, Movements).
  - **Arrival:** route and triage category.
  - **Care:** ER doctor, tests and results, imaging with a report summary, and the decision to admit.
  - **Ward:** the move to the ward, the operation (to theatre, operation note, back on the ward), and medicines charted.
  - **Medicines:** pharmacist medicines reconciliation, and a MAR-like trail (prescribed, pharmacist query, due, given by
    whom, cancelled).
  - **Routine:** ward rounds and reviews, observation rounds with values and NEWS2, and handovers.
- **History:** allergies and intolerances, past medical history with the year of diagnosis, past procedures with the year,
  home medicines (marked "on the ward chart" or "not on the ward chart: for review"), social history (smoking, alcohol,
  home, mobility), and immunisations.

## How it works
- **`src/content/patientHistory.json` and `patientHistory.ts`** (zod, cross-checked against the medicines catalogue and the
  allergy classes) hold all the content:
  - allergens with their reactions;
  - conditions, each with the catalogue medicines that treat it;
  - chronic medicine → condition rules;
  - procedures, each with a sex and an age window;
  - social history, immunisations, code status, isolation and falls wording;
  - **stay templates** keyed by words in the reason for the stay. There are 28, and the last one is the fallback. Each has
    the route, triage, tests and summaries, working diagnosis, operation, problems, plan, round note, pending items and the
    observation deviation on admission;
  - all UI copy.
- **`src/content/pharmacistQueries.json`:** new `allergy` section with the query sentence and the class mapping (penicillin:
  amoxicillin, NSAID: ibuprofen, statin: atorvastatin). `findAllergyConflicts()` is in `pharmacistQueries.ts`.
- **`src/sim/records/history.ts`:** `patientHistory(subject)` is a pure function of the patient (id, name, age, reason,
  ward chart). It uses an `Rng` seeded by `hashString(id|name)` and never `Math.random`.
  - About 22 % of patients get at least one allergy. A2 and B7 have pinned allergies.
  - No patient is allergic to a medicine they are charted on.
  - A chronic chart medicine brings its condition (for example apixaban gives AF).
  - COPD always has a smoking history, and random asthma is never added for a patient on a beta-blocker.
  - Procedures fit the patient's sex and age, are in the past, and never repeat this stay's operation.
  - Pack-years are bounded by age.
- **`src/sim/records/record.ts`:** a read-only adapter. `recordForRoom(sim, roomId)` and `buildRecord(sim, subjectById(...))`
  read:
  - the bed board, orders and pharmacist queries;
  - lab orders and results (values outside the usual range are listed for display only);
  - imaging reports and bookings, and kiosk and triage readings;
  - the doctors' visits (`Doctor.visits`), surgery cases and imaging outpatients;
  - the event log through `chartIndex.ts`, which tails the log per patient, per room and for handovers, because the log keeps
    only 2000 events.

  What the sim does not model is drawn deterministically: the days before the sim started, and the ward observation rounds
  at 06:00, 14:00 and 22:00. Patient types covered: catalogue inpatients (pre-sim days), warm-start readmissions, live ER
  admissions (their real ER story), ER patients, surgery cases and outpatients.
- **`src/sim/records/obs.ts`:** NEWS2 (RCP 2017, scale 1; display only) and the synthetic observation sets.
- **`src/sim/meds/system.ts`:** `queryReasons` now calls `allergiesOf()` for the patient in the bed. It reads their ward
  record through `Occupancy.recordOf`, which now also carries the patient's age, or falls back to the catalogue. Allergy
  reasons are listed first. The order is held by the existing F-25 hold.
- **`src/ui/rx/record/recordView.ts`:** the view model. It is plain strings with no DOM, so it can be drawn on a VR panel
  later. **`RecordPanel.tsx`** renders it; **`record.css`** styles it with the tablet's own tokens, and the tablet widens to
  452 px on the Record tab.
- **`src/ui/rx/PrescribePanel.tsx`:** the tabs, the allergy tags in the medicine list, and the allergy query card. Query
  cards show on both tabs.
- **`src/ui/walk/rx.store.ts`:** `tab` and `setTab`; `openFor(roomId, tab?)`.
- **Polling:** the record is built only while the Record tab is on screen, through `usePoll` at 4 Hz. Nothing runs per frame.

## Verify
```
npx tsc --noEmit
/private/tmp/claude-501/hospital-vitest.sh src/sim/records/ src/ui/rx/ src/content/patientHistory.test.ts src/content/pharmacistQueries.test.ts src/sim/meds/ src/ui/walk/hud.render.test.ts
```
- `history.test.ts`: determinism, allergy rate, chart coherence, procedures fit sex and age, no `Math.random`.
- `record.test.ts`: two twin sims run 09:30 to 12:30. Building records about 400 times leaves the sim byte-identical. The
  same seed gives the same records. Every patient type gets a valid record, and the A2 amoxicillin allergy query is held.
- `allergy.test.ts`: the query is held, a cancelled order is never dispensed, and a confirmed order goes on.
- `recordView.test.ts`: react-dom/server markup, allergies visible, NKDA, sections, filters, the tablet tab.

## Change requests (files I may not edit)
1. **`src/sim/world.store.ts`:** tail the log at the 4 Hz publish, so the record never misses a long-past ER story while the
   tablet is closed. Without it, the index catches up only when the tablet is opened, and the 2000-event log may already
   have dropped the morning's ER events. The record then says "Some earlier events are no longer in memory".
   ```ts
   import { noteEvents } from './records/chartIndex'
   // first line inside publishWorld(sim, loop):
   noteEvents(sim.log)
   ```
2. **`src/scene/interact` (bedside prompt):** the prompt still reads "E · Prescribe for {name}". Suggest "E · Tablet for
   {name}", or leave it as is, since the tablet still opens on the tab you used last.
3. **`src/content/ukVocabulary.test.ts` (F-33, another agent):** patientHistory.json no longer says "tummy" (it now says
   "abdominal pain"), so the `KNOWN` exemption for `patientHistory.json` there can be removed.
4. **Presentation mode (C):** `Hud` keeps the whole HUD hidden while presenting, so the tablet cannot be seen there by design
   (`hotkeys.ts` blocks P). If the owner wants the record during the walkthrough, `hudIsHidden` and the P-key rule need an
   exception for the open tablet. That is the orchestrator's call.

## For clinician review
- The stay templates (diagnoses, test summaries, plans, round notes): each line is a conservative, plain-English demo
  sentence. Items marked "for clinician review" include:
  - echo findings, the ECG in hypertension, and the DEXA result;
  - the CT head for collapse, stroke, confusion and headache;
  - troponin, blood gas and tryptase;
  - the urine culture.
- The allergy classes are kept simple: penicillin → amoxicillin; NSAID → ibuprofen; statin intolerance → atorvastatin.
  Cephalosporin cross-reactivity is not modelled because the catalogue has no cephalosporin.
- Code status: DNACPR is drawn for about 40 % of patients aged 85 or more, and labelled "documented; for clinician review".
  This is the most sensitive synthetic item. It is easy to turn off by setting `codeStatus.dnacprChance` to 0.
- Isolation: about 4 % "Contact precautions (MRSA carrier)".
- Random background conditions never bring an anticoagulant, a beta-blocker or a diuretic. Asthma is never added at random
  to a patient on bisoprolol.
- On an emergency surgical stay, the stay's medicines start on arrival on the ward. On a planned operation they start
  after it.
- NEWS2 is computed for display only. Kiosk and triage readings have no RR or ACVPU, so their score is shown as partial
  ("2+").

## Open questions and risks
- The pre-sim story is drawn, not replayed. A Jump to another hour keeps the same admission times, which are independent of
  the start hour. On a warm start, today's ward round is drawn if it fell before the start and the sim has no visit for that
  day, so the round time can differ by a few minutes from the sim's own warm-start bookkeeping.
- Medicines added on today's round are left out of the earlier days' dose rounds. Only `source: 'sim'` orders count, and
  catalogue patients keep their content chart.
- Day-to-day ward round notes reuse the template's sentence, so a long stay reads repetitively.
- `profileFor` (src/sim/vitals/model.ts, being edited by WP-4) is called with `{ age, variant }` and its own Rng for weight,
  height and the observation baseline. If its signature changes, `record.ts` needs a one-line update.
- The record does not yet show a patient who is still in the ER, because the tablet lists ward rooms only.
  `subjectById()` and `buildRecord()` already support ER, surgery and outpatient patients for a future panel, for example
  in the ER bay.
