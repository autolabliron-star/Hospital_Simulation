import { afterEach, describe, expect, it } from 'vitest'
import { PlayerInput } from './input'
import { walkCam } from './state'

afterEach(() => {
  walkCam.inputBlocked = false
})

describe('the keys', () => {
  it('W A S D (and the arrows) become the forward and right axes, Shift is hurry', () => {
    const input = new PlayerInput()
    const axes = { forward: 0, right: 0, hurry: false }
    expect(input.axes(axes)).toEqual({ forward: 0, right: 0, hurry: false })
    input.keyDown('KeyW')
    input.keyDown('KeyD')
    input.keyDown('ShiftLeft')
    expect(input.axes(axes)).toEqual({ forward: 1, right: 1, hurry: true })
    input.keyDown('KeyS') // W and S together cancel
    expect(input.axes(axes).forward).toBe(0)
    input.keyUp('KeyW')
    input.keyUp('KeyD')
    input.keyUp('ShiftLeft')
    input.keyDown('KeyA')
    expect(input.axes(axes)).toEqual({ forward: -1, right: -1, hurry: false })
    input.keyUp('KeyS')
    input.keyUp('KeyA')
    input.keyDown('ArrowUp')
    input.keyDown('ArrowRight')
    input.keyDown('ShiftRight')
    expect(input.axes(axes)).toEqual({ forward: 1, right: 1, hurry: true })
  })

  it('Tab and V are counted presses: a tap between two frames is not lost, a held key does not repeat', () => {
    const input = new PlayerInput()
    input.keyDown('Tab')
    input.keyDown('Tab', true) // key repeat
    input.keyDown('KeyV')
    input.keyDown('Tab')
    expect(input.take('walk')).toBe(true)
    expect(input.take('walk')).toBe(true)
    expect(input.take('walk')).toBe(false)
    expect(input.take('firstPerson')).toBe(true)
    expect(input.take('firstPerson')).toBe(false)
  })

  it('Q is a counted press too (the other shoulder), never on key repeat, and it does not walk you anywhere', () => {
    const input = new PlayerInput()
    input.keyDown('KeyQ')
    input.keyDown('KeyQ', true) // key repeat
    expect(input.axes({ forward: 0, right: 0, hurry: false })).toEqual({ forward: 0, right: 0, hurry: false })
    expect(input.take('shoulderSwap')).toBe(true)
    expect(input.take('shoulderSwap')).toBe(false)
    input.keyDown('KeyQ')
    input.clear() // losing focus drops it
    expect(input.take('shoulderSwap')).toBe(false)
    walkCam.inputBlocked = true
    input.keyDown('KeyQ')
    walkCam.inputBlocked = false
    expect(input.take('shoulderSwap')).toBe(false) // an overlay owns the keyboard: not heard
  })

  it('while an overlay owns the keyboard the walk keys, Tab and V are not heard at all', () => {
    const input = new PlayerInput()
    walkCam.inputBlocked = true
    input.keyDown('KeyW')
    input.keyDown('Tab')
    input.keyDown('KeyV')
    walkCam.inputBlocked = false
    expect(input.axes({ forward: 0, right: 0, hurry: false }).forward).toBe(0)
    expect(input.take('walk')).toBe(false)
    expect(input.take('firstPerson')).toBe(false)
  })

  it('losing focus releases every key and every pending press', () => {
    const input = new PlayerInput()
    input.keyDown('KeyW')
    input.keyDown('Tab')
    input.addLook(10, 10)
    input.clear()
    expect(input.axes({ forward: 0, right: 0, hurry: false }).forward).toBe(0)
    expect(input.take('walk')).toBe(false)
    expect(input.takeLook({ dx: 0, dy: 0, wheel: 0 })).toEqual({ dx: 0, dy: 0, wheel: 0 })
  })

  it('a held key survives a spell of not listening (the flight), while stale mouse motion does not', () => {
    const input = new PlayerInput()
    input.keyDown('KeyW')
    input.addLook(5, 5)
    input.addWheel(100)
    input.discardPending()
    expect(input.axes({ forward: 0, right: 0, hurry: false }).forward).toBe(1)
    expect(input.takeLook({ dx: 0, dy: 0, wheel: 0 })).toEqual({ dx: 0, dy: 0, wheel: 0 })
  })
})

describe('the mouse', () => {
  it('collects look pixels and wheel units between frames, then resets', () => {
    const input = new PlayerInput()
    input.addLook(3, -2)
    input.addLook(4, 1)
    input.addWheel(50)
    input.addWheel(50)
    expect(input.takeLook({ dx: 0, dy: 0, wheel: 0 })).toEqual({ dx: 7, dy: -1, wheel: 100 })
    expect(input.takeLook({ dx: 0, dy: 0, wheel: 0 })).toEqual({ dx: 0, dy: 0, wheel: 0 })
  })

  it('a short press that hardly moves is a click (it asks for pointer lock); a drag looks around instead', () => {
    const input = new PlayerInput()
    input.pointerDown(1, 100, 100, 1000)
    input.pointerMove(102, 101)
    expect(input.dragging).toBe(true)
    expect(input.pointerUp(102, 101, 1150)).toBe(true) // 150 ms, 2 px
    expect(input.dragging).toBe(false)
    input.pointerDown(2, 100, 100, 2000)
    input.pointerMove(160, 100)
    input.pointerMove(220, 100)
    expect(input.pointerUp(220, 100, 2200)).toBe(false) // moved 120 px: a drag
    expect(input.takeLook({ dx: 0, dy: 0, wheel: 0 }).dx).toBe(2 + 120)
    input.pointerDown(3, 100, 100, 3000)
    expect(input.pointerUp(100, 100, 3900)).toBe(false) // held for 900 ms: not a click
    input.pointerDown(4, 100, 100, 4000)
    expect(input.pointerUp(100, 100, 4100, false)).toBe(false) // cancelled
  })

  it('without a DOM there is no pointer lock to be had, and asking is harmless', () => {
    const input = new PlayerInput()
    expect(input.locked).toBe(false)
    expect(() => input.requestLock()).not.toThrow()
    expect(() => input.releaseLock()).not.toThrow()
  })
})
