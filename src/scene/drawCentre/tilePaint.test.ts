import { describe, expect, it } from 'vitest'
import { DRAW_UI } from '@/content/drawUi'
import { createRecorder, mockSurface } from '@/scene/imaging/images/mockCanvas'
import { W4_TILE, W4_TILE_PX } from '@/scene/w4kit/tiles'
import type { DrawTicket, TubePrepState } from '@/sim/types'
import { TILE_ANCHORS } from './dims'
import { paintCheckIn, paintManualSend, paintPrep, paintQueue, prepViewOf, queueViewOf } from './tilePaint'

function ticket(id: string, state: DrawTicket['state'] = 'waiting', station: number | null = null): DrawTicket {
  return { id, cls: id.startsWith('V') ? 'V' : 'P', patientId: `p-${id}`, patientName: 'Synthetic Person', orderId: `o-${id}`, issuedAt: 0, calledAt: null, station, state }
}

function surface() {
  const rec = createRecorder()
  const s = mockSurface(W4_TILE_PX.w, W4_TILE_PX.h, rec)
  const log: string[] = []
  ;(s.ctx as unknown as Record<string, unknown>).fillText = (t: string) => log.push(t)
  return { ctx: s.ctx, log, rec }
}

describe('the queue view', () => {
  it('says who is called and which robot (1-based), and lists the next waiting tickets in call order', () => {
    const calling = ticket('P023', 'called', 1)
    const v = queueViewOf(calling, [calling, ticket('V004'), ticket('P024'), ticket('P025'), ticket('P026'), ticket('P027'), ticket('P028')])
    expect(v.calling).toEqual({ ticket: 'P023', robot: 2 })
    expect(v.next).toEqual(['V004', 'P024', 'P025', 'P026'])
    expect(v.waiting).toBe(6)
  })

  it('has nobody being called and nobody waiting when the queue is empty', () => {
    expect(queueViewOf(null, [])).toEqual({ calling: null, next: [], waiting: 0 })
  })

  it('ignores tickets that are being drawn or done', () => {
    expect(queueViewOf(null, [ticket('P001', 'drawing', 0), ticket('P002', 'done', 1)]).waiting).toBe(0)
  })
})

describe('the tile painters', () => {
  it('the check-in screen welcomes and says take a number', () => {
    const { ctx, log } = surface()
    paintCheckIn(ctx, W4_TILE_PX.w, W4_TILE_PX.h, 3)
    expect(log).toContain(DRAW_UI.tiles.welcome)
    expect(log).toContain(DRAW_UI.tiles.takeNumber)
    expect(log).toContain('3 waiting')
  })

  it('the queue screen shows "P023 Robot 2" and the waiting tickets, or the empty words', () => {
    const a = surface()
    paintQueue(a.ctx, W4_TILE_PX.w, W4_TILE_PX.h, { calling: { ticket: 'P023', robot: 2 }, next: ['V004', 'P024'], waiting: 5 })
    expect(a.log).toContain(DRAW_UI.tiles.nowCalling)
    expect(a.log).toContain('P023 → Robot 2')
    expect(a.log).toContain('V004   P024')
    expect(a.log).toContain('+3')
    const b = surface()
    paintQueue(b.ctx, W4_TILE_PX.w, W4_TILE_PX.h, { calling: null, next: [], waiting: 0 })
    expect(b.log).toContain(DRAW_UI.tiles.nobody)
    expect(b.log).not.toContain('P023 → Robot 2')
  })

  it('the prep display shows the phase, the ticket and the labels printed', () => {
    const prep: TubePrepState = { phase: 'labelling', progress: 0.4, ticket: 'P023', queue: 1, bin: 2, held: 'serum', rack: ['P021'], traysToday: 17, version: 3 }
    const v = prepViewOf(prep)
    expect(v).toEqual({ phase: 'labelling', ticket: 'P023', progress: 0.4, labels: 17, trays: 1 })
    const { ctx, log } = surface()
    paintPrep(ctx, W4_TILE_PX.w, W4_TILE_PX.h, v)
    expect(log).toContain(DRAW_UI.prepPhase.labelling)
    expect(log).toContain('P023')
    expect(log).toContain('Labels printed: 17')
    expect(log).toContain('Trays waiting: 1')
  })

  it('the manual send display counts the hand draws', () => {
    const { ctx, log } = surface()
    paintManualSend(ctx, W4_TILE_PX.w, W4_TILE_PX.h, 4)
    expect(log).toContain(DRAW_UI.tiles.manualTitle)
    expect(log).toContain('Hand draws today: 4')
  })

  it('every painter says it is simulated', () => {
    for (const draw of [
      (c: ReturnType<typeof surface>['ctx']) => paintCheckIn(c, 320, 200, 0),
      (c: ReturnType<typeof surface>['ctx']) => paintQueue(c, 320, 200, { calling: null, next: [], waiting: 0 }),
      (c: ReturnType<typeof surface>['ctx']) => paintPrep(c, 320, 200, { phase: 'idle', ticket: null, progress: 0, labels: 0, trays: 0 }),
      (c: ReturnType<typeof surface>['ctx']) => paintManualSend(c, 320, 200, 0),
    ]) {
      const { ctx, log } = surface()
      draw(ctx)
      expect(log).toContain(DRAW_UI.strip.simulated)
    }
  })
})

describe('the tile slots and anchors', () => {
  it('uses the four slots the atlas reserves for the draw centre', () => {
    expect([W4_TILE.drawCheckIn, W4_TILE.drawQueue, W4_TILE.tubePrep, W4_TILE.manualSend]).toEqual([5, 6, 7, 8])
  })

  it('anchors each tile at the screen the room draws, in the 16:10 shape of the atlas', () => {
    for (const [name, make] of Object.entries(TILE_ANCHORS)) {
      const a = make()
      expect(a.w / a.h, name).toBeCloseTo(W4_TILE_PX.w / W4_TILE_PX.h, 2)
      for (const v of [a.at.x, a.at.y, a.at.z, a.heading, a.w, a.h]) expect(Number.isFinite(v), name).toBe(true)
    }
    // the queue screen is above the door, facing into the room; the check-in screen tilts back
    expect(TILE_ANCHORS.drawQueue().at.y).toBeGreaterThan(2.3)
    expect(TILE_ANCHORS.drawCheckIn().tilt).toBeGreaterThan(0)
  })
})
