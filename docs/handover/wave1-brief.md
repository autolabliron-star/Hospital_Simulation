# Wave 1 "A real clinical day": shared brief for the three agents (W wards, E emergency, D durations+crowd)

Repo: /Users/lironhagbi/3D Hospital. Read CLAUDE.md (rules), then the approved plan ~/.claude/plans/the-target-of-the-agile-nautilus.md
(Part A2 = the behaviour audit with file:line evidence; Part B Wave 1 = the goals). The living-3d-world skill
(~/.claude/skills/living-3d-world, SKILL.md + references/hospital.md) describes the house patterns.

## The point
Doctors will watch this hospital. Today it runs on demo timings (22 s ward rounds, 90 s ER exams, medicine every 11 minutes). Wave 1 makes
it run on REAL clinical durations and logic. Pace for demos comes from the existing skip ahead / 10x / 30x and the S1 showcase opening,
not from fake timings. Everything stays synthetic (no real patients, no clinical decisions on real data): this is choreography that LOOKS
like correct practice.

## The config contract (src/sim/config.ts; already written by the orchestrator, re-read it before use)
New or changed: `people.round` (morning round 08:30-11:00, 6-10 min a bed, afternoon review, changeChance), `people.ageWalkFactor`,
`er.*` (arrivals sized to 6 bays, ambulance every 40-70 min, triage 3-7 min, exam 10-20 min, `reviewSeconds`, `bayCareSeconds`, admit by
acuity 1.0/0.95/0.45/0.1/0.03, clean 5-10 min, handover 2-4 min), `visitors.partiesPerHour` and `day.visitorPartiesPerHour` (from 11:00),
`day.erArrivalsPerHour`, `imaging.reportSeconds` (real), `imaging.ctPhaseGapSeconds`, `beds.familyArrivesSeconds`, `beds.roomCleanSeconds`,
`beds.admissionCheckSeconds`, `doseWaves.hours` = 08/12/14/18/22.
You may tune numbers ONLY inside your own config sections (listed in your prompt), with small Edit calls after re-reading the file (three
agents share it). Any other config change: put it under "Change requests" in your report.

## Rules
- Own only the files your prompt lists. Never edit another agent's files; never touch src/scene/** unless your prompt says so.
- Seeded determinism (no Math.random under src/sim; use src/sim/rng.ts). No allocations added inside useFrame (you should not need scene code).
- Copy in src/content/*.json with zod schemas. Synthetic names only.
- Tests: update every test your change breaks so it asserts the NEW intended behaviour (never just delete an assertion); add the new tests
  your prompt asks for. Run only your own and directly affected tests: `npx vitest run --maxWorkers=2 <paths>`. Typecheck with
  `npx tsc --noEmit`. Do not run the whole suite (the orchestrator does, it takes ~30 min). Never start servers or browsers.
- Integration tests shared by everyone (src/sim/population.integration.test.ts, src/sim/opening.integration.test.ts,
  src/ui/skip.integration.test.ts, src/sim/warmStart.test.ts, src/sim/Simulation.test.ts): RUN the ones you could affect; fix them only if
  your prompt gives you that file; otherwise report the failure and why under "Open questions" (the orchestrator integrates).
- Keep the S1 showcase opening alive: at 07:30 (and after a Jump/skip warm start) every non-passage room still has somebody at work
  (src/sim/opening.integration.test.ts). With real durations that means placing work mid-way, not starting it.
- Final report (CLAUDE.md format): Done (files), How to verify (commands), Change requests, Open questions / risks. Put a short copy of your
  report in this notes folder as wave1-<letter>.md.
