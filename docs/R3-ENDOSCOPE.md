# R3 · The da Vinci endoscope picture

The OR's camera picture is full-frame 16:9 and photo-like, but clean: tissue, fat, fascia and glistening serosa, real instruments, the console's HUD. **No blood and no cuts**, and that is tested.

## Where it shows

| Screen | Canvas | Rate |
|---|---|---|
| Vision cart monitor, wall monitor, both console viewers (one texture, one draw call) | 384×216 (`liveEndoscope.ts`) | 10 Hz while someone is in the OR, 2 Hz otherwise |
| Teaching console card (walk mode and the OR panel) | 768×432 hi-DPI backing (`consoleCard.canvas.ts`) | 12 Hz, only while open |

- `LIVE_SCREENS` (`dims.ts`) are 16:9, and their bezels follow.
- The material is unchanged: the live-strip settings (`map`, `toneMapped: false`, `vertexColors`). There is no new shader program and no new material.

## How a picture is made (`src/scene/surgery/endo/`)

| File | What it does |
|---|---|
| `anatomy.ts` | The organ field for each procedure: a background plus parts drawn back to front, each with a tissue and a height profile. |
| `field.ts` | Seeded value noise, fbm, ridged noise, Worley cells, and signed distances. |
| `plates.ts` | Bakes one lit plate per procedure (864×486) and its separate wet-highlight layer, in 8 ms slices under the warm gate `endoscope-plates`. |
| `noBlood.ts` | `safeTissue` (runs on every plate pixel), the colour tiers, and `bloodStats`. |
| `looks.ts` | Instrument look: jaws, wrist, tip cover, what it holds, energy, size. |
| `sprites.ts` | The instrument atlas (1024×256) and the vignette, shaded per pixel at load. |
| `view.ts` | The view model filled from `SurgeryState`: procedure, looks, withdrawal, energy, camera pose. |
| `frame.ts` | The per-frame compositor (allocation-free). |
| `hud.ts` | The in-image HUD. |
| `paint.ts` | `EndoPainter` (one per picture size), plus `paintEndoscope` and `paintStandby`. |
| `debug.ts` | The probe handle (`?probe=1`). |

`endoscope.ts` is a facade that re-exports these.

### The plates

The procedure comes from the current case; with no case, the cholecystectomy plate is used.

- **Cholecystectomy:** the underside of the liver across the top, and the gallbladder lying on it (fundus retracted to the upper right, neck in the middle). The cystic duct runs down into fat under a thin peritoneal veil, with the duodenum at lower right and omental fat at lower left.
- **Hysterectomy:** the uterus in the middle. On each side: a round ligament, a fallopian tube with fimbriae, and an ovary on the broad ligament. The sigmoid colon, with its fat tags, lies behind; the bladder's peritoneal fold is in front.
- **Prostatectomy:** the bladder dome with its muscle fibres, the bladder neck, and the prostate under a small fat pad with dorsal veins under fascia. The levator muscles are under endopelvic fascia at the sides.

How a plate is lit:

- Light comes from a lamp beside the lens. Normals come from the height field, with the slope capped so organ rims never turn into black outlines.
- Ambient occlusion comes from the height compared with its blur.
- A depth falloff dims far tissue, which also warms so deep fat reads orange, not olive.
- A subsurface term makes shadows warmer.
- The sharp wet highlights go into a separate layer, using fine relief that only bends the highlights.

### Each frame

1. The camera's window on the plate: arm 2's `tipMotion` pans and zooms it, and the ventilator's breathing (0.23 Hz) lifts and swells it.
2. The wet layer is added (`lighter`) through a window that moves 70 % more than the tissue, so highlights slide as the camera moves.
3. Tissue tents under a grasper whose jaws have closed.
4. Instruments are drawn per `RobotState.arms[i].instrument` (arms 1, 3 and 4). Each has a soft shadow, a carbon shaft in six segments that narrow toward the wrist, a steel collar, an EndoWrist (steel or black), and jaws turned about their pivot.
   - Monopolar scissors wear an amber tip cover.
   - The needle driver holds a curved needle with violet suture.
   - The clip applier holds a clip.
   - The hook and the suction tip have no jaws.
5. The lamp's falloff (the vignette), then the HUD.

Nothing in a frame allocates. All sprites and gradients are made at load. `noAllocations.test.ts` scans the whole paint path.

### Exchanges and energy

- A tool's withdrawal is `clamp01((1 − engage) / 0.45)`. The sim drops an arm to 0.55 engaged in the middle of an exchange, so the tool slides back out along its own shaft and leaves the picture. The look changes while it is out of sight, then the new tool comes back in.
- Docking and undocking bring the tools in and take them out the same way.
- The HUD shows "Exchanging", and that arm's chip dims.
- Energy tools (bipolar: fenestrated bipolar and the sealer; monopolar: scissors and hook) press their pedal in seeded bursts of about 1 s every 7–13 s. This happens only while the tool is in place and the console is live, and only one tool at a time.
- Energy shows as a glint at the tip and a lit pedal icon on the arm chip (blue for bipolar, yellow for monopolar). There is no smoke.

### HUD (in the image)

- Arm chips along the bottom: a badge with the arm number, the short tool name, and the pedal icon.
- The camera chip at top left ("2", "30°").
- "Simulated" at top right.
- "Exchanging" at top centre.

The words live in `src/content/endoscopeUi.json`, parsed with zod. The same file maps each instrument name to its look and short label, and `endoscopeUi.test.ts` checks that every instrument of every procedure (`instruments` and `exchanges`) is mapped. The fact list under the console card is unchanged.

## The no-blood guarantee

- **Tier A (blood):** red ≥ 48, green < 0.40 × red, and blue < 0.45 × red.
- **Tier B (deep red):** red ≥ 48, green < 0.50 × red, and blue < 0.55 × red, and not tier A.
- **`safeTissue`:** a red (green under 0.6 × red) has its green lifted to at least 0.52 × red and its blue to at least 0.47 × red, with a soft knee. A plate pixel can therefore be neither tier A nor tier B, even after 8-bit rounding. Yellows, pinks and whites pass unchanged.
- **Tests:**
  - Every baked plate: tier A = 0; tier B ≤ 0.2 % of pixels, in blobs of ≤ 64 px; no dark-red slits.
  - Every sprite pixel: neither tier.
  - Every colour any painter uses: neither tier, and the old R2 red-saturation rule still holds.
  - No graphic words.

## How to check

```bash
npx vitest run src/scene/surgery/endo src/scene/surgery/endoscope.test.ts src/scene/surgery/liveEndoscope.test.ts src/scene/surgery/noAllocations.test.ts src/ui/walk/consoleCard.test.ts src/content/endoscopeUi.test.ts --maxWorkers=1
```

In the browser, with `?probe=1`:

- `__hospitalEndo.stats()`: the plates baked, the bake's slice count and longest slice, and the live texture's paint count.
- `__hospitalEndo.bloodStats()`: the measures of the live picture now and of each plate. Tier A must be 0.
- `__hospitalEndo.showEndoPreview('hysterectomy', 60)`: lays a 768×432 picture of that procedure over the page for a screenshot. `hideEndoPreview()` removes it.
- `__hospitalEndo.endoPreview(p, t)`: returns the same picture as a JPEG data URL.

## Costs

- **Load:** about 0.3–0.5 s of arithmetic per plate in node, in 8 ms slices behind the loading screen, plus an atlas build of about 20 ms.
- **Memory:** six plate canvases (about 10 MB), the 1024×256 atlas, and the 384×216 vignette.
- **Per paint:** about 45 `drawImage` calls, around 30 path and text calls for the HUD, and no `getImageData`.
- **Fallback:** if a plate isn't baked yet, the picture uses a plain warm field under the same tools, light and HUD.
