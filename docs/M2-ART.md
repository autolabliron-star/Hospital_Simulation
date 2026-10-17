# M2 art brief: the real hospital building

One brief for every M2 builder, so the building, the pharmacy and the robots read as one designed object.

## The look
- The hospital is an **architect's presentation model** of a future hospital: calm, bright and precise.
  - Materials: white, light oak, frosted glass and soft mint/teal accents.
  - Shapes: rounded corners where cheap (bevelled boxes, capsules), but **no fussy detail**.
- The roof is off, and the viewer looks in at about 50°.
  - Solid walls are drawn at the section cut `WALL.cutHeight` (1.3 m) with a slightly darker cap (`MAT.wallCap`), so every room is visible.
  - Glass partitions and the MedVend island are full height (`WALL.height`, 3 m). They are the tall landmarks.
- **Readable from the overview** (the camera is about 110 m away, the whole building in frame):
  - big shapes and clear colour zones;
  - status colours (`STATUS` in `src/scene/materials.ts`) that pop;
  - nothing important smaller than about 0.3 m that the story depends on.
- **Rewarding up close** (the M4 tour gets to about 4 m): beds with linen and pillows, bedside screens, the pod's face screen and light ring, and the picker arm gripping a coloured pack.

## Hard rules
1. **Materials:**
   - Only the shared palette in `src/scene/materials.ts` (`MAT.*`).
   - Per-object colour comes from `InstancedMesh.setColorAt`, or vertex colours on `MAT.tinted` / `MAT.tintedGlow`.
   - Never `new MeshStandardMaterial` per mesh. If you truly need a new palette entry, ask under Change requests.
2. **Geometry is procedural, instanced or merged:**
   - Static things are merged per material with `mergeGeometries` (`three/examples/jsm/utils/BufferGeometryUtils.js`).
   - Repeated things (beds, chairs, bins, plants) are `InstancedMesh`.
   - No downloaded models or textures. Canvas textures (screens, labels) only, redrawn only when their content changes.
3. **Layout comes from `src/sim/places.ts`** (areas, rooms and their anchors, doors, `PHARMACY`, `ROBOT`, `NURSE_HUB`, `COMMAND_SEATS`, `LOBBY`, `ATRIUM`). Never hard-code a position that the contract already has.
   - **Furniture must not block people's routes.** Keep at least 0.35 m from every edge of the nav graph (`NAV.edges` in `src/sim/nav/graph.ts`) and from every anchor.
   - **Furniture must not block the robot circuits** (`CIRCUITS` in `src/sim/meds/circuit.ts`). Keep at least 0.45 m from the lane centre lines.
   - Prove both with a node test.
4. **Shadows are baked once.**
   - Static meshes set `castShadow` and `receiveShadow` as fits. Floors receive, walls and furniture cast.
   - After your static meshes are built, call `invalidateShadows()` from `src/scene/Lighting.tsx`.
   - Moving things (pods, the gantry, drawer flaps) must **not** cast. Pods get an instanced soft blob shadow on the floor instead (a radial-gradient canvas texture on a quad).
5. **Performance budget per builder, at the default overview:**

   | Builder | Draw calls | Triangles |
   |---|---|---|
   | Building (floors, walls, rooms, furniture, landscape, wayfinding) | ≤ 90 | ≤ 500 k |
   | Pharmacy core + robots + drawers | ≤ 60 | ≤ 250 k |

   - The crowd (M3) and the HUD have their own reserve.
   - Post-processing is about 6 passes.
6. **Allocation-free frames.**
   - No `new` (Vector3, Color, Matrix4, Object3D, arrays) and no spreads inside `useFrame`.
   - Hoist them. `src/scene/frameAllocations.test.ts` enforces this.
7. **Read the simulation, never drive it.**
   - Layers read `sim` (from `@/sim`) inside `useFrame` at default priority 0 or later, never `FRAME_PRIORITY.sim`.
   - They never mutate sim state.
   - Interpolated values are already in place: `pod.position` / `pod.heading`, `dispensers[w].renderX/renderY` and `entity.position`.
8. **Offline:** no CDN fonts. drei `<Text>` without a bundled font fetches from a CDN, so use canvas textures.

## Palette and zoning (floors)
| Area kind | Floor material |
|---|---|
| patient rooms | `floorOak` |
| corridors, spine, lobby | `floorTerrazzo` |
| triage, ER, nurse hubs | `floorMint` |
| pharmacy core | `floorCore` (polished light teal, the robot lanes inlaid as `laneLine`) |
| command center | `floorSlate` (dark, so its screens glow) |
| diagnostics | `floorBlue` |
| atrium | `grass` beds, `stonePath` walks, an oak café deck |
| outside the building | a large `plinth` base with a soft edge, plus a few trees |

## Elements
### Building (builder S1)
- **Shell:** an outer wall at cut height with a band of floor-to-cut glazing (`MAT.glass` panels with thin `MAT.frame` mullions) along the window walls of every patient room. The main entrance on the west has a canopy.
- **Smart patient room** (16 rooms; one builder function, mirrored for ward B):
  - **Bed** at `room.bed`, facing `room.bedHeading`: white frame, linen and a pillow at the head end, against the corridor wall.
  - **Bedside screen** on a slim arm: a small dark panel with a soft teal glow.
  - **Ceiling vitals sensor:** a small glowing disc floating at about 2.4 m above the bed, which reads well from above.
  - **Family sofa** under the window in `fabricSage`, plus a side table and the visitor chair at `room.chair`.
  - **Bathroom pod:** a rounded white box in the corner by the door, clear of the door swing and the routes.
  - **A plant.**
  - **Door:** a sliding leaf, left open in M2.
- **Nurse hubs:** a curved counter (open towards the corridor at the `hubA`/`hubB` counter door), two workstations with screens and a chart rack.
- **Command center:** a curved video wall at `COMMAND_WALL` (dark screen panels; the live map comes in M4), desks with screens at `COMMAND_SEATS`, and chairs.
- **Atrium:** grass beds, stone paths linking both corridor openings and the café, 5–7 low-poly trees (instanced, about 4–5 m, light canopies), café counter and tables with chairs at `ATRIUM.cafe`, benches, and a water feature.
- **Lobby:** reception desk at `LOBBY.reception`, two self check-in kiosks at `LOBBY.kiosks`, and waiting seats in rows.
- **Triage and ER:**
  - 4 triage bays and 6 ER bays: curtain rails, trolley beds and monitors.
  - Ambulance bay outside the ER (west), with markings.
- **Diagnostics:** a lab counter and one scanner (a ring torus plus a table).
- **Staff room, lounges, quiet room, supply:** simple, believable furniture sets.
- **Wayfinding lines:**
  - Coloured floor strips (`WAYFINDING`) from the entrance down the spine into each ward corridor and to the atrium, emergency and diagnostics.
  - They run along the corridor centre line offset 0.6 m, never on a robot lane.
  - One instanced strip mesh.
- **Labels:** keep the M1 canvas label atlas idea (area names and room numbers) but restyle it: thin, elegant, lying on the floor near the door.

### Pharmacy core, MedPods and MedDrawers (builder S2)
- **Glass core:**
  - Full-height glass walls (`MAT.glass` + `MAT.frame` posts) on all four sides of `CORE`.
  - Four robot doors (`ROBOT.exitX`/`entryX` at |z| = 12, width `ROBOT.doorWidth`) that **slide open when a pod is within 1.8 m** and close after.
  - Two pharmacist doors at `DOORS` `pharmacistA/B`.
  - The polished floor carries the inlaid lane lines.
- **MedVend island** (`PHARMACY.island`, 12 × 2.4 × 3 m): a white casing with full-height glass faces on both long sides, so the bins are visible.
  - **Bins:** the 12 × 6 grid of bins per face (`binPosition`), each a small tray. Medicine bins show packs in their medicine's colour; empty bins are pale.
  - **Picker gantry per face:** a horizontal rail at the top and bottom, a vertical mast that rides along x (`renderX`), and a carriage that rides the mast (`renderY`).
    - The carriage has a gripper that reaches out to the bin (towards the glass) while `picking` and towards the dock chute while `dropping`.
    - While carrying, it holds a small pack in the current item's colour (`orders.get(gantry.orderId).items[gantry.itemIndex]`).
    - The motion must look mechanical and smooth: ease in and out, with no teleporting.
  - **Dock ports:** at `PHARMACY.docks[w]`, a small chute and a glowing ring on the floor. The ring is teal while a pod is docked.
- **Charging rank:** a pad per pod along the rank (x = `ROBOT.rankX`, from the entry door to `rankHeadZ`), with a soft glow under a charging pod.
- **Pharmacist desks:** at `PHARMACY.desk[w]`, with a screen.
- **MedPod**, about 0.6 × 0.6 × 1.0 m:
  - A soft rounded white body (`whitePlastic`) on a dark skirt (`rubber`).
  - A light ring band near the top, coloured by `pod.light` (`STATUS`), emissive.
  - A small face screen on the front showing the destination room number (`orders.get(pod.orderId)?.roomId`, else a charge icon), as one canvas atlas shared by all pods. Redraw only when a pod's destination changes.
  - Four compartment lids on top that tint in the colour of the medicine inside (`pod.compartments`).
  - A gentle bob or tilt when it starts and stops, and a soft blob shadow.
  - Instanced: one InstancedMesh per part.
- **MedDrawer** (16, at `room.drawer`, in the corridor wall beside the bed head; the room side faces the bed):
  - A white cabinet set into the wall, with a corridor-side hatch and a room-side drawer front.
  - The **hatch flips open** while a pod is `delivering` at that room.
  - The **room-side drawer slides out** while a nurse in that room is giving (`entity.role === 'nurse' && entity.roomId === room.id && entity.anim === 'give'`).
  - **Status light** on both sides: off when empty; soft teal when loaded; pulsing teal when `lightOn` (dose due); a brief green flash when given.
- **Robot lanes:** inlaid, subtle teal lines with small direction chevrons. Crossing zones are a faint zebra in the floor, not the M1 amber hatch.

## Done when
- `npx tsc --noEmit`, `npx vitest run --maxWorkers=2` and a scratch build pass.
- The node tests pass: furniture keeps clear of routes and lanes, layouts are deterministic, and there are no allocations in frames.
- The draw-call and triangle estimate per builder is within budget and reported.
- Screenshots in the built-in browser (taken by the orchestrator) look like the brief.
