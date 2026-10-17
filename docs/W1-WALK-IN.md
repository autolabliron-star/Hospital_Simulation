# Plan: W1 "Walk-in": you are a doctor inside the hospital, GTA-style

## Context
Today you look down at an architect's model: walls are cut at 1.3 m, there are no ceilings, and the camera orbits from above. It reads like a plan, not like being there. You asked for the GTA feeling: you are a person in the world, the camera rides behind your shoulder at eye level, the building closes around you, and the people and machines react to you.

**Your choices:**
- You play **a doctor**: you walk the wards, prescribe at the bedside and follow the medicine.
- The camera is **GTA third person**, behind the right shoulder. `V` switches to first person for close looks.
- The demo **starts on foot at the main entrance**. `Tab` flies up to today's overview and back down to you.

**Where we are:** R1 imaging and L1 living day are in, and 1070 tests pass. Nothing in the project has a player yet. Waltz City (`/Users/lironhagbi/Waltz Game`) has a proven walk mode and the research mapped it:
- **Copied and trimmed** (about 1,400 lines, plus about 1,100 lines of tests): the chase camera (orbit, smoothing, pull-in at walls, the walk/overview hand-over), movement, input and the "press E" picker.
- **Rewritten** (about 800 lines): rapier is gone, so collision runs on our nav grid.
- **New:** full-height walls, ceilings and the shoulder offset. Waltz has none of these.

---

## 1. What you'll see

**Arriving.**
- You stand outside the main doors in a white coat with a "You" badge.
- The doors slide open as you walk up.
- The lobby is at eye level: the reception desk, the kiosks, people queuing, waiting rows and the signs overhead.

**Moving.**

| Key | What it does |
|---|---|
| `W` / `S` | Walk forward / back up (slower) the way you face |
| `A` / `D` | Turn left / right; the camera follows behind you, as in a game |
| Mouse | Look around you (click the view to capture the mouse; `Esc` releases it). Once you move, the view swings back behind you after about 1 s |
| `Shift` | Run |
| `V` | First person |
| `Q` | Swap the camera to your other shoulder (it also swaps by itself when a wall is in the way) |
| `Tab` | Switch between walk and overview |
| Mouse wheel | Move the camera closer or further. Zoom right in and it becomes first person. |

The old camera-relative controls (GTA "classic": WASD moves relative to the camera, only the mouse turns it) are still available with `?controls=classic`.

- Walking is a brisk 2.0 m/s, and `Shift` is a real run at 4.2 m/s. The gait follows the speed: longer steps and a faster cadence as you go, and a run with a flight phase, bent elbows and a forward lean.
- The camera sits 0.45 m right of your head, 2.6–3.4 m back, slightly above eye level, with a 60° field of view.
- It never goes through a wall: it pulls in fast near walls and drifts back out slowly.

**The building closes around you** (walk mode only; the overview keeps the architect's cut):
- **Walls:** full-height (3.0 m), with door frames, lintels and visible swing-door leaves.
- **Corridors:** handrails and corner guards.
- **Ceilings:** light ceiling tiles with a grid of soft light panels, and the contactless-vitals glow in patient rooms.
- **Signs:** hanging wayfinding signs at the corridor junctions (Ward A, Imaging, Pharmacy core, Emergency, Atrium) and room-number plates beside every door.
- **Light:** in walk mode the sun dims and the indoor light rises, so rooms feel lit from above rather than sunlit through a missing roof. Windows stay bright.

**The world reacts to you.**
- People see you:
  - heads turn as you pass;
  - staff nod and say "Morning, Doctor";
  - people move over to let you pass (patients and visitors the most, staff a little), and keep walking.
- The crowd steers around you, and nobody walks through you.
- **Pods stop for you.** If you stand on a robot lane, the pod ahead stops with its amber light and an "Excuse me" bubble, then goes on when you step aside.
- Auto doors open for you, lifts chime, and the scanner sounds grow as you approach the MRI.

**Press `E`.** A prompt appears when you face something within reach, for example "E · Prescribe for Grace Adeyemi".

| Where | E does |
|---|---|
| A patient's bedside | Open the prescribing tablet for that patient. Your order is tracked as "your order": the objective line follows it, a marker shows your pod on the minimap, and you can walk to the drawer to watch it load. |
| Anyone | Talk. A short, kind line by role and moment ("Results are back for bay 3", "Lunch is lentil soup today"), then they hold still and look at you. |
| A scanner console | The live Scan viewer, plus "Start a scan now". |
| A MedDrawer | See what is inside, which is only that patient's packs. |
| A chair or sofa | Sit down. |
| The command wall | A close look at the Beds panel and the live map. |
| The kiosk and the lifts | A short message (the wards upstairs are not built). |

**Walk-mode HUD.** It is quiet, like a game:
- a small clock;
- a minimap of the floor plan with your arrow, pods and a marker for your order;
- the interact prompt;
- one objective line ("Pod A1 is bringing your order to A3: about 2 min").

`H` hides even that. The KPI card and order rail come back in the overview.

**Sound** (Web Audio, synthesized, offline): your footsteps, the room tone of each area, door whooshes, the pod chime, the lift ding and the existing scanner sounds. `M` mutes all of it.

---

## 2. How it's built

### Contract and glue (Opus, first)
- **`src/sim/types.ts`:**
  - `PlayerMode` = `'overview' | 'toWalk' | 'walk' | 'toOverview'`
  - `PlayerView` (position, heading, speed, mode, view `'third' | 'first'`)
  - KeyMap: `walk` = `Tab`, `firstPerson` = `KeyV`, `interact` = `KeyE`, `hurry` = `ShiftLeft`
  - Events `youPrescribed` and `talkedTo`
- **`src/sim/places.ts`:**
  - `PLAYER_SPAWN`, outside the entrance, facing in
  - ceiling height per area
  - anchors for hanging signs and door plates
  - interactable anchors derived from `ROOMS`, `IMAGING`, `PHARMACY`, `COMMAND_WALL` and `LOBBY`
- **`src/sim/config.ts`:** a `player` section (speeds, body radius, the camera boom, offsets and field of view, reach and the reaction radii).
- **Sim hooks:**
  - **The player as a person:** an entity `player` (role `doctor`, white coat) in `sim.entities`, so the crowd draws the avatar with the human gait and blob shadow.
  - **The crowd avoids you:** a static crowd proxy of radius 0.45 m, which NPCs steer around.
  - **Pods yield to you:** the player probe goes into `crossings.updatePeople(…, extra)`, and pods also stop when the player is within 1.5 m ahead on their lane.
  - **Talking:** a talk hold on `Actor` (freeze, face the player, a few seconds).
  - **Jump:** a Jump carries the player over into the new hospital.
- **Stubs other agents code against:**
  - `src/scene/player/state.ts`: the live player object, read per frame, and a `useWalk` store at 10 Hz.
  - `src/scene/interact.store.ts`: from the skill template.

### Agents (each owns one folder; targeted tests while working; the orchestrator runs the gates)

| Agent | Model | Owns | Builds |
|---|---|---|---|
| **Player & camera** | sonnet | `src/scene/player/**`, the walk hand-over in `src/scene/camera/cameraApi.ts` | Waltz `chaseMath`, `chaseCamera`, `motion` and `input` adapted, with pointer lock and camera-relative WASD. The new pieces: the shoulder offset, the `V` first-person view with the avatar faded below 0.75 m of boom, collision on the nav grid (`isWalkable` / `nearestWalkable`), a wall-box `BoomProbe` from `buildWallPieces()` plus the ceiling, and the Tab hand-over, which adopts the camera pose into CameraControls. It starts in walk mode at `PLAYER_SPAWN`. It brings Waltz's chase tests and adds its own. |
| **Enclosed building** | sonnet | `src/scene/building/**`, the daylight indoor preset | Upper walls (cut to 3.0 m) for the solid and cut-glass classes, lintels, swing-door leaves, ceilings with light panels, hanging signs and door plates (copy in `src/content`), and handrails. All of it is merged per area and shown only in walk mode: no rebuild on toggle, and it never casts into the baked shadow. An indoor light preset (sun down, ambient and environment up, smaller AO radius). Both modes are compiled once at load, so the first Tab never stutters. |
| **Life reacts** | sonnet | `src/sim/er/actor.ts` (talk hold), the player proxy in `src/sim/nav/crowd.ts`, the lane yield in `src/sim/meds/pods.ts`, `src/content/barks.json` | NPC head-look at the player, greetings (at most once a minute per person, by role and moment), stepping aside, pods yielding with "Excuse me", and talk lines with a zod schema. The medicine story is unchanged when no player exists. |
| **Interaction & HUD** | sonnet | `src/ui/walk/**`, `src/scene/interact/**`, the walk branch of `Hud.tsx` | The picker (Waltz `interactions.ts`: reach, facing, priority), `InteractPrompt`, the interactables in the table above (bedside prescribe with "your order" tracking, talk, consoles open the Scan viewer, drawer contents, sit, command wall, kiosk and lifts), the minimap from `building/layout/planSvg.ts` with live dots, the objective line, the walk/overview HUD visibility, and no room-click picking while walking. |
| **Close-up people** | sonnet | `src/scene/actors/crowd/**` | The high-LOD detail you see at 2 m: brows and a mouth line, a few hair shapes, hands, staff name badges, and the stethoscope and lanyard at a readable size. It stays inside the crowd's triangle budget. |
| **Ambience** | haiku | `src/audio/ambience.ts` | Footsteps synced to the player's speed, room tone per area, doors, pod chime, lift ding. Mute with `M`, suspended when the tab is hidden. |

**Order:**
1. Me: contract, sim hooks and stubs.
2. All six agents in parallel: they own separate folders and code against the stubs.
3. Me: mounting, integration, the gates and an eye-level browser pass.
4. You: one play-test.

### Budgets (the demo must still never stutter)
- At the busiest walk view (the lobby at 10:30) and in a ward corridor: ≤ 300 draw calls, ≤ 1.2 M triangles, ≤ 12 ms per frame, with shadows included. Measured with `?probe=1`.
- The walk-mode building adds ≤ 25 draw calls and ≤ 150 k triangles. It is merged per area, so culling works.
- No shader compiles on the first Tab, the first `V` or the first door; everything is warmed at load.
- No allocations in `useFrame`. Every camera smoother reaches exact rest, so text never trails.

---

## 3. Verification
- **Node tests:**
  - **Camera:** the chase maths settles at exact rest, and the boom never passes through a wall box or the ceiling (sampled over the whole floor plan).
  - **Collision:** the player never ends a step inside a wall or furniture footprint.
  - **Pods:** they never move into a player on their lane.
  - **NPCs:** they never overlap the player.
  - **The picker:** the right target wins by reach, facing and priority.
  - **A bedside order:** the order reaches `given`, and the objective line follows it.
  - **Without a player:** the medicine story, determinism and the whole existing suite are unchanged.
- **Browser** (built-in pane, `?probe=1`):
  1. Walk from the entrance through the lobby to A3.
  2. Prescribe and watch your pod arrive at the drawer.
  3. Visit the MRI control room during a scan.
  4. Press `Tab` to the overview and back.
  5. Screenshots at eye level: the lobby, a corridor with a passing pod, a patient room, the MRI console.
  6. Probe numbers at each, and no console errors.
- **You:** a play-test in Chrome (`npm run show`, then `http://localhost:5174/?probe=1`). Walk, talk, prescribe, follow, Tab out and in.

## Open questions
1. **Your character:** a fixed synthetic name ("Dr. Rivera") or just "You"? The default is "You" on the badge and in the event line.
2. **Gamepad:** should a controller work too? It's not in this wave unless you want it.
3. **Upper floors:** the lifts only show a message for now. A real second floor (another ward, the OR from R2) could come later through the lifts.
