import { afterEach, describe, expect, it, vi } from 'vitest'

const blood = {
  version: 1,
  calling: null as unknown,
  queue: [] as unknown[],
  prep: { phase: 'idle', progress: 0, ticket: null, queue: 0, bin: -1, held: null, rack: [] as string[], traysToday: 0, version: 1 },
  stats: { nurseDraws: 0 },
}
vi.mock('@/sim', () => ({ sim: { get blood() { return blood } } }))

import { createRecorder, mockSurface } from '@/scene/imaging/images/mockCanvas'
import { W4_TILE, W4_TILE_PX, w4Tiles } from '@/scene/w4kit/tiles'
import { registerDrawTiles } from './tiles'

afterEach(() => {
  blood.version = 1
  blood.prep.version = 1
  blood.stats.nurseDraws = 0
})

describe('registering the draw centre screens on the atlas', () => {
  it('puts four tiles in the slots the atlas reserves, anchored where the room draws their screens, and takes them out again', () => {
    const undo = registerDrawTiles()
    for (const slot of [W4_TILE.drawCheckIn, W4_TILE.drawQueue, W4_TILE.tubePrep, W4_TILE.manualSend]) {
      const t = w4Tiles().get(slot)
      expect(t, `slot ${slot}`).toBeDefined()
      expect(t!.anchor.w / t!.anchor.h).toBeCloseTo(W4_TILE_PX.w / W4_TILE_PX.h, 2)
    }
    undo()
    for (const slot of [W4_TILE.drawCheckIn, W4_TILE.drawQueue, W4_TILE.tubePrep, W4_TILE.manualSend]) expect(w4Tiles().has(slot)).toBe(false)
  })

  it('versions follow the sim: the queue and check-in screens on the draw centre, the prep display on the prep, the send display on the hand draws', () => {
    const undo = registerDrawTiles()
    const v = (slot: number): number => w4Tiles().get(slot)!.version()
    const before = [v(W4_TILE.drawCheckIn), v(W4_TILE.drawQueue), v(W4_TILE.tubePrep), v(W4_TILE.manualSend)]
    blood.version = 2
    expect(v(W4_TILE.drawQueue)).not.toBe(before[1])
    expect(v(W4_TILE.drawCheckIn)).not.toBe(before[0])
    expect(v(W4_TILE.tubePrep)).toBe(before[2])
    blood.prep.version = 2
    expect(v(W4_TILE.tubePrep)).not.toBe(before[2])
    blood.stats.nurseDraws = 1
    expect(v(W4_TILE.manualSend)).not.toBe(before[3])
    undo()
  })

  it('paints each tile from the live draw state without error', () => {
    const undo = registerDrawTiles()
    blood.calling = { id: 'P023', cls: 'P', patientId: 'p', patientName: 'Synthetic', orderId: 'o', issuedAt: 0, calledAt: 1, station: 1, state: 'called' }
    blood.queue = [blood.calling, { id: 'V004', cls: 'V', patientId: 'q', patientName: 'Synthetic', orderId: 'o2', issuedAt: 1, calledAt: null, station: null, state: 'waiting' }]
    for (const slot of [W4_TILE.drawCheckIn, W4_TILE.drawQueue, W4_TILE.tubePrep, W4_TILE.manualSend]) {
      const rec = createRecorder()
      const s = mockSurface(W4_TILE_PX.w, W4_TILE_PX.h, rec)
      const log: string[] = []
      ;(s.ctx as unknown as Record<string, unknown>).fillText = (t: string) => log.push(t)
      w4Tiles().get(slot)!.paint(s.ctx as unknown as CanvasRenderingContext2D, W4_TILE_PX.w, W4_TILE_PX.h)
      expect(log.length, `slot ${slot}`).toBeGreaterThan(2)
      if (slot === W4_TILE.drawQueue) {
        expect(log).toContain('P023 → Robot 2')
        expect(log).toContain('V004')
      }
    }
    undo()
    blood.calling = null
    blood.queue = []
  })
})
