import { describe, expect, it } from 'vitest'
import { ROBOT } from '@/sim/places'
import { ATLAS, ATLAS_CELLS, createFaceAtlas, faceCell, faceLabel } from './faceAtlas'
import { POD_COUNT } from './manifest'
import { CELL_SCALE, podFaceGeometry } from './podParts'

describe('pod face atlas', () => {
  it('has a cell for every pod', () => {
    expect(POD_COUNT).toBe(ROBOT.podsPerWard * 2)
    expect(ATLAS_CELLS).toBeGreaterThanOrEqual(POD_COUNT)
  })

  it('maps pod index to cells deterministically (same answer every call)', () => {
    for (let i = 0; i < ATLAS_CELLS; i++) expect(faceCell(i)).toEqual(faceCell(i))
    expect(JSON.stringify(Array.from({ length: POD_COUNT }, (_, i) => faceCell(i)))).toBe(
      JSON.stringify(Array.from({ length: POD_COUNT }, (_, i) => faceCell(i))),
    )
  })

  it('is stable: the first cells are row-major from the top-left of the canvas', () => {
    expect(faceCell(0)).toEqual({ index: 0, col: 0, row: 0, u: 0, v: 0.75, w: 0.25, h: 0.25 })
    expect(faceCell(1)).toEqual({ index: 1, col: 1, row: 0, u: 0.25, v: 0.75, w: 0.25, h: 0.25 })
    expect(faceCell(4)).toEqual({ index: 4, col: 0, row: 1, u: 0, v: 0.5, w: 0.25, h: 0.25 })
    expect(faceCell(9)).toEqual({ index: 9, col: 1, row: 2, u: 0.25, v: 0.25, w: 0.25, h: 0.25 })
    expect(faceCell(15)).toEqual({ index: 15, col: 3, row: 3, u: 0.75, v: 0, w: 0.25, h: 0.25 })
  })

  it('gives every pod its own cell, inside the texture and never overlapping another', () => {
    const cells = Array.from({ length: ATLAS_CELLS }, (_, i) => faceCell(i))
    const keys = new Set(cells.map((c) => `${c.col},${c.row}`))
    expect(keys.size).toBe(ATLAS_CELLS)
    for (const c of cells) {
      expect(c.u).toBeGreaterThanOrEqual(0)
      expect(c.v).toBeGreaterThanOrEqual(0)
      expect(c.u + c.w).toBeLessThanOrEqual(1 + 1e-12)
      expect(c.v + c.h).toBeLessThanOrEqual(1 + 1e-12)
    }
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i]
        const b = cells[j]
        const overlap = a.u < b.u + b.w - 1e-12 && b.u < a.u + a.w - 1e-12 && a.v < b.v + b.h - 1e-12 && b.v < a.v + a.h - 1e-12
        expect(overlap, `cells ${i} and ${j}`).toBe(false)
      }
    }
  })

  it('covers the canvas pixel grid exactly', () => {
    expect(ATLAS.cols * ATLAS.cellW).toBe(512)
    expect(ATLAS.rows * ATLAS.cellH).toBe(256)
    expect(CELL_SCALE.u * ATLAS.cols).toBeCloseTo(1, 12)
    expect(CELL_SCALE.v * ATLAS.rows).toBeCloseTo(1, 12)
  })

  it('rejects cells outside the atlas', () => {
    expect(() => faceCell(-1)).toThrow()
    expect(() => faceCell(ATLAS_CELLS)).toThrow()
    expect(() => faceCell(1.5)).toThrow()
  })

  it('the face quad carries each pod its own cell offset, matching faceCell', () => {
    const g = podFaceGeometry(POD_COUNT)
    const attr = g.getAttribute('aCell')
    expect(attr.count).toBe(POD_COUNT)
    for (let i = 0; i < POD_COUNT; i++) {
      const c = faceCell(i)
      expect(attr.getX(i)).toBeCloseTo(c.u, 6)
      expect(attr.getY(i)).toBeCloseTo(c.v, 6)
    }
  })

  it('shows the destination room, or the charge glyph (empty label) with no order', () => {
    expect(faceLabel('A3')).toBe('A3')
    expect(faceLabel('B8')).toBe('B8')
    expect(faceLabel(undefined)).toBe('')
  })

  it('skips the canvas where there is no document (node)', () => {
    expect(createFaceAtlas()).toBeNull()
  })
})
