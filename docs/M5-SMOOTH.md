# Plan: M5 "Smooth on your Mac": the live demo never stutters

## Goal
`npm run show` (production build plus `vite preview`), opened in Chrome on your MacBook (Apple M4, 16 GB) and on the 1080p external display. The demo runs with no visible hitch, from the first frame to the end of the tour:
- not on load
- not on the first `Tab` into walk mode
- not on `V`
- not at the first door, MealBot, scan image or Jump

## What you'll see
- **Loading screen:**
  - The hospital's name, a calm progress line ("Preparing the hospital…") and an **Enter** button that appears only when everything is warm.
  - Every shader of both modes (overview and walk), every crowd body, the pods, MealBots, machines, emotes and screens is compiled behind it, and every texture is uploaded.
  - The Enter click also unlocks audio (a browser rule).
- **Quality ladder:**
  - It watches the real frame time after warm-up and steps down only if needed: DPR 1.5 → 1.25 → 1.0, then the AO gets lighter, then AO goes off.
  - It steps back up when there is clear headroom, with hysteresis, so it never flickers between levels.
  - It never steps during the first seconds after load or right after a Jump.
- **The frame loop** (`PowerLoop`):
  - At most 60 fps, so a 120 Hz display doesn't double the work.
  - 30 fps on the loading screen and on battery in normal mode.
  - Paused while the tab is hidden; resuming after a long pause never fast-forwards the sim.
- **Presentation mode** (`?present=1`: run `npm run show`, then open `http://localhost:5174/?present=1` in Chrome):
  - 60 fps even on battery.
  - **Does not** pause when the window loses focus, so screen sharing never freezes it. It still pauses when the tab is hidden.
  - Developer panels are hidden: the probe overlay shows only with `?probe=1`. Live prescribing (`P`, and `E` at a bedside) stays: it is the demo's "wow" moment (PLAN §1).

## How it's built
| Agent | Model | Owns | Builds |
|---|---|---|---|
| Warm-up & loading | sonnet | `src/scene/warmup/**`, `src/ui/loading/**` | A precompile pass from Waltz `src/scene/warmup/{precompile,Warmup}`: `compileAsync` over the whole scene with walk-only and overview-only groups, all crowd LOD bodies and every material variant visible, plus `initTexture` for every texture. A loading screen with progress and Enter. A node test lists every material key in the scene, so a new material can't escape the warm-up. |
| Quality & power | sonnet | `src/app/{PowerLoop.tsx,power.ts}`, `src/scene/quality/**` (`Quality.tsx`, `render.store.ts`), the AO parts of `src/scene/Effects.tsx` | `PowerLoop` from the skill template (`frameloop="never"`, `advance()` at the cap, hidden-tab pause, no fast-forward). The quality ladder with hysteresis from Waltz `Quality.tsx`. Presentation mode. Pure, node-tested state machines. |

Neither agent edits `src/app/App.tsx`: each lists its mount lines, and I integrate. I also chase the 330 draw-call spike seen during MRI prep and positioning.

## Verification
- **Node:**
  - the ladder steps down and up with hysteresis and never inside its grace windows;
  - the power state machine (hidden, blur, battery, presentation);
  - every scene material is in the warm-up list;
  - `frameAllocations` and the full suite stay green.
- **Browser** (`?probe=1`):
  - `renderer.info.programs` count stays the same before and after a scripted first `Tab`, `V`, door, MealBot, scan image and Jump (no new programs means no hitch);
  - draw calls and triangles within budget at the default and eye-level views;
  - no console errors.
- **You:** `npm run show`, then Chrome at `http://localhost:5174/?present=1&probe=1`, on battery and on the external display.
