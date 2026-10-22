# Wave 1 W (wards) report

**Done**
- Medicines: `src/content/medicines.json` (+`dose`: hours or prn), `schema.ts` (DoseSchema, hours must be CONFIG.doseWaves.hours), `catalogue.ts` (doseHoursOf, isPrn, minDoseGapSeconds).
- `src/sim/meds/system.ts`: sim/schedule orders skip items pending or dosed inside the dosing interval (refuse if none left); presenter and discharge untouched; presenter orders jump the verify queue; `pendingFor()`.
- `src/sim/day/doseWaves.ts`: only medicines due at the hour, split by maxItems; 08:00 wave goes out at 07:30.
- `src/sim/people.ts`: new Doctor (one morning round 08:30-11:00, nurse at bedside, signs planned discharges, changeChance orders, afternoon/night review of new admissions, on-call doctor, `visits` log, warmStart mid-round) and Nurse (attends rounds, interruptible admission check 25-40 min, safety huddle 07:33, night looks 22:30/00:30/02:30/04:30, `nightLooks` log, retiring/atRest).
- Shifts: `day/roster.ts` (PostKind wardNurse/wardDoctor, partners, nightRounds from `day.nightCheckFirstHour`), `day/kits.ts`, `day/shifts.ts` (ward staff in registry, hub huddle + bedside handover per room, settle 1500 s), `staff.ts` (doc-A/B shift 'day'), `day.json` captions + huddleTopics (schema, day.ts), `Simulation.ts` (doctor warmStart), `beds/bedBook.ts` SIGN_LEAD 3600, `beds/discharge.machine.ts` FORCE 7200, `beds/invariants.ts` (or-* exempt).
- Config added: `day.nightCheckFirstHour: 22.5`.
- Tests: new `day/wardDay.test.ts` (whole day + night + determinism); updated doseWaves, roster, shifts, system, content, staff, bedBook, flow.morning/afternoon/warm tests.
- Surgery "identical day in two Simulations" crash (kit missing for new PostKind in an intermediate state) is gone: passes.

**How to verify**
`npx vitest run --maxWorkers=2 src/sim/day src/sim/beds src/sim/meds src/sim/Simulation.test.ts src/content` ; `npx tsc --noEmit`.

**Change requests**
- `src/sim/opening/script.ts` (+script.test.ts): the 08:00 wave now gives every room an open order at t0, so `writeWardOrders` writes none; drop it or write only for rooms without an order, and fix the two script tests.
- types.ts: optional `dose` on `Medicine` (read via catalogue helpers today).

**Open questions / risks**
- Remaining failures are ER agent's: population.integration (ER durations/tests), not mine.
- Pharmacists/hosts still 24 h at their posts. Theatre porter stands in l2Or/l2Sterile doorways 2.5-4 s (exempted in beds invariants).
- Family now arrives 30-90 min after signature, so doctors sign 1 h before planned leave.
