# S1 · Showcase: a hospital already at work, and going forward in time

The presenter opens the hospital in front of people. Two things got in the way:

- At 07:30 most machines and rooms were empty. The first patients arrived over the next 35 minutes, and the OR's first case only at 08:00.
- A da Vinci case meant waiting about 90 real minutes.

## The opening (07:30)

The app opens in **showcase** mode. `?opening=quiet` gives the R2 day, which is also what `new Simulation(seed)` builds in tests.

**How it works:** `buildSimulation` passes `opening: 'showcase'` and `inFlight: true`. The services place work already under way, logging nothing (`World.quiet`). A 50 s hidden pre-roll (`CONFIG.opening.preRollSeconds`) then carries everyone mid-task, so the clock still reads 07:30 when the hospital fades in.

| Where | What you see | Placed by |
|---|---|---|
| OR (Level 2) | A hysterectomy at the console, 8–14 min in: robot docked, surgeon at the console | `planDay(…, 'showcase')` (src/sim/surgery/plan.ts) |
| PACU | An early cholecystectomy recovering (15–25 min left), then the lounge | the same plan |
| Pre-op | The next patient in a bay from 07:18 (stage `settled` until the team is free) | the same plan |
| Sterile supply | The theatre porter working the racks between stretcher runs | `team.ts`, `SURGERY.sterile.spots` |
| MRI, CT, X-ray, ultrasound | A patient on each table mid-sequence; the ultrasound on "Right kidney" | `Scanner.warmBegin`, `ImagingDepartment.warmInFlight` |
| Imaging hall | The next outpatient waiting | `ImagingDepartment.warmInFlight` |
| Triage | 2 bays with a nurse and a patient | `warmErInFlight` (WARM_TRIAGE) |
| ER | 2 bays with a patient on the trolley (doctor arriving), 2 waiting for a doctor | `warmErInFlight` (WARM_BAY, WARM_DOCTOR) |
| Health kiosks | Both mid-measure (cuff, finger clip) | `VitalsService.warmInFlight` |
| Draw centre | All three robots at the needle or filling | `DrawCentre.warmInFlight`, `RobotStation.warmBegin` |
| Lab | 5 tubes: centrifuges spinning, an analyser busy, a review under way | `Lab.warmInFlight` |
| Pharmacy core and rail | Two ward orders per ward: MedVend picking, a pod on the rail | `OpeningScript` (src/sim/opening/script.ts) |
| Wards and lounges | Visitors at bedsides, plus one party in each wing lounge (loungeA, quietB) | `Director.seedOpening` |
| Doctors' office | Dr. Okafor at the desk for the first few minutes | `Doctor.holdAtBase` |
| Clean supply | A porter loading a linen cart | `Porter.warmLinenRun` |

Every Jump and every long Skip uses the same in-flight warm, so they land on a working hospital too. Only corridors and lifts can be empty (`src/sim/opening.integration.test.ts`).

## Going forward in time

| Control | What it does |
|---|---|
| `+15 min`, `+1 h` (TitleCard), `]` | Skip ahead |
| Context chip ("Skip to undocking · 10:12"), `Shift+]` | In or looking at Level 2: the next of docking, console, undocking, wheels-out, PACU discharge, next wheels-in, landing 20 s before. In a scanner room: the end of the scan |
| `1 2 4 0 3` | 1×, 2×, 4×, **10×**, **30×** |

How a skip runs:

- **Short (≤ 180 s, `CONFIG.skip.liveMaxSeconds`):** `advanceBy` runs the same hospital headless. Everything carries on: the same people, your order, your selection.
- **Longer:** `skipRebuild` is a forward Jump that lands on the target time. Surgery follows its seeded plan, so the same case and patient continue a milestone further on. The other departments are re-warmed with work under way.
- **The time-lapse:** a 700 ms veil over the running scene, with the clock hands turning (CSS, so they keep turning while the rebuild blocks) and the sky running to the new hour (`scene/daylight/lapse.ts`). Then a 450 ms fade back in. You stay where you are, in the mode you were in.
- **Limits:** skips stop at the end of the day (23:30) and wait out a lift ride.

Fast speeds:

- **Steps per frame:** `SimLoop` runs up to `max(40, ceil(speed × 2.2))` steps a frame within a 6 ms budget, then drops leftover time (no snowball). A step costs about 40 µs, so 30× is about 2.6 ms a frame.
- **Crowd:** gait speed is measured in sim units, so people walk rather than run at 30×. Their legs cycle up to 4× faster, so feet slide a little.
- **Robots and machines:** their smoothing follows the sim speed (`scene/timeScale.ts` `visualDt`). The camera, speech bubbles, emotes and the CT gantry spin stay on real time.

## How to check

```bash
npx vitest run src/sim/opening.integration.test.ts src/ui/skip.integration.test.ts src/sim/opening src/sim/surgery/plan.showcase.test.ts --maxWorkers=2
```

In the browser: open muted (`localStorage['ideal-hospital.muted'] = '1'`) with `?present=1&probe=1`, press Enter, and every room is at work. `]` skips 15 min. In the OR, `Shift+]` skips to the next milestone.
