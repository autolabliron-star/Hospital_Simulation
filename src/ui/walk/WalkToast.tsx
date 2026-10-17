/** The toast of walk mode: one short sentence that fades by itself (the timing is in toast.store.ts and walk.css). */
import { useToast } from './toast.store'

export function ToastView({ id, text }: { id: number; text: string | null }) {
  if (!text) return null
  return (
    <p className="hud-card walk-toast" key={id} role="status">
      {text}
    </p>
  )
}

export function WalkToast() {
  const id = useToast((s) => s.id)
  const text = useToast((s) => s.text)
  return <ToastView id={id} text={text} />
}
