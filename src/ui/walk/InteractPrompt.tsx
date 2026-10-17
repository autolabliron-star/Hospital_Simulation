/**
 * The "press E" prompt (walk mode): a key cap and what the key will do, at the bottom centre ("E · Prescribe for Grace Adeyemi").
 * `useWalk.prompt` is written by the interaction system at 10 Hz at most, only when it changes, so this re-renders rarely.
 * A locked prompt ("A4 has no patient right now") shows as plain words with no key.
 */
import { useWalk } from '@/scene/player/state'
import { splitPrompt } from './promptText'

export function PromptView({ prompt }: { prompt: string | null }) {
  if (!prompt) return null
  const { key, label } = splitPrompt(prompt)
  return (
    <div className="hud-card walk-prompt" data-locked={key === null} role="note" key={label}>
      {key !== null && <kbd className="walk-key">{key}</kbd>}
      <span className="walk-prompt__label">{label}</span>
    </div>
  )
}

export function InteractPrompt() {
  return <PromptView prompt={useWalk((s) => s.prompt)} />
}
