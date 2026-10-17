import { describe, expect, it } from 'vitest'
import type { YourOrderView } from '@/scene/interact/yourOrder'
import { CONFIG } from '@/sim/config'
import { PLAYER_SPAWN, roomById } from '@/sim/places'
import { Simulation } from '@/sim/Simulation'
import { drawMinimap, isLive, type MapWorld } from './minimapDraw'
import { ARROW_COLOR, ORDER_COLOR, POD_COLOR, arrowAngle, mapFrame, toMapX, toMapY } from './minimapModel'

type Call = { op: string; args: number[]; fill: string; stroke: string }

/** A canvas context that only writes down what it is asked to draw. */
function recorder() {
  const calls: Call[] = []
  const state = { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, lineJoin: '' }
  const note =
    (op: string) =>
    (...args: unknown[]): void => {
      calls.push({ op, args: args.filter((a): a is number => typeof a === 'number'), fill: state.fillStyle, stroke: state.strokeStyle })
    }
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop]
      return note(prop)
    },
    set(target, prop: string, value) {
      ;(target as Record<string, unknown>)[prop] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

/** The last call of an op (Array.prototype.findLast is newer than this project's lib). */
function last(calls: Call[], op: string): Call {
  for (let i = calls.length - 1; i >= 0; i--) if (calls[i].op === op) return calls[i]
  throw new Error(`no ${op} call`)
}

const dpr = 2
const plan = { canvas: { width: 0, height: 0 } as unknown as HTMLCanvasElement, frame: mapFrame(278 * dpr) }

const order = (over: Partial<YourOrderView> = {}): YourOrderView => ({ orderId: 'ord-1', roomId: 'A3', ward: 'A', stage: 'enRoute', podId: 'A1', text: '', ...over })

function world(player: MapWorld['player'], pods: { id: string; x: number; z: number; light: 'white' | 'teal' | 'amber' | 'green'; orderId?: string }[]): MapWorld {
  return {
    meds: { fleet: { drivers: pods.map((p) => ({ pod: { id: p.id, position: { x: p.x, y: 0, z: p.z }, light: p.light, orderId: p.orderId } })) } },
    player,
  }
}

describe('the minimap drawing', () => {
  it('draws the plan first, then the pods in their light colours, then you on top', () => {
    const { ctx, calls } = recorder()
    drawMinimap(ctx, plan, world({ x: -40, z: 0, heading: 0 }, [{ id: 'A1', x: 0, z: -14, light: 'teal' }, { id: 'B1', x: 10, z: 14, light: 'amber' }]), null, dpr, 0)
    expect(calls[0].op).toBe('clearRect')
    expect(calls[1].op).toBe('drawImage')
    const arcs = calls.filter((c) => c.op === 'arc')
    // two pods, then the disc under your arrow
    expect(arcs.length).toBe(3)
    expect(calls.filter((c) => c.op === 'fill').map((c) => c.fill)).toEqual([POD_COLOR.teal, POD_COLOR.amber, 'rgba(255,255,255,0.7)', ARROW_COLOR])
    const f = plan.frame
    expect(arcs[0].args.slice(0, 2)).toEqual([toMapX(f, 0), toMapY(f, -14)])
    expect(arcs[1].args.slice(0, 2)).toEqual([toMapX(f, 10), toMapY(f, 14)])
    // you are drawn last, at your place, turned to your heading
    expect(last(calls, 'translate').args).toEqual([toMapX(f, -40), toMapY(f, 0)])
    expect(last(calls, 'rotate').args).toEqual([arrowAngle(0)])
    expect(calls.some((c) => c.op === 'fill' && c.fill === ARROW_COLOR)).toBe(true)
  })

  it('draws no arrow when you are not in the hospital', () => {
    const { ctx, calls } = recorder()
    drawMinimap(ctx, plan, world(null, [{ id: 'A1', x: 0, z: -14, light: 'white' }]), null, dpr, 0)
    expect(calls.some((c) => c.op === 'translate')).toBe(false)
    expect(calls.some((c) => c.op === 'rotate')).toBe(false)
  })

  it('turns the arrow to face the way you face', () => {
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const { ctx, calls } = recorder()
      drawMinimap(ctx, plan, world({ x: 0, z: 0, heading }, []), null, dpr, 0)
      expect(calls.find((c) => c.op === 'rotate')!.args).toEqual([arrowAngle(heading)])
    }
  })

  it('marks your order: a ring round its pod and a diamond at the room it is going to', () => {
    const { ctx, calls } = recorder()
    const f = plan.frame
    const door = roomById('A3').door
    drawMinimap(
      ctx,
      plan,
      world(null, [{ id: 'A1', x: 5, z: -15, light: 'teal', orderId: 'ord-1' }, { id: 'A2', x: 8, z: 3, light: 'white' }]),
      order(),
      dpr,
      600,
    )
    // the diamond is the first thing drawn after the plan: four corners round the door
    const moves = calls.filter((c) => c.op === 'moveTo').slice(0, 1)[0]
    expect(moves.args[0]).toBeCloseTo(toMapX(f, door.x), 9)
    expect(calls.some((c) => c.op === 'fill' && c.fill === ORDER_COLOR)).toBe(true)
    // one ring in the order colour, round A1 only
    const rings = calls.filter((c) => c.op === 'stroke' && c.stroke === ORDER_COLOR)
    expect(rings.length).toBe(1)
    const arcs = calls.filter((c) => c.op === 'arc')
    const ring = arcs.find((a) => a.args[2] > 2.5 * dpr)!
    expect(ring.args.slice(0, 2)).toEqual([toMapX(f, 5), toMapY(f, -15)])
  })

  it('rings the pod only while it really carries your order', () => {
    const { ctx, calls } = recorder()
    // the pod named in your order has been sent back empty: no ring
    drawMinimap(ctx, plan, world(null, [{ id: 'A1', x: 5, z: -15, light: 'white', orderId: undefined }]), order(), dpr, 0)
    expect(calls.filter((c) => c.op === 'stroke' && c.stroke === ORDER_COLOR).length).toBe(0)
  })

  it('draws no marker once the order is given or cancelled, nor when you have none', () => {
    for (const o of [order({ stage: 'given' }), order({ stage: 'cancelled' }), null]) {
      const { ctx, calls } = recorder()
      drawMinimap(ctx, plan, world(null, [{ id: 'A1', x: 5, z: -15, light: 'teal', orderId: 'ord-1' }]), o, dpr, 0)
      expect(calls.some((c) => c.fill === ORDER_COLOR || c.stroke === ORDER_COLOR), String(o?.stage)).toBe(false)
    }
    expect(isLive(order({ stage: 'inDrawer' }))).toBe(true)
    expect(isLive(order({ stage: 'given' }))).toBe(false)
    expect(isLive(null)).toBe(false)
  })

  it('draws the real fleet and you at the entrance in a real hospital', () => {
    const sim = new Simulation(5)
    sim.addPlayer(PLAYER_SPAWN)
    for (let i = 0; i < 60; i++) sim.step(CONFIG.sim.step)
    sim.sync(1)
    const { ctx, calls } = recorder()
    drawMinimap(ctx, plan, sim, null, dpr, 0)
    // ten pods and the disc under your arrow
    expect(calls.filter((c) => c.op === 'arc').length).toBe(sim.meds.fleet.drivers.length + 1)
    const f = plan.frame
    expect(last(calls, 'translate').args).toEqual([toMapX(f, PLAYER_SPAWN.at.x), toMapY(f, PLAYER_SPAWN.at.z)])
  })
})
