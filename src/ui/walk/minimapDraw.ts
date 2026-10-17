/**
 * The minimap's canvas drawing (walk mode), apart from React and from the sim module so node tests can run it on a recording
 * context. Each tick: the floor plan, a diamond at the room your order is going to, the pods as dots (a ring round the one that
 * carries your order), and you as an arrow. No state: everything it draws comes from its arguments.
 */
import type { YourOrderView } from '@/scene/interact/yourOrder'
import { roomById } from '@/sim/places'
import type { Pod } from '@/sim/types'
import { ARROW_COLOR, MAP_INK, ORDER_COLOR, POD_COLOR, arrowAngle, pulse, toMapX, toMapY } from './minimapModel'
import type { PlanLayer } from './minimapPlan'

/** What the minimap reads of the hospital. */
export interface MapWorld {
  meds: { fleet: { drivers: readonly { pod: Pick<Pod, 'id' | 'position' | 'light' | 'orderId'> }[] } }
  player: { x: number; z: number; heading: number } | null
}

/** An order is live on the map from the moment you prescribe it until it is given (or cancelled). */
export function isLive(order: YourOrderView | null): order is YourOrderView {
  return order !== null && order.stage !== 'given' && order.stage !== 'cancelled'
}

export function drawMinimap(ctx: CanvasRenderingContext2D, plan: Pick<PlanLayer, 'canvas' | 'frame'>, world: MapWorld, order: YourOrderView | null, dpr: number, nowMs: number): void {
  const f = plan.frame
  ctx.clearRect(0, 0, f.width, f.height)
  ctx.drawImage(plan.canvas, 0, 0)

  const live = isLive(order)

  // where your order is going: a diamond at the room's door
  if (live) {
    const door = roomById(order.roomId).door
    const x = toMapX(f, door.x)
    const y = toMapY(f, door.z)
    const r = 4.2 * dpr
    ctx.beginPath()
    ctx.moveTo(x, y - r)
    ctx.lineTo(x + r, y)
    ctx.lineTo(x, y + r)
    ctx.lineTo(x - r, y)
    ctx.closePath()
    ctx.fillStyle = ORDER_COLOR
    ctx.fill()
    ctx.lineWidth = 1.4 * dpr
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
  }

  // the pods
  ctx.lineWidth = 1 * dpr
  ctx.strokeStyle = MAP_INK
  for (const d of world.meds.fleet.drivers) {
    const p = d.pod
    const x = toMapX(f, p.position.x)
    const y = toMapY(f, p.position.z)
    ctx.beginPath()
    ctx.arc(x, y, 2.5 * dpr, 0, Math.PI * 2)
    ctx.fillStyle = POD_COLOR[p.light]
    ctx.fill()
    ctx.stroke()
    // the ring round the pod that carries your order
    if (live && order.podId === p.id && p.orderId === order.orderId) {
      const k = pulse(nowMs)
      ctx.beginPath()
      ctx.arc(x, y, (5 + 4 * k) * dpr, 0, Math.PI * 2)
      ctx.lineWidth = 2 * dpr
      ctx.globalAlpha = 1 - 0.6 * k
      ctx.strokeStyle = ORDER_COLOR
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.lineWidth = 1 * dpr
      ctx.strokeStyle = MAP_INK
    }
  }

  // you: a pale disc and an arrow that turns with you
  const me = world.player
  if (me) {
    ctx.save()
    ctx.translate(toMapX(f, me.x), toMapY(f, me.z))
    ctx.beginPath()
    ctx.arc(0, 0, 7.5 * dpr, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fill()
    ctx.rotate(arrowAngle(me.heading))
    ctx.beginPath()
    ctx.moveTo(0, -6.5 * dpr)
    ctx.lineTo(4.6 * dpr, 5 * dpr)
    ctx.lineTo(0, 2.4 * dpr)
    ctx.lineTo(-4.6 * dpr, 5 * dpr)
    ctx.closePath()
    ctx.fillStyle = ARROW_COLOR
    ctx.fill()
    ctx.lineWidth = 1.4 * dpr
    ctx.strokeStyle = '#ffffff'
    ctx.lineJoin = 'round'
    ctx.stroke()
    ctx.restore()
  }
}
