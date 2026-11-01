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
| `plates.ts` | Bakes one lit plate per procedure (864×486) and its separate wet-highlight layer, in 8 ms slices under the warm gate `endoscope-plates`. R5: also the four patches (see Stages). |
| `noBlood.ts` | `safeTissue` (runs on every plate pixel), the colour tiers, and `bloodStats`. |
| `looks.ts` | Instrument look: jaws, wrist, tip cover, what it holds, energy, size. |
| `sprites.ts` | The instrument atlas (1024×256) and the vignette, shaded per pixel at load. |
| `view.ts` | The view model filled from `SurgeryState`: procedure, looks, withdrawal, energy, camera pose. |
| `frame.ts` | The per-frame compositor (allocation-free). |
| `hud.ts` | The in-image HUD. |
| `paint.ts` | `EndoPainter` (one per picture size), plus `paintEndoscope` and `paintStandby`. |
| `debug.ts` | The probe handle (`?probe=1`). |
| `stages.ts` | R5: the step of the operation: camera place, patches, clips, stitches, bag and glow for each stage of each procedure. |
| `decals.ts` | R5: the small atlas of cleared-tissue blobs, the glow dot and the two bags. |
| `testRaster.ts` | A software 2D context for node tests only: it lets a test measure the composited picture. |

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

## Stages (R5: the picture follows the step)

The three da Vinci scripts (`src/content/procedures/or-*.json`) carry a `scope` key on their steps. The room publishes it as `ProcedureView.scope`, and `fillEndoView` turns it into a **stage** of the case's procedure (`stages.ts`). A scope the procedure does not know, a case with no script, or a script of another procedure gives stage -1, which is exactly the picture described above.

A stage sets:

| What | How |
|---|---|
| Camera | A centre and a zoom on the plate (1 to 2). The seeded pan and the breathing move about it, and the camera eases from the stage before over 2.4 s (`STAGE_EASE`). The instruments follow only the movement about the stage's place, grow by 45 % of its zoom (`TOOL_ZOOM`) and spread by 12 % (`TOOL_REACH`): the surgeon brings the tips to the work. |
| Patches | Four pieces of plate baked from a changed layout (`anatomy.ts` `PATCHES`): Calot's triangle cleared (the cystic duct and the cystic artery, two structures only), the gallbladder gone from its bed, the uterus out with the top of the vagina across the space, the prostate out with the bladder neck and the urethral stump. Each has a soft elliptical mask in its alpha and fades in over its step's progress. |
| Cleared tissue | Soft pale blobs (`decals.ts`) where dissection has been (round ligaments, bladder fold, vessels at the cervix; the space behind the pubic bone, the fat pad, the bladder neck, the sperm ducts, the back plane). |
| Marks | A thin pale line goes round the cervix as the cut does; it goes when the uterus is out. |
| Stitches | A running violet line with slanted stitches, drawn as the step goes on: the top of the vagina, the stitch round the vein bundle, the back wall of the bladder, the two sutures of the join. |
| Clips | Six steel clips (three on the cystic duct, three on the artery) in the clipping step; three purple polymer (Hem-o-lok) clips on each side support of the prostate. |
| Bag | The pale retrieval bag with the gallbladder (it stays) or the prostate (it is parked when the repair begins). |
| Glow | Firefly: the picture goes dark green-black and the cystic duct, the hepatic and bile ducts and the gallbladder glow green (`firefly`); half of it for `criticalView`. |

Each feature has a stage it first shows in and a window of that step's progress it comes in over; after that it stays (unless it names a stage where it goes). A stage that has anything happen in it is exactly one step of its script, so a step's progress is the stage's (`stages.test.ts` checks that).

Stage keys, in script order:

- Gallbladder: `survey`, `liverEdge`, `firefly`, `retract`, `calotDissection`, `criticalView`, `clipping`, `dividing`, `liverBed`, `bagging`, `finalCheck`.
- Hysterectomy: `survey`, `roundLigament`, `bladderFlap`, `uterineVessels`, `colpotomy`, `delivery`, `needleDrivers`, `cuffClosure`, `finalCheck`.
- Prostatectomy: `survey`, `retzius`, `endopelvic`, `dorsalVein`, `bladderNeck`, `seminalVesicles`, `posteriorPlane`, `pedicles`, `apex`, `bagging`, `posteriorRepair`, `anastomosis`, `leakTest`, `finalCheck`.

Costs and rules:

- **Load:** the four patches add about 0.4-0.5 s of arithmetic in node (about 0.7 of the three plates' bake: 690k pixels against 1.26 M), in the same 8 ms slices behind the same warm gate, and about 5.5 MB of canvas (each patch has its tissue and its highlights). The decal atlas is 256×160.
- **Per paint:** a stage adds at most about 80 canvas calls (one patch is 2 `drawImage`; the Firefly stamps are about 50 `drawImage`); no gradient, no image data, nothing allocated (`noAllocations.test.ts` scans the stage functions). No new shader program.
- **Redraw:** unchanged. The live texture repaints at 2 Hz (4 Hz while watched) whatever the stage does.
- **No blood:** the patches pass the plate measures; the decals pass the sprite measures; every stage of every procedure is painted on real pixels (`testRaster.ts`) at two moments and measured: tier A none, tier B at most 0.2 % in blobs of at most 64 px, no slits (`noBlood.test.ts`).

To look at a stage in the browser with `?probe=1`: `__hospitalEndo.showEndoPreview('hysterectomy', 60, 'colpotomy', 0.5)` (procedure, sim second, stage key, progress through its step).
