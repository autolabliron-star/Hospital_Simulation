/**
 * The look as it is right now, for the few things that are not a uniform the driver can write itself (W3). The daylight driver
 * (src/scene/daylight/driver.ts) is the only writer; the readers poll it once a frame, at a negative priority, and act only when `version`
 * moved, so nothing here allocates or re-renders anything:
 *
 *   Lighting.tsx   binds the hospital environment while `hospitalEnv` is true, RoomEnvironment otherwise (the driver already wrote the
 *                  environment intensity for the one that is bound, in the same frame);
 *   Effects.tsx    writes `grade` into the LUT effect's blend opacity and `vignette` into the vignette's darkness.
 *
 * A plain module-level record (the pattern of walkBody and the registries): no React state per frame.
 */
export const liveLook = {
  /** The indoor blend, 0 (the overview) .. 1 (walking). */
  blend: 0,
  /** The environment to bind: true = the hospital's, false = RoomEnvironment. Decided with a band of hysteresis around the swap point. */
  hospitalEnv: false,
  /** The colour grade's blend opacity, 0..1. */
  grade: 0,
  /** The vignette's darkness (0 = untouched). */
  vignette: 0,
  /** Bumped on every driver write that changed any field above. */
  version: 0,
}
