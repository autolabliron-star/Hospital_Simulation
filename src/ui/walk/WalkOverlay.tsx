/** Walk mode's floating pieces: the drawer card, the health card (W4), the teaching-console card (R2), the toast, the prompt, the objective line and the key hint. Positions are in walk.css. */
import { ConsoleCard } from './ConsoleCard'
import { DrawerCard } from './DrawerCard'
import { HealthCard } from './HealthCard'
import { InteractPrompt } from './InteractPrompt'
import { ModeHint } from './ModeHint'
import { ObjectiveLine } from './ObjectiveLine'
import { RealismToggle } from './RealismToggle'
import type { HudParts } from './visibility'
import { WalkToast } from './WalkToast'
import './walk.css'

export function WalkOverlay({ parts }: { parts: HudParts }) {
  return (
    <>
      {parts.drawerCard && <DrawerCard />}
      {parts.drawerCard && <HealthCard />}
      {parts.drawerCard && <ConsoleCard />}
      {parts.toast && <WalkToast />}
      {parts.prompt && <InteractPrompt />}
      {parts.objective && <ObjectiveLine />}
      {parts.hint && <ModeHint />}
      {parts.hint && <RealismToggle />}
    </>
  )
}
