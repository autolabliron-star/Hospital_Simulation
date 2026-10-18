/**
 * Baking the light volume into its texture, behind the loading screen (W3).
 *
 * `ensureLightVolume()` runs the bake once per page: the pure baker (bake.ts) does about 30 ms of arithmetic, which it does in slices of at
 * most `SLICE_MS` with a frame in between, so the loading screen keeps moving and no frame is long. It registers a warm gate
 * ('light-volume', src/scene/warmup/registry.ts), so the warm-up's settle step waits for it (up to 10 s) and the texture's upload and the
 * programs that sample it are all ready before the Enter button appears. Nothing here runs again after that: the building is static
 * (a Jump swaps the people, not the walls), so one bake serves the whole session.
 *
 * The texture object (volumeTexture, uniforms.ts) is created at import filled with "no light, no occlusion" and is already uploaded by the
 * time a material samples it; the bake writes into its bytes and flags it once, and three re-uploads the 430 KB.
 */
import { registerWarmGate } from '@/scene/warmup/registry'
import { VolumeBaker } from './bake'
import { buildVolumeInput } from './input'
import { volumeTexture } from './uniforms'

/** The longest the bake works before it gives the page a frame (the CLAUDE.md budget for load-time slices). */
export const SLICE_MS = 8

export interface BakeClock {
  now(): number
  /** Let the page breathe: one animation frame, or a short timer in a tab that is not drawing. */
  frame(): Promise<void>
}

/** One animation frame, or 50 ms in a tab that is not drawing, whichever comes first. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish)
    setTimeout(finish, 50)
  })
}

export const browserClock: BakeClock = { now: () => performance.now(), frame: nextFrame }

export interface SlicedBakeResult {
  /** How many slices it took (1 when it never had to yield). */
  slices: number
  /** The longest a slice ran, ms by `clock.now`. */
  longestMs: number
}

/** Run `baker` to the end in slices of `budgetMs`, yielding a frame between them. */
export async function runSliced(baker: VolumeBaker, budgetMs: number, clock: BakeClock): Promise<SlicedBakeResult> {
  let slices = 0
  let longest = 0
  for (;;) {
    const t0 = clock.now()
    const done = baker.step(budgetMs, clock.now)
    slices++
    longest = Math.max(longest, clock.now() - t0)
    if (done) return { slices, longestMs: longest }
    await clock.frame()
  }
}

/** What the page can read: has the bake landed. */
export const lightVolume = { baked: false, failed: false, slices: 0, longestMs: 0 }

let started: Promise<void> | null = null

/** Start the bake (once) and hold the warm-up until it is done. Safe to call from an effect that mounts twice. */
export function ensureLightVolume(clock: BakeClock = browserClock): Promise<void> {
  if (started) return started
  const baker = new VolumeBaker(buildVolumeInput())
  started = runSliced(baker, SLICE_MS, clock)
    .then((r) => {
      ;(volumeTexture.image.data as Uint8Array).set(baker.data)
      volumeTexture.needsUpdate = true
      lightVolume.baked = true
      lightVolume.slices = r.slices
      lightVolume.longestMs = r.longestMs
    })
    .catch(() => {
      // a failed bake leaves the neutral volume: the rooms are lit by the hemisphere and the environment alone
      lightVolume.failed = true
    })
  registerWarmGate('light-volume', started)
  return started
}

/** For tests: forget the bake so it can run again. */
export function resetLightVolume(): void {
  started = null
  lightVolume.baked = false
  lightVolume.failed = false
  lightVolume.slices = 0
  lightVolume.longestMs = 0
}
