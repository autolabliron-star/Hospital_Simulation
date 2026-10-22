# Presentation mode and the photographic look

Owner's complaint: the hospital "still looks game-like". This adds an architectural-walkthrough way of viewing the world (first person at eye
level, slow and smooth, no HUD, no avatar, no game UI) and a photographic look (AgX tone mapping, a lobby reflection probe, a sky). It is the
frame for the Blender-baked lobby (`?building=model`).

## How to use it

| What | How |
|---|---|
| Start in it | `?view=present` (cuts to shot 1 on the first walking frame). Add `&building=model` for the authored lobby, `&probe=1` for the probe API. |
| Toggle | `C` (not while typing in a field). Leaving restores the game's camera, speed, avatar and HUD. |
| Next shot | `N` (only while presenting): an eased 6 to 8 s glide through the four lobby shots, looping. Any walk key ends a glide and you walk on. |
| Probe (with `?probe=1`) | `window.__hospitalPresent = { on(), off(), shot(i), glide(), state(), shots }`. `shot(i)` is an instant cut to shot `i` (0-based, looping), settled one frame later; `glide()` glides to the shot after the last one; both turn the mode on if it is off. `state()` returns `{ on, presenting, gliding, shot }`. |

`?present=1` (src/app/power.ts: 60 fps on battery, no pause on blur) is a different thing and is untouched; presentation mode turns that flag on
while it is active and puts it back on leaving.

## What it changes (all of it reverts exactly)

Store: `src/ui/present/presentation.store.ts` (`usePresentation`, `presentActive()` for frame callbacks, `presentViewFromSearch`).

Camera and body (src/scene/player, presentation hooks only):
- first person is forced (V, the wheel and Tab are not heard); eye 1.6 m, vertical lens 55 degrees (`PRESENT` in tuning.ts), blended in over 0.6 s;
- walk at 0.6 of the pace (`BodyMover.speedScale`), no run (`noRun`), turning slowed the same;
- look damping 0.25 s on yaw, pitch and the heading's follow; no automatic pitch return; no head bob;
- the avatar's `fade` is written 0 in `syncSim`, flights included (so no body and no blob shadow);
- shots: `src/ui/present/shots.ts` (the four lobby shots, eye 1.6 m, level look). A cut places the body (`settle` then `placeAt`), snaps the view
  (`ChaseCamera.snapView`) and completes the blends. A glide (`src/ui/present/glide.ts`) is a cardinal-Hermite dolly with Catmull-Rom
  directions and chord-length tangents (no overshoot, no loop at the turn-backs of the shot loop), time eased with a smootherstep (starts and ends
  at rest), the yaw turning the short way along it. The body is walked to each point by `BodyMover.glide`, which runs the same collision as a
  walk (walls, furniture, doors, people), so nothing is teleported through anything and doors open for you.

UI: the HUD returns null (`hudIsHidden`), Go-to menu, room panel and Jump menu are not rendered (`Hidden`), the Jump veil and the lift cover stay
mounted but invisible (`Cloaked`: they carry effects), realism is forced on (no emotes, no bubbles), E (interact) and the keys that open game UI
(P, J, ], H, R, G) are not heard, and starting the mode closes any open tablet, room panel, card or menu so nothing invisible can hold your input.
`ProbeOverlay` stays under `?probe=1`.

## The photographic look

- **Tone mapping: AgX**, behind one constant, `TONE_MAP` in src/scene/lighting/look.ts (`'neutral'` reverts it; Effects.tsx picks the mode, the
  daylight driver multiplies every look's exposure by `TONE_EXPOSURE_SCALE`). The mode is a define of the one tone-mapping pass and fixed for the
  page: toggling C changes only uniforms. **Exposure compensation 1.25** (walk 1.05 -> 1.31, overview 1 -> 1.25): computed by evaluating three
  0.186's AgX and Neutral on grey ramps (display sRGB): scene linear 0.18 / 0.3 / 0.5 / 0.8 / 1.0 -> Neutral 0.42 / 0.56 / 0.73 / 0.90 / 0.95,
  AgX x1.25 0.55 / 0.64 / 0.72 / 0.79 / 0.82. Mid-tones and ordinary lit surfaces are within about 0.04; shadows come out lighter and whites a
  little lower and softer (that is the AgX look); a bare AgX at exposure 1 is visibly grey and 12 % darker through the middle. **Judge it on
  screen:** if whites feel dull, raise `TONE_EXPOSURE_SCALE` (1.4 puts 0.8 at 0.81); if shadows lift too much, lower it.
- **Presentation grade** (Effects.tsx, uniforms only, blended over 0.6 s): LUT grade off, vignette at half its darkness (0.125), bloom intensity
  0.45 -> 0.2 and threshold 1.0 -> 1.35 (`PRESENT_LOOK`, `BLOOM` in look.ts).
- **Lobby reflection probe** (`src/scene/lighting/env/lobbyProbe.ts`, `?building=model` only): loads `assets/building/env_lobby.hdr` with
  `HDRLoader`, PMREMs it once (256, the same cube-UV layout as the other two environments, so no recompile), behind `registerWarmGate('lobby-env')`.
  Bound as `scene.environment` while the camera is on level 1 (drawn y < 3.6) inside `inPilotRegion` (the daylight driver's caller decides, the
  driver announces `liveLook.lobbyEnv` and writes the intensity with `LOBBY_ENV_MATCH`, currently 1, in look.ts; Lighting.tsx swaps it at priority
  -97). A missing file, a dev server answering with its index page or a corrupt HDR resolves null and everything stays as it was, silently.
  *Not done:* box-projected (parallax-corrected) reflections: it needs an `onBeforeCompile` patch on the model's own materials, which live in
  src/scene/building/model (another agent's); see Change requests.
- **Sky** (`src/scene/lighting/env/SkyDome.tsx` + `skyUniforms.ts`): one sphere, one draw call, drawn first (render order -1000, no depth test or
  write), centred on the camera by the vertex shader (`mat3(viewMatrix)`, `xyww`), hidden in the overview (the flat background shows there). The
  walk and presentation sky is a gradient (hazy pale blue at the horizon, clear blue overhead) that follows the hour: the daylight driver writes
  the hour's sky colour, the day share and the indoor blend into `skyUniforms`. The two day colours are scene-linear values solved numerically so
  that, through AgX at the walk exposure, they land on display sRGB about (0.47, 0.66, 0.91) overhead and (0.78, 0.85, 0.92) at the horizon; the
  horizon is held near luminance 1.05 so the bloom barely touches the sky seen through a window. No fog: `scene.fog` is a define on every lit
  material and would recompile the building.

## Budget

No per-frame allocation (the new frame paths, `BodyMover.glide` and `PlayerSystem.stepGlide`, are in `noAllocations.test.ts`); +1 draw call (the
sky, walk and presentation only, about 1 k triangles); no new materials besides the sky's (found by the warm-up's traversal), no new lights, no
define changes at runtime. Check with `?probe=1`: draw calls at the default view, and `__hospitalWarm.programs()` before and after pressing C.

## Tests

`src/ui/present/*.test.ts` (store, shots, glide maths, gates), `src/scene/player/presentation.test.ts` (the system: view, lens, eye, speed, avatar
fade in flights, cuts, glides on walkable ground, collision with people, keys ending a glide, restoring), `src/scene/lighting/env/lobbyProbe.test.ts`,
`src/scene/daylight/lookDriver.test.ts` (exposure x scale, lobby env, sky uniforms), `src/scene/lighting/look.test.ts`.

Not verified here (no browsers by rule): how it looks. The sky and AgX numbers are derived, not eyeballed; the knobs are `TONE_EXPOSURE_SCALE`,
`SKY_ZENITH_DAY` / `SKY_HORIZON_DAY`, `PRESENT_LOOK`, `LOBBY_ENV_MATCH`.
