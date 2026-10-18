import { describe, expect, it } from 'vitest'
import { ROOMS } from '@/sim/places'
import type { Vec3 } from '@/sim/types'
import { HEAD_Y, LIE_HEAD_OFFSET, STRETCHER_LIFT, headAnchor, headPose, type AnchorSource } from './headAnchor'

const person = (over: Partial<AnchorSource> = {}): AnchorSource => ({
  position: { x: 3, y: 0, z: -2 },
  heading: 0,
  anim: 'idle',
  ...over,
})
const at = (e: AnchorSource) => {
  const out: Vec3 = { x: 0, y: 0, z: 0 }
  const pose = headAnchor(e, out)
  return { ...out, pose }
}

describe('head anchor', () => {
  it('puts a standing person about 2.05 m up, straight above them', () => {
    const a = at(person({ anim: 'walk' }))
    expect(a).toMatchObject({ x: 3, y: 2.05, z: -2, pose: 'stand' })
    expect(HEAD_Y.stand).toBeCloseTo(2.05)
  })

  it('adds the ground height of the person', () => {
    expect(at(person({ position: { x: 0, y: 0.3, z: 0 } })).y).toBeCloseTo(2.35)
  })

  it('puts a seated person about 1.45 m up', () => {
    expect(at(person({ anim: 'sit' }))).toMatchObject({ x: 3, y: 1.45, z: -2, pose: 'sit' })
  })

  it('treats a person on a seat as seated even while their animation is a task (typing, talking)', () => {
    expect(at(person({ anim: 'tablet', seated: { seatId: 'command:1', pose: 'sit' } })).y).toBeCloseTo(1.45)
    expect(at(person({ anim: 'talk', seated: { seatId: 'cafe:2', pose: 'sit' } })).pose).toBe('sit')
  })

  it('treats the rider of a wheelchair as seated, and the porter pushing it as standing', () => {
    expect(at(person({ anim: 'idle', vehicle: 'wheelchair', riding: true })).y).toBeCloseTo(1.45)
    expect(at(person({ anim: 'push', vehicle: 'wheelchair', riding: false })).y).toBeCloseTo(2.05)
    expect(at(person({ anim: 'push', vehicle: 'cleaningCart' })).pose).toBe('stand')
  })

  it('puts a lying person about 1.07 m up (W3: on the real 0.49 m mattress), at the pillow end', () => {
    // heading 0 faces +z, and the heading runs head to feet, so the head is 0.75 m toward -z
    const a = at(person({ anim: 'lie', position: { x: 10, y: 0, z: 5 }, heading: 0 }))
    expect(a.pose).toBe('lie')
    expect(a.y).toBeCloseTo(HEAD_Y.lie)
    expect(a.x).toBeCloseTo(10)
    expect(a.z).toBeCloseTo(5 - LIE_HEAD_OFFSET)
    // heading east (pi/2): the head is to the west
    const east = at(person({ anim: 'lie', position: { x: 10, y: 0, z: 5 }, heading: Math.PI / 2 }))
    expect(east.x).toBeCloseTo(10 - LIE_HEAD_OFFSET)
    expect(east.z).toBeCloseTo(5, 5)
  })

  it('agrees with the contract: over each ward bed, the anchor sits above RoomSpec.pillow', () => {
    for (const room of ROOMS) {
      const a = at(person({ anim: 'lie', position: { x: room.bed.x, y: 0, z: room.bed.z }, heading: room.bedHeading }))
      expect(a.x).toBeCloseTo(room.pillow.x, 5)
      expect(a.z).toBeCloseTo(room.pillow.z, 5)
    }
  })

  it('treats a seat with pose lie as lying, and a rider on a stretcher as lying a little higher (taller mattress)', () => {
    expect(at(person({ anim: 'idle', seated: { seatId: 'erBay:0', pose: 'lie' } })).pose).toBe('lie')
    const onStretcher = at(person({ anim: 'lie', vehicle: 'stretcher', riding: true }))
    expect(onStretcher.y).toBeCloseTo(HEAD_Y.lie + STRETCHER_LIFT)
    expect(at(person({ anim: 'push', vehicle: 'stretcher', riding: false })).pose).toBe('stand')
  })

  it('orders the heights: lying below seated below standing', () => {
    expect(HEAD_Y.lie).toBeLessThan(HEAD_Y.sit)
    expect(HEAD_Y.sit).toBeLessThan(HEAD_Y.stand)
  })

  it('classifies without writing anything', () => {
    expect(headPose({ anim: 'sit' })).toBe('sit')
    expect(headPose({ anim: 'walk' })).toBe('stand')
  })
})
