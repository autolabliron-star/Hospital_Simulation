/**
 * The MedVend picker on one face of the dispensing island. It serves docked pods first come, first served:
 * for each pack of the order it travels to the medicine's bin, picks, travels to the pod's dock port and
 * drops the pack into the next free compartment. The carriage position is part of the shared Gantry
 * state so the renderer can animate the arm exactly where the sim says it is.
 */
import { CONFIG } from '../config'
import { PHARMACY } from '../places'
import type { Gantry, Order, WardId } from '../types'

const C = CONFIG.pharmacy
const G = PHARMACY.gantry
const B = PHARMACY.bins

export interface DispenseJob {
  order: Order
  podId: string
  /** Index into PHARMACY.docks[ward]. */
  port: number
}

/** Bin slot → carriage position on the face. */
export function binPosition(bin: number, out: { x: number; y: number }): { x: number; y: number } {
  const col = bin % B.columns
  const row = Math.floor(bin / B.columns)
  out.x = G.xMin + ((col + 0.5) * (G.xMax - G.xMin)) / B.columns
  out.y = G.yMin + ((row + 0.5) * (G.yMax - G.yMin)) / B.rows
  return out
}

export interface DispenserHooks {
  /** A pack landed in the pod: put it in a compartment and log it. */
  onPicked(job: DispenseJob, itemIndex: number): void
  /** Every pack of the job is in the pod. */
  onJobDone(job: DispenseJob): void
  /** Look up a medicine's bin slot. */
  binOf(medId: string): number
}

export class Dispenser {
  readonly gantry: Gantry
  /** Carriage position at the start of the step (for interpolation). */
  prevX: number
  prevY: number
  /** Interpolated carriage position for the renderer, written by `sync`. */
  renderX: number
  renderY: number
  private readonly queue: DispenseJob[] = []
  private job: DispenseJob | null = null
  private fromX = 0
  private fromY = 0
  private toX = 0
  private toY = 0
  private duration = 0
  private readonly scratch = { x: 0, y: 0 }

  constructor(
    ward: WardId,
    private readonly hooks: DispenserHooks,
  ) {
    this.gantry = { ward, state: 'idle', x: 0, y: G.yMin + 1, itemIndex: 0, port: 0, timer: 0 }
    this.prevX = this.renderX = this.gantry.x
    this.prevY = this.renderY = this.gantry.y
  }

  sync(alpha: number): void {
    this.renderX = this.prevX + (this.gantry.x - this.prevX) * alpha
    this.renderY = this.prevY + (this.gantry.y - this.prevY) * alpha
  }

  enqueue(job: DispenseJob): void {
    this.queue.push(job)
  }

  get busy(): boolean {
    return this.job !== null || this.queue.length > 0
  }

  step(dt: number): void {
    const g = this.gantry
    this.prevX = g.x
    this.prevY = g.y
    if (!this.job) {
      const next = this.queue.shift()
      if (!next) {
        g.state = 'idle'
        g.orderId = undefined
        return
      }
      this.job = next
      g.orderId = next.order.id
      g.port = next.port
      g.itemIndex = 0
      this.startMoveToBin()
    }
    g.timer -= dt
    if (g.state === 'toBin' || g.state === 'toPort') {
      const k = this.duration > 0 ? 1 - Math.max(0, g.timer) / this.duration : 1
      // ease in and out so the arm doesn't jerk
      const e = k * k * (3 - 2 * k)
      g.x = this.fromX + (this.toX - this.fromX) * e
      g.y = this.fromY + (this.toY - this.fromY) * e
    }
    if (g.timer > 0) return
    const job = this.job!
    switch (g.state) {
      case 'toBin':
        g.state = 'picking'
        g.timer = C.pickSeconds
        break
      case 'picking': {
        const port = PHARMACY.docks[g.ward][job.port]
        this.startMove(port.x, C.dropHeight)
        g.state = 'toPort'
        break
      }
      case 'toPort':
        g.state = 'dropping'
        g.timer = C.dropSeconds
        break
      case 'dropping':
        this.hooks.onPicked(job, g.itemIndex)
        g.itemIndex++
        if (g.itemIndex < job.order.items.length) {
          this.startMoveToBin()
        } else {
          this.hooks.onJobDone(job)
          this.job = null
          g.state = 'idle'
          g.orderId = undefined
        }
        break
      default:
        break
    }
  }

  private startMoveToBin(): void {
    const job = this.job!
    const item = job.order.items[this.gantry.itemIndex]
    const p = binPosition(this.hooks.binOf(item.medId), this.scratch)
    this.startMove(p.x, p.y)
    this.gantry.state = 'toBin'
  }

  private startMove(x: number, y: number): void {
    const g = this.gantry
    this.fromX = g.x
    this.fromY = g.y
    this.toX = x
    this.toY = y
    this.duration = Math.max(Math.abs(x - g.x) / C.gantrySpeedX, Math.abs(y - g.y) / C.gantrySpeedY, 0.25)
    g.timer = this.duration
  }
}
