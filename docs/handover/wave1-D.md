# Wave 1 agent D (durations + crowd) report

**Done**
- Imaging: src/sim/imaging/exam.ts (CT arterial->portal gap from imaging.ctPhaseGapSeconds, `isPhaseGap`), outpatient.ts + department.ts (age on outpatients, utilisation window to 17:00 doc); config imaging.utilisationHours -> [7.75, 17.0], visitors.visitSeconds 15-40 min.
- Outpatients: src/content/outpatients.json 40 -> 64 (24 afternoon slots 13:30-16:45, all 4 modalities, spacing rules kept); src/content/imaging.ts outpatient schema (length 64, window to 17:00); outpatients.test.ts updated.
- Admissions: admissions.json (weakness profile: stroke workup, no apixaban; admitChance 0 on cut finger, sprain, prescription review, cold, sunburn), schema.ts optional `admitChance`, admissions.ts `admitChanceFor(reason)`, admissions.test.ts.
- Age: src/sim/population/age.ts (`ageWalkFactor`, `drawVisitorAge`), applied to visitors, ambient people, imaging outpatients. age.test.ts.
- Post-op: src/sim/surgery/case.ts day cases leave the lounge in a wheelchair pushed by the companion, lift A down, wheeled to the entrance; recovery->lounge walk at half pace; fallback to slow walk. postop.test.ts.
- Crowd: nav/crowd.ts vehicle footprint (discs owned by the pusher; pusher looks ahead from them), walker.ts `setFootprint`, er/actor.ts `setVehicle` passes VEHICLE_HALF/VEHICLE_AHEAD. nav/vehicleFootprint.test.ts.
- schedule.ts comment; schedule.test.ts updated to the new tables (visitors from 11:00, ambulance 40-70 min, ER ~80 a day).
- Tests added: imaging/day.test.ts (CT gap 35-45, real report minutes, afternoon outpatients, determinism).

Gates: tsc clean; opening.integration, warmStart, imaging/*, nav/*, age, postop, vehicleFootprint, content tests pass. surgery.test.ts: 25/26 passed, the one failure was agent W's in-progress day/shifts.ts (makeRun reading `post` of undefined).
Change requests: E applies ageWalkFactor (import from population/age) to ER patients and `admitChanceFor(reason)` (content/admissions.ts; 0 = never admit) before the acuity table; day/roster.ts `visitingOpen` still starts at 7.5 (changing it to 11 would send the S1 opening's early visitor parties home at once: keep, or convert them to overnight companions); `imaging.ts` outpatient schema edited by D (count 64, window 17:00); `content/schema.ts` got optional `admitChance`.
