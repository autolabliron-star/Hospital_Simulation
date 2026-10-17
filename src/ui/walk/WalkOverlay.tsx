/** Walk mode's floating pieces: the drawer card, the toast, the prompt, the objective line and the key hint. Positions are in walk.css. */
import { DrawerCard } from './DrawerCard'
import { InteractPrompt } from './InteractPrompt'
import { ModeHint } from './ModeHint'
import { ObjectiveLine } from './ObjectiveLine'
import type { HudParts } from './visibility'
import { WalkToast } from './WalkToast'
import './walk.css'

export function WalkOverlay({ parts }: { parts: HudParts }) {
  return (
    <>
      {parts.drawerCard && <DrawerCard />}
      {parts.toast && <WalkToast />}
      {parts.prompt && <InteractPrompt />}
      {parts.objective && <ObjectiveLine />}
      {parts.hint && <ModeHint />}
    </>
  )
}
