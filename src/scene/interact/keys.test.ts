import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYMAP } from '@/sim/types'
import { decideKey, type KeyFacts } from './keys'

const base: KeyFacts = { code: 'KeyE', repeat: false, modifier: false, typing: false, walking: true, seated: false, overlayOpen: false, closable: false }
const key = (over: Partial<KeyFacts>): KeyFacts => ({ ...base, ...over })

describe('E', () => {
  it('uses what you face, in walk mode with nothing open', () => {
    expect(decideKey(key({}))).toBe('interact')
    expect(DEFAULT_KEYMAP.interact).toBe('KeyE')
  })

  it('stands you up when you are seated', () => {
    expect(decideKey(key({ seated: true }))).toBe('standUp')
  })

  it('never acts while you type, hold a modifier, or hold the key down', () => {
    expect(decideKey(key({ typing: true }))).toBe('none')
    expect(decideKey(key({ modifier: true }))).toBe('none')
    expect(decideKey(key({ repeat: true }))).toBe('none')
  })

  it('never acts while a panel, tablet or menu is open (it owns the keyboard)', () => {
    expect(decideKey(key({ overlayOpen: true }))).toBe('none')
    expect(decideKey(key({ overlayOpen: true, seated: true }))).toBe('none')
  })

  it('does nothing in the overview or in the flights between', () => {
    expect(decideKey(key({ walking: false }))).toBe('none')
  })
})

describe('moving while seated', () => {
  it('stands you up on W, A, S, D and the arrow keys', () => {
    for (const code of [DEFAULT_KEYMAP.forward, DEFAULT_KEYMAP.back, DEFAULT_KEYMAP.left, DEFAULT_KEYMAP.right, 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      expect(decideKey(key({ code, seated: true })), code).toBe('standUp')
    }
  })

  it('does not stand you up for other keys, or when you are standing, or typing', () => {
    expect(decideKey(key({ code: 'KeyP', seated: true }))).toBe('none')
    expect(decideKey(key({ code: 'KeyH', seated: true }))).toBe('none')
    expect(decideKey(key({ code: 'KeyW', seated: false }))).toBe('none')
    expect(decideKey(key({ code: 'KeyW', seated: true, typing: true }))).toBe('none')
    expect(decideKey(key({ code: 'KeyW', seated: true, overlayOpen: true }))).toBe('none')
  })
})

describe('Esc', () => {
  it('closes our panels in walk mode, so the overview handler never flies the camera up', () => {
    expect(decideKey(key({ code: 'Escape', closable: true }))).toBe('closeOverlay')
  })

  it('is left alone in the overview, with nothing of ours open, or while typing', () => {
    expect(decideKey(key({ code: 'Escape', closable: true, walking: false }))).toBe('none')
    expect(decideKey(key({ code: 'Escape', closable: false }))).toBe('none')
    expect(decideKey(key({ code: 'Escape', closable: true, typing: true }))).toBe('none')
  })
})
