/**
 * A registry of the glowing things that dim at night (bedside screens, door tiles). The ward layer registers the colour it
 * multiplies its picture by; the daylight driver sets that colour at 1 Hz. One tiny module between two features, so neither
 * imports the other (the screens do not know about the clock, the clock does not know about the screens).
 *
 * Pure (no three.js import): a "colour" is anything with `setScalar`.
 */
export interface Dimmable {
  setScalar(s: number): unknown
}

interface Entry {
  target: Dimmable
  /** The brightness at full day (`MeshBasicMaterial.color` of a screen is 1.1, for example). */
  base: number
  /** How much of the night dimming this one takes: 1 = all of `lightAt().screens`, 0 = none. */
  strength: number
}

const entries = new Set<Entry>()
let level = 1

/** Register a colour to dim. Returns the function that unregisters it. The current level is applied at once. */
export function registerDimmable(target: Dimmable, base: number, strength = 1): () => void {
  const e: Entry = { target, base, strength }
  entries.add(e)
  apply(e)
  return () => {
    entries.delete(e)
  }
}

function apply(e: Entry): void {
  e.target.setScalar(e.base * (1 - e.strength * (1 - level)))
}

/** The driver sets the screen level (1 = full day brightness, lower at night) and every registered colour follows. */
export function setScreenLevel(next: number): void {
  if (next === level) return
  level = next
  for (const e of entries) apply(e)
}

export function screenLevel(): number {
  return level
}
