// From the living-3d-world skill template (Waltz City src/scene/interact.store.ts). W1 walk-in registry; contract owned by the orchestrator.
import { create } from 'zustand'
import type { Vec3 } from '@/sim/types'

/**
 * Registry of things the player can use with E (contract, owned by the orchestrator).
 *
 * Modules register interactables; the player module picks the best one each frame (in range, in
 * front of the player, lowest priority number, then nearest), shows it through the walk HUD prompt,
 * and calls `onInteract` on E. People are NOT registered here: the player scans the world entities
 * for the nearest NPC to talk to, because 120+ moving registrations would be wasteful.
 */
export type InteractableKind = 'door' | 'seat' | 'station' | 'gate' | 'prop' | 'bedside' | 'console' | 'drawer'

export interface Interactable {
  id: string
  kind: InteractableKind
  /** World position used for range and facing checks. Read every frame, so it may be mutated. */
  position: Vec3
  /** Range in metres at which the prompt appears. Default 2. */
  radius?: number
  /** Prompt text, e.g. "Prescribe for Grace Adeyemi", "Take a seat", "Open the MRI console". */
  label: string | (() => string)
  /** Lower wins when several are in range: bedside, console and station 1, drawer and door 1, gates 2, seats 3, props 4 (people, scanned by the picker, 5). */
  priority?: number
  /** When it returns false the interactable is skipped. Use for locked gates or occupied seats. */
  enabled?: () => boolean
  /** Text shown instead of the prompt when `enabled` is false and the player is in range. */
  lockedLabel?: string | (() => string)
  onInteract: () => void
}

interface InteractState {
  items: Map<string, Interactable>
  register: (item: Interactable) => () => void
}

export const useInteract = create<InteractState>()((set, get) => ({
  items: new Map(),
  register: (item) => {
    const items = new Map(get().items)
    items.set(item.id, item)
    set({ items })
    return () => {
      const next = new Map(get().items)
      if (next.get(item.id) === item) next.delete(item.id)
      set({ items: next })
    }
  },
}))

export function labelOf(item: Interactable, locked: boolean): string {
  const l = locked ? item.lockedLabel ?? item.label : item.label
  return typeof l === 'function' ? l() : l
}
