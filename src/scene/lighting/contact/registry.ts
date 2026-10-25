/**
 * The contact-shadow registry (realism step 2): a feature that draws something standing on the floor registers a SOURCE, and the one layer
 * (./ContactShadows.tsx, one draw call) asks every source once a frame to write its shadows into a shared buffer. A registry, so the layer never
 * imports a feature and a feature never imports the layer (CLAUDE.md rule 4).
 *
 * A source writes with `buf.add(x, y, z, heading, halfX, halfZ, radius, pen, darkness)`: the floor point under the thing (drawn metres; y is the
 * floor's height, the shadow is lifted `CONTACT_LIFT` above it), its heading, the footprint's half extents along its own x and z, the corners'
 * radius, the penumbra width outside the footprint, and how dark the shadow is right under it (0..1). It writes nothing for something hidden
 * (`shownInScene`). Allocation-free: the buffer is preallocated, sources are called by index, `add` writes numbers.
 *
 * The crowd's people and vehicles and the meal bots keep their own instanced shadows (same material, same program): they already had one
 * draw call each.
 */
import type { Object3D } from 'three'

/** Shadows the layer can draw in one frame. */
export const MAX_CONTACT = 256
/** Lift above the floor (the polygon offset does the rest). */
export const CONTACT_LIFT = 0.012

export class ContactBuffer {
  readonly matrix: Float32Array
  readonly fade: Float32Array
  readonly shape: Float32Array
  count = 0

  constructor(readonly max = MAX_CONTACT) {
    this.matrix = new Float32Array(max * 16)
    this.fade = new Float32Array(max)
    this.shape = new Float32Array(max * 4)
  }

  reset(): void {
    this.count = 0
  }

  /** One shadow (see the file comment). Returns false when the buffer is full. */
  add(x: number, y: number, z: number, heading: number, halfX: number, halfZ: number, radius: number, pen: number, darkness: number): boolean {
    if (this.count >= this.max || !(darkness > 0) || !(halfX > 0) || !(halfZ > 0)) return false
    const i = this.count++
    const sx = 2 * (halfX + pen)
    const sz = 2 * (halfZ + pen)
    const c = Math.cos(heading)
    const s = Math.sin(heading)
    const m = this.matrix
    const o = i * 16
    // a rotation about y by `heading` (the crowd's convention), scaled to the quad, at the floor point
    m[o] = c * sx
    m[o + 1] = 0
    m[o + 2] = -s * sx
    m[o + 3] = 0
    m[o + 4] = 0
    m[o + 5] = 1
    m[o + 6] = 0
    m[o + 7] = 0
    m[o + 8] = s * sz
    m[o + 9] = 0
    m[o + 10] = c * sz
    m[o + 11] = 0
    m[o + 12] = x
    m[o + 13] = y + CONTACT_LIFT
    m[o + 14] = z
    m[o + 15] = 1
    this.fade[i] = Math.min(1, darkness)
    const k = i * 4
    this.shape[k] = halfX
    this.shape[k + 1] = halfZ
    this.shape[k + 2] = Math.max(0, Math.min(radius, halfX, halfZ))
    this.shape[k + 3] = Math.max(pen, 0.01)
    return true
  }
}

export interface ContactSource {
  name: string
  write(buf: ContactBuffer): void
}

const sources: ContactSource[] = []

/** Register a source (replacing one of the same name). Returns the function that removes it. */
export function registerContactSource(source: ContactSource): () => void {
  const at = sources.findIndex((s) => s.name === source.name)
  if (at >= 0) sources[at] = source
  else sources.push(source)
  return () => {
    const i = sources.indexOf(source)
    if (i >= 0) sources.splice(i, 1)
  }
}

/** Every source writes into `buf` (reset first). A source that throws is skipped. Returns the count. Allocation-free. */
export function writeContacts(buf: ContactBuffer): number {
  buf.reset()
  for (let i = 0; i < sources.length; i++) {
    try {
      sources[i].write(buf)
    } catch {
      /* one broken source must not cost the others */
    }
  }
  return buf.count
}

export function contactSourceNames(): string[] {
  return sources.map((s) => s.name)
}

/** For tests. */
export function clearContactSources(): void {
  sources.length = 0
}

/** Is `o` drawn: itself and every ancestor visible, and attached to a scene? Allocation-free. */
export function shownInScene(o: Object3D | null): boolean {
  let p: Object3D | null = o
  if (!p) return false
  while (p) {
    if (!p.visible) return false
    if ((p as { isScene?: boolean }).isScene) return true
    p = p.parent
  }
  return false
}
