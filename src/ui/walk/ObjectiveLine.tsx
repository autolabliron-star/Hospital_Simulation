/**
 * The one objective line (walk mode): "Pod A1 is bringing your order to A3: about 2 min". It follows the order you prescribed;
 * the words are made by src/scene/interact/yourOrder.ts and arrive through `useWalk.objective`. Nothing shows when you have no
 * order in flight.
 */
import { useWalk } from '@/scene/player/state'

function Flag() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="walk-objective__icon">
      <path d="M4 2v12M4 3h8l-2 3 2 3H4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ObjectiveView({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p className="hud-card walk-objective" role="status">
      <Flag />
      <span className="walk-objective__text">{text}</span>
    </p>
  )
}

export function ObjectiveLine() {
  return <ObjectiveView text={useWalk((s) => s.objective)} />
}
