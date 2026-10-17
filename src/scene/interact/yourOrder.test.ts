import { describe, expect, it } from 'vitest'
import { WALK } from '@/content/walk'
import { CONFIG } from '@/sim/config'
import { CIRCUITS, drawerS } from '@/sim/meds/circuit'
import { Simulation } from '@/sim/Simulation'
import type { Order, OrderStage, WardId } from '@/sim/types'
import { DONE_HOLD_MS, YourOrder, etaText, objectiveText, podEtaSeconds, simOrderHost, type ObjectiveFacts, type OrderHost, type PodFacts } from './yourOrder'

function order(over: Partial<Order> = {}): Order {
  return {
    id: 'ord-1',
    ward: 'A',
    roomId: 'A3',
    patientId: 'p-a3',
    items: [{ medId: 'paracetamol', qty: 1 }],
    prescriberId: 'presenter',
    source: 'presenter',
    createdAt: 100,
    doseAt: 100,
    stage: 'prescribed',
    stageAt: { prescribed: 100 },
    ...over,
  }
}

const facts = (over: Partial<ObjectiveFacts> = {}): ObjectiveFacts => ({
  stage: 'prescribed',
  room: 'A3',
  pod: null,
  pharmacist: 'Pharmacist Noa',
  patient: 'Grace Adeyemi',
  etaSeconds: null,
  nurseOnTheWay: false,
  ...over,
})

describe('the ETA words', () => {
  it('says "under a minute" below 45 s and rounds to whole minutes after that', () => {
    expect(etaText(null)).toBe('under a minute')
    expect(etaText(0)).toBe('under a minute')
    expect(etaText(44)).toBe('under a minute')
    expect(etaText(45)).toBe('about 1 min')
    expect(etaText(95)).toBe('about 2 min')
    expect(etaText(240)).toBe('about 4 min')
  })
})

describe('the objective line through each stage', () => {
  it('follows the order rail with the words of walk.json', () => {
    expect(objectiveText(facts({ stage: 'prescribed' }))).toBe('Pharmacist Noa is checking your order for A3')
    expect(objectiveText(facts({ stage: 'verified' }))).toBe('Your order for A3 is checked and waiting for a pod')
    expect(objectiveText(facts({ stage: 'verified', pod: 'A1' }))).toBe('Pod A1 is on its way to collect your order for A3')
    expect(objectiveText(facts({ stage: 'picking', pod: 'A1' }))).toBe('MedVend is loading your order into pod A1')
    expect(objectiveText(facts({ stage: 'enRoute', pod: 'A1', etaSeconds: 118 }))).toBe('Pod A1 is bringing your order to A3: about 2 min')
    expect(objectiveText(facts({ stage: 'inDrawer', pod: 'A1' }))).toBe("Your order is in A3's drawer")
    expect(objectiveText(facts({ stage: 'inDrawer', nurseOnTheWay: true }))).toBe("Your order is in A3's drawer: a nurse is on the way")
    expect(objectiveText(facts({ stage: 'given' }))).toBe('Given to Grace Adeyemi in A3')
    expect(objectiveText(facts({ stage: 'cancelled' }))).toBe('Your order for A3 was cancelled: the patient has left the room')
  })

  it('has a sentence for every stage of the rail, and never a stray placeholder', () => {
    const stages: OrderStage[] = ['prescribed', 'verified', 'picking', 'enRoute', 'inDrawer', 'given']
    for (const stage of stages) {
      const text = objectiveText(facts({ stage, pod: 'B2', etaSeconds: 30 }))
      expect(text.length, stage).toBeGreaterThan(10)
      expect(text, stage).not.toMatch(/[{}]/)
    }
    expect(WALK.objective.enRoute).toContain('{eta}')
  })
})

/** A fixture host: the test edits `orders`, `now` and the pod by hand. */
function fixture() {
  const orders = new Map<string, Order>()
  const state = {
    now: 0,
    pod: { id: 'A1', s: 0, state: 'enRoute', orderId: 'ord-1' } as PodFacts,
    eta: 100 as number | null,
    claimed: false,
  }
  const host: OrderHost = {
    now: () => state.now,
    order: (id) => orders.get(id),
    newestOpen: () => {
      let best: Order | undefined
      for (const o of orders.values()) if (o.source === 'presenter' && o.stage !== 'given' && o.cancelledAt === undefined && (!best || o.createdAt >= best.createdAt)) best = o
      return best
    },
    pod: (id) => (id === state.pod.id ? state.pod : undefined),
    etaSeconds: () => state.eta,
    pharmacist: (w: WardId) => (w === 'A' ? 'Pharmacist Noa' : 'Pharmacist Ravi'),
    patient: () => 'Grace Adeyemi',
    nurseOnTheWay: () => state.claimed,
  }
  return { orders, state, host }
}

describe('YourOrder: the tracker', () => {
  it('says nothing until you prescribe', () => {
    const { host } = fixture()
    const t = new YourOrder()
    expect(t.poll(host)).toBeNull()
    expect(t.current()).toBeNull()
  })

  it('follows one order through every stage, then clears after the hold', () => {
    const { orders, state, host } = fixture()
    const t = new YourOrder()
    const o = order()
    orders.set(o.id, o)
    const lines: string[] = []
    const step = (stage: OrderStage, extra: Partial<Order> = {}) => {
      Object.assign(o, { stage }, extra)
      state.now += 250
      lines.push(t.poll(host)!.text)
    }
    step('prescribed')
    step('verified')
    step('verified', { podId: 'A1' })
    step('picking')
    step('enRoute')
    step('inDrawer')
    state.claimed = true
    step('inDrawer')
    step('given')
    expect(lines).toEqual([
      'Pharmacist Noa is checking your order for A3',
      'Your order for A3 is checked and waiting for a pod',
      'Pod A1 is on its way to collect your order for A3',
      'MedVend is loading your order into pod A1',
      'Pod A1 is bringing your order to A3: about 2 min',
      "Your order is in A3's drawer",
      "Your order is in A3's drawer: a nurse is on the way",
      'Given to Grace Adeyemi in A3',
    ])
    // "Given" stays for a few seconds, then the line clears
    state.now += DONE_HOLD_MS - 500
    expect(t.poll(host)!.text).toBe('Given to Grace Adeyemi in A3')
    state.now += 600
    expect(t.poll(host)).toBeNull()
    // and it does not come back
    state.now += 10_000
    expect(t.poll(host)).toBeNull()
  })

  it('reports the pod and the room for the minimap marker', () => {
    const { orders, host } = fixture()
    const t = new YourOrder()
    orders.set('ord-1', order({ stage: 'enRoute', podId: 'A1' }))
    const v = t.poll(host)!
    expect(v).toMatchObject({ orderId: 'ord-1', roomId: 'A3', ward: 'A', stage: 'enRoute', podId: 'A1' })
    // an unchanged order gives back the same view object (nothing to republish)
    expect(t.poll(host)).toBe(v)
  })

  it('ignores orders that are not yours and orders that were already given', () => {
    const { orders, host } = fixture()
    const t = new YourOrder()
    orders.set('ord-1', order({ source: 'sim', prescriberId: 'doctor-1' }))
    orders.set('ord-2', order({ id: 'ord-2', stage: 'given' }))
    orders.set('ord-3', order({ id: 'ord-3', source: 'schedule' }))
    expect(t.poll(host)).toBeNull()
  })

  it('reports a cancelled order and then lets go of it', () => {
    const { orders, state, host } = fixture()
    const t = new YourOrder()
    const o = order({ stage: 'verified' })
    orders.set(o.id, o)
    expect(t.poll(host)!.stage).toBe('verified')
    o.cancelledAt = 120
    state.now += 250
    const v = t.poll(host)!
    expect(v.stage).toBe('cancelled')
    expect(v.text).toBe('Your order for A3 was cancelled: the patient has left the room')
    state.now += DONE_HOLD_MS + 1
    expect(t.poll(host)).toBeNull()
  })

  it('follows the newest order, and an older one in flight takes over when the newer one is done', () => {
    const { orders, state, host } = fixture()
    const t = new YourOrder()
    const first = order({ id: 'ord-1', roomId: 'A3', createdAt: 100 })
    orders.set(first.id, first)
    expect(t.poll(host)!.roomId).toBe('A3')
    const second = order({ id: 'ord-2', roomId: 'B6', ward: 'B', createdAt: 200 })
    orders.set(second.id, second)
    expect(t.poll(host)!.roomId).toBe('B6')
    // the newer one is given: its "Given" shows for the hold, then the older one is followed again
    second.stage = 'given'
    state.now += 250
    expect(t.poll(host)!.text).toBe('Given to Grace Adeyemi in B6')
    state.now += DONE_HOLD_MS + 1
    expect(t.poll(host)!.roomId).toBe('A3')
  })

  it('lets go when its order vanishes (a Jump builds a new hospital) and on reset', () => {
    const { orders, host } = fixture()
    const t = new YourOrder()
    orders.set('ord-1', order())
    expect(t.poll(host)).not.toBeNull()
    orders.clear()
    expect(t.poll(host)).toBeNull()
    orders.set('ord-1', order())
    expect(t.poll(host)).not.toBeNull()
    t.reset()
    expect(t.current()).toBeNull()
  })
})

describe('the pod ETA', () => {
  it('is the distance along the circuit to the drawer at the corridor speed', () => {
    const c = CIRCUITS.A
    const target = drawerS('A3')
    const s = (((target - 60) % c.length) + c.length) % c.length
    expect(podEtaSeconds({ ward: 'A', roomId: 'A3' }, { s, state: 'enRoute' })).toBeCloseTo(60 / CONFIG.pods.corridorSpeed, 6)
    expect(podEtaSeconds({ ward: 'A', roomId: 'A3' }, { s, state: 'delivering' })).toBe(0)
    expect(podEtaSeconds({ ward: 'A', roomId: 'A3' }, { s, state: 'charging' })).toBeNull()
    expect(podEtaSeconds({ ward: 'A', roomId: 'A3' }, { s, state: 'loading' })).toBeNull()
  })
})

describe('your order in the real hospital', () => {
  it('reaches "Given" and the objective line follows every stage on the way', () => {
    const sim = new Simulation(99)
    let now = 0
    const host = simOrderHost(() => sim, () => now)
    const tracker = new YourOrder()
    const DT = CONFIG.sim.step
    const run = (seconds: number, every = 0.25) => {
      const seen: string[] = []
      let sinceLook = 0
      for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
        sim.step(DT)
        now += DT * 1000
        sinceLook += DT
        if (sinceLook >= every) {
          sinceLook = 0
          const text = tracker.poll(host)?.text ?? null
          if (text !== null && seen.at(-1) !== text) seen.push(text)
          if (text === null && seen.length > 0 && seen.at(-1) !== '(cleared)') seen.push('(cleared)')
        }
      }
      return seen
    }

    run(30)
    // the first room with somebody lying in it
    const room = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'].find((r) => sim.meds.occupant(r) !== null)!
    expect(room).toBeDefined()
    const patient = sim.meds.occupant(room)!.name
    const r = sim.prescribe(room, [{ medId: 'salbutamol', qty: 1 }])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const lines = run(10 * 60)
    expect(r.order.stage).toBe('given')

    // every step of the way showed up, in order, and the line cleared at the end
    const wants: RegExp[] = [
      /^Pharmacist \w+ is checking your order for /,
      /^(Your order for \w+ is checked and waiting for a pod|Pod \w+ is on its way to collect your order for \w+|MedVend is loading your order into pod \w+)$/,
      /^Pod \w+ is bringing your order to \w+: (under a minute|about \d+ min)$/,
      /^Your order is in \w+'s drawer/,
      new RegExp(`^Given to ${patient} in ${room}$`),
    ]
    let at = 0
    for (const line of lines) if (at < wants.length && wants[at].test(line)) at++
    expect(at, `the lines were: ${JSON.stringify(lines)}`).toBe(wants.length)
    expect(lines.at(-1)).toBe('(cleared)')
  }, 180_000)
})
