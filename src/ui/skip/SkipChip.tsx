/**
 * S1 Smart skip in walk mode: just the context button ("Skip to undocking · 10:12", "Skip to scan end") beside the small walk clock. Small
 * and quiet: it exists only when there is something to skip to, sits in the corner and lets the view through. Shift+] does the same; the
 * mouse is captured while walking, so the chip mostly tells you the key (it still clicks when the pointer is free).
 */
import { SKIP, fillSkip } from '@/content/skip'
import type { SkipRowModel } from './skipModel'
import { skipByLabel, useSkipBusy, useSkipRow } from './SkipControl'
import './skip.css'

export interface SkipChipViewProps {
  model: SkipRowModel
  busy: boolean
  onSkip(label: string): void
}

export function SkipChipView({ model, busy, onSkip }: SkipChipViewProps) {
  const c = model.context
  if (!c) return null
  return (
    <button
      type="button"
      className="hud-card skip-chip"
      data-kind={c.kind}
      disabled={busy}
      title={busy ? SKIP.busyTitle : fillSkip(SKIP.chipTitle, { label: c.label, key: SKIP.keys.milestone })}
      onClick={(e) => {
        onSkip(c.label)
        e.currentTarget.blur()
      }}
    >
      <span className="skip-chip__label">{c.label}</span>
      <kbd className="hud-kbd">{SKIP.keys.milestone}</kbd>
    </button>
  )
}

export function SkipChip() {
  const model = useSkipRow()
  const busy = useSkipBusy()
  return <SkipChipView model={model} busy={busy} onSkip={skipByLabel} />
}
