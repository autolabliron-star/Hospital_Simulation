/** The floor lines show in the overview only: walking (step 3), its flights and presentation mode hide them per instance, and put them back exactly. */
import { afterEach, describe, expect, it } from 'vitest'
import { Group, InstancedMesh, Matrix4, MeshStandardMaterial, PlaneGeometry } from 'three'
import { buildLayout } from '@/scene/building/layout'
import { compileLayout } from '@/scene/building/render/compile'
import { wayfindingPieces } from './lines'
import { hideLines, linesHidden, resetPresentLinesForTests, setLineMaterial, showLines, syncPresentLines } from './presentLines'

afterEach(() => resetPresentLinesForTests())

const key = (x: number, y: number, z: number): string => `${Math.round(x * 1000)}|${Math.round(y * 1000)}|${Math.round(z * 1000)}`

describe('finding the lines in the compiled building', () => {
  it('every line piece is an instance of a tinted instanced mesh, at the centre the hider looks for', () => {
    const compiled = compileLayout(buildLayout(), 1)
    const compiled2 = compileLayout(buildLayout(), 2)
    const have = new Set<string>()
    for (const spec of [...compiled.instanced, ...compiled2.instanced]) {
      if (spec.mat !== 'tinted') continue
      for (let i = 0; i < spec.count; i++) have.add(key(spec.matrices[i * 16 + 12], spec.matrices[i * 16 + 13], spec.matrices[i * 16 + 14]))
    }
    const pieces = wayfindingPieces()
    expect(pieces.length).toBeGreaterThan(10)
    const missing = pieces.filter((p) => !have.has(key(p.x, p.shape === 'cyl' ? p.y + p.d / 2 : p.y, p.z)))
    expect(missing).toEqual([])
  })
})

describe('hiding and showing', () => {
  function scene() {
    const tinted = new MeshStandardMaterial()
    setLineMaterial(tinted)
    const pieces = wayfindingPieces().filter((p) => p.shape === 'plane')
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), tinted, pieces.length + 1)
    mesh.name = 'tinted|plane|abc|01'
    const m = new Matrix4()
    pieces.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)))
    mesh.setMatrixAt(pieces.length, m.makeTranslation(-30, 0.004, 3)) // an imaging decal on the same mesh
    const other = new InstancedMesh(new PlaneGeometry(1, 1), new MeshStandardMaterial(), 1) // not the line material: never touched
    other.name = 'tinted|plane|zzz|01'
    other.setMatrixAt(0, m.makeTranslation(pieces[0].x, pieces[0].y, pieces[0].z))
    const root = new Group()
    root.add(mesh, other)
    return { root, mesh, other, n: pieces.length, before: Float32Array.from(mesh.instanceMatrix.array) }
  }

  it('zeroes exactly the line instances and restores them', () => {
    const { root, mesh, other, n, before } = scene()
    expect(hideLines(root)).toBe(n)
    const a = mesh.instanceMatrix.array
    for (let i = 0; i < n; i++) expect(Array.from(a.slice(i * 16, i * 16 + 16)).every((v) => v === 0)).toBe(true)
    expect(Array.from(a.slice(n * 16, n * 16 + 16))).toEqual(Array.from(before.slice(n * 16, n * 16 + 16))) // the decal stays
    expect(other.instanceMatrix.array[0]).toBe(1)
    showLines()
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(Array.from(before))
  })

  it('acts only on a change of the mode, and retries while the building is not there yet', () => {
    const { root, mesh, n, before } = scene()
    const empty = new Group()
    syncPresentLines(empty, true) // nothing mounted yet
    for (let i = 0; i < 40; i++) syncPresentLines(i < 10 ? empty : root, true)
    expect(mesh.instanceMatrix.array[0]).toBe(0) // found on a retry
    const zeroed = Array.from(mesh.instanceMatrix.array.slice(0, n * 16)).every((v) => v === 0)
    expect(zeroed).toBe(true)
    syncPresentLines(root, false)
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(Array.from(before))
    syncPresentLines(root, false)
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(Array.from(before))
  })
})

describe('when they are hidden', () => {
  it('walking, the flights and presentation hide them; the overview (the map view) shows them; with no player only presentation counts', () => {
    expect(linesHidden(false, 'walk')).toBe(true)
    expect(linesHidden(false, 'toWalk')).toBe(true)
    expect(linesHidden(false, 'toOverview')).toBe(true)
    expect(linesHidden(false, 'overview')).toBe(false)
    expect(linesHidden(true, 'walk')).toBe(true)
    expect(linesHidden(true, 'overview')).toBe(true)
    expect(linesHidden(false, null)).toBe(false)
    expect(linesHidden(true, null)).toBe(true)
  })

  it('a day of Tab: hidden while walking, back in the overview, hidden again on the way down; each change acts once', () => {
    const tinted = new MeshStandardMaterial()
    setLineMaterial(tinted)
    const pieces = wayfindingPieces().filter((p) => p.shape === 'plane')
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), tinted, pieces.length)
    mesh.name = 'tinted|plane|abc|01'
    const m = new Matrix4()
    pieces.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)))
    const root = new Group()
    root.add(mesh)
    const before = Float32Array.from(mesh.instanceMatrix.array)
    const zeroed = (): boolean => Array.from(mesh.instanceMatrix.array).every((v) => v === 0)
    let uploads = 0
    let version = mesh.instanceMatrix.version
    const frame = (phase: 'walk' | 'toOverview' | 'overview' | 'toWalk'): void => {
      syncPresentLines(root, linesHidden(false, phase))
      if (mesh.instanceMatrix.version !== version) {
        uploads++
        version = mesh.instanceMatrix.version
      }
    }
    for (let i = 0; i < 10; i++) frame('walk')
    expect(zeroed()).toBe(true)
    for (let i = 0; i < 10; i++) frame('toOverview')
    expect(zeroed()).toBe(true) // still hidden on the way up (they change only up at the overview)
    for (let i = 0; i < 10; i++) frame('overview')
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(Array.from(before))
    for (let i = 0; i < 10; i++) frame('toWalk')
    expect(zeroed()).toBe(true)
    for (let i = 0; i < 10; i++) frame('walk')
    expect(zeroed()).toBe(true)
    expect(uploads).toBe(3) // hide, show, hide: never per frame
  })
})
