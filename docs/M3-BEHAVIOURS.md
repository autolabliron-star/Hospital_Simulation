# M3 behaviours brief: people who move and think

This is the spec for the behaviours builder. It goes with `docs/PLAN.md` and the living-3d-world skill (`SKILL.md` layer 2, `references/hospital.md` §2–§7). The goal is a hospital that feels alive from the first second of the demo: about 100 people at the busy hour, every one of them doing something believable. The medicine story (doctors' rounds, nurses giving from the MedDrawer) stays exactly as it is and simply gains company.

## Population at the busy hour (about 10:00–11:00 sim time)
| Who | Count | Notes |
|---|---|---|
| Ward inpatients (in bed) | 16 | already exist |
| Ward staff | 10 | already exist: 2 doctors, 4 nurses, 2 pharmacists, 2 coordinators |
| ER and support staff | 14 | from `src/content/staff.ts`: receptionist, 2 triage nurses, 2 ER doctors, 2 ER nurses, 3 porters, 2 cleaners, 2 paramedics (present only during an ambulance arrival) |
| ER patients in the pathway | 12–20 | walk-ins plus ambulance arrivals |
| Companions of ER patients | 4–8 | sit beside "their" patient, leave with them |
| Visitors | 20–30 | to ward patients, the café and the lounges |
| Ambient seated people | top-up | fill waiting seats, café and benches to about 90 % when busy |

The sim starts at 07:30. Visitors start arriving from 07:45, ramp up to the busy hour and taper off after 12:00. The arrival curve per hour lives in config.

## The ER patient pathway (an xstate v5 machine per patient)
Stages are `PatientStage` in `src/sim/types.ts`. Every transition emits a `SimEvent` (the new types are already in the contract) with one plain sentence. Use `subjectId` = patient id and `actorId` = the staff member.

```
arriving (fade in at ARRIVALS.entrance)
  → checkIn: join the queue at a kiosk (70 %) or the reception desk (30 %), 20–40 s
  → waitingTriage: sit on a free lobby waiting seat
  → triage: a triage nurse calls them to a free triage bay; 60–120 s; acuity from the reason (people.json)
  → waitingDoctor: back to a waiting seat; ordered by acuity, then arrival
  → inBay: an ER nurse walks them to a free ER bay, where they lie on the trolley (erBay seat);
           an ER doctor examines for 90–180 s
      → tests (30 %): a porter takes them by wheelchair to Lab & imaging (blood-draw chair), 60–90 s, and back;
                      then "results back" 2–4 min later, waiting in the bay
  → decision: discharged home (about 70 %: walk out with a happy emote) or admitted (about 30 %: a porter takes
              them by stretcher to the nearest lift, and they fade out "to the ward upstairs")
  → gone
```
- **Ambulance arrivals** (one every 12–20 min): two paramedics push a stretcher with the patient lying on it from `ARRIVALS.ambulance` straight to a free ER bay. They skip check-in and triage; acuity comes from `ambulanceReasons`. A short handover talk with the ER nurse follows, then the paramedics leave by the ambulance door. A priority 1 or 2 arrival takes the next bay before anyone waiting (preemption).
- **Left without being seen:** a waiting patient whose wait passes their patience leaves with a sad emote and a `leftWithoutBeingSeen` event. Patience is lower for low-urgency patients: acuity 4–5 wait about 25–40 min, acuity 3 about 45 min, acuity 1–2 never leave. With normal tuning this should be rare, about 1 in 20.
- **Companions:** about 35 % of walk-ins bring someone. The companion sits next to them while waiting, stands at the bay entrance, and leaves with them.

## Resources and their lifecycles
- **ER bays** (6) go free → occupied → needsCleaning → free. A cleaner with a cart cleans the bay for 40–60 s, and a `bayCleaned` event follows. A bay that needs cleaning cannot be given to a patient.
- **Triage bays** (4) go free → occupied → free.
- **Seats** come from the seat registry (`src/sim/seats.ts`) and are never double-booked. Approach the seat's `approach` spot, then snap onto the seat with pose `sit` or `lie`.
- **Porter jobs** sit in a FIFO queue, with admissions first: `toDiagnostics`, `fromDiagnostics`, `admit`.
  - The porter walks to the pickup point.
  - The patient becomes the rider: `vehicle` wheelchair or stretcher, `riding: true`, posed on the vehicle about 0.8 m ahead of the porter along their heading.
  - The porter pushes (`anim: 'push'`, `vehicle` set).
  - At the destination the rider gets off: seated, lying or faded out.
  - The porter returns to the porter base next to the lobby spine.
  - Idle porters sometimes push a linen cart from the clean supply room to a ward corridor and back.
- **Cleaners:** bay-cleaning jobs come first. Otherwise they make a slow patrol loop (lobby → spine → both corridors → atrium) with a cleaning cart, stopping to mop (`anim: 'clean'`) for 10–20 s at a few spots. They never stop inside a robot crossing zone.

## Visitors
- They arrive at the entrance, some in pairs (a pair walks side by side), about 40 % carrying flowers or a bag (`prop`).
- Each visits a specific ward patient: the visitor chair if it is free, otherwise standing by the window or seated in that wing's lounge.
  - 10–30 min with talk gestures, plus a patient emote, `heart`, now and then.
- About 40 % then go to the café: a café chair with a coffee (`prop: 'coffee'`) for 5–15 min. Then they leave by the entrance.
- Events: "Ana Ruiz arrived to visit Grace Adeyemi in A1." and "… left after a 25 min visit."

## Staff life
- Ward doctors, nurses and pharmacists keep their current behaviour exactly; the medicine tests must still pass. Add coffee breaks only when they are idle, with low probability and short duration.
- Receptionist: at the desk, `anim: 'tablet'` or `'talk'` when serving the queue head.
- Triage nurses: work at their bays; when free, call the next patient: walk out to them and walk them in.
- ER doctors: take the highest-priority patient whose bay is ready, stand at the bay for the exam, then chart (tablet) briefly.
- ER nurses: escort patients to bays and do the handover with paramedics.
- Coordinators: seated, as now.

## Feel and readability rules
- People fade in where they arrive and fade out where they leave (`fade` 0 → 1 over about 0.6 s). Nobody pops.
- No idle standing inside robot crossing zones or doorways. Wait outside them (skill pitfall).
- Use few, readable states (skill: discrete states read better). Emotes: hourglass while waiting, question at check-in, pill or check after the doctor, heart for visitors, happy when discharged.
- At the busy hour the lobby waiting seats are about 90 % full, the café about 70 %, and every ward wing has a few visitors.

## Event sentences (plain, kind, specific)
- "Maya Cohen arrived at the ER: twisted ankle playing football."
- "Maya Cohen checked in at the kiosk."
- "Nurse Ava triaged Maya Cohen: priority 4."
- "Dr. Mendes is seeing Maya Cohen in ER bay 2."
- "Porter Sam is taking Maya Cohen to Lab & imaging."
- "Maya Cohen's results are back."
- "Maya Cohen was discharged home after 48 min."
- "Leo Park was admitted to a ward upstairs."
- "Ambulance arrival: Rosa Díaz, fall at home, hip pain."
- "ER bay 3 is clean and ready."

## Determinism and tests
- **Determinism:** all randomness through `src/sim/rng.ts` forks. The same seed gives an identical event log.
- **Required tests (node):**
  - Over a simulated 07:30–12:30, every ER patient reaches a terminal state (discharged, admitted or left without being seen).
  - No bay sits in needsCleaning for more than 5 min. No seat is ever claimed twice.
  - Lobby waiting-seat occupancy is ≥ 80 % at 10:30. The population at 10:30 is between 80 and 130.
  - No person stands still for more than 2 s inside a crossing zone or a doorway.
  - Every porter job completes, and riders are always within 1.2 m in front of their pusher.
  - The event log is deterministic.
  - Sim step cost ≤ 0.6 ms with the full population (print it).
  - **All existing tests stay green**, especially `src/sim/Simulation.test.ts` and `src/sim/meds/*`: the medicine story must not change.
