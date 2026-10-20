/**
 * R3 "Real screens": the main thread's side of the imaging worker. A BACKEND takes jobs and keeps the newest finished frame per slot until a
 * screen takes it:
 *
 *   worker   the browser: a module Web Worker (bundled by Vite, works offline), frames arrive as ImageBitmaps a few milliseconds later
 *   inline   node tests: the same RenderCore, synchronously, frames as RGBA
 *
 * `imagingBackend()` gives the page's worker backend, or null where there is no Worker (or with `?imaging=legacy`): the screens then keep
 * the R1 vector painters. Receiving a frame only files it; drawing happens in the screens' own (rate-limited) update.
 */
import { RenderCore } from './core'
import type { FrameMeta, FrameOut, Job } from './protocol'

export interface FrameIn {
  id: number
  key: string
  w: number
  h: number
  meta: FrameMeta
  bitmap?: ImageBitmap
  rgba?: Uint8ClampedArray
}

export interface BackendStats {
  sent: number
  received: number
  /** Worker milliseconds of the last frame per slot. */
  lastMs: Record<string, number>
}

export interface ImagingBackend {
  readonly kind: 'worker' | 'inline'
  send(job: Job): void
  /** The newest finished frame of a slot (once: it is handed over), or null. */
  take(slot: string): FrameIn | null
  readonly stats: BackendStats
  dispose(): void
}

function release(f: FrameIn | undefined): void {
  f?.bitmap?.close()
}

export class InlineBackend implements ImagingBackend {
  readonly kind = 'inline' as const
  readonly stats: BackendStats = { sent: 0, received: 0, lastMs: {} }
  private readonly core = new RenderCore()
  private readonly inbox = new Map<string, FrameIn>()

  send(job: Job): void {
    this.stats.sent++
    const r = this.core.handle(job)
    this.stats.received++
    this.stats.lastMs[job.slot] = r.meta.ms
    this.inbox.set(job.slot, { id: job.id, key: job.t === 'slice' ? job.key : '', w: r.w, h: r.h, meta: r.meta, rgba: r.rgba })
  }

  take(slot: string): FrameIn | null {
    const f = this.inbox.get(slot) ?? null
    this.inbox.delete(slot)
    return f
  }

  dispose(): void {
    this.inbox.clear()
  }
}

class WorkerBackend implements ImagingBackend {
  readonly kind = 'worker' as const
  readonly stats: BackendStats = { sent: 0, received: 0, lastMs: {} }
  private readonly inbox = new Map<string, FrameIn>()

  constructor(private readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent<FrameOut>) => {
      const m = e.data
      if (m.t !== 'frame') return
      this.stats.received++
      this.stats.lastMs[m.slot] = m.meta.ms
      release(this.inbox.get(m.slot))
      this.inbox.set(m.slot, { id: m.id, key: m.key, w: m.w, h: m.h, meta: m.meta, bitmap: m.bitmap, rgba: m.rgba ? new Uint8ClampedArray(m.rgba) : undefined })
    }
    worker.onerror = (e) => console.warn('[imaging] worker error', e.message)
  }

  send(job: Job): void {
    this.stats.sent++
    this.worker.postMessage(job)
  }

  take(slot: string): FrameIn | null {
    const f = this.inbox.get(slot) ?? null
    this.inbox.delete(slot)
    return f
  }

  dispose(): void {
    for (const f of this.inbox.values()) release(f)
    this.inbox.clear()
    this.worker.terminate()
  }
}

let shared: ImagingBackend | null | undefined

/** The page's imaging backend (made on first call: call it during loading), or null to keep the vector painters. */
export function imagingBackend(): ImagingBackend | null {
  if (shared !== undefined) return shared
  shared = null
  try {
    const legacy = typeof location !== 'undefined' && new URLSearchParams(location.search).get('imaging') === 'legacy'
    if (!legacy && typeof Worker !== 'undefined') {
      shared = new WorkerBackend(new Worker(new URL('./imaging.worker.ts', import.meta.url), { type: 'module' }))
    }
  } catch (err) {
    console.warn('[imaging] no worker; keeping the vector images', err)
    shared = null
  }
  return shared
}
