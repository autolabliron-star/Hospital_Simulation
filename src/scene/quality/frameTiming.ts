/**
 * The seam between the frame loop and the quality ladder, as a registry (rule 4: no imports between features).
 *
 * PowerLoop measures every drawn frame and calls `reportFrame`; <Quality /> registers the one sink that listens. Both numbers
 * are plain, so a frame reports without allocating:
 *
 *   workMs      how long `advance()` took on the main thread: the whole frame's CPU work, the simulation, the layers and the draw
 *               calls (the 12 ms budget in CLAUDE.md is measured against this).
 *   intervalMs  the gap since the previous DRAWN frame, from the animation-frame timestamps. A frame the GPU could not finish in
 *               time shows up here as a gap longer than the cap's interval: a missed 60 fps frame. 0 means "no previous frame"
 *               (the first one after a pause), which the ladder treats as a resume.
 *   refreshMs   the fastest refresh period the pacer has seen (0 until learned). When the browser throttles the page to 30 fps
 *               (Energy Saver, Low Power Mode) every frame is "late" against a 60 fps cap through no fault of the picture; the
 *               ladder reads the late limit against the slower of the cap and the display.
 */
export type FrameSink = (workMs: number, intervalMs: number, capFps: number, nowMs: number, refreshMs: number) => void

let sink: FrameSink | null = null

/** Register the listener (or null to remove it). One at a time: the quality ladder. */
export function setFrameSink(next: FrameSink | null): void {
  sink = next
}

/** Called by PowerLoop after every drawn frame. A no-op while nobody listens. */
export function reportFrame(workMs: number, intervalMs: number, capFps: number, nowMs: number, refreshMs: number): void {
  if (sink !== null) sink(workMs, intervalMs, capFps, nowMs, refreshMs)
}
