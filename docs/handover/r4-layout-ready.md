# R4 layout ready (agent B, 2026-10-26)

The cryoablation suite's layout and the lounge re-layout are in the tree. They pass typecheck, `cryoRoom.test.ts`, `shell.test.ts` (with A's nav
graph), `layout.test.ts`, the walk tests and the player tests.

## Files
- `src/scene/rooms/surgery/cryoRoom.ts` (new; called from `rooms/surgery/index.ts`). It exports `CRYO_FOOTPRINTS`, `CRYO_SEATS`,
  `CRYO_TABLE_APPROACH` and `bezelBehind`.
- `src/scene/rooms/surgery/shell.ts`: the lounge is re-laid inside z 2..10, and the PACU supply cabinet is shortened.

## Footprints (drawn x; sim x = drawn + 150; ids without the `footprint:` prefix)

| Id | x | z | Bake |
|---|---|---|---|
| `l2:cryo:ct:gantry` | -60.45..-59.55 | 16.45..18.35 | live, rect only |
| `l2:cryo:ct:table` | -58.8..-55.9 | 17.15..17.65 | live, rect only |
| `l2:cryo:robot` | -58.25..-56.95 | 15.85..16.65 | baked; arm live from `CRYO_SUITE.robot.mount` |
| `l2:cryo:console` | -59.35..-58.65 | 14.1..15.1 | baked |
| `l2:cryo:cylinders` | -61.0..-60.2 | 14.1..14.7 | baked |
| `l2:cryo:cabinet` | -61.0..-58.6 | **21.35..21.9** | baked; **5 cm north of the brief** (half-wall rule: inner face z 21.9) |
| `l2:cryo:boom` | -57.5..-57.3 | 19.2..19.4 | overhead marker (centre -57.4, 19.3) |
| `l2:cryoctl:desk` | -61.4..-58.6 | 12.2..12.8 | baked |
| `l2:cryoctl:station` | -58.0..-56.6 | 12.2..12.8 | baked |

## Lounge (area `l2Lounge`, z 2..10; same ids)

| Id | Where | Notes |
|---|---|---|
| `l2:lounge:recliner0`..`2` | (-60.9, 4.0 / 6.2 / 8.4) | heading -pi/2, 0.8 x 1.05 |
| `l2:lounge:recliner3` | (-58.4, 9.3) | heading pi |
| `l2:lounge:side5.1`, `l2:lounge:side7.3` | (-60.9, 5.1 / 7.3) | circle r 0.24. **The ids changed** from `side8.5` / `side14.5`. |
| `l2:lounge:sofa0` | (-53.7, 6.6) | heading -pi/2, 2.2 x 0.85 |
| `l2:lounge:table0` | (-55.5, 6.6) | heading -pi/2, 0.94 x 0.54 |
| `l2:lounge:sofa1` | (-54.6, 2.55) | heading 0 |
| `l2:lounge:table1` | (-54.6, 3.9) | heading 0 |
| `l2:lounge:rug` | (-56.2, 6.6) | overhead marker; plane 3.0 x 3.6 |
| `l2:lounge:tea` | (-55.4, 9.55) | 3.26 x 0.66 |
| `l2:lounge:cooler` | (-53.5, 8.6) | circle r 0.22 |
| `l2:lounge:plantN`, `l2:lounge:plantS` | (-61.2, 2.7), (-61.2, 9.4) | circle r 0.36 |

- **PACU:** `l2:pacu:supply` is now x -52.825..-52.275, z 12.2..15.6 (centre z 13.9).

## Seats (sim x)

| Seat | Kind / pose | Spot | Height | Heading | Approach |
|---|---|---|---|---|---|
| `scanTable:cryo` | scanTable / lie | `CRYO_SUITE.ct.table.out` (l2(-57.0), 17.4) | 0.8 | +pi/2 (head west) | (l2(-55.5), 17.4) |
| `console:cryo:ct` | console / sit | `CRYO_SUITE.seats.ctConsole` (l2(-60.0), 11.75) | 0.5 | 0 | builder: behind, about (l2(-60.0), 11.25) |
| `console:cryo:robot` | console / sit | `CRYO_SUITE.seats.robotStation` (l2(-57.3), 11.75) | 0.5 | 0 | builder: behind, about (l2(-57.3), 11.25) |

The lounge seat ids are unchanged. The two `sofa1` seats have hand-set approaches at (l2(-56.15), 3.0) and (l2(-53.65), 3.6).

## Screens (for C's bezels)
- The live faces are at the `CRYO_SUITE.screens.*` anchors and at `console.screen`. Each face's normal is
  `(sin h * cos tilt, sin tilt, cos h * cos tilt)`: `tilt` leans the face back, so it faces up.
- The procedural fallback draws a 3 cm metalDark bezel, 2 cm larger all round, with its front 3 mm behind the face (`bezelBehind`).

## Walls and floors
- `OBSERVATION_PAIRS` gains `l2CryoControl` / `l2Cryo`, so the glass at z 13 is full height.
- Floors: `l2Cryo` uses floorBlue and `l2CryoControl` floorMint.
- The suite's outer walls are solid, not glazed.
