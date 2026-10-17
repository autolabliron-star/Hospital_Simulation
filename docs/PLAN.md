# Plan: "The Ideal Hospital", a living 3D simulation

## Context
You want a 3D simulation of the ideal hospital to show on your Mac. The hero idea is that **medicines come to the patient**:
1. The doctor prescribes.
2. A robot box (a "MedPod") docks at a giant vending-machine-style dispensing wall, and the wall loads exactly those medicines into the box.
3. The pod drives itself to the patient's room and puts the medicines into a bedside drawer, where they can be taken.
4. The nurse never has to work out which medicine goes to which person.

It must look high-end and **never stutter during a live demo**.

**The skill is already installed.** `~/.claude/skills/living-3d-world` exists, is byte-identical to `/Users/lironhagbi/Waltz Game/skills/living-3d-world`, and is in this session's skill list. Nothing needs to be done.

The build follows that skill. Its architecture is proven in Waltz City: ~150–360 people at ~10 ms/frame on a MacBook. Its `references/hospital.md` already maps the hospital roles, patient pathway, queues and KPIs. The full reference code is at `/Users/lironhagbi/Waltz Game` (570 files: React Three Fiber, yuka, xstate, zustand).

The project lives in the empty folder **`/Users/lironhagbi/3D Hospital`**. It is fully separate from MedPilot, and no MedPilot files are touched.

**Defaults I chose (change any of them when you review):**
- Runs in the web browser (the skill's stack).
- Premium "architect's model" look.
- One large floor, roof off, so you see everything at once.
- Demo = guided "follow the medicine" tour plus live prescribing by you.
- English UI.

---

## 1. What the hospital looks like

**Look and feel.** It looks like an architect's presentation model of a future hospital: white, light oak and frosted glass, soft mint/teal accents, rounded corners, soft daylight. The roof is off and the camera looks in at 50°, Sims-style, with walls at room height and the façade nearest the camera cut away. People are clean, stylized figures whose scrub colours show their role. The robots are white with glowing light rings:
- teal = carrying medicine
- amber = waiting
- green = delivered

**Floor plan (one floor, ~105 m × 56 m, north at the top):**
```
 ┌────────────┬─────────────────────────────────────────────────────────────────┐
 │            │ WARD A: 8 smart single rooms, big windows to the outside        │
 │  ENTRANCE  │ [A1][A2][A3][A4]   [ Nurse hub A ]   [A5][A6][A7][A8]           │
 │  & LOBBY   │ ══ corridor: people walk in the middle · teal ROBOT LANE        │
 │ self check-│    runs along the room wall, past each room's MedDrawer ══      │
 │ in kiosks  ├───────────────┬───────────────────────────────┬─────────────────┤
 │            │ COMMAND       │  ★ PHARMACY CORE ★ (glass box) │ HEALING ATRIUM  │
 │  TRIAGE    │ CENTER        │  dispensing wall + picker arm  │ indoor garden,  │
 │  4 bays    │ live wall:    │  4 pod docks · charging bay    │ café, family    │
 │            │ every pod,    │  pharmacist verify desk        │ lounge, trees   │
 │  ER        │ room, order   │  ══ robot spine to both wards ══│ & daylight      │
 │  6 bays    ├───────────────┴───────────────────────────────┴─────────────────┤
 │            │ ══ corridor + robot lane ══                                      │
 │ ambulance  │ [B1][B2][B3][B4]   [ Nurse hub B ]   [B5][B6][B7][B8]           │
 │ bay (west) │ WARD B: 8 smart single rooms                                    │
 └────────────┴─────────────────────────────────────────────────────────────────┘
```
The Pharmacy Core sits at the physical centre of the building, a symbol that medicine is at the heart of the hospital. From the overview you can see pods leave it for every ward.

**The hero machines**

| Thing | What it looks like | What it does in the sim |
|---|---|---|
| **Dispensing wall ("MedVend")** | A 12 m × 3 m glass-fronted grid of ~72 colour-coded medicine bins, a picker carriage on an X/Y gantry and a short chute to 4 docking ports | It picks each ordered unit-dose pack in turn: the arm travels to the bin, picks, travels to the port and drops. A screen ticks each item off with a "scan ✓" |
| **MedPod (robot box)** | A ~0.6 × 0.6 × 1.0 m rounded white box with a light ring, a small face screen (room number) and a stack of 4 locked compartments | Undocks from charging, docks at the port ("connects to the machine"), seals, drives the robot lane, yields to people at crossings, opens auto-doors, docks at the room's drawer, transfers the meds and returns to charge |
| **MedDrawer** | A pass-through cabinet in the corridor wall beside each room door, with a lit status tile | Loaded from the corridor side by the pod. The room-side light turns on at dose time and opens with the patient's wristband scan. It holds **only that patient's** medicines |
| **Smart patient room** (6 × 4.5 m) | Bed facing a big window, bedside screen (synthetic name, today's plan, next dose), a ceiling contactless-vitals sensor glow, a family sofa, a bathroom pod and circadian lighting | The patient lives here; doctors round here and prescribe on a tablet; the nurse arrives at dose time and gives the meds from the drawer |
| **Command center** | A glass room with a curved live wall | It shows a live map of pods, rooms and orders, drawn from the sim at ≤2 Hz |

**The story the simulation tells ("follow the medicine", ~2–3 min):**
1. Overview: the whole hospital is alive with ~100 people and ~10 pods.
2. A doctor at the bed in room A3 taps an order on the tablet. It pops onto the command wall.
3. A pharmacist verifies it (a simulated step).
4. In the Pharmacy Core, a pod docks and the arm picks the 3 packs, which are ticked off one by one.
5. The pod drives the lane, pauses for a visitor crossing and goes through an auto-door. Time is sped up on the long drives.
6. The pod loads A3's drawer, and the tile turns teal.
7. At dose time a nurse arrives, scans the wristband and gives the meds. The event line reads: *"Nurse Maya gave 3 medicines to A3, prepared and delivered automatically."*
8. The camera pulls back with KPIs: order→drawer time, deliveries today, pods busy/charging. All are measured from the sim's event log and labelled "simulated".

**Live prescribing (your "wow" moment):** press **P**, pick a room, tick medicines from a catalogue, then press **Send**. Your order goes through the same pipeline, and the camera follows that pod.

**Medicine catalogue:** ~16 common medicines with standard unit-dose strengths, kept as a fixed demo list in JSON. All patients are synthetic, with no real people or data, and the sim makes no clinical decisions.

---

## 2. How it's built (from the living-3d-world skill)

**Stack:** the exact versions pinned in the skill's `references/architecture.md`, copied from Waltz City's `package.json`: vite 8.3.3, react 19.3.0, three 0.186.1, @react-three/fiber 9.8.1, drei 10.7.9, postprocessing 6.39.5 + n8ao 2.0.1, xstate 5.33.2, yuka 0.7.8, zustand 5.0.15, zod 4.6.5, vitest 5.0.3, typescript 5.9.3.
- **Dropped:** rapier, because there is no walking player in this demo, which keeps it lighter. Also dropped: howler.
- Install with `npm install --ignore-scripts`, then run `npm audit`.

**The five layers, applied:**
1. **World contract.** `src/sim/places.ts` holds the floor plan above: zones, doors, rooms, drawers, docks, seats and both nav graphs (people and robot lanes). Everything is derived from it: colliders, decor and the minimap.
2. **Think.** A fixed-step 60 Hz sim outside React, seeded (`?seed=42` replays the same day).
   - An xstate **patient pathway** (arrive → triage → doctor → admit to ward → stay → discharge) comes from `hospital.md`.
   - **Role controllers:** doctor (rounds, prescribes), nurse (dose rounds triggered by drawer + schedule), pharmacist, porter, cleaner and visitor.
   - The new **medication system** is in `src/sim/meds/`:
     - `orders.ts`: the order queue
     - `dispenser.ts`: the gantry FSM with timings in `config.ts`
     - `podMachine.ts`: an xstate machine per pod (charging → toDock → loading → sealed → enRoute → delivering → returning)
     - `robotLanes.ts`: a directed lane network with junction conflict tables, adapted from Waltz `scene/traffic/network.ts` + headway/yield
     - `drawers.ts`: the drawer state per room (empty → loaded → given)
3. **Move.** A* over the nav graph, yuka steering with separation, queues and seats, and auto-doors sized to the fastest mover. Pods follow lanes kinematically and yield before (never inside) crossing zones, as in skill pitfall "mutual blocks".
4. **Look.** The instanced procedural crowd from Waltz `src/scene/actors/crowd/*`, with hospital outfits: teal/blue scrubs, white coats, grey porters, purple cleaners, everyday clothes for patients and visitors. LOD uses dither crossfade, and nobody pops. Pods are an instanced procedural mesh (≤12 instances). The building is procedural geometry from a pure, node-tested room builder adapted from Waltz `scene/interiors/layout/builder.ts`, merged per room with ~20 shared materials.
5. **Read.** Emote icons (pill, tablet, hourglass, bed), ≤12 speech bubbles, a one-sentence event line, an **order rail** (Prescribed → Verified → Picking → En route → In drawer → Given) with live dots, a KPI panel, a labelled minimap, click to inspect, and double-click to follow.

**Reuse map: copy, then adapt (from the skill templates or the Waltz Game source):**

| Need | Source |
|---|---|
| Seeded RNG, frame loop + power cap, frame order, LOD, gait, maths, seat/interact registries | `~/.claude/skills/living-3d-world/assets/templates/*` |
| Sim loop, clock, replay, world store, data seam | Waltz `src/sim/{SimLoop,SimClock,Simulation,replay,world.store}.ts`, `src/sim/data/*` |
| Navigation | Waltz `src/sim/nav/{layout,graph,mover,crowd}.ts` |
| Robot lanes, headway, yielding | Waltz `src/scene/traffic/{network,path,sim,signals}.ts` (patterns) |
| Crowd renderer | Waltz `src/scene/actors/crowd/*` (with `crowd.test.ts` as the spec) |
| Room builder, live screens | Waltz `src/scene/interiors/layout/builder.ts`, `src/scene/interiors/live/*` |
| Camera rig, cinematic tour | Waltz `src/scene/camera/*`, `src/scene/tour/director.ts` ("follow the prospect" becomes "follow the medicine") |
| Quality ladder, shader warm-up, probe | Waltz `src/scene/Quality.tsx`, `render.store.ts`, `src/scene/warmup/*`, `src/app/DevProbe.tsx` |
| HUD pieces | Waltz `src/ui/{EventLine,JourneyRail,MiniMap}.tsx`, `src/scene/fx/{EmoteLayer,SpeechBubbles}.tsx` |
| Asset download gate (only if any CC0 model is ever needed) | Waltz `docs/ASSETS-POLICY.md`, `tools/fetch-assets.mjs` |

**Folder layout** (`/Users/lironhagbi/3D Hospital`):
- `src/app`: App, PowerLoop, power, DevProbe, presentation
- `src/sim`: the contract, loop, pathway, `entities/`, `nav/`, `meds/`, `data/`
- `src/content`: medicines.json, synthetic patients.json, barks.json, tour.json, zod schema
- `src/scene`: `building/`, `rooms/`, `pharmacy/`, `robots/`, `actors/crowd/`, `camera/`, `tour/`, `fx/`, `warmup/`
- `src/ui`: Hud, EventLine, OrderRail, KpiPanel, PrescribePanel, MiniMap, PresenterBar
- `tools/`: preview rasterizer, validate-content
- `docs/`: PLAN, ASSETS-POLICY, CREDITS
- `CLAUDE.md`: project rules pointing at the skill

---

## 3. "Never stutters while I present": performance plan
Target machine: your **MacBook (Apple M4, 16 GB)**, on its Retina screen and on the 1080p Samsung S22B300.
- **Budget, tighter than the skill's** to leave headroom: ≤300 draw calls, ≤1.2 M triangles and ≤12 ms per frame at the default view, shadow passes included. This is measured with `?probe=1`.
- **Cheap, good-looking light:**
  - three's built-in `RoomEnvironment` for reflections, so there is no HDRI download;
  - one sun with a **static, baked-once shadow map** for the building;
  - soft instanced **blob shadows** under people and pods, instead of real-time shadows;
  - emissive ceiling panels instead of real lights;
  - half-res n8ao and subtle bloom.
- **Everything instanced or merged.** Procedural geometry with no heavy models or textures, except one small icon atlas. Canvas screens redraw only when their content changes (≤2 Hz).
- **No hitches.** All shaders and textures are warmed up behind the loading screen (`compileAsync` + `initTexture`), and **Enter** waits for it. There are no allocations in `useFrame`, enforced by a test. Store updates are published at 4 Hz.
- **Adaptive quality ladder:** DPR 1.5 → 1.25 → 1.0, then AO lower, then AO off. It only steps down after warm-up.
- **Presentation mode (the `H` key / `?present=1`):**
  - keeps 60 fps **even on battery**, because the power template would otherwise drop to 30;
  - does **not** pause on window blur, so screen-sharing doesn't freeze it, but still pauses when the tab is hidden;
  - hides dev panels.
- **Demo launch = a production build, offline.** Run `npm run show` (build + `vite preview`). Everything is bundled locally, with no CDN, no network and no dev server.

---

## 4. Build waves (each ends with a gate: tests green + a rubric scored 1–5 on look, life, feel, interactivity, story and bugs + one play-test by you)

| Wave | Delivers | Done when |
|---|---|---|
| **M0 Setup** (haiku agent) | Scaffold in `3D Hospital/`, local `git init` (no remote), pinned deps, skill templates copied, `CLAUDE.md`, `docs/PLAN.md` (this design) | `npm run typecheck && npm test && npm run build` pass on an empty scene |
| **M1 Medicine flow, proven** | `places.ts` floor plan, both nav graphs, orders → dispenser → pods → drawers → nurse gives, with placeholder boxes and capsules and a top camera | Node tests: every order ends "given"; no pod deadlock or overlap at junctions; drawers hold only their patient's meds; same seed gives the same event log; flood-fill reachability for people and lanes |
| **M2 The building** | Procedural shell, smart rooms, Pharmacy Core with the animated dispensing wall and gantry, MedPods, MedDrawers, command center, atrium, wayfinding floor lines, materials and light | Preview-rasterizer PNGs of the rooms, core and pod look right; probe within budget |
| **M3 People who move and think** | Crowd renderer with hospital outfits; patient pathway (entrance → triage → ER → admit); doctor, nurse, pharmacist, porter, cleaner and visitor behaviours; ~100 people | Every patient reaches a terminal state in node tests; seats ~90 % filled at busy hours; nobody pops or slides |
| **M4 The show** | "Follow the medicine" tour (T), live prescribing panel (P), order rail, KPI panel, event line, live command wall, minimap, presenter keys (Space pause · 1/2/4 speed · F follow · Esc overview · H clean screen) | A scripted tour walk test passes; the 2–3 min story plays end to end |
| **M5 Smooth on your Mac** | Warm-up, quality ladder, PowerLoop, presentation mode, `npm run show` | Probe ≤ budget on your MacBook and on the external display; no visible hitch on first tour run; you sign off on the play-test |
| **M6 Stretch** (optional) | A "Before / After" toggle (a classic nurse walking to the med room vs. the ideal flow), a second floor via the robot lift, day/night, sound, a Hebrew UI | Your call |

**Who does what: simple asks go to subagents on lower models.**
- The first step after approval is to save this preference to memory, as a feedback memory, so it applies in future sessions too.
- I (Opus, main session) orchestrate. I own the contract files (`sim/types.ts`, `sim/places.ts`, `sim/config.ts`, the registries), review every agent's output and run the gates.
- Each agent gets one owned folder and a self-contained brief: files to copy, paths and acceptance tests.

| Model | Tasks (examples from this plan) |
|---|---|
| **haiku** (simple, mechanical) | M0 scaffolding: package.json with pinned versions, tsconfig/vite/vitest config, `git init`. Copying skill templates and Waltz files and fixing import paths. Writing content JSON (medicine catalogue, synthetic patients, barks, tour captions). Docs (`CLAUDE.md`, ASSETS-POLICY, CREDITS). Running `typecheck`/`test`/`build` and reporting failures. Searches in the Waltz code (Explore agent) |
| **sonnet** (moderate feature work) | Adapting Waltz modules: crowd outfits for hospital roles, nav, HUD components (EventLine, OrderRail, KpiPanel, MiniMap, PrescribePanel). Procedural room, pharmacy and pod geometry with the room builder. Role controllers, the patient pathway and their node tests |
| **opus** (me, only where it matters) | The medication-system core (pod state machine, lane network, junction and yield logic, deadlock tests). Performance tuning against the probe. Gate reviews and the final polish of the tour |

**Working rules from the skill:**
- At most 2 heavy agents or processes at once.
- vitest with `--maxWorkers=2`.
- No agent launches headless Chrome on your machine, and every server started is killed.
- Agents re-read a contract file right before using it, and ask me for contract changes instead of editing it.

---

## 5. Verification
- `npm run typecheck`, `npm test` (vitest, `--maxWorkers=2`) and `npm run build` after every wave.
- **Sim truth in node:** a determinism test (`?seed=42` gives an identical event log), order/pod/drawer end-state tests, junction headway and yield tests, reachability flood fills, and a no-allocations-in-`useFrame` grep test.
- **Visual checks without your Chrome:** the preview rasterizer renders room, core, pod and people PNGs. Brief screenshots in the app's built-in browser pane are allowed, and I close it afterwards. It can't measure frame time, because a hidden pane throttles.
- **The real test is you, once per wave:**
  - run `npm run show` and open `http://localhost:5174/?probe=1&present=1` in Chrome, on battery and on the external monitor;
  - check the probe numbers, the first-tour hitch, text steadiness and live prescribing;
  - report back.
