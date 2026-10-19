/**
 * What floats over people's heads hides behind walls in walk mode (sight.ts): the line from the camera to the head against the
 * building's solid walls, never its glass.
 */
import { describe, expect, it } from 'vitest'
import { WallBoxProbe, buildWallBoxes } from '@/scene/player/boomProbe'
import { roomById } from '@/sim/places'
import { sightBlocked } from './sight'

/** Camera at shoulder height, a head anchor just over a standing person. */
const EYE = 1.8
const HEAD = 1.95

describe('sight lines in walk mode', () => {
  const room = roomById('A3')
  const door = room.door

  it('a wall between you and a person in the next room hides them', () => {
    // from corridor A, east of the door, to a bedside in room A3: the line crosses the room wall well away from the door
    expect(sightBlocked(door.x + 3, EYE, -14, door.x + 0.9, HEAD, -19)).toBe(true)
  })

  it('through the open doorway, and inside the same room, you see them', () => {
    expect(sightBlocked(door.x, EYE, -13.5, door.x, HEAD, -19)).toBe(false)
    expect(sightBlocked(door.x + 0.4, EYE, -17, door.x + 1.1, HEAD, -20)).toBe(false)
  })

  it('glass hides nobody: from corridor B through the lab front, where the camera itself may not go', () => {
    expect(sightBlocked(-28, EYE, 14, -28, HEAD, 19)).toBe(false)
    // (the camera's own probe counts the glass as a wall)
    const solid = new WallBoxProbe(buildWallBoxes())
    expect(solid.cast({ x: -28, y: EYE, z: 14 }, { x: 0, y: 0, z: 1 }, 5, 0)).not.toBeNull()
  })

  it('a point right beside the camera is never hidden', () => {
    expect(sightBlocked(0, EYE, -14, 0.01, EYE, -14)).toBe(false)
  })
})
