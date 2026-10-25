# Rollout kit: the shared material library and the clinical furniture kit

The owner approved the lobby's look ("clean clinical modern": white and light grey, light terrazzo, coloured wayfinding, minimal oak) as the style
for the whole building. This kit is what every zone (`tools/arch/zones.json`: lobby, er, imaging, wardA, wardB, core, atrium, theatres) builds
with: one material library (`tools/arch/materials.json` + `materials.py`) and one parametric furniture kit (`tools/arch/kit/**`), Blender 4.5
Python on the generator's per-material scene (`common.Geo`). The lobby's materials, their processing and every function `lobby.py` calls are
unchanged (the existing 24 material entries are byte-for-byte the same dicts, so their texture cache keys and outputs are identical).

Review stills (Cycles, AgX Base Contrast, the lobby's HDRI and sun from the WSW, 24 mm at 1.6 m): `docs/screenshots/kit-{1..6}-*.jpg`.

## 1. Material library

### How a zone picks a material: roles
`materials.json` has a `roles` table; zones ask for a role, never hard-code a look: `materials.role('floor.clinical') -> 'SheetVinyl'`.

| Role | Material | Notes |
|---|---|---|
| `floor.public` | Terrazzo | lobby, atrium, cafe, main corridors (existing) |
| `floor.clinical` | **SheetVinyl** | wards, ER, imaging, clinical corridors: light grey-blue granular chips, satin (0.36); coved skirting in the same material |
| `floor.theatre` | **TheatreFloor** | anti-static vinyl, a cooler deeper grey-green (0.30) |
| `floor.wet` | **SafetyVinyl** | en-suites, sluice, scrub: warm grey, finer chips, rougher (0.62) |
| `floor.rubber` / `rubber` | **Rubber** | castor tyres, bumpers, nosings, rubber floors |
| `floor.outside`, `floor.entranceMat` | Paving, Matting | existing |
| `wall.hero` / `wall` | WallPaint / WallClinical | white plaster (existing; WallPaint gets the dense hero lightmap) |
| `wall.tint.blue/sage/sand/lilac` | **WallTintBlue/Sage/Sand/Lilac** | calm accent walls (ward A / ward B + quiet rooms / atrium, cafe, lounges / diagnostics), the plaster set tinted |
| `wall.protection` | **CrashRail** | crash rails, corner guards, bed-head panels (satin warm light grey) |
| `wall.feature`, `casework` | Oak | slat walls, casework fronts, chair frames, table tops (light oak; there is no separate laminate material: same look, one less draw call) |
| `casework.white`, `solidSurface` | SolidSurface | counters, carcasses, basins, splashbacks |
| `upholstery.vinyl(.grey/.sage)`, `mattress` | **VinylTeal / VinylGrey / VinylSage** | wipe-clean vinyl (CC0 leather grain), the lobby's petrol blue and warm grey + a sage |
| `upholstery.fabric(.accent)` | Fabric / FabricAccent | the lobby's herringbone wool (public waiting) |
| `curtain`, `linen` | **Curtain / Linen** | pale blue-grey cubicle curtains and blankets / white bed linen (one CC0 weave set) |
| `metal.stainless` | **Stainless** | brushed stainless, metallic, generated streak texture |
| `metal.white` | **PowderWhite** | powder-coated white metal and white device housings |
| `metal.graphite` | Steel | the lobby's graphite powder coat (bench frames, table pedestals) |
| `plastic` | **KitPlastic** | every small coloured plastic part in ONE draw call (16-swatch palette, `KitPlastic:<i>`) |
| `screen` | **Screen** | dark glass monitor faces (the runtime's live canvas goes there: anchors `screen*`) |
| `ceiling.tile` | **AcousticTile** | tegular mineral-fibre tiles (`kit.arch.tegular_ceiling`) |
| `ceiling.plaster`, `ceiling.grid`, `ceiling.lightPanel`, `ceiling.ledLine` | CeilingPlaster, CeilingGrid, LightPanel, LEDLine | existing |
| `door.frame`, `glass`, `mullion`, `accent`, `concrete`, `plant`, `soil` | existing | |

KitPlastic swatches: 0 white, 1 light grey, 2 mid grey, 3 graphite, 4 black, 5 sharps yellow, 6 signal red, 7 glove blue, 8 green, 9 orange,
10 purple, 11 slate blue, 12 pale blue, 13 crash-cart red, 14 warm white, 15 clear blue (`kit.parts` names them: `sw(pt.GRAPHITE)`). The Accent
palette (wayfinding colours) is unchanged.

### New mechanisms in `materials.py` (existing behaviour untouched)
- **`textureSets`**: a processed texture set shared by several materials (GPU memory counts once). A material says `"set": "speckle"` (or
  `"@WallPaint"`: that material's own maps, the very same image files) and `"color"`; `materials.py` multiplies the set's colour by a constant
  (a `Mix` MULTIPLY node, factor 1 = glTF `baseColorFactor`, which three.js multiplies with the map) so the material's mean is `color`. Sets are
  processed bright so a factor <= 1 reaches every tint (a brighter target is scaled down and reported). `"maps"` limits which maps it uses.
- **`generate`**: a set made here with seeded numpy (our own output, no download): `brushed` = brushed stainless (streaks along U, ARM with
  metallic 1). Cached in `assets-src/arch/out/tex/gen/`.
- **`removeJoints.keepEvery: 0`** removes every tile joint of a photo (rolled half a period first so none sits on the border; stays seamless):
  the sheet-vinyl speckle comes from the terrazzo photo this way.
- **`process.metal`**: the ARM blue channel (default 0, as before).
- **Palettes with more slots**: `paletteSlots` (default 8 = the Accent strip, unchanged), `palette_uv(i, slots)`; each palette material writes
  its own `<Name>_palette.png`.
- `materials.role(name)`.

### Texture budget (GPU, KTX2 at about 1 byte/px + 1/3 for mips; slice: 48 MB)

| Set (CC0 source) | Used by | Maps exported | GPU MB |
|---|---|---|---|
| terrazzo_tiles (lobby) | Terrazzo | diff 2048, nor 1024, arm 512 | 7.00 |
| painted_plaster_wall (lobby) | WallPaint, WallClinical, CeilingPlaster, **4 wall tints** | diff 1024, nor 1024 | 2.67 |
| ash_veneer (lobby) | Oak (casework too) | diff 1024, nor 512, arm 512 | 2.00 |
| poly_wool_herringbone (lobby) | Fabric, FabricAccent, Matting | 3 diff 512 + 1 shared nor 512 | 1.33 |
| concrete_wall_004, floor_tiles_02 (lobby) | Concrete, Paving | diff + nor 512, diff 512 | 1.00 |
| **speckle** (terrazzo_tiles, joints removed, near white) | SheetVinyl, TheatreFloor, SafetyVinyl, AcousticTile | diff 1024 | 1.33 |
| **leather** (leather_white, new) | VinylTeal, VinylGrey, VinylSage | diff 512, nor 512 | 0.67 |
| **weave** (terlenka, new) | Curtain, Linen | diff 512, nor 512 | 0.67 |
| **brushed** (generated) | Stainless | diff 256, arm 256 | 0.17 |
| palettes | Accent (64 x 16), KitPlastic (128 x 16) | | 0.01 |
| **Total** | | | **about 16.8 MB of 48** |

The lobby's 14.0 MB is unchanged; the whole new library adds 2.8 MB. Room is left for zone-specific sets (e.g. a 2k vinyl if a close-up
needs it, +4 MB). Note: each zone glb embeds its own copy of the textures it uses; "counts once" only holds if the runtime dedups textures
across zone glbs (see Change requests).

### New CC0 sources (through the gate)
`leather_white` (Rob Tuytel, 0.3 m tile) and `terlenka` (colormass / Rico Cilliers, 0.266 m), 1k `diff` + `nor_gl` each: manifest ids
`ph-leather-white-{diff,nor-gl}-1k`, `ph-terlenka-{diff,nor-gl}-1k`, pinned (bytes + sha256 at first fetch, Poly Haven md5 cross-checked),
credited in `docs/CREDITS.md`. 2.97 MB on disk in `assets-src/textures/`.

## 2. Furniture kit (`tools/arch/kit/`)

```python
sys.path.insert(0, 'tools/arch')                      # generate.py already does this
from common import Frame
from kit import arch, base, cafe, er, parts, patient, support, theatre
patient.bed(geo, Frame(x, z, heading), node=None, backrest=30)   # static: into the joined-by-material scene, baked
patient.bed(geo, Frame(x, z, heading), node='bed:A1')            # movable: its own named node hierarchy, not baked
...
OBJS = geo.finalize(col, MATS)                                   # as today (bevel + project_uvs per material in generate.py)
NODES = base.finalize_nodes(geo, col, MATS, materials)           # NEW: the movable nodes -> Blender objects (bevel + UVs done inside)
anchors = getattr(geo, 'kit_anchors', [])                         # NEW: named points to write next to the glb
```

**Conventions.** Every item is `item(geo, f, ..., node=None)`; `f` is a `common.Frame` (origin on the floor, heading `h`: local +z points
(sin h, cos h), the layout builder's convention). Local +z is the item's front (where its user sits or stands; for beds and trolleys the foot).
Free-standing items are centred on their footprint; wall items have their back on the wall face at local z = 0 and stand out along +z. All
dimensions are real metres. Items return their emitter `K` (rarely needed).

**Static vs movable.** `node=None` writes into the zone's joined meshes (one draw call per material for the whole zone, lightmapped).
`node='<name>'` builds the item at the node's origin into its own `Geo`; `finalize_nodes` turns it into one Blender object per node (its
materials as slots = one glTF mesh, one primitive per material), parented as built, origin at the pivot, so the glTF keeps names and pivots:
`bed:A1`, `bed:A1/backrest`, `bed:A1/backrest/rail_hl`, `bed:A1/rail_fl`, ... Movable nodes get no lightmap UVs (they are lit by the probe and
need blob shadows at runtime). Use node mode only for what really moves (draw calls!): see the table for each item's parts.

**Anchors.** `base.anchor(k, name, x, y, z, **extra)` records named plan-space points in `geo.kit_anchors` (`{name, p:[x,y,z], node, ...}`):
seats (hip points), `bed:pillow`, `bed:patient`, IV hooks, monitor `screen` rectangles (`w`, `h`, centre; the runtime's canvas screens go there),
`headwall:monitorMount`, `table:patient`, `light:dome<i>`.

**Building blocks (`kit/base.py`, the emitter `K`)**: `k.at(x, y, z, ry, rx, rz)` (a sub-frame; `rx` > 0 lifts local -z), `k.mirror_x()`,
`k.part(name, x, y, z, ry, rx, rz)` (a hinge: a sub-frame for static items, a child node for movable ones); primitives in local metres:
`box(mat, x0, y0, z0, x1, y1, z1, drop=(), bev=0)` (bev > 0: chamfered edges), `cbox`, `rbox(mat, cx, y0, cz, w, h, d, r, axis)` (edges along
`axis` rounded), `prism(mat, pts2d, plane, a, b)` (extrude a profile: 'xz' plan, 'xy' front, 'zy' side; concave fine), `cyl(mat, a, b, r, r2=)`,
`vcyl`, `tube(mat, pts, r)` (+ `fillet(pts, r)` for bends), `lathe(mat, [(r, y)...])`, `torus`, `sphere`, `disc`, `tray(mat, ...)` (sinks, bins,
trays), `ribbon(mat, path, y0, y1, offset=)` (curtains), `qface`, `poly`. Material names may carry a palette swatch: `'KitPlastic:3'`.
`kit/parts.py`: castor, bar_handle, monitor, flat_monitor, dispenser, gas_outlet, socket, cylinder (gas), drape, towel_stack, keypad.

### Items

Triangles are for the item alone (`kit/selftest.py`, before the generator's bevel on SolidSurface/Oak/Fabric/Vinyl edges); "mats" = draw
calls if the item were alone (in a zone they share the zone's per-material meshes). Moving parts are named relative to the item's node.

| Module / function | What | Tris | Mats | Moving parts (node mode) |
|---|---|---|---|---|
| `patient.bed(geo, f, node, width=1.0, length=2.2, deck=0.47, backrest=30, rails='up'\|'down'\|'head', linen=True, mattress, blanket, board)` | electric ward bed: 150 mm castors, base cover, twin lift columns, 4-section deck, split rails, boards (oak foot panel, staff panel), bumpers; made up (sheet, pillow, blanket, turned-down top sheet) | 3.3k | 7 | `backrest`, `backrest/rail_hl`, `backrest/rail_hr`, `rail_fl`, `rail_fr` |
| `patient.locker(geo, f, node, w, d, h, front='Oak')` | bedside locker on castors, drawer + door, lipped top, towel rail | 1.2k | 5 | |
| `patient.overbed_table(geo, f, node, h=0.85)` | U base on castors, telescopic column, cantilever oak top | 1.0k | 5 | `top` |
| `patient.visitor_chair(geo, f, node, vinyl='VinylTeal')` | oak frame + arms, vinyl seat/back | 0.5k | 2 | |
| `patient.recliner(geo, f, node, vinyl, recline=0, footrest=0)` | high-back patient chair on castors | 1.7k | 5 | `back`, `footrest` |
| `patient.iv_pole(geo, f, node, height=2.0, hooks=4, bags=1, pump=True)` | 5-leg stand, chrome pole, hooks, bag + line, infusion pump | 2.0k | 5 | |
| `patient.headwall(geo, f, width=2.0, y=1.42)` (wall) | bedhead trunking: up/down LED, gas outlets, sockets, data, nurse call + handset, bed-head protection panel | 1.3k | 4 | |
| `patient.monitor_arm(geo, f, node, swing1, swing2, tilt)` (wall) | wall channel, 2-link arm, patient monitor | 0.6k | 3 | `arm1`, `arm1/arm2`, `arm1/arm2/head` |
| `patient.curtain_track(geo, f, path, ceiling)`, `patient.curtain(geo, f, path, ceiling, drawn, start)`, `patient.cubicle_curtains(geo, f, w, head_z, foot_z, ceiling, drawn, start)` | filleted ceiling track with fixings; pleated closed-sheet curtain (deeper pleats when gathered) | 1.8k | 3 | |
| `patient.handwash(geo, f, basin_h=0.86, towel, bins)` (wall) | HTM 64 basin + splashback, sensor spout, soap + gel, paper towels, clinical/domestic pedal bins | 1.3k | 4 | |
| `patient.sharps_and_gloves(geo, f, y=1.2)` (wall) | sharps bin on a rail, 3-box glove dispenser | 0.4k | 2 | |
| `patient.wall_clock(geo, f, y=2.1)` (wall) | rim, face, marks, hands | 0.75k | 1 | |
| `patient.wardrobe(geo, f, w=0.6, h=2.0, doors=1)` | white carcass, oak doors, bar pulls | 0.1k | 3 | |
| `patient.door_leaf(geo, f, node, width=0.9, open_deg, hinge, finish='Oak', lining=True, wall)` | hinged leaf, lever handles, kick plates, indicator, optional lining + architraves | 0.6k | 4 | `leaf` (pivot on the hinge) |
| `er.stretcher(geo, f, node, deck=0.66, backrest=20, rails, linen)` | ER trolley: 200 mm castors, base cover, bellows columns, tubular rails, push handles, IV pole, O2 cylinder | 3.7k | 7 | `backrest`, `rail_l`, `rail_r` |
| `er.bay_curtains(geo, f, w=3.0, depth=3.0, ceiling, drawn, start)` (wall) | U track + curtain round a bay | 1.7k | 3 | |
| `er.resus_pendant(geo, f, node, ceiling)` = `theatre.supply_pendant(kind='resus')` | 2-arm ceiling pendant, service head, monitor, suction | 3.0k | 4 | `arm1`, `arm1/arm2`, `arm1/arm2/head` |
| `er.crash_cart(geo, f, node)` | red drawers + lock, defibrillator, O2, CPR board, sharps | 2.0k | 4 | |
| `er.nurse_station(geo, f, length=3.6, depth=1.2, monitors=3, low_end=True)` | counter in the lobby desk language (oak top, LED lip), work surface, monitors, keyboards, phone | 0.8k | 5 | |
| `er.triage_desk(geo, f)` | desk, monitor, vitals monitor roll stand | 1.4k | 6 | |
| `support.workstation(geo, f, w=1.4, monitors=2)` | desk, dual monitor arm, keyboard, mouse, pedestal | 1.7k | 5 | |
| `support.office_chair(geo, f, node, upholstery='VinylGrey')` | 5-star base, twin castors, seat, back, arms | 1.6k | 4 | |
| `support.cabinet(geo, f, w=0.9, h=2.0, d=0.45, kind='doors'\|'glass'\|'open')` | tall storage | 0.3k / 1.3k | 2-3 | |
| `support.shelving(geo, f, w=1.2, h=1.8, shelves=5, bins=True)` | modular storage with clear-blue bins | 2.1k | 2 | |
| `support.med_cart(geo, f, node)` | medication cart, drawers, keypad lock | 2.0k | 5 | |
| `support.linen_cart(geo, f, node)` | stainless cart, folded linen, cover | 2.3k | 5 | |
| `support.wheelchair(geo, f, node, seat, frame)` | tyres, mag hubs, push rims, castors, frame, slings, footplates | 3.5k | 4 | |
| `support.beam_seating(geo, f, n=3, pitch=0.6, fabric)` | the approved lobby bench (`furniture.bench_row`), fabric or wipe-clean vinyl | 0.35k | 3 | |
| `cryo.console(geo, f, node, tyre)` | brand-free liquid-nitrogen cryoablation console (0.45 x 0.60 x 1.10 m) on castors: white solid-surface body, side bay with the stainless dewar (frost-white cap), 40-degree touchscreen with a faint glowing UI, status strip, coiled hose on a hook to a pen-like cryoprobe in a side holder, push handle (tyres in black KitPlastic: no Rubber draw call) | 3.9k | 5 | |
| `theatre.supply_pendant(geo, f, node, ceiling, kind='anaesthesia'\|'surgeon'\|'resus', swing1, swing2)` | ceiling pendants | 2.5-2.9k | 4 | `arm1`, (`arm1/arm2`), `.../head` |
| `theatre.surgical_light(geo, f, node, ceiling, angles=(30, 150), tilt)` | twin LED domes on arms, spring arms, yokes, handles | 3.0k | 3 | `arm<i>`, `.../spring<i>`, `.../yoke<i>`, `.../dome<i>` |
| `theatre.laminar_canopy(geo, f, ceiling, size=3.2)` | UCV canopy: frame, LED band, diffuser, glass skirts | 0.2k | 5 | |
| `theatre.operating_table(geo, f, node, top=0.9)` | base, column, segmented top with pads, rails, arm board | 0.9k | 4 | |
| `theatre.anaesthesia_machine(geo, f, node)` | generic workstation shell (no brand): drawers, flowmeters, vaporisers, absorber, hoses, ventilator display, monitor arm | 2.3k | 5 | |
| `theatre.instrument_table(geo, f, node, w=1.2, d=0.6, draped=False)`, `theatre.mayo_stand(geo, f, node)` | back table (optionally draped with instruments), Mayo stand | 1.3k, 1.1k | 5, 3 | |
| `theatre.scrub_sink(geo, f, bays=2)` (wall) | stainless trough, spouts, dispensers, brush boxes, timer | 1.2k | 3 | |
| `cafe.counter(geo, f, length=3.2, back=True)` | oak-slat front (lobby feature-wall language), solid-surface top, LED lip, display case, till, back counter, coffee machine | 1.9k | 9 | |
| `cafe.table(geo, f, node, kind='round'\|'square')`, `cafe.chair(geo, f, node)`, `cafe.bench(geo, f, length)`, `cafe.planter(geo, f, r, seed)` | cafe furniture; planter = the lobby's fiddle-leaf fig | 0.5k, 0.5k, 0.4k | 2 | |
| `arch.coved_skirting(geo, along_x, face, into, a, b, h=0.1, mat='SheetVinyl')` | vinyl turned up the wall with a cove (floor material: no extra draw call) | 20/m | 1+1 | |
| `arch.crash_rail(...)`, `arch.handrail(...)`, `arch.corner_guard(geo, x, z, sx, sz)` | wall protection | 16/m, 70/m, 20 | 1-2 | |
| `arch.tegular_ceiling(geo, rect, y, module=0.6, panels=[(i, j, wi, wj)])` | stepped acoustic tiles, T-grid, LED panels | 60/m² | 3 | |
| `arch.wall_frame(along_x, face, into, a, b)` | the Frame of a wall span (local x along the wall, +z into the room) | | | |

A furnished single-bed room (bed, headwall, monitor arm, locker, overbed table, IV pole, recliner, visitor chair, curtains, hand-wash,
sharps/gloves, clock, wardrobe, door) is about 15k triangles: a ward zone of 8 rooms is ~120k of its 200k, before architecture.

## 3. Review renders
`tools/arch/kit/showroom.py` builds six small rooms with the library and the kit and renders them like the lobby stills
(`docs/screenshots/kit-1-patient-room.jpg`, `kit-2-patient-room-sink.jpg`, `kit-3-er-bay.jpg`, `kit-4-theatre.jpg`, `kit-5-support.jpg`,
`kit-6-cafe.jpg`; about 1 minute each at 256 samples). `--nodes` builds the movable pieces as named nodes (the stills look the same: proves
`finalize_nodes`), `--blend` saves the scene for inspection.

## How to verify
```
B=~/Applications/Blender.app/Contents/MacOS/Blender
/private/tmp/claude-501/hospital-blender.sh $B -b --factory-startup -P tools/arch/kit/selftest.py      # every item: tris, mats, winding flips (0), nodes
/private/tmp/claude-501/hospital-blender.sh $B -b --factory-startup -P tools/arch/kit/showroom.py -- --out docs/screenshots --samples 256 --nodes
node tools/fetch-assets.mjs --strict --verify                                                             # the four new texture files are pinned
npm run arch:pilot   # the lobby: its materials are unchanged (same specs, same cache keys); the new materials are built but unused there
```

## Change requests (owners of generate.py / bake.py / the zone framework / the runtime)
- **generate.py / zone framework**: after `geo.finalize(...)` call `kit.base.finalize_nodes(geo, col, MATS, materials)` (movable nodes; they are
  already bevelled and UV-projected, carry no `swatch` attribute and must be skipped by the lightmap bake), include them in the export
  selection, and write `geo.kit_anchors` next to the glb (e.g. `<zone>.anchors.json`).
- **bake.py**: add `'AcousticTile'` to `PLANAR` (thousands of small tegular tiles need the top-down lightmap projection like `CeilingTile`).
- **bake.py / generate.py export**: the curtain material (`Curtain`) is a thin closed sheet, single-sided: fine as is; `Glass` in the theatre
  canopy and cafe display uses the existing glass path.
- **Runtime loader**: zone glbs each embed the textures they use; to keep the shared library at ~17 MB GPU, dedup KTX2 textures across zone
  glbs (cache by image hash in the loader) or move the shared sets to one `materials.glb` the zones reference.
- **optimize.mjs**: the 48 MB `sharedMaterialTexturesMB` budget in zones.json can be checked per build by summing unique texture hashes.
- No contract file (`src/sim/*`) changes.

## Open questions / risks
- Metals (Stainless) in a baked pipeline: lightmaps carry diffuse only; stainless reads right only with the reflection probe per zone.
- Movable nodes cost one draw call per material per node: use node mode for what moves (trolleys, wheelchairs, doors, the theatre light);
  park everything else static. A per-type instanced prop export (one glb per item type, InstancedMesh at runtime) would be the next step.
- Synthetic, brand-free equipment; gas colour coding is illustrative.
- Theatre has no window: lit by panels + the domes' LEDLine lenses only.
