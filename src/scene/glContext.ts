/**
 * F-44: the WebGL context can be lost and restored while the demo runs (a GPU reset, an external display plugged in or out). three re-creates
 * its own state on `webglcontextrestored` and re-uploads every texture and buffer it still has on the CPU side, but whatever only ever lived on
 * the GPU is gone: the PMREM environments (render targets), the static shadow map. Those owners rebuild themselves when this fires.
 *
 *   `glContext.epoch`       a counter bumped on every restore; a per-frame reader compares it with the one it last saw (no subscription)
 *   `watchContextRestore`   listens on the canvas, bumps the epoch, then calls `onRestored` (three's own listener was added first, at renderer
 *                           creation, so by then the renderer is usable again)
 */
export const glContext = { epoch: 0 }

export function watchContextRestore(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, onRestored: () => void): () => void {
  const handler = (): void => {
    glContext.epoch++
    onRestored()
  }
  target.addEventListener('webglcontextrestored', handler)
  return () => target.removeEventListener('webglcontextrestored', handler)
}
