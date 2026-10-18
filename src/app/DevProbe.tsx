import { useEffect, useState, type CSSProperties } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { WebGLRenderer } from 'three'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { MAX_LEVEL } from '@/scene/quality/ladder'
import { useRenderStore } from '@/scene/quality/render.store'
import { usePower, usePresent } from './power'

/**
 * Performance probe for the scripted checks and the presenter's `?probe=1` view. It holds the budget in CLAUDE.md
 * (at most 300 draw calls, 1.2 M triangles and 12 ms per frame at the default view, shadow passes included).
 *
 * The post-processing composer renders several times per frame and each render resets `renderer.info`, so the probe
 * turns auto-reset off, reads the totals of the previous whole frame before anything draws in the current one, and
 * then resets the counters itself.
 *
 * Off unless the URL has `?probe=1`. `DevProbe` does nothing and `ProbeOverlay` renders nothing without it, so the
 * presenter's dev view stays clean, and mounting `DevProbe` unconditionally is safe.
 */
export const probeEnabled =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('probe') === '1'

/** Frame times kept for the average and the p95. */
const HISTORY = 600

export interface FrameProbe {
  /** Draw calls of the previous whole frame. */
  calls: number
  /** Triangles of the previous whole frame. */
  triangles: number
  /** Frame interval of the previous frame, in ms. */
  frameMs: number
  /** Ring buffer of the last HISTORY frame times in ms. The valid samples are `history[0..count)`, not in time order once it wraps. */
  history: Float32Array
  /** Index the next sample is written to. */
  head: number
  /** Number of valid samples, at most HISTORY. */
  count: number
}

/** Module-level and pre-allocated: the frame callback writes into it and allocates nothing. */
export const probe: FrameProbe = {
  calls: 0,
  triangles: 0,
  frameMs: 0,
  history: new Float32Array(HISTORY),
  head: 0,
  count: 0,
}

export interface HospitalHandle {
  gl: WebGLRenderer
  probe: FrameProbe
}

type HospitalWindow = { __hospital?: HospitalHandle }

function hospitalHandle(): HospitalHandle | undefined {
  return (window as unknown as HospitalWindow).__hospital
}

export interface ProbeStats {
  /** Average frame rate over the history, from the mean frame time. */
  fps: number
  /** 95th percentile frame time over the history (nearest rank), in ms. */
  p95Ms: number
  /** Number of samples the stats cover. */
  samples: number
}

/** Stats over the rolling history. It allocates, so call it outside the frame loop (the overlay does, at 2 Hz). */
export function probeStats(): ProbeStats {
  const n = probe.count
  if (n === 0) return { fps: 0, p95Ms: 0, samples: 0 }
  const sorted = probe.history.slice(0, n)
  let sum = 0
  for (let i = 0; i < n; i++) sum += sorted[i]
  sorted.sort()
  const p95Ms = sorted[Math.max(0, Math.ceil(n * 0.95) - 1)]
  const mean = sum / n
  return { fps: mean > 0 ? 1000 / mean : 0, p95Ms, samples: n }
}

/** Mount inside the `<Canvas>`. Renders nothing; it only measures. */
export function DevProbe() {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    if (!probeEnabled) return
    const w = window as unknown as HospitalWindow
    gl.info.autoReset = false
    w.__hospital = { gl, probe }
    return () => {
      gl.info.autoReset = true
      delete w.__hospital
    }
  }, [gl])

  // Priority -1000 runs before every other callback, so the totals read here are those of the frame that just finished.
  useFrame((_, delta) => {
    if (!probeEnabled) return
    const ms = delta * 1000
    probe.calls = gl.info.render.calls
    probe.triangles = gl.info.render.triangles
    probe.frameMs = ms
    probe.history[probe.head] = ms
    probe.head = probe.head + 1 === HISTORY ? 0 : probe.head + 1
    if (probe.count < HISTORY) probe.count++
    gl.info.reset()
  }, FRAME_PRIORITY.probe)

  return null
}

const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  left: 12,
  bottom: 12,
  zIndex: 50,
  pointerEvents: 'none',
  padding: '6px 8px',
  borderRadius: 6,
  background: 'rgba(10, 12, 16, 0.6)',
  color: '#d6dde8',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 11,
  lineHeight: 1.45,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'pre',
}

/** 312000 -> "312 k", 1234567 -> "1.23 M". */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M`
  if (n >= 1_000) return `${Math.round(n / 1_000)} k`
  return String(n)
}

interface OverlayView {
  calls: number
  triangles: number
  fps: number
  p95Ms: number
  dpr: number
  renderDpr: number | null
  /** The quality ladder (scene/quality) and the power state (app/power): which rung, what the last window saw, the frame cap. */
  level: number
  ladderDpr: number
  ao: string
  forced: boolean
  workP95: number
  lateShare: number
  cap: number
  present: boolean
  paused: boolean
}

/** DOM overlay, mounted outside the `<Canvas>`. Refreshes at 2 Hz, not per frame. */
export function ProbeOverlay() {
  const [view, setView] = useState<OverlayView | null>(null)

  useEffect(() => {
    if (!probeEnabled) return
    const tick = () => {
      const stats = probeStats()
      const rq = useRenderStore.getState()
      const power = usePower.getState()
      setView({
        calls: probe.calls,
        triangles: probe.triangles,
        fps: stats.fps,
        p95Ms: stats.p95Ms,
        dpr: window.devicePixelRatio,
        renderDpr: hospitalHandle()?.gl.getPixelRatio() ?? null,
        level: rq.level,
        ladderDpr: rq.dpr,
        ao: rq.step.ao,
        forced: !rq.auto,
        workP95: rq.workP95,
        lateShare: rq.lateShare,
        cap: power.fps,
        present: usePresent.getState().on,
        paused: power.paused,
      })
    }
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [])

  if (!probeEnabled || !view) return null

  return (
    <div style={OVERLAY_STYLE}>
      <div>draw calls  {view.calls}</div>
      <div>triangles   {formatCount(view.triangles)}</div>
      <div>avg fps     {view.fps.toFixed(1)}</div>
      <div>p95 frame   {view.p95Ms.toFixed(1)} ms</div>
      <div>dpr         {view.dpr.toFixed(2)} (render {view.renderDpr === null ? '-' : view.renderDpr.toFixed(2)})</div>
      <div>quality     L{view.level}/{MAX_LEVEL} dpr {view.ladderDpr.toFixed(2)} ao {view.ao}{view.forced ? ' (forced)' : ''}</div>
      <div>last window work p95 {view.workP95.toFixed(1)} ms, late {(view.lateShare * 100).toFixed(1)} %</div>
      <div>power       cap {view.cap} fps{view.present ? ', present' : ''}{view.paused ? ', PAUSED' : ''}</div>
    </div>
  )
}
