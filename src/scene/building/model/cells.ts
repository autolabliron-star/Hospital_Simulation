/**
 * The procedural stand-ins of each zone (./region.ts): the meshes the procedural building compiled for one zone's cell, found by their
 * `|cell=<id>` key (render/compile.ts) or registered directly (the walk building). A cell is drawn until its zone's model is: `setCellReplaced`
 * flips every mesh of the cell in one synchronous call, in the same frame the zone's model appears (or never, when the zone fails), so there is
 * never a hole and never both. Event-driven: nothing runs per frame.
 */
import type { Object3D } from 'three'

const CELL_KEY = /\|cell=([^|]+)$/

const objects = new Map<string, Set<Object3D>>()
const replaced = new Set<string>()

/** The cell an object's name declares (`...|cell=<id>`), or null. */
export function cellOfName(name: string): string | null {
  return CELL_KEY.exec(name)?.[1] ?? null
}

function apply(cell: string, o: Object3D): void {
  o.visible = !replaced.has(cell)
}

/** Add objects to a cell (they take its current state at once). Returns the function that removes them. */
export function registerCellObjects(cell: string, list: readonly Object3D[]): () => void {
  let set = objects.get(cell)
  if (!set) objects.set(cell, (set = new Set()))
  for (const o of list) {
    set.add(o)
    apply(cell, o)
  }
  return () => {
    for (const o of list) objects.get(cell)?.delete(o)
  }
}

/** Find and register every object under `root` whose name carries a cell key (the merged and instanced meshes of BuildingMeshes). */
export function bindCellsUnder(root: Object3D): () => void {
  const found = new Map<string, Object3D[]>()
  root.traverse((o) => {
    const cell = cellOfName(o.name)
    if (!cell) return
    const list = found.get(cell) ?? []
    list.push(o)
    found.set(cell, list)
  })
  const offs = [...found].map(([cell, list]) => registerCellObjects(cell, list))
  return () => {
    for (const off of offs) off()
  }
}

/** The zone's model is drawn (true) or will not be (false): hide or show its procedural cell. */
export function setCellReplaced(cell: string, on: boolean): void {
  if (on) replaced.add(cell)
  else replaced.delete(cell)
  for (const o of objects.get(cell) ?? []) apply(cell, o)
}

export const cellReplaced = (cell: string): boolean => replaced.has(cell)

/** How many objects a cell holds (tests, the probe). */
export const cellObjectCount = (cell: string): number => objects.get(cell)?.size ?? 0

/** For tests. */
export function resetCells(): void {
  objects.clear()
  replaced.clear()
}
