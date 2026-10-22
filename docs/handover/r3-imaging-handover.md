# R3 imaging leftovers: state when paused (2026-10-20, user: "stop for now the really accurate work")

In the tree, uncommitted, typecheck clean, 574/574 tests in src/scene/imaging, drawCentre, content, sim/imaging:
- Planners for every exam (render/spec.ts) + sliceMeta (W/L, kV/mAs, TR/TE/TI, EI, lead marker, scout-inset lines). Tests: render/spec.test.ts.
- CT / MRI / X-ray chrome (images/chrome/{common,ct,mri,xray}.ts), copy in content/imagingUi.json (zod), wired in images/screen.ts (scout insets kept or fetched on slot `<m>:scout`).
- Vein scanner wired: VeinJob in worker (NIR map + US_LINEAR needle guide), LiveStrip uses it (liveTexture passes imagingBackend()). NIR got local contrast + meandering veins; US needle no longer blacks out tissue.
- Liver and spleen US views retuned by a pose sweep (usViews.ts), with a test.
- Limb regions knee/ankle/wrist (regions/{limb,knee,ankle,wrist}.ts) registered; new tissues yellowMarrow, cancellous. Knee & ankle previewed; wrist written but NOT previewed.
- xr-knee protocol added (imaging.json, DEMO_PROTOCOLS xray 4th).
- MRI display window floor (no white muscle on fluid-free slices); X-ray taper slabs adaptive (no staircases).

Parked (NOT in the tree): parked-regions/{head,thorax,skeleton}.ts = the stopped agents' unfinished work (thorax.ts had a type error; skeleton.ts rewrite unverified). Head/thorax exams still fall back to R1 vector pictures.

Not done: browser check + docs/screenshots/r3-*.jpg; launch.json still has hospital-dev-r3imaging; nothing committed.
