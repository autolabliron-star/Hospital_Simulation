import { describe, expect, it } from 'vitest'
import { AREAS } from '@/sim/places'
import { MAP_LABELS, labelBox, mapFrame, toMapX, toMapY } from './minimapModel'
import { paintFallback, paintLabels } from './minimapPlan'

interface Call {
  op: string
  args: unknown[]
  font: string
}

/** A canvas context that writes down what it is asked to draw, and measures text as 0.55 em a letter. */
function recorder() {
  const calls: Call[] = []
  const state: Record<string, unknown> = { font: '', fillStyle: '', strokeStyle: '' }
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      if (prop === 'measureText') {
        return (text: string) => ({ width: text.length * 0.55 * parseFloat(/([\d.]+)px/.exec(String(target.font))![1]) })
      }
      return (...args: unknown[]) => {
        calls.push({ op: prop, args, font: String(target.font) })
      }
    },
    set(target, prop: string, value) {
      target[prop] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

describe('the flat plan that stands in until the real one has decoded', () => {
  it('fills the whole map, then draws every area at its place', () => {
    const f = mapFrame(556)
    const { ctx, calls } = recorder()
    paintFallback(ctx, f)
    expect(calls[0]).toMatchObject({ op: 'fillRect', args: [0, 0, f.width, f.height] })
    const rects = calls.filter((c) => c.op === 'fillRect').slice(1)
    expect(rects.length).toBe(AREAS.length)
    // the lobby's rectangle is where the lobby is
    const lobby = AREAS.find((a) => a.id === 'lobby')!
    expect(rects.some((r) => r.args[0] === toMapX(f, lobby.rect.x0) && r.args[1] === toMapY(f, lobby.rect.z0))).toBe(true)
  })
})

describe('the area names on the plan', () => {
  const f = mapFrame(556)
  const names = (): { texts: string[]; turned: string[] } => {
    const { ctx, calls } = recorder()
    paintLabels(ctx, f, 2)
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]))
    // a label drawn turned has a rotate between its translate and its text
    const turned: string[] = []
    calls.forEach((c, i) => {
      if (c.op === 'fillText') {
        for (let j = i - 1; j >= 0 && calls[j].op !== 'save'; j--) if (calls[j].op === 'rotate') turned.push(String(c.args[0]))
      }
    })
    return { texts, turned }
  }

  it('names the big areas, and only the ones that fit', () => {
    const { texts } = names()
    for (const t of ['Lobby', 'Triage', 'ER', 'Pharmacy', 'Atrium', 'Ward A', 'Ward B']) expect(texts, t).toContain(t)
    // the X-ray room is six metres wide: too small for its name at this size, though the two letters of "US" fit the next room
    expect(texts).not.toContain('X-ray')
    expect(texts).toContain('US')
    for (const t of texts) expect(MAP_LABELS.map((l) => l.text)).toContain(t)
  })

  it('turns the name of the tall, narrow command center a quarter', () => {
    const { texts, turned } = names()
    expect(texts).toContain('Command')
    expect(turned).toEqual(['Command'])
  })

  it('puts each name in the middle of its area', () => {
    const { ctx, calls } = recorder()
    paintLabels(ctx, f, 2)
    const lobby = labelBox(f, 'lobby')
    const i = calls.findIndex((c) => c.op === 'fillText' && c.args[0] === 'Lobby')
    const tr = [...calls.slice(0, i)].reverse().find((c) => c.op === 'translate')!
    expect(tr.args).toEqual([lobby.x, lobby.y])
  })
})
