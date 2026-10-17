# The Ideal Hospital: project rules for all agents

Read `docs/PLAN.md` first. Build with the `living-3d-world` skill (`~/.claude/skills/living-3d-world`). Read its `SKILL.md` and `references/{hospital,architecture,performance-and-testing,pitfalls}.md` before writing sim, navigation, crowd or rendering code. The reference implementation is `/Users/lironhagbi/Waltz Game`: read it, never edit it.

## Architecture rules
1. Simulation state lives outside React: a fixed-step 60 Hz loop mutates a plain `Map`, and renderers read it inside `useFrame`. No React state per entity.
2. Seed everything: no `Math.random` under `src/sim`; use `src/sim/rng.ts`. `?seed=` replays the identical day.
3. Publish slow state (clock, counters, events) to zustand at about 4 Hz, never per frame.
4. Use registries (interact, seats, fx stores) instead of imports between features.
5. The orchestrator owns the contract files: `src/sim/types.ts`, `src/sim/places.ts`, `src/sim/config.ts` and the registries. Ask for changes under "Change requests", and re-read a contract right before using it.
6. Follow the frame order in `src/scene/camera/frameOrder.ts`. Use negative `useFrame` priorities only.
7. No allocations inside `useFrame` (no `new Vector3`, `Color`, arrays or closures).

## Performance budget (the live demo must never stutter)
- At the default view, shadow passes included: ≤300 draw calls, ≤1.2 M triangles, ≤12 ms per frame. Measure with `?probe=1`.
- Geometry is procedural, instanced or merged, with about 20 shared materials. No runtime downloads and no CDN: the demo runs offline.
- The building shadow is baked once; people and pods get blob shadows. Use emissive panels instead of real lights.
- Canvas screens redraw only when their content changes (≤2 Hz).

## Content and data
- Synthetic people only: no real patients, staff or identifiers. The medicine catalogue is a fixed demo list, and the sim makes no clinical decisions.
- All copy lives in `src/content/*.json` with a zod schema.

## Machine and process rules
- At most 2 heavy agents or processes at once. Run vitest with `--maxWorkers=2`.
- Never launch headless Chrome or open browsers. Never leave dev or preview servers running: kill whatever you start.
- Run build checks into a scratch `--outDir`.
- npm: exact versions only, `npm install --ignore-scripts`, then `npm audit`. Asset downloads go only through `docs/ASSETS-POLICY.md`.
- Delegate simple or mechanical tasks to subagents on lower models (haiku), and moderate feature work to sonnet.

## Verification
- `npm run typecheck`, `npm test` and `npm run build` must pass before a wave is done.
- Prove the simulation in node tests: determinism, every journey and order terminates, reachability, no deadlocks.

## Final report format (every agent)
- **Done:** files created or changed
- **How to verify:** commands
- **Change requests:** edits needed in contract files
- **Open questions / risks**
