/**
 * R3 "Real screens": the imaging worker. It keeps only the newest job per slot (a probe that moved on makes the older frame worthless),
 * serves the waiting slots in priority order one job at a time (so new messages are read in between), and hands each finished picture back
 * as a transferred ImageBitmap (raw RGBA where the worker cannot make one).
 */
import { RenderCore } from './core'
import { SLOT_PRIORITY, type FrameOut, type Job } from './protocol'

interface WorkerScope {
  onmessage: ((e: MessageEvent<Job>) => void) | null
  postMessage(msg: unknown, transfer?: Transferable[]): void
}

const scope = self as unknown as WorkerScope
const core = new RenderCore()
const pending = new Map<string, Job>()
let scheduled = false

function next(): Job | null {
  let best: Job | null = null
  for (const j of pending.values()) if (!best || (SLOT_PRIORITY[j.slot] ?? 3) < (SLOT_PRIORITY[best.slot] ?? 3)) best = j
  if (best) pending.delete(best.slot)
  return best
}

async function run(): Promise<void> {
  scheduled = false
  const job = next()
  if (!job) return
  try {
    const r = core.handle(job)
    const msg: FrameOut = { t: 'frame', slot: job.slot, id: job.id, key: job.t === 'slice' ? job.key : '', w: r.w, h: r.h, meta: r.meta }
    if (typeof createImageBitmap === 'function') {
      msg.bitmap = await createImageBitmap(new ImageData(r.rgba as Uint8ClampedArray<ArrayBuffer>, r.w, r.h))
      scope.postMessage(msg, [msg.bitmap])
    } else {
      msg.rgba = r.rgba.buffer as ArrayBuffer
      scope.postMessage(msg, [msg.rgba])
    }
  } catch (err) {
    console.error('[imaging worker]', err)
  }
  if (pending.size > 0) schedule()
}

function schedule(): void {
  if (scheduled) return
  scheduled = true
  setTimeout(run, 0)
}

scope.onmessage = (e: MessageEvent<Job>) => {
  pending.set(e.data.slot, e.data)
  schedule()
}
