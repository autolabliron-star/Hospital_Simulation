/**
 * R5: the ultrasound screen as the watch overlay's picture-in-picture: it is registered as the 'us' inset source with its canvas and its repaint count, removed
 * again, and repaints at the focused rate only while somebody watches it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearInsetSources, insetSource, insetWanted } from '@/scene/registries/insetSources'
import { SCREEN_SIZE } from './images/screen'
import { BACKGROUND_INTERVAL_MS, FOCUSED_INTERVAL_MS, registerUsInset, screenInterval } from './usInset'

afterEach(() => clearInsetSources())

describe('the ultrasound inset source', () => {
  it('registers the screen\'s canvas and its paint count at mount, and removes itself at unmount', () => {
    const screen = { canvas: { tag: 'us canvas' }, paints: 3 }
    expect(insetSource('us')).toBeNull()
    const off = registerUsInset(screen)
    const src = insetSource('us')!
    expect(src.id).toBe('us')
    expect(src.canvas).toBe(screen.canvas)
    expect([src.width, src.height]).toEqual([SCREEN_SIZE, SCREEN_SIZE])
    expect(src.paints()).toBe(3)
    screen.paints = 9 // a repaint: the inset copies again
    expect(src.paints()).toBe(9)
    expect(insetSource('ctLive')).toBeNull() // only its own id
    off()
    expect(insetSource('us')).toBeNull()
  })

  it('a second mount replaces the first, and the first one\'s cleanup leaves the second alone', () => {
    const a = registerUsInset({ canvas: 'a', paints: 0 })
    const offB = registerUsInset({ canvas: 'b', paints: 0 })
    a()
    expect(insetSource('us')!.canvas).toBe('b')
    offB()
    expect(insetSource('us')).toBeNull()
  })
})

describe('how often a screen repaints', () => {
  it('the ultrasound screen goes to the focused rate (4 Hz) while its inset is on screen or the watch camera is on its room, and only then', () => {
    expect(FOCUSED_INTERVAL_MS).toBe(250)
    expect(BACKGROUND_INTERVAL_MS).toBe(1000)
    expect(screenInterval('us', null, null)).toBe(BACKGROUND_INTERVAL_MS)
    insetWanted.us = true
    expect(screenInterval('us', null, null)).toBe(FOCUSED_INTERVAL_MS)
    insetWanted.us = false
    expect(screenInterval('us', null, 'us')).toBe(FOCUSED_INTERVAL_MS)
    // watching another room, or the CT overlay's picture, does not raise it
    expect(screenInterval('us', null, 'cryo')).toBe(BACKGROUND_INTERVAL_MS)
    expect(screenInterval('us', null, 'or')).toBe(BACKGROUND_INTERVAL_MS)
    insetWanted.ctLive = true
    insetWanted.endo = true
    expect(screenInterval('us', null, null)).toBe(BACKGROUND_INTERVAL_MS)
  })

  it('the focused room keeps its rate, and no other scanner is raised by the ultrasound\'s inset', () => {
    expect(screenInterval('ct', 'ct', null)).toBe(FOCUSED_INTERVAL_MS)
    expect(screenInterval('mri', 'ct', null)).toBe(BACKGROUND_INTERVAL_MS)
    insetWanted.us = true
    expect(screenInterval('mri', null, 'us')).toBe(BACKGROUND_INTERVAL_MS)
    expect(screenInterval('xray', null, null)).toBe(BACKGROUND_INTERVAL_MS)
    expect(screenInterval('us', 'ct', null)).toBe(FOCUSED_INTERVAL_MS)
  })
})

describe('the driver\'s per-frame rule', () => {
  it('screenInterval allocates nothing (it runs for every scanner at every frame): no new, array or object literal, closure or spread', () => {
    const src = readFileSync(join(process.cwd(), 'src/scene/imaging/usInset.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    const start = src.indexOf('export function screenInterval')
    expect(start).toBeGreaterThan(0)
    const open = src.indexOf('{', src.indexOf(')', start))
    let depth = 0
    let end = open
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++
      else if (src[end] === '}' && --depth === 0) break
    }
    const body = src.slice(open, end + 1)
    expect(body.length).toBeGreaterThan(40)
    for (const re of [/\bnew\s+[A-Za-z]/, /[=(,:?&|]\s*\[/, /[=(,?&|]\s*\{\s*[a-zA-Z_]+\s*:/, /\.\.\./, /=>/, /\bfunction\b/]) expect(re.test(body), String(re)).toBe(false)
  })
})
