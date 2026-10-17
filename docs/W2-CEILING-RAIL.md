# Plan: W2 "Ceiling rail": the MedPods ride a rail under the ceiling

## Context
You asked for the pharmacy robots to run on the ceiling, not the floor. Today the MedPods drive floor lanes with arrows. People must wait for them at doors, and when you walk in the hospital they stop for you and block the ward's loop. You chose **ceiling rail pods**: the pods hang from a rail just under the ceiling, ride it from the pharmacy core along every corridor, and lower the medicines into each room's MedDrawer through a short chute. The floor becomes people's again.

## What you'll see
- **The rail:**
  - a slim white rail with a teal light line just under the ceiling (underside at 2.95 m);
  - thin hangers up to the ceiling;
  - the same routes as today's lanes: the rank and dock line inside the pharmacy core, out through the core's glass wall, along the inner side of each ward corridor, a U-turn at each end, and back along the room side past every drawer.
- **The pods:**
  - compact, rounded and white, hanging under a small bogie that runs on the rail;
  - body 0.5 × 0.6 × 0.5 m, from 2.30 m to 2.80 m above the floor, so everyone walks underneath (doors are 2.30 m);
  - the light ring and face screen kept; teal means carrying, amber waiting, green delivered;
  - they glide, slow into the curves, and sway a little on stops.
- **Loading in the core:**
  - The MedVend's dock ports move to the top of the dispensing wall (about 2.45 m). A pod docks alongside, its side hatch opens, and the picker carriage rises and pushes each pack in.
  - The charging rank is a short siding of the rail inside the core, with the pods parked overhead.
- **Leaving the core:**
  - Pods pass through small rail portals near the top of the core's glass wall, with a flap that lifts as a pod comes.
  - The floor robot doors are removed.
- **Delivery:**
  1. Above each room's MedDrawer, a slim glass **chute** runs down the corridor wall from 2.25 m to the drawer cabinet.
  2. When a pod docks above it, a small funnel folds out from the wall under the pod, the bottom hatch opens, and the packs slide one by one down the chute into the drawer.
  3. The drawer tile turns teal as today.
- **On the floor:**
  - no robot lanes or arrows;
  - people (and you) use the whole corridor;
  - nobody ever waits for a pod at a door;
  - the crossing zones, the yielding to people and the "Excuse me" stops are gone.
  - The overview still shows the pods clearly, gliding above the cut walls.

## How it's built
**Contract (Opus, first), in `src/sim/places.ts` and `src/sim/config.ts`:**
- `ROBOT.rail`: underside and hanger heights.
- `ROBOT.podSize` becomes the hanging body (0.5 × 0.6 × 0.5) with `podBottomY` / `podTopY`.
- `PHARMACY.dockPortY`.
- A per-room chute anchor (`DRAWER_CHUTE`).
- `CONFIG.pharmacy.dropHeight` = 2.45.
- **The circuit lines do not change.** The pods' routing, spacing, docking and the order pipeline stay exactly as they are; only the height and what they share with people change.

**Agents:**

| Agent | Model | Owns | Builds |
|---|---|---|---|
| Rails & pods | sonnet | `src/scene/robots/**` | The rail geometry from the circuits (straights, U-turn and corner arcs, hangers, light line), the hanging pods (bogie, body, ring, face, bottom and side hatches, a small sway on accelerating and stopping), no blob shadows on the floor, and the floor lanes and arrows removed |
| Pharmacy core | sonnet | `src/scene/pharmacy/**` | The MedVend top dock ports, the picker reaching up and pushing packs into the pod's side hatch, the overhead rank, rail portals with flaps in place of the floor robot doors, and no robot paint on the core floor |
| Drawers & chutes | sonnet | `src/scene/drawers/**` | The fold-out funnel and the glass chute per room, packs sliding down into the drawer during delivery (instanced, no per-pack allocations) |
| Sim: pods off the floor | sonnet | `src/sim/crossings.ts`, `src/sim/meds/**`, `src/sim/nav/{layout,graph,crowd}.ts` (lane parts), `src/sim/reactions.ts` (pod parts), `src/sim/meals/**` (zone waits), and tests | No crossing zones and no pod–person yielding; people's paths may use the former lanes; the MealBots' and day spots' zone checks become doorway-only; every test updated with its meaning kept (determinism, every order `given`, no pod overlap, headway) |

**Order:**
1. Me: the contract.
2. The three scene agents start at once.
3. The sim agent starts when the step-aside agent (also in `crowd.ts` and `reactions.ts`) has finished.
4. Me: integration, the gates and a browser pass (overview and eye level: a pod gliding overhead, docking at a drawer, packs in the chute).

**Budget:** rails and chutes are merged per area: ≤ 6 extra draw calls and ≤ 40k triangles. Pods stay instanced, 10 at most.

## Verification
- **Node:**
  - Every order is still `given`, pods never overlap, and headway is kept.
  - The same seed gives the same day.
  - Nobody is ever stopped by a pod, and pods never stop for people.
  - People's routes are allowed on the former lane bands.
  - The chute and funnel anchors line up with each drawer and pod dock (a geometry test).
  - The rail stays under every ceiling and above 2.25 m everywhere (a geometry test).
- **Browser** (`?probe=1`):
  - from the overview: pods gliding above the corridors;
  - at eye level in a ward corridor: a pod passing overhead, then docking above a drawer with packs sliding down the chute;
  - in the pharmacy core: a pod loading at the top of the MedVend;
  - no console errors, and inside the budget.
