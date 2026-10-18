import { beforeEach, describe, expect, it } from 'vitest'
import type { Vec3 } from '@/sim/types'
import { clearReclineShown, roomIndex, setReclineShown } from '@/scene/rooms/bedPose'
import { HEAD_Y, LIE_HEAD_OFFSET, LIE_TORSO, STRETCHER_LIFT, headAnchor, headPose, type AnchorSource } from './headAnchor'

const bed = (over: Partial<AnchorSource> = {}): AnchorSource => ({
  position: { x: 10, y: 0, z: 5 },
  heading: 0,
  anim: 'lie',
  seated: { seatId: 'bed:A2', pose: 'lie' },
  ...over,
})
const at = (e: AnchorSource): Vec3 & { pose: string } => {
  const out: Vec3 = { x: 0, y: 0, z: 0 }
  const pose = headAnchor(e, out)
  return { ...out, pose }
}

describe('head anchor with the bed head raised (L1 recline)', () => {
  beforeEach(() => clearReclineShown())

  it("a 'recline' seat is a lying person (never seated)", () => {
    expect(headPose(bed({ anim: 'idle', seated: { seatId: 'bed:A2', pose: 'recline' } }))).toBe('lie')
    expect(headPose(bed({ anim: 'sit', seated: { seatId: 'bed:A2', pose: 'recline' } }))).toBe('lie')
  })

  it('flat is the old anchor; raised, it is higher and nearer the hips, by the torso turning 45 degrees about the waist', () => {
    const flat = at(bed())
    expect(flat.y).toBeCloseTo(HEAD_Y.lie)
    expect(flat.z).toBeCloseTo(5 - LIE_HEAD_OFFSET)
    const up = at(bed({ seated: { seatId: 'bed:A2', pose: 'recline' } }))
    expect(up.y).toBeCloseTo(HEAD_Y.lie + LIE_TORSO * Math.sin(Math.PI / 4))
    expect(up.z).toBeCloseTo(5 - (LIE_HEAD_OFFSET - LIE_TORSO * (1 - Math.cos(Math.PI / 4))))
    expect(up.y).toBeGreaterThan(flat.y + 0.3)
    expect(up.z).toBeGreaterThan(flat.z + 0.1)
  })

  it('follows the angle the bed layer draws, so an emote never floats away from a head that is moving', () => {
    setReclineShown(roomIndex('A2'), 0.5)
    const half = at(bed())
    const full = at(bed({ seated: { seatId: 'bed:A2', pose: 'recline' } }))
    expect(half.y).toBeCloseTo(HEAD_Y.lie + LIE_TORSO * Math.sin(Math.PI / 8))
    expect(full.y).toBeCloseTo(half.y) // the drawn angle wins over the pose while the bed layer drives it
    setReclineShown(roomIndex('A2'), 1)
    expect(at(bed()).y).toBeCloseTo(HEAD_Y.lie + LIE_TORSO * Math.sin(Math.PI / 4))
  })

  it('someone on a stretcher or a chair is unaffected', () => {
    setReclineShown(roomIndex('A2'), 1)
    expect(at(bed({ seated: undefined, vehicle: 'stretcher', riding: true })).y).toBeCloseTo(HEAD_Y.lie + STRETCHER_LIFT)
    expect(at({ position: { x: 0, y: 0, z: 0 }, heading: 0, anim: 'sit' }).y).toBeCloseTo(1.45)
  })
})
