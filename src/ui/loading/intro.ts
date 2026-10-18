/**
 * Getting into the hospital: what holds the day until the presenter is ready, and what Enter does.
 *
 *   introFlags(search)          `?skipIntro=1`: no Enter button, the loading screen enters by itself when ready (scripted checks).
 *                               `?present=1` and `?probe=1` change nothing here: the loading screen shows for both.
 *   holdSim(ports)              pauses the simulation now, and puts it back to paused if anything unpauses it before Enter (the Space key,
 *                               the HUD button): the day starts when the presenter is ready, not when the shaders are.
 *   enterHospital(ports, opts)  unlocks audio (only for a real click or key: a browser rule), starts the day, marks `entered`.
 *
 * The ports are the real `loop`, `useWorld`, `useAudio` and `useWarmup` in the app (see ports.ts) and fakes in the tests. This file imports
 * nothing, so a test of it does not build the simulation.
 */
export interface IntroFlags {
  skipIntro: boolean
}

export function introFlags(search: string): IntroFlags {
  const q = new URLSearchParams(search)
  const v = q.get('skipIntro')
  return { skipIntro: v === '1' || v === 'true' }
}

export interface IntroPorts {
  sim: { paused: boolean; publishNow(): void }
  /** The slow world store, published whenever the sim loop publishes (at 4 Hz, and at once after a speed or pause change). */
  world: { subscribe(listener: (s: { paused: boolean }) => void): () => void }
  audio: { unlock(): void }
  gate: { enter(): void; entered(): boolean }
}

/** Pause the sim and keep it paused until Enter. Returns the function that stops watching (it does not unpause). */
export function holdSim(ports: IntroPorts): () => void {
  const hold = (): void => {
    ports.sim.paused = true
    ports.sim.publishNow()
  }
  hold()
  return ports.world.subscribe((s) => {
    if (!ports.gate.entered() && !s.paused) hold()
  })
}

export interface EnterOptions {
  /** A real click or key press (not `?skipIntro=1`): only then may audio be unlocked. */
  gesture: boolean
}

/** Start the day. Idempotent. */
export function enterHospital(ports: IntroPorts, { gesture }: EnterOptions): void {
  if (ports.gate.entered()) return
  if (gesture) ports.audio.unlock()
  // entered first, so the hold above stops putting the pause back, then the sim goes
  ports.gate.enter()
  ports.sim.paused = false
  ports.sim.publishNow()
}
